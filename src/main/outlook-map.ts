import type { Meeting } from '@shared/types'
import type { ExternalCandidate } from './connectors/common'

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

export interface GraphChat {
  id: string
  topic: string | null
  chatType: string
  viewpoint?: { lastMessageReadDateTime?: string | null }
  lastMessagePreview?: {
    id: string
    createdDateTime: string
    from?: { user?: { id?: string; displayName?: string } }
    body?: { content?: string }
  } | null
}

export function mailToCandidate(m: GraphMessage): ExternalCandidate {
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
    url: m.webLink ?? null,
    // Mails go through AI triage — extracting the actual task from an email is what it's for.
    proposal: null
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
 * A chat you owe a reply to: the last message is newer than your read marker and not
 * from you. Keyed by the message id, so a newer message in the same chat becomes a new
 * candidate (and a dismissed one stays dismissed).
 */
export function chatToCandidate(chat: GraphChat, myUserId: string): ExternalCandidate | null {
  const preview = chat.lastMessagePreview
  if (!preview?.from?.user?.id || preview.from.user.id === myUserId) return null
  const readAt = chat.viewpoint?.lastMessageReadDateTime
  if (readAt && readAt >= preview.createdDateTime) return null

  const sender = preview.from.user.displayName ?? 'someone'
  const where = chat.chatType === 'oneOnOne' ? sender : (chat.topic ?? 'group chat')
  const title = `Reply to ${sender}${chat.chatType !== 'oneOnOne' ? ` in "${where}"` : ''}`
  const snippet = (preview.body?.content ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 300)
  return {
    externalId: `teams:${preview.id}`,
    title,
    rawText: `Teams message from ${sender} in ${where}:\n${snippet}`,
    meta: `teams · ${where}`,
    url: `https://teams.microsoft.com/l/chat/${encodeURIComponent(chat.id)}/0`,
    proposal: {
      title,
      type: 'do',
      bucket: 'next',
      priority: null,
      deadline: null,
      owner: null,
      extra: 'reply'
    }
  }
}
