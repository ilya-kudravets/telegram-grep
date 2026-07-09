// Barrel kept for backwards-compatible imports (`./deleter`). Delete logic is domain
// and now lives in core/deleter — portable (structural DeleteClient + Cache port).
export * from './core/deleter'
