// @tg/bun — the Bun platform layer shared by apps/cli (TUI + headless CLI) and
// apps/web (server). Implements the @tg/core ports on Bun: the bun:sqlite Cache
// adapter (db), the patterns.txt loader (search), the mtcute @mtcute/bun client
// + interactive login (client), and the .env bootstrap (env). Re-exports the
// portable sync/delete domain so app code has one import surface.

export * from '@tg/core/deleter'
export * from '@tg/core/sync'
export * from './client'
export * from './db'
export * from './env'
export * from './search'
