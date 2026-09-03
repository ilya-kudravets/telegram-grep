// Conformance suite for the `Cache` port. Every adapter must satisfy it identically —
// that shared behaviour is the whole point of the port, so the tests live next to the
// port rather than next to any one driver.
//
// Not named *.test.ts on purpose: `bun test` must not pick this up on its own. An
// adapter's own test file imports it and supplies a factory, e.g.
//
//   testCache('bun:sqlite', () => openCache(':memory:'))
//
// Callers: the bun:sqlite adapter (apps run on it) and the in-memory adapter the
// browser client stores through.
import { describe, expect, test } from 'bun:test'
import { type Cache, type CachedMessage, MIN_CHANNEL_MARKED } from '../src/cache'

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

    test('iterAll yields newest first, which is the order search results are shown in', () => {
      const c = open()
      c.insertMessages([
        msg({ id: 1, date: 1700000001, text: 'oldest' }),
        msg({ id: 3, date: 1700000003, text: 'newest' }),
        msg({ id: 2, date: 1700000002, text: 'middle' }),
      ])
      expect([...c.iterAll()].map((r) => r.text)).toEqual(['newest', 'middle', 'oldest'])
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

    test('a message from a chat that was never upserted still reads an empty title', () => {
      const c = open()
      c.insertMessages([msg()]) // no upsertChat at all — sync inserts before it names the chat
      expect([...c.iterAll()][0]!.chat_title).toBe('')
    })

    test('a chat known only by its sync state reads an empty title', () => {
      const c = open()
      c.bumpLastMsgId(1, 5) // creates the chat row without ever setting a title
      c.insertMessages([msg()])
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

    test('upsertChat stores a peer kind, and an omitted one leaves a known one standing', () => {
      const c = open()
      c.upsertChat(1, 'Chan', 'channel')
      c.insertMessages([msg()])
      expect([...c.iterAll()][0]!.chat_kind).toBe('channel')
      // realtime and backfill both upsert without a kind; neither may erase the label
      c.upsertChat(1, 'Chan renamed')
      expect([...c.iterAll()][0]!.chat_kind).toBe('channel')
    })

    test('a chat stored without a kind reads back as unlabelled', () => {
      const c = open()
      c.upsertChat(1, 'Chat One')
      c.insertMessages([msg()])
      expect([...c.iterAll()][0]!.chat_kind).toBe('')
    })

    test("resetSyncState clears every chat's bookkeeping but keeps the messages", () => {
      const c = open()
      c.upsertChat(1, 'Chat One', 'private')
      c.upsertChat(2, 'Chat Two', 'private')
      c.bumpLastMsgId(1, 99)
      c.setOldestId(1, 42)
      c.markBackfilled(1)
      c.bumpLastMsgId(2, 7)
      c.insertMessages([msg(), msg({ chat_id: 2, id: 3 })])

      c.resetSyncState()

      for (const id of [1, 2]) {
        expect(c.lastMsgId(id)).toBe(0)
        expect(c.backfillState(id)).toEqual({ oldestId: 0, backfilled: false })
      }
      // a resync repairs the cache, it does not empty it — titles included, so results
      // stay labelled while it runs
      expect(c.count()).toBe(2)
      expect([...c.iterAll()].map((r) => r.chat_title).sort()).toEqual(['Chat One', 'Chat Two'])
      // kinds are not sync bookkeeping either — the filter must keep working during a resync
      expect([...c.iterAll()].every((r) => r.chat_kind === 'private')).toBe(true)
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

    test('deleteByUpdate: the marked-id boundary counts as a channel, so a non-channel update spares it', () => {
      const c = open()
      // marked channel ids are *below* MIN_CHANNEL_MARKED, so the boundary itself is not a
      // reachable chat id — this pins the two adapters to the same answer for it anyway
      c.insertMessages([msg({ chat_id: MIN_CHANNEL_MARKED, id: 5 })])
      c.deleteByUpdate([5], null)
      expect(c.count()).toBe(1)
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
