import { useEffect, useState } from 'react'
import type { CostSummary } from '@shared/types'
import type { DeckContext } from '../App'

export function SettingsOverlay({ ctx, onClose }: { ctx: DeckContext; onClose: () => void }): React.JSX.Element {
  const [cost, setCost] = useState<CostSummary | null>(null)
  const s = ctx.state.settings

  useEffect(() => {
    void window.taskdeck.getCostSummary().then(setCost)
  }, [])

  const numberSetting = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void
  ): React.JSX.Element => (
    <div className="setting-row">
      <span style={{ flex: 1 }}>{label}</span>
      <button className="mini-btn" onClick={() => value > min && onChange(value - 1)}>
        −
      </button>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-chip)', minWidth: 20, textAlign: 'center' }}>
        {value}
      </span>
      <button className="mini-btn" onClick={() => value < max && onChange(value + 1)}>
        +
      </button>
    </div>
  )

  const brainLine =
    ctx.state.brainStatus === 'ready'
      ? 'connected'
      : ctx.state.brainStatus === 'no-key'
        ? 'no ANTHROPIC_API_KEY in environment'
        : 'last call failed — will retry'

  return (
    <div className="overlay">
      <div className="overlay-header">
        <span className="label" style={{ color: 'var(--text-dim)' }}>
          Settings
        </span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="overlay-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="label" style={{ color: 'var(--text-faint)' }}>
            Agent
          </div>
          <div className="setting-row">
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: ctx.state.brainStatus === 'ready' ? 'var(--teal)' : 'var(--text-ghost)',
                flex: 'none'
              }}
            />
            <span style={{ flex: 1 }}>Anthropic API</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              {brainLine}
            </span>
          </div>
          {cost && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 9,
                padding: '12px 14px',
                background: 'var(--bg)',
                border: '1px solid var(--border-soft)',
                borderRadius: 8
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="mono" style={{ fontSize: 20 }}>
                  ${cost.totalUsd.toFixed(2)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  this month · {cost.calls} calls
                </span>
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--text-dim)' }}>
                Routine triage runs on Haiku; the briefing uses Opus. Inbox is batched into one call.
              </div>
              {cost.byPurpose.map((p) => (
                <div key={p.purpose} className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                  {p.purpose}: ${p.costUsd.toFixed(3)} ({p.calls} calls)
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="label" style={{ color: 'var(--text-faint)' }}>
            Behavior
          </div>
          {numberSetting('Now cap', s.nowCap, 3, 7, (v) => void window.taskdeck.setSettings({ nowCap: v }))}
          {numberSetting('Staleness confrontation after (days)', s.stalenessDays, 3, 30, (v) =>
            void window.taskdeck.setSettings({ stalenessDays: v })
          )}
          {numberSetting('Chase nudge after (days)', s.chaseDays, 1, 14, (v) =>
            void window.taskdeck.setSettings({ chaseDays: v })
          )}
          <div className="setting-row">
            <span style={{ flex: 1 }}>Privacy — hide from screen shares</span>
            <button
              className="mini-btn"
              style={{ color: s.privacyMode ? 'var(--teal)' : undefined }}
              onClick={() => void window.taskdeck.setSettings({ privacyMode: !s.privacyMode })}
            >
              {s.privacyMode ? 'on' : 'off'}
            </button>
          </div>
          <div className="setting-row">
            <span style={{ flex: 1 }}>Data</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-chip)' }}>
              local SQLite · no sync
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
