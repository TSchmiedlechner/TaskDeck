import { useEffect, useState } from 'react'
import type { Briefing } from '@shared/types'
import type { DeckContext } from '../App'

export function BriefingOverlay({ ctx, onClose }: { ctx: DeckContext; onClose: () => void }): React.JSX.Element {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)

  const load = (force: boolean): void => {
    setLoading(true)
    void window.taskdeck.getBriefing(force).then((b) => {
      setBriefing(b)
      setLoading(false)
    })
  }

  useEffect(() => load(false), [])

  const titleOf = (itemId: string): string => ctx.state.items.find((i) => i.id === itemId)?.title ?? '(gone)'
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })

  return (
    <div className="overlay">
      <div style={{ padding: '22px 20px 16px', borderBottom: '1px solid var(--border-soft)' }}>
        <div className="label" style={{ color: 'var(--teal)', marginBottom: 8 }}>
          Morning briefing
        </div>
        <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>{dateLabel}</div>
        {briefing && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{briefing.headline}</div>
        )}
      </div>

      <div className="overlay-body">
        {loading && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Composing your briefing…</div>
        )}
        {!loading && briefing && (
          <>
            {briefing.needsAttention.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="label" style={{ color: 'var(--text-faint)' }}>
                  Needs attention
                </div>
                {briefing.needsAttention.map((line, idx) => (
                  <div key={idx} style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-mid)' }}>
                    · {line}
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                background: 'var(--teal-bg)',
                border: '1px solid rgba(108,197,185,0.2)',
                borderRadius: 8,
                padding: '12px 14px'
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--teal)' }}>✦</span>
                <span className="label" style={{ color: 'var(--teal)' }}>
                  Proposed Now
                </span>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.75, color: 'var(--text-mid)' }}>
                {briefing.proposedNow.length === 0 && <span>Nothing urgent — pick freely.</span>}
                {briefing.proposedNow.map((p, idx) => (
                  <div key={p.itemId}>
                    {idx + 1} · {titleOf(p.itemId)}
                    {p.reason && <span style={{ color: 'var(--teal)' }}> ({p.reason})</span>}
                  </div>
                ))}
              </div>
              {briefing.demotions.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {briefing.demotions.map((d) => (
                    <div key={d.itemId}>
                      “{titleOf(d.itemId)}” moves to Next — {d.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {briefing.note && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>{briefing.note}</div>
            )}
            {briefing.generatedBy === 'fallback' && (
              <div style={{ fontSize: 11, color: 'var(--amber)' }}>
                Agent unavailable — this is a deadline-ordered fallback plan.
              </div>
            )}
          </>
        )}
      </div>

      <div className="overlay-footer">
        <button
          className="wide-btn primary"
          disabled={loading || !briefing}
          onClick={() => {
            if (!briefing) return
            void window.taskdeck.acceptBriefing(briefing).then(() => {
              ctx.showToast('Now is set for today')
              onClose()
            })
          }}
        >
          Accept proposed Now
        </button>
        <button className="wide-btn ghost" style={{ flex: 'none', padding: '9px 16px' }} onClick={() => load(true)}>
          ↻
        </button>
        <button className="wide-btn ghost" style={{ flex: 'none', padding: '9px 16px' }} onClick={onClose}>
          Skip
        </button>
      </div>
    </div>
  )
}
