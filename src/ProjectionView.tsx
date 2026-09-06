/**
 * **THE PROJECTION WINDOW — the compositor that paints into the shapes Muralista mapped.**
 *
 * Lifted out of `App.tsx` on 2026-09-06 with the rest of the player's screens; see `ControlView`
 * for why. This is the audience's window: read-only, fed by the Control window's broadcasts, with
 * no preload and no `electronAPI` of its own.
 */
import type { ReactNode } from 'react'
import { useSongNavigation } from './useSongNavigation'
import { ShapeRegion } from './ShapeRegion'
import { ShapeText } from './ShapeText'
import { ShapeVideo } from './ShapeVideo'
import { ShapeIntro } from './ShapeIntro'
import { ShapeStatic, isStaticType } from './ShapeStatic'
import { ShapeFill } from './ShapeFill'
import { readTextFields, textLayoutBoxWidth } from './shapeTextLayout'
import {
  resolveShapesForType,
  shapeShowsForSong,
  songAssetFor,
  songVideoAssets,
  shapeFrame,
  shapeIsVisible,
  shapeTypeOf,
  SONG_AWARE_TYPES,
  type VisualShape,
} from './visualsFile'
import { useBroadcastVisuals } from './visualsBroadcast'
import { useOutputSize } from './useOutputSize'
import { resolveVideoCueIndex } from './videoCueLookup'
import type { TimelineEntry, TimelineLeadIn } from './songState'
import {
  isSection,
  getEffectiveProjectionLanguage,
  getCurrentSongId,
  getCurrentSongTitle,
  getSongDetails,
  getLyricText,
  getSingingLanguage,
  isLyricLine,
} from './songState'
import { resolveMediaPath } from './mediaPathStore'

import { useArmedBroadcast } from './performanceState'
import { useContactBroadcast } from './gigContactState'
import { ShapeContact, hasContactContent, type ContactFields } from './ShapeContact'
// **One owner for what a gig is called**, shared with Backstage's rows and the gig flow's header.

import { useEffect, useState, useRef } from 'react'

import { getAutoBlackout, AUTO_BLACKOUT_KEY } from './autoBlackout'

import { useVideoRuns } from './videoRunsBroadcast'
import type { LyricLine } from './songState'

import './control.css'

/**
 * **WHERE THE INTRO CARD AND THE MESSAGE HOME GO** (Jorge, 2026-09-05).
 *
 * **Within the mode that is lit, the card goes to the `song-video` shape if that mode has one, and
 * to the `song-lyrics` shape otherwise.** That is the whole rule, and both arguments arrive already
 * narrowed: `resolveShapesForType` has resolved the per-song reassignment, dropped hidden shapes
 * and dropped every shape belonging to a mode that is not live.
 *
 * **Jorge's reason is experience rather than theory.** Setting up the visuals, it was natural to
 * match the size and position of the video frame and the song lyrics shape; **the card is display
 * content and belongs on the big surface when there is one.**
 *
 * **This supersedes *the intro goes wherever this song's words will go***, ruled earlier the same
 * day. That rule sent the card to the shape the lyrics resolve to, which for a song with video is
 * the narrow strip at the foot of the frame.
 *
 * ## The four things that had to be true before this could be written, and where each landed
 *
 * 1. **A rule for a room with both shapes and for a room with one.** Above. Every gig has song
 *    lyrics and not every gig has a video frame, so the fallback is the one that always exists,
 *    and both are resolved per song — a gig can answer differently song to song.
 * 2. **More than one shape: light them all.** The set is returned whole, as the set-returning
 *    lookup has done since 24/08. Two lyrics shapes spanning a corner both carry the card.
 * 3. **A hidden or unlit host cannot host, by construction.** The kickoff put this as *a
 *    `visibleWhen` shape can never host* — **`visibleWhen` no longer exists**, having been replaced
 *    by named modes on 2026-09-05, so the mechanism named there is gone. The conclusion survives
 *    for a better reason: `resolveShapesForType` filters on `shapeIsVisible` and
 *    `shapeShowsForSong` before returning, so a shape that is not lighting never reaches this
 *    function at all.
 * 4. **The message home's content still has no home, and that is deliberate.** Its line and its QR
 *    were fields on the Muralista `gig-contact` layer and went with the type. **The template and
 *    the gig-flow step that fills it are held back** — they are judged at a wall, not at a desk —
 *    so `contactFieldsForHost` still answers null and the message home still does not paint.
 *    **This function is no longer what is stopping it.**
 *
 * **The main shape did not get smarter and this does not make it so.** The shape stays a place
 * that holds content; the part that is smart is Pregonero, deciding what that place holds at each
 * moment. The vocabulary is intact — what changed is only who does the deciding.
 */
function introContactHostShapes(
  lyricShapes: VisualShape[],
  videoShapes: VisualShape[]
): VisualShape[] {
  return videoShapes.length > 0 ? videoShapes : lyricShapes
}

/**
 * **The message home's four fields, and whether there is a card at all.**
 *
 * They arrive on the contact channel with the answer to *is it lit* — this window has no
 * `electronAPI` and cannot read the gig folder, so the window that read it hands over the content
 * along with the condition. **Explicitly not read off the host shape's layer**: a `song-lyrics`
 * layer carries the preview text Muralista seeds it with, and a card that painted that would be
 * worse than a card that does not paint.
 *
 * **Null when every field is empty**, which is the rule this suite already runs on: nothing pointed
 * at the shape means the shape is dark. **A blank lit rectangle at the end of a gig is worse than
 * no card.**
 */
function contactFieldsForHost(fields: ContactFields): ContactFields | null {
  return hasContactContent(fields) ? fields : null
}

export function ProjectionView() {
  const singleScreen =
    import.meta.env.VITE_SINGLE_SCREEN === '1' ||
    import.meta.env.VITE_SINGLE_SCREEN === 'true'
  const { lines, currentItem, blank, index, goNext, goPrev } = useSongNavigation()
  const effectiveLang = getEffectiveProjectionLanguage(lines)
  const isSectionMarker = currentItem && isSection(currentItem)
  const translation =
    currentItem && !isSection(currentItem) && effectiveLang
      ? getLyricText(currentItem as LyricLine, effectiveLang)
      : ''
  const renderedText = translation

  const currentSongId = getCurrentSongId()
  /**
   * **What the wall knows about the playing song, and it all arrives on the wire.**
   *
   * This used to be `getLibrarySongById(currentSongId)`, and it was always `undefined` here: the
   * library is an in-memory cache and `App.tsx` never hydrates it on the projection route, because
   * *the player is handed a library that is already loaded* — which the Control window is, and a
   * second `BrowserWindow` with its own module instances is not. **No intro card after arming, and
   * an empty timeline in Video mode**, both silent. See `songState.SongDetails`.
   */
  const currentSongTitle = getCurrentSongTitle()
  const songDetails = getSongDetails()
  const singingLang = getSingingLanguage()

  // **The room.** Read from the Control window's broadcast, never from the disk on this side: the
  // Projection window has no preload and no `electronAPI`, and a second reader of the gig folder
  // would be a second answer to which room this is.
  const visuals = useBroadcastVisuals()
  // **The output size in real pixels, this render.** Never remembered, never cached into a matrix.
  const { width: outputWidth, height: outputHeight } = useOutputSize()

  /**
   * **Whether the video runs tonight, as the Control window answered it.**
   *
   * It was a 3-way `None / Small / Big` broadcast, and **in this window only `None` versus
   * not-`None` ever did anything.** The size half was format wearing a performance control's
   * clothes, and it is gone; what is left is the boolean it always was.
   */
  const videoRuns = useVideoRuns()

  // Auto blackout broadcast from Control window (T2). While active, the pre-first-cue index -1
  // state renders BLACK instead of the intro/title — the audience is dark during the count-in
  // and between/around cues in Auto mode (there is no video to show). No effect once a lyric
  // index (>= 0) is showing.
  const [performanceBlackout, setPerformanceBlackout] = useState(getAutoBlackout)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTO_BLACKOUT_KEY || e.key === null) {
        setPerformanceBlackout(getAutoBlackout())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // **The contact panel's condition, as answered by the Control window.** One boolean, because
  // every input to it is that window's — see `gigContactState.ts`.
  // **The condition and the content, on one channel.** See `gigContactState`.
  const contact = useContactBroadcast()
  const contactLit = contact.lit

  /**
   * **THE WALL IS GATED ON THE GIG'S STATE, AND THIS IS THE GATE** (Jorge, 2026-09-06).
   *
   * | Gig state | The wall |
   * |---|---|
   * | Before the first arm | The message home |
   * | In the setlist | The song — and **black** between songs, at the end of one, and on a mid-setlist unarm |
   * | After the setlist ends | The message home |
   *
   * **This used to be `index === -1 && lines.length > 0`, which is not *armed* — it is *a song is
   * loaded and rewound*.** The app auto-loads the first song of the active setlist on arrival, so
   * that was true long before anything was armed, and **the intro card went up the instant a song
   * was selected** and stayed up through an unarm. It also covered the message home, since both
   * cards are hosted in the same shape and the intro is stacked second. **One cause, four
   * symptoms** — Jorge's own diagnosis, and it was right.
   *
   * The armed flag has crossed on its own channel since the beginning; this window simply never
   * read it. `performanceState.useArmedBroadcast` is that read.
   */
  const isArmed = useArmedBroadcast()

  const showIntroScreen =
    isArmed && index === -1 && lines.length > 0 && !performanceBlackout && currentSongTitle !== ''
  /**
   * **The song belongs to the armed gig, and nothing of it paints outside one.** Unarming mid-song
   * used to leave the line hanging on the wall; between rooms the wall is black.
   */
  const showContent = isArmed && index >= 0 && !blank && !isSectionMarker

  const [displayedText, setDisplayedText] = useState('')
  const [isVisible, setIsVisible] = useState(false)
  const fadeOutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoHiddenKeyRef = useRef<string | null>(null)

  const activeKey = showContent ? `${index}:${renderedText}` : ''

  const clearAllTimers = () => {
    if (fadeOutTimer.current) {
      clearTimeout(fadeOutTimer.current)
      fadeOutTimer.current = null
    }
    if (swapTimer.current) {
      clearTimeout(swapTimer.current)
      swapTimer.current = null
    }
    if (autoFadeTimer.current) {
      clearTimeout(autoFadeTimer.current)
      autoFadeTimer.current = null
    }
  }

  const FADE_MS = 500
  const AUTO_FADE_MS = 6000

  useEffect(() => {
    clearAllTimers()

    if (!showContent) {
      autoHiddenKeyRef.current = null
      setIsVisible(false)
      swapTimer.current = setTimeout(() => setDisplayedText(''), FADE_MS)
      return () => clearAllTimers()
    }

    if (autoHiddenKeyRef.current === activeKey) {
      return () => clearAllTimers()
    }

    autoHiddenKeyRef.current = null

    const nextText = renderedText ?? ''

    if (displayedText === '') {
      setDisplayedText(nextText)
      setIsVisible(true)
      autoFadeTimer.current = setTimeout(() => {
        setIsVisible(false)
        fadeOutTimer.current = setTimeout(() => {
          autoHiddenKeyRef.current = activeKey
          setDisplayedText('')
        }, FADE_MS)
      }, AUTO_FADE_MS)
    } else if (nextText !== displayedText) {
      setIsVisible(false)
      swapTimer.current = setTimeout(() => {
        setDisplayedText(nextText)
        setIsVisible(true)
        autoFadeTimer.current = setTimeout(() => {
          setIsVisible(false)
          fadeOutTimer.current = setTimeout(() => {
            autoHiddenKeyRef.current = activeKey
            setDisplayedText('')
          }, FADE_MS)
        }, AUTO_FADE_MS)
      }, FADE_MS)
    } else {
      autoFadeTimer.current = setTimeout(() => {
        setIsVisible(false)
        fadeOutTimer.current = setTimeout(() => {
          autoHiddenKeyRef.current = activeKey
          setDisplayedText('')
        }, FADE_MS)
      }, AUTO_FADE_MS)
    }

    return () => clearAllTimers()
  }, [showContent, renderedText, displayedText, activeKey])

  useEffect(() => () => clearAllTimers(), [])

  const navRef = useRef({ goNext, goPrev })
  navRef.current = { goNext, goPrev }
  useEffect(() => {
    if (!singleScreen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const { goNext: next, goPrev: prev } = navRef.current
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [singleScreen])

  // VIDEO MODE: what `visuals.json` says this song puts in its video shapes, if this machine knows
  // where those files are. **Never the song's own media** — a song holds none.
  const isVideoMode = Boolean(
    visuals && currentSongId && songVideoAssets(visuals, currentSongId).named.length > 0
  )
  // **The room says this song has a video; the Control window says whether it runs.** Both are
  // needed and neither implies the other — the performer can drive a video song by hand.
  const videoWanted = Boolean(isVideoMode && videoRuns)

  // **The lookup, and it is the whole of it**: for each song-aware type, the shapes this song
  // reassigns, or the gig-level shapes of that type. It resolves to a *set* and every member is
  // lit — two shapes showing the same lyric is how a corner or a pillar gets spanned. Nothing
  // caps it at one, and no code below may assume it is one.
  const lyricShapes = visuals ? resolveShapesForType(visuals, 'song-lyrics', currentSongId) : []
  const videoShapes = visuals ? resolveShapesForType(visuals, 'song-video', currentSongId) : []
  // **The intro card and the message home have no shapes of their own since 2026-09-04.** Both go
  // into a shape that already exists: the video frame when the live mode has one, the song lyrics
  // shape otherwise — see `introContactHostShapes`.
  const hostShapes = introContactHostShapes(lyricShapes, videoShapes)
  const playVideo = videoWanted && videoShapes.length > 0

  // **When a video is playing, the video is the clock.** Subtitles come from its own
  // `currentTime`, not from the navigation index — the same rule the full-frame renderer had,
  // except that the element is now inside a shape and the text is in a different one.
  const [videoCueIndex, setVideoCueIndex] = useState(-1)
  const [videoStarted, setVideoStarted] = useState(false)
  const cueInputs = useRef({
    lines,
    timeline: [] as TimelineEntry[],
    leadIn: undefined as TimelineLeadIn | undefined,
    offset: 0,
    applyLeadIn: false,
  })
  cueInputs.current = {
    lines,
    timeline: songDetails.timeline ?? [],
    leadIn: songDetails.leadIn,
    // **Zero, and it used to be `media.offset`.** That manual correction lived in the song's media
    // block, which no longer exists; `videoCueLookup` documents that 0 with no lead-in is
    // bit-for-bit the original formula.
    offset: 0,
    /**
     * **WHETHER THE LEAD-IN APPLIES IS THIS WINDOW'S ANSWER NOW** (Jorge, 2026-09-04).
     *
     * The contract's own table: Video mode applies it, Auto mode does not — *a live intro can run
     * any length*. **Video mode is now *a video is assigned to this song for this gig*,** and
     * `isVideoMode` above is exactly that read. Bombista used to answer it from `media.type`, and
     * once no song declares media that answer silently flips to `false` for every video song.
     */
    applyLeadIn: isVideoMode,
  }
  const handleVideoTime = useRef((currentTime: number) => {
    const { timeline, offset, leadIn, applyLeadIn } = cueInputs.current
    setVideoCueIndex(resolveVideoCueIndex(timeline, currentTime, offset, leadIn, applyLeadIn))
  }).current

  useEffect(() => {
    if (!playVideo) {
      setVideoCueIndex(-1)
      setVideoStarted(false)
    }
  }, [playVideo, currentSongId])

  const videoLyricItem =
    playVideo && videoCueIndex >= 0 && videoCueIndex < lines.length ? lines[videoCueIndex] : undefined
  const videoLyricText =
    videoLyricItem && !isSection(videoLyricItem) && isLyricLine(videoLyricItem) && effectiveLang
      ? getLyricText(videoLyricItem, effectiveLang)
      : ''

  // What the lyric shapes carry, and how opaque. Two sources, one destination.
  const lyricText = playVideo ? videoLyricText : displayedText
  const lyricOpacity = playVideo ? (videoLyricText ? 1 : 0) : isVisible ? 1 : 0
  const lyricTransitionMs = playVideo ? 300 : FADE_MS

  // The three parts of the title card, and all three come from the song file. Pregonero fills
  // them; the template that arranges them is locked and has no formatting controls.
  const introParts = showIntroScreen
    ? {
        title: currentSongTitle,
        annotation:
          effectiveLang !== singingLang
            ? songDetails.titleTranslations?.[effectiveLang]
            : undefined,
        tagline: songDetails.intro?.[effectiveLang],
      }
    : null

  const showIntro = introParts !== null && !(playVideo && videoStarted)

  // ── The compositor ────────────────────────────────────────────────────────────────────────
  //
  // **Paint order is the shape list's order** — later is on top, which is Muralista's own rule and
  // the only place the z-order is authored. Grouping by type here would silently reorder the wall.
  const contentByShapeId = new Map<string, ReactNode>()

  // Song-aware shapes: **a shape is a place that can hold content, not a thing that is on.** It is
  // lit only when the playing song points something at it, and one whose song is not playing is
  // simply not here. Absence is the empty state; nothing is ever declared empty, and the gap
  // between songs falls out for free with no blackout state.
  // **EACH VIDEO SHAPE PLAYS ITS OWN ASSET.** The lookup returns a set, and now so does what fills
  // it: `visuals.json` names an asset per shape, so two shapes spanning a corner are no longer
  // obliged to carry one file. A shape with nothing assigned is simply not here — *a shape is a
  // place that can hold content, not a thing that is on*.
  let clockShapeId: string | null = null
  for (const shape of videoShapes) {
    if (!playVideo) continue
    const src = visuals ? songAssetFor(visuals, currentSongId, shape.id) : null
    const path = src ? resolveMediaPath(src) : null
    if (!path) continue
    if (clockShapeId === null) clockShapeId = shape.id
    const isClock = shape.id === clockShapeId
    contentByShapeId.set(
      shape.id,
      <ShapeVideo
        absolutePath={path}
        onTimeUpdate={isClock ? handleVideoTime : undefined}
        onStartedChange={isClock ? setVideoStarted : undefined}
      />
    )
  }
  for (const shape of lyricShapes) {
    const fields = readTextFields(shape.layer)
    contentByShapeId.set(
      shape.id,
      <ShapeText
        text={lyricText}
        boxWidth={textLayoutBoxWidth(shapeFrame(shape), fields.aspect, outputWidth, outputHeight)}
        fields={fields}
        opacity={lyricOpacity}
        transitionMs={lyricTransitionMs}
        className="projection-lyric shape-text"
        testId={`shape-lyrics-${shape.id}`}
      />
    )
  }
  // **The two conditions below are unchanged and they are the half that was always Pregonero's.**
  // `contactLit` and `showIntro` answer *when*, out of the armed flag, the played log, the setlist
  // and the song file. **They now have an answer for *where* too** — see `introContactHostShapes`
  // — so the intro paints. **The message home still does not**, and not for want of a host: its
  // line and its QR have nowhere to be written down yet, which is a decision about what a gig owns
  // and is deliberately held for a wall.
  /**
   * **THE CARD GOES OVER WHAT THE HOST ALREADY HOLDS, NEVER INSTEAD OF IT** (2026-09-06).
   *
   * Both cards borrow a shape that has its own content, and replacing it deadlocks the one case
   * that matters. `showIntro` is `introParts !== null && !(playVideo && videoStarted)`, and
   * **`videoStarted` is reported by `ShapeVideo` itself** — so a card that replaced the video
   * would unmount the element that is the only thing able to say the video had started, and the
   * card would never come down. **The video is the clock; it has to stay mounted.**
   *
   * Stacking is also what the ruling describes rather than a workaround for it: the card is *in*
   * the video frame, over a clip sitting paused on its first frame, and it lifts when the video
   * runs. On a lyrics host the thing underneath is the lyric text, which at index −1 is empty and
   * at zero opacity.
   */
  const overlayHost = (node: ReactNode) => (shape: VisualShape) => {
    const beneath = contentByShapeId.get(shape.id)
    contentByShapeId.set(
      shape.id,
      <>
        {beneath}
        {node}
      </>
    )
  }
  if (contactLit) {
    const fields = contactFieldsForHost(contact.fields)
    if (fields) {
      for (const shape of hostShapes) {
        overlayHost(
          <ShapeContact
            fields={fields}
            boxWidth={textLayoutBoxWidth(shapeFrame(shape), 1, outputWidth, outputHeight)}
          />
        )(shape)
      }
    }
  }
  if (showIntro) {
    for (const shape of hostShapes) {
      overlayHost(
        <ShapeIntro
          parts={introParts!}
          boxWidth={textLayoutBoxWidth(shapeFrame(shape), 1, outputWidth, outputHeight)}
        />
      )(shape)
    }
  }

  /**
   * **Everything that is not song-aware is on because the projector is on.** Pregonero does not
   * coordinate these, start them, stop them or hold state for them, and there is no case here for
   * any particular one of them — a `logo` case would be the mistake. Painting them unconditionally
   * is the absence of a rule rather than a rule, and it is what makes the wall never fully black
   * between songs without anything arranging that.
   *
   * **"Unconditionally" stopped being true on 2026-09-05, and this loop did not notice** (found
   * 2026-09-06, reading the two renderers side by side). Named modes let **any** shape join a mode
   * — Muralista's grouped list will drag a logo, a fill or a text card into one — and the mode is
   * evaluated here in `resolveShapesForType`, **which only ever sees the song-aware types.** This
   * loop skips those and then painted everything else with no mode check at all.
   *
   * **So a static shape in a mode was live in every mode on Pregonero's wall and in one mode on
   * Muralista's**, which is the two tools disagreeing about the same file — exactly what having one
   * lookup exists to prevent, escaping through the one path that does not use it.
   *
   * `shapeShowsForSong` is that lookup's own predicate, so there is still one implementation of the
   * rule. A shape in no mode answers `true` and pays nothing, which is every shape in a real room
   * today.
   */
  const fillShapes: VisualShape[] = []
  for (const shape of visuals?.shapes ?? []) {
    if (!shapeIsVisible(shape)) continue
    if (visuals && !shapeShowsForSong(visuals, shape, currentSongId || null)) continue
    const type = shapeTypeOf(shape)
    if ((SONG_AWARE_TYPES as readonly string[]).includes(type)) continue
    if (type === 'fill') {
      // A mask, not content: painted flat in output pixels with no unit box and no matrix.
      fillShapes.push(shape)
      continue
    }
    if (!isStaticType(type)) continue
    contentByShapeId.set(
      shape.id,
      <ShapeStatic shape={shape} type={type} width={outputWidth} height={outputHeight} />
    )
  }

  // **Paint order is the shape list's order** — later is on top, which is Muralista's own rule and
  // the only place the z-order is authored. Grouping by type here would silently reorder the wall.
  const paintable = visuals
    ? visuals.shapes.filter(
        (shape) =>
          shapeIsVisible(shape) &&
          (contentByShapeId.has(shape.id) || fillShapes.includes(shape))
      )
    : []

  return (
    <div
      className="projection-screen"
      data-testid="projection-screen"
      style={{
        background: '#000',
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        margin: 0,
      }}
    >
      {paintable.map((shape) =>
        fillShapes.includes(shape) ? (
          <ShapeFill key={shape.id} shape={shape} width={outputWidth} height={outputHeight} />
        ) : (
          <ShapeRegion key={shape.id} shape={shape} width={outputWidth} height={outputHeight}>
            {contentByShapeId.get(shape.id)}
          </ShapeRegion>
        )
      )}
    </div>
  )
}
