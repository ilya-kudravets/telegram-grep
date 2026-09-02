// Browser persistence for the in-memory Cache adapter's snapshot.
//
// IndexedDB rather than localStorage: a message archive blows past the ~5MB string
// quota, and structured clone stores the snapshot's arrays as-is, with no JSON
// round-trip. One store, one key — the snapshot is written and read whole, which is
// what makes the synchronous Cache port workable in a tab (see cache-memory.ts).
//
// ponytail: whole-snapshot writes. Fine while a save is milliseconds; switch to
// per-chat records if an archive ever makes the write visible.
import type { CacheSnapshot } from '@tg/core/cache-memory'
import type { SealedSession } from './crypto'

const DB_NAME = 'tg-client'
const STORE = 'cache'

// Three records in one store: the message cache, the app credentials the user typed,
// and the encrypted session. Kept separate so "forget my credentials" and "discard the
// session" don't take the archive with them.
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
export function loadSnapshot(): Promise<CacheSnapshot | undefined> {
  return run('readonly', (s) => s.get(KEY) as IDBRequest<CacheSnapshot | undefined>)
}

export async function saveSnapshot(snapshot: CacheSnapshot): Promise<void> {
  await run('readwrite', (s) => s.put(snapshot, KEY))
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
 * own storage driver out of the picture (it would write the session in the clear).
 */
export function loadSealedSession(): Promise<SealedSession | undefined> {
  return run('readonly', (s) => s.get(SESSION_KEY) as IDBRequest<SealedSession | undefined>)
}

export async function saveSealedSession(sealed: SealedSession): Promise<void> {
  await run('readwrite', (s) => s.put(sealed, SESSION_KEY))
}

export async function clearSealedSession(): Promise<void> {
  await run('readwrite', (s) => s.delete(SESSION_KEY))
}
