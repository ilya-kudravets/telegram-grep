// Session encryption for the static client. The stored Telegram session is a full
// credential for the account, and in a browser it sits in storage the device's owner
// (or anyone with the profile) can read — so it is never written in the clear.
//
// WebCrypto only, no dependency: PBKDF2-SHA256 over the passphrase → AES-GCM key.
// The passphrase and the derived key exist only in page memory; nothing here persists
// anything, and there is deliberately no "remember me".
//
// What this does NOT protect against: script running in the page while it is unlocked.
// No browser client can, and the README says so plainly.
const VERSION = 1
const ITERATIONS = 250_000
const SALT_BYTES = 16
const IV_BYTES = 12 // AES-GCM's nominal nonce size

/** What gets stored. Structured-cloneable, so IndexedDB takes it as-is. */
export interface SealedSession {
  version: number
  iterations: number
  // Uint8Array<ArrayBuffer>, not the default Uint8Array<ArrayBufferLike>: WebCrypto's
  // BufferSource excludes SharedArrayBuffer-backed views
  salt: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false, // non-extractable: the passphrase must not be readable back out of the key
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** A fresh salt and IV per write: reusing either with one key is what breaks GCM. */
export async function sealSession(session: string, passphrase: string): Promise<SealedSession> {
  if (!passphrase) throw new Error('a passphrase is required to store a session')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(session),
  )
  return {
    version: VERSION,
    iterations: ITERATIONS,
    salt,
    iv,
    ciphertext: new Uint8Array(ciphertext),
  }
}

/**
 * Null on a wrong passphrase. GCM authenticates the ciphertext, so a bad key and a
 * tampered record fail the same way — and the remedy is the same too (retry, or discard
 * the session and log in again), so they are not worth distinguishing.
 */
export async function openSession(
  sealed: SealedSession,
  passphrase: string,
): Promise<string | null> {
  // A record from a newer format must not masquerade as a wrong passphrase: that would
  // send the user to "discard and log in again" over what is really an outdated bundle.
  if (sealed.version !== VERSION) {
    throw new Error(`unsupported session format v${sealed.version}, this build reads v${VERSION}`)
  }
  const key = await deriveKey(passphrase, sealed.salt, sealed.iterations)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.iv },
      key,
      sealed.ciphertext,
    )
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}
