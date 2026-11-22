const stepMs = 50
const levels = new Map([
  ['easy', { shields: 6, spawnEvery: 700, minimumSpacing: 600, flightTime: 5300, minimumFlight: 4200 }],
  ['medium', { shields: 5, spawnEvery: 400, minimumSpacing: 350, flightTime: 4400, minimumFlight: 3500 }],
  ['hard', { shields: 3, spawnEvery: 350, minimumSpacing: 350, flightTime: 3600, minimumFlight: 2800, doubleAtWaveStart: true }],
])
export const defenseDifficulties = [...levels.keys()]
const droneLanes = [.14, .285, .43, .57, .715, .86]
const dronePattern = [2, 4, 1, 5, 0, 3, 1, 4, 2, 0, 5, 3]
const droneEntry = .08
const shieldLine = .79
const shipY = .9

export function defenseIsActive(defense) {
  return !!defense && defense.status !== 'finished'
}

export function createDefense(riders, duration, now, difficulty = 'medium') {
  if (!riders.length) return null
  const startsAt = now + 3000
  const level = levels.get(difficulty)
  return {
    status: 'countdown', startsAt, endsAt: startsAt + duration * 1000, finishedAt: null,
    riderIds: new Set(riders.map(rider => rider.id)),
    difficulty, wave: 1, shields: level.shields, destroyed: 0, cadence: 0, fireRate: 0,
    drones: [], beams: [], lastSpawnWave: 0,
    tickAt: startsAt, nextSpawnAt: startsAt, nextDroneId: 0, nextBeamId: 0, charge: 0,
  }
}

function droneY(drone, time) {
  const progress = Math.min(1, Math.max(0, (time - drone.entersAt) / (drone.reachesAt - drone.entersAt)))
  return droneEntry + (shieldLine - droneEntry) * progress
}

function spawnDrone(defense, time, flight) {
  const id = defense.nextDroneId++
  const lane = dronePattern[id % dronePattern.length]
  defense.drones.push({
    id, x: droneLanes[lane], entersAt: time, reachesAt: time + flight,
    outcome: null, outcomeAt: null, targeted: false,
  })
}

function fire(defense, time) {
  let target = null
  let arrivesAt = 0
  for (const drone of defense.drones) {
    if (drone.targeted || drone.outcome || (target && drone.reachesAt >= target.reachesAt)) continue
    const impact = time + Math.max(150, (shipY - droneY(drone, time)) * 465)
    if (impact >= drone.reachesAt) continue
    target = drone
    arrivesAt = impact
  }
  if (!target) return
  target.targeted = true
  defense.charge -= 1
  defense.beams.push({
    id: defense.nextBeamId++, x: target.x,
    launchesAt: time, arrivesAt, y: droneY(target, arrivesAt),
    droneId: target.id, resolved: false,
  })
}

function step(defense, riders, time, sampleLifetime) {
  if (time < defense.endsAt) {
    defense.wave = 1 + Math.floor((time - defense.startsAt) / 10_000)
    if (time >= defense.nextSpawnAt) {
      const level = levels.get(defense.difficulty)
      const waveOffset = defense.wave - 1
      const flight = Math.max(level.minimumFlight, level.flightTime - waveOffset * 150)
      spawnDrone(defense, time, flight)
      if (level.doubleAtWaveStart && defense.lastSpawnWave !== defense.wave) spawnDrone(defense, time, flight)
      defense.lastSpawnWave = defense.wave
      defense.nextSpawnAt = time + Math.max(level.minimumSpacing, level.spawnEvery - waveOffset * stepMs)
    }
  }

  let total = 0
  for (const id of defense.riderIds) {
    const rider = riders.get(id)
    if (rider && time - rider.lastSample < sampleLifetime) total += rider.rpm
  }
  defense.cadence = Math.round(total / defense.riderIds.size)
  defense.fireRate = Math.min(3.5, defense.cadence / 48)
  defense.charge += defense.fireRate * stepMs / 1000
  if (defense.charge >= 1 && defense.fireRate > 0 && time < defense.endsAt) fire(defense, time)
  defense.charge = Math.min(1, defense.charge)

  for (const beam of defense.beams) {
    if (beam.resolved || beam.arrivesAt > time) continue
    beam.resolved = true
    const target = defense.drones.find(drone => drone.id === beam.droneId)
    if (!target || target.outcome || beam.arrivesAt > target.reachesAt) continue
    target.outcome = 'hit'
    target.outcomeAt = beam.arrivesAt
    defense.destroyed++
  }
  for (const drone of defense.drones) {
    if (drone.outcome || drone.reachesAt > time) continue
    drone.outcome = 'breach'
    drone.outcomeAt = drone.reachesAt
    defense.shields = Math.max(0, defense.shields - 1)
  }

  defense.drones = defense.drones.filter(drone => drone.outcomeAt === null || time - drone.outcomeAt < 1400)
  defense.beams = defense.beams.filter(beam => time - beam.arrivesAt < 1200)
}

export function advanceDefense(room, now, sampleLifetime, endEarly = false) {
  const defense = room.defense
  if (!defenseIsActive(defense) || now < defense.startsAt) return
  defense.status = 'running'
  const until = Math.min(now, defense.endsAt)
  while (defense.tickAt + stepMs <= until && defense.shields > 0) {
    defense.tickAt += stepMs
    step(defense, room.riders, defense.tickAt, sampleLifetime)
  }
  if (!defense.shields || endEarly || now >= defense.endsAt) {
    defense.status = 'finished'
    defense.finishedAt = defense.shields ? until : defense.tickAt
  }
}

export function publicDefense(defense) {
  if (!defense) return null
  const { status, startsAt, endsAt, finishedAt, difficulty, wave, shields, destroyed, cadence, fireRate } = defense
  return {
    status, startsAt, endsAt, finishedAt, difficulty, wave, shields, maxShields: levels.get(difficulty).shields, destroyed, cadence, fireRate,
    drones: defense.drones.map(({ id, x, entersAt, reachesAt, outcome, outcomeAt }) => ({ id, x, entersAt, reachesAt, outcome, outcomeAt })),
    beams: defense.beams.map(({ id, x, y, launchesAt, arrivesAt }) => ({ id, x, y, launchesAt, arrivesAt })),
  }
}
