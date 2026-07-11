import { describe, expect, test } from 'bun:test'
import { makeApi } from '../src/api'
import type { SearchRow } from '../src/db'
import type { DeleteTarget } from '../src/deleter'

const row: SearchRow = {
  chat_id: 1,
  id: 2,
  date: 1700000000,
  sender: 'A',
  text: 'hit',
  out: 0,
  chat_title: 'Chat',
}

function api(overrides: Partial<Parameters<typeof makeApi>[0]> = {}) {
  return makeApi({
    search: () => [row],
    del: async (targets) => ({ deleted: targets.length, errors: [] }),
    status: () => ({ cached: 1 }),
    ...overrides,
  })
}

describe('api', () => {
  test('search returns rows', async () => {
    const res = api()['/api/search'](new Request('http://x/api/search?q=hit'))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { rows: unknown }).rows).toEqual([row])
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
