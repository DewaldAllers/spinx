import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, subscribeToRoom } from './api'
import { useMotionCadence } from './cadence'
import type { Mode, Race, Rider, Room, TeamId } from './types'

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
    api.getRoom(code).then(() => {
      if (active) setResumeCode(code)
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
      <div className="hero-visual" aria-hidden="true">
        <div className="glow" />
        <div className="live-card">
          <div className="panel-title"><h3>Team race</h3><span>DEMO</span></div>
          <div className="sample-track volt"><b>Volt</b><span>46.8</span></div>
          <div className="sample-track flare"><b>Flare</b><span>43.2</span></div>
          <p className="muted">Average pedal revolutions per rider</p>
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

function RaceBoard({ room }: { room: Room }) {
  const race = room.race
  if (!race) return null
  const maxScore = Math.max(1, ...race.teams.map(team => team.score))
  return <section className="race-board">
    <div className="race-heading">
      <div><p className="eyebrow">TEAM RACE</p><h2>{race.status === 'finished' ? raceResult(race) : race.status === 'countdown' ? 'Get ready' : 'Race in progress'}</h2></div>
      {race.status !== 'finished' && <div className="display-clock"><b>{timeLeft(race, room.serverNow)}</b><span>SECONDS</span></div>}
    </div>
    <div className="team-grid">
      {race.teams.map(team => <div className={'team-card ' + team.id} key={team.id}>
        <div className="team-title"><h3>{teamNames[team.id]}</h3><span>{team.size} {team.size === 1 ? 'rider' : 'riders'}</span></div>
        <strong>{team.score.toFixed(1)}</strong>
        <div className="team-track" aria-hidden="true"><i style={{ width: team.score / maxScore * 100 + '%' }} /></div>
      </div>)}
    </div>
    <p className="score-note">Average pedal revolutions per rider</p>
  </section>
}

function RiderList({ room, highlight }: { room: Room; highlight?: string }) {
  const raceInProgress = room.race && room.race.status !== 'finished'
  const riders = room.riders.filter(rider => rider.connected || (raceInProgress && rider.team))
    .sort((a, b) => Number(b.connected) - Number(a.connected) || b.rpm - a.rpm)
  if (!riders.length) return <p className="empty-room">Waiting for riders to join with class code <b>{room.code}</b>.</p>

  return <ul className="rider-grid">
    {riders.map(rider => <li className={'rider-tile' + (rider.id === highlight ? ' current' : '')} key={rider.id}>
      <span className="avatar" style={{ background: rider.color }}>{rider.name.split(/\s+/).slice(0, 2).map(part => part[0].toUpperCase()).join('')}</span>
      <span className="rider-name"><b>{rider.name}</b><small className={raceInProgress ? rider.team ?? '' : ''}>
        {!rider.connected ? 'Disconnected' : raceInProgress && rider.team ? teamNames[rider.team] : rider.demo ? 'Simulated' : 'Connected'}
      </small></span>
      <span className="rider-rpm">{rider.rpm} <small>RPM</small></span>
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
      <div className="panel-title"><h3>Team race</h3></div>
      {active ? <button className="danger wide" disabled={busy || !connected} onClick={() => command('stopRace')}>End race</button> : <>
        <label className="duration-label">Race duration<select value={duration} onChange={event => setDuration(Number(event.target.value))}>
          <option value={30}>30 seconds</option><option value={60}>60 seconds</option><option value={120}>2 minutes</option>
        </select></label>
        <button className="primary wide" disabled={busy || !connected || riderCount < 2} onClick={() => command('startRace', duration)}>Start race</button>
        {riderCount < 2 && <p className="muted">Start with at least two connected riders.</p>}
      </>}
      {room.mode === 'demo' && !room.riders.some(rider => rider.demo) &&
        <button className="secondary wide add-demo" disabled={busy || !connected || active} onClick={() => command('addDemo')}>Add 10 demo riders</button>}
      {error && <div role="alert" className="error">{error}</div>}
    </section>
    <section className="panel">
      <div className="panel-title"><h3>Send a reaction</h3></div>
      <div className="emoji-grid">{reactions.map((emoji, index) =>
        <button key={emoji} disabled={busy || !connected} aria-label={'Send ' + ['fire', 'applause', 'lightning', 'strength', 'rocket', 'trophy'][index]} onClick={() => command('reaction', emoji)}>{emoji}</button>
      )}</div>
    </section>
  </div>
}

function ShareLinks({ code }: { code: string }) {
  return <details className="share-links">
    <summary>Share class and display links</summary>
    <label>Rider link<input readOnly value={link('join', code)} onFocus={event => event.target.select()} /></label>
    <label>Projector link<input readOnly value={link('display', code)} onFocus={event => event.target.select()} /></label>
  </details>
}

function Reaction({ room }: { room: Room }) {
  const { reaction, serverNow } = room
  if (!reaction || serverNow - reaction.at > 3400) return null
  return <div className="reaction-pop" key={reaction.at} aria-hidden="true">{reaction.emoji}</div>
}

function HostRoom({ code }: { code: string }) {
  const { room, error, connected } = useRoom(code)
  const hostId = localStorage.getItem('host:' + code)
  if (!hostId) return <Notice message="Open the instructor view on the tablet that created this class." />
  if (!room) return <Notice message={error || 'Connecting to the class…'} loading={!error} />

  return <><Header code={code} /><main className="dashboard">
    <section className="session-head">
      <div><p className="eyebrow">{room.mode === 'demo' ? 'INSTRUCTOR · DEMO' : 'INSTRUCTOR · PHONE MOTION'}</p><h2>{room.title}</h2><p>Hosted by {room.hostName}</p></div>
      <div className="session-actions"><a className="primary" href={route('display', code)}>Open studio display</a></div>
    </section>
    {!connected && <p className="error" role="status">Reconnecting to the class…</p>}
    <div className="dashboard-grid">
      <div>
        <section className="panel">
          <div className="panel-title"><h3>Class code</h3><strong className="join-code">{code}</strong></div>
          <ShareLinks code={code} />
        </section>
        <RaceBoard room={room} />
        <section className="panel roster-panel">
          <div className="panel-title"><h3>Live riders</h3><span>{room.riders.filter(rider => rider.connected).length} connected</span></div>
          <RiderList room={room} />
        </section>
      </div>
      <RoomControls room={room} hostId={hostId} connected={connected} />
    </div>
    <Reaction room={room} />
  </main></>
}

function useRiderTelemetry(code: string, rider: { riderId: string; riderToken: string }, rpm: number) {
  const latest = useRef(rpm)
  useEffect(() => { latest.current = rpm }, [rpm])
  useEffect(() => {
    let pending = false
    async function send() {
      if (pending) return
      pending = true
      try {
        await api.telemetry(code, rider.riderId, rider.riderToken, document.hidden ? 0 : latest.current)
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

function RiderControls({ room, rider, session }: { room: Room; rider: Rider; session: { riderId: string; riderToken: string } }) {
  useKeepScreenOn()
  const [demoRpm, setDemoRpm] = useState(80)
  const motion = useMotionCadence()
  useRiderTelemetry(room.code, session, room.mode === 'demo' ? demoRpm : motion.rpm)
  return <>
    <section className="panel cadence-panel">
      <span>{room.mode === 'demo' ? 'SIMULATED CADENCE' : 'ESTIMATED CADENCE'}</span>
      <strong>{rider.rpm} <small>RPM</small></strong>
      {room.mode === 'demo' ? <>
        <label htmlFor="demo-rpm">Demo effort</label>
        <input id="demo-rpm" type="range" min={0} max={150} value={demoRpm} onChange={event => setDemoRpm(Number(event.target.value))} />
      </> : <>
        <p className="muted">Secure your phone flat on the handlebars, facing forward. Keep this page open during the ride.</p>
        <button className="secondary" onClick={motion.enabled ? motion.disable : motion.enable}>{motion.enabled ? 'Stop phone motion' : 'Enable phone motion'}</button>
        {motion.message && <p className="muted" role="status">{motion.message}</p>}
      </>}
    </section>
    {room.race && <div className="rider-team">
      {rider.team ? <><b className={rider.team}>Team {teamNames[rider.team]}</b><span>{rider.revolutions.toFixed(1)} pedal revolutions</span></> : <span>You’ll join the next race.</span>}
    </div>}
  </>
}

function RiderRoom({ code }: { code: string }) {
  const { room, error, connected } = useRoom(code)
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
    {!connected && <p className="error" role="status">Reconnecting to the class…</p>}
    <RiderControls room={room} rider={rider} session={session} />
    <RaceBoard room={room} />
    <Reaction room={room} />
  </main></>
}

function StudioDisplay({ code }: { code: string }) {
  useKeepScreenOn()
  const { room, error, connected } = useRoom(code)
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
        {hostId && <button className="secondary" aria-expanded={controls} onClick={() => setControls(!controls)}>{controls ? 'Hide controls' : 'Instructor controls'}</button>}
      </div>
    </header>
    <div className="studio-title">
      <div><p className="eyebrow">{room.mode === 'demo' ? 'DEMO CLASS' : 'LIVE CLASS'}</p><h1>{room.title}</h1></div>
      <div className="studio-code"><span>JOIN CODE</span><strong>{code}</strong></div>
    </div>
    {!connected && <p className="error" role="status">Reconnecting to the class…</p>}
    {displayError && <p role="status">{displayError}</p>}
    <RaceBoard room={room} />
    {(!room.race || room.race.status === 'finished') && <section className="panel studio-roster">
      <div className="panel-title"><h3>Live riders</h3><span>{room.riders.filter(rider => rider.connected).length} connected</span></div>
      <RiderList room={room} />
    </section>}
    {controls && hostId && <aside className="studio-controls">
      <a className="secondary" href={route('host', code)}>Back to instructor dashboard</a>
      <RoomControls room={room} hostId={hostId} connected={connected} />
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
