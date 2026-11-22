import { useEffect, useRef, useState } from 'react'

type Sample = { time: number; axes: number[] }
type MotionApi = typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> }

const windowMs = 6200
const stepMs = 20

export function estimateCadence(samples: Sample[]): number {
  if (samples.length < 100) return 0
  const first = samples[0].time
  const end = samples[samples.length - 1].time
  if (end - first < 4500) return 0

  // Interpolate to equal time steps before comparing repeated motion patterns.
  const axes: number[][] = [[], [], []]
  let index = 0
  for (let time = first; time < end; time += stepMs) {
    while (samples[index + 1].time < time) index++
    const before = samples[index]
    const after = samples[index + 1]
    if (after.time - before.time > 140) return 0
    const fraction = (time - before.time) / (after.time - before.time)
    axes.forEach((values, axis) => values.push(before.axes[axis] + fraction * (after.axes[axis] - before.axes[axis])))
  }

  // Remove the steady gravity component and slow changes in phone tilt.
  const signals = axes.map(axis => {
    let baseline = axis[0]
    return axis.map(value => {
      baseline += (value - baseline) * 0.025
      return value - baseline
    }).slice(25)
  })
  const energy = (signal: number[]) => signal.reduce((sum, value) => sum + value * value, 0)
  const signal = signals.reduce((best, candidate) => energy(candidate) > energy(best) ? candidate : best)
  if (Math.sqrt(energy(signal) / signal.length) < 0.035) return 0

  function correlation(lag: number) {
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
    return dot / Math.sqrt(left * right)
  }

  const minLag = 20
  const maxLag = 86
  const scores = Array.from({ length: maxLag + 2 }, (_, lag) => lag < minLag - 1 ? 0 : correlation(lag))
  const threshold = Math.max(0.5, Math.max(...scores) * 0.9)
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (scores[lag] >= threshold && scores[lag] >= scores[lag - 1] && scores[lag] > scores[lag + 1]) {
      return Math.round(60_000 / (stepMs * lag))
    }
  }
  return 0
}

export function useMotionCadence() {
  const [enabled, setEnabled] = useState(false)
  const [message, setMessage] = useState('')
  const [rpm, setRpm] = useState(0)
  const latest = useRef(0)

  async function enable() {
    if (!window.isSecureContext) {
      setMessage('Phone motion needs an HTTPS link.')
      return
    }
    const motion = window.DeviceMotionEvent as MotionApi | undefined
    if (!motion) {
      setMessage('This browser does not provide phone motion readings.')
      return
    }
    try {
      if (motion.requestPermission && await motion.requestPermission() !== 'granted') {
        setMessage('Motion permission was declined. Check the browser settings and try again.')
        return
      }
      setMessage('Pedal steadily for a few seconds.')
      setEnabled(true)
    } catch {
      setMessage('Motion permission could not be enabled. Try again.')
    }
  }

  useEffect(() => {
    if (!enabled) return
    let samples: Sample[] = []
    const readings: number[] = []
    function sample(event: DeviceMotionEvent) {
      // A fixed mount gives the gravity-inclusive signal a stable reference.
      const acceleration = event.accelerationIncludingGravity
      if (!acceleration) return
      const { x, y, z } = acceleration
      if (x === null || y === null || z === null) return
      const time = performance.now()
      if (samples.length && time <= samples[samples.length - 1].time) return
      samples.push({ time, axes: [x, y, z] })
    }
    function clearWhenHidden() {
      if (!document.hidden) return
      samples = []
      readings.length = 0
      latest.current = 0
      setRpm(0)
    }
    window.addEventListener('devicemotion', sample)
    document.addEventListener('visibilitychange', clearWhenHidden)
    const timer = window.setInterval(() => {
      const now = performance.now()
      samples = samples.filter(sample => now - sample.time <= windowMs)
      const detected = estimateCadence(samples)
      if (detected) {
        readings.push(detected)
        if (readings.length > 3) readings.shift()
      } else {
        readings.length = 0
      }
      const sorted = [...readings].sort((a, b) => a - b)
      latest.current = sorted[Math.floor(sorted.length / 2)] ?? 0
      setRpm(latest.current)
      setMessage(detected ? 'Motion signal detected.' : 'Searching for steady cadence. Keep the phone secure and the page open.')
    }, 750)
    return () => {
      window.removeEventListener('devicemotion', sample)
      document.removeEventListener('visibilitychange', clearWhenHidden)
      window.clearInterval(timer)
    }
  }, [enabled])

  function disable() {
    latest.current = 0
    setRpm(0)
    setEnabled(false)
    setMessage('')
  }

  return { enabled, message, rpm, latest, enable, disable }
}
