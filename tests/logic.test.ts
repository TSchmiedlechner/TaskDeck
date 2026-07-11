import { describe, expect, it } from 'vitest'
import {
  computeCostUsd,
  findChaseItems,
  findNowOverflowCandidate,
  findStaleItems,
  nextMonday
} from '../src/main/logic'
import { ageChip, daysSince, isSnoozed } from '../src/shared/format'
import type { Item, Settings } from '../src/shared/types'

const SETTINGS: Settings = { nowCap: 5, stalenessDays: 10, chaseDays: 3, privacyMode: true }

function makeItem(overrides: Partial<Item>): Item {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2),
    title: 'test item',
    rawText: null,
    bucket: 'next',
    type: 'do',
    priority: null,
    deadline: null,
    owner: null,
    meta: null,
    source: 'capture',
    links: [],
    createdAt: now,
    updatedAt: now,
    snoozedUntil: null,
    completedAt: null,
    lastNudgeAt: null,
    ...overrides
  }
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

describe('nextMonday', () => {
  it('lands on a Monday at 08:00 local', () => {
    const result = new Date(nextMonday(new Date('2026-07-11T10:00:00'))) // a Saturday
    expect(result.getDay()).toBe(1)
    expect(result.getHours()).toBe(8)
  })

  it('skips to next week when already Monday', () => {
    const monday = new Date('2026-07-13T10:00:00')
    const result = new Date(nextMonday(monday))
    expect(result.getDay()).toBe(1)
    expect(result.getTime() - monday.getTime()).toBeGreaterThan(6 * 86_400_000)
  })
})

describe('staleness', () => {
  it('flags items untouched past the threshold', () => {
    const items = [
      makeItem({ updatedAt: daysAgo(12) }),
      makeItem({ updatedAt: daysAgo(2) }),
      makeItem({ bucket: 'inbox', updatedAt: daysAgo(12) }), // inbox is not confronted
      makeItem({ updatedAt: daysAgo(12), snoozedUntil: new Date(Date.now() + 86_400_000).toISOString() })
    ]
    const stale = findStaleItems(items, SETTINGS, new Date())
    expect(stale).toHaveLength(1)
    expect(stale[0].id).toBe(items[0].id)
  })
})

describe('chase', () => {
  it('flags quiet waiting items but respects lastNudgeAt', () => {
    const items = [
      makeItem({ bucket: 'waiting', owner: 'Markus', updatedAt: daysAgo(5) }),
      makeItem({ bucket: 'waiting', owner: 'Anna', updatedAt: daysAgo(5), lastNudgeAt: daysAgo(1) }),
      makeItem({ bucket: 'waiting', owner: 'Julia', updatedAt: daysAgo(1) })
    ]
    const chase = findChaseItems(items, SETTINGS, new Date())
    expect(chase).toHaveLength(1)
    expect(chase[0].owner).toBe('Markus')
  })
})

describe('now overflow', () => {
  it('returns null when under the cap', () => {
    const items = Array.from({ length: 5 }, () => makeItem({ bucket: 'now' }))
    expect(findNowOverflowCandidate(items, SETTINGS)).toBeNull()
  })

  it('picks the lowest-priority, least-recently-touched item over the cap', () => {
    const items = [
      makeItem({ bucket: 'now', priority: 1 }),
      makeItem({ bucket: 'now', priority: 1 }),
      makeItem({ bucket: 'now', priority: 2 }),
      makeItem({ bucket: 'now', priority: 3, updatedAt: daysAgo(3), title: 'demote me' }),
      makeItem({ bucket: 'now', priority: 3, updatedAt: daysAgo(1) }),
      makeItem({ bucket: 'now', priority: 1 })
    ]
    const candidate = findNowOverflowCandidate(items, SETTINGS)
    expect(candidate?.title).toBe('demote me')
  })
})

describe('cost', () => {
  it('computes haiku and opus pricing per MTok', () => {
    expect(computeCostUsd('claude-haiku-4-5', 1_000_000, 0)).toBeCloseTo(1.0)
    expect(computeCostUsd('claude-haiku-4-5', 0, 1_000_000)).toBeCloseTo(5.0)
    expect(computeCostUsd('claude-opus-4-8', 100_000, 10_000)).toBeCloseTo(0.75)
    expect(computeCostUsd('unknown-model', 1000, 1000)).toBe(0)
  })
})

describe('format helpers', () => {
  it('daysSince counts whole days', () => {
    expect(daysSince(daysAgo(4), new Date())).toBe(4)
  })

  it('isSnoozed honors the snooze window', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    expect(isSnoozed(makeItem({ snoozedUntil: future }), new Date())).toBe(true)
    expect(isSnoozed(makeItem({ snoozedUntil: daysAgo(1) }), new Date())).toBe(false)
  })

  it('ageChip shows deadline pressure and waiting age', () => {
    const overdue = ageChip(makeItem({ deadline: '2020-01-01' }), new Date())
    expect(overdue).toEqual({ text: 'overdue', warn: true })

    const waiting = ageChip(makeItem({ bucket: 'waiting', updatedAt: daysAgo(4) }), new Date())
    expect(waiting).toEqual({ text: '4d', warn: true })

    const p1 = ageChip(makeItem({ priority: 1 }), new Date())
    expect(p1).toEqual({ text: 'P1', warn: true })
  })
})
