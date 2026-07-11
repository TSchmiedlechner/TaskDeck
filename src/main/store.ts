import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type {
  ActivityEntry,
  Item,
  Settings,
  Suggestion,
  SuggestionAction,
  SuggestionKind,
  SuggestionTone,
  CostSummary
} from '@shared/types'

const DEFAULT_SETTINGS: Settings = {
  nowCap: 5,
  stalenessDays: 10,
  chaseDays: 3,
  privacyMode: true
}

export class Store {
  private db: DatabaseSync

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        raw_text TEXT,
        bucket TEXT NOT NULL,
        type TEXT NOT NULL,
        priority INTEGER,
        deadline TEXT,
        owner TEXT,
        meta TEXT,
        source TEXT NOT NULL,
        links TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        snoozed_until TEXT,
        completed_at TEXT,
        last_nudge_at TEXT
      );
      CREATE TABLE IF NOT EXISTS suggestions (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        tone TEXT NOT NULL,
        text TEXT NOT NULL,
        actions TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_action TEXT
      );
      CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY,
        item_id TEXT,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cost (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        model TEXT NOT NULL,
        purpose TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  // ---- items ----

  private rowToItem(r: Record<string, unknown>): Item {
    return {
      id: r.id as string,
      title: r.title as string,
      rawText: (r.raw_text as string) ?? null,
      bucket: r.bucket as Item['bucket'],
      type: r.type as Item['type'],
      priority: (r.priority as number) ?? null,
      deadline: (r.deadline as string) ?? null,
      owner: (r.owner as string) ?? null,
      meta: (r.meta as string) ?? null,
      source: r.source as Item['source'],
      links: JSON.parse(r.links as string),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      snoozedUntil: (r.snoozed_until as string) ?? null,
      completedAt: (r.completed_at as string) ?? null,
      lastNudgeAt: (r.last_nudge_at as string) ?? null
    }
  }

  listItems(): Item[] {
    const rows = this.db
      .prepare(`SELECT * FROM items WHERE completed_at IS NULL ORDER BY created_at ASC`)
      .all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToItem(r))
  }

  getItem(id: string): Item | null {
    const r = this.db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    return r ? this.rowToItem(r) : null
  }

  createCapture(text: string): Item {
    const now = new Date().toISOString()
    const item: Item = {
      id: randomUUID(),
      title: text,
      rawText: text,
      bucket: 'inbox',
      type: 'do',
      priority: null,
      deadline: null,
      owner: null,
      meta: `quick capture · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      source: 'capture',
      links: [],
      createdAt: now,
      updatedAt: now,
      snoozedUntil: null,
      completedAt: null,
      lastNudgeAt: null
    }
    this.db
      .prepare(
        `INSERT INTO items (id, title, raw_text, bucket, type, source, meta, links, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(item.id, item.title, item.rawText, item.bucket, item.type, item.source, item.meta, '[]', now, now)
    return item
  }

  updateItem(id: string, patch: Partial<Item>, touch = true): void {
    const existing = this.getItem(id)
    if (!existing) return
    const merged = { ...existing, ...patch }
    if (touch) merged.updatedAt = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE items SET title=?, raw_text=?, bucket=?, type=?, priority=?, deadline=?, owner=?, meta=?,
         links=?, updated_at=?, snoozed_until=?, completed_at=?, last_nudge_at=? WHERE id=?`
      )
      .run(
        merged.title,
        merged.rawText,
        merged.bucket,
        merged.type,
        merged.priority,
        merged.deadline,
        merged.owner,
        merged.meta,
        JSON.stringify(merged.links),
        merged.updatedAt,
        merged.snoozedUntil,
        merged.completedAt,
        merged.lastNudgeAt,
        id
      )
  }

  deleteItem(id: string): void {
    this.db.prepare(`DELETE FROM items WHERE id = ?`).run(id)
    this.db.prepare(`DELETE FROM suggestions WHERE item_id = ?`).run(id)
  }

  listOwners(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT owner FROM items WHERE owner IS NOT NULL ORDER BY owner`)
      .all() as { owner: string }[]
    return rows.map((r) => r.owner)
  }

  // ---- suggestions ----

  private rowToSuggestion(r: Record<string, unknown>): Suggestion {
    return {
      id: r.id as string,
      itemId: r.item_id as string,
      kind: r.kind as SuggestionKind,
      tone: r.tone as SuggestionTone,
      text: r.text as string,
      actions: JSON.parse(r.actions as string),
      payload: r.payload ? JSON.parse(r.payload as string) : null,
      status: r.status as Suggestion['status'],
      createdAt: r.created_at as string,
      resolvedAt: (r.resolved_at as string) ?? null,
      resolvedAction: (r.resolved_action as string) ?? null
    }
  }

  listPendingSuggestions(): Suggestion[] {
    const rows = this.db
      .prepare(`SELECT * FROM suggestions WHERE status = 'pending' ORDER BY created_at ASC`)
      .all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToSuggestion(r))
  }

  getSuggestion(id: string): Suggestion | null {
    const r = this.db.prepare(`SELECT * FROM suggestions WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    return r ? this.rowToSuggestion(r) : null
  }

  hasPendingSuggestion(itemId: string, kind: SuggestionKind): boolean {
    const r = this.db
      .prepare(`SELECT 1 FROM suggestions WHERE item_id = ? AND kind = ? AND status = 'pending'`)
      .get(itemId, kind)
    return r !== undefined
  }

  /** True if a suggestion of this kind was rejected for the item within the last N hours (don't re-nag). */
  recentlyRejected(itemId: string, kind: SuggestionKind, withinHours: number): boolean {
    const cutoff = new Date(Date.now() - withinHours * 3_600_000).toISOString()
    const r = this.db
      .prepare(
        `SELECT 1 FROM suggestions WHERE item_id = ? AND kind = ? AND status = 'rejected' AND resolved_at > ?`
      )
      .get(itemId, kind, cutoff)
    return r !== undefined
  }

  createSuggestion(
    itemId: string,
    kind: SuggestionKind,
    tone: SuggestionTone,
    text: string,
    actions: SuggestionAction[],
    payload: Record<string, unknown> | null
  ): Suggestion {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO suggestions (id, item_id, kind, tone, text, actions, payload, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(id, itemId, kind, tone, text, JSON.stringify(actions), payload ? JSON.stringify(payload) : null, now)
    return this.getSuggestion(id)!
  }

  resolveSuggestion(id: string, status: 'accepted' | 'rejected', actionId: string): void {
    this.db
      .prepare(`UPDATE suggestions SET status = ?, resolved_at = ?, resolved_action = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), actionId, id)
  }

  /** Recently rejected structure proposals — fed back into the triage prompt so the agent learns. */
  recentRejectedProposals(limit: number): { itemTitle: string; proposal: string }[] {
    const rows = this.db
      .prepare(
        `SELECT s.payload as payload, i.title as title FROM suggestions s
         LEFT JOIN items i ON i.id = s.item_id
         WHERE s.kind = 'structure' AND s.status = 'rejected'
         ORDER BY s.resolved_at DESC LIMIT ?`
      )
      .all(limit) as { payload: string | null; title: string | null }[]
    return rows
      .filter((r) => r.payload)
      .map((r) => ({ itemTitle: r.title ?? '(deleted)', proposal: r.payload! }))
  }

  // ---- activity ----

  logActivity(itemId: string | null, actor: ActivityEntry['actor'], text: string): void {
    this.db
      .prepare(`INSERT INTO activity (id, item_id, ts, actor, text) VALUES (?, ?, ?, ?, ?)`)
      .run(randomUUID(), itemId, new Date().toISOString(), actor, text)
  }

  listActivity(limit: number, itemId?: string): ActivityEntry[] {
    const rows = (
      itemId
        ? this.db
            .prepare(`SELECT * FROM activity WHERE item_id = ? ORDER BY ts DESC LIMIT ?`)
            .all(itemId, limit)
        : this.db.prepare(`SELECT * FROM activity ORDER BY ts DESC LIMIT ?`).all(limit)
    ) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      itemId: (r.item_id as string) ?? null,
      ts: r.ts as string,
      actor: r.actor as ActivityEntry['actor'],
      text: r.text as string
    }))
  }

  // ---- cost ----

  logCost(model: string, purpose: string, inputTokens: number, outputTokens: number, costUsd: number): void {
    this.db
      .prepare(
        `INSERT INTO cost (id, ts, model, purpose, input_tokens, output_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), new Date().toISOString(), model, purpose, inputTokens, outputTokens, costUsd)
  }

  costSummary(): CostSummary {
    const month = new Date().toISOString().slice(0, 7)
    const rows = this.db
      .prepare(
        `SELECT purpose, COUNT(*) as calls, SUM(input_tokens) as inp, SUM(output_tokens) as outp, SUM(cost_usd) as cost
         FROM cost WHERE ts LIKE ? GROUP BY purpose`
      )
      .all(`${month}%`) as { purpose: string; calls: number; inp: number; outp: number; cost: number }[]
    return {
      month,
      totalUsd: rows.reduce((s, r) => s + r.cost, 0),
      calls: rows.reduce((s, r) => s + r.calls, 0),
      inputTokens: rows.reduce((s, r) => s + r.inp, 0),
      outputTokens: rows.reduce((s, r) => s + r.outp, 0),
      byPurpose: rows.map((r) => ({ purpose: r.purpose, costUsd: r.cost, calls: r.calls }))
    }
  }

  // ---- kv (settings, briefing cache) ----

  getSettings(): Settings {
    const r = this.db.prepare(`SELECT value FROM kv WHERE key = 'settings'`).get() as
      | { value: string }
      | undefined
    return r ? { ...DEFAULT_SETTINGS, ...JSON.parse(r.value) } : { ...DEFAULT_SETTINGS }
  }

  setSettings(patch: Partial<Settings>): Settings {
    const merged = { ...this.getSettings(), ...patch }
    this.db
      .prepare(`INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(merged))
    return merged
  }

  getKv(key: string): string | null {
    const r = this.db.prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as { value: string } | undefined
    return r?.value ?? null
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value)
  }
}
