import type { Meeting } from '@shared/types'

/** The Graph message fields we request ($select) */
export interface GraphMessage {
  id: string
  subject: string | null
  bodyPreview: string | null
  receivedDateTime: string
  webLink: string | null
  from?: { emailAddress?: { name?: string; address?: string } }
  flag?: { flagStatus?: string }
}

export interface GraphEvent {
  subject: string | null
  isAllDay?: boolean
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

export interface MailCandidate {
  externalId: string
  title: string
  rawText: string
  meta: string
  url: string | null
}

export function mailToCandidate(m: GraphMessage): MailCandidate {
  const fromName = m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? 'unknown sender'
  const fromAddress = m.from?.emailAddress?.address ?? ''
  const subject = m.subject?.trim() || '(no subject)'
  const flagged = m.flag?.flagStatus === 'flagged'
  const rawText =
    `Email from ${fromName}${fromAddress ? ` <${fromAddress}>` : ''}, received ${m.receivedDateTime}\n` +
    `Subject: ${subject}\n\n${m.bodyPreview ?? ''}`
  return {
    externalId: `outlook:${m.id}`,
    title: subject,
    rawText,
    meta: `outlook · ${fromName} · ${flagged ? 'flagged' : 'unread'}`,
    url: m.webLink ?? null
  }
}

/** Graph returns naive datetimes in the requested/UTC timezone — normalize to ISO UTC. */
export function eventToMeeting(e: GraphEvent): Meeting {
  const toIso = (dt: { dateTime: string; timeZone: string }): string => {
    // We always request UTC; the dateTime is naive ("2026-07-11T08:00:00.0000000")
    const base = dt.dateTime.replace(/(\.\d+)?$/, '')
    return dt.timeZone === 'UTC' ? `${base}Z` : base
  }
  return {
    subject: e.subject?.trim() || '(untitled)',
    isAllDay: e.isAllDay ?? false,
    start: toIso(e.start),
    end: toIso(e.end)
  }
}

/**
 * Diff the current Graph result set against local outlook-sourced items:
 * - `add`: matched mails not present locally and not tombstoned
 * - `removeIds`: local *untriaged inbox* candidates whose mail no longer matches
 *   (handled in Outlook) — items already triaged into a bucket are left alone.
 */
export function diffMailSync(
  matched: MailCandidate[],
  local: { id: string; externalId: string | null; bucket: string; source: string }[],
  tombstones: string[]
): { add: MailCandidate[]; removeIds: string[] } {
  const localByExternal = new Map(local.filter((i) => i.externalId).map((i) => [i.externalId!, i]))
  const matchedIds = new Set(matched.map((m) => m.externalId))
  const dead = new Set(tombstones)
  return {
    add: matched.filter((m) => !localByExternal.has(m.externalId) && !dead.has(m.externalId)),
    removeIds: local
      .filter(
        (i) =>
          i.source === 'outlook' &&
          i.bucket === 'inbox' &&
          i.externalId !== null &&
          !matchedIds.has(i.externalId)
      )
      .map((i) => i.id)
  }
}
