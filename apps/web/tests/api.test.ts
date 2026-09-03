import { describe, expect, test } from 'bun:test'
import type { DeleteTarget, SearchRow } from '@tg/bun'
import { MAX_TARGETS, makeApi } from '../src/api'

const row: SearchRow = {
  chat_id: 1,
  id: 2,
  date: 1700000000,
  sender: 'A',
  text: 'hit',
  out: 0,
  chat_title: 'Chat',
  chat_kind: 'private',
}

function api(overrides: Partial<Parameters<typeof makeApi>[0]> = {}) {
  return makeApi({
    search: () => [row],
    del: async (targets) => ({ deleted: targets.length, errors: [] }),
    status: () => ({ cached: 1 }),
    resync: () => {},
    ...overrides,
  })
}

const post = (body: unknown) =>
  api()['/api/delete'].POST(
    new Request('http://x/api/delete', { method: 'POST', body: JSON.stringify(body) }),
  )

describe('api', () => {
  test('POST /api/resync triggers a resync', async () => {
    let calls = 0
    const res = await api({ resync: () => calls++ })['/api/resync'].POST()
    expect(calls).toBe(1)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('search returns rows', async () => {
    const res = api()['/api/search'](new Request('http://x/api/search?q=hit'))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { rows: unknown }).rows).toEqual([row])
  })

  test('?kinds restricts the search, and its absence means no filter', async () => {
    const seen: (Set<string> | undefined)[] = []
    const withSpy = () =>
      api({
        search: (_p, kinds) => {
          seen.push(kinds)
          return [row]
        },
      })['/api/search']
    withSpy()(new Request('http://x/api/search?q=hit&kinds=private,group'))
    withSpy()(new Request('http://x/api/search?q=hit'))
    expect(seen).toEqual([new Set(['private', 'group']), undefined])
  })

  test('empty query → empty rows without calling search', async () => {
    const res = api({
      search: () => {
        throw new Error('must not be called')
      },
    })['/api/search'](new Request('http://x/api/search?q=%20'))
    expect(((await res.json()) as { rows: unknown }).rows).toEqual([])
  })

  test('invalid regex → 400 with message', async () => {
    const res = api({ search: () => null })['/api/search'](new Request('http://x/api/search?q=('))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'невалидный regex' })
  })

  test('missing q param → empty rows without calling search', async () => {
    const res = api({
      search: () => {
        throw new Error('must not be called')
      },
    })['/api/search'](new Request('http://x/api/search'))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { rows: unknown }).rows).toEqual([])
  })

  test('delete passes valid targets, rejects junk', async () => {
    let got: DeleteTarget[] = []
    const routes = api({
      del: async (t) => {
        got = t
        return { deleted: t.length, errors: [] }
      },
    })
    const res = await routes['/api/delete'].POST(
      new Request('http://x/api/delete', {
        method: 'POST',
        body: JSON.stringify({
          targets: [{ chat_id: 1, id: 2 }, { chat_id: 'nope', id: 3 }, null],
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { deleted: number }).deleted).toBe(1)
    expect(got).toEqual([{ chat_id: 1, id: 2 }])
  })

  test('delete rejects ids that are not safe integers', async () => {
    const res = await post({ targets: [{ chat_id: 1e308, id: 0.5 }] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'targets пуст' })
  })

  // deleting for everyone is irreversible: a body we can't read must not reach deps.del,
  // and must not escape the handler either (Bun's 500 page leaks the cwd)
  test.each([
    ['{oops', 'невалидный JSON'],
    ['null', 'targets пуст'],
    ['{"targets":{"0":{"chat_id":1,"id":2}}}', 'targets пуст'],
  ])('delete on malformed body %p → 400', async (body, error) => {
    const res = await api({
      del: async () => {
        throw new Error('must not be called')
      },
    })['/api/delete'].POST(new Request('http://x/api/delete', { method: 'POST', body }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
  })

  // one request must not fan out into an unbounded run of delete calls
  test('delete caps the batch at MAX_TARGETS', async () => {
    const batch = (n: number) =>
      post({ targets: Array.from({ length: n }, (_, i) => ({ chat_id: 1, id: i })) })
    const ok = await batch(MAX_TARGETS)
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { deleted: number }).deleted).toBe(MAX_TARGETS)
    const tooMany = await batch(MAX_TARGETS + 1)
    expect(tooMany.status).toBe(400)
    expect(await tooMany.json()).toEqual({ error: `максимум ${MAX_TARGETS} targets` })
  })

  test('delete with no valid targets → 400', async () => {
    const res = await api()['/api/delete'].POST(
      new Request('http://x/api/delete', { method: 'POST', body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'targets пуст' })
  })

  test('status passthrough', async () => {
    const res = api()['/api/status']()
    expect(await res.json()).toEqual({ cached: 1 })
  })
})
