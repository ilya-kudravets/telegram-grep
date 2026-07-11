// Tiny shared i18n. Translations live in ./locales/*.ts (one file per language).
// Shared by the TUI/CLI (Bun) and the web bundle (browser).
import { type Dict, en, type Key } from './locales/en'
import { ru } from './locales/ru'

export type Lang = 'en' | 'ru'
export const LANGS: Lang[] = ['en', 'ru']

// en is the complete base; other locales are Partial and fall back to it
const dict: Record<Lang, Partial<Dict>> = { en, ru }

export function normalizeLang(raw: string | undefined | null): Lang | undefined {
  if (!raw) return undefined
  const code = raw.toLowerCase().slice(0, 2)
  return (LANGS as string[]).includes(code) ? (code as Lang) : undefined
}

// server/CLI: TG_LANG overrides, else LC_ALL/LC_MESSAGES/LANG, else English
export function detectLangEnv(env: Record<string, string | undefined> = process.env): Lang {
  return (
    normalizeLang(env.TG_LANG) ??
    normalizeLang(env.LC_ALL) ??
    normalizeLang(env.LC_MESSAGES) ??
    normalizeLang(env.LANG) ??
    'en'
  )
}

export function makeT(lang: Lang) {
  const table = dict[lang] ?? en
  return (key: Key, ...args: (string | number)[]): string =>
    (table[key] ?? en[key] ?? key).replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''))
}

export type T = ReturnType<typeof makeT>
