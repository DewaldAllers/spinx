export const halfStraight = 26
export const radius = 17
export const lapLength = 2 * (2 * halfStraight + Math.PI * radius)
export const finishLine = lapLength + 10
const stagingDistance = 2
export const startingGrid = finishLine - stagingDistance

export function raceCourse(durationMs: number) {
  const laps = Math.max(2, 1 + Math.round(durationMs / 15_000))
  const distance = laps * lapLength + stagingDistance
  const accelerationTime = Math.min(.05, 1200 / durationMs)
  return { laps, distance, finish: startingGrid + distance, accelerationTime }
}

export function lapAt(position: number, laps: number) {
  return Math.min(laps, 1 + Math.floor(Math.max(0, position - stagingDistance) / lapLength))
}

export function raceDistance(progress: number, score: number, leader: number, course: ReturnType<typeof raceCourse>) {
  if (leader <= 0) return 0
  const time = Math.min(1, Math.max(0, progress))
  const ramp = course.accelerationTime
  const distanceProgress = time < ramp ? time * time / (2 * ramp) : time - ramp / 2
  const gap = 9 * (1 - .58 * time) * Math.sqrt(Math.max(0, 1 - score / leader))
  return Math.max(0, (course.distance - 1.05) * distanceProgress / (1 - ramp / 2) - gap * Math.min(1, time * 9))
}
