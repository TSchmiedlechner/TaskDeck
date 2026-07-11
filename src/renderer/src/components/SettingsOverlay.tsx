import { useEffect, useState } from 'react'
import type { BrainProviderPref, CostSummary } from '@shared/types'
import { MODEL_OPTIONS } from '@shared/types'
import type { DeckContext } from '../App'

const PROVIDER_OPTIONS: { id: BrainProviderPref; label: string; hint: string }[] = [
  { id: 'auto', label: 'auto', hint: 'CLI when available, else API' },
  { id: 'cli', label: 'cli', hint: 'Claude Code CLI — covered by your Max plan' },
  { id: 'api', label: 'api', hint: 'Direct Anthropic API — pay per token' }
]

export function SettingsOverlay({ ctx, onClose }: { ctx: DeckContext; onClose: () => void }): React.JSX.Element {
  const [cost, setCost] = useState<CostSummary | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [hotkeyInput, setHotkeyInput] = useState<string | null>(null)
  const s = ctx.state.settings

  const saveHotkey = (): void => {
    const accel = (hotkeyInput ?? '').trim()
    if (!accel || accel === s.captureHotkey) {
      setHotkeyInput(null)
      return
    }
    void window.taskdeck.setHotkey(accel).then((ok) => {
      ctx.showToast(ok ? `Hotkey is now ${accel}` : 'That hotkey could not be registered — kept the old one')
      setHotkeyInput(null)
    })
  }

  useEffect(() => {
    void window.taskdeck.getCostSummary().then(setCost)
  }, [ctx.state])

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

  const modelSetting = (label: string, value: string, onChange: (v: string) => void): React.JSX.Element => (
    <div className="setting-row">
      <span style={{ flex: 1 }}>{label}</span>
      <select className="dark-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {MODEL_OPTIONS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  )

  const statusLine = ((): string => {
    if (ctx.state.brainStatus === 'error') return 'last call failed — will retry'
    switch (ctx.state.brainProvider) {
      case 'cli':
        return 'Claude Code CLI · covered by Max plan'
      case 'api':
        return `API · key from ${ctx.state.keySource === 'settings' ? 'settings' : 'environment'}`
      default:
        return ctx.state.settings.provider === 'cli'
          ? 'offline — Claude CLI not found on PATH'
          : ctx.state.settings.provider === 'api'
            ? 'offline — no API key set'
            : 'offline — no CLI on PATH and no API key'
    }
  })()

  const saveKey = (): void => {
    const key = keyInput.trim()
    if (!key) return
    void window.taskdeck.setApiKey(key).then(() => {
      setKeyInput('')
      ctx.showToast('API key saved (encrypted)')
    })
  }

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
            <span style={{ flex: 1 }}>Status</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              {statusLine}
            </span>
          </div>
          <div className="setting-row">
            <span style={{ flex: 1 }}>Provider</span>
            {PROVIDER_OPTIONS.map((p) => (
              <button
                key={p.id}
                className="mini-btn"
                title={p.hint}
                style={s.provider === p.id ? { color: 'var(--teal)', borderColor: 'var(--teal-border-strong)' } : undefined}
                onClick={() => void window.taskdeck.setSettings({ provider: p.id })}
              >
                {p.label}
              </button>
            ))}
          </div>
          {modelSetting('Triage model', s.triageModel, (v) => void window.taskdeck.setSettings({ triageModel: v }))}
          {modelSetting('Briefing model', s.briefingModel, (v) =>
            void window.taskdeck.setSettings({ briefingModel: v })
          )}
          <div className="setting-row" style={{ alignItems: 'stretch', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}>API key</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                {ctx.state.keySource === 'settings'
                  ? 'set · stored encrypted'
                  : ctx.state.keySource === 'env'
                    ? 'from ANTHROPIC_API_KEY env'
                    : 'not set'}
              </span>
              {ctx.state.keySource === 'settings' && (
                <button
                  className="mini-btn"
                  style={{ color: 'var(--danger-soft)' }}
                  onClick={() => void window.taskdeck.clearApiKey().then(() => ctx.showToast('API key removed'))}
                >
                  clear
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="key-input"
                type="password"
                placeholder="sk-ant-…"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              />
              <button className="mini-btn" disabled={!keyInput.trim()} onClick={saveKey}>
                save
              </button>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-ghost)', lineHeight: 1.5 }}>
              Only needed for the API provider. The CLI provider uses your logged-in Claude Code
              (run `claude` once to sign in) and draws on your Max plan instead of API billing.
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
                  API cost this month · {cost.calls} calls
                </span>
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--text-dim)' }}>
                {ctx.state.brainProvider === 'cli'
                  ? 'CLI calls are covered by your Max plan — only token counts are recorded.'
                  : 'Triage runs on the small model; the briefing uses the strong one. Inbox is batched into one call.'}
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
            <span style={{ flex: 1 }}>Capture hotkey</span>
            {hotkeyInput === null ? (
              <>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-chip)' }}>
                  {s.captureHotkey}
                </span>
                <button className="mini-btn" onClick={() => setHotkeyInput(s.captureHotkey)}>
                  edit
                </button>
              </>
            ) : (
              <>
                <input
                  className="key-input"
                  style={{ maxWidth: 180 }}
                  autoFocus
                  value={hotkeyInput}
                  placeholder="e.g. Control+Alt+Space"
                  onChange={(e) => setHotkeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveHotkey()
                    if (e.key === 'Escape') setHotkeyInput(null)
                  }}
                />
                <button className="mini-btn" onClick={saveHotkey}>
                  save
                </button>
              </>
            )}
          </div>
          <div className="setting-row">
            <span style={{ flex: 1 }}>Start with Windows</span>
            <button
              className="mini-btn"
              style={{ color: s.launchAtLogin ? 'var(--teal)' : undefined }}
              onClick={() => void window.taskdeck.setSettings({ launchAtLogin: !s.launchAtLogin })}
            >
              {s.launchAtLogin ? 'on' : 'off'}
            </button>
          </div>
          <div className="setting-row">
            <span style={{ flex: 1 }}>Auto-open briefing each morning</span>
            <button
              className="mini-btn"
              style={{ color: s.autoBriefing ? 'var(--teal)' : undefined }}
              onClick={() => void window.taskdeck.setSettings({ autoBriefing: !s.autoBriefing })}
            >
              {s.autoBriefing ? 'on' : 'off'}
            </button>
          </div>
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
