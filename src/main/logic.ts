import type { Item, Settings } from '@shared/types'
import { daysSince, isSnoozed } from '@shared/format'

/** Next Monday 08:00 local time, as ISO string. If today is Monday, next week's Monday. */
export function nextMonday(from: Date): string {
  const d = new Date(from)
  const day = d.getDay() // 0 = Sun, 1 = Mon
  const daysUntil = (8 - day) % 7 || 7
  d.setDate(d.getDate() + daysUntil)
  d.setHours(8, 0, 0, 0)
  return d.toISOString()
}

/** Items that should get a staleness confrontation: parked too long, not snoozed, not done. */
export function findStaleItems(items: Item[], settings: Settings, now: Date): Item[] {
  return items.filter(
    (i) =>
      (i.bucket === 'next' || i.bucket === 'someday' || i.bucket === 'now') &&
      i.completedAt === null &&
      !isSnoozed(i, now) &&
      daysSince(i.updatedAt, now) >= settings.stalenessDays
  )
}

/** Waiting items quiet for too long: candidates for a chase nudge. */
export function findChaseItems(items: Item[], settings: Settings, now: Date): Item[] {
  return items.filter((i) => {
    if (i.bucket !== 'waiting' || i.completedAt !== null || isSnoozed(i, now)) return false
    const lastTouch = i.lastNudgeAt && i.lastNudgeAt > i.updatedAt ? i.lastNudgeAt : i.updatedAt
    return daysSince(lastTouch, now) >= settings.chaseDays
  })
}

/**
 * When Now exceeds the cap, pick the demotion candidate:
 * lowest priority first (null counts as 2), then least-recently touched.
 */
export function findNowOverflowCandidate(items: Item[], settings: Settings): Item | null {
  const now = items.filter((i) => i.bucket === 'now' && i.completedAt === null)
  if (now.length <= settings.nowCap) return null
  const sorted = [...now].sort((a, b) => {
    const pa = a.priority ?? 2
    const pb = b.priority ?? 2
    if (pa !== pb) return pb - pa // higher number = lower priority = demote first
    return a.updatedAt.localeCompare(b.updatedAt)
  })
  return sorted[0]
}

export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
}

export const PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'claude-opus-4-8': { inputPerMTok: 5.0, outputPerMTok: 25.0 }
}

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model]
  if (!p) return 0
  return (inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000
}
