// Barrel kept for backwards-compatible imports (`./db`). The cache is now split
// into a domain port (core/cache) and platform adapters (adapters/*). Bun apps
// get the bun:sqlite adapter by default.

export { openCache } from './adapters/bun-sqlite'
export type { Cache, CachedMessage, SearchRow } from './core/cache'
