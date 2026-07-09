// Platform adapter: the pattern list backed by a file on disk (patterns.txt).
// Desktop/CLI/web use this; an RN app would supply patterns another way
// (bundled constants, AsyncStorage, …) — the search core doesn't care.
import { readFileSync, watch } from 'node:fs'

export function loadPatterns(path: string): string[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  } catch {
    return []
  }
}

// returns the watcher so callers (and tests) can stop watching
export function watchPatterns(path: string, onChange: (patterns: string[]) => void) {
  return watch(path, () => onChange(loadPatterns(path)))
}
