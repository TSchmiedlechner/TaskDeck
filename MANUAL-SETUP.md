# Manual setup log

Things TaskDeck cannot do for you: accounts, tokens, and consents. One section per
integration, with a checkbox log at the bottom. Keep this updated when setup state changes.

## Anthropic (the triage/briefing brain)

Pick one — the app auto-detects (Settings → Agent → Provider `auto`):

- [ ] **CLI / Max plan (recommended):** be logged in to Claude Code (`claude` on PATH).
      Run `claude` once and sign in; TaskDeck's calls are then covered by the Max subscription.
- [ ] **API key:** create a key at console.anthropic.com and paste it in Settings → Agent →
      API key (stored encrypted via DPAPI). Pay-per-token.

## Microsoft (Outlook mail, calendar, Teams 👀, mail write-back)

- [ ] **Sign in** — Settings → Outlook → *sign in* → enter the device code at
      microsoft.com/devicelogin. No app registration needed: TaskDeck uses Microsoft's
      first-party public client ("Microsoft Graph Command Line Tools",
      `14d82eec-204b-4c2f-b7e8-296a70dab67e`). Consent once to the delegated scopes:
      `Mail.ReadWrite`, `Calendars.Read`, `Chat.Read`, `User.Read`.
      (`Mail.ReadWrite` is requested so the optional write-back toggle can complete flags
      and mark mails read; the sync itself never writes unless you enable that toggle.
      `Chat.Read` feeds the Teams 👀-reaction sync.)

**Optional — own Entra app registration** (cleaner consent screen, survives tenant policy
changes that might block the Graph CLI client):

1. entra.microsoft.com → App registrations → New registration → name `TaskDeck`,
   single tenant, no redirect URI.
2. Authentication → Advanced settings → **Allow public client flows: Yes** → Save.
3. API permissions → Microsoft Graph → *Delegated* → `Mail.ReadWrite`, `Calendars.Read`,
   `Chat.Read` (+ default `User.Read`).
4. Paste the Application (client) ID and Directory (tenant) ID into Settings → Outlook →
   advanced fields (visible while signed out), then sign in again.

Caveats of the default public client: consent prompt shows Microsoft's app name, and a
conditional-access policy blocking device-code flow or that client would break sign-in —
switch to the own registration in that case.

## GitHub (PRs awaiting your review / your PRs awaiting others)

- [ ] Create a **fine-grained personal access token** at github.com → Settings →
      Developer settings → Fine-grained tokens:
      - Resource owner: your org (efsta) and/or your user, All repositories
      - Repository permissions: **Pull requests: Read**, **Issues: Read**, **Metadata: Read**
      - Expiration: your call (put a renewal reminder in TaskDeck when it's set to expire)
- [ ] Paste it in Settings → GitHub → token (stored encrypted).

## Jira (issues assigned to you)

- [ ] Create an API token at id.atlassian.com → Security → API tokens.
- [ ] In Settings → Jira enter: site URL (e.g. `https://efsta.atlassian.net`), your
      Atlassian account email, and the token (stored encrypted).

## Log

| Date | Action | Status |
| --- | --- | --- |
| 2026-07-11 | Claude CLI login present on this machine — CLI provider active | done |
| 2026-07-11 | Microsoft sign-in via device code (t.schmiedlechner@efsta.eu) | done |
| 2026-07-11 | GitHub fine-grained PAT | pending |
| 2026-07-11 | Jira API token | pending |
