// Browser smoke for the static-client foundation. Two things cannot be checked from
// `bun test`, and both are load-bearing for the GitHub Pages plan:
//
//   1. the portable core actually runs in a browser (no Node/Bun API sneaks in through
//      @tg/core/cache-memory or @tg/core/search),
//   2. the IndexedDB store round-trips a snapshot across a page load,
//   3. a session sealed under a passphrase survives that load, opens with the right
//      passphrase, refuses the wrong one, and never lands in storage as plaintext.
//
// The page reports one line per check, so a browser driver only has to read text.
// Load it once to seed, then again: the second load must restore what the first saved.
import { createMemoryCache } from '@tg/core/cache-memory'
import { compilePattern, searchCache } from '@tg/core/search'
import { openSession, sealSession } from '../web/crypto'
import {
  clearCreds,
  clearSealedSession,
  clearSnapshot,
  loadCreds,
  loadSealedSession,
  loadSnapshot,
  saveCreds,
  saveSealedSession,
  saveSnapshot,
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
const CREDS = { apiId: 1234567, apiHash: '0123456789abcdef0123456789abcdef' }

async function main() {
  if (new URL(location.href).searchParams.has('reset')) {
    await Promise.all([clearSnapshot(), clearCreds(), clearSealedSession()])
  }
  const restored = await loadSnapshot()

  if (!restored) {
    const cache = createMemoryCache()
    cache.upsertChat(1, 'Alice')
    cache.upsertChat(-1000000000123, 'Channel')
    cache.insertMessages([...seed])
    await saveSnapshot(cache.snapshot())
    await saveCreds(CREDS)
    const sealed = await sealSession(SESSION, PASSPHRASE)
    await saveSealedSession(sealed)
    // the record IndexedDB now holds must not contain the session anywhere in it
    const raw = JSON.stringify(sealed, (_k, v) =>
      v instanceof Uint8Array ? [...v].map((b) => String.fromCharCode(b)).join('') : v,
    )
    report(!raw.includes('fake-exported-session'), 'stored session record holds no plaintext')
    report(cache.count() === 3, `seeded ${cache.count()} messages and saved a snapshot`)
    document.body.dataset.phase = 'seeded'
    return
  }

  const cache = createMemoryCache(restored)
  report(cache.count() === 3, `restored ${cache.count()} messages from IndexedDB`)

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

  const sealed = await loadSealedSession()
  report(sealed !== undefined, 'sealed session came back from IndexedDB')
  const opened = sealed && (await openSession(sealed, PASSPHRASE))
  report(opened === SESSION, 'the right passphrase decrypts the session')
  const refused = sealed && (await openSession(sealed, `${PASSPHRASE}!`))
  report(refused === null, 'the wrong passphrase is refused')

  document.body.dataset.phase = 'restored'
}

main().catch((e) => {
  report(false, `threw: ${e instanceof Error ? e.message : String(e)}`)
  document.body.dataset.phase = 'error'
})
