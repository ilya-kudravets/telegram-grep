// The browser data layer: @tg/core driven straight against Telegram from the tab, with
// no server anywhere. Same domain code the CLI and the Bun server run — the only
// platform pieces here are the in-memory Cache adapter and IndexedDB persistence.
//
// mtcute's own storage would write the session in the clear, so this uses MemoryStorage
// and owns persistence itself: `exportSession()` after a login, sealed under the user's
// passphrase (crypto.ts) before it ever reaches IndexedDB.
import { MemoryStorage, TelegramClient } from '@mtcute/web'
import { createMemoryCache } from '@tg/core/cache-memory'
import { deleteEverywhere } from '@tg/core/deleter'
import { compilePattern, searchCache } from '@tg/core/search'
import { attachRealtime, syncAll } from '@tg/core/sync'
import type { DataLayer, Status } from './app'
import { type AppCreds, loadSnapshot, saveSnapshot } from './store'

/** Interactive login callbacks — mtcute asks, the UI answers. */
export interface LoginPrompts {
  phone(): Promise<string>
  code(): Promise<string>
  password(): Promise<string>
}

export interface BrowserClient {
  /** What the shared UI talks to; identical surface to the server-backed one. */
  data: DataLayer
  /** Reconnects a stored session. Account name, or null if it no longer authorizes. */
  resume(session: string): Promise<string | null>
  /** Interactive login; the returned session string is what the caller seals and stores. */
  login(prompts: LoginPrompts): Promise<{ user: string; session: string }>
  /** Fire-and-forget: progress and failure land in the status stream. */
  sync(): void
}

const SAVE_DEBOUNCE = 1000

export async function createBrowserClient(creds: AppCreds): Promise<BrowserClient> {
  const cache = createMemoryCache(await loadSnapshot())
  const tg = new TelegramClient({
    apiId: creds.apiId,
    apiHash: creds.apiHash,
    storage: new MemoryStorage(),
  })
  tg.log.mgr.level = 1 // errors only; the default chats about every update in the console

  const status: Status = {
    sync: null,
    syncDone: false,
    error: '',
    flood: 0,
    cached: cache.count(),
    // no patterns.txt in a browser — the file-pattern shortcuts are a CLI/server feature
    patterns: [],
  }
  const listeners = new Set<(s: Status) => void>()
  // a fresh object per push: the view diffs `cached` and React compares by identity
  const publish = () => {
    status.cached = cache.count()
    for (const fn of listeners) fn({ ...status })
  }

  // A snapshot write is the whole cache, and sync reports every 500-message batch, so
  // writes are coalesced. flush() is the "must not lose this" path (sync end, delete).
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const persist = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveSnapshot(cache.snapshot()), SAVE_DEBOUNCE)
  }
  const flush = async () => {
    clearTimeout(saveTimer)
    await saveSnapshot(cache.snapshot())
  }

  // realtime updates + the updates loop, once an authorization exists
  async function attach() {
    attachRealtime(tg, cache, () => {
      persist()
      publish()
    })
    await tg.startUpdatesLoop()
  }

  return {
    data: {
      async search(query) {
        const re = compilePattern(query)
        // '' → the view shows its own "invalid regex"; matches what the API returns
        if (!re) return { error: '' }
        return { rows: searchCache(cache, re) }
      },

      async del(targets) {
        const res = await deleteEverywhere(tg, cache, targets)
        await flush()
        publish()
        return res
      },

      subscribeStatus(onStatus) {
        listeners.add(onStatus)
        onStatus({ ...status }) // the cache is already restored — don't make the view wait
        return () => listeners.delete(onStatus)
      },
    },

    // `start({session})` imports it and calls getMe; anything short of an authorized
    // account throws, and every one of those failures has the same remedy — log in
    // again — while the restored cache stays searchable offline either way.
    async resume(session) {
      try {
        const me = await tg.start({ session })
        await attach()
        return me.displayName
      } catch {
        return null
      }
    },

    async login(prompts) {
      const me = await tg.start({
        phone: () => prompts.phone(),
        code: () => prompts.code(),
        password: () => prompts.password(),
      })
      await attach()
      return { user: me.displayName, session: await tg.exportSession() }
    },

    sync() {
      status.syncDone = false
      status.error = ''
      syncAll(tg, cache, (p) => {
        status.sync = { ...p }
        // reuse the flood display without the server's onFlood hook — syncAll already
        // reports the wait it is sleeping through
        status.flood = p.floodWait ?? 0
        persist()
        publish()
      })
        .then(() => {
          status.syncDone = true
        })
        .catch((e) => {
          status.error = e instanceof Error ? e.message : String(e)
        })
        .finally(async () => {
          await flush()
          publish()
        })
    },
  }
}
