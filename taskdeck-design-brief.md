# TaskDeck — Design Brief

*A personal work-organization hub for a hands-on CTO. Working title "TaskDeck" — rename freely.*

**Owner:** Tom Schmiedlechner (t.schmiedlechner@efsta.eu)
**Date:** 2026-07-11
**Status:** Decisions locked, ready for design.

---

## 1. The problem

The owner is a CTO managing ~20 people while staying deeply involved in operational work. Every existing todo tool has failed him (Microsoft To Do, Obsidian, plain text files, Notepad, Outlook "todo" appointments, keeping emails unread as task markers). The failure pattern is consistent and diagnostic:

1. **Capture friction kills adoption.** Notepad wins because it's instant. Any tool that demands a project, priority, or due date at capture time loses.
2. **Lists become graveyards.** The list mixes 2-minute operational items, delegation follow-ups, strategic topics, and pending decisions. Nothing is ever removed, the list outgrows trust, and it gets abandoned.
3. **Storage was never the problem — triage was.** What's missing is the ongoing *editorial* work: structuring raw dumps, keeping "today" short, chasing stale items, confronting the owner with rotting entries. That is exactly what an LLM can now do continuously.

**The thesis:** don't build a better list. Build an *inbox with a brain* — near-zero-friction capture plus an AI triage partner that proposes structure, priority, and follow-ups, which the owner approves with one click.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Form factor | Windows desktop app, slim always-on-top window pinned to one screen |
| Scope ambition | Full hub: Outlook mail, Outlook calendar, Teams mentions, GitHub, Jira (+ Confluence as context source later) |
| Integration direction | **Read-only in v1.** The app observes and creates items; acting on mail/Jira stays in the source tool. Write-back (e.g. completing an item marks the mail read) is a later phase. |
| Capture surface | One desktop machine only. Local data, no sync backend, no accounts. |
| AI autonomy | **Proposes, owner approves.** Suggestions appear as one-click accept/reject affordances. The AI never silently rearranges the list. |
| AI functions (all four) | ① structuring raw dumps, ② daily prioritization/briefing, ③ chasing & staleness, ④ context enrichment |
| Stack | Electron + TypeScript. Agent brain via **Claude Agent SDK**; integrations via **MCP connectors** where they exist. |
| Data | Local SQLite (or equivalent). Only AI calls leave the machine. |

## 3. Product concept

### 3.1 The pinned deck

A narrow (~380–450 px) always-on-top column, docked to one monitor's edge. It is the owner's peripheral-vision workspace, glanceable all day. It shows, top to bottom:

- **Now** — hard-capped at ~5 items. The AI defends this cap: it proposes demotions when it overflows.
- **Next** — the short-term queue.
- **Waiting on** — items delegated or blocked on someone, each with *who* and *since when*. The AI nudges: "You've been waiting on Markus for 4 days — chase?"
- **Someday / Parked** — collapsed by default.
- **Inbox** — raw, untriaged captures and integration-sourced candidates, badge-counted.

### 3.2 Capture

- **Global hotkey** (e.g. `Ctrl+Shift+Space`) opens a single borderless text box from anywhere in Windows. Type anything — half a sentence, a pasted email, a URL — hit Enter, it's gone into the Inbox. No fields. This flow must beat Notepad or nothing else matters.
- Paste-friendly: pasting a whole email or Teams message is expected; the AI extracts the actual task from it.

### 3.3 The AI triage partner (propose → approve)

Every AI action surfaces as a **suggestion chip** the owner accepts or rejects with one click (or in bulk). Suggestion types:

- **Structure:** raw dump → clean item: title, type (*do / delegate / waiting-on / decide*), suggested bucket, priority, extracted deadline, detected duplicates/merges.
- **Prioritize:** proposed "Now" set each morning; re-plan proposals when the day blows up ("You accepted 3 urgent items — move X and Y to Next?").
- **Chase:** waiting-on items past a threshold get a "nudge?" chip, with a drafted follow-up message the owner can copy.
- **Staleness (anti-graveyard):** any item untouched for N days gets confronted: **kill / delegate / schedule / keep** — the item cannot silently rot.
- **Enrich:** the agent pulls context from connectors — the related Jira ticket, the mail thread, the PR — and pins it to the item so picking work back up needs no reconstruction.

### 3.4 Daily rhythm

- **Morning briefing** (on first interaction of the day): today's meetings, what's due, what went stale, what arrived overnight from integrations, and a proposed "Now" set. One screen, skimmable in 30 seconds.
- **End-of-day sweep** (optional, gentle): unfinished "Now" items get re-triaged with one keystroke each.

### 3.5 Integration-sourced candidates (read-only)

Connectors poll (or webhook where cheap) and drop *candidate items* into the Inbox — never directly into the list:

| Source | Signal → candidate |
|---|---|
| Outlook mail (Graph) | Unread/flagged mails in inbox → "reply to / handle X" (this replaces the unread-as-todo habit without breaking it) |
| Outlook calendar (Graph) | Meetings feed the briefing; after a meeting, "follow-ups from ⟨meeting⟩?" prompt |
| GitHub | PRs awaiting the owner's review → *do*; owner's PRs awaiting others → *waiting-on* |
| Jira (Atlassian MCP) | Issues assigned to owner / mentions → candidates; primarily used for context enrichment |
| Teams (Graph) | Unanswered @mentions and chats-owed-a-reply → candidates |

The owner triages candidates like any capture: accept (it becomes an item), dismiss, or mute-the-pattern ("never suggest newsletters").

## 4. Architecture

```
┌────────────────────────────── Electron app ──────────────────────────────┐
│  Renderer (UI)                Main process                                │
│  - pinned deck window         - global hotkey + quick-capture window      │
│  - quick-capture window       - SQLite store (items, suggestions, log)    │
│  - suggestion chips           - scheduler (polls, staleness, briefing)    │
│                               - Agent runtime (Claude Agent SDK, TS)      │
│                                   └─ MCP connectors:                      │
│                                        Atlassian (Jira/Confluence) MCP    │
│                                        GitHub MCP                         │
│                                        MS Graph (mail/calendar/Teams) —   │
│                                          MCP if available, else direct    │
│                                          Graph client as agent tools      │
└───────────────────────────────────────────────────────────────────────────┘
```

Key points:

- **The agent *is* the integration layer.** Triage, enrichment, briefing, and connector reads are all agent invocations with MCP tools. Hand-written integration code is limited to auth plumbing and cheap polling for badge counts.
- **Suggestions are first-class data.** Every AI proposal is a row (kind, payload, status: pending/accepted/rejected). Accept/reject history is fed back into prompts so the triage partner learns the owner's taste ("he always kills newsletter candidates", "he never sets priorities below P2").
- **Auth:** Entra app registration for Graph (delegated, device-code or interactive flow — owner is the tenant admin); GitHub PAT or GitHub App; Atlassian API token / existing MCP OAuth. Anthropic API key for the brain. All stored via Windows credential manager (keytar/safeStorage), never in config files.
- **Cost/latency control:** batch triage (Inbox items triaged in one call), cheap model (Haiku-class) for routine structuring, stronger model for the morning briefing and re-planning. Target well under a few $/day.

## 5. Phasing — build in this order

The full hub is the destination; it must not be the first milestone.

1. **v0 — the loop (must beat Notepad):** pinned deck, global-hotkey capture, SQLite, AI structuring + staleness + suggestion chips. *Usable daily from this point; everything after is additive.*
2. **v1 — email + calendar:** Graph auth, unread/flagged-mail candidates, calendar in the morning briefing. This attacks the core unread-as-todo habit.
3. **v1.5 — GitHub + Jira:** both are low-effort (mature APIs/MCP). PR waiting-on tracking; Jira enrichment.
4. **v2 — Teams mentions:** highest API friction (Graph Teams permissions, throttling); do it once everything else has proven out.
5. **v3 — write-back (opt-in per action):** complete-item-marks-mail-read first, since it retires the unread habit completely.

## 6. Design principles for the UI

- **Glanceable > information-dense.** It lives in peripheral vision; resting state must be calm. No red badges screaming all day.
- **Keyboard-first.** Capture, triage (accept/reject/bucket), and sweep must all work without the mouse.
- **The AI is a colleague, not a poltergeist.** Every change it wants is visible, attributable, and one keystroke to accept or reject. An activity log answers "why is this item here?"
- **Trust is the product.** If "Now" is ever wrong or the list ever feels stale, the tool is dead. Bias every tradeoff toward keeping the list small and current rather than complete.
- Dark/light following OS theme; unobtrusive when unfocused (slightly dimmed), full contrast on hover/focus.

## 7. Open questions for the design phase

1. Visual identity and density of the deck — card-based vs. dense rows? How does an item with pending suggestion chips look vs. a settled one?
2. Quick-capture window styling and placement (centered spotlight-style vs. attached to the deck)?
3. How the morning briefing is presented — overlay, top-of-deck section, or separate view?
4. Interaction pattern for bulk triage of the Inbox (keyboard-driven "process one by one" mode?).
5. Behavior when the deck is on a screen that gets a fullscreen app / screen-share (auto-hide? privacy blur for item text during screen sharing?).
6. Snooze semantics ("resurface Monday") — first-class or just a scheduled staleness prompt?

## 8. Risks

- **Teams/Graph API friction** — mitigated by phasing it last.
- **Suggestion fatigue** — if chips are too chatty, propose-and-approve becomes propose-and-ignore. Batch suggestions, learn from rejections, and keep a "quiet hours" notion.
- **Half-built hub abandonment** — mitigated by v0 being independently useful within days, integrations strictly additive.
- **API cost creep** — batching + model tiering as above; show a monthly cost counter in settings for transparency.
