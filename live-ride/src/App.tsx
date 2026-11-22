import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { api, subscribeToRoom } from './api'
import { cadenceStatus, useMotionCadence } from './cadence'
import { DefenseBoard } from './DefenseBoard'
import { RaceVelodrome } from './RaceVelodrome'
import { InstructorComments, RiderSocial } from './RiderSocial'
import type { ClassSession, CommandValue, DefenseDifficulty, Mode, MotionState, Race, Rider, RiderSession, Room, TeamId, TimedActivity } from './types'

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
      <p className="muted">{mode === 'demo' ? 'Try the games with simulated riders or invite people to join and set their demo RPM.' : 'Riders must open the HTTPS link and mount their phones securely on the handlebars.'}</p>
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
      setRoom(previous => {
        if (!previous || snapshot.mode !== 'motion' || snapshot.endedAt) return snapshot
        const oldRiders = new Map(previous.riders.map(rider => [rider.id, rider]))
        const riders = snapshot.riders.map(rider => {
          if (!rider.connected || rider.signal !== 'waiting') return rider
          const last = oldRiders.get(rider.id)
          const lastCadence = last?.rpm || last?.lastCadence
          return lastCadence ? { ...rider, lastCadence } : rider
        })
        return { ...snapshot, riders }
      })
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

function useActivityVisible(activity: TimedActivity | null | undefined, serverNow = 0) {
  const [dismissed, setDismissed] = useState<number>()
  const startsAt = activity?.startsAt
  const visibleFor = activity?.status === 'finished'
    ? Math.max(0, Math.min(8000, (activity.finishedAt ?? activity.endsAt) + 8000 - serverNow))
    : undefined
  useEffect(() => {
    if (visibleFor === undefined || visibleFor === 0 || dismissed === startsAt) return
    const timer = window.setTimeout(() => setDismissed(startsAt), visibleFor)
    return () => window.clearTimeout(timer)
  }, [startsAt, visibleFor, dismissed])
  return !!activity && (activity.status !== 'finished' || (visibleFor !== 0 && dismissed !== startsAt))
}

function useVisibleGames(room: Room | null) {
  const race = useActivityVisible(room?.race, room?.serverNow) ? room?.race : null
  const defense = useActivityVisible(room?.defense, room?.serverNow) ? room?.defense : null
  const showDefense = defense && (!race || defense.startsAt > race.startsAt) ? defense : null
  return { showRace: !!race && !showDefense, showDefense }
}

function RaceBoard({ room, scene = false, projector = false }: { room: Room; scene?: boolean; projector?: boolean }) {
  const race = room.race
  if (!race) return null
  const maxScore = Math.max(1, ...race.teams.map(team => team.score))
  const liveCadence = (team: TeamId) => {
    const size = race.teams.find(entry => entry.id === team)?.size ?? 1
    const total = room.riders.reduce((sum, rider) => sum + (rider.team === team ? rider.rpm : 0), 0)
    return Math.round(total / size)
  }
  const cadence = { volt: liveCadence('volt'), flare: liveCadence('flare') }
  const [first, second] = [...race.teams].sort((a, b) => b.score - a.score)
  const lead = first && second ? first.score - second.score : 0
  return <section className={'race-board' + (projector ? ' projector-stage' : '')}>
    <div className="race-heading">
      <div>
        {!projector && <p className="eyebrow">TEAM RACE</p>}
        <h2>{race.status === 'finished' ? raceResult(race) : race.status === 'countdown' ? 'Get ready' : 'Race in progress'}</h2>
        {race.status === 'running' && <p className="race-lead">
          {lead > 0 ? <><b className={first.id}>{teamNames[first.id]}</b> leads by {lead.toFixed(1)} turns per rider</> : 'Teams are level'}
        </p>}
      </div>
      {race.status !== 'finished' && <div className="display-clock"><b>{timeLeft(race, room.serverNow)}</b><span>SECONDS</span></div>}
    </div>
    {scene && <RaceVelodrome race={race} serverNow={room.serverNow} cadence={cadence} />}
    <div className="team-grid">
      {race.teams.map(team => <div className={'team-card ' + team.id} key={team.id} data-winner={race.winner === team.id || undefined}>
        <div className="team-title"><h3>{teamNames[team.id]}</h3>{!projector && <span>{team.size} {team.size === 1 ? 'rider' : 'riders'}</span>}</div>
        <div className="team-score">
          <div><strong>{team.score.toFixed(1)}</strong><small>turns per rider</small></div>
          {race.status === 'running' && <span>{cadence[team.id]} <small>RPM now</small></span>}
        </div>
        {!scene && <div className="team-track" aria-hidden="true"><i style={{ width: team.score / maxScore * 100 + '%' }} /></div>}
      </div>)}
    </div>
    {!projector && <p className="score-note">One turn is one full pedal revolution. The team with more turns per rider wins.</p>}
  </section>
}

function RiderList({ room }: { room: Room }) {
  const raceInProgress = room.race && room.race.status !== 'finished'
  const riders = room.riders.filter(rider => rider.connected || (raceInProgress && rider.team))
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (!riders.length) return <div className="empty-room"><span aria-hidden="true">+</span><b>Waiting for riders</b><p>Share class code <strong>{room.code}</strong> to get everyone on the board.</p></div>

  return <ul className="rider-grid">
    {riders.map(rider => {
      const rpm = room.mode === 'demo' || rider.signal === 'tracking' ? rider.rpm : rider.lastCadence ?? null
      const status = room.mode === 'motion'
        ? cadenceStatus(rider.signal === 'demo' ? 'off' : rider.signal, rpm)
        : rider.demo ? 'Simulated' : 'Demo input'
      return <li className="rider-tile" key={rider.id}>
        <span className="avatar" style={{ background: rider.color }}>{rider.name.split(/\s+/).slice(0, 2).map(part => part[0].toUpperCase()).join('')}</span>
        <span className="rider-name"><b>{rider.name}</b><small className={raceInProgress ? rider.team ?? '' : ''}>
          {rider.connected ? status : 'Disconnected'}
          {rider.connected && raceInProgress && rider.team && ' · ' + teamNames[rider.team]}
        </small></span>
        <span className="rider-rpm">{rpm ?? '—'} <small>RPM</small></span>
      </li>
    })}
  </ul>
}

function RoomControls({ room, hostId, connected }: { room: Room; hostId: string; connected: boolean }) {
  const [game, setGame] = useState<'race' | 'defense'>('race')
  const [duration, setDuration] = useState(60)
  const [difficulty, setDifficulty] = useState<DefenseDifficulty>('medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const race = room.race && room.race.status !== 'finished' ? room.race : null
  const defense = room.defense && room.defense.status !== 'finished' ? room.defense : null
  const active = defense ?? race
  const canChooseGame = room.defense !== undefined
  const selectedGame = defense ? 'defense' : race || !canChooseGame ? 'race' : game
  const isDefense = selectedGame === 'defense'
  const difficulties = room.defenseDifficulties
  const riderCount = room.riders.filter(rider => rider.connected).length
  const minRiders = isDefense ? 1 : 2
  const demoSpots = Math.max(0, (room.riderLimit ?? 8) - riderCount)

  async function command(name: string, value?: CommandValue) {
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
      <div className="panel-title"><h3>{canChooseGame ? 'Games' : 'Team race'}</h3><span className="race-flag" aria-hidden="true" /></div>
      {canChooseGame && <label className="game-option">Game
        <select value={selectedGame} disabled={!!active || busy} onChange={event => setGame(event.target.value === 'defense' ? 'defense' : 'race')}>
          <option value="race">Team race</option>
          <option value="defense">Orbit Defense</option>
        </select>
      </label>}
      {active ? <button className="danger wide" disabled={busy || !connected} onClick={() => command(isDefense ? 'stopDefense' : 'stopRace')}>
        {active.status === 'countdown' ? 'Cancel countdown' : isDefense ? 'End round' : 'End race'}
      </button> : <>
        {isDefense && <p className="game-instructions">Pedal together to fire faster. Keep the shields up until time runs out.</p>}
        {isDefense && !!difficulties?.length && <label className="game-option">Difficulty
          <select value={difficulty} disabled={busy} onChange={event => {
            const selected = difficulties.find(level => level === event.target.value)
            if (selected) setDifficulty(selected)
          }}>
            {difficulties.map(level => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}
          </select>
        </label>}
        <fieldset className="duration-options"><legend>{isDefense ? 'Round duration' : 'Race duration'}</legend>
          {[30, 60, 120].map(seconds => <label key={seconds}>
            <input type="radio" name="game-duration" checked={duration === seconds} onChange={() => setDuration(seconds)} />
            <span>{seconds === 120 ? '2 min' : seconds + ' sec'}</span>
          </label>)}
        </fieldset>
        <button className="primary wide" disabled={busy || !connected || riderCount < minRiders} onClick={() =>
          command(isDefense ? 'startDefense' : 'startRace', isDefense && difficulties?.length ? { duration, difficulty } : duration)}>
          {isDefense ? 'Start Orbit Defense' : 'Start race'}
        </button>
        {riderCount < minRiders && <p className="muted">{isDefense ? 'Start with at least one connected rider.' : 'Start with at least two connected riders.'}</p>}
      </>}
      {room.mode === 'demo' && demoSpots > 0 &&
        <button className="secondary wide add-demo" disabled={busy || !connected || !!active} onClick={() => command('addDemo')}>
          Add {demoSpots} demo {demoSpots === 1 ? 'rider' : 'riders'}
        </button>}
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
  return <div className="reaction-pop" key={reaction.at} aria-hidden="true">{reaction.emoji}{reaction.name && <small>{reaction.name}</small>}</div>
}

function HostRoom({ code }: { code: string }) {
  const { room, error, connected } = useRoom(code)
  const { showRace, showDefense } = useVisibleGames(room)
  const hostId = localStorage.getItem('host:' + code)
  if (!hostId) return <Notice message="Open the instructor view on the device that created this class." />
  if (!room) return <Notice message={error || 'Connecting to the class…'} loading={!error} />
  const riderCount = room.riders.filter(rider => rider.connected).length
  const trackingCount = room.riders.filter(rider => rider.connected && rider.signal === 'tracking' && rider.rpm > 0).length

  return <><Header /><main className="dashboard">
    <div className="workspace-head">
      <div><p className="eyebrow">INSTRUCTOR</p><h1>Studio control</h1></div>
      <div className="session-actions">
        {room.endedAt ? <a className="primary" href={route('create')}>Host another class</a> : <EndClassButton code={code} hostId={hostId} connected={connected} />}
        <a className="secondary" href={route('display', code)} target="_blank" rel="noopener">Open projector view <span aria-hidden="true">↗</span></a>
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
        {showDefense && <DefenseBoard round={showDefense} serverNow={room.serverNow} scene />}
        {room.endedAt ? <section className="panel class-summary">
          <h3>Class ended</h3>
          <p>{riderCount} {riderCount === 1 ? 'rider' : 'riders'} at the close of class.</p>
        </section> : <section className="panel roster-panel">
          <div className="panel-title"><h3>Live riders</h3><span className="count-pill">{riderCount} / {room.riderLimit ?? 8} riders</span></div>
          {room.mode === 'motion' && <p className="muted">{trackingCount} with live cadence · Riders can enable phone motion before or during class.</p>}
          <RiderList room={room} />
          <ShareLinks code={code} />
        </section>}
        {!showRace && room.race?.status === 'finished' && <details className="panel race-history">
          <summary>Last race · {raceResult(room.race)}</summary>
          <RaceBoard room={room} />
        </details>}
        {(!room.endedAt || !!room.comments?.length) && <InstructorComments room={room} hostId={hostId} connected={connected} />}
      </div>
      {!room.endedAt && <aside className="host-side">
        <RoomControls room={room} hostId={hostId} connected={connected} />
        <InstructorCadence room={room} hostId={hostId} />
      </aside>}
    </div>
    <Reaction room={room} />
  </main></>
}

function useCadenceBroadcast(code: string, session: ClassSession, rpm: number, signal: MotionState) {
  const latest = useRef({ rpm, signal })
  const hostId = 'hostId' in session ? session.hostId : undefined
  const riderId = 'riderId' in session ? session.riderId : undefined
  const riderToken = 'riderToken' in session ? session.riderToken : undefined
  useEffect(() => { latest.current = { rpm, signal } }, [rpm, signal])
  useEffect(() => {
    const credentials = hostId ? { hostId } : riderId && riderToken ? { riderId, riderToken } : null
    if (!credentials) return
    let pending = false
    let lastSignal: MotionState | undefined
    async function send() {
      if (pending || !credentials) return
      const reading = document.hidden ? { rpm: 0, signal: 'off' as const } : latest.current
      if (hostId && reading.signal === 'off' && (lastSignal === 'off' || lastSignal === undefined)) return
      pending = true
      try {
        await api.telemetry(code, credentials, reading.rpm, reading.signal)
        lastSignal = reading.signal
      } catch {
        // The next sample retries after a temporary connection loss.
      } finally {
        pending = false
      }
    }
    void send()
    const timer = window.setInterval(send, 650)
    document.addEventListener('visibilitychange', send)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', send)
    }
  }, [code, hostId, riderId, riderToken])
}

function InstructorCadence({ room, hostId }: { room: Room; hostId: string }) {
  const motion = useMotionCadence()
  const [demoOn, setDemoOn] = useState(false)
  const [demoRpm, setDemoRpm] = useState(82)
  const demo = room.mode === 'demo'
  const signal = demo ? (demoOn ? 'tracking' : 'off') : motion.signal
  const rpm = demo ? (demoOn ? demoRpm : null) : motion.rpm
  useCadenceBroadcast(room.code, { hostId }, signal === 'tracking' ? rpm ?? 0 : 0, signal)
  return <section className="panel instructor-cadence">
    <div className="panel-title"><h3>My cadence</h3><span className="count-pill">Instructor</span></div>
    <strong>{rpm ?? '—'} <small>RPM</small></strong>
    {demo && demoOn && <label>Demo cadence<input type="range" min={0} max={150} value={demoRpm} onChange={event => setDemoRpm(Number(event.target.value))} /></label>}
    {motion.error && <p className="error" role="alert">{motion.error}</p>}
    {motion.signal === 'no-data' && <p className="muted">No readings arrived. Check motion access on this device.</p>}
    <button className="secondary" disabled={motion.pending} onClick={demo ? () => setDemoOn(!demoOn) : motion.enabled ? motion.disable : motion.enable}>
      {demo ? (demoOn ? 'Stop demo cadence' : 'Show demo cadence') : motion.enabled ? 'Stop phone motion' : 'Enable my phone motion'}
    </button>
  </section>
}

function RiderControls({ room, rider, session, showRace }: { room: Room; rider: Rider; session: RiderSession; showRace: boolean }) {
  useKeepScreenOn()
  const [demoRpm, setDemoRpm] = useState(80)
  const [peak, setPeak] = useState(0)
  const motion = useMotionCadence()
  const demo = room.mode === 'demo'
  const cadence = demo ? demoRpm : motion.rpm
  const measured = demo ? demoRpm : motion.signal === 'tracking' ? motion.rpm ?? 0 : 0
  const pace = cadence === null ? 'Ready' : cadence === 0 ? 'Paused' : cadence < 60 ? 'Easy' : cadence < 90 ? 'Steady' : cadence < 110 ? 'Fast' : 'Sprint'
  const classRiders = room.riders.filter(other => other.id !== rider.id && other.connected && other.rpm > 0 && (demo || other.signal === 'tracking'))
  const classPace = classRiders.length ? Math.round(classRiders.reduce((sum, other) => sum + other.rpm, 0) / classRiders.length) : null
  useEffect(() => { setPeak(previous => Math.max(previous, measured)) }, [measured])
  useCadenceBroadcast(room.code, session, measured, motion.signal)
  return <>
    {showRace && room.race && (rider.team || room.race.status !== 'finished') && <div className={'rider-team ' + (rider.team ?? '')}>
      {rider.team ? <><b>Team {teamNames[rider.team]}</b><span>{room.race.status === 'countdown' ? 'Get ready' : rider.revolutions.toFixed(1) + ' pedal revolutions'}</span></> : <span>You’ll join the next race.</span>}
    </div>}
    <section className="panel cadence-panel">
      <div className="cadence-label">
        <span>YOUR CADENCE</span>
        {demo && <span className="count-pill">Demo</span>}
      </div>
      <div className="cadence-gauge" style={{ '--cadence-fill': Math.min(150, cadence ?? 0) / 150 * 265 + 'deg' } as CSSProperties}>
        <div className="cadence-value">
          <strong>{cadence ?? '—'}</strong>
          <span>RPM</span>
          <div className="cadence-pace" data-moving={measured > 0 || undefined}>
            <span className="cadence-beat" aria-hidden="true"><i /><i /><i /><i /></span>
            {pace}
          </div>
        </div>
      </div>
      <dl className="cadence-metrics">
        <div><dt>My peak</dt><dd>{peak || '—'} <small>RPM</small></dd></div>
        <div><dt>Other riders’ average</dt><dd>{classPace ?? '—'} <small>RPM</small></dd></div>
      </dl>
      {demo ? <>
        <label htmlFor="demo-rpm">Demo effort</label>
        <input id="demo-rpm" type="range" min={0} max={150} value={demoRpm} onChange={event => setDemoRpm(Number(event.target.value))} />
      </> : <>
        {motion.signal === 'no-data' && <p className="error" role="status">No motion readings arrived. Check motion access in browser settings and keep this page visible.</p>}
        {motion.error && <p className="error" role="alert">{motion.error}</p>}
        <div className="ride-motion-action">
          {!motion.enabled && <p className="muted">Secure your phone flat on the handlebars and keep this screen open.</p>}
          <button className={motion.enabled ? 'secondary' : 'primary'} disabled={motion.pending} onClick={motion.enabled ? motion.disable : motion.enable}>
            {motion.pending ? 'Requesting access…' : motion.enabled ? 'Stop phone motion' : 'Enable phone motion'}
          </button>
        </div>
      </>}
    </section>
  </>
}

function RiderRoom({ code }: { code: string }) {
  const { room, error, connected } = useRoom(code)
  const { showRace, showDefense } = useVisibleGames(room)
  const stored = sessionStorage.getItem('rider:' + code)
  const session = stored ? JSON.parse(stored) as RiderSession : null
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
    </section> : <>
      <RiderControls room={room} rider={rider} session={session} showRace={showRace} />
      <RiderSocial room={room} session={session} connected={connected} />
    </>}
    {showRace && <RaceBoard room={room} />}
    {showDefense && <DefenseBoard round={showDefense} serverNow={room.serverNow} />}
    <Reaction room={room} />
  </main></>
}

function ProjectorCadence({ room }: { room: Room }) {
  const riders = room.riders.filter(rider => rider.connected).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const duringRace = room.race && room.race.status !== 'finished'
  return <section className="panel studio-roster">
    <div className="panel-title"><h2>Live cadence</h2><span className="count-pill">{riders.length + 1} / {(room.riderLimit ?? 8) + 1}</span></div>
    <ul className="projector-riders">
      <li className="projector-instructor">
        <span className="projector-name"><b>{room.hostName}</b><small>Instructor</small></span>
        <span className="projector-rpm">{room.instructorCadence?.rpm ?? '—'} <small>RPM</small></span>
      </li>
      {riders.map(rider => <li key={rider.id} style={{ borderLeftColor: rider.color }}>
        <span className="projector-name"><b>{rider.name}</b>
          {duringRace && rider.team && <small className={rider.team}>{teamNames[rider.team]}</small>}
        </span>
        <span className="projector-rpm">{(room.mode === 'demo' || rider.signal === 'tracking' ? rider.rpm : rider.lastCadence) ?? '—'} <small>RPM</small></span>
      </li>)}
    </ul>
  </section>
}

async function toggleProjectorFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else if (document.fullscreenEnabled) await document.documentElement.requestFullscreen()
  } catch {
    // Browser fullscreen may be unavailable when embedded.
  }
}

function StudioDisplay({ code }: { code: string }) {
  useKeepScreenOn()
  const { room, error, connected } = useRoom(code)
  const { showRace, showDefense } = useVisibleGames(room)
  const showGame = showRace || !!showDefense
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'f' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        void toggleProjectorFullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!room) return <main className="studio center"><Logo /><p role="status">{error ? 'Class unavailable' : 'Connecting to class…'}</p></main>

  return <main className={'studio' + (showGame ? ' studio-race-active' : '')} onDoubleClick={toggleProjectorFullscreen}>
    <header className="studio-bar">
      <Logo />
      {showGame && <h1 className="studio-race-title">{room.title}</h1>}
      {!connected && !room.endedAt && <span className="count-pill" role="status">Connection interrupted</span>}
    </header>
    {!showGame && <div className="studio-title studio-lobby">
      <div><p className="eyebrow">{room.endedAt ? 'CLASS ENDED' : room.mode === 'demo' ? 'DEMO CLASS' : 'LIVE CLASS'}</p><h1>{room.title}</h1>
        {!room.endedAt && <p className="studio-coach">Led by {room.hostName}</p>}
      </div>
    </div>}
    <div className={'projector-content' + (showGame && !room.endedAt ? ' projector-racing' : '')}>
      {showRace && <RaceBoard room={room} scene projector />}
      {showDefense && <DefenseBoard round={showDefense} serverNow={room.serverNow} scene projector />}
      {!room.endedAt && <ProjectorCadence room={room} />}
    </div>
    {room.endedAt && !showGame && <section className="panel class-summary"><h2>Thanks for riding</h2></section>}
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
