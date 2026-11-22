import { useEffect, useState } from 'react'
import type { MotionState } from './types'

type Sample = { time: number; axes: (number | null)[] }
type MotionApi = typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> }

const windowsMs = [2650, 3650, 4900]
const updateMs = 350
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
    const weight = 1 + 2 * i / signal.length
    dot += weight * a * b
    left += weight * a * a
    right += weight * b * b
  }
  return left && right ? dot / Math.sqrt(left * right) : 0
}

function estimateWindow(samples: Sample[]): number {
  if (samples.length < 45) return 0
  const first = samples[0].time
  const end = samples[samples.length - 1].time
  if (end - first < windowsMs[0] - 150) return 0

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
    const changes = samples.slice(1).map((value, index) => value - samples[index])
    const motionFloor = axis < 3 ? 0.003 : 0.035
    if (rms(changes.slice(-28)) < Math.max(motionFloor, rms(changes) * .2)) return []

    // Remove the gravity baseline and slow tilt, retaining the latest samples.
    const radius = 15
    const count = radius * 2 + 1
    let sum = samples.slice(0, count).reduce((total, value) => total + value, 0)
    const signal = []
    for (let i = radius; i < samples.length - radius; i++) {
      signal.push(samples[i] - sum / count)
      sum += (samples[i + radius + 1] ?? 0) - samples[i - radius]
    }
    const floor = axis < 3 ? 0.028 : 0.32
    const energy = rms(signal)
    if (energy < floor || rms(signal.slice(-48)) < Math.max(floor, energy * 0.2)) return []
    return [{ signal, weight: Math.min(4, energy / floor) }]
  })

  if (!channels.length) return 0
  const weight = channels.reduce((sum, channel) => sum + channel.weight, 0)
  const longestLag = Math.min(maxLag, Math.floor(channels[0].signal.length / 2.25))
  const scores = Array.from({ length: longestLag + 2 }, (_, lag) => {
    if (lag < minLag - 1) return 0
    return channels.reduce((sum, channel) => sum + channel.weight * correlation(channel.signal, lag), 0) / weight
  })
  const threshold = Math.max(0.61, Math.max(...scores) * 0.9)
  for (let lag = minLag; lag <= longestLag; lag++) {
    const [left, peak, right] = scores.slice(lag - 1, lag + 2)
    if (peak < threshold || peak < left || peak <= right) continue
    const fractionalLag = lag + 0.5 * (left - right) / (left - 2 * peak + right)
    return Math.round(60_000 / (stepMs * fractionalLag))
  }
  return 0
}

export function estimateCadence(samples: Sample[]): number {
  const last = samples.at(-1)
  if (!last) return 0
  // Use the shortest credible estimate. Lower cadence needs longer to repeat.
  for (const window of windowsMs) {
    const recent = samples.filter(sample => sample.time >= last.time - window)
    const rpm = estimateWindow(recent)
    if (rpm) return rpm
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
    let smoothed = 0
    let lastEstimateAt = -Infinity
    let pendingJump = 0

    function clearEstimate() {
      smoothed = 0
      lastEstimateAt = -Infinity
      pendingJump = 0
    }

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
      clearEstimate()
      checkingSince = performance.now()
      setReading({ rpm: 0, signal: 'connecting' })
    }

    window.addEventListener('devicemotion', sample)
    document.addEventListener('visibilitychange', resetWhenVisibilityChanges)
    const timer = window.setInterval(() => {
      if (document.hidden) return
      const now = performance.now()
      samples = samples.filter(sample => now - sample.time <= windowsMs[windowsMs.length - 1])
      const fresh = now - (samples.at(-1)?.time ?? -Infinity) < 1200
      if (!fresh) {
        clearEstimate()
        setReading({ rpm: 0, signal: now - checkingSince > 3400 ? 'no-data' : 'connecting' })
        return
      }

      const candidate = estimateCadence(samples)
      if (candidate) {
        const largeJump = smoothed > 0 && Math.abs(candidate - smoothed) > 23
        if (largeJump && Math.abs(candidate - pendingJump) > 12) {
          pendingJump = candidate
        } else {
          smoothed = !smoothed || largeJump ? candidate : smoothed * .3 + candidate * .7
          lastEstimateAt = now
          pendingJump = 0
        }
      } else {
        pendingJump = 0
      }
      if (now - lastEstimateAt > updateMs * 2) clearEstimate()
      setReading({ rpm: Math.round(smoothed), signal: smoothed ? 'tracking' : 'waiting' })
    }, updateMs)
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
