// English translations. Values may contain {0},{1}… placeholders.
// This is the base locale — every key must exist here; other locales may omit keys (fall back here).
export const en = {
  // client / cli
  needCreds: 'Fill API_ID and API_HASH in .env (my.telegram.org → API development tools)',
  askPhone: 'Phone (+1…):',
  askCode: 'Code from Telegram:',
  askPassword: '2FA password:',
  // index (tui bootstrap)
  loggedInUi: 'Logged in as {0}. Starting UI…',
  floodWaitStatus: 'FLOOD_WAIT: waiting {0}s…',
  patternsReloaded: 'patterns.txt reloaded',
  syncLine: 'sync {0} · {1} · {2} msgs',
  syncFloodLine: 'sync {0} · FLOOD_WAIT {1}s ({2})',
  syncDone: 'sync done: {0} chats, {1} messages cached',
  syncSkipped: ', {0} skipped ({1})',
  syncError: 'sync error: {0}',
  // server
  loggedInWeb: 'Logged in as {0}. Web UI: {1}',
  fromPhone: 'From your phone: http://<this-mac-ip>:{0}/?token={1}',
  localOnly: 'Local only (127.0.0.1). Run with LAN=1 to allow phone access.',
  portBusy: 'Port {0} busy, trying {1}…',
  allPortsBusy: 'All ports {0}–{1} are busy',
  // tui
  help: 'tab focus · space mark · d delete · ^P file patterns · esc reset · ^C quit',
  placeholder: 'regex… (plain → /i, or /pat/flags)',
  titleSearch: 'search',
  titleMessages: 'messages',
  confirmDeleteTui: 'Delete {0} message(s) everywhere? y/n',
  statusBase: '{0} matches · {1} marked',
  deleting: 'deleting {0}…',
  deleted: 'deleted {0}',
  deleteErrors: ', {0} errors: {1}',
  patternN: 'pattern {0}/{1}',
  patternsEmpty: 'patterns.txt is empty',
  // web
  appTitle: 'Search',
  confirmDeleteWeb: 'Delete {0} message(s) everywhere?',
  selectAll: 'all ({0})',
  deleteBtn: 'Delete ({0})',
  deletingBtn: 'deleting…',
  noMatches: 'no matches',
  cachedMsgs: 'cached {0} msgs',
  skippedShort: ' · {0} skipped',
  errorsShort: ' · {0} errors',
  invalidRegex: 'invalid regex',
  language: 'Language',
  systemLang: 'System',
}

export type Dict = typeof en
export type Key = keyof Dict
