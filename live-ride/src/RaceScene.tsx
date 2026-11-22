import { useEffect, useRef } from 'react'
import type { Race } from './types'

const width = 1120
const height = 360
const lanes = [
  { y: 218, tint: '#d5ff42', dark: '#708b24', size: 0.89 },
  { y: 301, tint: '#a8a4ff', dark: '#5c54a7', size: 1.02 },
]

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

function drawRider(ctx: CanvasRenderingContext2D, phase: number, x: number, y: number, lane: typeof lanes[number]) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(lane.size, lane.size)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ellipse(ctx, 1, 6, 60, 8, '#080a16aa')
  ellipse(ctx, -5, 5, 53, 3, lane.dark)
  const hubs = [-35, 37]
  for (const hub of hubs) {
    ellipse(ctx, hub, -19, 21, 21, '#0c0d16')
    ctx.beginPath()
    ctx.arc(hub, -19, 18.5, 0, Math.PI * 2)
    ctx.strokeStyle = lane.tint
    ctx.lineWidth = 2
    ctx.stroke()
    for (let spoke = 0; spoke < 3; spoke++) {
      const angle = phase + spoke * Math.PI / 3
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
  const pedalX = Math.cos(phase) * 7
  const pedalY = Math.sin(phase) * 7
  line(ctx, [[-19, -58], [-2 - pedalX * .8, -47], [-5 - pedalX, -20 - pedalY]], '#52566a', 8)
  line(ctx, [[-19, -58], [0 + pedalX * .9, -45], [-5 + pedalX, -20 + pedalY]], '#aaa9c2', 7)
  line(ctx, [[-9 + pedalX, -19 + pedalY], [2 + pedalX, -19 + pedalY]], '#161822', 4)
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

function drawTrack(ctx: CanvasRenderingContext2D, phase: number) {
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
    const x = i * 80 - (phase * 26) % 80
    line(ctx, [[x, 229 - x * .022], [x + 32, 228 - x * .022]], '#b8bbce36', 2)
    line(ctx, [[x, 345 - x * .023], [x + 32, 344 - x * .023]], '#b8bbce32', 2)
  }

  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 2; col++) {
      const y = 128 + row * 19
      const x = 1000 + row * 3 + col * 11
      quadrilateral(ctx, [[x, y], [x + 11, y], [x + 14, y + 19], [x + 3, y + 19]], (row + col) % 2 ? '#10121b' : '#bfc1d4')
    }
  }
}

export function RaceScene({ race }: { race: Race }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const currentRace = useRef(race)
  const progress = useRef([0, 0])
  useEffect(() => { currentRace.current = race }, [race])

  useEffect(() => {
    progress.current = [0, 0]
  }, [race.startsAt])

  useEffect(() => {
    const element = canvas.current
    const ctx = element?.getContext('2d')
    if (!element || !ctx) return
    const surface = element
    const painter = ctx
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let lastFrame = 0
    const pedalPhases = [0, 0]
    let paintNeeded = true
    let previousRace: Race | undefined
    const observer = new ResizeObserver(() => {
      const pixelRatio = Math.min(devicePixelRatio || 1, 2)
      element.width = Math.max(1, Math.round(element.clientWidth * pixelRatio))
      element.height = Math.max(1, Math.round(element.clientHeight * pixelRatio))
      paintNeeded = true
    })
    observer.observe(element)

    function draw(timestamp: number) {
      const live = currentRace.current
      const motion = live.status === 'running' && !reduceMotion.matches
      if (paintNeeded || motion || previousRace !== live) {
        const delta = Math.min(50, timestamp - lastFrame)
        const distance = Math.max(1, (live.endsAt - live.startsAt) / 60_000 * 120, ...live.teams.map(team => team.score))
        const positions = lanes.map((_, index) => {
          const score = live.teams.find(team => team.id === (index ? 'flare' : 'volt'))?.score ?? 0
          const target = score / distance
          const previous = progress.current[index]
          const position = motion ? previous + (target - previous) * Math.min(1, delta / 180) : target
          if (motion) pedalPhases[index] += Math.max(0, position - previous) * distance * Math.PI * 2
          progress.current[index] = position
          return position
        })
        painter.setTransform(surface.width / width, 0, 0, surface.height / height, 0, 0)
        drawTrack(painter, motion ? Math.max(...positions) * distance * .85 : 0)
        lanes.forEach((lane, index) => {
          const position = positions[index]
          const x = 90 + position * 862
          const y = lane.y - x * .019
          drawRider(painter, motion ? pedalPhases[index] : 0, x, y, lane)
        })

        previousRace = live
        paintNeeded = false
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
