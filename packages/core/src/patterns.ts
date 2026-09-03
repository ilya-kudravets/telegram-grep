// Ready-made search templates: the things people regret having sent. Portable, so the
// TUI, the self-hosted web app and the static client offer the same list; `patterns.txt`
// (a platform concern, see adapters/patterns-fs) adds your own on top.
//
// Every pattern is written in the '/…/flags' form compilePattern() understands, and each
// label is an i18n key rather than text — the list is UI, not data.
//
// Two regex facts shape how these are written:
// - `\b` is ASCII-only in JS, so `\bинн\b` never matches "инн 123". Cyrillic words are
//   bounded with `(?<![а-яё])…(?![а-яё])` instead.
// - a case-insensitive `/i` would turn prefix shapes like `AKIA` and `ghp_` into noise, so
//   the format-based templates carry no flags at all.
import type { Key } from './locales/en'

export interface PatternTemplate {
  label: Key
  pattern: string
}

const CYR = '(?<![а-яё])'
const CYR_END = '(?![а-яё])'

// ponytail: deliberately loose. These are search prompts a human then reads through, not
// a DLP classifier — a false positive costs a glance, a miss costs the whole point.
export const DEFAULT_PATTERNS: PatternTemplate[] = [
  // — credentials —
  {
    label: 'tplPasswords',
    pattern: `/${CYR}(парол|пасс(ворд)?${CYR_END}|пин[- ]?код|логин\\s*[:=])|\\b(password|passwd|pwd|pin[- ]?code|login\\s*[:=])/i`,
  },
  {
    // a code word followed shortly by 4–8 digits: "код 483920", "Login code: 12345"
    label: 'tplCodes',
    pattern: `/(${CYR}код|\\b(code|otp|2fa|verification|pin))\\D{0,12}\\d{4,8}\\b/i`,
  },
  {
    // a named secret with a real-looking value after it, or a bearer header
    label: 'tplTokens',
    pattern:
      '/(api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|token|password|passwd|secret)\\s*[=:]\\s*["\']?[\\w./+=-]{6,}|bearer\\s+[\\w.-]{16,}/i',
  },
  {
    // keys recognisable by shape alone — no keyword needed: GitHub, AWS, Google, Slack,
    // Stripe, OpenAI, Telegram bot tokens, JWTs, PEM blocks, and user:pass@ in URLs
    label: 'tplKeyFormats',
    pattern:
      '/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\\w{20,}|AKIA[0-9A-Z]{16}|AIza[\\w-]{35}|xox[abprs]-[\\w-]{10,}|[sp]k_(live|test)_\\w{10,}|sk-[A-Za-z0-9_-]{20,}|eyJ[\\w-]{10,}\\.eyJ[\\w-]{10,}|\\b\\d{8,10}:[\\w-]{35}\\b|-----BEGIN [A-Z ]*PRIVATE KEY|\\w+:\\/\\/[^\\s\\/:@]+:[^\\s@]+@/',
  },
  {
    label: 'tplSeed',
    pattern: `/seed[- ]?phrase|сид[- ]?фраз|mnemonic|мнемоник|recovery phrase|${CYR}(приватн|секретн)\\w* ключ|private[- ]?key|secret[- ]?key/i`,
  },
  // — money —
  {
    // 13–16 digits (optionally in groups of 4) starting with a real card prefix:
    // Visa 4, MC 51–55 / 2221–2720, Mir 2200–2204, Amex 34/37, UnionPay/Discover 6
    label: 'tplCards',
    pattern:
      '/\\b(4\\d{3}|5[1-5]\\d{2}|2[2-7]\\d{2}|3[47]\\d{2}|6\\d{3})([ -]?\\d{4}){2}[ -]?\\d{1,4}\\b/',
  },
  {
    label: 'tplBank',
    pattern: `/\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b|\\biban\\b|\\bswift\\b|routing number|sort code|account number|${CYR}(реквизит|расч[её]тн|корр?\\.? ?сч[её]т|р\\/с|к\\/с|бик${CYR_END}|огрн|номер сч[её]та)/i`,
  },
  {
    // BTC (legacy + bech32), ETH/EVM, TRON, TON, Litecoin
    label: 'tplCrypto',
    pattern:
      '/\\b(0x[a-fA-F0-9]{40}|bc1[a-z0-9]{25,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|T[1-9A-HJ-NP-Za-km-z]{33}|[EU]Q[A-Za-z0-9_-]{46}|ltc1[a-z0-9]{25,})\\b/',
  },
  // — identity —
  {
    label: 'tplDocs',
    pattern: `/${CYR}(паспорт|снилс|инн${CYR_END}|водительск|загран|свидетельств[оа] о|полис${CYR_END})|\\b(passport|ssn|social security|driver'?s? licen[cs]e|national id|id card)\\b/i`,
  },
  { label: 'tplEmails', pattern: '/[\\w.+-]+@[\\w-]+(\\.[\\w-]+)*\\.[a-z]{2,}/i' },
  {
    // international +… form, or a Russian 8-xxx-xxx-xx-xx
    label: 'tplPhones',
    pattern:
      '/\\+\\d[\\d ()-]{8,}\\d|\\b8[ (-]{0,2}\\d{3}[ )-]{0,2}\\d{3}[ -]?\\d{2}[ -]?\\d{2}\\b/',
  },
  {
    // "address" alone is too noisy (IP address, email address): require a street-ish word
    // or the bare word when nothing techy precedes it
    label: 'tplAddress',
    pattern: `/${CYR}(ул\\.|улиц[аеы]|дом \\d|кв\\.|квартир[аеы]|подъезд|прописк|индекс \\d{5,6})|\\b(zip ?code|postcode|street|apartment|apt\\.? ?\\d)|(?<!ip |e-?mail |mac |wallet )(${CYR}адрес(?![а-яё]{2})|\\baddress\\b)/i`,
  },
  {
    // lat,lon pairs and map links — where you were, or where you live
    label: 'tplLocation',
    pattern:
      '/\\b-?\\d{1,2}\\.\\d{4,},\\s*-?\\d{1,3}\\.\\d{4,}\\b|maps\\.app\\.goo\\.gl|google\\.\\w+\\/maps|yandex\\.\\w+\\/maps|2gis\\.\\w+\\/|geo:\\d|плюс[- ]?код|plus ?code/i',
  },
  // — everything else that can be revoked —
  {
    // invite links: anyone holding the message can still join
    label: 'tplInvites',
    pattern:
      '/t\\.me\\/(\\+|joinchat\\/)|discord\\.gg\\/|chat\\.whatsapp\\.com\\/|zoom\\.us\\/j\\/|meet\\.google\\.com\\/[a-z-]+|signal\\.group\\//i',
  },
  {
    // servers and hosts: IPv4 (with optional port), ssh targets, root@
    label: 'tplInfra',
    pattern: '/\\b(?:\\d{1,3}\\.){3}\\d{1,3}(:\\d{2,5})?\\b|\\bssh\\s+(-\\w+\\s+)*\\w+@|\\broot@/i',
  },
]
