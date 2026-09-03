import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type CachedMessage,
  compilePattern,
  loadPatterns,
  openCache,
  searchCache,
  watchPatterns,
} from '@tg/bun'

describe('compilePattern', () => {
  test('plain string is case-insensitive', () => {
    const re = compilePattern('Hello')!
    expect(re.test('say hello!')).toBe(true)
  })

  test('/pat/flags form respected', () => {
    const re = compilePattern('/^spam$/m')!
    expect(re.flags).toBe('m')
    expect(re.test('x\nspam\ny')).toBe(true)
    expect(compilePattern('/CaseSensitive/')!.test('casesensitive')).toBe(false)
  })

  test('invalid regex and empty input give null', () => {
    expect(compilePattern('([')).toBeNull()
    expect(compilePattern('   ')).toBeNull()
  })

  test('mid-string slashes are not a /pat/flags regex', () => {
    expect(compilePattern('a/b/')!.test('b')).toBe(false)
  })

  test('flags must be anchored to the end', () => {
    const re = compilePattern('/foo/i extra')!
    expect(re).not.toBeNull()
    expect(re.test('foobar')).toBe(false)
    expect(re.test('/foo/i extra')).toBe(true)
  })

  test('multiple flag characters are captured', () => {
    expect(compilePattern('/foo/gi')!.flags).toBe('gi')
  })
})

function seeded(texts: string[]) {
  const c = openCache(':memory:')
  c.upsertChat(1, 'Chat')
  c.insertMessages(
    texts.map(
      (text, i): CachedMessage => ({
        chat_id: 1,
        id: i + 1,
        date: 1700000000 + i,
        sender: 'A',
        text,
        out: 0,
      }),
    ),
  )
  return c
}

describe('searchCache', () => {
  test('matches by regex, newest first', () => {
    const c = seeded(['foo bar', 'nothing', 'foo baz'])
    const rows = searchCache(c, /foo/)
    expect(rows.map((r) => r.text)).toEqual(['foo baz', 'foo bar'])
  })

  test('global flag does not skip rows via lastIndex state', () => {
    const c = seeded(['abc', 'abc', 'abc'])
    expect(searchCache(c, /abc/g)).toHaveLength(3)
  })

  test('limit caps results', () => {
    const c = seeded(Array.from({ length: 10 }, (_, i) => `msg ${i}`))
    expect(searchCache(c, /msg/, 3)).toHaveLength(3)
  })

  describe('kinds filter', () => {
    // one hit per bucket, plus one in a chat the cache has no label for
    function mixed() {
      const c = openCache(':memory:')
      c.upsertChat(1, 'Private', 'private')
      c.upsertChat(2, 'Group', 'group')
      c.upsertChat(3, 'Channel', 'channel')
      c.upsertChat(4, 'Unlabelled')
      c.insertMessages(
        [1, 2, 3, 4].map(
          (chat_id): CachedMessage => ({
            chat_id,
            id: chat_id,
            date: 1700000000 + chat_id,
            sender: 'A',
            text: 'hit',
            out: 0,
          }),
        ),
      )
      return c
    }

    test('no set searches everything', () => {
      expect(searchCache(mixed(), /hit/)).toHaveLength(4)
    })

    test('only the chosen kinds count', () => {
      const rows = searchCache(mixed(), /hit/, undefined, new Set(['private', 'group'] as const))
      // the unlabelled chat rides along — see searchCache's contract
      expect(rows.map((r) => r.chat_title).sort()).toEqual(['Group', 'Private', 'Unlabelled'])
    })

    test('an unlabelled chat is never filtered out, even by an empty set', () => {
      const rows = searchCache(mixed(), /hit/, undefined, new Set())
      expect(rows.map((r) => r.chat_title)).toEqual(['Unlabelled'])
    })

    test('the filter runs before the limit, so excluded rows do not eat the budget', () => {
      const c = openCache(':memory:')
      c.upsertChat(1, 'Channel', 'channel')
      c.upsertChat(2, 'Private', 'private')
      // 20 newer channel hits sit ahead of the two private ones in date order
      c.insertMessages(
        Array.from(
          { length: 20 },
          (_, i): CachedMessage => ({
            chat_id: 1,
            id: i + 1,
            date: 1700001000 + i,
            sender: 'A',
            text: 'hit',
            out: 0,
          }),
        ),
      )
      c.insertMessages([
        { chat_id: 2, id: 1, date: 1700000001, sender: 'A', text: 'hit', out: 0 },
        { chat_id: 2, id: 2, date: 1700000002, sender: 'A', text: 'hit', out: 0 },
      ])
      const rows = searchCache(c, /hit/, 2, new Set(['private'] as const))
      expect(rows.map((r) => r.chat_id)).toEqual([2, 2])
    })
  })
})

describe('loadPatterns', () => {
  test('skips comments and blank lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tgc-'))
    const file = join(dir, 'patterns.txt')
    writeFileSync(file, '# comment\n\nfoo\\d+\n  /bar/i  \n')
    expect(loadPatterns(file)).toEqual(['foo\\d+', '/bar/i'])
  })

  test('missing file gives empty list', () => {
    expect(loadPatterns('/nonexistent/patterns.txt')).toEqual([])
  })
})

describe('watchPatterns', () => {
  test('fires onChange with freshly loaded patterns when the file changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tgc-'))
    const file = join(dir, 'patterns.txt')
    writeFileSync(file, 'foo\n')
    const got = new Promise<string[]>((resolve) => {
      const w = watchPatterns(file, (p) => {
        // ignore the spurious initial event fsevents may deliver on attach ('foo')
        if (p.length === 2) {
          w.close()
          resolve(p)
        }
      })
      // let the watcher attach before the write
      setTimeout(() => writeFileSync(file, 'bar\nbaz\n'), 30)
    })
    expect(await got).toEqual(['bar', 'baz'])
  })

  test('missing file does not throw, and returns a closeable no-op watcher', () => {
    expect(() => watchPatterns('/nonexistent/patterns.txt', () => {}).close()).not.toThrow()
  })
})
