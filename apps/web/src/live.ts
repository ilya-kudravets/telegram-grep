// The status push channel, separated from the server so it can be tested without a
// Telegram login (same reason api.ts is separate). Replaces the old 2s /api/status poll:
// the browser opens one socket and the server pushes on every change.
import { checkWsAuth } from './webauth'

const TOPIC = 'status'

// Just enough of Bun's server/socket to drive this; keeps the tests free of a real server.
export interface Publisher {
  publish(topic: string, data: string): unknown
}
export interface Socket {
  subscribe(topic: string): unknown
  send(data: string): unknown
}
export interface Upgrader {
  upgrade(req: Request, opts: { data: undefined }): boolean
}

export function makeLive(
  token: string,
  statusPayload: () => unknown,
  // syncAll's onProgress fires per batch and per chat (~1k times on a full sync) and
  // realtime fires per message, while statusPayload() costs a COUNT(*) plus a
  // patterns.txt read. Coalesce bursts instead of paying that per event.
  throttleMs = 200,
) {
  let publisher: Publisher | undefined
  let pending: ReturnType<typeof setTimeout> | null = null

  return {
    /** The server exists only after Bun.serve() returns, so it is attached late. */
    setPublisher(p: Publisher) {
      publisher = p
    },

    /** Trailing edge: the payload is built at send time, so the last send is current. */
    broadcast() {
      if (pending) return
      pending = setTimeout(() => {
        pending = null
        publisher?.publish(TOPIC, JSON.stringify(statusPayload()))
      }, throttleMs)
    },

    /**
     * Gated by the same token as /api/*, but read from the query string: a browser
     * WebSocket cannot send an Authorization header.
     */
    route(req: Request, srv: Upgrader): Response | undefined {
      const rejected = checkWsAuth(req, token)
      if (rejected) return rejected
      return srv.upgrade(req, { data: undefined })
        ? undefined
        : new Response('upgrade failed', { status: 400 })
    },

    websocket: {
      open(ws: Socket) {
        ws.subscribe(TOPIC)
        ws.send(JSON.stringify(statusPayload())) // initial state, so the client never polls
      },
      message() {}, // clients only listen; required by Bun's handler type
    },
  }
}
