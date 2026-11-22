const stepMs = 50
const maxShields = 5
const droneLanes = [.14, .285, .43, .57, .715, .86]
const dronePattern = [2, 4, 1, 5, 0, 3, 1, 4, 2, 0, 5, 3]
const droneEntry = .08
const shieldLine = .79
const shipY = .9

export function defenseIsActive(defense) {
  return !!defense && defense.status !== 'finished'
}

export function createDefense(riders, duration, now) {
  if (!riders.length) return null
  const startsAt = now + 3000
  return {
    status: 'countdown', startsAt, endsAt: startsAt + duration * 1000, finishedAt: null,
    riderIds: new Set(riders.map(rider => rider.id)),
    wave: 1, shields: maxShields, destroyed: 0, cadence: 0, fireRate: 0,
    drones: [], beams: [],
    tickAt: startsAt, nextSpawnAt: startsAt, nextDroneId: 0, nextBeamId: 0, charge: 0,
  }
}

function droneY(drone, time) {
  const progress = Math.min(1, Math.max(0, (time - drone.entersAt) / (drone.reachesAt - drone.entersAt)))
  return droneEntry + (shieldLine - droneEntry) * progress
}

function spawnDrone(defense, time) {
  const id = defense.nextDroneId++
  const lane = dronePattern[id % dronePattern.length]
  const flight = Math.max(3150, 4800 - (defense.wave - 1) * 145)
  defense.drones.push({
    id, x: droneLanes[lane], entersAt: time, reachesAt: time + flight,
    outcome: null, outcomeAt: null, targeted: false,
  })
  defense.nextSpawnAt = time + Math.max(350, 800 - (defense.wave - 1) * 95)
}

function fire(defense, time) {
  const available = defense.drones.filter(drone => !drone.targeted && !drone.outcome)
  const target = available.reduce((closest, drone) =>
    !closest || drone.reachesAt < closest.reachesAt ? drone : closest, null)
  if (target) target.targeted = true
  const travel = target ? Math.max(150, (shipY - droneY(target, time)) * 465) : 400
  const arrivesAt = time + travel
  defense.beams.push({
    id: defense.nextBeamId++, x: target?.x ?? .5,
    launchesAt: time, arrivesAt, y: target ? droneY(target, arrivesAt) : .02,
    droneId: target?.id, resolved: false,
  })
}

function step(defense, riders, time, sampleLifetime) {
  if (time < defense.endsAt) {
    defense.wave = 1 + Math.floor((time - defense.startsAt) / 10_000)
    if (time >= defense.nextSpawnAt) spawnDrone(defense, time)
  }

  let total = 0
  for (const id of defense.riderIds) {
    const rider = riders.get(id)
    if (rider && time - rider.lastSample < sampleLifetime) total += rider.rpm
  }
  defense.cadence = Math.round(total / defense.riderIds.size)
  defense.fireRate = Math.min(3.5, defense.cadence / 48)
  defense.charge += defense.fireRate * stepMs / 1000
  if (defense.charge >= 1) {
    defense.charge -= 1
    fire(defense, time)
  }

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
  const { status, startsAt, endsAt, finishedAt, wave, shields, destroyed, cadence, fireRate } = defense
  return {
    status, startsAt, endsAt, finishedAt, wave, shields, maxShields, destroyed, cadence, fireRate,
    drones: defense.drones.map(({ id, x, entersAt, reachesAt, outcome, outcomeAt }) => ({ id, x, entersAt, reachesAt, outcome, outcomeAt })),
    beams: defense.beams.map(({ id, x, y, launchesAt, arrivesAt }) => ({ id, x, y, launchesAt, arrivesAt })),
  }
}
