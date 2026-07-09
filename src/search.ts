// Barrel kept for backwards-compatible imports (`./search`). Search logic is now
// portable (core/search); loading patterns from disk is a platform adapter.
export { loadPatterns, watchPatterns } from './adapters/patterns-fs'
export { compilePattern, searchCache } from './core/search'
