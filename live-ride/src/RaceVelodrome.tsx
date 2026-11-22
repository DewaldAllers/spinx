import { useEffect, useRef, useState } from 'react'
import { RaceScene } from './RaceScene'
import type { Race, TeamId } from './types'
import type { RaceFrame } from './velodrome/render'

type Props = { race: Race; serverNow: number; cadence: Record<TeamId, number> }

export function RaceVelodrome(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const volt = useRef<HTMLSpanElement>(null)
  const flare = useRef<HTMLSpanElement>(null)
  const frame = useRef<RaceFrame>({ ...props, receivedAt: 0 })
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    frame.current = { ...props, receivedAt: performance.now() }
  }, [props.race, props.serverNow, props.cadence])

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(preference.matches)
    preference.addEventListener('change', change)
    return () => preference.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    const board = canvas.current
    const left = volt.current
    const right = flare.current
    if (failed || reduced || !board || !left || !right) return
    let active = true
    let animation = 0
    let observer: ResizeObserver | undefined
    let dispose: (() => void) | undefined
    let rendered = false
    setReady(false)

    function lost(event: Event) {
      event.preventDefault()
      if (active) setFailed(true)
    }

    board.addEventListener('webglcontextlost', lost)
    import('./velodrome/render').then(({ createVelodrome }) => {
      if (!active) return
      const velodrome = createVelodrome(board, { volt: left, flare: right })
      dispose = velodrome.dispose
      observer = new ResizeObserver(velodrome.resize)
      observer.observe(board)
      function draw(timestamp: number) {
        try {
          velodrome.render(frame.current, timestamp)
          if (!rendered) {
            rendered = true
            setReady(true)
          }
          animation = requestAnimationFrame(draw)
        } catch {
          if (active) setFailed(true)
        }
      }
      animation = requestAnimationFrame(draw)
    }).catch(() => { if (active) setFailed(true) })

    return () => {
      active = false
      board.removeEventListener('webglcontextlost', lost)
      cancelAnimationFrame(animation)
      observer?.disconnect()
      dispose?.()
    }
  }, [failed, reduced])

  if (failed || reduced) return <RaceScene {...props} />

  return <div className="race-scene race-velodrome" data-engine={ready ? 'webgl' : 'loading'} aria-hidden="true">
    <canvas ref={canvas} />
    <div className="velodrome-markers">
      <span ref={volt} className="volt">Volt</span>
      <span ref={flare} className="flare">Flare</span>
    </div>
  </div>
}
