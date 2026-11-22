import * as THREE from 'three'
import { finishLine, halfStraight, lapLength, radius } from './course'

const straight = halfStraight * 2
const halfCurve = Math.PI * radius
const inner = -4.4

export function trackPose(distance: number, lane = 0) {
  const s = THREE.MathUtils.euclideanModulo(distance, lapLength)
  let x, z, dx, dz, curve
  if (s < straight) {
    x = s - halfStraight; z = radius; dx = 1; dz = 0; curve = 0
  } else if (s < straight + halfCurve) {
    const angle = (s - straight) / radius
    dx = Math.cos(angle); dz = -Math.sin(angle)
    x = halfStraight - radius * dz; z = radius * dx
    curve = Math.sin(angle)
  } else if (s < 2 * straight + halfCurve) {
    x = halfStraight - (s - straight - halfCurve); z = -radius; dx = -1; dz = 0; curve = 0
  } else {
    const angle = (s - 2 * straight - halfCurve) / radius
    dx = -Math.cos(angle); dz = Math.sin(angle)
    x = -halfStraight - radius * dz; z = radius * dx
    curve = Math.sin(angle)
  }
  const bank = .09 + .33 * curve * curve * (3 - 2 * curve)
  return {
    x: x - dz * lane, y: .11 + Math.max(0, lane - inner) * bank, z: z + dx * lane,
    dx, dz, bank,
  }
}

function trackStrip(laneA: number, laneB: number, level: number, flat = false) {
  const vertices: number[] = [], uvs: number[] = [], faces: number[] = []
  const steps = 400
  for (let i = 0; i <= steps; i++) {
    const along = i / steps * lapLength
    for (const lane of [laneA, laneB]) {
      const pose = trackPose(along, lane)
      vertices.push(pose.x, (flat ? .08 : pose.y) + level, pose.z)
      uvs.push(i / steps, lane === laneA ? 0 : 1)
    }
    if (i < steps) {
      const first = i * 2
      faces.push(first, first + 1, first + 2, first + 1, first + 3, first + 2)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(faces)
  geometry.computeVertexNormals()
  return geometry
}

function texture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas textures are unavailable')
  draw(context)
  const result = new THREE.CanvasTexture(canvas)
  result.colorSpace = THREE.SRGBColorSpace
  return result
}

function noise(seed: number) {
  const value = Math.sin(seed * 93.17 + 1.47) * 43758.5453123
  return value - Math.floor(value)
}

function woodMap() {
  const map = texture(512, 512, ctx => {
    for (let strip = 0; strip < 52; strip++) {
      const y = Math.floor(strip * 512 / 52)
      const nextY = Math.floor((strip + 1) * 512 / 52)
      const tint = noise(strip)
      ctx.fillStyle = 'hsl(32 45% ' + (49 + tint * 15) + '%)'
      ctx.fillRect(0, y, 512, nextY - y)
      ctx.fillStyle = '#75462f39'
      ctx.fillRect(0, y, 512, 1)
      for (let section = 0; section < 12; section++) {
        const seed = strip * 57 + section * 3
        const x = Math.floor(noise(seed + 3) * 490)
        const grain = Math.floor(y + noise(seed + 6) * (nextY - y))
        ctx.fillStyle = section % 3 ? '#fff0be16' : '#5a352815'
        ctx.fillRect(x, grain, 12 + noise(seed + 2) * 60, 1)
      }
      const join = Math.round(noise(strip + 231) * 210)
      ctx.fillStyle = '#42241733'
      for (let x = join; x < 512; x += 256) ctx.fillRect(x, y, 1, nextY - y)
    }
  })
  map.wrapS = THREE.RepeatWrapping
  map.repeat.x = 8
  map.anisotropy = 8
  return map
}

function signMap(text: string) {
  return texture(512, 128, ctx => {
    ctx.fillStyle = '#141925'
    ctx.fillRect(0, 0, 512, 128)
    ctx.fillStyle = '#ddff50'
    ctx.fillRect(0, 0, 12, 128)
    ctx.fillRect(500, 0, 12, 128)
    ctx.fillStyle = '#f6f8ff'
    ctx.font = '800 56px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, 66)
  })
}

function addFinishLine(arena: THREE.Group) {
  const rows = 2
  const cols = 18
  const step = 8.8 / cols
  const light = new THREE.MeshBasicMaterial({ color: '#f8e9cd', side: THREE.DoubleSide })
  const dark = new THREE.MeshBasicMaterial({ color: '#222634', side: THREE.DoubleSide })
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const along = finishLine + (row - 1) * .29
      const lane = inner + col * step
      const a = trackPose(along, lane), b = trackPose(along, lane + step)
      const c = trackPose(along + .29, lane), d = trackPose(along + .29, lane + step)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(
        [a, b, c, d].flatMap(p => [p.x, p.y + .015, p.z]), 3))
      geometry.setIndex([0, 1, 2, 1, 3, 2])
      arena.add(new THREE.Mesh(geometry, (col + row) % 2 ? dark : light))
    }
  }
}

function arenaSeating(arena: THREE.Group) {
  const tier = (inside: number, outside: number, level: number, color: string) =>
    arena.add(new THREE.Mesh(trackStrip(inside, outside, level, true),
      new THREE.MeshStandardMaterial({ color, roughness: .8, metalness: .05, side: THREE.DoubleSide })))

  const seatGeometry = new THREE.BoxGeometry(.44, .31, .38)
  const rowCount = 10
  const seatsPerRow = 210
  const seats = new THREE.InstancedMesh(seatGeometry, new THREE.MeshStandardMaterial({ roughness: .88 }), rowCount * seatsPerRow)
  const matrix = new THREE.Object3D()
  const colors = ['#263156', '#3e4f78', '#555074', '#353d58', '#536882', '#2e435e', '#677686'].map(color => new THREE.Color(color))
  for (let row = 0; row < rowCount; row++) {
    const lane = 9 + row * .9
    const level = 4.7 + row * .58
    tier(lane - .38, lane + .6, level, row % 2 ? '#343950' : '#2a3246')
    if (row % 3 === 0) tier(lane - .43, lane - .35, level + .025, '#555a7b')
    for (let i = 0; i < seatsPerRow; i++) {
      const index = row * seatsPerRow + i
      const p = trackPose(i / seatsPerRow * lapLength, lane)
      const empty = i % 22 === 0 || i % 22 === 1
      const stature = .75 + noise(index) * .75
      matrix.position.set(p.x, level + .22 * stature, p.z)
      matrix.rotation.set(0, -Math.atan2(p.dz, p.dx), 0)
      matrix.scale.set(empty ? 0 : 1, stature, 1)
      matrix.updateMatrix()
      seats.setMatrixAt(index, matrix.matrix)
      seats.setColorAt(index, colors[Math.floor(noise(index + 561) * colors.length)])
    }
  }
  arena.add(seats)

  const fascia = (lane: number, level: number, height: number, material: THREE.Material) => {
    const geometry = trackStrip(lane, lane, level, true)
    const positions = geometry.getAttribute('position')
    for (let i = 1; i < positions.count; i += 2) positions.setY(i, positions.getY(i) + height)
    positions.needsUpdate = true
    geometry.computeVertexNormals()
    return new THREE.Mesh(geometry, material)
  }

  const charcoal = new THREE.MeshStandardMaterial({ color: '#232b43', side: THREE.DoubleSide, roughness: .75 })
  const led = new THREE.MeshBasicMaterial({ color: '#91a5f7', side: THREE.DoubleSide })
  const warmLed = new THREE.MeshBasicMaterial({ color: '#c7d6ff', side: THREE.DoubleSide })
  arena.add(fascia(7.8, 1, 3.55, charcoal), fascia(7.77, 4.03, .06, led))
  arena.add(fascia(19.3, 8.7, 9.3, charcoal), fascia(19.25, 11.1, .095, led))
  arena.add(fascia(19.25, 14.6, .10, warmLed))

  const branding = new THREE.MeshBasicMaterial({ map: signMap('SPINX') })
  const placard = new THREE.PlaneGeometry(4.6, .95)
  for (let i = 0; i < 12; i++) {
    const p = trackPose((i + .5) * lapLength / 12, 7.67)
    const panel = new THREE.Mesh(placard, branding)
    panel.position.set(p.x, 2.57, p.z)
    panel.rotation.y = Math.atan2(p.dz, -p.dx)
    arena.add(panel)
  }

  const truss = new THREE.BoxGeometry(.17, .2, 32)
  const fixture = new THREE.BoxGeometry(.18, .12, 2.9)
  for (let i = 0; i < 14; i++) {
    const joist = new THREE.Mesh(truss, charcoal)
    joist.position.set(-48 + i * 7.5, 13.5 + (i % 2) * .32, 0)
    arena.add(joist)
    for (const z of [-14, -8, 8, 14]) {
      const lamp = new THREE.Mesh(fixture, warmLed)
      lamp.position.set(joist.position.x, joist.position.y - .18, z)
      arena.add(lamp)
    }
  }
}

function finishBridge(arena: THREE.Group) {
  const p = trackPose(finishLine)
  const bridge = new THREE.Group()
  bridge.position.set(p.x, 0, p.z)
  bridge.rotation.y = -Math.atan2(p.dz, p.dx)
  arena.add(bridge)
  const structure = new THREE.MeshStandardMaterial({ color: '#313950', roughness: .32, metalness: .5 })
  const trim = new THREE.MeshBasicMaterial({ color: '#d9fc53' })
  const inside = -9.3
  const outside = 4.82
  for (const z of [inside, outside]) {
    const column = new THREE.Mesh(new THREE.BoxGeometry(.24, 5, .25), structure)
    column.position.set(0, 2.5, z)
    const accent = new THREE.Mesh(new THREE.BoxGeometry(.055, 4, .075), trim)
    accent.position.set(-.131, 2.6, z)
    bridge.add(column, accent)
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(.35, .25, outside - inside + .24), structure)
  beam.position.set(0, 4.9, (inside + outside) / 2)
  bridge.add(beam)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, .9), new THREE.MeshBasicMaterial({
    map: signMap('START / FINISH'), side: THREE.DoubleSide,
  }))
  sign.position.set(-.2, 4.86, 0)
  sign.rotation.y = -Math.PI / 2
  bridge.add(sign)
}

export function createArena() {
  const arena = new THREE.Group()
  function surface(a: number, b: number, material: THREE.Material, height = 0, flat = false) {
    arena.add(new THREE.Mesh(trackStrip(a, b, height, flat), material))
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(174, 120),
    new THREE.MeshStandardMaterial({ color: '#252d45', roughness: .92 }))
  floor.rotation.x = -Math.PI / 2
  arena.add(floor)
  surface(-8, inner, new THREE.MeshStandardMaterial({ color: '#297182', roughness: .68 }), 0, true)
  surface(inner, 5, new THREE.MeshStandardMaterial({ map: woodMap(), roughness: .63 }))
  surface(5, 5.35, new THREE.MeshStandardMaterial({ color: '#3b4056', roughness: .7 }))
  for (const [lane, color, span] of [[-4.35, '#fbe8cb', .075], [-3.25, '#2b302a', .06], [-1.12, '#ac403a', .07], [1.25, '#344961', .07], [4.86, '#efe3c8', .09]] as const) {
    surface(lane, lane + span, new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2 }), .027)
  }
  for (const height of [.36, .86]) {
    surface(5.18, 5.27, new THREE.MeshBasicMaterial({ color: '#8c9ebb' }), height)
  }
  addFinishLine(arena)
  arenaSeating(arena)
  finishBridge(arena)
  return arena
}
