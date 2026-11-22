import type { Mode, Room } from './types'

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, body && {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || 'SpinX could not connect. Try again.')
  return data
}

export const api = {
  createRoom: (hostName: string, title: string, mode: Mode) =>
    request<{ room: Room; hostId: string }>('/api/rooms', { hostName, title, mode }),
  getRoom: (code: string) => request<{ room: Room }>('/api/rooms/' + code),
  joinRoom: (code: string, name: string) =>
    request<{ riderId: string; riderToken: string }>('/api/rooms/' + code + '/join', { name }),
  command: (code: string, hostId: string, command: string, value?: string | number) =>
    request('/api/rooms/' + code + '/command', { hostId, command, value }),
  telemetry: (code: string, riderId: string, riderToken: string, rpm: number) =>
    request('/api/rooms/' + code + '/telemetry', { riderId, riderToken, rpm }),
}

export function subscribeToRoom(code: string, onRoom: (room: Room) => void, onConnection: (open: boolean) => void) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  let socket: WebSocket
  let retry = 0
  let stopped = false

  function connect() {
    socket = new WebSocket(protocol + '//' + location.host + '/ws?code=' + code)
    socket.onmessage = event => {
      const message = JSON.parse(event.data) as { type: string; room: Room }
      if (message.type !== 'room') return
      onRoom(message.room)
      onConnection(true)
    }
    socket.onclose = () => {
      if (stopped) return
      onConnection(false)
      retry = window.setTimeout(connect, 1500)
    }
  }

  connect()
  return () => {
    stopped = true
    window.clearTimeout(retry)
    socket.onclose = null
    socket.onmessage = null
    socket.close()
  }
}
