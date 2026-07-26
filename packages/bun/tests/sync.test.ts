import { describe, expect, test } from 'bun:test'
import {
  attachRealtime,
  type Cache,
  floodWaitSeconds,
  type MsgLike,
  openCache,
  type SyncClient,
  sleep,
  syncAll,
  syncChat,
  toCached,
} from '@tg/bun'

const msg = (id: number, text: string, chatId = 1): MsgLike => ({
  id,
  text,
  date: new Date(1700000000000 + id * 1000),
  isOutgoing: id % 2 === 0,
  sender: { displayName: 'Alice' },
  chat: { id: chatId, displayName: 'Chat' },
})

// history is stored newest-first per chat; getHistory pages downward via maxId,
// iterHistory yields anything newer than minId
function fakeClient(historyByChat: Record<number, MsgLike[]>): SyncClient & {
  requestedMinIds: Record<number, number>
  getHistoryCalls: { chatId: number; maxId: number }[]
} {
  const requestedMinIds: Record<number, number> = {}
  const getHistoryCalls: { chatId: number; maxId: number }[] = []
  return {
    requestedMinIds,
    getHistoryCalls,
    async *iterDialogs() {
      for (const chatId of Object.keys(historyByChat)) {
        const msgs = historyByChat[Number(chatId)] ?? []
        const top = msgs.reduce((mx, m) => Math.max(mx, m.id), 0)
        // real mtcute Peer exposes id/displayName as prototype getters — model that so a
        // `{...peer}` spread in syncAll would break the test the way it broke production
        const id = Number(chatId)
        const peer = Object.create({
          get id() {
            return id
          },
          get displayName() {
            return `Chat ${id}`
          },
        })
        yield { peer, lastMessage: top ? { id: top } : null }
      }
    },
    async *iterHistory(chatId: number, params?: { minId?: number }) {
      const minId = params?.minId ?? 0
      requestedMinIds[chatId] = minId
      for (const m of historyByChat[chatId] ?? []) if (m.id > minId) yield m
    },
    async getHistory(chatId: number, params?: { maxId?: number; limit?: number }) {
      const maxId = params?.maxId ?? Infinity
      getHistoryCalls.push({ chatId, maxId: params?.maxId ?? 0 })
      const all = (historyByChat[chatId] ?? []).filter((m) => m.id <= maxId)
      return all.slice(0, params?.limit ?? 100)
    },
  }
}

describe('toCached', () => {
  test('maps fields, unix seconds, out flag', () => {
    const c = toCached(msg(2, 'hi'))!
    expect(c).toEqual({ chat_id: 1, id: 2, date: 1700000002, sender: 'Alice', text: 'hi', out: 1 })
  })

  test('textless message is skipped', () => {
    expect(toCached(msg(1, ''))).toBeNull()
  })
})

describe('syncAll', () => {
  test('first run backfills everything and records ids', async () => {
    const cache = openCache(':memory:')
    const tg = fakeClient({ 1: [msg(3, 'c'), msg(2, 'b'), msg(1, 'a')], 2: [msg(7, 'x', 2)] })
    const p = await syncAll(tg, cache)
    expect(p.chatsDone).toBe(2)
    expect(p.chatsTotal).toBe(2)
    expect(p.messages).toBe(6) // backfill re-fetches each chat's frontier page → boundary msg counted twice (progress.messages accumulates positively)
    expect(cache.count()).toBe(4)
    expect(cache.lastMsgId(1)).toBe(3)
    expect(cache.lastMsgId(2)).toBe(7)
    expect(cache.backfillState(1).backfilled).toBe(true)
    expect(tg.requestedMinIds).toEqual({}) // first sync never runs the incremental path
  })

  test('second run skips finished backfill, fetches only new via incremental', async () => {
    const cache = openCache(':memory:')
    await syncAll(fakeClient({ 1: [msg(2, 'b'), msg(1, 'a')] }), cache)

    const tg = fakeClient({ 1: [msg(5, 'new'), msg(2, 'b'), msg(1, 'a')] })
    await syncAll(tg, cache)
    expect(tg.requestedMinIds[1]).toBe(2) // incremental asked for messages newer than high-water
    expect(tg.getHistoryCalls).toHaveLength(0) // backfill already complete → no re-download
    expect(cache.count()).toBe(3)
    expect(cache.lastMsgId(1)).toBe(5)
  })

  test('restart with no new messages touches no history at all', async () => {
    const cache = openCache(':memory:')
    await syncAll(fakeClient({ 1: [msg(2, 'b'), msg(1, 'a')] }), cache)

    // same history → lastMessage id unchanged, backfill complete → skip entirely
    const tg = fakeClient({ 1: [msg(2, 'b'), msg(1, 'a')] })
    const p = await syncAll(tg, cache)
    expect(tg.getHistoryCalls).toHaveLength(0)
    expect(tg.requestedMinIds).toEqual({}) // iterHistory never called
    expect(p.chatsDone).toBe(1)
    expect(cache.count()).toBe(2)
  })

  test('interrupted backfill resumes from persisted frontier, not from the top', async () => {
    const full = [msg(5, 'e'), msg(4, 'd'), msg(3, 'c'), msg(2, 'b'), msg(1, 'a')]
    const cache = openCache(':memory:')

    // first run: page1 (2 msgs) persists, page2 dies with a non-flood error → run aborts
    // page1 → ids 5,4 (frontier=4); page2 (maxId 4) → throws
    const hardFail: SyncClient = {
      ...fakeClient({ 1: full }),
      async getHistory(_chatId, params) {
        const maxId = params?.maxId ?? Infinity
        if (maxId <= 4) throw new Error('BOOM')
        return full.filter((m) => m.id <= maxId).slice(0, 2)
      },
    }
    const failed = await syncAll(hardFail, cache) // recorded, not thrown
    expect(failed.errors[0]).toMatchObject({ chatId: 1, error: expect.stringContaining('BOOM') })
    expect(cache.count()).toBe(2) // only newest page persisted
    expect(cache.backfillState(1).oldestId).toBe(4) // frontier saved
    expect(cache.backfillState(1).backfilled).toBe(false)
    expect(cache.lastMsgId(1)).toBe(5) // high-water set from first page

    // resume: healthy client must continue from frontier 4, not re-fetch 5
    const good = fakeClient({ 1: full })
    await syncAll(good, cache)
    expect(good.getHistoryCalls[0]!.maxId).toBe(4) // resumed at the saved frontier
    expect(good.requestedMinIds).toEqual({}) // topId == high-water on resume → incremental stays skipped
    expect(cache.count()).toBe(5) // rest of history filled in
    expect(cache.backfillState(1).backfilled).toBe(true)
  })

  test('FLOOD_WAIT is retried and the chat completes', async () => {
    const history = [msg(3, 'c'), msg(2, 'b'), msg(1, 'a')]
    let calls = 0
    const tg: SyncClient = {
      ...fakeClient({ 1: history }),
      async getHistory(_chatId, params) {
        calls++
        if (calls === 1) throw new Error('Telegram API error 420: FLOOD_WAIT_0')
        const maxId = params?.maxId ?? Infinity
        return history.filter((m) => m.id <= maxId)
      },
    }
    const cache = openCache(':memory:')
    const p = await syncAll(tg, cache, undefined, async () => {}) // no-op sleep keeps the test fast
    expect(cache.count()).toBe(3)
    expect(cache.lastMsgId(1)).toBe(3)
    expect(p.chatsDone).toBe(1)
  })

  test('a bad peer is skipped and recorded, other chats still sync', async () => {
    const tg: SyncClient = {
      ...fakeClient({ 1: [msg(2, 'ok', 1)], 2: [msg(9, 'x', 2)] }),
      async getHistory(chatId, params) {
        if (chatId === 1) throw new Error('Telegram API error 400: PEER_ID_INVALID')
        const maxId = params?.maxId ?? Infinity
        return [msg(9, 'x', 2)].filter((m) => m.id <= maxId)
      },
    }
    const cache = openCache(':memory:')
    const p = await syncAll(tg, cache)
    expect(p.chatsDone).toBe(2) // both counted as processed
    expect(p.errors).toHaveLength(1)
    expect(p.errors[0]).toMatchObject({
      chatId: 1,
      error: expect.stringContaining('PEER_ID_INVALID'),
    })
    expect(cache.count()).toBe(1) // chat 2 still synced
    expect(cache.lastMsgId(2)).toBe(9)
  })

  test('textless tail still advances last_msg_id', async () => {
    const cache = openCache(':memory:')
    await syncAll(fakeClient({ 1: [msg(9, ''), msg(8, 'text')] }), cache)
    expect(cache.count()).toBe(1)
    expect(cache.lastMsgId(1)).toBe(9) // won't refetch 9 next run
  })

  test('empty dialog list yields empty progress', async () => {
    const p = await syncAll(fakeClient({}), openCache(':memory:'))
    expect(p.chatTitle).toBe('')
    expect(p.chatsTotal).toBe(0)
  })

  test('progress.messages counts inserted messages', async () => {
    const cache = openCache(':memory:')
    const p = await syncAll(fakeClient({ 1: [msg(3, 'c'), msg(2, 'b'), msg(1, 'a')] }), cache)
    expect(p.messages).toBe(4) // 3 msgs + frontier page re-fetch of the boundary msg; accumulates positively
    expect(cache.count()).toBe(3)
  })

  test('FLOOD_WAIT waits (s+1)*1000 ms', async () => {
    const history = [msg(3, 'c'), msg(2, 'b'), msg(1, 'a')]
    let calls = 0
    const tg = {
      ...fakeClient({ 1: history }),
      async getHistory(_chatId: number, params?: { maxId?: number; limit?: number }) {
        calls++
        if (calls === 1) throw new Error('Telegram API error 420: FLOOD_WAIT_5')
        const maxId = params?.maxId ?? Infinity
        return history.filter((m) => m.id <= maxId)
      },
    }
    const slept: number[] = []
    const cache = openCache(':memory:')
    await syncAll(tg, cache, undefined, async (ms) => {
      slept.push(ms)
    })
    expect(slept).toEqual([6000])
    expect(cache.count()).toBe(3)
  })

  test('incremental advances high-water to the max new id, not the last seen', async () => {
    const cache = openCache(':memory:')
    await syncAll(fakeClient({ 1: [msg(1, 'a')] }), cache) // backfilled, hw=1
    // new messages arrive; fakeClient stores newest-first so iterHistory yields 7,6,5 (descending)
    const tg = fakeClient({ 1: [msg(7, 'g'), msg(6, 'f'), msg(5, 'e'), msg(1, 'a')] })
    await syncAll(tg, cache)
    expect(cache.lastMsgId(1)).toBe(7)
  })

  test('incremental flushes in BATCH-sized chunks', async () => {
    const cache = openCache(':memory:')
    await syncAll(fakeClient({ 1: [msg(1, 'a')] }), cache) // backfilled, hw=1
    // 502 messages ids 502..1 (newest-first); incremental yields the 501 with id>1
    const many = Array.from({ length: 502 }, (_, i) => msg(502 - i, 't'))
    const tg = fakeClient({ 1: many })
    const totals: number[] = []
    await syncAll(tg, cache, (p) => totals.push(p.messages))
    // consecutive positive deltas of progress.messages = the sizes handed to each onBatch flush
    const deltas: number[] = []
    for (let i = 0; i < totals.length; i++) {
      const d = totals[i]! - (i ? totals[i - 1]! : 0)
      if (d > 0) deltas.push(d)
    }
    expect(deltas).toEqual([500, 1]) // one full batch of 500, then the remaining 1
    expect(cache.count()).toBe(502)
  })
})

describe('floodWaitSeconds', () => {
  test('parses multi-digit seconds', () => {
    expect(floodWaitSeconds(new Error('Telegram API error 420: FLOOD_WAIT_42'))).toBe(42)
  })
  test('null for non-flood errors and non-errors', () => {
    expect(floodWaitSeconds(new Error('PEER_ID_INVALID'))).toBeNull()
    expect(floodWaitSeconds('nope')).toBeNull()
  })
})

describe('syncChat fast path', () => {
  test('returns false when backfilled and nothing new', async () => {
    const cache = openCache(':memory:')
    const tg = fakeClient({ 1: [msg(2, 'b'), msg(1, 'a')] })
    await syncChat(tg, cache, 1, 2) // first sync: backfill fully
    expect(cache.backfillState(1).backfilled).toBe(true)
    // second call: backfilled and topId (2) <= high-water (2) → skip entirely
    const skipped = await syncChat(tg, cache, 1, 2)
    expect(skipped).toBe(false)
  })

  test('not skipped when there are new messages', async () => {
    const cache = openCache(':memory:')
    const tg = fakeClient({ 1: [msg(2, 'b'), msg(1, 'a')] })
    await syncChat(tg, cache, 1, 2)
    const did = await syncChat(tg, cache, 1, 5) // topId 5 > high-water 2
    expect(did).toBe(true)
  })
})

describe('attachRealtime', () => {
  function wire(cache: Cache) {
    const h: {
      onNew?: (m: MsgLike) => unknown
      onEdit?: (m: MsgLike) => unknown
      onDel?: (u: { messageIds: number[]; channelId: number | null }) => unknown
    } = {}
    let changes = 0
    const dp = {
      onNewMessage: (fn: (m: MsgLike) => unknown) => {
        h.onNew = fn
      },
      onEditMessage: (fn: (m: MsgLike) => unknown) => {
        h.onEdit = fn
      },
      onDeleteMessage: (fn: (u: { messageIds: number[]; channelId: number | null }) => unknown) => {
        h.onDel = fn
      },
    }
    // tg is unused by the fake factory; cast a dummy
    attachRealtime(
      {} as never,
      cache,
      () => {
        changes++
      },
      () => dp,
    )
    return { h, changes: () => changes }
  }

  test('new message is cached, chat upserted, high-water bumped, onChange fired', async () => {
    const cache = openCache(':memory:')
    const { h, changes } = wire(cache)
    await h.onNew!(msg(4, 'hi', 1))
    const rows = [...cache.iterAll()]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text).toBe('hi')
    expect(rows[0]!.chat_title).toBe('Chat') // from upsertChat(msg.chat.displayName)
    expect(cache.lastMsgId(1)).toBe(4)
    expect(changes()).toBe(1)
  })

  test('edit updates cached text and fires onChange', async () => {
    const cache = openCache(':memory:')
    const { h, changes } = wire(cache)
    await h.onNew!(msg(4, 'orig', 1))
    await h.onEdit!(msg(4, 'edited', 1))
    expect([...cache.iterAll()][0]!.text).toBe('edited')
    expect(changes()).toBe(2)
  })

  test('delete update removes cached messages and fires onChange', async () => {
    const cache = openCache(':memory:')
    const { h, changes } = wire(cache)
    await h.onNew!(msg(4, 'x', 1))
    await h.onDel!({ messageIds: [4], channelId: null })
    expect(cache.count()).toBe(0)
    expect(changes()).toBe(2) // onNew + onDel each fired onChange (fresh wire per test)
  })
})

describe('sleep', () => {
  test('resolves after the given delay', async () => {
    // the mutated executor `() => undefined` never resolves → this would hang → timeout
    await sleep(1)
  })
})

describe('backfill termination', () => {
  test('a chat with no history is marked backfilled in a single page fetch', async () => {
    const cache = openCache(':memory:')
    const tg = fakeClient({ 1: [] })
    await syncAll(tg, cache)
    expect(cache.count()).toBe(0)
    expect(cache.backfillState(1).backfilled).toBe(true)
    // correct code terminates on the first empty page (1 call); mutants that skip that
    // branch only stop on the second empty page → an extra getHistory call
    expect(tg.getHistoryCalls).toHaveLength(1)
  })

  test('syncChat returns true after an empty-page backfill', async () => {
    const cache = openCache(':memory:')
    expect(await syncChat(fakeClient({ 1: [] }), cache, 1, 0)).toBe(true)
  })

  test('syncChat returns true when backfill reaches the bottom (no downward progress)', async () => {
    const cache = openCache(':memory:')
    // fakeClient uses inclusive maxId, so the last page re-fetches the boundary id → pageMin >= frontier
    expect(await syncChat(fakeClient({ 1: [msg(2, 'b'), msg(1, 'a')] }), cache, 1, 2)).toBe(true)
  })

  test('backfill pages through multiple getHistory calls until progress stops', async () => {
    // 3 content pages of 2 → needs continued downward paging; a mutant that terminates as soon
    // as the frontier is set (after page 1/2) would drop the older pages
    const full = [msg(6, 'f'), msg(5, 'e'), msg(4, 'd'), msg(3, 'c'), msg(2, 'b'), msg(1, 'a')]
    const tg: SyncClient = {
      ...fakeClient({ 1: full }),
      // 2 per page, maxId EXCLUSIVE so paging makes real progress and ends on an empty page
      async getHistory(_chatId, params) {
        const maxId = params?.maxId ?? Infinity
        return full.filter((m) => m.id < maxId).slice(0, 2)
      },
    }
    const cache = openCache(':memory:')
    await syncAll(tg, cache)
    expect(cache.count()).toBe(6) // every page fetched, not just the first two
    expect(cache.backfillState(1).backfilled).toBe(true)
  })
})
