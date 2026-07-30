import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCache } from '@tg/bun'
// relative on purpose: a test-only helper must not become part of @tg/core's exports
import { testCache } from '../../core/tests/cache-conformance'

// The port's shared contract — same suite every adapter must satisfy.
testCache('bun:sqlite', () => openCache(':memory:'))

// Everything below is bun:sqlite-specific and has no meaning for another driver.
describe('cache db (bun:sqlite specifics)', () => {
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

  test('close closes the database', () => {
    const c = openCache(':memory:')
    c.close()
    // count() reuses a cached prepared statement that Bun keeps alive post-close,
    // so probe with deleteMessages which issues a fresh db.run against the closed db
    expect(() => c.deleteMessages(1, [1])).toThrow()
  })
})
