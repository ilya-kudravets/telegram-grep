import { expect, test } from 'bun:test'
import { openSession, sealSession } from '../web/crypto'

const SESSION = 'mtcute-session-string:AQAAAAAAAAA'

test('round-trips a session under the right passphrase', async () => {
  const sealed = await sealSession(SESSION, 'correct horse')
  expect(await openSession(sealed, 'correct horse')).toBe(SESSION)
})

test('the stored record contains no plaintext', async () => {
  const sealed = await sealSession(SESSION, 'pw')
  expect(new TextDecoder().decode(sealed.ciphertext)).not.toContain('mtcute')
})

test('a wrong passphrase yields null rather than garbage', async () => {
  const sealed = await sealSession(SESSION, 'right')
  expect(await openSession(sealed, 'wrong')).toBeNull()
})

test('tampered ciphertext fails authentication', async () => {
  const sealed = await sealSession(SESSION, 'pw')
  sealed.ciphertext[0] = (sealed.ciphertext[0] ?? 0) ^ 0xff
  expect(await openSession(sealed, 'pw')).toBeNull()
})

test('each write gets a fresh salt and iv', async () => {
  const a = await sealSession(SESSION, 'pw')
  const b = await sealSession(SESSION, 'pw')
  expect(a.salt).not.toEqual(b.salt)
  expect(a.iv).not.toEqual(b.iv)
  expect(a.ciphertext).not.toEqual(b.ciphertext) // same plaintext, different nonce
})

test('an empty passphrase is refused, not silently accepted', async () => {
  expect(sealSession(SESSION, '')).rejects.toThrow('passphrase is required')
})

test('a record from a newer format reports itself instead of looking like a bad passphrase', async () => {
  const sealed = await sealSession(SESSION, 'pw')
  expect(openSession({ ...sealed, version: 99 }, 'pw')).rejects.toThrow(
    'unsupported session format',
  )
})
