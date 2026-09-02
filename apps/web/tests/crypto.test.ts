import { expect, test } from 'bun:test'
import { createVault, unlockVault } from '../web/crypto'

const SESSION = 'mtcute-session-string:AQAAAAAAAAA'
const CACHE = JSON.stringify({ chats: [[1, { title: 'Alice' }]], messages: [{ text: 'hunter2' }] })

test('round-trips a session under the right passphrase', async () => {
  const vault = await createVault('correct horse')
  const sealed = await vault.seal(SESSION)
  const reopened = await unlockVault('correct horse', sealed)
  expect(await reopened?.open(sealed)).toBe(SESSION)
})

test('one passphrase covers both records — session and cache', async () => {
  const vault = await createVault('pw')
  const session = await vault.seal(SESSION)
  const cache = await vault.seal(CACHE)
  // the session record is the proof; the cache must open with the vault it yields
  const unlocked = await unlockVault('pw', session)
  expect(await unlocked?.open(cache)).toBe(CACHE)
})

test('the stored records contain no plaintext', async () => {
  const vault = await createVault('pw')
  const session = await vault.seal(SESSION)
  const cache = await vault.seal(CACHE)
  expect(new TextDecoder().decode(session.ciphertext)).not.toContain('mtcute')
  expect(new TextDecoder().decode(cache.ciphertext)).not.toContain('hunter2')
})

test('a wrong passphrase yields null rather than garbage', async () => {
  const vault = await createVault('right')
  expect(await unlockVault('wrong', await vault.seal(SESSION))).toBeNull()
})

test('tampered ciphertext fails authentication', async () => {
  const vault = await createVault('pw')
  const sealed = await vault.seal(SESSION)
  sealed.ciphertext[0] = (sealed.ciphertext[0] ?? 0) ^ 0xff
  expect(await unlockVault('pw', sealed)).toBeNull()
})

test('each write gets a fresh iv, and each vault its own salt', async () => {
  const vault = await createVault('pw')
  const a = await vault.seal(SESSION)
  const b = await vault.seal(SESSION)
  expect(a.iv).not.toEqual(b.iv)
  expect(a.ciphertext).not.toEqual(b.ciphertext) // same plaintext, different nonce
  expect(a.salt).toEqual(b.salt) // one derived key per page, so one salt
  expect((await createVault('pw')).seal(SESSION)).resolves.not.toEqual(a)
})

test('an empty passphrase is refused, not silently accepted', async () => {
  expect(createVault('')).rejects.toThrow('passphrase is required')
})

test('a record from a newer format reports itself instead of looking like a bad passphrase', async () => {
  const vault = await createVault('pw')
  const sealed = await vault.seal(SESSION)
  expect(unlockVault('pw', { ...sealed, version: 99 })).rejects.toThrow('unsupported record format')
  expect(vault.open({ ...sealed, version: 99 })).rejects.toThrow('unsupported record format')
})
