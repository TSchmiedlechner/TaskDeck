import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { BrainStatus, Briefing, Item, Settings, StructureProposal } from '@shared/types'
import { computeCostUsd } from './logic'
import type { Store } from './store'

const TRIAGE_MODEL = 'claude-haiku-4-5'
const BRIEFING_MODEL = 'claude-opus-4-8'

const TriageResultSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.enum(['do', 'decide', 'delegate', 'waiting']),
      bucket: z.enum(['now', 'next', 'waiting', 'someday']),
      priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
      deadline: z.union([z.string(), z.null()]),
      owner: z.union([z.string(), z.null()]),
      extra: z.union([z.string(), z.null()])
    })
  )
})

const BriefingSchema = z.object({
  headline: z.string(),
  needsAttention: z.array(z.string()),
  proposedNow: z.array(
    z.object({
      itemId: z.string(),
      reason: z.union([z.string(), z.null()])
    })
  ),
  demotions: z.array(
    z.object({
      itemId: z.string(),
      reason: z.string()
    })
  ),
  note: z.union([z.string(), z.null()])
})

const TRIAGE_SYSTEM = `You are the triage brain of TaskDeck, a personal task deck for a hands-on CTO of a ~20-person software company (fiscal/POS compliance domain).

Your job: turn raw captures (half-sentences, pasted emails, chat fragments) into clean, structured task items. The user approves every proposal with one click, so be decisive rather than cautious.

Rules:
- title: a short imperative phrase, max ~70 chars, in the language of the capture. Extract the actual TASK from pasted content (an email usually implies "reply to X about Y" or a concrete action).
- type: 'do' (a task), 'decide' (a pending decision), 'delegate' (should be handed to someone), 'waiting' (already waiting on someone else).
- bucket: 'now' only for genuinely urgent same-day items (blocking others, hard deadline today/tomorrow, 2-minute replies to unblock people). 'next' is the default. 'waiting' when type is waiting/delegate with a known owner. 'someday' for ideas and non-committal maybes.
- priority: 1 urgent, 2 normal, 3 low. null when unclear.
- deadline: ISO date (yyyy-mm-dd) ONLY when the text names or clearly implies one. Never invent deadlines.
- owner: a person's name only when the capture names who it's delegated to / waited on.
- extra: one short chip like "deadline Aug 30" or "2-min reply" or null.

Keep proposals faithful to the capture — do not add scope the user didn't write.`

export class Brain {
  private client: Anthropic | null = null
  status: BrainStatus = 'no-key'

  constructor(private store: Store) {
    if (process.env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic()
      this.status = 'ready'
    }
  }

  private track(purpose: string, model: string, usage: { input_tokens: number; output_tokens: number }): void {
    const cost = computeCostUsd(model, usage.input_tokens, usage.output_tokens)
    this.store.logCost(model, purpose, usage.input_tokens, usage.output_tokens, cost)
  }

  /** Batch-triage raw captures into structure proposals. Returns a map itemId -> proposal. */
  async triage(captures: { id: string; text: string }[]): Promise<Map<string, StructureProposal>> {
    if (!this.client || captures.length === 0) return new Map()

    const rejected = this.store.recentRejectedProposals(8)
    const rejectedNote =
      rejected.length > 0
        ? `\n\nThe user recently REJECTED these proposals (learn from this — e.g. wrong bucket or over-interpreted titles):\n` +
          rejected.map((r) => `- capture "${r.itemTitle}" -> rejected proposal ${r.proposal}`).join('\n')
        : ''

    const today = new Date()
    const userContent =
      `Today is ${today.toISOString().slice(0, 10)} (${today.toLocaleDateString('en-US', { weekday: 'long' })}).` +
      rejectedNote +
      `\n\nTriage these captures. Return one entry per capture, matching by id:\n` +
      JSON.stringify(captures, null, 2)

    try {
      const response = await this.client.messages.parse({
        model: TRIAGE_MODEL,
        max_tokens: 4096,
        system: TRIAGE_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
        output_config: { format: zodOutputFormat(TriageResultSchema) }
      })
      this.track('triage', TRIAGE_MODEL, response.usage)
      this.status = 'ready'
      const result = new Map<string, StructureProposal>()
      for (const entry of response.parsed_output?.items ?? []) {
        result.set(entry.id, {
          title: entry.title,
          type: entry.type,
          bucket: entry.bucket,
          priority: entry.priority,
          deadline: entry.deadline,
          owner: entry.owner,
          extra: entry.extra
        })
      }
      return result
    } catch (err) {
      this.status = 'error'
      this.store.logActivity(null, 'system', `Triage call failed: ${(err as Error).message}`)
      return new Map()
    }
  }

  /** Compose the morning briefing with the strong model. Falls back to a deterministic briefing without a key. */
  async composeBriefing(items: Item[], settings: Settings): Promise<Briefing> {
    const date = new Date().toISOString().slice(0, 10)
    const active = items.filter((i) => i.bucket !== 'done' && i.completedAt === null)

    if (!this.client) return this.fallbackBriefing(date, active, settings)

    const now = new Date()
    const describe = (i: Item): Record<string, unknown> => ({
      id: i.id,
      title: i.title,
      bucket: i.bucket,
      type: i.type,
      priority: i.priority,
      deadline: i.deadline,
      owner: i.owner,
      daysSinceTouched: Math.floor((now.getTime() - new Date(i.updatedAt).getTime()) / 86_400_000)
    })

    const userContent =
      `Today is ${date} (${now.toLocaleDateString('en-US', { weekday: 'long' })}).\n` +
      `The "Now" list is hard-capped at ${settings.nowCap} items. Staleness threshold: ${settings.stalenessDays} days.\n\n` +
      `Current items:\n${JSON.stringify(active.map(describe), null, 2)}\n\n` +
      `Compose the morning briefing:\n` +
      `- headline: one short sentence setting up the day.\n` +
      `- needsAttention: max 4 bullets — overdue deadlines, stale items, long-quiet waiting-on entries. Plain sentences.\n` +
      `- proposedNow: the <= ${settings.nowCap} item ids that deserve today's focus (may include items currently in inbox/next). Give a short reason where it isn't obvious.\n` +
      `- demotions: item ids currently in 'now' that should move to 'next' today, each with a reason.\n` +
      `- note: one optional closing thought or null.\n` +
      `Only reference item ids that exist. Be direct and concrete, no filler.`

    try {
      const response = await this.client.messages.parse({
        model: BRIEFING_MODEL,
        max_tokens: 4096,
        system:
          'You are the chief-of-staff brain of TaskDeck, planning the day of a hands-on CTO. Be concrete, terse, and decisive.',
        messages: [{ role: 'user', content: userContent }],
        output_config: { format: zodOutputFormat(BriefingSchema) }
      })
      this.track('briefing', BRIEFING_MODEL, response.usage)
      this.status = 'ready'
      const parsed = response.parsed_output
      if (!parsed) return this.fallbackBriefing(date, active, settings)
      const validIds = new Set(active.map((i) => i.id))
      return {
        date,
        headline: parsed.headline,
        needsAttention: parsed.needsAttention.slice(0, 4),
        proposedNow: parsed.proposedNow.filter((p) => validIds.has(p.itemId)).slice(0, settings.nowCap),
        demotions: parsed.demotions.filter((d) => validIds.has(d.itemId)),
        note: parsed.note,
        generatedBy: 'agent'
      }
    } catch (err) {
      this.status = 'error'
      this.store.logActivity(null, 'system', `Briefing call failed: ${(err as Error).message}`)
      return this.fallbackBriefing(date, active, settings)
    }
  }

  /** Deterministic briefing when the agent is unavailable: deadline- and priority-driven. */
  private fallbackBriefing(date: string, active: Item[], settings: Settings): Briefing {
    const now = new Date()
    const candidates = active
      .filter((i) => i.bucket === 'now' || i.bucket === 'next')
      .sort((a, b) => {
        const da = a.deadline ?? '9999'
        const db = b.deadline ?? '9999'
        if (da !== db) return da.localeCompare(db)
        return (a.priority ?? 2) - (b.priority ?? 2)
      })
    const overdue = active.filter((i) => i.deadline && i.deadline < date)
    const quiet = active.filter(
      (i) =>
        i.bucket === 'waiting' &&
        Math.floor((now.getTime() - new Date(i.updatedAt).getTime()) / 86_400_000) >= settings.chaseDays
    )
    return {
      date,
      headline: 'Agent offline — deadline-ordered plan.',
      needsAttention: [
        ...overdue.map((i) => `"${i.title}" is past its deadline (${i.deadline}).`),
        ...quiet.map((i) => `Waiting on ${i.owner ?? 'someone'} for "${i.title}" — quiet for a while.`)
      ].slice(0, 4),
      proposedNow: candidates.slice(0, settings.nowCap).map((i) => ({ itemId: i.id, reason: null })),
      demotions: [],
      note: null,
      generatedBy: 'fallback'
    }
  }
}
