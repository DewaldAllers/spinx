import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, subscribeToRoom } from './api'
import { signalLabels, useMotionCadence } from './cadence'
import { RaceScene } from './RaceScene'
import type { Mode, MotionState, Race, Rider, Room, TeamId } from './types'

type View = 'home' | 'create' | 'join' | 'host' | 'ride' | 'display'
const teamNames: Record<TeamId, string> = { volt: 'Volt', flare: 'Flare' }
const reactions = ['🔥', '👏', '⚡', '💪', '🚀', '🏆']

type InstallPrompt = Event & { prompt: () => Promise<unknown> }

function InstallButton() {
  const [install, setInstall] = useState<InstallPrompt | null>(null)
  useEffect(() => {
    function capture(event: Event) {
      event.preventDefault()
      setInstall(event as InstallPrompt)
    }
    window.addEventListener('beforeinstallprompt', capture)
    return () => window.removeEventListener('beforeinstallprompt', capture)
  }, [])
  if (!install) return null
  return <button className="secondary" onClick={() => {
    setInstall(null)
    void install.prompt()
  }}>Install SpinX</button>
}

function useKeepScreenOn() {
  useEffect(() => {
    let active = true
    let acquiring = false
    let lock: WakeLockSentinel | undefined
    async function requestLock() {
      if (!navigator.wakeLock || document.hidden || acquiring || (lock && !lock.released)) return
      acquiring = true
      try {
        const acquired = await navigator.wakeLock.request('screen')
        if (active) lock = acquired
        else await acquired.release()
      } catch {
        // The screen can still be kept on through device settings.
      } finally {
        acquiring = false
      }
    }
    void requestLock()
    document.addEventListener('visibilitychange', requestLock)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', requestLock)
      if (lock && !lock.released) void lock.release()
    }
  }, [])
}

function getRoute() {
  const [view, query] = location.hash.slice(2).split('?')
  const code = new URLSearchParams(query).get('code')?.toUpperCase()
  return { view: view || 'home', code: /^[A-Z0-9]{4}$/.test(code ?? '') ? code : undefined }
}

function route(view: View, code?: string) {
  return '#/' + view + (code ? '?code=' + code : '')
}

function link(view: View, code: string) {
  return location.origin + location.pathname + route(view, code)
}

function Logo() {
  return <span className="logo"><span className="logo-mark">S</span><span>SPINX</span><em>LIVE</em></span>
}

function Header({ code }: { code?: string }) {
  return <header className="topbar">
    <a href={route('home')} className="brand"><Logo /></a>
    {code && <span className="room-pill"><span className="live-dot" /> Class {code}</span>}
  </header>
}

function Home() {
  const [resumeCode, setResumeCode] = useState<string>()
  useEffect(() => {
    const code = localStorage.getItem('last-host-class')
    if (!code || !localStorage.getItem('host:' + code)) return
    let active = true
    api.getRoom(code).then(({ room }) => {
      if (active && !room.endedAt) setResumeCode(code)
    }).catch(() => {})
    return () => { active = false }
  }, [])
  return <main className="home-shell">
    <nav><Logo /><InstallButton /></nav>
    <section className="hero">
      <div className="hero-copy">
        <h1>Ride harder.<br /><span>Move together.</span></h1>
        <p>Open a class, put it on the studio screen, and race with your crew.</p>
        <div className="hero-actions">
          <a className="primary large" href={route('create')}>Host a class</a>
          <a className="secondary large" href={route('join')}>Join with a code</a>
          {resumeCode && <a className="secondary large" href={route('host', resumeCode)}>Resume class {resumeCode}</a>}
        </div>
      </div>
    </section>
  </main>
}

function CreateRoom() {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('Studio Ride')
  const [mode, setMode] = useState<Mode>('demo')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !title.trim()) return
    setBusy(true)
    setError('')
    try {
      const { room, hostId } = await api.createRoom(name.trim(), title.trim(), mode)
      localStorage.setItem('host:' + room.code, hostId)
      localStorage.setItem('last-host-class', room.code)
      location.hash = route('host', room.code)
    } catch (failure) {
      setError((failure as Error).message)
      setBusy(false)
    }
  }

  return <><Header /><main className="form-shell">
    <form className="form-card" onSubmit={create}>
      <h2>Host a class</h2>
      <label>Instructor name<input required value={name} onChange={event => setName(event.target.value)} maxLength={30} /></label>
      <label>Class name<input required value={title} onChange={event => setTitle(event.target.value)} maxLength={50} /></label>
      <label>Cadence source<select value={mode} onChange={event => setMode(event.target.value as Mode)}>
        <option value="demo">Demo · simulated cadence</option>
        <option value="motion">Phone motion · experimental</option>
      </select></label>
      <p className="muted">{mode === 'demo' ? 'Try the race with simulated riders or invite people to join and set their demo RPM.' : 'Riders must open the HTTPS link and mount their phones securely on the handlebars.'}</p>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="primary wide" disabled={busy}>{busy ? 'Creating…' : 'Create class'}</button>
    </form>
  </main></>
}

function JoinRoom({ initialCode }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function join(event: FormEvent) {
    event.preventDefault()
    if (code.length !== 4 || !name.trim()) {
      setError('Enter your name and the 4-character class code.')
      return
    }
    const existing = sessionStorage.getItem('rider:' + code)
    if (existing) {
      location.hash = route('ride', code)
      return
    }
    setBusy(true)
    setError('')
    try {
      const rider = await api.joinRoom(code, name.trim())
      sessionStorage.setItem('rider:' + code, JSON.stringify(rider))
      location.hash = route('ride', code)
    } catch (failure) {
      setError((failure as Error).message)
      setBusy(false)
    }
  }

  return <><Header /><main className="form-shell">
    <form className="form-card" onSubmit={join}>
      <h2>Join your class</h2>
      <label>Class code<input className="code-input" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} placeholder="AB12" autoComplete="off" required /></label>
      <label>Rider name<input value={name} onChange={event => setName(event.target.value)} maxLength={24} required /></label>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="primary wide" disabled={busy}>{busy ? 'Joining…' : 'Join class'}</button>
    </form>
  </main></>
}

function useRoom(code: string) {
  const [room, setRoom] = useState<Room | null>(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    let active = true
    let receivedLive = false
    api.getRoom(code).then(result => {
      if (active && !receivedLive) setRoom(result.room)
    }).catch(failure => {
      if (active && !receivedLive) setError(failure.message)
    })
    const unsubscribe = subscribeToRoom(code, snapshot => {
      receivedLive = true
      setRoom(snapshot)
      setError('')
    }, setConnected)
    return () => {
      active = false
      unsubscribe()
    }
  }, [code])
  return { room, error, connected }
}

function timeLeft(race: Race, now: number) {
  const target = race.status === 'countdown' ? race.startsAt : race.endsAt
  return Math.max(0, Math.ceil((target - now) / 1000))
}

function raceResult(race: Race) {
  return race.winner === 'tie' ? 'Tie race' : race.winner ? 'Team ' + teamNames[race.winner] + ' wins' : ''
}

function useRaceVisible(room: Room | null) {
  const [dismissedRace, setDismissedRace] = useState<number>()
  const race = room?.race
  const startsAt = race?.startsAt
  const serverNow = room?.serverNow ?? 0
  const visibleFor = race?.status === 'finished'
    ? Math.max(0, Math.min(8000, (race.finishedAt ?? race.endsAt) + 8000 - serverNow))
    : undefined
  useEffect(() => {
    if (visibleFor === undefined || visibleFor === 0 || dismissedRace === startsAt) return
    const timer = window.setTimeout(() => setDismissedRace(startsAt), visibleFor)
    return () => window.clearTimeout(timer)
  }, [startsAt, visibleFor, dismissedRace])
  return !!race && (race.status !== 'finished' || (visibleFor !== 0 && dismissedRace !== startsAt))
}

function RaceBoard({ room, scene = false }: { room: Room; scene?: boolean }) {
  const race = room.race
  if (!race) return null
  const maxScore = Math.max(1, ...race.teams.map(team => team.score))
  return <section className={'race-board' + (scene ? ' with-scene' : '')}>
    <div className="race-heading">
      <div><p className="eyebrow">TEAM RACE</p><h2>{race.status === 'finished' ? raceResult(race) : race.status === 'countdown' ? 'Get ready' : 'Race in progress'}</h2></div>
      {race.status !== 'finished' && <div className="display-clock"><b>{timeLeft(race, room.serverNow)}</b><span>SECONDS</span></div>}
    </div>
    {scene && <RaceScene race={race} />}
    <div className="team-grid">
      {race.teams.map(team => <div className={'team-card ' + team.id} key={team.id} data-winner={race.winner === team.id || undefined}>
        <div className="team-title"><h3>{teamNames[team.id]}</h3><span>{team.size} {team.size === 1 ? 'rider' : 'riders'}</span></div>
        <strong>{team.score.toFixed(1)}</strong>
        {!scene && <div className="team-track" aria-hidden="true"><i style={{ width: team.score / maxScore * 100 + '%' }} /></div>}
      </div>)}
    </div>
    <p className="score-note">Average pedal revolutions per rider</p>
  </section>
}

function RiderList({ room }: { room: Room }) {
  const raceInProgress = room.race && room.race.status !== 'finished'
  const riders = room.riders.filter(rider => rider.connected || (raceInProgress && rider.team))
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (!riders.length) return <div className="empty-room"><span aria-hidden="true">+</span><b>Waiting for riders</b><p>Share class code <strong>{room.code}</strong> to get everyone on the board.</p></div>

  return <ul className="rider-grid">
    {riders.map(rider => <li className="rider-tile" key={rider.id}>
      <span className="avatar" style={{ background: rider.color }}>{rider.name.split(/\s+/).slice(0, 2).map(part => part[0].toUpperCase()).join('')}</span>
      <span className="rider-name"><b>{rider.name}</b><small className={raceInProgress ? rider.team ?? '' : ''}>
        {!rider.connected ? 'Disconnected' : room.mode === 'motion' ? signalLabels[rider.signal === 'demo' ? 'off' : rider.signal] : rider.demo ? 'Simulated' : 'Demo input'}
        {rider.connected && raceInProgress && rider.team && ' · ' + teamNames[rider.team]}
      </small></span>
      <span className="rider-rpm">{room.mode === 'motion' && rider.signal !== 'tracking' ? '—' : rider.rpm} <small>RPM</small></span>
    </li>)}
  </ul>
}

function RoomControls({ room, hostId, connected }: { room: Room; hostId: string; connected: boolean }) {
  const [duration, setDuration] = useState(60)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = !!room.race && room.race.status !== 'finished'
  const riderCount = room.riders.filter(rider => rider.connected).length

  async function command(name: string, value?: string | number) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.command(room.code, hostId, name, value)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="control-stack">
    <section className="panel">
      <div className="panel-title"><h3>Team race</h3><span className="race-flag" aria-hidden="true" /></div>
      {active ? <button className="danger wide" disabled={busy || !connected} onClick={() => command('stopRace')}>
        {room.race?.status === 'countdown' ? 'Cancel countdown' : 'End race'}
      </button> : <>
        <fieldset className="duration-options"><legend>Race duration</legend>
          {[30, 60, 120].map(seconds => <label key={seconds}>
            <input type="radio" name="race-duration" checked={duration === seconds} onChange={() => setDuration(seconds)} />
            <span>{seconds === 120 ? '2 min' : seconds + ' sec'}</span>
          </label>)}
        </fieldset>
        <button className="primary wide" disabled={busy || !connected || riderCount < 2} onClick={() => command('startRace', duration)}>Start race</button>
        {riderCount < 2 && <p className="muted">Start with at least two connected riders.</p>}
      </>}
      {room.mode === 'demo' && !room.riders.some(rider => rider.demo) &&
        <button className="secondary wide add-demo" disabled={busy || !connected || active} onClick={() => command('addDemo')}>Add 10 demo riders</button>}
      {error && <div role="alert" className="error">{error}</div>}
    </section>
    <section className="panel reactions-panel">
      <div className="panel-title"><h3>Send a reaction</h3></div>
      <div className="emoji-grid">{reactions.map((emoji, index) =>
        <button key={emoji} disabled={busy || !connected} aria-label={'Send ' + ['fire', 'applause', 'lightning', 'strength', 'rocket', 'trophy'][index]} onClick={() => command('reaction', emoji)}>{emoji}</button>
      )}</div>
    </section>
  </div>
}

function ShareLinks({ code }: { code: string }) {
  const [copied, setCopied] = useState('')
  async function copy(event: React.MouseEvent<HTMLButtonElement>, url: string, title: string) {
    const field = event.currentTarget.parentElement?.querySelector('input')
    try {
      await navigator.clipboard.writeText(url)
      setCopied(title + ' copied')
    } catch {
      field?.focus()
      field?.select()
      setCopied('Select and copy the link')
    }
  }
  return <details className="share-links">
    <summary>Share rider and projector links</summary>
    {([{ view: 'join', title: 'Rider link' }, { view: 'display', title: 'Projector link' }] as const).map(({ view, title }) =>
      <label key={view}>{title}<span className="copy-field">
        <input readOnly value={link(view, code)} onFocus={event => event.target.select()} />
        <button type="button" className="secondary" aria-label={'Copy ' + title.toLowerCase()} onClick={event => copy(event, link(view, code), title)}>Copy</button>
      </span></label>)}
    {copied && <p className="muted" role="status">{copied}</p>}
  </details>
}

function EndClassButton({ code, hostId, connected }: { code: string; hostId: string; connected: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function endClass() {
    setBusy(true)
    setError('')
    try {
      await api.command(code, hostId, 'endClass')
      if (localStorage.getItem('last-host-class') === code) localStorage.removeItem('last-host-class')
      dialog.current?.close()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return <>
    <button className="danger" disabled={!connected} onClick={() => { setError(''); dialog.current?.showModal() }}>End class</button>
    <dialog ref={dialog} className="end-dialog" aria-labelledby="end-class-title">
      <h2 id="end-class-title">End this class?</h2>
      <p>Riders will stop sending cadence and the join code will close.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="secondary" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>Keep class open</button>
        <button className="danger" disabled={busy} onClick={endClass}>{busy ? 'Ending…' : 'Confirm end class'}</button>
      </div>
    </dialog>
  </>
}

function Reaction({ room }: { room: Room }) {
  const { reaction, serverNow } = room
  if (!reaction || serverNow - reaction.at > 3400) return null
  return <div className="reaction-pop" key={reaction.at} aria-hidden="true">{reaction.emoji}</div>
}

function HostRoom({ code }: { code: string }) {
  const { room, error, connected } = useRoom(code)
  const showRace = useRaceVisible(room)
  const hostId = localStorage.getItem('host:' + code)
  if (!hostId) return <Notice message="Open the instructor view on the tablet that created this class." />
  if (!room) return <Notice message={error || 'Connecting to the class…'} loading={!error} />
  const riderCount = room.riders.filter(rider => rider.connected).length
  const trackingCount = room.riders.filter(rider => rider.connected && rider.signal === 'tracking').length

  return <><Header /><main className="dashboard">
    <div className="workspace-head">
      <div><p className="eyebrow">INSTRUCTOR</p><h1>Studio control</h1></div>
      <div className="session-actions">
        {room.endedAt ? <a className="primary" href={route('create')}>Host another class</a> : <EndClassButton code={code} hostId={hostId} connected={connected} />}
        <a className="secondary" href={route('display', code)}>Open projector view <span aria-hidden="true">↗</span></a>
      </div>
    </div>
    <section className="session-head">
      <div>
        <p className="session-tag"><span className="live-dot" />{room.endedAt ? 'Class ended' : room.mode === 'demo' ? 'Demo class' : 'Phone motion class'}</p>
        <h2>{room.title}</h2><p>Hosted by {room.hostName}</p>
      </div>
      {!room.endedAt && <div className="hero-code"><span>CLASS CODE</span><strong>{code}</strong></div>}
    </section>
    {!connected && !room.endedAt && <p className="error" role="status">Reconnecting to the class…</p>}
    <div className="dashboard-grid">
      <div className="dashboard-main">
        {showRace && <RaceBoard room={room} scene />}
        {room.endedAt ? <section className="panel class-summary">
          <h3>Class ended</h3>
          <p>{riderCount} {riderCount === 1 ? 'rider' : 'riders'} at the close of class.</p>
        </section> : <section className="panel roster-panel">
          <div className="panel-title"><h3>Live riders</h3><span className="count-pill">{riderCount} connected</span></div>
          {room.mode === 'motion' && <p className="muted">{trackingCount} with cadence · Ask riders to enable phone motion and pedal steadily.</p>}
          <RiderList room={room} />
          <ShareLinks code={code} />
        </section>}
        {!showRace && room.race?.status === 'finished' && <details className="panel race-history">
          <summary>Last race · {raceResult(room.race)}</summary>
          <RaceBoard room={room} />
        </details>}
      </div>
      {!room.endedAt && <RoomControls room={room} hostId={hostId} connected={connected} />}
    </div>
    <Reaction room={room} />
  </main></>
}

function useRiderTelemetry(code: string, rider: { riderId: string; riderToken: string }, rpm: number, signal: MotionState) {
  const latest = useRef({ rpm, signal })
  useEffect(() => { latest.current = { rpm, signal } }, [rpm, signal])
  useEffect(() => {
    let pending = false
    async function send() {
      if (pending) return
      pending = true
      try {
        const reading = document.hidden ? { rpm: 0, signal: 'off' as const } : latest.current
        await api.telemetry(code, rider.riderId, rider.riderToken, reading.rpm, reading.signal)
      } catch {
        // The next sample retries after a temporary connection loss.
      } finally {
        pending = false
      }
    }
    void send()
    const timer = window.setInterval(send, 850)
    document.addEventListener('visibilitychange', send)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', send)
    }
  }, [code, rider.riderId, rider.riderToken])
}

function RiderControls({ room, rider, session, showRace }: { room: Room; rider: Rider; session: { riderId: string; riderToken: string }; showRace: boolean }) {
  useKeepScreenOn()
  const [demoRpm, setDemoRpm] = useState(80)
  const motion = useMotionCadence()
  const demo = room.mode === 'demo'
  useRiderTelemetry(room.code, session, demo ? demoRpm : motion.rpm, motion.signal)
  return <>
    {showRace && room.race && (rider.team || room.race.status !== 'finished') && <div className={'rider-team ' + (rider.team ?? '')}>
      {rider.team ? <><b>Team {teamNames[rider.team]}</b><span>{room.race.status === 'countdown' ? 'Get ready' : rider.revolutions.toFixed(1) + ' pedal revolutions'}</span></> : <span>You’ll join the next race.</span>}
    </div>}
    <section className="panel cadence-panel">
      <div className="cadence-label">
        <span>{demo ? 'SIMULATED CADENCE' : 'PEDAL CADENCE'}</span>
        {!demo && <span className="signal-pill" data-tracking={motion.signal === 'tracking'} role="status">{signalLabels[motion.signal]}</span>}
      </div>
      <strong>{demo ? demoRpm : motion.rpm || '—'} <small>RPM</small></strong>
      {demo ? <>
        <label htmlFor="demo-rpm">Demo effort</label>
        <input id="demo-rpm" type="range" min={0} max={150} value={demoRpm} onChange={event => setDemoRpm(Number(event.target.value))} />
      </> : <>
        {!motion.enabled && <ol className="motion-steps">
          <li>Secure your phone flat on the handlebars, facing forward.</li>
          <li>Enable motion and accept the browser prompt if it appears.</li>
          <li>Keep the page open and pedal steadily until your RPM appears.</li>
        </ol>}
        {motion.signal === 'waiting' && <p className="muted">The phone is sending motion data. Pedal steadily for a few seconds to establish a rhythm.</p>}
        {motion.signal === 'no-data' && <p className="error" role="status">No motion readings arrived. Check motion access in browser settings and keep this page visible.</p>}
        {motion.error && <p className="error" role="alert">{motion.error}</p>}
        <button className={motion.enabled ? 'secondary' : 'primary'} disabled={motion.pending} onClick={motion.enabled ? motion.disable : motion.enable}>
          {motion.pending ? 'Requesting access…' : motion.enabled ? 'Stop phone motion' : 'Enable phone motion'}
        </button>
      </>}
    </section>
  </>
}

function RiderRoom({ code }: { code: string }) {
  const { room, error, connected } = useRoom(code)
  const showRace = useRaceVisible(room)
  const stored = sessionStorage.getItem('rider:' + code)
  const session = stored ? JSON.parse(stored) as { riderId: string; riderToken: string } : null
  if (!session) return <Notice message="Join with your class code first." joinCode={code} />
  if (!room) return <Notice message={error || 'Connecting to the class…'} loading={!error} />
  const rider = room.riders.find(candidate => candidate.id === session.riderId)
  if (!rider) {
    sessionStorage.removeItem('rider:' + code)
    return <Notice message="Your rider session has ended. Join again to continue." joinCode={code} />
  }

  return <><Header code={code} /><main className="ride-shell">
    <div className="ride-title"><div><p className="eyebrow">RIDING AS {rider.name}</p><h2>{room.title}</h2></div></div>
    {!connected && !room.endedAt && <p className="error" role="status">Reconnecting to the class…</p>}
    {room.endedAt ? <section className="panel class-summary">
      <h3>Class ended</h3><p>Thanks for riding, {rider.name}.</p>
      <a className="secondary" href={route('join')}>Join another class</a>
    </section> : <RiderControls room={room} rider={rider} session={session} showRace={showRace} />}
    {showRace && <RaceBoard room={room} />}
    <Reaction room={room} />
  </main></>
}

function StudioDisplay({ code }: { code: string }) {
  useKeepScreenOn()
  const { room, error, connected } = useRoom(code)
  const showRace = useRaceVisible(room)
  const hostId = localStorage.getItem('host:' + code)
  const [controls, setControls] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [displayError, setDisplayError] = useState('')
  useEffect(() => {
    function update() { setFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  async function toggleFullscreen() {
    setDisplayError('')
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      setDisplayError('Use your browser or projector’s fullscreen mode on this device.')
    }
  }

  if (!room) return <Notice message={error || 'Connecting to the class…'} loading={!error} />

  return <main className="studio">
    <header className="studio-bar">
      <Logo />
      <div className="studio-actions">
        <button className="secondary" onClick={toggleFullscreen}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
        {hostId && !room.endedAt && <button className="secondary" aria-expanded={controls} onClick={() => setControls(!controls)}>{controls ? 'Hide controls' : 'Instructor controls'}</button>}
      </div>
    </header>
    <div className={'studio-title' + (!showRace ? ' studio-lobby' : '')}>
      <div><p className="eyebrow">{room.endedAt ? 'CLASS ENDED' : room.mode === 'demo' ? 'DEMO CLASS' : 'LIVE CLASS'}</p><h1>{room.title}</h1>
        {!showRace && !room.endedAt && <p className="studio-coach">Led by {room.hostName}</p>}
      </div>
      {!room.endedAt && <div className="studio-code"><span>JOIN CODE</span><strong>{code}</strong></div>}
    </div>
    {!connected && !room.endedAt && <p className="error" role="status">Reconnecting to the class…</p>}
    {displayError && <p role="status">{displayError}</p>}
    {showRace && <RaceBoard room={room} scene />}
    {room.endedAt && !showRace && <section className="panel class-summary"><h2>Thanks for riding</h2></section>}
    {!room.endedAt && !showRace && <section className="panel studio-roster">
      <div className="panel-title"><h3>Live riders</h3><span>{room.riders.filter(rider => rider.connected).length} connected</span></div>
      <RiderList room={room} />
    </section>}
    {controls && hostId && !room.endedAt && <aside className="studio-controls">
      <a className="secondary" href={route('host', code)}>Back to instructor dashboard</a>
      <RoomControls room={room} hostId={hostId} connected={connected} />
      <EndClassButton code={code} hostId={hostId} connected={connected} />
    </aside>}
    <Reaction room={room} />
  </main>
}

function Notice({ message, loading = false, joinCode }: { message: string; loading?: boolean; joinCode?: string }) {
  return <><Header /><main className="center">
    <p role="status">{message}</p>
    {!loading && <a className="primary" href={joinCode ? route('join', joinCode) : route('home')}>{joinCode ? 'Join class' : 'Back home'}</a>}
  </main></>
}

export default function App() {
  const [{ view, code }, setRoute] = useState(getRoute)
  useEffect(() => {
    function update() { setRoute(getRoute()) }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  if (view === 'home') return <Home />
  if (view === 'create') return <CreateRoom />
  if (view === 'join') return <JoinRoom key={code} initialCode={code} />
  if (!code) return <Notice message="This screen needs a class code." />
  if (view === 'host') return <HostRoom key={code} code={code} />
  if (view === 'ride') return <RiderRoom key={code} code={code} />
  if (view === 'display') return <StudioDisplay key={code} code={code} />
  return <Notice message="That screen is unavailable." />
}
