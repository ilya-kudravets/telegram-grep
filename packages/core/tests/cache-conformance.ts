// Conformance suite for the `Cache` port. Every adapter must satisfy it identically —
// that shared behaviour is the whole point of the port, so the tests live next to the
// port rather than next to any one driver.
//
// Not named *.test.ts on purpose: `bun test` must not pick this up on its own. An
// adapter's own test file imports it and supplies a factory, e.g.
//
//   testCache('bun:sqlite', () => openCache(':memory:'))
//
// ponytail: only the Bun adapter calls it today — it stays a shared suite because a
// second driver (Postgres, a browser-side cache) would otherwise copy it verbatim.
import { describe, expect, test } from 'bun:test'
import type { Cache, CachedMessage } from '../src/cache'

const msg = (over: Partial<CachedMessage> = {}): CachedMessage => ({
  chat_id: 1,
  id: 10,
  date: 1700000000,
  sender: 'Alice',
  text: 'hello world',
  out: 0,
  ...over,
})

const CHANNEL_MARKED = -1000000000123 // channel 123 in marked form

/** Runs the port's behavioural contract against one adapter. `open` must yield a fresh, empty cache. */
export function testCache(label: string, open: () => Cache) {
  describe(`Cache conformance (${label})`, () => {
    test('insert + count + iterAll with chat title', () => {
      const c = open()
      c.upsertChat(1, 'Chat One')
      c.insertMessages([msg(), msg({ id: 11, text: 'second' })])
      expect(c.count()).toBe(2)
      const rows = [...c.iterAll()]
      expect(rows).toHaveLength(2)
      expect(rows[0]!.chat_title).toBe('Chat One')
    })

    test('insert does NOT advance last_msg_id (crash mid-chat must not skip older tail)', () => {
      const c = open()
      c.insertMessages([msg({ id: 50 })])
      expect(c.lastMsgId(1)).toBe(0)
    })

    test('bumpLastMsgId never goes backwards', () => {
      const c = open()
      c.bumpLastMsgId(1, 50)
      expect(c.lastMsgId(1)).toBe(50)
      c.bumpLastMsgId(1, 20)
      expect(c.lastMsgId(1)).toBe(50)
      c.bumpLastMsgId(1, 99)
      expect(c.lastMsgId(1)).toBe(99)
      expect(c.lastMsgId(777)).toBe(0) // unknown chat
    })

    test('bumpLastMsgId ignores non-positive ids', () => {
      const c = open()
      c.bumpLastMsgId(1, -5)
      expect(c.lastMsgId(1)).toBe(0)
    })

    test('re-insert same message updates text (edit)', () => {
      const c = open()
      c.insertMessages([msg()])
      c.insertMessages([msg({ text: 'edited' })])
      expect(c.count()).toBe(1)
      expect([...c.iterAll()][0]!.text).toBe('edited')
    })

    test('upsertChat keeps last_msg_id', () => {
      const c = open()
      c.bumpLastMsgId(1, 42)
      c.upsertChat(1, 'Renamed')
      expect(c.lastMsgId(1)).toBe(42)
    })

    test('upsertChat tolerates missing title (peer without displayName)', () => {
      const c = open()
      expect(() => c.upsertChat(1, undefined)).not.toThrow()
      c.insertMessages([msg({ chat_id: 1, id: 1 })])
      expect([...c.iterAll()][0]!.chat_title).toBe('')
    })

    test('backfill frontier: defaults, then round-trips through setOldestId/markBackfilled', () => {
      const c = open()
      expect(c.backfillState(1)).toEqual({ oldestId: 0, backfilled: false })
      c.setOldestId(1, 42)
      expect(c.backfillState(1)).toEqual({ oldestId: 42, backfilled: false })
      c.markBackfilled(1)
      expect(c.backfillState(1)).toEqual({ oldestId: 42, backfilled: true })
    })

    test('deleteMessages removes only given ids in chat', () => {
      const c = open()
      c.insertMessages([msg({ id: 1 }), msg({ id: 2 }), msg({ chat_id: 2, id: 1 })])
      c.deleteMessages(1, [1])
      expect(c.count()).toBe(2)
      expect([...c.iterAll()].map((r) => `${r.chat_id}:${r.id}`).sort()).toEqual(['1:2', '2:1'])
    })

    test('deleteMessages with empty ids is a no-op', () => {
      const c = open()
      c.insertMessages([msg({ id: 1 })])
      expect(() => c.deleteMessages(1, [])).not.toThrow()
      expect(c.count()).toBe(1)
    })

    test('deleteByUpdate: channel update targets marked channel id', () => {
      const c = open()
      c.insertMessages([msg({ chat_id: CHANNEL_MARKED, id: 5 }), msg({ chat_id: 1, id: 5 })])
      c.deleteByUpdate([5], 123)
      const left = [...c.iterAll()]
      expect(left).toHaveLength(1)
      expect(left[0]!.chat_id).toBe(1)
    })

    test('deleteByUpdate: non-channel update spares channels', () => {
      const c = open()
      c.insertMessages([msg({ chat_id: CHANNEL_MARKED, id: 5 }), msg({ chat_id: 1, id: 5 })])
      c.deleteByUpdate([5], null)
      const left = [...c.iterAll()]
      expect(left).toHaveLength(1)
      expect(left[0]!.chat_id).toBe(CHANNEL_MARKED)
    })

    test('deleteByUpdate removes multiple channel messages', () => {
      const c = open()
      c.insertMessages([
        msg({ chat_id: CHANNEL_MARKED, id: 5 }),
        msg({ chat_id: CHANNEL_MARKED, id: 6 }),
        msg({ chat_id: CHANNEL_MARKED, id: 7 }),
      ])
      c.deleteByUpdate([5, 6], 123)
      expect([...c.iterAll()].map((r) => r.id)).toEqual([7])
    })

    test('deleteByUpdate with empty ids is a no-op', () => {
      const c = open()
      expect(() => c.deleteByUpdate([], 123)).not.toThrow()
    })

    test('insertMessages with an empty batch is a no-op', () => {
      const c = open()
      expect(() => c.insertMessages([])).not.toThrow()
      expect(c.count()).toBe(0)
    })
  })
}
