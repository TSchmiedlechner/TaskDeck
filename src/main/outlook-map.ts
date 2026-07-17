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
}

export interface GraphEvent {
  subject: string | null
  isAllDay?: boolean
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

export function mailToCandidate(m: GraphMessage): ExternalCandidate {
  const fromName = m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? 'unknown sender'
  const fromAddress = m.from?.emailAddress?.address ?? ''
  const subject = m.subject?.trim() || '(no subject)'
  const rawText =
    `Email from ${fromName}${fromAddress ? ` <${fromAddress}>` : ''}, received ${m.receivedDateTime}\n` +
    `Subject: ${subject}\n\n${m.bodyPreview ?? ''}`
  return {
    externalId: `outlook:${m.id}`,
    title: subject,
    rawText,
    meta: `outlook · ${fromName} · flagged`,
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

export interface GraphChat {
  id: string
  topic: string | null
  chatType: string
}

export interface GraphChatMessage {
  id: string
  /** 'message' for user posts; system events use other types */
  messageType: string
  createdDateTime: string
  from?: { user?: { id?: string; displayName?: string } }
  body?: { content?: string }
  reactions?: {
    reactionType?: string
    /** Set for custom emoji reactions (e.g. "eyes") */
    displayName?: string
    user?: { user?: { id?: string } }
  }[]
}

const EYES = '👀'

/**
 * True when *I* reacted 👀 to the message. Custom emoji reactions arrive as the
 * Unicode character in reactionType (the classic six come as names like 'like');
 * displayName is matched as a fallback for tenants that report the emoji name.
 */
export function hasMyEyesReaction(m: GraphChatMessage, myUserId: string): boolean {
  return (m.reactions ?? []).some(
    (r) =>
      (r.reactionType === EYES || r.displayName?.toLowerCase() === 'eyes') &&
      r.user?.user?.id === myUserId
  )
}

/** A chat message you marked with 👀: an explicit "put this on the deck", like flagging a mail. */
export function eyesMessageToCandidate(m: GraphChatMessage, chat: GraphChat): ExternalCandidate {
  const sender = m.from?.user?.displayName ?? 'someone'
  const where = chat.chatType === 'oneOnOne' ? sender : (chat.topic ?? 'group chat')
  const title = `Follow up with ${sender}${chat.chatType !== 'oneOnOne' ? ` in "${where}"` : ''}`
  const snippet = (m.body?.content ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 300)
  return {
    externalId: `teams:${m.id}`,
    title,
    rawText: `Teams message from ${sender} in ${where} (marked ${EYES}):\n${snippet}`,
    meta: `teams · ${where} · ${EYES}`,
    url: `https://teams.microsoft.com/l/chat/${encodeURIComponent(chat.id)}/0`,
    proposal: {
      title,
      type: 'do',
      bucket: 'next',
      priority: null,
      deadline: null,
      owner: null,
      extra: `${EYES} follow-up`
    }
  }
}
