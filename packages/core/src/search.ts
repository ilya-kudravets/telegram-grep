// Domain: pattern compilation + cache scan. Portable — depends only on the Cache
// port, no filesystem. Loading the pattern list is a platform concern (adapters/*).
import type { Cache, SearchRow } from './cache'

// plain string → case-insensitive; '/pat/flags' → explicit; invalid → null
export function compilePattern(input: string): RegExp | null {
  const s = input.trim()
  if (!s) return null
  try {
    const m = s.match(/^\/(.+)\/([a-z]*)$/s)
    return m ? new RegExp(m[1]!, m[2]) : new RegExp(s, 'i')
  } catch {
    return null
  }
}

// ponytail: full JS scan, newest first; add LIKE-prefilter or FTS5 trigram if cache grows past ~3M rows
export function searchCache(cache: Cache, re: RegExp, limit = 1000): SearchRow[] {
  const out: SearchRow[] = []
  for (const row of cache.iterAll()) {
    re.lastIndex = 0 // /g|/y patterns keep state between test() calls
    if (re.test(row.text)) {
      out.push(row)
      if (out.length >= limit) break
    }
  }
  return out
}
