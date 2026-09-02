// Encryption at rest for the static client. Two things are stored and neither may sit in
// the clear: the Telegram session (a full credential for the account) and the message
// cache (the text of every chat). Both live in storage the device's owner — or anyone
// with the browser profile — can read.
//
// WebCrypto only, no dependency: PBKDF2-SHA256 over the passphrase → one AES-GCM key,
// derived once per page load and kept only in memory. The passphrase is never stored and
// there is deliberately no "remember me".
//
// One key for both records, because deriving twice buys nothing: the same passphrase
// unlocks both, and 250k iterations is a noticeable fraction of a second on an old phone.
// Each write gets a fresh IV — reusing one with the same key is what breaks GCM.
//
// What this does NOT protect against: script running in the page while it is unlocked.
// No browser client can, and the README says so plainly.
const VERSION = 1
const ITERATIONS = 250_000
const SALT_BYTES = 16
const IV_BYTES = 12 // AES-GCM's nominal nonce size

/** What gets stored. Structured-cloneable, so IndexedDB takes it as-is. */
export interface SealedBlob {
  version: number
  iterations: number
  // Uint8Array<ArrayBuffer>, not the default Uint8Array<ArrayBufferLike>: WebCrypto's
  // BufferSource excludes SharedArrayBuffer-backed views
  salt: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
}

/** The unlocked key, for as long as the page lives. */
export interface Vault {
  seal(plain: string): Promise<SealedBlob>
  /** Null on a wrong key or a tampered record — GCM cannot tell those apart. */
  open(sealed: SealedBlob): Promise<string | null>
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

// A record from a newer format must not masquerade as a wrong passphrase: that would send
// the user to "erase and start over" over what is really an outdated bundle.
function checkVersion(sealed: SealedBlob) {
  if (sealed.version !== VERSION) {
    throw new Error(`unsupported record format v${sealed.version}, this build reads v${VERSION}`)
  }
}

function makeVault(key: CryptoKey, salt: Uint8Array<ArrayBuffer>, iterations: number): Vault {
  return {
    async seal(plain) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(plain),
      )
      return { version: VERSION, iterations, salt, iv, ciphertext: new Uint8Array(ciphertext) }
    },

    async open(sealed) {
      checkVersion(sealed)
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
    },
  }
}

/** A brand-new passphrase: fresh salt, nothing to verify against yet. */
export async function createVault(passphrase: string): Promise<Vault> {
  if (!passphrase) throw new Error('a passphrase is required to store anything')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  return makeVault(await deriveKey(passphrase, salt, ITERATIONS), salt, ITERATIONS)
}

/**
 * Unlocks existing records: derives against the salt (and iteration count) they were
 * written with, and proves the passphrase by opening one of them. Null = wrong
 * passphrase, and the remedy — retry, or erase and log in again — is the same whether the
 * record is wrong or corrupt, so the two are not worth distinguishing.
 */
export async function unlockVault(passphrase: string, proof: SealedBlob): Promise<Vault | null> {
  checkVersion(proof)
  const vault = makeVault(
    await deriveKey(passphrase, proof.salt, proof.iterations),
    proof.salt,
    proof.iterations,
  )
  return (await vault.open(proof)) === null ? null : vault
}
