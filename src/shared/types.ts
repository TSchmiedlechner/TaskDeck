export type Bucket = 'inbox' | 'now' | 'next' | 'waiting' | 'someday' | 'done'
export type ItemType = 'do' | 'decide' | 'delegate' | 'waiting'

export interface Item {
  id: string
  title: string
  /** Original captured text, kept verbatim for context ("why is this here?") */
  rawText: string | null
  bucket: Bucket
  type: ItemType
  /** 1 = urgent, 2 = normal, 3 = low. null = unset */
  priority: number | null
  /** ISO date (yyyy-mm-dd) */
  deadline: string | null
  /** Who we're waiting on (waiting bucket) or who it's delegated to */
  owner: string | null
  /** Short source/context note shown under the title */
  meta: string | null
  source: 'capture' | 'manual'
  links: string[]
  createdAt: string
  updatedAt: string
  /** Hidden from the deck until this ISO timestamp */
  snoozedUntil: string | null
  completedAt: string | null
  /** Last time a chase nudge was sent/acknowledged for this waiting item */
  lastNudgeAt: string | null
}

export type SuggestionKind = 'structure' | 'staleness' | 'chase' | 'now-overflow'
export type SuggestionTone = 'ai' | 'warn'

export interface SuggestionAction {
  id: string
  label: string
  kind: 'primary' | 'ghost' | 'danger'
  /** Renderer must collect an owner before resolving with this action */
  needsOwner?: boolean
}

/** What the triage brain proposes for a raw capture */
export interface StructureProposal {
  title: string
  type: ItemType
  bucket: Exclude<Bucket, 'inbox' | 'done'>
  priority: number | null
  deadline: string | null
  owner: string | null
  /** Short chip text, e.g. "deadline Aug 30" */
  extra: string | null
}

export interface Suggestion {
  id: string
  itemId: string
  kind: SuggestionKind
  tone: SuggestionTone
  text: string
  actions: SuggestionAction[]
  /** kind=structure: StructureProposal; kind=chase: { draft: string } */
  payload: Record<string, unknown> | null
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
  resolvedAt: string | null
  resolvedAction: string | null
}

export interface ActivityEntry {
  id: string
  itemId: string | null
  ts: string
  actor: 'you' | 'agent' | 'system'
  text: string
}

export type BrainProviderPref = 'auto' | 'cli' | 'api'
export type BrainProviderId = 'cli' | 'api'

export interface Settings {
  nowCap: number
  stalenessDays: number
  chaseDays: number
  privacyMode: boolean
  /** Which completion backend to use. 'auto' prefers the CLI (Max plan), then the API. */
  provider: BrainProviderPref
  triageModel: string
  briefingModel: string
  /** Electron accelerator string for the global capture hotkey */
  captureHotkey: string
  launchAtLogin: boolean
  /** Open the briefing automatically on the first interaction of each day */
  autoBriefing: boolean
}

export interface ModelOption {
  id: string
  label: string
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' }
]

export interface CostSummary {
  month: string
  totalUsd: number
  calls: number
  inputTokens: number
  outputTokens: number
  byPurpose: { purpose: string; costUsd: number; calls: number }[]
}

export interface BriefingNowPick {
  itemId: string
  reason: string | null
}

export interface Briefing {
  date: string
  headline: string
  needsAttention: string[]
  proposedNow: BriefingNowPick[]
  /** Items currently in Now that should move to Next */
  demotions: { itemId: string; reason: string }[]
  note: string | null
  generatedBy: 'agent' | 'fallback'
}

export type BrainStatus = 'ready' | 'offline' | 'error'
export type ApiKeySource = 'settings' | 'env' | null

export interface DeckState {
  items: Item[]
  suggestions: Suggestion[]
  settings: Settings
  brainStatus: BrainStatus
  /** The backend that would serve the next call, after auto-resolution */
  brainProvider: BrainProviderId | null
  /** Where the API key comes from, if any */
  keySource: ApiKeySource
  cliAvailable: boolean
  pendingTriageCount: number
}

/** API exposed to the renderer via the preload bridge */
export interface TaskdeckApi {
  getState(): Promise<DeckState>
  capture(text: string): Promise<void>
  updateItem(id: string, patch: Partial<Item>): Promise<void>
  completeItem(id: string): Promise<void>
  deleteItem(id: string): Promise<void>
  resolveSuggestion(id: string, actionId: string, extra?: { owner?: string }): Promise<void>
  getBriefing(force: boolean): Promise<Briefing>
  acceptBriefing(briefing: Briefing): Promise<void>
  getActivity(limit: number, itemId?: string): Promise<ActivityEntry[]>
  setSettings(patch: Partial<Settings>): Promise<void>
  getCostSummary(): Promise<CostSummary>
  setApiKey(key: string): Promise<void>
  clearApiKey(): Promise<void>
  /** Try to register a new capture hotkey; returns false (and keeps the old one) if the OS rejects it */
  setHotkey(accelerator: string): Promise<boolean>
  listOwners(): Promise<string[]>
  openCapture(): Promise<void>
  closeCapture(): Promise<void>
  copyToClipboard(text: string): Promise<void>
  onStateChanged(cb: () => void): () => void
  onCaptureShown(cb: () => void): () => void
  onShowBriefing(cb: () => void): () => void
}
