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

// returns the watcher so callers (and tests) can stop watching.
// unlike readFileSync, fs.watch throws synchronously (ENOENT) if the file
// doesn't exist yet — patterns.txt is optional, so that must not crash.
export function watchPatterns(
  path: string,
  onChange: (patterns: string[]) => void,
): { close(): void } {
  try {
    return watch(path, () => onChange(loadPatterns(path)))
  } catch {
    return { close() {} }
  }
}
