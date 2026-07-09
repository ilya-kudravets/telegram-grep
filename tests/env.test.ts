import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureEnvFile } from '../src/env'

let dir: string
let envPath: string
let savedApiId: string | undefined
let savedApiHash: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tg-env-'))
  envPath = join(dir, '.env')
  savedApiId = process.env.API_ID
  savedApiHash = process.env.API_HASH
  delete process.env.API_ID
  delete process.env.API_HASH
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (savedApiId === undefined) delete process.env.API_ID
  else process.env.API_ID = savedApiId
  if (savedApiHash === undefined) delete process.env.API_HASH
  else process.env.API_HASH = savedApiHash
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
