import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAuth, checkWsAuth, guardRoutes, loadOrCreateToken } from '../src/webauth'

const TOKEN = 'secret123'
const req = (headers: Record<string, string>) => new Request('http://host/api/x', { headers })

describe('checkAuth', () => {
  test('missing/wrong bearer → 401', () => {
    expect(checkAuth(req({}), TOKEN)?.status).toBe(401)
    expect(checkAuth(req({ authorization: 'Bearer nope' }), TOKEN)?.status).toBe(401)
  })

  // the compare hashes first, so a wrong-length header is a 401, not a thrown
  // "input buffers must have the same byte length" escaping as a 500
  test.each(['', 'Bearer', `Bearer ${TOKEN}x`, `bearer ${TOKEN}`])(
    'authorization %p → 401 without throwing',
    (authorization) => {
      expect(checkAuth(req({ authorization }), TOKEN)?.status).toBe(401)
    },
  )

  test('correct bearer, no origin → allowed', () => {
    expect(checkAuth(req({ authorization: `Bearer ${TOKEN}` }), TOKEN)).toBeNull()
  })

  test('same-origin allowed, cross-origin → 403 even with token', () => {
    const ok = req({ authorization: `Bearer ${TOKEN}`, host: 'host', origin: 'http://host' })
    expect(checkAuth(ok, TOKEN)).toBeNull()
    const evil = req({ authorization: `Bearer ${TOKEN}`, host: 'host', origin: 'http://evil.com' })
    expect(checkAuth(evil, TOKEN)?.status).toBe(403)
  })
})

describe('guardRoutes', () => {
  test('wraps function and method handlers with auth', async () => {
    const routes = guardRoutes(TOKEN, {
      '/api/x': () => new Response('x'),
      '/api/y': { POST: async () => new Response('y') },
    })
    const noAuth = await (routes['/api/x'] as (r: Request) => Response)(req({}))
    expect(noAuth.status).toBe(401)
    const ok = await (routes['/api/x'] as (r: Request) => Response)(
      req({ authorization: `Bearer ${TOKEN}` }),
    )
    expect(await ok.text()).toBe('x')
    const post = (routes['/api/y'] as { POST: (r: Request) => Promise<Response> }).POST
    expect((await post(req({}))).status).toBe(401)
    expect(await (await post(req({ authorization: `Bearer ${TOKEN}` }))).text()).toBe('y')
  })
})

describe('loadOrCreateToken', () => {
  test('creates once, then returns the same token', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tgc-')), 'web-token')
    const a = loadOrCreateToken(path)
    expect(a).toHaveLength(32) // 24 random bytes → base64url
    expect(loadOrCreateToken(path)).toBe(a)
  })
})

describe('checkWsAuth', () => {
  const ws = (query: string) => new Request(`http://host/ws${query}`, { headers: { host: 'host' } })

  test('matching ?token allowed, missing or wrong → 401', () => {
    expect(checkWsAuth(ws(`?token=${TOKEN}`), TOKEN)).toBeNull()
    expect(checkWsAuth(ws(''), TOKEN)?.status).toBe(401)
    expect(checkWsAuth(ws(`?token=${TOKEN}x`), TOKEN)?.status).toBe(401)
  })

  test('cross-origin → 403 even with the token', () => {
    const evil = new Request(`http://host/ws?token=${TOKEN}`, {
      headers: { host: 'host', origin: 'http://evil.com' },
    })
    expect(checkWsAuth(evil, TOKEN)?.status).toBe(403)
  })
})
