export type Mode = 'demo' | 'motion'
export type TeamId = 'volt' | 'flare'
export type MotionState = 'off' | 'connecting' | 'waiting' | 'tracking' | 'no-data'

export type Rider = {
  id: string
  name: string
  color: string
  demo: boolean
  connected: boolean
  rpm: number
  lastCadence?: number
  signal: MotionState | 'demo'
  team: TeamId | null
  revolutions: number
}

export type Race = {
  status: 'countdown' | 'running' | 'finished'
  startsAt: number
  endsAt: number
  finishedAt?: number | null
  teams: { id: TeamId; size: number; score: number }[]
  winner: TeamId | 'tie' | null
}

export type Room = {
  code: string
  title: string
  hostName: string
  mode: Mode
  riders: Rider[]
  race: Race | null
  reaction: { emoji: string; at: number } | null
  endedAt: number | null
  serverNow: number
}
