import { useEffect, useState } from 'react'
import type { Item, Suggestion, SuggestionAction } from '@shared/types'
import { ageChip } from '@shared/format'
import type { DeckContext } from '../App'

const DOT_COLORS: Record<Item['type'], string> = {
  do: 'var(--dot-do)',
  decide: 'var(--dot-decide)',
  delegate: 'var(--dot-waiting)',
  waiting: 'var(--dot-waiting)'
}

interface SectionProps {
  ctx: DeckContext
  label: string
  items: Item[]
  labelColor?: string
  countText?: string
  countColor?: string
  open: boolean
  onToggle: () => void
  onProcess?: () => void
}

export function Section(props: SectionProps): React.JSX.Element {
  const { ctx, label, items, open, onToggle, onProcess } = props
  return (
    <div>
      <div className="section-header" onClick={onToggle}>
        <span className="section-chevron">{open ? '▾' : '▸'}</span>
        <span className="label" style={{ color: props.labelColor ?? 'var(--text-chip)' }}>
          {label}
        </span>
        <span style={{ flex: 1 }} />
        {onProcess && (
          <button
            className="process-btn"
            title="Go through the inbox one item at a time, keyboard-first (T)"
            onClick={(e) => {
              e.stopPropagation()
              onProcess()
            }}
          >
            process ⏎
          </button>
        )}
        <span className="section-count" style={{ color: props.countColor }}>
          {props.countText ?? String(items.length)}
        </span>
      </div>
      {open && (
        <div style={{ paddingBottom: 6 }}>
          {items.map((item) => (
            <ItemRow key={item.id} ctx={ctx} item={item} suggestion={ctx.suggestionsByItem.get(item.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ItemRow({
  ctx,
  item,
  suggestion
}: {
  ctx: DeckContext
  item: Item
  suggestion?: Suggestion
}): React.JSX.Element {
  const now = new Date()
  const chip = ageChip(item, now)
  const isRaw = item.bucket === 'inbox' && item.rawText !== null
  const meta = item.owner && item.bucket === 'waiting' ? `${item.owner} · ${item.meta ?? ''}` : item.meta

  const move = (bucket: Item['bucket']): void => {
    void window.taskdeck.updateItem(item.id, { bucket }).then(() => ctx.showToast(`Moved to ${bucket}`))
  }

  return (
    <div className="item-row">
      <div className="item-main">
        <span className="item-dot" style={{ background: isRaw ? 'var(--text-ghost)' : DOT_COLORS[item.type] }} />
        <span className={`item-title ${isRaw ? 'raw' : ''}`}>{item.title}</span>
        {item.url && (
          <button
            className="icon-btn"
            title="Open in source"
            style={{ fontSize: 11, padding: '0 2px' }}
            onClick={() => void window.taskdeck.openExternal(item.url!)}
          >
            ↗
          </button>
        )}
        <span className={`item-right ${chip.warn ? 'warn' : ''}`}>{chip.text}</span>
      </div>
      {meta && <div className="item-meta">{meta}</div>}
      {item.links.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 15 }}>
          {item.links.map((l) => (
            <span key={l} className="mini-btn" style={{ cursor: 'default' }}>
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="item-actions">
        <button
          className="mini-btn"
          title="Mark as completed (with mail write-back on, this also marks the mail read)"
          onClick={() => void window.taskdeck.completeItem(item.id)}
        >
          ✓ done
        </button>
        {item.bucket !== 'now' && (
          <button className="mini-btn" title="Move to Now — today's focus list" onClick={() => move('now')}>
            ↑ now
          </button>
        )}
        {item.bucket !== 'next' && (
          <button className="mini-btn" title="Move to Next — the short-term queue" onClick={() => move('next')}>
            → next
          </button>
        )}
        {item.bucket !== 'someday' && (
          <button
            className="mini-btn"
            title="Park in Someday — no commitment, collapsed by default"
            onClick={() => move('someday')}
          >
            ⋯ later
          </button>
        )}
        <button
          className="mini-btn"
          title="Hide until Monday 08:00, then resurface"
          onClick={() => {
            const d = new Date()
            const days = (8 - d.getDay()) % 7 || 7
            d.setDate(d.getDate() + days)
            d.setHours(8, 0, 0, 0)
            void window.taskdeck
              .updateItem(item.id, { snoozedUntil: d.toISOString() })
              .then(() => ctx.showToast('Resurfaces Monday'))
          }}
        >
          zz mon
        </button>
        <button
          className="mini-btn"
          title="Delete this item for good (a dismissed integration item won't come back)"
          style={{ color: 'var(--danger-soft)' }}
          onClick={() => void window.taskdeck.deleteItem(item.id)}
        >
          ✕
        </button>
      </div>
      {suggestion && <SuggestionChip ctx={ctx} item={item} suggestion={suggestion} />}
    </div>
  )
}

/** What each chip does, spelled out for the hover text. */
export function actionTitle(suggestion: Suggestion, actionId: string): string {
  const proposal = suggestion.payload as { bucket?: string } | null
  switch (suggestion.kind) {
    case 'structure':
      switch (actionId) {
        case 'accept':
          return `Apply the proposal and file it into ${proposal?.bucket ?? 'the suggested bucket'}`
        case 'accept-now':
          return 'Accept the proposal, but file it into Now instead'
        case 'accept-next':
          return 'Accept the proposal, but file it into Next instead'
        case 'accept-someday':
          return 'Accept the proposal, but park it in Someday instead'
        case 'snooze':
          return 'Hide until Monday 08:00, then resurface in the inbox'
        case 'dismiss':
          return 'Reject and delete this capture (a dismissed integration item won’t come back)'
      }
      break
    case 'staleness':
      switch (actionId) {
        case 'kill':
          return 'Delete the item for good — it was rotting anyway'
        case 'delegate':
          return 'Hand it off: moves to Waiting on, you pick who owns it'
        case 'schedule':
          return 'Snooze until Monday 08:00'
        case 'keep':
          return 'Keep it — resets the staleness clock'
      }
      break
    case 'chase':
      switch (actionId) {
        case 'copyDraft':
          return 'Copy the drafted follow-up to the clipboard and mark this as nudged'
        case 'keep':
          return 'Not now — the nudge comes back in a few days'
      }
      break
    case 'now-overflow':
      switch (actionId) {
        case 'toNext':
          return 'Move this item to Next to get Now back under the cap'
        case 'keep':
          return 'Keep it in Now — won’t ask again for 24h'
      }
      break
  }
  return ''
}

/** Extra one-click filing targets shown on inbox proposals, overriding the suggested bucket. */
function overrideActions(suggestion: Suggestion, item: Item): SuggestionAction[] {
  if (suggestion.kind !== 'structure' || item.bucket !== 'inbox') return []
  const proposal = suggestion.payload as { bucket?: string } | null
  return (['now', 'next', 'someday'] as const)
    .filter((b) => b !== proposal?.bucket)
    .map((b) => ({ id: `accept-${b}`, label: `→ ${b}`, kind: 'ghost' as const }))
}

function SuggestionChip({
  ctx,
  item,
  suggestion
}: {
  ctx: DeckContext
  item: Item
  suggestion: Suggestion
}): React.JSX.Element {
  const [pickingOwner, setPickingOwner] = useState<SuggestionAction | null>(null)

  const resolve = async (action: SuggestionAction, owner?: string): Promise<void> => {
    if (action.needsOwner && !owner) {
      setPickingOwner(action)
      return
    }
    if (suggestion.kind === 'chase' && action.id === 'copyDraft') {
      const draft = (suggestion.payload?.draft as string) ?? ''
      await window.taskdeck.copyToClipboard(draft)
      ctx.showToast('Follow-up draft copied')
    }
    await window.taskdeck.resolveSuggestion(suggestion.id, action.id, owner ? { owner } : undefined)
    setPickingOwner(null)
  }

  const actions = [...suggestion.actions, ...overrideActions(suggestion, item)]

  return (
    <div className={`sugg ${suggestion.tone}`}>
      <div className="sugg-text">
        <span className={`sugg-star ${suggestion.tone}`} style={{ fontSize: 11, lineHeight: 1.5, flex: 'none' }}>
          ✦
        </span>
        <span>{suggestion.text}</span>
      </div>
      {pickingOwner ? (
        <OwnerPicker
          onCancel={() => setPickingOwner(null)}
          onPick={(owner) => void resolve(pickingOwner, owner)}
        />
      ) : (
        <div className="sugg-actions">
          {actions.map((a) => (
            <button
              key={a.id}
              className={`chip-btn ${a.kind}`}
              title={actionTitle(suggestion, a.id)}
              onClick={() => void resolve(a)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function OwnerPicker({
  onPick,
  onCancel
}: {
  onPick: (owner: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [owners, setOwners] = useState<string[]>([])
  const [text, setText] = useState('')

  useEffect(() => {
    void window.taskdeck.listOwners().then(setOwners)
  }, [])

  return (
    <div className="owner-pop" style={{ marginLeft: 19 }}>
      <span className="label" style={{ color: 'var(--text-faint)' }}>
        Delegate to
      </span>
      {owners.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {owners.map((o) => (
            <button key={o} className="mini-btn" onClick={() => onPick(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      <input
        autoFocus
        placeholder="Name…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) onPick(text.trim())
          if (e.key === 'Escape') onCancel()
        }}
      />
    </div>
  )
}
