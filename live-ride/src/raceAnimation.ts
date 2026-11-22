export function racePosition(elapsed: number, score: number, leaderScore: number) {
  if (leaderScore === 0) return 0
  const progress = Math.min(1, Math.max(0, elapsed))
  const gap = Math.sqrt(Math.max(0, 1 - score / leaderScore))
  return progress * (.987 - gap * .11 * (1 - .65 * progress))
}

export function finishPath(position: number, velocity: number, natural: boolean, trailing: boolean) {
  const end = natural ? (trailing ? 1.014 : 1.027) : Math.min(.995, position + velocity * .36)
  const duration = natural ? (trailing ? 2.55 : 1.65) : .85
  const travel = Math.max(0, end - position)
  const initialSlope = Math.min(velocity * duration, travel * 3)

  return (elapsed: number) => {
    const t = Math.min(1, Math.max(0, elapsed / duration))
    return position + travel * t * t * (3 - 2 * t) + initialSlope * t * (1 - t) ** 2
  }
}
