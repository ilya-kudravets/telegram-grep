// Browser persistence for the static client.
//
// IndexedDB rather than localStorage: a message archive blows past the ~5MB string
// quota. Both stored payloads are ciphertext (see crypto.ts) — the cache snapshot is
// sealed as JSON, so structured clone only has to carry the byte arrays.
//
// ponytail: whole-snapshot writes, re-sealed each time. Fine while a save is
// milliseconds; switch to per-chat records if an archive ever makes the write visible.
import type { SealedBlob } from './crypto'

const DB_NAME = 'tg-client'
const STORE = 'cache'

// Three records in one store: the message cache, the app credentials, and the session.
// The credentials are the only one stored in the clear — they are not secret from the
// person who typed them, and they are what the client needs before any passphrase
// exists. Cache and session are sealed under the same key.
const KEY = 'snapshot'
const CREDS_KEY = 'creds'
const SESSION_KEY = 'session'

/** The user's own Telegram application credentials — never shipped in the bundle. */
export interface AppCreds {
  apiId: number
  apiHash: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// One request per transaction, and the connection closes with it: a leaked open
// connection blocks the next version upgrade in another tab.
async function run<T>(
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = request(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** Undefined on a first launch — the caller starts with an empty cache. */
export function loadSealedSnapshot(): Promise<SealedBlob | undefined> {
  return run('readonly', (s) => s.get(KEY) as IDBRequest<SealedBlob | undefined>)
}

export async function saveSealedSnapshot(sealed: SealedBlob): Promise<void> {
  await run('readwrite', (s) => s.put(sealed, KEY))
}

export async function clearSnapshot(): Promise<void> {
  await run('readwrite', (s) => s.delete(KEY))
}

/** Undefined until the first-run form is filled in. */
export function loadCreds(): Promise<AppCreds | undefined> {
  return run('readonly', (s) => s.get(CREDS_KEY) as IDBRequest<AppCreds | undefined>)
}

export async function saveCreds(creds: AppCreds): Promise<void> {
  await run('readwrite', (s) => s.put(creds, CREDS_KEY))
}

export async function clearCreds(): Promise<void> {
  await run('readwrite', (s) => s.delete(CREDS_KEY))
}

/**
 * The session as stored: ciphertext plus its salt and IV. Reading this record gives an
 * attacker nothing without the passphrase, which is the whole point of keeping mtcute's
 * own storage driver out of the picture (it would write the session in the clear). It
 * doubles as the proof record `unlockVault` opens to check a passphrase.
 */
export function loadSealedSession(): Promise<SealedBlob | undefined> {
  return run('readonly', (s) => s.get(SESSION_KEY) as IDBRequest<SealedBlob | undefined>)
}

export async function saveSealedSession(sealed: SealedBlob): Promise<void> {
  await run('readwrite', (s) => s.put(sealed, SESSION_KEY))
}

/**
 * Drops the session *and* the cache: both are sealed under the key the session record
 * proves, so a cache left behind would be unreadable anyway.
 */
export async function clearSealedSession(): Promise<void> {
  await run('readwrite', (s) => s.delete(SESSION_KEY))
  await clearSnapshot()
}

/**
 * Everything this origin holds, gone: the database itself plus the handful of UI
 * preferences in localStorage. Used by "erase all data", which must work even when
 * nothing can be unlocked.
 */
export async function wipeAll(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    // `run` closes its connection per request, so blocked can only mean another tab is
    // holding one open — and that tab goes on writing snapshots. Reporting success there
    // would tell the user the archive is gone while it is not.
    req.onblocked = () =>
      reject(new Error('another tab has this data open — close it and erase again'))
  })
  localStorage.clear() // last: a failed wipe should not still have dropped the UI prefs
}
