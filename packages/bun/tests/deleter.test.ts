import { describe, expect, test } from 'bun:test'
import { type CachedMessage, type DeleteTarget, deleteEverywhere, openCache } from '@tg/bun'

const row = (chat_id: number, id: number): CachedMessage => ({
  chat_id,
  id,
  date: 1700000000,
  sender: '',
  text: 'x',
  out: 1,
})

function fakeTg(failChats: Set<number> = new Set()) {
  const calls: { chatId: number; ids: number[]; revoke?: boolean }[] = []
  return {
    calls,
    async deleteMessagesById(chatId: number, ids: number[], params?: { revoke?: boolean }) {
      calls.push({ chatId, ids, revoke: params?.revoke })
      if (failChats.has(chatId)) throw new Error('MESSAGE_DELETE_FORBIDDEN')
    },
  }
}

describe('deleteEverywhere', () => {
  test('groups by chat, chunks by 100, revoke always true', async () => {
    const cache = openCache(':memory:')
    const targets: DeleteTarget[] = []
    const msgs: CachedMessage[] = []
    for (let i = 1; i <= 250; i++) {
      targets.push({ chat_id: 1, id: i })
      msgs.push(row(1, i))
    }
    targets.push({ chat_id: 2, id: 1 })
    msgs.push(row(2, 1))
    cache.insertMessages(msgs)

    const tg = fakeTg()
    const res = await deleteEverywhere(tg, cache, targets)

    expect(res.deleted).toBe(251)
    expect(res.errors).toEqual([])
    expect(tg.calls.map((c) => [c.chatId, c.ids.length])).toEqual([
      [1, 100],
      [1, 100],
      [1, 50],
      [2, 1],
    ])
    expect(tg.calls.every((c) => c.revoke === true)).toBe(true)
    expect(cache.count()).toBe(0)
  })

  test('error in one chat does not stop others, cache kept for failed', async () => {
    const cache = openCache(':memory:')
    cache.insertMessages([row(1, 1), row(2, 2)])
    const tg = fakeTg(new Set([1]))

    const res = await deleteEverywhere(tg, cache, [
      { chat_id: 1, id: 1 },
      { chat_id: 2, id: 2 },
    ])

    expect(res.deleted).toBe(1)
    expect(res.errors).toEqual([{ chatId: 1, error: 'MESSAGE_DELETE_FORBIDDEN' }])
    const left = [...cache.iterAll()]
    expect(left).toHaveLength(1)
    expect(left[0]!.chat_id).toBe(1) // failed chat's row survives
  })

  test('exactly 100 ids in a chat makes a single delete call (no empty extra chunk)', async () => {
    const cache = openCache(':memory:')
    const targets: DeleteTarget[] = []
    for (let i = 1; i <= 100; i++) {
      targets.push({ chat_id: 1, id: i })
      cache.insertMessages([row(1, i)])
    }
    const tg = fakeTg()
    const res = await deleteEverywhere(tg, cache, targets)
    expect(res.deleted).toBe(100)
    expect(tg.calls).toHaveLength(1)
    expect(tg.calls[0]!.ids).toHaveLength(100)
  })
})
