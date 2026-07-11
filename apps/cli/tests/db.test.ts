import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CachedMessage, openCache } from '../src/db'

const msg = (over: Partial<CachedMessage> = {}): CachedMessage => ({
  chat_id: 1,
  id: 10,
  date: 1700000000,
  sender: 'Alice',
  text: 'hello world',
  out: 0,
  ...over,
})

describe('cache db', () => {
  test('insert + count + iterAll with chat title', () => {
    const c = openCache(':memory:')
    c.upsertChat(1, 'Chat One')
    c.insertMessages([msg(), msg({ id: 11, text: 'second' })])
    expect(c.count()).toBe(2)
    const rows = [...c.iterAll()]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.chat_title).toBe('Chat One')
  })

  test('insert does NOT advance last_msg_id (crash mid-chat must not skip older tail)', () => {
    const c = openCache(':memory:')
    c.insertMessages([msg({ id: 50 })])
    expect(c.lastMsgId(1)).toBe(0)
  })

  test('bumpLastMsgId never goes backwards', () => {
    const c = openCache(':memory:')
    c.bumpLastMsgId(1, 50)
    expect(c.lastMsgId(1)).toBe(50)
    c.bumpLastMsgId(1, 20)
    expect(c.lastMsgId(1)).toBe(50)
    c.bumpLastMsgId(1, 99)
    expect(c.lastMsgId(1)).toBe(99)
    expect(c.lastMsgId(777)).toBe(0) // unknown chat
  })

  test('re-insert same message updates text (edit)', () => {
    const c = openCache(':memory:')
    c.insertMessages([msg()])
    c.insertMessages([msg({ text: 'edited' })])
    expect(c.count()).toBe(1)
    expect([...c.iterAll()][0]!.text).toBe('edited')
  })

  test('upsertChat keeps last_msg_id', () => {
    const c = openCache(':memory:')
    c.bumpLastMsgId(1, 42)
    c.upsertChat(1, 'Renamed')
    expect(c.lastMsgId(1)).toBe(42)
  })

  test('upsertChat tolerates missing title (peer without displayName)', () => {
    const c = openCache(':memory:')
    expect(() => c.upsertChat(1, undefined)).not.toThrow()
    c.insertMessages([msg({ chat_id: 1, id: 1 })])
    expect([...c.iterAll()][0]!.chat_title).toBe('')
  })

  test('deleteMessages removes only given ids in chat', () => {
    const c = openCache(':memory:')
    c.insertMessages([msg({ id: 1 }), msg({ id: 2 }), msg({ chat_id: 2, id: 1 })])
    c.deleteMessages(1, [1])
    expect(c.count()).toBe(2)
    expect([...c.iterAll()].map((r) => `${r.chat_id}:${r.id}`).sort()).toEqual(['1:2', '2:1'])
  })

  test('deleteByUpdate: channel update targets marked channel id', () => {
    const c = openCache(':memory:')
    const channelMarked = -1000000000123 // channel 123
    c.insertMessages([msg({ chat_id: channelMarked, id: 5 }), msg({ chat_id: 1, id: 5 })])
    c.deleteByUpdate([5], 123)
    const left = [...c.iterAll()]
    expect(left).toHaveLength(1)
    expect(left[0]!.chat_id).toBe(1)
  })

  test('deleteByUpdate: non-channel update spares channels', () => {
    const c = openCache(':memory:')
    const channelMarked = -1000000000123
    c.insertMessages([msg({ chat_id: channelMarked, id: 5 }), msg({ chat_id: 1, id: 5 })])
    c.deleteByUpdate([5], null)
    const left = [...c.iterAll()]
    expect(left).toHaveLength(1)
    expect(left[0]!.chat_id).toBe(channelMarked)
  })

  test('migrates an old chats table lacking backfill columns', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tgc-')), 'cache.db')
    const old = new Database(path, { create: true })
    old.exec(
      `create table chats (id integer primary key, title text not null default '', last_msg_id integer not null default 0)`,
    )
    old.exec(`insert into chats (id, title) values (1, 'Old')`)
    old.close()
    const c = openCache(path)
    c.setOldestId(1, 42)
    c.markBackfilled(1)
    expect(c.backfillState(1)).toEqual({ oldestId: 42, backfilled: true })
    c.close()
  })

  test('bumpLastMsgId ignores non-positive ids', () => {
    const c = openCache(':memory:')
    c.bumpLastMsgId(1, -5)
    expect(c.lastMsgId(1)).toBe(0)
  })

  test('deleteMessages with empty ids is a no-op', () => {
    const c = openCache(':memory:')
    c.insertMessages([msg({ id: 1 })])
    expect(() => c.deleteMessages(1, [])).not.toThrow()
    expect(c.count()).toBe(1)
  })

  test('deleteByUpdate with empty ids is a no-op', () => {
    const c = openCache(':memory:')
    expect(() => c.deleteByUpdate([], 123)).not.toThrow()
  })

  test('deleteByUpdate removes multiple channel messages', () => {
    const c = openCache(':memory:')
    const channelMarked = -1000000000123 // channel 123
    c.insertMessages([
      msg({ chat_id: channelMarked, id: 5 }),
      msg({ chat_id: channelMarked, id: 6 }),
      msg({ chat_id: channelMarked, id: 7 }),
    ])
    c.deleteByUpdate([5, 6], 123)
    expect([...c.iterAll()].map((r) => r.id)).toEqual([7])
  })

  test('close closes the database', () => {
    const c = openCache(':memory:')
    c.close()
    // count() reuses a cached prepared statement that Bun keeps alive post-close,
    // so probe with deleteMessages which issues a fresh db.run against the closed db
    expect(() => c.deleteMessages(1, [1])).toThrow()
  })
})
