# TaskDeck

A slim, always-on-top task deck for one screen edge — near-zero-friction capture plus an AI triage
partner that **proposes** structure, priority, and follow-ups, which you approve with one click.

Design brief: [taskdeck-design-brief.md](taskdeck-design-brief.md) · UI spec: the `TaskDeck.dc.html`
prototype in the "Design Brief Review" Claude design project.

## v0 scope (this build)

- **Pinned deck** — frameless 420px column docked to the right edge, always on top, dimmed at rest.
- **Quick capture** — global hotkey `Ctrl+Shift+Space` opens a spotlight anywhere in Windows.
  Type or paste anything, Enter, done. No fields.
- **AI triage** (Claude Haiku) — new captures are batch-triaged in the background into proposals
  (title, type, bucket, priority, deadline, owner). Every proposal is a one-click accept/reject
  chip; rejections are fed back into later prompts.
- **Opinionated list** — *Now* (hard cap, default 5) / *Next* / *Waiting on* / *Someday* / *Inbox*.
- **Anti-graveyard** — items untouched past the staleness threshold get confronted:
  kill / delegate (with owner picker) / schedule / keep.
- **Chase nudges** — quiet *Waiting on* entries get a drafted follow-up to copy.
- **Morning briefing** (Claude Opus) — needs-attention list plus a proposed Now set you can accept
  in one click. Deterministic fallback when offline.
- **Triage mode** — keyboard-first inbox processing: `A` accept · `Z` monday · `D` dismiss.
- **Activity log** — every capture, proposal, accept/reject, and move is recorded ("why is this here?").
- **Screen-share privacy** — content protection (`WDA_EXCLUDEFROMCAPTURE`) is ON by default: the
  deck and capture windows are invisible to screen shares and recordings. Toggle via the ◉ button.
- **Cost counter** — every API call's tokens and cost land in the monthly counter (Settings).

Data is local SQLite (via Node's built-in `node:sqlite`) in `%APPDATA%/taskdeck/taskdeck.db`.
Only the AI calls leave the machine.

## Keyboard

| Key | Where | Action |
| --- | --- | --- |
| `Ctrl+Shift+Space` | global | quick capture |
| `C` | deck | quick capture |
| `B` | deck | morning briefing |
| `T` | deck | triage mode |
| `A` / `S` | deck | activity log / settings |
| `A` / `Z` / `D` | triage | accept / monday / dismiss |
| `Esc` | anywhere | close overlay / dismiss capture |

## Setup

```powershell
npm install
npm run dev        # development with hot reload
npm run build      # production build to out/
npm run dist       # build the Windows installer to dist/TaskDeck Setup x.y.z.exe
npm run typecheck  # tsc over main+preload and renderer
npm test           # vitest unit tests
npm run icons      # regenerate build/icon.ico + resources/tray.png
```

Install via the setup exe from `npm run dist`. The app lives in the tray: closing the deck window
hides it, the tray menu has Show deck / Quick capture / Morning briefing / Quit. Start-with-Windows
is on by default (Settings → Behavior), the capture hotkey is configurable there too, and the
morning briefing opens automatically on the first interaction of each day.

### Agent backends

The brain is provider-pluggable (Settings → Agent → Provider):

| Provider | Auth | Billing | Notes |
| --- | --- | --- | --- |
| `cli` | logged-in Claude Code (`claude` on PATH) | **covered by your Max plan** | headless `claude -p --output-format json`; schema prompt-enforced + Zod-validated with one retry |
| `api` | API key | pay per token | schema enforced by the API (`output_config.format`) |
| `auto` (default) | — | — | prefers `cli` when available, else `api` when a key is set, else offline |

The API key can be entered on the Settings page (stored encrypted via Windows DPAPI /
`safeStorage`) or provided via the `ANTHROPIC_API_KEY` environment variable; a settings-stored key
wins. CLI calls strip `ANTHROPIC_API_KEY` from the child environment so they always bill against
the subscription, never the key. Triage and briefing models are selectable in Settings
(defaults: Haiku 4.5 for triage, Opus 4.8 for the briefing).

## Architecture

```
src/shared    types + display helpers (contract between processes)
src/main      Electron main: windows/hotkey, node:sqlite store, scheduler, Anthropic brain, IPC
src/preload   contextBridge → window.taskdeck
src/renderer  React deck UI (index.html) + capture spotlight (capture.html)
```

- The **scheduler** debounces new captures into one batched Haiku call and runs the deterministic
  scans (staleness, chase, Now overflow) locally at no API cost.
- All mutations go through the main process; renderers are stateless views over `state:get` +
  a `state-changed` push.
- Models: `claude-haiku-4-5` for triage, `claude-opus-4-8` for the briefing. Structured outputs
  via `messages.parse()` + Zod schemas.

## Integrations (all read-only unless noted)

| Source | What lands in the deck | Setup |
| --- | --- | --- |
| Outlook mail | unread/flagged inbox mails → AI-triaged candidates | Microsoft sign-in (device code, no app registration — see MANUAL-SETUP.md) |
| Outlook calendar | today's meetings in the briefing | same sign-in |
| Teams | chats you owe a reply → candidates | same sign-in (toggleable) |
| GitHub | PRs awaiting your review → *do*; your open PRs → *waiting on* | fine-grained PAT |
| Jira | open issues assigned to you → candidates (with due dates) | site + email + API token |
| Write-back (v3, opt-in) | completing a mail item marks the mail read in Outlook | Settings toggle |

Integration candidates are deduped by source id, tombstoned when dismissed (they stay gone),
and auto-removed while untriaged once handled at the source. Structured sources (GitHub, Jira,
Teams) get deterministic proposals with no AI cost; mails go through AI triage.
