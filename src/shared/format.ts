import type { Item } from './types'

export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
}

export function isSnoozed(item: Item, now: Date): boolean {
  return item.snoozedUntil !== null && new Date(item.snoozedUntil) > now
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
