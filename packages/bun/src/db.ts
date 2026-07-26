// Barrel kept for backwards-compatible imports (`./db`). The cache port lives in
// @tg/core/cache; this couples it with the app's bun:sqlite platform adapter.

export type { Cache, CachedMessage, SearchRow } from '@tg/core/cache'
export { openCache } from './adapters/bun-sqlite'
