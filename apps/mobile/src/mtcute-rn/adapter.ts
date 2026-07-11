import type { ICorePlatform, IPacketCodec, TelegramTransport } from '@mtcute/core'
import type { BasicDcOption } from '@mtcute/core/utils.js'
import { IntermediatePacketCodec, MemoryStorage, ObfuscatedPacketCodec } from '@mtcute/core'
// BaseTelegramClient/TelegramClient live in /client.js, NOT the root (root → undefined).
import { BaseTelegramClient, TelegramClient } from '@mtcute/core/client.js'
import { connectWs } from '@fuman/net'
import { Platform } from 'react-native'
import { RNCryptoProvider } from './crypto'

// Minimal ICorePlatform — mirror of BunPlatform without node:os/exit hooks.
class RNPlatform implements ICorePlatform {
  getDeviceModel() {
    return `mtcute-rn/${Platform.OS} ${Platform.Version}`
  }
  getDefaultLogLevel() {
    return __DEV__ ? 3 : 1
  }
  log(_color: number, level: number, tag: string, fmt: string, args: unknown[]) {
    ;(level <= 1 ? console.error : console.log)(`[${tag}] ${fmt}`, ...args)
  }
  beforeExit(_fn: () => void) {
    return () => {} // no process lifecycle in RN
  }
}

// WebSocket transport (raw TCP can skip obfuscation; WS to Telegram requires it).
// Verified: connects to a real DC and completes the MTProto auth-key handshake in RN.
const SUBDOMAIN: Record<number, string> = { 1: 'pluto', 2: 'venus', 3: 'aurora', 4: 'vesta', 5: 'flora' }
class WebSocketTransport implements TelegramTransport {
  async connect(dc: BasicDcOption) {
    const sub = SUBDOMAIN[dc.id] ?? 'venus'
    return connectWs({ url: `wss://${sub}.web.telegram.org/apiws`, protocols: 'binary' })
  }
  packetCodec(): IPacketCodec {
    return new ObfuscatedPacketCodec(new IntermediatePacketCodec())
  }
}

// Assemble a client the same way @mtcute/bun does, with the RN adapters and
// in-memory storage (spike: session isn't persisted — swap MemoryStorage for an
// op-sqlite storage once auth is proven).
export function createClient(apiId: number, apiHash: string) {
  const base = new BaseTelegramClient({
    apiId,
    apiHash,
    crypto: new RNCryptoProvider(),
    transport: new WebSocketTransport(),
    platform: new RNPlatform(),
    storage: new MemoryStorage(),
  })
  return new TelegramClient({ client: base })
}
