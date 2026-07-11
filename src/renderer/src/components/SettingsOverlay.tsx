import { useEffect, useState } from 'react'
import type { BrainProviderPref, CostSummary, DeviceCodePrompt } from '@shared/types'
import { MODEL_OPTIONS } from '@shared/types'
import type { DeckContext } from '../App'

function ConnectorRow({
  ctx,
  name,
  state,
  hint,
  placeholder
}: {
  ctx: DeckContext
  name: 'github' | 'jira'
  state: { configured: boolean; lastSync: string | null; error: string | null }
  hint: string
  placeholder: string
}): React.JSX.Element {
  const [tokenInput, setTokenInput] = useState('')
  const save = (): void => {
    const token = tokenInput.trim()
    if (!token) return
    void window.taskdeck.setConnectorToken(name, token).then(() => {
      setTokenInput('')
      ctx.showToast(`${name} connected`)
    })
  }
  return (
    <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: state.configured && !state.error ? 'var(--teal)' : 'var(--text-ghost)',
            flex: 'none'
          }}
        />
        <span style={{ flex: 1, fontSize: 12 }}>{state.configured ? 'connected' : 'not connected'}</span>
        <span className="mono" style={{ fontSize: 10, color: state.error ? 'var(--amber)' : 'var(--text-faint)' }}>
          {state.error
            ? state.error.slice(0, 40)
            : state.lastSync
              ? `synced ${new Date(state.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : ''}
        </span>
        {state.configured && (
          <button
            className="mini-btn"
            style={{ color: 'var(--danger-soft)' }}
            onClick={() =>
              void window.taskdeck.clearConnectorToken(name).then(() => ctx.showToast(`${name} disconnected`))
            }
          >
            clear
          </button>
        )}
      </div>
      {!state.configured && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="key-input"
              type="password"
              placeholder={placeholder}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <button className="mini-btn" disabled={!tokenInput.trim()} onClick={save}>
              save
            </button>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-ghost)', lineHeight: 1.5 }}>{hint}</span>
        </>
      )}
    </div>
  )
}

const PROVIDER_OPTIONS: { id: BrainProviderPref; label: string; hint: string }[] = [
  { id: 'auto', label: 'auto', hint: 'CLI when available, else API' },
  { id: 'cli', label: 'cli', hint: 'Claude Code CLI — covered by your Max plan' },
  { id: 'api', label: 'api', hint: 'Direct Anthropic API — pay per token' }
]

export function SettingsOverlay({ ctx, onClose }: { ctx: DeckContext; onClose: () => void }): React.JSX.Element {
  const [cost, setCost] = useState<CostSummary | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [hotkeyInput, setHotkeyInput] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState<DeviceCodePrompt | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const s = ctx.state.settings
  const outlook = ctx.state.outlook

  useEffect(() => {
    return window.taskdeck.onDeviceCode(setDeviceCode)
  }, [])

  const outlookSignIn = (): void => {
    setSigningIn(true)
    setDeviceCode(null)
    void window.taskdeck.outlookSignIn().then((ok) => {
      setSigningIn(false)
      setDeviceCode(null)
      ctx.showToast(ok ? 'Outlook connected' : 'Outlook sign-in failed')
    })
  }

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
            Outlook · read-only
          </div>
          <div className="setting-row">
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: outlook.signedIn ? 'var(--teal)' : 'var(--text-ghost)',
                flex: 'none'
              }}
            />
            <span style={{ flex: 1 }}>
              {outlook.signedIn ? (outlook.account ?? 'connected') : 'not connected'}
            </span>
            <span className="mono" style={{ fontSize: 10, color: outlook.error ? 'var(--amber)' : 'var(--text-faint)' }}>
              {outlook.error
                ? outlook.error.slice(0, 40)
                : outlook.lastSync
                  ? `synced ${new Date(outlook.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : ''}
            </span>
            {outlook.signedIn ? (
              <>
                <button className="mini-btn" onClick={() => void window.taskdeck.syncNow()}>
                  sync
                </button>
                <button
                  className="mini-btn"
                  style={{ color: 'var(--danger-soft)' }}
                  onClick={() => void window.taskdeck.outlookSignOut()}
                >
                  sign out
                </button>
              </>
            ) : (
              <button className="mini-btn" disabled={!outlook.configured || signingIn} onClick={outlookSignIn}>
                {signingIn ? 'waiting…' : 'sign in'}
              </button>
            )}
          </div>
          {outlook.signedIn && (
            <>
              <div className="setting-row">
                <span style={{ flex: 1 }}>Teams — chats you owe a reply</span>
                <button
                  className="mini-btn"
                  style={{ color: s.teamsEnabled ? 'var(--teal)' : undefined }}
                  onClick={() => void window.taskdeck.setSettings({ teamsEnabled: !s.teamsEnabled })}
                >
                  {s.teamsEnabled ? 'on' : 'off'}
                </button>
              </div>
              <div className="setting-row">
                <span style={{ flex: 1 }}>Write-back — completing a mail item marks it read</span>
                <button
                  className="mini-btn"
                  style={{ color: s.writeBackMail ? 'var(--teal)' : undefined }}
                  onClick={() => void window.taskdeck.setSettings({ writeBackMail: !s.writeBackMail })}
                >
                  {s.writeBackMail ? 'on' : 'off'}
                </button>
              </div>
            </>
          )}
          {deviceCode && signingIn && (
            <div className="setting-row" style={{ borderColor: 'var(--teal-border)', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Enter this code at the Microsoft sign-in page:
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 16, letterSpacing: '0.1em', color: 'var(--teal-bright)' }}>
                  {deviceCode.userCode}
                </span>
                <button
                  className="mini-btn"
                  onClick={() => {
                    void window.taskdeck.copyToClipboard(deviceCode.userCode)
                    void window.taskdeck.openExternal(deviceCode.verificationUri)
                  }}
                >
                  copy + open sign-in page
                </button>
              </div>
            </div>
          )}
          {!outlook.signedIn && (
            <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                Signs in as you via Microsoft's public "Graph Command Line Tools" client — no app
                registration needed. Advanced: use your own Entra registration instead (see
                MANUAL-SETUP.md):
              </span>
              <input
                className="key-input"
                placeholder="Application (client) ID"
                defaultValue={s.outlookClientId}
                onBlur={(e) => void window.taskdeck.setSettings({ outlookClientId: e.target.value.trim() })}
              />
              <input
                className="key-input"
                placeholder="Directory (tenant) ID"
                defaultValue={s.outlookTenantId}
                onBlur={(e) => void window.taskdeck.setSettings({ outlookTenantId: e.target.value.trim() })}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="label" style={{ color: 'var(--text-faint)' }}>
            GitHub · read-only
          </div>
          <ConnectorRow
            ctx={ctx}
            name="github"
            state={ctx.state.github}
            hint="Fine-grained PAT with Pull requests + Issues + Metadata read (see MANUAL-SETUP.md)"
            placeholder="github_pat_…"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="label" style={{ color: 'var(--text-faint)' }}>
            Jira · read-only
          </div>
          <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <input
              className="key-input"
              placeholder="Site URL, e.g. https://efsta.atlassian.net"
              defaultValue={s.jiraSiteUrl}
              onBlur={(e) => void window.taskdeck.setSettings({ jiraSiteUrl: e.target.value.trim() })}
            />
            <input
              className="key-input"
              placeholder="Account email"
              defaultValue={s.jiraEmail}
              onBlur={(e) => void window.taskdeck.setSettings({ jiraEmail: e.target.value.trim() })}
            />
          </div>
          <ConnectorRow
            ctx={ctx}
            name="jira"
            state={ctx.state.jira}
            hint="API token from id.atlassian.com → Security → API tokens"
            placeholder="Jira API token…"
          />
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
