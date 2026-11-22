import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'
import { createServer } from 'node:http'
import { randomInt, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const app = express()
app.use(express.json({ limit: '4kb' }))
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const rooms = new Map()
const colors = ['#ff8a4c', '#8be28b', '#79a7ff', '#d68cff', '#ffd166', '#5eead4']
const reactions = ['🔥', '👏', '⚡', '💪', '🚀', '🏆']
const sampleLifetime = 3000
const presenceLifetime = 10000
const closedRoomLifetime = 6 * 60 * 60 * 1000
const commentLimit = 32
const motionStates = ['off', 'connecting', 'waiting', 'tracking', 'no-data']

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')
  } while (rooms.has(code))
  return code
}

function publicRoom(room, now = Date.now()) {
  const { code, title, hostName, mode, race, reaction, comments, endedAt } = room
  const presentAt = endedAt ?? now
  const riders = [...room.riders.values()].map(rider => ({
    id: rider.id,
    name: rider.name,
    color: rider.color,
    demo: rider.demo,
    connected: presentAt - rider.lastSeen < presenceLifetime,
    rpm: !endedAt && now - rider.lastSample < sampleLifetime ? rider.rpm : 0,
    signal: !endedAt && now - rider.lastSeen < sampleLifetime ? rider.signal : 'off',
    team: rider.team,
    revolutions: rider.revolutions,
  }))
  const instructor = room.instructor
  const instructorCadence = !endedAt && instructor && now - instructor.lastSample < sampleLifetime &&
    (instructor.signal === 'tracking' || instructor.signal === 'demo' || instructor.signal === 'waiting')
    ? { rpm: instructor.signal === 'waiting' ? instructor.lastCadence ?? null : instructor.rpm }
    : null
  return { code, title, hostName, mode, riders, instructorCadence, race, reaction, comments, endedAt, serverNow: now }
}

function roomMessage(room) {
  return JSON.stringify({ type: 'room', room: publicRoom(room) })
}

function broadcast(room) {
  const payload = roomMessage(room)
  for (const client of wss.clients) {
    if (client.roomCode === room.code && client.readyState === WebSocket.OPEN && client.bufferedAmount < 64_000) {
      client.send(payload)
    }
  }
}

function getRoom(req, res) {
  const room = rooms.get(req.params.code.toUpperCase())
  if (!room) res.status(404).json({ error: 'Room not found. Check the class code.' })
  return room
}

function addRider(room, name, demo = false) {
  const rider = {
    id: randomUUID(),
    token: randomUUID(),
    name,
    color: colors[room.riders.size % colors.length],
    demo,
    lastSeen: Date.now(),
    lastSample: 0,
    rpm: 0,
    signal: room.mode === 'demo' ? 'demo' : 'off',
    team: null,
    revolutions: 0,
  }
  room.riders.set(rider.id, rider)
  return rider
}

function startRace(room, duration, now) {
  const roster = [...room.riders.values()].filter(rider => now - rider.lastSeen < presenceLifetime)
  if (roster.length < 2) return false

  for (let i = roster.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[roster[i], roster[j]] = [roster[j], roster[i]]
  }
  const lastTeams = room.lastTeams
  if (lastTeams?.size === roster.length && roster.every(rider => lastTeams.has(rider.id))) {
    const same = roster.filter((rider, index) => lastTeams.get(rider.id) === index % 2).length
    const repeats = same === roster.length || (same === 0 && roster.length > 2)
    if (repeats) {
      // Exchanging one rider from each side preserves the team sizes.
      const even = randomInt(Math.ceil(roster.length / 2)) * 2
      const odd = randomInt(Math.floor(roster.length / 2)) * 2 + 1
      ;[roster[even], roster[odd]] = [roster[odd], roster[even]]
    }
  }
  for (const rider of room.riders.values()) {
    rider.team = null
    rider.revolutions = 0
  }
  const teams = [
    { id: 'volt', size: Math.ceil(roster.length / 2), score: 0 },
    { id: 'flare', size: Math.floor(roster.length / 2), score: 0 },
  ]
  roster.forEach((rider, index) => { rider.team = teams[index % 2].id })
  room.lastTeams = new Map(roster.map((rider, index) => [rider.id, index % 2]))
  const startsAt = now + 3000
  room.previousRace = room.race
  room.race = { status: 'countdown', startsAt, endsAt: startsAt + duration * 1000, finishedAt: null, teams, winner: null }
  room.scoredAt = startsAt
  return true
}

function updateRace(room, now, endEarly = false) {
  const race = room.race
  if (!race || race.status === 'finished') return
  if (now < race.startsAt && !endEarly) return
  const until = Math.min(now, race.endsAt)
  const totals = { volt: 0, flare: 0 }

  for (const rider of room.riders.values()) {
    if (!rider.team) continue
    const sampleStart = Math.max(room.scoredAt, rider.lastSample)
    const sampleEnd = Math.min(until, rider.lastSample + sampleLifetime)
    rider.revolutions += rider.rpm * Math.max(0, sampleEnd - sampleStart) / 60_000
    totals[rider.team] += rider.revolutions
  }
  room.scoredAt = Math.max(room.scoredAt, until)
  for (const team of race.teams) {
    team.score = Math.round(totals[team.id] / team.size * 10) / 10
  }
  if (endEarly || now >= race.endsAt) {
    const [volt, flare] = race.teams
    race.status = 'finished'
    race.finishedAt = until
    race.winner = volt.score === flare.score ? 'tie' : volt.score > flare.score ? 'volt' : 'flare'
  } else {
    race.status = 'running'
  }
}

app.post('/api/rooms', (req, res) => {
  const hostName = String(req.body?.hostName ?? '').trim().slice(0, 30)
  const title = String(req.body?.title ?? '').trim().slice(0, 50)
  const mode = req.body?.mode
  if (!hostName || !title || !['demo', 'motion'].includes(mode)) {
    return res.status(400).json({ error: 'Enter an instructor name and class name, and choose a mode.' })
  }
  const hostId = randomUUID()
  const room = { code: newCode(), title, hostName, hostId, mode, riders: new Map(), race: null, reaction: null, comments: [], endedAt: null }
  rooms.set(room.code, room)
  res.status(201).json({ room: publicRoom(room), hostId })
})

app.get('/api/rooms/:code', (req, res) => {
  const room = getRoom(req, res)
  if (room) res.json({ room: publicRoom(room) })
})

app.post('/api/rooms/:code/join', (req, res) => {
  const room = getRoom(req, res)
  if (!room) return
  if (room.endedAt) return res.status(410).json({ error: 'This class has ended. Ask your instructor for a new class code.' })
  const name = String(req.body?.name ?? '').trim().slice(0, 24)
  if (!name) return res.status(400).json({ error: 'Enter a rider name.' })
  const rider = addRider(room, name)
  broadcast(room)
  res.status(201).json({ riderId: rider.id, riderToken: rider.token })
})

app.post('/api/rooms/:code/command', (req, res) => {
  const room = getRoom(req, res)
  if (!room) return
  if (req.body?.hostId !== room.hostId) {
    return res.status(403).json({ error: 'Only the instructor can use those controls.' })
  }
  const { command, value } = req.body
  if (room.endedAt) {
    if (command === 'endClass') return res.json({ ok: true })
    return res.status(410).json({ error: 'This class has ended.' })
  }
  const now = Date.now()
  updateRace(room, now)
  const inProgress = room.race && room.race.status !== 'finished'
  switch (command) {
    case 'startRace':
      if (inProgress) return res.status(409).json({ error: 'A race is already in progress.' })
      if (![30, 60, 120].includes(value)) return res.status(400).json({ error: 'Choose a race duration.' })
      if (!startRace(room, value, now)) return res.status(409).json({ error: 'At least two connected riders are needed.' })
      break
    case 'stopRace':
      if (room.race?.status === 'countdown') {
        room.race = room.previousRace
        for (const rider of room.riders.values()) rider.team = null
      } else if (inProgress) updateRace(room, now, true)
      break
    case 'endClass':
      if (room.race?.status === 'countdown') room.race = room.previousRace
      else if (inProgress) updateRace(room, now, true)
      room.endedAt = now
      room.reaction = null
      break
    case 'reaction':
      if (!reactions.includes(value)) return res.status(400).json({ error: 'Choose a reaction.' })
      room.reaction = { emoji: value, at: now }
      break
    case 'addDemo':
      if (room.mode !== 'demo' || inProgress) {
        return res.status(409).json({ error: 'Demo riders can only be added between races in a demo room.' })
      }
      for (let index = 1; index <= 10; index++) {
        const name = 'Demo rider ' + index
        if (![...room.riders.values()].some(rider => rider.demo && rider.name === name)) addRider(room, name, true)
      }
      break
    default:
      return res.status(400).json({ error: 'Unknown instructor action.' })
  }
  broadcast(room)
  res.json({ ok: true })
})

app.post('/api/rooms/:code/telemetry', (req, res) => {
  const room = getRoom(req, res)
  if (!room) return
  if (room.endedAt) return res.status(410).json({ error: 'This class has ended.' })
  const { hostId, riderId, riderToken, rpm, signal } = req.body ?? {}
  const rider = room.riders.get(riderId)
  const instructor = typeof hostId === 'string' && hostId === room.hostId
  if (!instructor && (!rider || rider.token !== riderToken || rider.demo)) {
    return res.status(403).json({ error: 'This class session is unavailable.' })
  }
  if (!Number.isFinite(rpm) || rpm < 0 || rpm > 180) {
    return res.status(400).json({ error: 'Cadence must be between 0 and 180 RPM.' })
  }
  const now = Date.now()
  const state = room.mode === 'demo' && (!instructor || signal !== 'off')
    ? 'demo' : motionStates.includes(signal) ? signal : 'off'
  const measured = state === 'demo' || state === 'tracking'
  if (instructor) {
    const lastCadence = measured ? Math.round(rpm) : state === 'waiting' ? room.instructor?.lastCadence : undefined
    room.instructor = { lastSample: now, signal: state, rpm: measured ? Math.round(rpm) : 0, lastCadence }
    return res.json({ ok: true })
  }
  updateRace(room, now)
  rider.lastSeen = now
  rider.lastSample = now
  rider.signal = state
  rider.rpm = measured ? Math.round(rpm) : 0
  res.json({ ok: true })
})

app.post('/api/rooms/:code/activity', (req, res) => {
  const room = getRoom(req, res)
  if (!room) return
  if (room.endedAt) return res.status(410).json({ error: 'This class has ended.' })
  const { hostId, riderId, riderToken, kind, value } = req.body ?? {}
  const rider = room.riders.get(riderId)
  const instructor = typeof hostId === 'string' && hostId === room.hostId
  if (!instructor && (!rider || rider.demo || rider.token !== riderToken)) {
    return res.status(403).json({ error: 'Join the class to post.' })
  }
  const content = typeof value === 'string' ? value.trim() : ''
  if (kind === 'reaction' ? !reactions.includes(content) : kind !== 'comment' || !content || content.length > 160) {
    return res.status(400).json({ error: 'Choose a cheer or write a comment of up to 160 characters.' })
  }
  const now = Date.now()
  const author = instructor ? room : rider
  if (now - (author.lastActivityAt ?? 0) < 900) {
    return res.status(429).json({ error: 'Give it a moment, then try again.' })
  }
  author.lastActivityAt = now
  const name = instructor ? room.hostName : rider.name
  if (kind === 'reaction') {
    room.reaction = { emoji: content, at: now, name }
  } else {
    room.comments.push({ id: randomUUID(), riderId: instructor ? 'instructor' : rider.id, name, content, at: now })
    if (room.comments.length > commentLimit) room.comments.shift()
  }
  broadcast(room)
  res.json({ ok: true })
})

wss.on('connection', (socket, request) => {
  const code = new URL(request.url, 'http://localhost').searchParams.get('code')?.toUpperCase()
  const room = rooms.get(code)
  if (!room) return socket.close(1008, 'Room not found')
  socket.roomCode = code
  socket.send(roomMessage(room))
})

setInterval(() => {
  const now = Date.now()
  const viewedRooms = new Set([...wss.clients].map(client => client.roomCode))
  for (const room of rooms.values()) {
    if (room.endedAt) {
      if (now - room.endedAt > closedRoomLifetime) {
        rooms.delete(room.code)
        for (const client of wss.clients) {
          if (client.roomCode === room.code) client.close(1000, 'Class expired')
        }
      }
      continue
    }
    updateRace(room, now)
    for (const rider of room.riders.values()) {
      if (!rider.demo) continue
      const variation = Math.sin(now / 2300 + Number(rider.name.split(' ').at(-1))) * 15
      rider.rpm = Math.round(85 + variation + randomInt(-5, 6))
      rider.lastSeen = now
      rider.lastSample = now
    }
    if (viewedRooms.has(room.code)) broadcast(room)
  }
}, 500)

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }))
app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))))

const port = Number(process.env.PORT) || 8787
server.listen(port, '0.0.0.0', () => console.log('SpinX is listening on port ' + port))
