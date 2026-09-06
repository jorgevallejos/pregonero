/**
 * **THE CARD CHANNEL: what card the wall is showing, and what is in it.**
 *
 * One `localStorage` key, written by the window that knows and read by the Projection window,
 * which has no `electronAPI` and cannot read the gig folder for itself. **The same shape as
 * `visualsBroadcast.ts`**, and `SHARED` for the same reason: a channel is not either product's, it
 * is the wire between two windows.
 *
 * **It was inside `gigContactState.ts` until 2026-09-06**, which is the player's — and the moment
 * the gig flow's Cards step put a card on the wall, `productBoundary.test.ts` went red on a second
 * shell → player edge. **That was a wrong classification rather than a wrong import**: the
 * condition is the player's, the wire is not. The key is unchanged, because a storage key is an
 * address.
 *
 * **The value is read at mount and on every `storage` event**, so the missed-event problem the
 * nonce rule in `CLAUDE.md` exists for does not arise.
 *
 * **An absent key reads as lit with nothing in it**, which is the power-up answer: outside a gig
 * there is no card, and a lit shape with nothing pointed at it is exactly what must not be
 * reachable. A value left by an older build reads as its boolean and no content, which needs no
 * migration because the writer replaces it on the first render of a gig.
 */

import { useEffect, useState } from 'react'
import { readMessageHome, type MessageHome } from './gigFile'

/** The key is an address and is deliberately not renamed — see `contentFolders.ts`. */
export const KEY_CONTACT_LIT_BROADCAST = 'pregoneroContactLit'

/**
 * **A CARD PUT ON THE WALL FROM SETUP, AND WHAT IS IN IT** (Jorge, 2026-09-06).
 *
 * The Cards step shows the card on the projector while it is open. **The real thing at real size
 * on the real wall is the preview** — the same move that made Muralista's `2 OUTPUT` the photograph
 * rather than a simulation, and it exists because the intro card's translation line was too small
 * to read at wall distance and **that would have been caught at setup if the card had been on the
 * wall.**
 *
 * **It rides this channel rather than a new one.** This key already means *what card the wall is
 * showing and what is in it* — the message home's condition and its four fields travel here
 * together. A second channel would be a second answer to the same question, and a channel is what
 * a framed player would have to carry: there are eight.
 *
 * **It is setup, not performance, and it wins while it is set.** Nothing about the gig's state is
 * consulted while a preview is up; clearing it hands the wall back.
 */
export type CardPreview =
  | { kind: 'message-home' }
  | { kind: 'intro'; parts: { title: string; annotation?: string; tagline?: string } }

/** What crosses: whether the shape is lit, what goes in it, and any setup preview. */
export type ContactBroadcast = { lit: boolean; fields: MessageHome; preview: CardPreview | null }

export function setContactLitBroadcast(
  lit: boolean,
  fields: MessageHome = {},
  preview: CardPreview | null = null
): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY_CONTACT_LIT_BROADCAST, JSON.stringify({ lit, fields, preview }))
  } catch {
    /* unavailable in some environments */
  }
}

/** Never throws: anything that is not one of the two shapes reads as no preview. */
function readCardPreview(value: unknown): CardPreview | null {
  if (value === null || typeof value !== 'object') return null
  const o = value as { kind?: unknown; parts?: unknown }
  if (o.kind === 'message-home') return { kind: 'message-home' }
  if (o.kind !== 'intro' || o.parts === null || typeof o.parts !== 'object') return null
  const p = o.parts as { title?: unknown; annotation?: unknown; tagline?: unknown }
  if (typeof p.title !== 'string' || p.title === '') return null
  return {
    kind: 'intro',
    parts: {
      title: p.title,
      annotation: typeof p.annotation === 'string' && p.annotation ? p.annotation : undefined,
      tagline: typeof p.tagline === 'string' && p.tagline ? p.tagline : undefined,
    },
  }
}

export function getContactBroadcast(): ContactBroadcast {
  const absent: ContactBroadcast = { lit: true, fields: {}, preview: null }
  try {
    if (typeof localStorage === 'undefined') return absent
    const raw = localStorage.getItem(KEY_CONTACT_LIT_BROADCAST)
    if (raw === null) return absent
    // **An older build's `'1'` / `'0'` reads as its boolean and no content.** Not a migration: the
    // writer replaces the value on the first render of a gig, so this is the width of one render.
    if (raw === '0') return { lit: false, fields: {}, preview: null }
    if (raw === '1') return absent
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return absent
    const o = parsed as { lit?: unknown; fields?: unknown; preview?: unknown }
    return {
      lit: o.lit !== false,
      fields: readMessageHome(o.fields) ?? {},
      preview: readCardPreview(o.preview),
    }
  } catch {
    return absent
  }
}

/** Whether the shape is lit. The condition's answer, as it has always travelled. */
export function getContactLitBroadcast(): boolean {
  return getContactBroadcast().lit
}

export function useContactBroadcast(): ContactBroadcast {
  const [value, setValue] = useState(getContactBroadcast)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_CONTACT_LIT_BROADCAST || e.key === null) {
        setValue(getContactBroadcast())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return value
}

export function useContactLit(): boolean {
  return useContactBroadcast().lit
}
