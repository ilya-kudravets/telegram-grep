import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, statSync } from 'node:fs'
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

  // Load-bearing ordering: this pragma is ignored once a table exists, so a schema that
  // creates tables before it silently ships a database that can never return disk space.
  test('a fresh database is created with incremental auto_vacuum', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tgc-')), 'cache.db')
    openCache(path).close()
    const db = new Database(path)
    expect(db.query('pragma auto_vacuum').get()).toEqual({ auto_vacuum: 2 })
    db.close()
  })

  // The security property, not a style preference: nothing on the Bun side encrypts
  // this file, so its mode is the only thing keeping another local uid (or a backup
  // daemon, or a synced folder) out of every message ever synced.
  test('a file-backed cache is created owner-only', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tgc-')), 'cache.db')
    openCache(path).close()
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  test('an in-memory cache has no file to restrict, and does not try', () => {
    expect(() => openCache(':memory:').close()).not.toThrow()
  })

  test('close closes the database', () => {
    const c = openCache(':memory:')
    c.close()
    // count() reuses a cached prepared statement that Bun keeps alive post-close,
    // so probe with deleteMessages which issues a fresh db.run against the closed db
    expect(() => c.deleteMessages(1, [1])).toThrow()
  })
})
