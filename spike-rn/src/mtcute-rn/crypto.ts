import type { IAesCtr, ICryptoProvider, IEncryptionScheme } from '@mtcute/core'
import { BaseCryptoProvider } from '@mtcute/core/utils.js'
import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2, randomFillSync } from 'react-native-quick-crypto'
import { deflate, inflate } from 'pako'
import { igeWith } from './ige'

// AES-256-IGE composed from single-block AES-ECB — the ONE piece @mtcute/wasm
// normally provides, and the highest-risk part of the spike (see ige.test.ts
// for the algorithm check; on-device the risk is quick-crypto's ECB behaviour).
function ige(key: Uint8Array, iv: Uint8Array, data: Uint8Array, decrypt: boolean): Uint8Array {
  // ECB ignores the IV, but quick-crypto (unlike Node) rejects `null` — pass an
  // empty TypedArray to satisfy its arg-type check without setting an IV.
  const noIv = new Uint8Array(0)
  const ecb = decrypt
    ? createDecipheriv('aes-256-ecb', key, noIv)
    : createCipheriv('aes-256-ecb', key, noIv)
  ecb.setAutoPadding(false)
  return igeWith((b) => ecb.update(b) as Uint8Array, iv, data, decrypt)
}

export class RNCryptoProvider extends BaseCryptoProvider implements ICryptoProvider {
  randomFill(buf: Uint8Array) {
    randomFillSync(buf)
  }

  sha1(data: Uint8Array): Uint8Array {
    return new Uint8Array(createHash('sha1').update(data).digest())
  }
  sha256(data: Uint8Array): Uint8Array {
    return new Uint8Array(createHash('sha256').update(data).digest())
  }
  hmacSha256(data: Uint8Array, key: Uint8Array): Uint8Array {
    return new Uint8Array(createHmac('sha256', key).update(data).digest())
  }
  pbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number, keylen = 64, algo = 'sha512') {
    return new Promise<Uint8Array>((resolve, reject) =>
      pbkdf2(password, salt, iterations, keylen, algo, (err: unknown, buf: Uint8Array) =>
        err ? reject(err) : resolve(new Uint8Array(buf)),
      ),
    )
  }

  createAesCtr(key: Uint8Array, iv: Uint8Array): IAesCtr {
    const cipher = createCipheriv(`aes-${key.length * 8}-ctr`, key, iv)
    return { process: (data) => cipher.update(data) as Uint8Array }
  }
  createAesIge(key: Uint8Array, iv: Uint8Array): IEncryptionScheme {
    return {
      encrypt: (data) => ige(key, iv, data, false),
      decrypt: (data) => ige(key, iv, data, true),
    }
  }

  // MTProto rarely gzips on the login/getMe path; wired via pako, VERIFY under load.
  gzip(data: Uint8Array, maxSize: number): Uint8Array | null {
    const out = deflate(data)
    return out.length > maxSize ? null : out
  }
  gunzip(data: Uint8Array): Uint8Array {
    return inflate(data) // auto-detects gzip/zlib headers
  }
  // factorizePQ + randomBytes inherited from BaseCryptoProvider (pure-JS Pollard-Rho-Brent).
}
