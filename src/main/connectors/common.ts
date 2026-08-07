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

export const RESOLVED_ACTIONS: SuggestionAction[] = [
  { id: 'done', label: 'Mark done', kind: 'primary' },
  { id: 'keep', label: 'Keep', kind: 'ghost' }
]

/** Per-source wording for the two ways an entry can vanish from a connector's result set. */
export interface SyncNotes {
  /** Activity line when an untriaged candidate is dropped, e.g. "resolved on GitHub — candidate removed" */
  removed: string
  /** Chip lead-in when a triaged item's entry resolved, e.g. "No longer open on GitHub — merged or closed." */
  resolved: string
}

/**
 * Diff one connector's current result set against local items:
 * - `add`: matched entries not present locally and not tombstoned
 * - `removeIds`: local *untriaged inbox* candidates of this source whose entry no longer
 *   matches — dropped silently, nothing was invested in them yet.
 * - `resolvedIds`: local items already *triaged* into a bucket whose entry no longer
 *   matches (PR merged, Jira issue done, mail unflagged, 👀 removed). These are real work
 *   the user filed, so they are never auto-closed — the caller raises a "mark done?" chip.
 *   Completed items are excluded: they're already where they belong.
 *
 * `seenIds` (optional): for connectors that only poll a window of the source (Teams —
 * recent messages per chat) rather than the full matching set. An entry then only counts
 * as gone when it was *observed* this sync without matching (explicitly un-reacted);
 * entries that merely fell out of the window are kept.
 */
export function diffExternalSync(
  matched: { externalId: string }[],
  local: {
    id: string
    externalId: string | null
    bucket: string
    source: string
    completedAt?: string | null
  }[],
  tombstones: string[],
  source: string,
  seenIds?: Set<string>
): { addIds: Set<string>; removeIds: string[]; resolvedIds: string[] } {
  const localExternal = new Set(local.filter((i) => i.externalId).map((i) => i.externalId!))
  const matchedIds = new Set(matched.map((m) => m.externalId))
  const dead = new Set(tombstones)
  const gone = local.filter(
    (i) =>
      i.source === source &&
      i.externalId !== null &&
      !matchedIds.has(i.externalId) &&
      (seenIds === undefined || seenIds.has(i.externalId))
  )
  return {
    addIds: new Set(
      matched.map((m) => m.externalId).filter((id) => !localExternal.has(id) && !dead.has(id))
    ),
    removeIds: gone.filter((i) => i.bucket === 'inbox').map((i) => i.id),
    resolvedIds: gone
      .filter((i) => i.bucket !== 'inbox' && i.bucket !== 'done' && !i.completedAt)
      .map((i) => i.id)
  }
}

/** Reconcile a connector's result set into the inbox. Returns true when anything changed. */
export function applyCandidates(
  store: Store,
  source: Item['source'],
  matched: ExternalCandidate[],
  notes: SyncNotes,
  seenIds?: Set<string>
): boolean {
  // Diff against ALL items including completed ones: a completed mail item's flag may
  // still be set in Outlook, and it must not come back as a fresh candidate.
  const all = store.listAllItems()
  const { addIds, removeIds, resolvedIds } = diffExternalSync(matched, all, store.tombstones(), source, seenIds)

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
    store.logActivity(null, 'system', `"${item?.title ?? id}" ${notes.removed}`)
    store.deleteItem(id, false)
  }

  let asked = 0
  for (const id of resolvedIds) {
    if (store.hasPendingSuggestion(id, 'resolved')) continue
    // "Keep" is permanent here: a merged PR never re-opens on its own, so re-asking
    // after a cooldown would nag forever.
    if (store.everRejected(id, 'resolved')) continue
    store.createSuggestion(id, 'resolved', 'ai', `${notes.resolved} Mark it done?`, RESOLVED_ACTIONS, null)
    store.logActivity(id, 'system', notes.resolved)
    asked++
  }

  // The entry can come back (PR reopened, mail re-flagged, 👀 re-added) — withdraw the
  // chip rather than resolving it, so a later genuine resolve can still ask.
  let withdrawn = 0
  const matchedIds = new Set(matched.map((m) => m.externalId))
  for (const item of all) {
    if (item.source !== source || !item.externalId || !matchedIds.has(item.externalId)) continue
    const pending = store.getPendingSuggestion(item.id, 'resolved')
    if (!pending) continue
    store.deleteSuggestion(pending.id)
    store.logActivity(item.id, 'system', `Back open in ${source} — withdrew the "mark done?" prompt`)
    withdrawn++
  }

  return addIds.size > 0 || removeIds.length > 0 || asked > 0 || withdrawn > 0
}
