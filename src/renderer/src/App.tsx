import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeckState, Item, Suggestion } from '@shared/types'
import { isSnoozed, matchesQuery } from '@shared/format'
import { Section } from './components/Section'
import { BriefingOverlay } from './components/BriefingOverlay'
import { TriageOverlay } from './components/TriageOverlay'
import { SettingsOverlay } from './components/SettingsOverlay'
import { ActivityOverlay } from './components/ActivityOverlay'

export type OverlayName = 'briefing' | 'triage' | 'settings' | 'activity' | null

export interface DeckContext {
  state: DeckState
  suggestionsByItem: Map<string, Suggestion>
  showToast: (text: string) => void
  refresh: () => void
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<DeckState | null>(null)
  const [overlay, setOverlay] = useState<OverlayName>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ someday: true })
  const [toast, setToast] = useState<string | null>(null)
  const [hovering, setHovering] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    void window.taskdeck.getState().then(setState)
  }, [])

  useEffect(() => {
    refresh()
    return window.taskdeck.onStateChanged(refresh)
  }, [refresh])

  useEffect(() => {
    return window.taskdeck.onShowBriefing(() => setOverlay('briefing'))
  }, [])

  const showToast = useCallback((text: string) => {
    setToast(text)
    window.setTimeout(() => setToast(null), 2400)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') {
        setOverlay(null)
        return
      }
      if (overlay) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'c') void window.taskdeck.openCapture()
      else if (k === 'b') setOverlay('briefing')
      else if (k === 't') setOverlay('triage')
      else if (k === 's') setOverlay('settings')
      else if (k === 'a') setOverlay('activity')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlay])

  if (!state) return <div className="deck" />

  const now = new Date()
  const visible = state.items.filter((i) => i.completedAt === null && !isSnoozed(i, now))
  const byBucket = (b: Item['bucket']): Item[] => visible.filter((i) => i.bucket === b)
  const inbox = byBucket('inbox')
  const nowItems = byBucket('now')

  const trimmedQuery = query.trim()
  const searching = trimmedQuery.length > 0
  // Search spans snoozed items too, so nothing you parked stays unfindable.
  const results = searching
    ? state.items.filter((i) => i.completedAt === null && matchesQuery(i, trimmedQuery))
    : []

  const suggestionsByItem = new Map<string, Suggestion>()
  for (const s of state.suggestions) {
    if (!suggestionsByItem.has(s.itemId)) suggestionsByItem.set(s.itemId, s)
  }

  const ctx: DeckContext = { state, suggestionsByItem, showToast, refresh }
  const pending = state.suggestions.length
  const brainLabel =
    state.brainStatus === 'ready'
      ? `agent ready · ${state.brainProvider === 'cli' ? 'cli (max)' : 'api'}`
      : state.brainStatus === 'offline'
        ? 'agent offline'
        : 'agent error'
  const capFull = nowItems.length >= state.settings.nowCap
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const toggle = (key: string): void => setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  return (
    <div
      className={`deck ${hovering || overlay ? '' : 'resting'}`}
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="deck-header">
        <span className="deck-dot" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>TaskDeck</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', flex: 1 }}>
          {dateLabel}
        </span>
        <button
          className={`icon-btn ${state.settings.alwaysOnTop ? 'active' : ''}`}
          title={
            state.settings.alwaysOnTop
              ? 'Pinned above other windows — click to unpin'
              : 'Not pinned — click to keep the deck on top'
          }
          onClick={() => {
            void window.taskdeck
              .setSettings({ alwaysOnTop: !state.settings.alwaysOnTop })
              .then(() => showToast(state.settings.alwaysOnTop ? 'Unpinned' : 'Pinned on top'))
          }}
        >
          ⌖
        </button>
        <button className="icon-btn" title="Morning briefing (B)" onClick={() => setOverlay('briefing')}>
          ☀
        </button>
        <button className="icon-btn" title="Activity log (A)" onClick={() => setOverlay('activity')}>
          ≣
        </button>
        <button
          className={`icon-btn ${state.settings.privacyMode ? 'active' : ''}`}
          title={
            state.settings.privacyMode
              ? 'Privacy mode ON — hidden from screen shares'
              : 'Privacy mode OFF — visible in screen shares'
          }
          onClick={() => {
            void window.taskdeck
              .setSettings({ privacyMode: !state.settings.privacyMode })
              .then(() =>
                showToast(state.settings.privacyMode ? 'Visible in screen shares' : 'Hidden from screen shares')
              )
          }}
        >
          ◉
        </button>
        <button className="icon-btn" title="Settings (S)" onClick={() => setOverlay('settings')}>
          ⚙
        </button>
      </div>

      <div className="deck-search">
        <span className="deck-search-icon">⌕</span>
        <input
          ref={searchRef}
          className="deck-search-input"
          placeholder="Search tasks…  ( / )"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setQuery('')
            }
          }}
        />
        {searching && (
          <button className="icon-btn" title="Clear search (Esc)" onClick={() => setQuery('')}>
            ✕
          </button>
        )}
      </div>

      <div className="deck-body">
        {searching ? (
          <Section
            ctx={ctx}
            label="Results"
            labelColor="var(--text)"
            items={results}
            countText={`${results.length} match${results.length === 1 ? '' : 'es'}`}
            open
            onToggle={() => {}}
          />
        ) : (
          <>
            <Section
              ctx={ctx}
              label="Now"
              labelColor="var(--text)"
              items={nowItems}
              countText={`${nowItems.length} / ${state.settings.nowCap}`}
              countColor={capFull ? 'var(--amber)' : undefined}
              open={!collapsed.now}
              onToggle={() => toggle('now')}
            />
            <Section
              ctx={ctx}
              label="Next"
              items={byBucket('next')}
              open={!collapsed.next}
              onToggle={() => toggle('next')}
            />
            <Section
              ctx={ctx}
              label="Waiting on"
              items={byBucket('waiting')}
              open={!collapsed.waiting}
              onToggle={() => toggle('waiting')}
            />
            <Section
              ctx={ctx}
              label="Someday"
              items={byBucket('someday')}
              open={!collapsed.someday}
              onToggle={() => toggle('someday')}
            />
            <Section
              ctx={ctx}
              label="Inbox"
              items={inbox}
              countColor={inbox.length ? 'var(--teal)' : undefined}
              open={!collapsed.inbox}
              onToggle={() => toggle('inbox')}
              onProcess={inbox.length > 0 ? () => setOverlay('triage') : undefined}
            />
          </>
        )}
        <div style={{ height: 12 }} />
      </div>

      <div className="deck-footer">
        <span style={{ flex: 1 }}>
          {pending} suggestion{pending === 1 ? '' : 's'} pending · {brainLabel}
          {state.settings.privacyMode ? ' · hidden from share' : ''}
        </span>
        <span style={{ color: 'var(--text-ghost)' }}>⌃⇧Space capture</span>
      </div>

      {overlay === 'briefing' && (
        <BriefingOverlay ctx={ctx} onClose={() => setOverlay(null)} />
      )}
      {overlay === 'triage' && <TriageOverlay ctx={ctx} onClose={() => setOverlay(null)} />}
      {overlay === 'settings' && <SettingsOverlay ctx={ctx} onClose={() => setOverlay(null)} />}
      {overlay === 'activity' && <ActivityOverlay onClose={() => setOverlay(null)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
