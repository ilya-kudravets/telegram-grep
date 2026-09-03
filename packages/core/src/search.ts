// Domain: pattern compilation + cache scan. Portable — depends only on the Cache
// port, no filesystem. Loading the pattern list is a platform concern (adapters/*).
import type { Cache, PeerKind, SearchRow } from './cache'

export const PEER_KINDS: PeerKind[] = ['saved', 'private', 'bot', 'group', 'channel']

/**
 * A comma-separated kinds list (`'private,group'`) → the set to search, or `undefined`
 * for no filter at all. Unknown names are dropped rather than rejected, so a stale
 * client or a typo in an env var degrades to a wider search instead of an error.
 */
export function parseKinds(raw: string | null | undefined): Set<PeerKind> | undefined {
  if (raw === null || raw === undefined) return undefined
  return new Set(raw.split(',').filter((k): k is PeerKind => (PEER_KINDS as string[]).includes(k)))
}

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

/**
 * `kinds` restricts which peers count — omit it for everything. An unlabelled chat
 * (`chat_kind: ''`, stored before kinds existed) always counts: dropping messages over a
 * missing label would read as data loss, and one sync fills the labels in.
 *
 * NB the filter runs *before* `limit`, not after. A cache dominated by one kind would
 * otherwise spend the whole budget on rows the caller asked to exclude and return a
 * near-empty result.
 */
// ponytail: full JS scan, newest first; add LIKE-prefilter or FTS5 trigram if cache grows past ~3M rows
export function searchCache(
  cache: Cache,
  re: RegExp,
  limit = 1000,
  kinds?: ReadonlySet<PeerKind>,
): SearchRow[] {
  const out: SearchRow[] = []
  for (const row of cache.iterAll()) {
    if (kinds && row.chat_kind && !kinds.has(row.chat_kind)) continue
    re.lastIndex = 0 // /g|/y patterns keep state between test() calls
    if (re.test(row.text)) {
      out.push(row)
      if (out.length >= limit) break
    }
  }
  return out
}
