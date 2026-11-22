import { useEffect, useState } from 'react'
import type { MotionState } from './types'

type Sample = { time: number; axes: (number | null)[] }
type MotionApi = typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> }

const windowMs = 6200
const stepMs = 20
const minLag = 20
const maxLag = 86

function rms(values: number[]) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)
}

function correlation(signal: number[], lag: number) {
  let dot = 0
  let left = 0
  let right = 0
  for (let i = lag; i < signal.length; i++) {
    const a = signal[i]
    const b = signal[i - lag]
    dot += a * b
    left += a * a
    right += b * b
  }
  return left && right ? dot / Math.sqrt(left * right) : 0
}

export function estimateCadence(samples: Sample[]): number {
  if (samples.length < 70) return 0
  const first = samples[0].time
  const end = samples[samples.length - 1].time
  if (end - first < 4400) return 0

  // Interpolate at equal time steps so dropped events do not shift cadence.
  const axes: (number | null)[][] = Array.from({ length: samples[0].axes.length }, () => [])
  let index = 0
  for (let time = first; time < end; time += stepMs) {
    while (samples[index + 1].time < time) index++
    const before = samples[index]
    const after = samples[index + 1]
    if (after.time - before.time > 145) return 0
    const fraction = (time - before.time) / (after.time - before.time)
    axes.forEach((values, axis) => {
      const start = before.axes[axis]
      const finish = after.axes[axis]
      values.push(start === null || finish === null ? null : start + fraction * (finish - start))
    })
  }

  const channels = axes.flatMap((values, axis) => {
    if (values.some(value => value === null)) return []
    const samples = values as number[]
    // Detrend gravity and slow changes in mount tilt with a symmetric window.
    let sum = samples.slice(0, 61).reduce((total, value) => total + value, 0)
    const signal = []
    for (let i = 30; i < samples.length - 30; i++) {
      signal.push(samples[i] - sum / 61)
      sum += (samples[i + 31] ?? 0) - samples[i - 30]
    }
    const floor = axis < 3 ? 0.028 : 0.32
    const energy = rms(signal)
    if (energy < floor || rms(signal.slice(-48)) < Math.max(floor, energy * 0.2)) return []
    return [{ signal, weight: Math.min(4, energy / floor) }]
  })

  if (!channels.length) return 0
  const weight = channels.reduce((sum, channel) => sum + channel.weight, 0)
  const scores = Array.from({ length: maxLag + 2 }, (_, lag) => {
    if (lag < minLag - 1) return 0
    return channels.reduce((sum, channel) => sum + channel.weight * correlation(channel.signal, lag), 0) / weight
  })
  const threshold = Math.max(0.56, Math.max(...scores) * 0.9)
  for (let lag = minLag; lag <= maxLag; lag++) {
    const [left, peak, right] = scores.slice(lag - 1, lag + 2)
    if (peak < threshold || peak < left || peak <= right) continue
    const fractionalLag = lag + 0.5 * (left - right) / (left - 2 * peak + right)
    return Math.round(60_000 / (stepMs * fractionalLag))
  }
  return 0
}

function finite(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export const signalLabels: Record<MotionState, string> = {
  off: 'Motion off',
  connecting: 'Checking sensors',
  waiting: 'Finding pedal rhythm',
  tracking: 'Cadence detected',
  'no-data': 'No sensor data',
}

export function useMotionCadence() {
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [reading, setReading] = useState<{ rpm: number; signal: MotionState }>({ rpm: 0, signal: 'off' })

  async function enable() {
    setError('')
    if (!window.isSecureContext) {
      setError('Open the class link over HTTPS to enable motion sensors.')
      return
    }
    const motion = window.DeviceMotionEvent as MotionApi | undefined
    if (!motion) {
      setError('This browser does not expose phone motion sensors.')
      return
    }
    setPending(true)
    try {
      // Browsers that expose this method require it directly from the tap.
      if (motion.requestPermission && await motion.requestPermission() !== 'granted') {
        setError('Motion access was declined. Check this site’s motion permissions in your browser.')
        return
      }
      setReading({ rpm: 0, signal: 'connecting' })
      setEnabled(true)
    } catch {
      setError('The browser could not grant motion access. Try opening the link in your main browser.')
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    if (!enabled) return
    let samples: Sample[] = []
    let checkingSince = performance.now()
    let previous = 0
    let smoothed = 0

    function sample(event: DeviceMotionEvent) {
      const acceleration = event.accelerationIncludingGravity
      const rotation = event.rotationRate
      const axes = [acceleration?.x, acceleration?.y, acceleration?.z, rotation?.alpha, rotation?.beta, rotation?.gamma].map(finite)
      if (axes.every(value => value === null)) return
      const time = performance.now()
      if (samples.length && time <= samples[samples.length - 1].time) return
      samples.push({ time, axes })
    }

    function resetWhenVisibilityChanges() {
      samples = []
      previous = 0
      smoothed = 0
      checkingSince = performance.now()
      setReading({ rpm: 0, signal: 'connecting' })
    }

    window.addEventListener('devicemotion', sample)
    document.addEventListener('visibilitychange', resetWhenVisibilityChanges)
    const timer = window.setInterval(() => {
      if (document.hidden) return
      const now = performance.now()
      samples = samples.filter(sample => now - sample.time <= windowMs)
      const fresh = now - (samples.at(-1)?.time ?? -Infinity) < 1200
      if (!fresh) {
        previous = 0
        smoothed = 0
        setReading({ rpm: 0, signal: now - checkingSince > 3400 ? 'no-data' : 'connecting' })
        return
      }

      const candidate = estimateCadence(samples)
      const stable = candidate > 0 && previous > 0 && Math.abs(candidate - previous) <= 13
      previous = candidate
      smoothed = stable ? (smoothed ? smoothed * 0.55 + candidate * 0.45 : candidate) : 0
      setReading({ rpm: Math.round(smoothed), signal: stable ? 'tracking' : 'waiting' })
    }, 650)
    return () => {
      window.removeEventListener('devicemotion', sample)
      document.removeEventListener('visibilitychange', resetWhenVisibilityChanges)
      window.clearInterval(timer)
    }
  }, [enabled])

  function disable() {
    setEnabled(false)
    setReading({ rpm: 0, signal: 'off' })
    setError('')
  }

  return { ...reading, enabled, pending, error, enable, disable }
}
