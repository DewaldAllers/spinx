import { useEffect, useRef } from 'react'
import type { DefenseRound } from './types'

const width = 1000
const height = 550
const shieldY = .79 * height
const shipY = .9 * height
const teal = '#6df6ed'
const amber = '#ffa96b'
const clamp = (value: number) => Math.max(0, Math.min(1, value))

function polygon(ctx: CanvasRenderingContext2D, points: [number, number][], color: string) {
  ctx.beginPath()
  ctx.moveTo(...points[0])
  for (const point of points.slice(1)) ctx.lineTo(...point)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

function background() {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const space = ctx.createLinearGradient(0, 0, 0, height)
  space.addColorStop(0, '#060b1e')
  space.addColorStop(.6, '#12152e')
  space.addColorStop(1, '#081f35')
  ctx.fillStyle = space
  ctx.fillRect(0, 0, width, height)
  const haze = ctx.createRadialGradient(750, 100, 12, 750, 100, 480)
  haze.addColorStop(0, '#4f398160')
  haze.addColorStop(1, '#241e3b00')
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, width, height)

  for (let star = 1; star <= 155; star++) {
    const x = (star * 283.47) % width
    const y = (star * (443.21 + star / 131)) % height
    circle(ctx, x, y, star % 11 === 0 ? 1.7 : .85, star % 3 === 0 ? '#c6e8fc99' : '#8db4e045')
  }
  const planet = ctx.createLinearGradient(770, 20, 930, 187)
  planet.addColorStop(0, '#4e4770')
  planet.addColorStop(.55, '#222442')
  planet.addColorStop(1, '#18182e')
  ctx.beginPath()
  ctx.arc(862, 87, 100, 0, 2 * Math.PI)
  ctx.fillStyle = planet
  ctx.fill()
  ctx.strokeStyle = '#9d9bef55'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.strokeStyle = '#70bde51e'
  ctx.lineWidth = 1
  for (let column = -5; column <= 5; column++) {
    ctx.beginPath()
    ctx.moveTo(500 + column * 43, 135)
    ctx.lineTo(500 + column * 161, height)
    ctx.stroke()
  }
  for (const y of [168, 202, 245, 302, 376, 474]) ctx.fillRect(0, y, 0, 0)
  ctx.fillStyle = '#70bde51e'
  for (const y of [168, 202, 245, 302, 376, 474]) ctx.fillRect(0, y, width, 1)
  return canvas
}

function drawRound(ctx: CanvasRenderingContext2D, backdrop: HTMLCanvasElement, round: DefenseRound, now: number) {
  ctx.drawImage(backdrop, 0, 0)
  const shieldRatio = round.shields / round.maxShields
  ctx.fillStyle = shieldRatio > .4 ? '#62e3ff50' : '#ff815e66'
  ctx.fillRect(0, shieldY, width, 2)
  for (let slot = 0; slot < round.maxShields; slot++) {
    ctx.fillStyle = slot < round.shields ? '#62e3ff9e' : '#ff815e34'
    ctx.fillRect(9 + slot * (width / round.maxShields), shieldY + 6, width / round.maxShields - 18, 3)
  }

  for (const drone of round.drones) {
    if (now < drone.entersAt) continue
    const x = drone.x * width
    const age = drone.outcomeAt === null ? -1 : now - drone.outcomeAt
    const pilotTime = age >= 0 ? now - age : now
    const progress = clamp((pilotTime - drone.entersAt) / (drone.reachesAt - drone.entersAt))
    const y = (.08 + .71 * progress) * height
    if (age >= 0) {
      if (age > 340) continue
      ctx.globalAlpha = 1 - age / 340
      const impactColor = drone.outcome === 'hit' ? '#ffd28e' : '#ff6f70'
      for (let spark = 0; spark < 9; spark++) {
        const angle = spark * Math.PI * 2 / 9
        circle(ctx, x + Math.cos(angle) * age / 6, y + Math.sin(angle) * age / 6, 4, impactColor)
      }
      ctx.globalAlpha = 1
      continue
    }
    ctx.save()
    ctx.translate(x, y)
    polygon(ctx, [[-28, -9], [-15, -14], [0, -6], [15, -14], [28, -9], [16, 10], [0, 15], [-16, 10]], '#a0495e')
    polygon(ctx, [[-28, -9], [-15, -14], [-9, -3], [-17, 2]], amber)
    polygon(ctx, [[28, -9], [15, -14], [9, -3], [17, 2]], amber)
    polygon(ctx, [[-10, -5], [10, -5], [6, 7], [-6, 7]], '#ffd8a4')
    ctx.restore()
  }

  const muzzle = round.beams.some(beam => now >= beam.launchesAt && now - beam.launchesAt < 140)
  ctx.save()
  ctx.translate(width / 2, shipY)
  polygon(ctx, [[-12, 14], [0, muzzle ? 38 : 29], [12, 14]], '#6df6ed86')
  polygon(ctx, [[0, -27], [15, -3], [36, 19], [12, 13], [0, 18], [-12, 13], [-36, 19], [-15, -3]], '#257d96')
  polygon(ctx, [[0, -27], [14, 8], [0, 15], [-14, 8]], teal)
  polygon(ctx, [[0, -15], [7, 3], [0, 8], [-7, 3]], '#103249')
  circle(ctx, -22, 12, 3, '#adecff')
  circle(ctx, 22, 12, 3, '#adecff')
  ctx.restore()

  for (const beam of round.beams) {
    if (now < beam.launchesAt || now > beam.arrivesAt) continue
    const progress = clamp((now - beam.launchesAt) / (beam.arrivesAt - beam.launchesAt))
    const from = Math.max(0, progress - .19)
    const x = beam.x * width - width / 2
    const y = beam.y * height - (shipY - 23)
    ctx.beginPath()
    ctx.moveTo(width / 2 + x * from, shipY - 23 + y * from)
    ctx.lineTo(width / 2 + x * progress, shipY - 23 + y * progress)
    ctx.strokeStyle = '#b6fff4'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.shadowColor = teal
    ctx.shadowBlur = 15
    ctx.stroke()
    ctx.shadowBlur = 0
  }
}

function DefenseScene({ round, serverNow }: { round: DefenseRound; serverNow: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const snapshot = useRef({ round, serverNow, receivedAt: 0 })
  useEffect(() => {
    snapshot.current = { round, serverNow, receivedAt: performance.now() }
  }, [round, serverNow])
  useEffect(() => {
    const element = canvas.current
    const ctx = element?.getContext('2d')
    if (!element || !ctx) return
    const backdrop = background()
    const resize = () => {
      const bounds = element.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      element.width = Math.max(1, Math.round(bounds.width * dpr))
      element.height = Math.max(1, Math.round(bounds.height * dpr))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    let frame = 0
    function render(time: number) {
      if (!element || !ctx) return
      const { round, serverNow, receivedAt } = snapshot.current
      // Keep enough snapshot history on screen to show each beam in flight.
      const playback = serverNow + Math.min(750, Math.max(0, time - receivedAt)) - 525
      const now = Math.min(playback, (round.finishedAt ?? round.endsAt) + 340)
      ctx.setTransform(element.width / width, 0, 0, element.height / height, 0, 0)
      drawRound(ctx, backdrop, round, now)
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  return <canvas ref={canvas} className="race-scene defense-scene" role="img" aria-label="A shared spaceship fires at descending drones" />
}

export function DefenseBoard({ round, serverNow, scene = false, projector = false }: {
  round: DefenseRound
  serverNow: number
  scene?: boolean
  projector?: boolean
}) {
  const finished = round.status === 'finished'
  const countdown = round.status === 'countdown'
  const remaining = Math.max(0, Math.ceil(((countdown ? round.startsAt : round.endsAt) - serverNow) / 1000))
  let title = 'Orbit Defense'
  if (finished) {
    if (!round.shields) title = 'Shields down'
    else if ((round.finishedAt ?? round.endsAt) < round.endsAt) title = 'Round ended'
    else title = 'Orbit defended'
  }
  const stats = [
    { label: 'Wave', value: round.wave },
    { label: 'Shields', value: round.shields + '/' + round.maxShields },
    { label: 'Drones cleared', value: round.destroyed },
    { label: 'Beam capacity', value: round.fireRate.toFixed(1) + '/s' },
  ]
  return <section className={'race-board defense-board' + (projector ? ' projector-stage' : '')}>
    <div className="race-heading">
      <div>
        {(countdown || finished) && <p className="eyebrow">{finished ? 'ORBIT DEFENSE' : 'GET READY'}</p>}
        <div className="defense-title">
          <h2>{title}</h2>
          {round.difficulty && <span className="count-pill defense-level">{round.difficulty}</span>}
        </div>
      </div>
      {!finished && <div className="display-clock"><b>{remaining}</b><span>SECONDS</span></div>}
    </div>
    {scene && <DefenseScene round={round} serverNow={serverNow} />}
    <dl className="defense-stats">{stats.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {!projector && !finished && <p className="score-note">Class average {round.cadence} RPM. Higher cadence fires more beams.</p>}
  </section>
}
