// MUST be imported first, before anything touches crypto/Buffer.
import { install } from 'react-native-quick-crypto'
import { Buffer } from 'buffer'

install() // sets global.crypto (getRandomValues, subtle) backed by native OpenSSL

// mtcute/fuman mostly use Uint8Array, but some paths still reach for Buffer.
globalThis.Buffer = globalThis.Buffer ?? Buffer

// Hermes ships TextEncoder/TextDecoder since RN 0.74; if your RN is older,
// VERIFY and add `text-encoding` here.

// mtcute's flood-control uses performance.now(); Hermes has no performance.now.
const g = globalThis as any
if (!g.performance) g.performance = {}
if (typeof g.performance.now !== 'function') g.performance.now = () => Date.now()

// RN's AbortSignal predates throwIfAborted() (used by mtcute flood-control).
if (g.AbortSignal && typeof g.AbortSignal.prototype.throwIfAborted !== 'function') {
  g.AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) throw this.reason ?? new Error('Aborted')
  }
}
