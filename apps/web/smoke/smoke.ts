// Browser smoke for the static client's storage layer. Three things cannot be checked
// from `bun test`, and all are load-bearing for the GitHub Pages build:
//
//   1. the portable core actually runs in a browser (no Node/Bun API sneaks in through
//      @tg/core/cache-memory or @tg/core/search),
//   2. the cache and the session survive a page load through IndexedDB,
//   3. both are stored as ciphertext: the right passphrase opens them, the wrong one is
//      refused, and neither record holds readable message text or a session string.
//
// The page reports one line per check, so a browser driver only has to read text.
// Load it once to seed, then again: the second load must restore what the first saved.
import { createMemoryCache } from '@tg/core/cache-memory'
import { compilePattern, searchCache } from '@tg/core/search'
import { createVault, type SealedBlob, unlockVault } from '../web/crypto'
import {
  type AppCreds,
  loadCreds,
  loadSealedSession,
  loadSealedSnapshot,
  saveCreds,
  saveSealedSession,
  saveSealedSnapshot,
  wipeAll,
} from '../web/store'

const log = document.getElementById('log') as HTMLElement
const report = (ok: boolean, line: string) => {
  const el = document.createElement('div')
  el.textContent = `${ok ? 'PASS' : 'FAIL'} ${line}`
  el.dataset.ok = String(ok)
  log.append(el)
  return ok
}

const seed = [
  { chat_id: 1, id: 10, date: 1700000001, sender: 'Alice', text: 'my password is hunter2', out: 0 },
  { chat_id: 1, id: 11, date: 1700000002, sender: 'Bob', text: 'nothing to see', out: 1 },
  {
    chat_id: -1000000000123,
    id: 5,
    date: 1700000003,
    sender: 'Chan',
    text: 'API_TOKEN=abc',
    out: 0,
  },
] as const

// stand-ins for a real mtcute session string and the user's own application pair
const SESSION = `fake-exported-session:${'x'.repeat(64)}`
const PASSPHRASE = 'correct horse battery staple'
const CREDS: AppCreds = { apiId: 1234567, apiHash: '0123456789abcdef0123456789abcdef' }

// what IndexedDB actually holds, as a string a check can search for plaintext in
const asText = (sealed: SealedBlob) =>
  JSON.stringify(sealed, (_k, v) =>
    v instanceof Uint8Array ? [...v].map((b) => String.fromCharCode(b)).join('') : v,
  )

async function main() {
  if (new URL(location.href).searchParams.has('reset')) await wipeAll()
  const storedSnapshot = await loadSealedSnapshot()

  if (!storedSnapshot) {
    const cache = createMemoryCache()
    cache.upsertChat(1, 'Alice')
    cache.upsertChat(-1000000000123, 'Channel')
    cache.insertMessages([...seed])

    const vault = await createVault(PASSPHRASE)
    const sealedCache = await vault.seal(JSON.stringify(cache.snapshot()), 'snapshot')
    const sealedSession = await vault.seal(SESSION, 'session')
    await saveSealedSnapshot(sealedCache)
    await saveSealedSession(sealedSession)
    await saveCreds(CREDS)

    report(cache.count() === 3, `seeded ${cache.count()} messages and sealed a snapshot`)
    report(!asText(sealedCache).includes('hunter2'), 'stored cache record holds no message text')
    report(
      !asText(sealedSession).includes('fake-exported-session'),
      'stored session record holds no plaintext',
    )
    document.body.dataset.phase = 'seeded'
    return
  }

  const sealedSession = await loadSealedSession()
  report(sealedSession !== undefined, 'sealed session came back from IndexedDB')
  if (!sealedSession) {
    document.body.dataset.phase = 'error'
    return
  }

  report(
    (await unlockVault(`${PASSPHRASE}!`, sealedSession)) === null,
    'the wrong passphrase is refused',
  )

  const vault = await unlockVault(PASSPHRASE, sealedSession)
  report(vault !== null, 'the right passphrase unlocks the vault')
  if (!vault) {
    document.body.dataset.phase = 'error'
    return
  }
  report(
    (await vault.open(sealedSession, 'session')) === SESSION,
    'the session decrypts to what was stored',
  )
  // each record names itself in GCM's additional data, so the two are not interchangeable
  report(
    (await vault.open(sealedSession, 'snapshot')) === null,
    'the session record is refused when read as a snapshot',
  )

  const restored = await vault.open(storedSnapshot, 'snapshot')
  report(restored !== null, 'the cache decrypts with the same key as the session')
  const cache = createMemoryCache(restored ? JSON.parse(restored) : undefined)
  report(cache.count() === 3, `restored ${cache.count()} messages from the sealed snapshot`)

  const newestFirst = [...cache.iterAll()].map((r) => r.id)
  report(
    String(newestFirst) === String([5, 11, 10]),
    `iterAll is newest-first after a reload: ${newestFirst}`,
  )

  const titled = [...cache.iterAll()].every((r) => r.chat_title !== '')
  report(titled, 'chat titles survived the round-trip')

  const hits = searchCache(cache, compilePattern('/password|token/i')!)
  report(hits.length === 2, `regex search over the restored cache found ${hits.length} of 2`)

  const state = cache.backfillState(1)
  report(!state.backfilled, 'per-chat sync state came back intact')

  const creds = await loadCreds()
  report(
    creds?.apiId === CREDS.apiId && creds?.apiHash === CREDS.apiHash,
    'application credentials survived the reload',
  )

  document.body.dataset.phase = 'restored'
}

main().catch((e) => {
  report(false, `threw: ${e instanceof Error ? e.message : String(e)}`)
  document.body.dataset.phase = 'error'
})
