import * as THREE from 'three'
import type { TeamId } from '../types'

export const teamColors: Record<TeamId, string> = { volt: '#dbff3f', flare: '#9993ff' }
const up = new THREE.Vector3(0, 1, 0)
const sphere = new THREE.SphereGeometry(1, 16, 10)
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12)
const tyreGeometry = new THREE.TorusGeometry(.318, .035, 10, 48)
const rimGeometry = new THREE.TorusGeometry(.304, .012, 8, 40)
const hubGeometry = new THREE.CylinderGeometry(.044, .044, .089, 12)

function ellipsoid(group: THREE.Group, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const mesh = new THREE.Mesh(sphere, material)
  mesh.position.set(x, y, z)
  mesh.scale.set(sx, sy, sz)
  group.add(mesh)
  return mesh
}

function setSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thickness: number) {
  mesh.position.addVectors(a, b).multiplyScalar(.5)
  const direction = new THREE.Vector3().subVectors(b, a)
  mesh.scale.set(thickness, direction.length(), thickness)
  mesh.quaternion.setFromUnitVectors(up, direction.normalize())
}

function addTube(group: THREE.Group, material: THREE.Material, a: number[], b: number[], radius: number) {
  const mesh = new THREE.Mesh(cylinder, material)
  setSegment(mesh, new THREE.Vector3(...a), new THREE.Vector3(...b), radius)
  group.add(mesh)
}

function wheel(group: THREE.Group, x: number, metal: THREE.Material, tyre: THREE.Material, rim: THREE.Material) {
  const assembly = new THREE.Group()
  assembly.position.set(x, .353, 0)
  group.add(assembly)
  assembly.add(new THREE.Mesh(tyreGeometry, tyre), new THREE.Mesh(rimGeometry, rim))
  const hub = new THREE.Mesh(hubGeometry, metal)
  hub.rotation.x = Math.PI / 2
  assembly.add(hub)

  const spokes: number[] = []
  for (let i = 0; i < 14; i++) {
    const angle = i * Math.PI / 7
    spokes.push(0, 0, (i % 2 ? 1 : -1) * .027, Math.cos(angle) * .302, Math.sin(angle) * .302, 0)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(spokes, 3))
  assembly.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#a6b1c0' })))
  return assembly
}

function contactShadow() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas textures are unavailable')
  const shade = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  shade.addColorStop(0, '#1a142aaa')
  shade.addColorStop(.56, '#1b122658')
  shade.addColorStop(1, '#1b122600')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, 64, 64)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.14, .98), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false,
  }))
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = .014
  return mesh
}

export function createCyclist(team: TeamId) {
  const root = new THREE.Group()
  const bank = new THREE.Group()
  const body = new THREE.Group()
  root.add(bank)
  bank.add(contactShadow(), body)
  const accent = new THREE.MeshStandardMaterial({ color: teamColors[team], roughness: .48, metalness: .18 })
  const dark = new THREE.MeshStandardMaterial({ color: '#1f2837', roughness: .61 })
  const tyre = new THREE.MeshStandardMaterial({ color: '#14161c', roughness: .92 })
  const metal = new THREE.MeshStandardMaterial({ color: '#b3bdcf', roughness: .39, metalness: .56 })
  const trim = new THREE.MeshStandardMaterial({ color: '#e0e7f5', roughness: .43 })
  const skin = new THREE.MeshStandardMaterial({ color: team === 'volt' ? '#ca8f66' : '#aa7658', roughness: .78 })
  const visor = new THREE.MeshStandardMaterial({ color: '#202f48', roughness: .29, metalness: .44 })

  const wheels = [wheel(bank, -.534, metal, tyre, accent), wheel(bank, .553, metal, tyre, accent)]
  const bottom = [-.028, .406, 0]
  const seatTube = [-.24, .902, 0]
  const headTube = [.405, .835, 0]
  addTube(bank, accent, bottom, seatTube, .039)
  addTube(bank, accent, bottom, headTube, .045)
  addTube(bank, accent, seatTube, headTube, .036)
  addTube(bank, metal, seatTube, [-.279, .998, 0], .019)
  ellipsoid(bank, dark, -.277, .994, 0, .139, .027, .061)

  for (const z of [-.055, .055]) {
    addTube(bank, accent, [headTube[0], headTube[1], z], [.553, .353, z], .026)
    addTube(bank, accent, [-.534, .353, z], [bottom[0], bottom[1], z], .021)
    addTube(bank, dark, [-.534, .353, z], [seatTube[0], seatTube[1], z], .016)
    addTube(bank, dark, [.45, .982, 0], [.54, 1.022, z * 3.2], .021)
    addTube(bank, tyre, [.54, 1.022, z * 3.2], [.496, .971, z * 3.2], .025)
  }
  addTube(bank, dark, headTube, [.452, .99, 0], .03)

  const torso = ellipsoid(body, accent, -.039, 1.248, 0, .335, .126, .151)
  torso.rotation.z = .505
  ellipsoid(body, dark, -.275, 1.063, 0, .154, .112, .135)
  const collar = ellipsoid(body, trim, .207, 1.374, 0, .111, .095, .146)
  collar.rotation.z = .49
  const baseOfHead = new THREE.Vector3(.314, 1.422, 0)
  ellipsoid(body, skin, baseOfHead.x, baseOfHead.y, 0, .119, .127, .10)
  const helmet = ellipsoid(body, accent, .285, 1.512, 0, .173, .115, .116)
  helmet.rotation.z = -.17
  const shellStripe = ellipsoid(body, trim, .27, 1.563, 0, .142, .056, .055)
  shellStripe.rotation.z = -.18
  const glasses = ellipsoid(body, visor, .383, 1.451, 0, .065, .042, .101)
  glasses.rotation.z = -.24

  const legs = [-1, 1].map(side => {
    const z = side * .095
    const upperArm = new THREE.Vector3(.167, 1.354, side * .139)
    const elbow = new THREE.Vector3(.35, 1.117, side * .159)
    const hand = new THREE.Vector3(.517, .995, side * .175)
    ellipsoid(body, accent, upperArm.x, upperArm.y, upperArm.z, .085, .082, .074)
    addTube(body, skin, upperArm.toArray(), elbow.toArray(), .039)
    ellipsoid(body, skin, elbow.x, elbow.y, elbow.z, .042, .043, .043)
    addTube(body, skin, elbow.toArray(), hand.toArray(), .032)
    ellipsoid(body, dark, hand.x, hand.y, hand.z, .052, .035, .035)

    const thigh = new THREE.Mesh(cylinder, dark)
    const knee = new THREE.Mesh(sphere, skin)
    knee.scale.setScalar(.071)
    const shin = new THREE.Mesh(cylinder, skin)
    const shoe = new THREE.Mesh(sphere, trim)
    shoe.scale.set(.105, .041, .064)
    const crank = new THREE.Mesh(cylinder, metal)
    body.add(thigh, knee, shin, shoe)
    bank.add(crank)
    return {
      side, thigh, knee, shin, shoe, crank,
      hip: new THREE.Vector3(-.285, 1.043, z),
      bracket: new THREE.Vector3(bottom[0], bottom[1], side * .081),
    }
  })

  function pedal(phase: number, wheelAngle: number) {
    for (const part of wheels) part.rotation.z = -wheelAngle
    const dip = Math.sin(2 * phase) * .014
    body.position.y = dip
    for (const leg of legs) {
      const angle = phase + (leg.side === -1 ? Math.PI : 0)
      const foot = new THREE.Vector3(leg.bracket.x + Math.cos(angle) * .143, leg.bracket.y - Math.sin(angle) * .143, leg.side * .137)
      const dx = foot.x - leg.hip.x
      const dy = foot.y - dip - leg.hip.y
      const span = Math.hypot(dx, dy)
      const bend = Math.sqrt(Math.max(0, .43 ** 2 - (span / 2) ** 2))
      const kneecap = new THREE.Vector3(
        (leg.hip.x + foot.x) / 2 - dy / span * bend,
        (leg.hip.y + foot.y - dip) / 2 + dx / span * bend,
        leg.side * .121,
      )
      const ankle = new THREE.Vector3(foot.x - .035, foot.y - dip + .031, foot.z)
      setSegment(leg.thigh, leg.hip, kneecap, .067)
      leg.knee.position.copy(kneecap)
      setSegment(leg.shin, kneecap, ankle, .049)
      leg.shoe.position.set(foot.x + .032, foot.y - dip + .004, foot.z)
      leg.shoe.rotation.z = .1 + Math.sin(angle) * .22
      setSegment(leg.crank, leg.bracket, foot, .012)
    }
  }

  pedal(0, 0)
  return { root, bank, pedal }
}
