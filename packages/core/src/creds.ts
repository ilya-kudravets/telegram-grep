// Packing for a baked-in application id/hash pair. Portable on purpose: the CLI bakes
// one into its binary (`make build-public`) and the static web build bakes one into its
// bundle (`make pages`), so the packing has to live where both can reach it.
//
// The pair travels as one blob so a published artifact carries neither an
// `api_hash`-shaped string nor a variable named after one.
//
// ponytail: XOR+base64 is obfuscation, NOT encryption, and the distinction matters. It
// exists to stop bots that grep public artifacts for a 32-hex api_hash; anyone with a
// debugger — or, in a browser bundle, DevTools — reads the unpacked pair in seconds.
// Never treat a baked id as secret: register one for distribution, keep it separate from
// the app id you use yourself, and rotate it if it gets flagged.
const SALT = 'tg-client'
const xor = (s: string) =>
  Array.from(s, (c, i) =>
    String.fromCharCode(c.charCodeAt(0) ^ SALT.charCodeAt(i % SALT.length)),
  ).join('')

export const packCreds = (apiId: string, apiHash: string) => btoa(xor(`${apiId}:${apiHash}`))

export function unpackCreds(packed?: string): { apiId?: string; apiHash?: string } {
  if (!packed) return {}
  try {
    const [apiId, apiHash] = xor(atob(packed)).split(':')
    return { apiId, apiHash }
  } catch {
    return {} // a corrupt blob must degrade to "bring your own key", not crash on import
  }
}
