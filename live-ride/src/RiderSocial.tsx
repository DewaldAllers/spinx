import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import type { ClassComment, Room } from './types'

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
      <b>{item.riderId === riderId ? 'You' : item.name}</b>
      <p>{item.content}</p>
    </li>)}
  </ul>
}

export function RiderSocial({ room, session, connected }: {
  room: Room
  session: { riderId: string; riderToken: string }
  connected: boolean
}) {
  const [view, setView] = useState<'riders' | 'comments'>('riders')
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
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

  async function post(kind: 'comment' | 'reaction', value: string) {
    if (posting || !connected) return
    setPosting(true)
    setError('')
    try {
      await api.postActivity(room.code, session, kind, value)
      if (kind === 'comment') setDraft('')
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setPosting(false)
    }
  }

  function sendComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.trim()) void post('comment', draft.trim())
  }

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
      {roster.map(rider => <li key={rider.id} data-own={rider.id === session.riderId || undefined}>
        <span className="ride-avatar" style={{ backgroundColor: rider.color }} aria-hidden="true">{rider.name.slice(0, 1).toUpperCase()}</span>
        <div className="ride-roster-name"><b>{rider.name}</b>{rider.id === session.riderId && <small>You</small>}</div>
        <div className="ride-roster-rpm">{rider.reading ?? '—'} <small>RPM</small></div>
      </li>)}
    </ul> : <>
      <ClassComments comments={comments} riderId={session.riderId} />
      <form className="class-comment-form" onSubmit={sendComment}>
        <input type="text" aria-label="Comment to class" placeholder="Message the class" value={draft} maxLength={160} readOnly={posting} onChange={event => setDraft(event.target.value)} />
        <button type="submit" className="primary" disabled={posting || !connected || !draft.trim()}>Send</button>
      </form>
    </>}
  </section>
}
