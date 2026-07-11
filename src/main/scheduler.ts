import type { Store } from './store'
import type { Brain } from './brain'
import { findChaseItems, findNowOverflowCandidate, findStaleItems } from './logic'
import type { Item } from '@shared/types'

/**
 * Drives the background loops: AI triage of new captures (debounced batch),
 * and the deterministic scans (staleness confrontation, chase nudges, Now overflow).
 */
export class Scheduler {
  private triageTimer: NodeJS.Timeout | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private intervalHandle: NodeJS.Timeout | null = null
  private triaging = false
  /** itemId -> epoch ms of last triage attempt, so failures don't hot-loop */
  private attempted = new Map<string, number>()

  constructor(
    private store: Store,
    private brain: Brain,
    private notify: () => void
  ) {}

  start(): void {
    this.runScans()
    this.scheduleTriage()
    this.intervalHandle = setInterval(() => {
      this.runScans()
      this.scheduleTriage()
    }, 30 * 60_000)
  }

  stop(): void {
    if (this.triageTimer) clearTimeout(this.triageTimer)
    if (this.scanTimer) clearTimeout(this.scanTimer)
    if (this.intervalHandle) clearInterval(this.intervalHandle)
  }

  /** Call after any mutation: debounces triage of fresh captures and re-runs the scans. */
  onMutation(): void {
    this.scheduleTriage()
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => this.runScans(), 4_000)
  }

  pendingTriageCount(): number {
    return this.untriaged().length
  }

  private untriaged(): Item[] {
    return this.store
      .listItems()
      .filter(
        (i) =>
          i.bucket === 'inbox' &&
          i.rawText !== null &&
          !this.store.hasPendingSuggestion(i.id, 'structure') &&
          !this.store.recentlyRejected(i.id, 'structure', 24)
      )
  }

  private scheduleTriage(): void {
    if (this.triageTimer) clearTimeout(this.triageTimer)
    this.triageTimer = setTimeout(() => void this.runTriage(), 3_000)
  }

  private async runTriage(): Promise<void> {
    if (this.triaging || this.brain.status === 'offline') return
    const cutoff = Date.now() - 60_000
    const batch = this.untriaged().filter((i) => (this.attempted.get(i.id) ?? 0) < cutoff)
    if (batch.length === 0) return

    this.triaging = true
    try {
      for (const i of batch) this.attempted.set(i.id, Date.now())
      const proposals = await this.brain.triage(batch.map((i) => ({ id: i.id, text: i.rawText! })))
      for (const [itemId, p] of proposals) {
        const item = this.store.getItem(itemId)
        if (!item || item.bucket !== 'inbox') continue // user acted on it meanwhile
        if (this.store.hasPendingSuggestion(itemId, 'structure')) continue
        const chips = [p.type, `→ ${p.bucket}`, p.extra].filter(Boolean).join(' · ')
        this.store.createSuggestion(
          itemId,
          'structure',
          'ai',
          `“${p.title}” · ${chips}`,
          [
            { id: 'accept', label: 'Accept', kind: 'primary' },
            { id: 'snooze', label: 'Monday', kind: 'ghost' },
            { id: 'dismiss', label: 'Dismiss', kind: 'danger' }
          ],
          p as unknown as Record<string, unknown>
        )
        this.store.logActivity(itemId, 'agent', `Proposed: "${p.title}" (${p.type} → ${p.bucket})`)
      }
      if (proposals.size > 0) this.notify()
    } finally {
      this.triaging = false
    }
  }

  /** Deterministic scans — no API cost. */
  runScans(): void {
    const settings = this.store.getSettings()
    const items = this.store.listItems()
    const now = new Date()
    let changed = false

    for (const item of findStaleItems(items, settings, now)) {
      if (this.store.hasPendingSuggestion(item.id, 'staleness')) continue
      if (this.store.recentlyRejected(item.id, 'staleness', 72)) continue
      const days = Math.floor((now.getTime() - new Date(item.updatedAt).getTime()) / 86_400_000)
      this.store.createSuggestion(
        item.id,
        'staleness',
        'warn',
        `Untouched for ${days} days. It doesn’t get to rot — pick one:`,
        [
          { id: 'kill', label: 'Kill', kind: 'danger' },
          { id: 'delegate', label: 'Delegate', kind: 'ghost', needsOwner: true },
          { id: 'schedule', label: 'Schedule', kind: 'ghost' },
          { id: 'keep', label: 'Keep', kind: 'ghost' }
        ],
        null
      )
      this.store.logActivity(item.id, 'agent', `Flagged as stale (${days} days untouched)`)
      changed = true
    }

    for (const item of findChaseItems(items, settings, now)) {
      if (this.store.hasPendingSuggestion(item.id, 'chase')) continue
      if (this.store.recentlyRejected(item.id, 'chase', 48)) continue
      const days = Math.floor((now.getTime() - new Date(item.updatedAt).getTime()) / 86_400_000)
      const who = item.owner ?? 'them'
      const draft = `Hi ${who} — any blockers on "${item.title}"? Let me know if you need anything from me to move it forward.`
      this.store.createSuggestion(
        item.id,
        'chase',
        'warn',
        `${days} days quiet. A short nudge is drafted — “any blockers on this?”`,
        [
          { id: 'copyDraft', label: 'Copy draft', kind: 'primary' },
          { id: 'keep', label: 'Not yet', kind: 'ghost' }
        ],
        { draft }
      )
      changed = true
    }

    const overflow = findNowOverflowCandidate(items, settings)
    if (
      overflow &&
      !this.store.hasPendingSuggestion(overflow.id, 'now-overflow') &&
      !this.store.recentlyRejected(overflow.id, 'now-overflow', 24)
    ) {
      const count = items.filter((i) => i.bucket === 'now').length
      this.store.createSuggestion(
        overflow.id,
        'now-overflow',
        'ai',
        `Now is at ${count}/${settings.nowCap}. This looks like the one to move — no deadline pressure. Move to Next?`,
        [
          { id: 'toNext', label: 'Move to Next', kind: 'primary' },
          { id: 'keep', label: 'Keep in Now', kind: 'ghost' }
        ],
        null
      )
      changed = true
    }

    if (changed) this.notify()
  }
}
