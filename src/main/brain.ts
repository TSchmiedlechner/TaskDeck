import { z } from 'zod'
import type {
  ApiKeySource,
  BrainProviderId,
  BrainStatus,
  Briefing,
  Item,
  Meeting,
  Settings,
  StructureProposal
} from '@shared/types'
import { computeCostUsd, resolveProviderId } from './logic'
import { resolveApiKey } from './keystore'
import { ApiProvider, CliProvider, detectCli, type CompletionProvider } from './providers'
import type { Store } from './store'

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
  private api: ApiProvider
  private cli = new CliProvider()
  private lastCallFailed = false

  constructor(private store: Store) {
    this.api = new ApiProvider(() => resolveApiKey(this.store)?.key ?? null)
    void this.redetectCli()
  }

  async redetectCli(): Promise<void> {
    this.cli.available = await detectCli()
  }

  get cliAvailable(): boolean {
    return this.cli.available
  }

  get keySource(): ApiKeySource {
    return resolveApiKey(this.store)?.source ?? null
  }

  /** The backend the next call would use, after auto-resolution. */
  resolveProvider(): CompletionProvider | null {
    const settings = this.store.getSettings()
    const id = resolveProviderId(settings.provider, this.cli.available, this.keySource !== null)
    if (id === 'cli') return this.cli
    if (id === 'api') return this.api
    return null
  }

  get providerId(): BrainProviderId | null {
    return this.resolveProvider()?.id ?? null
  }

  get status(): BrainStatus {
    if (!this.resolveProvider()) return 'offline'
    return this.lastCallFailed ? 'error' : 'ready'
  }

  private track(
    provider: BrainProviderId,
    purpose: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): void {
    const cost = provider === 'api' ? computeCostUsd(model, inputTokens, outputTokens) : 0
    this.store.logCost(model, `${purpose} (${provider})`, inputTokens, outputTokens, cost)
  }

  /** Batch-triage raw captures into structure proposals. Returns a map itemId -> proposal. */
  async triage(captures: { id: string; text: string }[]): Promise<Map<string, StructureProposal>> {
    const provider = this.resolveProvider()
    if (!provider || captures.length === 0) return new Map()
    const settings = this.store.getSettings()

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
      const response = await provider.complete({
        model: settings.triageModel,
        maxTokens: 4096,
        system: TRIAGE_SYSTEM,
        user: userContent,
        schema: TriageResultSchema
      })
      this.track(provider.id, 'triage', settings.triageModel, response.inputTokens, response.outputTokens)
      this.lastCallFailed = false
      const result = new Map<string, StructureProposal>()
      for (const entry of response.parsed?.items ?? []) {
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
      this.lastCallFailed = true
      this.store.logActivity(null, 'system', `Triage call failed (${provider.id}): ${(err as Error).message}`)
      return new Map()
    }
  }

  /** Compose the morning briefing with the strong model. Deterministic fallback when offline. */
  async composeBriefing(items: Item[], settings: Settings, meetings: Meeting[] = []): Promise<Briefing> {
    const date = new Date().toISOString().slice(0, 10)
    const active = items.filter((i) => i.bucket !== 'done' && i.completedAt === null)
    const provider = this.resolveProvider()

    if (!provider) return this.fallbackBriefing(date, active, settings, meetings)

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

    const meetingLines =
      meetings.length > 0
        ? `Today's calendar:\n` +
          meetings
            .map((m) =>
              m.isAllDay
                ? `- all day: ${m.subject}`
                : `- ${new Date(m.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${m.subject}`
            )
            .join('\n') +
          '\n\n'
        : ''

    const userContent =
      `Today is ${date} (${now.toLocaleDateString('en-US', { weekday: 'long' })}).\n` +
      `The "Now" list is hard-capped at ${settings.nowCap} items. Staleness threshold: ${settings.stalenessDays} days.\n\n` +
      meetingLines +
      `Current items:\n${JSON.stringify(active.map(describe), null, 2)}\n\n` +
      `Compose the morning briefing:\n` +
      `- headline: one short sentence setting up the day.\n` +
      `- needsAttention: max 4 bullets — overdue deadlines, stale items, long-quiet waiting-on entries. Plain sentences.\n` +
      `- proposedNow: the <= ${settings.nowCap} item ids that deserve today's focus (may include items currently in inbox/next). Give a short reason where it isn't obvious.\n` +
      `- demotions: item ids currently in 'now' that should move to 'next' today, each with a reason.\n` +
      `- note: one optional closing thought or null.\n` +
      `Factor the calendar into the plan (meeting prep, realistic capacity on packed days). ` +
      `Only reference item ids that exist. Be direct and concrete, no filler.`

    try {
      const response = await provider.complete({
        model: settings.briefingModel,
        maxTokens: 4096,
        system:
          'You are the chief-of-staff brain of TaskDeck, planning the day of a hands-on CTO. Be concrete, terse, and decisive.',
        user: userContent,
        schema: BriefingSchema
      })
      this.track(provider.id, 'briefing', settings.briefingModel, response.inputTokens, response.outputTokens)
      this.lastCallFailed = false
      const parsed = response.parsed
      if (!parsed) return this.fallbackBriefing(date, active, settings, meetings)
      const validIds = new Set(active.map((i) => i.id))
      return {
        date,
        headline: parsed.headline,
        meetings,
        needsAttention: parsed.needsAttention.slice(0, 4),
        proposedNow: parsed.proposedNow.filter((p) => validIds.has(p.itemId)).slice(0, settings.nowCap),
        demotions: parsed.demotions.filter((d) => validIds.has(d.itemId)),
        note: parsed.note,
        generatedBy: 'agent'
      }
    } catch (err) {
      this.lastCallFailed = true
      this.store.logActivity(null, 'system', `Briefing call failed (${provider.id}): ${(err as Error).message}`)
      return this.fallbackBriefing(date, active, settings, meetings)
    }
  }

  /** Deterministic briefing when the agent is unavailable: deadline- and priority-driven. */
  private fallbackBriefing(date: string, active: Item[], settings: Settings, meetings: Meeting[]): Briefing {
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
      meetings,
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
