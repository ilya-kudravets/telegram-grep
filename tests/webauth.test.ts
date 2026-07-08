import { describe, expect, test } from 'bun:test'
import { checkAuth, guardRoutes, loadOrCreateToken } from '../src/webauth'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = 'secret123'
const req = (headers: Record<string, string>) => new Request('http://host/api/x', { headers })

describe('checkAuth', () => {
  test('missing/wrong bearer → 401', () => {
    expect(checkAuth(req({}), TOKEN)?.status).toBe(401)
    expect(checkAuth(req({ authorization: 'Bearer nope' }), TOKEN)?.status).toBe(401)
  })

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
