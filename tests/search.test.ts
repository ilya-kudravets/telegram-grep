import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCache, type CachedMessage } from '../src/db'
import { compilePattern, loadPatterns, searchCache, watchPatterns } from '../src/search'

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
})
