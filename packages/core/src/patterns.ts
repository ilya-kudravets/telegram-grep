// Ready-made search templates: the things people regret having sent. Portable, so the
// TUI, the self-hosted web app and the static client offer the same list; `patterns.txt`
// (a platform concern, see adapters/patterns-fs) adds your own on top.
//
// Every pattern is written in the '/…/flags' form compilePattern() understands, and each
// label is an i18n key rather than text — the list is UI, not data.
import type { Key } from './locales/en'

export interface PatternTemplate {
  label: Key
  pattern: string
}

// ponytail: deliberately loose. These are search prompts a human then reads through, not
// a DLP classifier — a false positive costs a glance, a miss costs the whole point.
export const DEFAULT_PATTERNS: PatternTemplate[] = [
  { label: 'tplPasswords', pattern: '/пароль|password|passwd|пасс/i' },
  { label: 'tplCodes', pattern: '/(код|code|otp|2fa)\\D{0,12}\\d{4,8}/i' },
  { label: 'tplTokens', pattern: '/(api[_-]?key|token|secret|bearer|ghp_|sk-)[=:\\s"\']/i' },
  { label: 'tplCards', pattern: '/\\b(?:\\d[ -]?){13,19}\\b/' },
  { label: 'tplEmails', pattern: '/[\\w.+-]+@[\\w-]+\\.[a-z]{2,}/i' },
  { label: 'tplPhones', pattern: '/(?:\\+|\\b8)[\\d ()-]{9,}\\d/' },
  {
    label: 'tplCrypto',
    pattern: '/\\b(0x[a-f0-9]{40}|bc1[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\\b/i',
  },
  { label: 'tplDocs', pattern: '/(паспорт|passport|снилс|инн\\b|iban)/i' },
  { label: 'tplAddress', pattern: '/(адрес|address|индекс|zip code)/i' },
]
