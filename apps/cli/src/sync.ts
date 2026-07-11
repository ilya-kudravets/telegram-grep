// Barrel kept for backwards-compatible imports (`./sync`). Sync is domain logic and
// now lives in core/sync — platform-agnostic (structural SyncClient, mtcute-core
// client type, no Bun/fs). Bun and RN apps both drive it with their own client.
export * from '@tg/core/sync'
