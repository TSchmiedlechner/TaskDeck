import { useEffect, useMemo, useState } from 'react'
import type { StructureProposal } from '@shared/types'
import type { DeckContext } from '../App'

/**
 * Keyboard-first, one-by-one processing of inbox items that have a pending
 * structure proposal. A = accept, Z = monday, D = dismiss, Esc = exit.
 */
export function TriageOverlay({ ctx, onClose }: { ctx: DeckContext; onClose: () => void }): React.JSX.Element {
  const [total, setTotal] = useState<number | null>(null)

  const queue = useMemo(
    () =>
      ctx.state.items
        .filter((i) => i.bucket === 'inbox' && i.completedAt === null)
        .map((item) => ({ item, suggestion: ctx.suggestionsByItem.get(item.id) }))
        .filter((q) => q.suggestion?.kind === 'structure'),
    [ctx.state.items, ctx.suggestionsByItem]
  )

  useEffect(() => {
    if (total === null && queue.length > 0) setTotal(queue.length)
  }, [queue.length, total])

  useEffect(() => {
    if (queue.length === 0) {
      const waitingForAgent = ctx.state.items.some((i) => i.bucket === 'inbox')
      ctx.showToast(waitingForAgent ? 'Rest of inbox is still being triaged' : 'Inbox zero ✦')
      onClose()
    }
  }, [queue.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = queue[0]

  const act = (actionId: 'accept' | 'snooze' | 'dismiss'): void => {
    if (!current?.suggestion) return
    void window.taskdeck.resolveSuggestion(current.suggestion.id, actionId)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase()
      if (k === 'a') act('accept')
      else if (k === 'z') act('snooze')
      else if (k === 'd') act('dismiss')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!current?.suggestion) return <div className="overlay" />
  const proposal = current.suggestion.payload as unknown as StructureProposal
  const done = (total ?? queue.length) - queue.length + 1

  return (
    <div className="overlay">
      <div className="overlay-header">
        <span className="label" style={{ color: 'var(--teal)' }}>
          Triage
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
          {done} of {total ?? queue.length}
        </span>
        <button className="icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="overlay-body" style={{ padding: '22px 20px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            {current.item.meta ?? 'capture'}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--text-dim)',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-soft)',
              borderRadius: 8,
              padding: '12px 14px',
              whiteSpace: 'pre-wrap',
              maxHeight: 200,
              overflowY: 'auto'
            }}
          >
            {current.item.rawText ?? current.item.title}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-ghost)', fontSize: 12 }}>↓</div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: 'var(--teal-bg)',
            border: '1px solid var(--teal-border)',
            borderRadius: 9,
            padding: '14px 16px',
            animation: 'popIn 0.25s ease both'
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, color: 'var(--teal)', lineHeight: 1.5 }}>✦</span>
            <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.45 }}>{proposal.title}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 19 }}>
            <span
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--teal-bright)',
                background: 'rgba(108,197,185,0.1)',
                borderRadius: 4,
                padding: '3px 8px'
              }}
            >
              {proposal.type}
            </span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-chip)', background: 'var(--bg-chip)', borderRadius: 4, padding: '3px 8px' }}>
              → {proposal.bucket}
            </span>
            {proposal.extra && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-chip)', background: 'var(--bg-chip)', borderRadius: 4, padding: '3px 8px' }}>
                {proposal.extra}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border-soft)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="wide-btn primary" onClick={() => act('accept')}>
            <span className="key-badge" style={{ borderColor: 'rgba(143,216,205,0.4)' }}>
              A
            </span>
            Accept
          </button>
          <button className="wide-btn ghost" onClick={() => act('snooze')}>
            <span className="key-badge">Z</span>
            Monday
          </button>
          <button className="wide-btn danger" onClick={() => act('dismiss')}>
            <span className="key-badge" style={{ borderColor: '#4a3630' }}>
              D
            </span>
            Dismiss
          </button>
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-ghost)', textAlign: 'center' }}>
          keyboard: A accept · Z monday · D dismiss · esc exit
        </div>
      </div>
    </div>
  )
}
