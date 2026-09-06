/**
 * **THE LANGUAGES SCREEN — which language is sung and which is projected.**
 *
 * Lifted out of `App.tsx` on 2026-09-06 with the rest of the player's screens; see `ControlView`
 * for why.
 */

import {
  setSongIndex,
  setBlank,
  setProjectionLanguage,
  setSingingLanguage,
  getAvailableLanguages,
  getAvailableSingingLanguages,
  getSongLines,
  getSingingLanguage,
  getProjectionLanguage,
} from './songState'

// **One owner for what a gig is called**, shared with Backstage's rows and the gig flow's header.

import { useEffect, useState } from 'react'

import type { SongItem } from './songState'

import './control.css'

export function LanguagesView() {
  const [lines, setLines] = useState<SongItem[]>(getSongLines)
  useEffect(() => {
    setLines(getSongLines())
  }, [])
  useEffect(() => {
    const onStorage = () => setLines(getSongLines())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const goBack = () => {
    window.location.hash = '#/'
  }

  const availableSinging = getAvailableSingingLanguages(lines)
  const availableTranslation = getAvailableLanguages(lines)
  const hasSong = lines.length > 0
  const [selectedSinging, setSelectedSingingState] = useState(getSingingLanguage)
  const [selectedTranslation, setSelectedTranslationState] = useState(getProjectionLanguage)

  useEffect(() => {
    setSelectedSingingState(getSingingLanguage())
    setSelectedTranslationState(getProjectionLanguage())
  }, [lines])

  const selectSingingLanguage = (lang: string) => {
    if (lang === getSingingLanguage()) return
    setSingingLanguage(lang)
    setSelectedSingingState(lang)
    setSongIndex(-1)
    setBlank(true)
  }

  const selectTranslationLanguage = (lang: string) => {
    if (lang === getProjectionLanguage()) return
    setProjectionLanguage(lang)
    setSelectedTranslationState(lang)
    setSongIndex(-1)
    setBlank(true)
  }

  const handleConfirm = () => {
    window.location.hash = '#/'
  }

  return (
    <div className="songs-screen languages-screen">
      <header className="songs-top-bar">
        <button type="button" className="songs-back" onClick={goBack}>
          Back
        </button>
        <h1 className="songs-title">Languages</h1>
      </header>
      <main className="songs-body">
        {!hasSong ? (
          <p className="languages-empty">No song loaded. Select a song first to choose singing and translation languages.</p>
        ) : (
          <>
            <div className="languages-columns">
              <section className="languages-column" aria-label="Singing">
                <h2 className="languages-section-title">Singing</h2>
                <div className="languages-buttons languages-buttons-vertical">
                  {availableSinging.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      className={`languages-lang-btn ${selectedSinging === lang ? 'languages-lang-btn-selected' : ''}`}
                      onClick={() => selectSingingLanguage(lang)}
                    >
                      {lang.toUpperCase()}
                    </button>
                  ))}
                </div>
              </section>
              <span className="languages-arrow" aria-hidden="true">→</span>
              <section className="languages-column" aria-label="Projection">
                <h2 className="languages-section-title">Projection</h2>
                <div className="languages-buttons languages-buttons-vertical">
                  {availableTranslation.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      className={`languages-lang-btn ${selectedTranslation === lang ? 'languages-lang-btn-selected' : ''}`}
                      onClick={() => selectTranslationLanguage(lang)}
                    >
                      {lang.toUpperCase()}
                    </button>
                  ))}
                </div>
              </section>
            </div>
            <div className="languages-confirm-wrap">
              <button type="button" className="ctrl-btn languages-confirm" onClick={handleConfirm}>
                Confirm
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
