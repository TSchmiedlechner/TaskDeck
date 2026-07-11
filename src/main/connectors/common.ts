import type { Item, StructureProposal, SuggestionAction } from '@shared/types'
import type { Store } from '../store'

export interface ExternalCandidate {
  externalId: string
  title: string
  rawText: string
  meta: string
  url: string | null
  /**
   * Deterministic proposal: creates the approve/reject chip immediately without an AI
   * call (used for structured sources like PRs/issues). null = let the AI triage it.
   */
  proposal: StructureProposal | null
}

export const STRUCTURE_ACTIONS: SuggestionAction[] = [
  { id: 'accept', label: 'Accept', kind: 'primary' },
  { id: 'snooze', label: 'Monday', kind: 'ghost' },
  { id: 'dismiss', label: 'Dismiss', kind: 'danger' }
]

/**
 * Diff one connector's current result set against local items:
 * - `add`: matched entries not present locally and not tombstoned
 * - `removeIds`: local *untriaged inbox* candidates of this source whose entry no longer
 *   matches (handled at the source) — items already triaged into a bucket are left alone.
 */
export function diffExternalSync(
  matched: { externalId: string }[],
  local: { id: string; externalId: string | null; bucket: string; source: string }[],
  tombstones: string[],
  source: string
): { addIds: Set<string>; removeIds: string[] } {
  const localExternal = new Set(local.filter((i) => i.externalId).map((i) => i.externalId!))
  const matchedIds = new Set(matched.map((m) => m.externalId))
  const dead = new Set(tombstones)
  return {
    addIds: new Set(
      matched.map((m) => m.externalId).filter((id) => !localExternal.has(id) && !dead.has(id))
    ),
    removeIds: local
      .filter(
        (i) =>
          i.source === source && i.bucket === 'inbox' && i.externalId !== null && !matchedIds.has(i.externalId)
      )
      .map((i) => i.id)
  }
}

/** Reconcile a connector's result set into the inbox. Returns true when anything changed. */
export function applyCandidates(
  store: Store,
  source: Item['source'],
  matched: ExternalCandidate[],
  removedNote: string
): boolean {
  const { addIds, removeIds } = diffExternalSync(matched, store.listItems(), store.tombstones(), source)

  for (const c of matched.filter((m) => addIds.has(m.externalId))) {
    const item = store.createExternalItem({
      title: c.title,
      rawText: c.rawText,
      meta: c.meta,
      source,
      externalId: c.externalId,
      url: c.url
    })
    store.logActivity(item.id, 'system', `Arrived from ${source}`)
    if (c.proposal) {
      const chips = [c.proposal.type, `→ ${c.proposal.bucket}`, c.proposal.extra].filter(Boolean).join(' · ')
      store.createSuggestion(
        item.id,
        'structure',
        'ai',
        `“${c.proposal.title}” · ${chips}`,
        STRUCTURE_ACTIONS,
        c.proposal as unknown as Record<string, unknown>
      )
    }
  }

  for (const id of removeIds) {
    const item = store.getItem(id)
    store.logActivity(null, 'system', `"${item?.title ?? id}" ${removedNote}`)
    store.deleteItem(id, false)
  }

  return addIds.size > 0 || removeIds.length > 0
}
