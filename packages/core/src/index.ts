// @tg/core — the portable Telegram-client domain: message cache port, regex
// search, history sync, delete-everywhere, and shared i18n. No platform code
// (no Bun, no fs) — the Bun app and the RN app both drive it with their own
// Cache adapter and mtcute client. Subpath exports (@tg/core/sync, …) mirror
// the file layout; this barrel re-exports everything for convenience.
export * from './cache'
export * from './deleter'
export * from './i18n'
export * from './search'
export * from './sync'
