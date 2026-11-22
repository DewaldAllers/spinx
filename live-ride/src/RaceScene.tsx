import { useEffect, useRef } from 'react'
import type { Race, TeamId } from './types'
import { finishPath, racePosition } from './raceAnimation'

const width = 1120
const height = 360
const startX = 90
const lanes = [
  { y: 218, tint: '#d5ff42', dark: '#708b24', size: 0.89 },
  { y: 301, tint: '#a8a4ff', dark: '#5c54a7', size: 1.02 },
]
const checkerLeft = 1000
const checkerTop = 128
const checkerTilt = 3 / 19
const riderSlope = .019
const frontWheel = 37
const wheelRadius = 21

function finishX(lane: typeof lanes[number]) {
  const wheelHeight = lane.y - 19 * lane.size
  return (checkerLeft + 11 + (wheelHeight - checkerTop) * checkerTilt - (frontWheel + wheelRadius) * lane.size) /
    (1 + riderSlope * checkerTilt)
}

function line(ctx: CanvasRenderingContext2D, points: number[][], color: string, weight: number) {
  ctx.beginPath()
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  ctx.strokeStyle = color
  ctx.lineWidth = weight
  ctx.stroke()
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawRider(ctx: CanvasRenderingContext2D, phase: number, wheelPhase: number, x: number, y: number, lane: typeof lanes[number]) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(lane.size, lane.size)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ellipse(ctx, 1, 6, 60, 8, '#080a16aa')
  ellipse(ctx, -5, 5, 53, 3, lane.dark)
  const hubs = [-35, frontWheel]
  for (const hub of hubs) {
    ellipse(ctx, hub, -19, wheelRadius, wheelRadius, '#0c0d16')
    ctx.beginPath()
    ctx.arc(hub, -19, 18.5, 0, Math.PI * 2)
    ctx.strokeStyle = lane.tint
    ctx.lineWidth = 2
    ctx.stroke()
    for (let spoke = 0; spoke < 3; spoke++) {
      const angle = wheelPhase + spoke * Math.PI / 3
      const dx = Math.cos(angle) * 16
      const dy = Math.sin(angle) * 16
      line(ctx, [[hub - dx, -19 - dy], [hub + dx, -19 + dy]], lane.dark, 0.8)
    }
  }

  const crank = [-5, -20]
  line(ctx, [[-35, -19], [-15, -43], crank, [23, -43], [-15, -43]], lane.tint, 3.5)
  line(ctx, [[-35, -19], crank], lane.tint, 3.5)
  line(ctx, [[37, -19], [23, -43], [28, -54], [38, -52]], lane.tint, 3.4)
  line(ctx, [[-15, -43], [-19, -53], [-27, -53], [-13, -53]], '#c9c9d7', 2.6)

  const bob = Math.sin(phase * 2) * 1.6
  const hip = [-19, -58 + bob * .3]
  for (const [angle, color] of [[phase + Math.PI, '#52566a'], [phase, '#aaa9c2']] as const) {
    const foot = [-5 + Math.cos(angle) * 7, -20 + Math.sin(angle) * 7]
    const dx = foot[0] - hip[0]
    const dy = foot[1] - hip[1]
    const length = Math.hypot(dx, dy)
    const flex = Math.sqrt(Math.max(0, 26 ** 2 - (length / 2) ** 2))
    const knee = [(hip[0] + foot[0]) / 2 + dy / length * flex, (hip[1] + foot[1]) / 2 - dx / length * flex]
    line(ctx, [hip, knee, foot], color, 7)
    line(ctx, [[foot[0] - 3, foot[1]], [foot[0] + 7, foot[1]]], '#161822', 4)
  }
  const body = [[-20, -59], [-8, -73 + bob], [12, -77 + bob]]
  line(ctx, body, '#13151e', 19)
  line(ctx, body, lane.tint, 13)
  line(ctx, [[12, -75 + bob], [17, -61], [30, -53]], '#eadbc9', 5.5)
  ellipse(ctx, 22, -82 + bob, 8.5, 8, '#e6d0bc')
  ellipse(ctx, 20, -87 + bob, 12, 6.5, lane.tint)
  line(ctx, [[17, -87 + bob], [26, -88 + bob]], lane.dark, 1.4)
  ctx.restore()
}

function quadrilateral(ctx: CanvasRenderingContext2D, points: number[][], color: string) {
  ctx.beginPath()
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function drawTrack(ctx: CanvasRenderingContext2D) {
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#12131e')
  sky.addColorStop(.53, '#2e3146')
  sky.addColorStop(1, '#161826')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)

  for (let i = 0; i < 9; i++) {
    const x = i * 148 - 36
    quadrilateral(ctx, [[x, 0], [x + 15, 0], [x + 98, 124], [x + 82, 124]], '#0d0e18')
  }
  for (let i = 0; i < 6; i++) {
    const y = 40 + i * i * 4
    line(ctx, [[0, y], [width, y - 12]], '#55587140', 1)
  }
  for (let i = 0; i < 7; i++) {
    const x = i * 183 + 50
    ctx.shadowBlur = 17
    ctx.shadowColor = '#ada8ff'
    line(ctx, [[x, 27], [x + 47, 28]], '#ada8ff80', 3)
  }
  ctx.shadowBlur = 0

  quadrilateral(ctx, [[0, 136], [width, 120], [width, 350], [0, 360]], '#212434')
  quadrilateral(ctx, [[0, 150], [width, 134], [width, 224], [0, 250]], '#333649')
  quadrilateral(ctx, [[0, 252], [width, 226], [width, 329], [0, 355]], '#292d42')
  line(ctx, [[0, 142], [width, 126]], '#a7adca', 2)
  line(ctx, [[0, 249], [width, 224]], '#a4a7ba95', 2)
  line(ctx, [[0, 357], [width, 330]], '#a7adca', 2)
  line(ctx, [[0, 165], [width, 149]], '#d5ff4260', 2)
  line(ctx, [[0, 275], [width, 247]], '#a8a4ff70', 2)
  for (let i = -1; i < 17; i++) {
    const x = i * 80
    line(ctx, [[x, 229 - x * .022], [x + 32, 228 - x * .022]], '#b8bbce36', 2)
    line(ctx, [[x, 345 - x * .023], [x + 32, 344 - x * .023]], '#b8bbce32', 2)
  }

  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 2; col++) {
      const y = checkerTop + row * 19
      const x = checkerLeft + row * 3 + col * 11
      quadrilateral(ctx, [[x, y], [x + 11, y], [x + 14, y + 19], [x + 3, y + 19]], (row + col) % 2 ? '#10121b' : '#bfc1d4')
    }
  }
}

export function RaceScene({ race, serverNow, cadence }: { race: Race; serverNow: number; cadence: Record<TeamId, number> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ race, serverNow, cadence, receivedAt: 0 })
  useEffect(() => {
    latest.current = { race, serverNow, cadence, receivedAt: performance.now() }
  }, [race, serverNow, cadence])

  useEffect(() => {
    const element = canvas.current
    const painter = element?.getContext('2d')
    const backdrop = document.createElement('canvas')
    backdrop.width = width * 2
    backdrop.height = height * 2
    const track = backdrop.getContext('2d')
    if (!element || !painter || !track) return
    track.scale(2, 2)
    drawTrack(track)

    const board = element
    const context = painter
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let lastFrame = 0
    let paintNeeded = true
    let previousRace: Race | undefined
    let finish: { started: number; seconds: number; paths: ((elapsed: number) => number)[] } | undefined
    let serverTime = 0
    const cyclists = lanes.map((lane, index) => ({
      lane, team: (index ? 'flare' : 'volt') as TeamId, trackLength: finishX(lane) - startX,
      position: 0, speed: 0, rpm: 0, pedals: 0, wheels: 0,
    }))
    const observer = new ResizeObserver(() => {
      const pixelRatio = Math.min(devicePixelRatio || 1, 2)
      board.width = Math.max(1, Math.round(board.clientWidth * pixelRatio))
      board.height = Math.max(1, Math.round(board.clientHeight * pixelRatio))
      paintNeeded = true
    })
    observer.observe(board)

    function draw(timestamp: number) {
      const { race: live, serverNow, cadence: liveCadence, receivedAt } = latest.current
      const animate = !reduceMotion.matches
      const dt = Math.min(.065, Math.max(0, timestamp - lastFrame) / 1000)
      const newRace = previousRace?.startsAt !== live.startsAt
      if (newRace) {
        finish = undefined
        serverTime = 0
        for (const bike of cyclists) Object.assign(bike, { position: 0, speed: 0, rpm: 0, pedals: 0, wheels: 0 })
      }
      if (!animate) finish = undefined

      const leaderScore = Math.max(0, ...live.teams.map(team => team.score))
      const naturalFinish = leaderScore > 0 && (live.finishedAt ?? live.endsAt) >= live.endsAt
      const duration = Math.max(1, live.endsAt - live.startsAt)
      const trailing = (team: TeamId) => live.winner !== team && live.winner !== 'tie'
      if (live.status === 'finished' && previousRace?.status !== 'finished' && animate && !newRace) {
        finish = {
          started: timestamp,
          seconds: naturalFinish ? 2.55 : .85,
          paths: cyclists.map(bike => finishPath(bike.position, bike.speed, naturalFinish, trailing(bike.team))),
        }
      }
      const endAnimation = finish
      const finishingFor = endAnimation ? (timestamp - endAnimation.started) / 1000 : 0
      const running = live.status === 'running'
      if (paintNeeded || previousRace !== live || (running && animate) || endAnimation) {
        serverTime = Math.max(serverTime, serverNow + (animate ? Math.min(900, Math.max(0, timestamp - receivedAt)) : 0))
        const raceTime = live.status === 'finished' ? live.finishedAt ?? live.endsAt : serverTime
        const elapsed = (raceTime - live.startsAt) / duration
        const blend = 1 - Math.exp(-dt / .35)
        context.setTransform(board.width / width, 0, 0, board.height / height, 0, 0)
        context.drawImage(backdrop, 0, 0, width, height)
        cyclists.forEach((bike, i) => {
          const score = live.teams.find(team => team.id === bike.team)?.score ?? 0
          const lastPosition = bike.position
          if (endAnimation) {
            bike.position = endAnimation.paths[i](finishingFor)
          } else if (live.status === 'finished') {
            if (naturalFinish) bike.position = trailing(bike.team) ? 1.014 : 1.027
            else if (newRace) bike.position = racePosition(elapsed, score, leaderScore)
          } else if (running) {
            const target = racePosition(elapsed, score, leaderScore)
            bike.position = animate ? Math.max(lastPosition, lastPosition + (target - lastPosition) * blend) : target
          }

          if (dt && animate) {
            const distance = (bike.position - lastPosition) * bike.trackLength
            bike.speed += (Math.max(0, bike.position - lastPosition) / dt - bike.speed) * blend
            const targetRpm = running ? liveCadence[bike.team] : 0
            bike.rpm += (targetRpm - bike.rpm) * blend
            bike.pedals += bike.rpm / 60 * Math.PI * 2 * dt
            bike.wheels += Math.max(0, distance) / (wheelRadius * bike.lane.size)
          }
          const x = startX + bike.position * bike.trackLength
          drawRider(context, bike.pedals, bike.wheels, x, bike.lane.y - x * riderSlope, bike.lane)
        })
        previousRace = live
        paintNeeded = false
        if (endAnimation && finishingFor >= endAnimation.seconds) finish = undefined
      }
      lastFrame = timestamp
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvas} className="race-scene" aria-hidden="true" />
}
