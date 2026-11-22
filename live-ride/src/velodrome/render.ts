import * as THREE from 'three'
import { glideToStop } from '../raceAnimation'
import type { Race, TeamId } from '../types'
import { createArena, trackPose } from './arena'
import { lapAt, lapLength, raceCourse, raceDistance, startingGrid } from './course'
import { createCyclist } from './cyclist'

export type RaceFrame = {
  race: Race
  cadence: Record<TeamId, number>
  serverNow: number
  receivedAt: number
}

type Markers = Record<TeamId, HTMLElement>

function light(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#e2f2ff', '#71586e', 1.8))
  const key = new THREE.DirectionalLight('#fff1d6', 2.35)
  key.position.set(-15, 28, -13)
  const rim = new THREE.DirectionalLight('#a8b5ff', 1.5)
  rim.position.set(29, 14, 22)
  scene.add(key, rim)
}

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
      if ('map' in material && material.map instanceof THREE.Texture) textures.add(material.map)
    }
  })
  geometries.forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
  textures.forEach(texture => texture.dispose())
}

export function createVelodrome(canvas: HTMLCanvasElement, markers: Markers, lapDisplay: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#161d2e')
  scene.fog = new THREE.FogExp2('#161d2e', .018)
  light(scene)
  try {
    scene.add(createArena())
  } catch (failure) {
    renderer.dispose()
    throw failure
  }

  const camera = new THREE.PerspectiveCamera(43, 2, .1, 150)
  const cameraTarget = new THREE.Vector3()
  const cameraEye = new THREE.Vector3()
  const sceneTarget = new THREE.Vector3()
  const cameraLookAt = new THREE.Vector3()
  const projected = new THREE.Vector3()
  const cyclists = (['volt', 'flare'] as const).map((team, index) => {
    const cyclist = createCyclist(team)
    scene.add(cyclist.root)
    return {
      team, ...cyclist, lane: index === 0 ? -2.6 : -.38,
      position: 0, speed: 0, rpm: 0, phase: 0, wheels: 0,
    }
  })
  let width = 1
  let height = 1
  let needsRender = true
  let previousRace: Race | null = null
  let lastRender = 0
  let serverTime = 0
  let course = raceCourse(30_000)
  let end: { began: number; seconds: number; routes: ((elapsed: number) => number)[] } | null = null

  function resize() {
    width = Math.max(1, canvas.clientWidth)
    height = Math.max(1, canvas.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    needsRender = true
  }

  function pointCamera(countdown: number, step: number, fresh: boolean) {
    const midpoint = (cyclists[0].position + cyclists[1].position) / 2
    const distance = startingGrid + midpoint
    const center = trackPose(distance, -1.5)
    const spread = Math.abs(cyclists[0].position - cyclists[1].position)
    const introBlend = THREE.MathUtils.smoothstep(midpoint, 0, 42)
    const finishBlend = 1 - THREE.MathUtils.smoothstep(course.finish - distance, 4, 18)
    const followBehind = THREE.MathUtils.lerp(2.5, -1.65 + Math.sin(midpoint / lapLength * Math.PI * 2) * .9, introBlend) + countdown * 1.25
    const side = 4.9 + spread * .65 + Math.max(0, 1.75 - camera.aspect) * 3 + countdown * .4
    const finishShot = trackPose(THREE.MathUtils.clamp(distance, course.finish - 3, course.finish + 5), -1.5)

    cameraTarget.set(center.x + center.dx * .65, center.y + 1.1, center.z + center.dz * .65)
    cameraEye.set(
      center.x + center.dz * side + center.dx * followBehind,
      center.y + 1.93 + spread * .10 + countdown * .55,
      center.z - center.dx * side + center.dz * followBehind,
    )
    cameraTarget.lerp(sceneTarget.set(finishShot.x + .35, finishShot.y + 1.64, finishShot.z + .05), finishBlend)
    cameraEye.lerp(sceneTarget.set(finishShot.x - 1.48, finishShot.y + 2.35, finishShot.z - 6.8 - Math.max(0, 1.5 - camera.aspect)), finishBlend)
    const blend = fresh ? 1 : 1 - Math.exp(-step / .07)
    camera.position.lerp(cameraEye, blend)
    cameraLookAt.lerp(cameraTarget, blend)
    camera.lookAt(cameraLookAt)
    camera.updateMatrixWorld()
  }

  function placeMarkers() {
    const labels = cyclists.map(bike => {
      const point = projected.copy(bike.root.position)
      point.y += 1.88
      point.project(camera)
      return { team: bike.team, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 }
    })
    const [left, right] = labels
    if (Math.abs(left.x - right.x) < 65 && Math.abs(left.y - right.y) < 21) {
      if (left.y < right.y) left.y = right.y - 23
      else right.y = left.y - 23
    }
    for (const { team, x, y } of labels) {
      markers[team].style.left = Math.min(width - 40, Math.max(40, x)) + 'px'
      markers[team].style.top = Math.min(height - 12, Math.max(27, y)) + 'px'
    }
  }

  function render(frame: RaceFrame, timestamp: number) {
    const { race, cadence, serverNow, receivedAt } = frame
    const fresh = previousRace?.startsAt !== race.startsAt
    if (fresh) {
      serverTime = 0
      end = null
      course = raceCourse(race.endsAt - race.startsAt)
      for (const bike of cyclists) Object.assign(bike, { position: 0, speed: 0, rpm: 0, phase: 0, wheels: 0 })
    }
    const step = Math.max(0, Math.min(.08, (timestamp - lastRender) / 1000))
    lastRender = timestamp
    const leader = Math.max(0, ...race.teams.map(team => team.score))
    const natural = leader > 0 && (race.finishedAt ?? race.endsAt) >= race.endsAt
    const trailing = (team: TeamId) => race.winner !== 'tie' && race.winner !== team
    if (!fresh && previousRace?.status === 'running' && race.status === 'finished') {
      end = {
        began: timestamp,
        seconds: natural ? 2.55 : .85,
        routes: cyclists.map(bike => {
          const behind = trailing(bike.team)
          const destination = natural
            ? course.distance + (behind ? 3.8 : 5.4)
            : Math.min(course.distance - 1, bike.position + Math.min(6, bike.speed * .28))
          return glideToStop(bike.position, bike.speed, destination, natural ? (behind ? 2.55 : 1.65) : .85)
        }),
      }
    }
    if (!needsRender && previousRace === race && race.status === 'finished' && !end) return

    serverTime = Math.max(serverTime, serverNow + Math.max(0, Math.min(850, timestamp - receivedAt)))
    const raceTime = race.status === 'finished' ? race.finishedAt ?? race.endsAt : serverTime
    const progress = THREE.MathUtils.clamp((raceTime - race.startsAt) / (race.endsAt - race.startsAt), 0, 1)
    const blend = 1 - Math.exp(-step / .14)
    const cadenceBlend = 1 - Math.exp(-step / .34)
    const timePastEnd = end ? (timestamp - end.began) / 1000 : 0
    for (const [index, bike] of cyclists.entries()) {
      const score = race.teams.find(team => team.id === bike.team)?.score ?? 0
      const previous = bike.position
      if (end) {
        bike.position = end.routes[index](timePastEnd)
      } else if (race.status === 'finished') {
        if (natural) bike.position = course.distance + (trailing(bike.team) ? 3.8 : 5.4)
        else if (fresh) bike.position = raceDistance(progress, score, leader, course)
      } else if (race.status === 'running') {
        const target = raceDistance(progress, score, leader, course)
        bike.position = fresh ? target : Math.max(previous, previous + (target - previous) * blend)
      }

      const travel = Math.max(0, bike.position - previous)
      if (step) bike.speed += (travel / step - bike.speed) * blend
      const targetRpm = race.status === 'running' ? cadence[bike.team] : 0
      bike.rpm += (targetRpm - bike.rpm) * cadenceBlend
      bike.phase += bike.rpm / 60 * Math.PI * 2 * step
      bike.wheels += (fresh ? 0 : travel) / .353
      const place = trackPose(startingGrid + bike.position, bike.lane)
      bike.root.position.set(place.x, place.y, place.z)
      bike.root.rotation.y = -Math.atan2(place.dz, place.dx)
      bike.bank.rotation.x = -Math.atan(place.bank)
      bike.pedal(bike.phase, bike.wheels)
    }
    const countdown = race.status === 'countdown' ? THREE.MathUtils.clamp((race.startsAt - serverTime) / 3000, 0, 1) : 0
    pointCamera(countdown, step, fresh)
    renderer.render(scene, camera)
    placeMarkers()
    const lap = 'Lap ' + lapAt(Math.max(...cyclists.map(bike => bike.position)), course.laps) + ' / ' + course.laps
    if (lapDisplay.textContent !== lap) lapDisplay.textContent = lap
    if (end && timePastEnd >= end.seconds) end = null
    previousRace = race
    needsRender = false
  }

  resize()
  return {
    resize,
    render,
    dispose() {
      disposeScene(scene)
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
