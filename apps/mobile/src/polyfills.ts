// This MODULE must be imported first (see App.tsx) — everything below patches globals
// that mtcute reads at import time. The order of the two imports here does not matter:
// `buffer` is a pure class definition with no module-scope global/crypto access, so
// biome is free to sort them. What is load-bearing is that install() runs before any
// code touches global.crypto, which the statement order below guarantees.
import { Buffer } from 'buffer'
import { install } from 'react-native-quick-crypto'

install() // sets global.crypto (getRandomValues, subtle) backed by native OpenSSL

// mtcute/fuman mostly use Uint8Array, but some paths still reach for Buffer.
globalThis.Buffer = globalThis.Buffer ?? Buffer

// Hermes ships TextEncoder/TextDecoder since RN 0.74; if your RN is older,
// VERIFY and add `text-encoding` here.

// mtcute's flood-control uses performance.now(); Hermes has no performance.now.
// biome-ignore lint/suspicious/noExplicitAny: patching host globals Hermes ships incomplete; a narrower type would be a cast pretending to be a contract
const g = globalThis as any
if (!g.performance) g.performance = {}
if (typeof g.performance.now !== 'function') g.performance.now = () => Date.now()

// RN's AbortSignal predates throwIfAborted() (used by mtcute flood-control).
if (g.AbortSignal && typeof g.AbortSignal.prototype.throwIfAborted !== 'function') {
  g.AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) throw this.reason ?? new Error('Aborted')
  }
}
