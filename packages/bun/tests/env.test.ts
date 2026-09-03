import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureEnvFile,
  packCreds,
  resolveCreds,
  searchKinds,
  syncChannels,
  unpackCreds,
} from '@tg/bun'

let dir: string
let envPath: string
let savedApiId: string | undefined
let savedApiHash: string | undefined
let savedBaked: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tg-env-'))
  envPath = join(dir, '.env')
  savedApiId = process.env.API_ID
  savedApiHash = process.env.API_HASH
  savedBaked = process.env.BAKED_CREDS
  delete process.env.API_ID
  delete process.env.API_HASH
  delete process.env.BAKED_CREDS
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (savedApiId === undefined) delete process.env.API_ID
  else process.env.API_ID = savedApiId
  if (savedApiHash === undefined) delete process.env.API_HASH
  else process.env.API_HASH = savedApiHash
  if (savedBaked === undefined) delete process.env.BAKED_CREDS
  else process.env.BAKED_CREDS = savedBaked
})

test('creates a template .env when none exists and no creds are in the environment', () => {
  expect(ensureEnvFile(envPath)).toBe(true)
  expect(readFileSync(envPath, 'utf8')).toContain('API_ID=')
})

test('leaves an existing .env alone', () => {
  writeFileSync(envPath, 'API_ID=1\nAPI_HASH=x\n')
  expect(ensureEnvFile(envPath)).toBe(false)
  expect(readFileSync(envPath, 'utf8')).toBe('API_ID=1\nAPI_HASH=x\n')
})

test('skips creation when creds are already supplied via real env vars', () => {
  process.env.API_ID = '1'
  process.env.API_HASH = 'x'
  expect(ensureEnvFile(envPath)).toBe(false)
  expect(existsSync(envPath)).toBe(false)
})

const baked = { apiId: '2', apiHash: 'baked' }

test('runtime credentials win over the ones baked into a published binary', () => {
  expect(resolveCreds({ API_ID: '1', API_HASH: 'live' }, baked)).toEqual({
    apiId: 1,
    apiHash: 'live',
  })
})

test('baked credentials are the fallback when the environment has none', () => {
  expect(resolveCreds({}, baked)).toEqual({ apiId: 2, apiHash: 'baked' })
})

test('with neither pair the id is not a number, which createClient rejects', () => {
  const { apiId, apiHash } = resolveCreds({}, {})
  expect(apiId).toBeNaN()
  expect(apiHash).toBeUndefined()
})

test('a baked-in binary needs no .env, so none is written', () => {
  expect(ensureEnvFile(envPath, { apiId: 2, apiHash: 'baked' })).toBe(false)
  expect(existsSync(envPath)).toBe(false)
})

test('a packed blob round-trips and carries neither value in the clear', () => {
  const packed = packCreds('111222', 'aabbccddeeff00112233445566778899')
  expect(packed).not.toContain('111222')
  expect(packed).not.toContain('aabbccddeeff00112233445566778899')
  expect(unpackCreds(packed)).toEqual({
    apiId: '111222',
    apiHash: 'aabbccddeeff00112233445566778899',
  })
})

test('an absent or corrupt blob degrades to no baked pair instead of throwing', () => {
  expect(unpackCreds()).toEqual({})
  expect(unpackCreds('not base64 !!')).toEqual({})
})

test('syncChannels opts in only on an exact 1', () => {
  expect(syncChannels({ SYNC_CHANNELS: '1' })).toBe(true)
  expect(syncChannels({ SYNC_CHANNELS: 'true' })).toBe(false)
  expect(syncChannels({})).toBe(false)
})

test('SEARCH_KINDS unset means no filter, so nothing is hidden by default', () => {
  expect(searchKinds({})).toBeUndefined()
})

test('SEARCH_KINDS parses a list and ignores names this build does not know', () => {
  expect(searchKinds({ SEARCH_KINDS: 'private,group' })).toEqual(new Set(['private', 'group']))
  expect(searchKinds({ SEARCH_KINDS: 'private,nonsense' })).toEqual(new Set(['private']))
  // an all-nonsense value yields an empty set, which searches only unlabelled chats —
  // deliberately not the same as "unset", so a typo is visible rather than silent
  expect(searchKinds({ SEARCH_KINDS: 'nonsense' })).toEqual(new Set())
})
