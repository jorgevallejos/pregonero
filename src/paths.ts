/**
 * Posix path arithmetic, in the renderer, where `node:path` is not available.
 *
 * Everything here is pure string work on the one path separator this app ships on. It exists
 * because two files now carry paths that have to survive travelling: `gig.json`'s `file` entries,
 * which are relative to the gig folder so the folder can be handed over on a stick, and the
 * library's song references, which are relative to the configured songs folder so the library
 * survives that folder moving.
 */

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/')
}

/** `/a/b` + `c/d` → `/a/b/c/d`. A leading `./` on the right is dropped. */
export function joinPath(folder: string, name: string): string {
  const left = folder.endsWith('/') ? folder.slice(0, -1) : folder
  const right = name.startsWith('./') ? name.slice(2) : name
  return `${left}/${right}`
}

/** Collapses `.` and `..` segments. Leading `..` on a relative path are kept: they mean up. */
export function normalizePath(p: string): string {
  const absolute = isAbsolutePath(p)
  const out: string[] = []
  for (const segment of p.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      const last = out[out.length - 1]
      if (last !== undefined && last !== '..') out.pop()
      else if (!absolute) out.push('..')
      continue
    }
    out.push(segment)
  }
  const joined = out.join('/')
  if (absolute) return `/${joined}`
  return joined === '' ? '.' : joined
}

/** `/a/b/x` resolved from `/a/b` → `/a/b/x`; an absolute `to` is already the answer. */
export function resolveFrom(base: string, to: string): string {
  return normalizePath(isAbsolutePath(to) ? to : joinPath(base, to))
}

/**
 * The path of `to` written from `from`, `../` and all.
 *
 * This is what keeps a gig folder portable: `gig.json` naming
 * `../../../songs/song-performance/libertad.json` travels with the folder, while an absolute path is
 * a fact about one machine. Both are accepted on the
 * way in; this is the form written on the way out.
 */
export function relativePath(from: string, to: string): string {
  const fromParts = normalizePath(from).split('/').filter((s) => s !== '')
  const toParts = normalizePath(to).split('/').filter((s) => s !== '')
  let shared = 0
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared++
  }
  const up = fromParts.length - shared
  const down = toParts.slice(shared)
  if (up === 0 && down.length === 0) return '.'
  const parts = [...Array<string>(up).fill('..'), ...down]
  return parts.join('/')
}
