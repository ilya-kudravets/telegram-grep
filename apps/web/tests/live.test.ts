import { describe, expect, test } from 'bun:test'
import { makeLive } from '../src/live'

const TOKEN = 'secret123'
const wsReq = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })
const upgrader = (ok = true) => {
  const seen: Request[] = []
  return {
    seen,
    upgrade: (req: Request) => {
      seen.push(req)
      return ok
    },
  }
}

describe('live.route (WebSocket auth gate)', () => {
  test('missing or wrong token → 401, never upgrades', () => {
    const live = makeLive(TOKEN, () => ({}))
    const u = upgrader()
    expect(live.route(wsReq('http://host/ws'), u)?.status).toBe(401)
    expect(live.route(wsReq('http://host/ws?token=nope'), u)?.status).toBe(401)
    expect(u.seen).toHaveLength(0) // an unauthenticated socket must not reach upgrade()
  })

  test('correct token → upgrades and returns no Response', () => {
    const live = makeLive(TOKEN, () => ({}))
    const u = upgrader()
    expect(live.route(wsReq(`http://host/ws?token=${TOKEN}`), u)).toBeUndefined()
    expect(u.seen).toHaveLength(1)
  })

  test('cross-origin rejected with 403 even when the token is right', () => {
    const live = makeLive(TOKEN, () => ({}))
    const u = upgrader()
    const evil = wsReq(`http://host/ws?token=${TOKEN}`, { host: 'host', origin: 'http://evil.com' })
    expect(live.route(evil, u)?.status).toBe(403)
    expect(u.seen).toHaveLength(0)
    const same = wsReq(`http://host/ws?token=${TOKEN}`, { host: 'host', origin: 'http://host' })
    expect(live.route(same, u)).toBeUndefined()
  })

  test('failed upgrade surfaces as 400 with a diagnosable body', async () => {
    const live = makeLive(TOKEN, () => ({}))
    const res = live.route(wsReq(`http://host/ws?token=${TOKEN}`), upgrader(false))
    expect(res?.status).toBe(400)
    expect(await res?.text()).toBe('upgrade failed')
  })
})

describe('live.websocket', () => {
  test('open subscribes and immediately sends the current status', () => {
    const live = makeLive(TOKEN, () => ({ cached: 7 }))
    const topics: string[] = []
    const sent: string[] = []
    live.websocket.open({ subscribe: (t) => topics.push(t), send: (d) => sent.push(d) })
    expect(topics).toHaveLength(1)
    expect(sent).toEqual([JSON.stringify({ cached: 7 })])
  })
})

describe('live.broadcast', () => {
  test('coalesces a burst into one push carrying the latest state', async () => {
    let cached = 1
    const live = makeLive(TOKEN, () => ({ cached }), 10)
    const published: string[] = []
    live.setPublisher({ publish: (_t, d) => published.push(d) })

    for (let i = 0; i < 50; i++) live.broadcast() // a sync burst
    cached = 99 // state moves on while the push is still pending
    expect(published).toHaveLength(0) // nothing sent synchronously

    await Bun.sleep(30)
    // one push for the whole burst, built at send time so it carries the final value
    expect(published).toEqual([JSON.stringify({ cached: 99 })])
  })

  test('a later burst pushes again', async () => {
    const live = makeLive(TOKEN, () => ({ ok: true }), 10)
    const published: string[] = []
    live.setPublisher({ publish: (_t, d) => published.push(d) })
    live.broadcast()
    await Bun.sleep(30)
    live.broadcast()
    await Bun.sleep(30)
    expect(published).toHaveLength(2)
  })

  test('broadcasting before the server exists does not throw', async () => {
    const live = makeLive(TOKEN, () => ({}), 10)
    expect(() => live.broadcast()).not.toThrow()
    await Bun.sleep(30) // the pending timer fires with no publisher attached
  })
})

// End-to-end through a real Bun.serve: proves the route/websocket objects this module
// hands to Bun are shaped the way Bun expects, which the mocks above cannot show.
describe('live over a real Bun.serve', () => {
  test('rejects a bad token, then pushes initial state and a broadcast to a real client', async () => {
    const live = makeLive(TOKEN, () => ({ cached: 42 }), 10)
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      routes: {
        '/ws': (req: Request, srv: Bun.Server<undefined>) => live.route(req, srv),
      },
      fetch: () => new Response('no', { status: 404 }),
      websocket: live.websocket,
    })
    live.setPublisher(server)
    const base = `127.0.0.1:${server.port}`

    try {
      const denied = await fetch(`http://${base}/ws?token=wrong`)
      expect(denied.status).toBe(401)

      const ws = new WebSocket(`ws://${base}/ws?token=${TOKEN}`)
      const frames: string[] = []
      ws.onmessage = (e) => frames.push(e.data as string)
      await new Promise<void>((res, rej) => {
        ws.onopen = () => res()
        ws.onerror = () => rej(new Error('ws failed to open'))
      })

      await Bun.sleep(20)
      expect(frames).toEqual([JSON.stringify({ cached: 42 })]) // pushed on open, no poll

      live.broadcast()
      await Bun.sleep(40)
      expect(frames).toHaveLength(2) // the push reached the subscribed client

      ws.close()
    } finally {
      server.stop(true)
    }
  })
})
