import { describe, expect, test } from 'bun:test'
import { createMemoryCache } from '../src/cache-memory'
// relative on purpose: a test-only helper must not become part of @tg/core's exports
import { testCache } from './cache-conformance'

// The port's shared contract — same suite the bun:sqlite adapter satisfies.
testCache('memory', () => createMemoryCache())

// Snapshot round-tripping is memory-specific: it is what a browser store persists.
describe('memory cache snapshots', () => {
  test('a snapshot restores messages, titles and per-chat sync state', () => {
    const a = createMemoryCache()
    a.upsertChat(1, 'Chat One', 'private')
    a.insertMessages([
      { chat_id: 1, id: 10, date: 1700000000, sender: 'Alice', text: 'hello', out: 0 },
    ])
    a.bumpLastMsgId(1, 10)
    a.setOldestId(1, 3)
    a.markBackfilled(1)

    const b = createMemoryCache(structuredClone(a.snapshot()))
    expect(b.count()).toBe(1)
    expect([...b.iterAll()][0]).toEqual({
      chat_id: 1,
      id: 10,
      date: 1700000000,
      sender: 'Alice',
      text: 'hello',
      out: 0,
      chat_title: 'Chat One',
      chat_kind: 'private',
    })
    expect(b.lastMsgId(1)).toBe(10)
    expect(b.backfillState(1)).toEqual({ oldestId: 3, backfilled: true })
  })

  test('a snapshot is a copy — mutating the source cache does not reach into it', () => {
    const c = createMemoryCache()
    c.upsertChat(1, 'Before')
    const snap = c.snapshot()
    c.upsertChat(1, 'After')
    expect(snap.chats[0]![1].title).toBe('Before')
  })

  test('a non-positive bump persists no junk chat row', () => {
    const c = createMemoryCache()
    c.bumpLastMsgId(1, -5)
    expect(c.snapshot().chats).toEqual([])
  })

  test('an empty snapshot is restorable (first launch)', () => {
    const c = createMemoryCache({ chats: [], messages: [] })
    expect(c.count()).toBe(0)
    expect([...c.iterAll()]).toEqual([])
  })
})
