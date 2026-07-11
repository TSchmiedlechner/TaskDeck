import type { ConnectorState } from '@shared/types'
import { getEncryptedKv } from '../keystore'
import type { Store } from '../store'
import { applyCandidates, type ExternalCandidate } from './common'

const SYNC_INTERVAL_MS = 5 * 60_000
export const JIRA_TOKEN_KV = 'jiraToken'

export interface JiraIssue {
  key: string
  fields: {
    summary: string
    duedate?: string | null
    priority?: { name?: string } | null
  }
}

export function issueToCandidate(issue: JiraIssue, siteUrl: string): ExternalCandidate {
  const title = `${issue.key} — ${issue.fields.summary}`
  const priorityName = issue.fields.priority?.name?.toLowerCase() ?? ''
  const priority = priorityName.includes('high') || priorityName.includes('critical') ? 1 : null
  return {
    externalId: `jira:${issue.key}`,
    title,
    rawText: `Jira issue assigned to you: ${issue.key} "${issue.fields.summary}"`,
    meta: `jira · ${issue.key}${issue.fields.duedate ? ` · due ${issue.fields.duedate}` : ''}`,
    url: `${siteUrl.replace(/\/$/, '')}/browse/${issue.key}`,
    proposal: {
      title,
      type: 'do',
      bucket: 'next',
      priority,
      deadline: issue.fields.duedate ?? null,
      owner: null,
      extra: issue.fields.duedate ? `due ${issue.fields.duedate}` : null
    }
  }
}

/** Open Jira issues assigned to you become inbox candidates. Read-only. */
export class JiraSync {
  private timer: NodeJS.Timeout | null = null
  private syncing = false
  lastSync: string | null = null
  lastError: string | null = null

  constructor(
    private store: Store,
    private notify: () => void
  ) {}

  private config(): { siteUrl: string; email: string; token: string } | null {
    const { jiraSiteUrl, jiraEmail } = this.store.getSettings()
    const token = getEncryptedKv(this.store, JIRA_TOKEN_KV)
    if (!jiraSiteUrl || !jiraEmail || !token) return null
    return { siteUrl: jiraSiteUrl, email: jiraEmail, token }
  }

  state(): ConnectorState {
    return { configured: this.config() !== null, lastSync: this.lastSync, error: this.lastError }
  }

  start(): void {
    this.stop()
    this.timer = setInterval(() => void this.syncNow(), SYNC_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async syncNow(): Promise<void> {
    const config = this.config()
    if (!config || this.syncing) return
    this.syncing = true
    try {
      const jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'
      const params = new URLSearchParams({ jql, fields: 'summary,duedate,priority', maxResults: '25' })
      const res = await fetch(`${config.siteUrl.replace(/\/$/, '')}/rest/api/3/search/jql?${params}`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}`,
          Accept: 'application/json'
        }
      })
      if (!res.ok) throw new Error(`Jira search returned ${res.status}`)
      const data = (await res.json()) as { issues: JiraIssue[] }
      const candidates = data.issues.map((i) => issueToCandidate(i, config.siteUrl))
      const changed = applyCandidates(this.store, 'jira', candidates, 'resolved in Jira — candidate removed')
      this.lastSync = new Date().toISOString()
      this.lastError = null
      if (changed) this.notify()
    } catch (err) {
      this.lastError = (err as Error).message
      this.store.logActivity(null, 'system', `Jira sync failed: ${this.lastError}`)
      this.notify()
    } finally {
      this.syncing = false
    }
  }
}
