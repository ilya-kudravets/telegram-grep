// The browser data layer: @tg/core driven straight against Telegram from the tab, with
// no server anywhere. Same domain code the CLI and the Bun server run — the only
// platform pieces here are the in-memory Cache adapter and IndexedDB persistence.
//
// mtcute's own storage would write the session in the clear, so this uses MemoryStorage
// and owns persistence itself: `exportSession()` after a login, sealed under the user's
// passphrase (crypto.ts) before it ever reaches IndexedDB. The cache snapshot goes
// through the same vault — message text is exactly as worth encrypting as the session.
import wasmUrl from '@mtcute/wasm/mtcute.wasm' with { type: 'file' }
import { MemoryStorage, TelegramClient, WebCryptoProvider } from '@mtcute/web'
import { type CacheSnapshot, createMemoryCache } from '@tg/core/cache-memory'
import { deleteEverywhere } from '@tg/core/deleter'
import { compilePattern, searchCache } from '@tg/core/search'
import { attachRealtime, syncAll } from '@tg/core/sync'
import type { DataLayer, Status } from './app'
import type { SealedBlob, Vault } from './crypto'
import { type AppCreds, loadSealedSnapshot, saveSealedSnapshot } from './store'

/** Interactive login callbacks — mtcute asks, the UI answers. */
export interface LoginPrompts {
  phone(): Promise<string>
  code(): Promise<string>
  password(): Promise<string>
  /**
   * What Telegram says it did with the code. Worth showing all of it: `via: 'app'` means
   * it went into Telegram on another device the user is logged in on, *not* by SMS — the
   * single most common reason someone concludes the code never arrived — and
   * `nextVia`/`retryInSeconds` are the only signal available when Telegram accepts the
   * request but silently declines to deliver (its anti-abuse limit reports nothing).
   * mtcute's default for this is a console.log nobody in a browser will ever see.
   */
  codeSent?(info: { via: string; nextVia: string; retryInSeconds: number }): void
  /** What was just entered got rejected and mtcute is asking again — say so, or the form
   * silently reappearing looks like nothing happened. */
  rejected?(what: 'code' | 'password'): void
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
  /** Revokes this session on Telegram's side. Throws if the call fails — the caller
   * decides whether to wipe local storage anyway. */
  logout(): Promise<void>
  /** Seals a string with the same vault the cache uses — the caller stores the session
   * string, and has no business holding a second key to do it. */
  seal(plain: string): Promise<SealedBlob>
  /**
   * Stops writing, permanently, and tears down the client. Call it before wiping storage:
   * a navigation does not stop this document, so a debounced snapshot save queued before
   * an erase would otherwise land after it, recreate the database, and put the whole
   * archive back sealed under a key nothing will ever ask for again.
   */
  stop(): Promise<void>
}

const SAVE_DEBOUNCE = 1000

/**
 * A snapshot the vault cannot open — a passphrase that has since changed, a record from an
 * older format, one swapped in from the session slot — is not an error worth stopping for:
 * start empty and let the next sync refill it. The plaintext must never reach an error
 * path either: a `JSON.parse` failure puts the text it choked on into its own message, and
 * the gate renders messages on screen.
 */
async function restoreSnapshot(vault: Vault): Promise<CacheSnapshot | undefined> {
  try {
    const sealed = await loadSealedSnapshot()
    const plain = sealed && (await vault.open(sealed, 'snapshot'))
    return plain ? (JSON.parse(plain) as CacheSnapshot) : undefined
  } catch {
    return undefined
  }
}

export async function createBrowserClient(creds: AppCreds, vault: Vault): Promise<BrowserClient> {
  const cache = createMemoryCache(await restoreSnapshot(vault))
  const tg = new TelegramClient({
    apiId: creds.apiId,
    apiHash: creds.apiHash,
    storage: new MemoryStorage(),
    // mtcute fetches its wasm blob from `new URL('./mtcute.wasm', import.meta.url)`,
    // which after bundling points at the bundle's own directory — a 404 that surfaces
    // as "expected magic word". Import it as an asset instead, so the bundler emits it
    // and hands us the URL it actually lives at.
    crypto: new WebCryptoProvider({ wasmInput: wasmUrl }),
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
  // `stopped` is checked on both sides of the seal: sealing yields, and stop() landing in
  // that window must still keep the write from reaching a wiped database.
  let stopped = false
  const store = async () => {
    if (stopped) return
    const sealed = await vault.seal(JSON.stringify(cache.snapshot()), 'snapshot')
    if (stopped) return
    await saveSealedSnapshot(sealed)
  }
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const persist = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void store(), SAVE_DEBOUNCE)
  }
  const flush = async () => {
    clearTimeout(saveTimer)
    await store()
  }

  let running = false
  function doSync() {
    if (running) return
    running = true
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
        running = false
        await flush()
        publish()
      })
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
      async search(query, kinds) {
        const re = compilePattern(query)
        // '' → the view shows its own "invalid regex"; matches what the API returns
        if (!re) return { error: '' }
        return { rows: searchCache(cache, re, undefined, new Set(kinds)) }
      },

      async del(targets) {
        const res = await deleteEverywhere(tg, cache, targets)
        await flush()
        publish()
        return res
      },

      async resync() {
        if (running) return // an in-flight walk owns the cursors we are about to clear
        cache.resetSyncState()
        await flush() // the cleared bookkeeping must outlive a reload, or a refresh resumes the old walk
        doSync()
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
        codeSentCallback: (sent) =>
          prompts.codeSent?.({
            via: sent.type,
            nextVia: sent.nextType,
            retryInSeconds: sent.timeout,
          }),
        invalidCodeCallback: (what) => prompts.rejected?.(what),
      })
      await attach()
      return { user: me.displayName, session: await tg.exportSession() }
    },

    async logout() {
      await tg.logOut()
    },

    async stop() {
      stopped = true
      clearTimeout(saveTimer)
      // destroy() ends the updates loop and the connection, so no realtime handler calls
      // persist() again. Failures are swallowed: an erase has to work with no network,
      // and the flag above has already made a write impossible either way.
      await tg.destroy().catch(() => {})
    },

    seal: (plain) => vault.seal(plain, 'session'),

    sync: doSync,
  }
}
