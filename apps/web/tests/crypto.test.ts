import { expect, test } from 'bun:test'
import { createVault, unlockVault } from '../web/crypto'

const SESSION = 'mtcute-session-string:AQAAAAAAAAA'
const CACHE = JSON.stringify({ chats: [[1, { title: 'Alice' }]], messages: [{ text: 'hunter2' }] })

test('round-trips a session under the right passphrase', async () => {
  const vault = await createVault('correct horse')
  const sealed = await vault.seal(SESSION, 'session')
  const reopened = await unlockVault('correct horse', sealed)
  expect(await reopened?.open(sealed, 'session')).toBe(SESSION)
})

test('one passphrase covers both records — session and cache', async () => {
  const vault = await createVault('pw')
  const session = await vault.seal(SESSION, 'session')
  const cache = await vault.seal(CACHE, 'snapshot')
  // the session record is the proof; the cache must open with the vault it yields
  const unlocked = await unlockVault('pw', session)
  expect(await unlocked?.open(cache, 'snapshot')).toBe(CACHE)
})

test('the stored records contain no plaintext', async () => {
  const vault = await createVault('pw')
  const session = await vault.seal(SESSION, 'session')
  const cache = await vault.seal(CACHE, 'snapshot')
  expect(new TextDecoder().decode(session.ciphertext)).not.toContain('mtcute')
  expect(new TextDecoder().decode(cache.ciphertext)).not.toContain('hunter2')
})

test('a wrong passphrase yields null rather than garbage', async () => {
  const vault = await createVault('right')
  expect(await unlockVault('wrong', await vault.seal(SESSION, 'session'))).toBeNull()
})

test('tampered ciphertext fails authentication', async () => {
  const vault = await createVault('pw')
  const sealed = await vault.seal(SESSION, 'session')
  sealed.ciphertext[0] = (sealed.ciphertext[0] ?? 0) ^ 0xff
  expect(await unlockVault('pw', sealed)).toBeNull()
})

test('each write gets a fresh iv, and each vault its own salt', async () => {
  const vault = await createVault('pw')
  const a = await vault.seal(SESSION, 'session')
  const b = await vault.seal(SESSION, 'session')
  expect(a.iv).not.toEqual(b.iv)
  expect(a.ciphertext).not.toEqual(b.ciphertext) // same plaintext, different nonce
  expect(a.salt).toEqual(b.salt) // one derived key per page, so one salt
  expect((await createVault('pw')).seal(SESSION, 'session')).resolves.not.toEqual(a)
})

test('an empty passphrase is refused, not silently accepted', async () => {
  expect(createVault('')).rejects.toThrow('passphrase is required')
})

test('a record from another format reports itself instead of looking like a bad passphrase', async () => {
  const vault = await createVault('pw')
  const sealed = await vault.seal(SESSION, 'session')
  expect(unlockVault('pw', { ...sealed, version: 99 })).rejects.toThrow('unsupported record format')
  expect(vault.open({ ...sealed, version: 99 }, 'session')).rejects.toThrow(
    'unsupported record format',
  )
  // v1 is the same shape but was written without the per-record additional data, so it
  // must be refused outright rather than decrypted into the wrong reader
  expect(unlockVault('pw', { ...sealed, version: 1 })).rejects.toThrow('unsupported record format')
})

// Someone with IndexedDB write access — an extension, another local process — copying one
// record over the other's slot must not get a reader that opens it.
test('a record sealed as one kind will not open as the other', async () => {
  const vault = await createVault('pw')
  const session = await vault.seal(SESSION, 'session')
  const cache = await vault.seal(CACHE, 'snapshot')
  expect(await vault.open(session, 'snapshot')).toBeNull()
  expect(await vault.open(cache, 'session')).toBeNull()
  // and the swap is not a passphrase problem either: the proof itself must be a session
  expect(await unlockVault('pw', cache)).toBeNull()
})

// An unvalidated count from storage is a denial of service: PBKDF2 over a crafted
// billion-iteration record simply never returns.
test('an out-of-range iteration count is an unopenable record, not a long wait', async () => {
  const vault = await createVault('pw')
  const sealed = await vault.seal(SESSION, 'session')
  for (const iterations of [1e12, 1_000_001, 99_999, 0, Number.NaN]) {
    expect(unlockVault('pw', { ...sealed, iterations })).rejects.toThrow('key iterations')
  }
  expect(
    unlockVault('pw', { ...sealed, iterations: undefined as unknown as number }),
  ).rejects.toThrow('key iterations')
})
