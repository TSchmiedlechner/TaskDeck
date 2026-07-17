import {
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
  type ICachePlugin,
  type TokenCacheContext
} from '@azure/msal-node'
import type { DeviceCodePrompt, Meeting, OutlookState } from '@shared/types'
import { getEncryptedKv, setEncryptedKv } from './keystore'
import { applyCandidates } from './connectors/common'
import {
  eventToMeeting,
  eyesMessageToCandidate,
  hasMyEyesReaction,
  mailToCandidate,
  type GraphChat,
  type GraphChatMessage,
  type GraphEvent,
  type GraphMessage
} from './outlook-map'
import type { Store } from './store'

// Mail.ReadWrite (superset of Mail.Read) so the optional write-back toggle can mark
// mails handled; the sync itself never writes unless that toggle is on.
const SCOPES = ['User.Read', 'Mail.ReadWrite', 'Calendars.Read', 'Chat.Read']
// Teams 👀 polling window: the N most recently active chats × the M most recently
// modified messages in each. Reacting bumps a message's lastModifiedDateTime, so even
// old messages surface when marked. 50 is Graph's max page size for chat messages.
const TEAMS_CHAT_COUNT = 20
const TEAMS_MESSAGES_PER_CHAT = 50
const GRAPH = 'https://graph.microsoft.com/v1.0'
const SYNC_INTERVAL_MS = 3 * 60_000
const CACHE_KV = 'msalTokenCache'

/**
 * Read-only Outlook/Teams integration: flagged inbox mails and 👀-reacted Teams chat
 * messages become inbox candidates (flag / react = put it on the deck); today's
 * calendar feeds the briefing. Auth is MSAL device-code with the token cache
 * encrypted at rest.
 */
export class OutlookSync {
  private pca: PublicClientApplication | null = null
  private pcaConfigKey = ''
  private timer: NodeJS.Timeout | null = null
  private syncing = false
  private account: AccountInfo | null = null
  private myUserId: string | null = null
  lastSync: string | null = null
  lastError: string | null = null
  todayEvents: Meeting[] = []

  constructor(
    private store: Store,
    private notify: () => void,
    private onDeviceCode: (prompt: DeviceCodePrompt) => void
  ) {}

  private cachePlugin(): ICachePlugin {
    return {
      beforeCacheAccess: async (ctx: TokenCacheContext) => {
        const raw = getEncryptedKv(this.store, CACHE_KV)
        if (raw) ctx.tokenCache.deserialize(raw)
      },
      afterCacheAccess: async (ctx: TokenCacheContext) => {
        if (ctx.cacheHasChanged) setEncryptedKv(this.store, CACHE_KV, ctx.tokenCache.serialize())
      }
    }
  }

  private client(): PublicClientApplication | null {
    const { outlookClientId, outlookTenantId } = this.store.getSettings()
    if (!outlookClientId || !outlookTenantId) return null
    const configKey = `${outlookClientId}|${outlookTenantId}`
    if (!this.pca || this.pcaConfigKey !== configKey) {
      const config: Configuration = {
        auth: {
          clientId: outlookClientId,
          authority: `https://login.microsoftonline.com/${outlookTenantId}`
        },
        cache: { cachePlugin: this.cachePlugin() }
      }
      this.pca = new PublicClientApplication(config)
      this.pcaConfigKey = configKey
      this.account = null
    }
    return this.pca
  }

  async state(): Promise<OutlookState> {
    const settings = this.store.getSettings()
    const configured = Boolean(settings.outlookClientId && settings.outlookTenantId)
    if (configured && !this.account) await this.loadCachedAccount()
    return {
      configured,
      signedIn: this.account !== null,
      account: this.account?.username ?? null,
      lastSync: this.lastSync,
      error: this.lastError
    }
  }

  private async loadCachedAccount(): Promise<void> {
    const pca = this.client()
    if (!pca) return
    const accounts = await pca.getTokenCache().getAllAccounts()
    this.account = accounts[0] ?? null
  }

  async signIn(): Promise<boolean> {
    const pca = this.client()
    if (!pca) return false
    this.lastError = null
    try {
      const result = await pca.acquireTokenByDeviceCode({
        scopes: SCOPES,
        deviceCodeCallback: (info) =>
          this.onDeviceCode({ userCode: info.userCode, verificationUri: info.verificationUri })
      })
      this.account = result?.account ?? null
      if (this.account) {
        this.store.logActivity(null, 'system', `Outlook connected as ${this.account.username}`)
        this.start()
        void this.syncNow()
      }
      this.notify()
      return this.account !== null
    } catch (err) {
      this.lastError = (err as Error).message
      this.notify()
      return false
    }
  }

  async signOut(): Promise<void> {
    const pca = this.client()
    if (pca && this.account) await pca.getTokenCache().removeAccount(this.account)
    setEncryptedKv(this.store, CACHE_KV, '')
    this.account = null
    this.myUserId = null
    this.todayEvents = []
    this.stop()
    this.store.logActivity(null, 'system', 'Outlook disconnected')
    this.notify()
  }

  private async token(): Promise<string | null> {
    const pca = this.client()
    if (!pca) return null
    if (!this.account) await this.loadCachedAccount()
    if (!this.account) return null
    try {
      const result = await pca.acquireTokenSilent({ scopes: SCOPES, account: this.account })
      return result?.accessToken ?? null
    } catch (err) {
      this.lastError = `Token refresh failed: ${(err as Error).message}`
      return null
    }
  }

  start(): void {
    this.stop()
    this.timer = setInterval(() => void this.syncNow(), SYNC_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async graphGet<T>(accessToken: string, path: string): Promise<T> {
    const res = await fetch(`${GRAPH}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) {
      // Surface Graph's own error code/message — a bare status is undebuggable.
      let detail = ''
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } }
        if (body.error) detail = ` — ${body.error.code}: ${body.error.message}`
      } catch {
        // non-JSON error body
      }
      throw new Error(`Graph ${path.split('?')[0]} returned ${res.status}${detail}`)
    }
    return (await res.json()) as T
  }

  async syncNow(): Promise<void> {
    if (this.syncing) return
    this.syncing = true
    try {
      const accessToken = await this.token()
      if (!accessToken) return
      // Per-source isolation: a Teams consent/licensing failure must not break mail sync.
      const errors: string[] = []
      const guard = async (name: string, fn: () => Promise<void>): Promise<void> => {
        try {
          await fn()
        } catch (err) {
          errors.push(`${name}: ${(err as Error).message}`)
        }
      }
      await Promise.all([
        guard('mail', () => this.syncMail(accessToken)),
        guard('calendar', () => this.syncCalendar(accessToken)),
        guard('teams', () => this.syncTeams(accessToken))
      ])
      this.lastSync = new Date().toISOString()
      this.lastError = errors.length > 0 ? errors.join(' · ') : null
      if (this.lastError) this.store.logActivity(null, 'system', `Outlook sync: ${this.lastError}`)
    } catch (err) {
      this.lastError = (err as Error).message
      this.store.logActivity(null, 'system', `Outlook sync failed: ${this.lastError}`)
    } finally {
      this.syncing = false
      this.notify()
    }
  }

  /** Write-back (opt-in): complete the flag (and mark read) on the mail behind a completed item. */
  async markMailHandled(externalId: string): Promise<boolean> {
    const accessToken = await this.token()
    if (!accessToken) return false
    const messageId = externalId.replace(/^outlook:/, '')
    const res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: true, flag: { flagStatus: 'complete' } })
    })
    return res.ok
  }

  private async syncMail(accessToken: string): Promise<void> {
    // No $orderby here: combining a $filter on flag with $orderby on
    // receivedDateTime makes Graph reject the query as "too complex" on real
    // mailboxes. The default folder order is receivedDateTime desc anyway.
    const filter = encodeURIComponent("flag/flagStatus eq 'flagged'")
    const select = 'id,subject,bodyPreview,receivedDateTime,webLink,from'
    const data = await this.graphGet<{ value: GraphMessage[] }>(
      accessToken,
      `/me/mailFolders/inbox/messages?$filter=${filter}&$select=${select}&$top=25`
    )
    const newestFirst = [...data.value].sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime))
    applyCandidates(this.store, 'outlook', newestFirst.map(mailToCandidate), 'unflagged in Outlook — candidate removed')
  }

  /**
   * Teams: a chat message you react 👀 to becomes a candidate. Graph has no
   * "messages I reacted to" query, so this polls a window (recent chats × recently
   * modified messages — reactions bump lastModifiedDateTime). The `seen` set makes
   * removal explicit-only: un-reacting removes the candidate, a message merely
   * falling out of the window does not.
   */
  private async syncTeams(accessToken: string): Promise<void> {
    if (!this.store.getSettings().teamsEnabled) return
    if (!this.myUserId) {
      const me = await this.graphGet<{ id: string }>(accessToken, '/me?$select=id')
      this.myUserId = me.id
    }
    const myUserId = this.myUserId
    const chats = await this.graphGet<{ value: GraphChat[] }>(
      accessToken,
      `/me/chats?$select=id,topic,chatType&$orderby=lastMessagePreview/createdDateTime%20desc&$top=${TEAMS_CHAT_COUNT}`
    )
    const matched: ReturnType<typeof eyesMessageToCandidate>[] = []
    const seen = new Set<string>()
    // Sequential on purpose: ~20 quick calls beat tripping Graph's chat throttling.
    for (const chat of chats.value) {
      const msgs = await this.graphGet<{ value: GraphChatMessage[] }>(
        accessToken,
        `/me/chats/${encodeURIComponent(chat.id)}/messages?$top=${TEAMS_MESSAGES_PER_CHAT}`
      )
      for (const m of msgs.value) {
        if (m.messageType !== 'message') continue
        seen.add(`teams:${m.id}`)
        if (hasMyEyesReaction(m, myUserId)) matched.push(eyesMessageToCandidate(m, chat))
      }
    }
    applyCandidates(this.store, 'teams', matched, 'unmarked in Teams — candidate removed', seen)
  }

  private async syncCalendar(accessToken: string): Promise<void> {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const data = await this.graphGet<{ value: GraphEvent[] }>(
      accessToken,
      `/me/calendarView?startDateTime=${dayStart.toISOString()}&endDateTime=${dayEnd.toISOString()}` +
        `&$select=subject,start,end,isAllDay&$orderby=start/dateTime&$top=20`
    )
    this.todayEvents = data.value.map(eventToMeeting)
  }
}
