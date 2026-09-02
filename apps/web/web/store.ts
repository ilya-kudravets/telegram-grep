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

const DB_NAME = 'tg-client'
const STORE = 'cache'
const KEY = 'snapshot'

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
