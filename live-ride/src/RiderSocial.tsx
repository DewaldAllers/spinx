import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import type { ClassComment, ClassSession, RiderSession, Room } from './types'

const cheers = [
  { emoji: '👏', label: 'Applause' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '⚡', label: 'Lightning' },
  { emoji: '💪', label: 'Strength' },
]
const noComments: ClassComment[] = []

export function ClassComments({ comments = noComments, riderId }: { comments?: ClassComment[]; riderId?: string }) {
  const list = useRef<HTMLUListElement>(null)
  const follow = useRef(true)
  const newest = comments.at(-1)?.id
  useEffect(() => {
    if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [newest])

  if (!comments.length) return <p className="social-empty">No comments yet.</p>
  return <ul ref={list} className="class-comments" role="log" aria-label="Class comments" onScroll={event => {
    const element = event.currentTarget
    follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 28
  }}>
    {comments.map(item => <li key={item.id} data-own={item.riderId === riderId || undefined}>
      <b>{item.riderId === riderId ? 'You' : item.name}{item.riderId === 'instructor' && <small className="comment-role">Instructor</small>}</b>
      <p>{item.content}</p>
    </li>)}
  </ul>
}

function useClassActivity(code: string, session: ClassSession, connected: boolean) {
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  async function post(kind: 'comment' | 'reaction', value: string) {
    if (posting || !connected) return false
    setPosting(true)
    setError('')
    try {
      await api.postActivity(code, session, kind, value)
      return true
    } catch (failure) {
      setError((failure as Error).message)
      return false
    } finally {
      setPosting(false)
    }
  }
  return { post, posting, error }
}

function CommentComposer({ busy, connected, send }: { busy: boolean; connected: boolean; send: (value: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.trim() && await send(draft.trim())) setDraft('')
  }
  return <form className="class-comment-form" onSubmit={submit}>
    <input type="text" aria-label="Comment to class" placeholder="Message the class" value={draft} maxLength={160} readOnly={busy} onChange={event => setDraft(event.target.value)} />
    <button type="submit" className="primary" disabled={busy || !connected || !draft.trim()}>Send</button>
  </form>
}

export function InstructorComments({ room, hostId, connected }: { room: Room; hostId: string; connected: boolean }) {
  const { post, posting, error } = useClassActivity(room.code, { hostId }, connected)
  return <section className="panel host-comments">
    <div className="panel-title"><h3>Class comments</h3></div>
    <ClassComments comments={room.comments} riderId="instructor" />
    {!room.endedAt && <CommentComposer busy={posting} connected={connected} send={value => post('comment', value)} />}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}

export function RiderSocial({ room, session, connected }: {
  room: Room
  session: RiderSession
  connected: boolean
}) {
  const [view, setView] = useState<'riders' | 'comments'>('riders')
  const { post, posting, error } = useClassActivity(room.code, session, connected)
  const [lastRead, setLastRead] = useState<string>()
  const comments = room.comments ?? noComments
  const newest = comments.at(-1)?.id
  const riders = room.riders.filter(rider => rider.connected)
  const roster = riders.map(rider => {
    const live = room.mode === 'demo' || rider.signal === 'tracking'
    return { ...rider, reading: live ? rider.rpm : rider.lastCadence, live }
  }).sort((a, b) => Number(b.live) - Number(a.live) || (b.reading ?? 0) - (a.reading ?? 0) || a.name.localeCompare(b.name))

  useEffect(() => {
    if (view === 'comments') setLastRead(newest)
  }, [view, newest])

  return <section className="rider-social">
    <div className="ride-social-top">
      <div className="social-navigation" aria-label="Class activity">
        <button type="button" aria-pressed={view === 'riders'} onClick={() => setView('riders')}>Riders <span>{riders.length}</span></button>
        <button type="button" aria-pressed={view === 'comments'} onClick={() => setView('comments')}>
          Comments{newest && newest !== lastRead && view !== 'comments' && <span className="comment-dot" aria-label="New comments" />}
        </button>
      </div>
      <div className="ride-cheers" role="group" aria-label="Cheer for the class">
        {cheers.map(({ emoji, label }) => <button key={label} type="button" aria-label={'Send ' + label.toLowerCase()} disabled={posting || !connected} onClick={() => void post('reaction', emoji)}>{emoji}</button>)}
      </div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {view === 'riders' ? <ul className="ride-roster" aria-label="Riders in this class">
      {room.instructorCadence?.rpm != null && <li className="ride-roster-instructor">
        <span className="ride-avatar" aria-hidden="true">{room.hostName.slice(0, 1).toUpperCase()}</span>
        <div className="ride-roster-name"><b>{room.hostName}</b><small>Instructor</small></div>
        <div className="ride-roster-rpm">{room.instructorCadence.rpm} <small>RPM</small></div>
      </li>}
      {roster.map(rider => <li key={rider.id} data-own={rider.id === session.riderId || undefined}>
        <span className="ride-avatar" style={{ backgroundColor: rider.color }} aria-hidden="true">{rider.name.slice(0, 1).toUpperCase()}</span>
        <div className="ride-roster-name"><b>{rider.name}</b>{rider.id === session.riderId && <small>You</small>}</div>
        <div className="ride-roster-rpm">{rider.reading ?? '—'} <small>RPM</small></div>
      </li>)}
    </ul> : <>
      <ClassComments comments={comments} riderId={session.riderId} />
      <CommentComposer busy={posting} connected={connected} send={value => post('comment', value)} />
    </>}
  </section>
}
