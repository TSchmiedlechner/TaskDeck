import type { Item } from './types'

export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
}

export function isSnoozed(item: Item, now: Date): boolean {
  return item.snoozedUntil !== null && new Date(item.snoozedUntil) > now
}

/**
 * Full-text match across an item's visible and underlying text. Whitespace-separated
 * tokens are ANDed, so "julia rollout" matches an item mentioning both. Searches the
 * rawText too, so a task found by its original email/chat content still surfaces.
 */
export function matchesQuery(item: Item, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = [item.title, item.meta, item.owner, item.rawText, item.bucket, ...item.links]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return tokens.every((t) => haystack.includes(t))
}

/** Human chip for the right side of an item row, e.g. "4d", "today", "P1". */
export function ageChip(item: Item, now: Date): { text: string; warn: boolean } {
  if (item.deadline) {
    const days = Math.ceil((new Date(item.deadline + 'T23:59:59').getTime() - now.getTime()) / 86_400_000)
    if (days < 0) return { text: 'overdue', warn: true }
    if (days === 0) return { text: 'today', warn: true }
    return { text: `${days}d left`, warn: days <= 2 }
  }
  if (item.bucket === 'waiting') {
    const d = daysSince(item.updatedAt, now)
    return { text: d === 0 ? 'today' : `${d}d`, warn: d >= 3 }
  }
  if (item.bucket === 'inbox') {
    const chips: Record<string, string> = { outlook: 'mail', github: 'gh', jira: 'jira', teams: 'teams' }
    return { text: chips[item.source] ?? 'you', warn: false }
  }
  if (item.priority) return { text: `P${item.priority}`, warn: item.priority === 1 }
  return { text: '', warn: false }
}
