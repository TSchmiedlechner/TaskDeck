import type { ConnectorState } from '@shared/types'
import { getEncryptedKv } from '../keystore'
import type { Store } from '../store'
import { applyCandidates, type ExternalCandidate } from './common'

const SYNC_INTERVAL_MS = 3 * 60_000
export const GITHUB_TOKEN_KV = 'githubToken'

/** The GitHub search-API fields we consume */
export interface GithubSearchItem {
  id: number
  number: number
  title: string
  html_url: string
  repository_url: string
  draft?: boolean
}

function repoName(item: GithubSearchItem): string {
  return item.repository_url.split('/repos/')[1] ?? 'unknown/repo'
}

export function reviewRequestToCandidate(item: GithubSearchItem): ExternalCandidate {
  const repo = repoName(item)
  const title = `Review PR ${repo}#${item.number} — ${item.title}`
  return {
    externalId: `github:review:${item.id}`,
    title,
    rawText: `Pull request awaiting your review: ${repo}#${item.number} "${item.title}"\n${item.html_url}`,
    meta: `github · ${repo} · review requested`,
    url: item.html_url,
    proposal: {
      title,
      type: 'do',
      bucket: 'next',
      priority: 2,
      deadline: null,
      owner: null,
      extra: 'review requested'
    }
  }
}

export function ownPrToCandidate(item: GithubSearchItem): ExternalCandidate {
  const repo = repoName(item)
  const title = `PR ${repo}#${item.number} awaiting review — ${item.title}`
  return {
    externalId: `github:own:${item.id}`,
    title,
    rawText: `Your open pull request: ${repo}#${item.number} "${item.title}"\n${item.html_url}`,
    meta: `github · ${repo} · your PR`,
    url: item.html_url,
    proposal: {
      title,
      type: 'waiting',
      bucket: 'waiting',
      priority: null,
      deadline: null,
      owner: 'reviewers',
      extra: 'your PR'
    }
  }
}

/** PRs awaiting your review → do-candidates; your open PRs → waiting-on candidates. Read-only. */
export class GithubSync {
  private timer: NodeJS.Timeout | null = null
  private syncing = false
  lastSync: string | null = null
  lastError: string | null = null

  constructor(
    private store: Store,
    private notify: () => void
  ) {}

  private token(): string | null {
    return getEncryptedKv(this.store, GITHUB_TOKEN_KV)
  }

  state(): ConnectorState {
    return { configured: this.token() !== null, lastSync: this.lastSync, error: this.lastError }
  }

  start(): void {
    this.stop()
    this.timer = setInterval(() => void this.syncNow(), SYNC_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async search(token: string, query: string): Promise<GithubSearchItem[]> {
    const res = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=25`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TaskDeck'
      }
    })
    if (!res.ok) throw new Error(`GitHub search returned ${res.status}`)
    const data = (await res.json()) as { items: GithubSearchItem[] }
    return data.items
  }

  async syncNow(): Promise<void> {
    const token = this.token()
    if (!token || this.syncing) return
    this.syncing = true
    try {
      const [reviewRequests, ownPrs] = await Promise.all([
        this.search(token, 'is:open is:pr review-requested:@me archived:false'),
        this.search(token, 'is:open is:pr author:@me archived:false')
      ])
      const candidates = [
        ...reviewRequests.filter((p) => !p.draft).map(reviewRequestToCandidate),
        ...ownPrs.filter((p) => !p.draft).map(ownPrToCandidate)
      ]
      const changed = applyCandidates(this.store, 'github', candidates, 'resolved on GitHub — candidate removed')
      this.lastSync = new Date().toISOString()
      this.lastError = null
      if (changed) this.notify()
    } catch (err) {
      this.lastError = (err as Error).message
      this.store.logActivity(null, 'system', `GitHub sync failed: ${this.lastError}`)
      this.notify()
    } finally {
      this.syncing = false
    }
  }
}
