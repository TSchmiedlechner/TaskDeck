import { describe, expect, it } from 'vitest'
import {
  eventToMeeting,
  eyesMessageToCandidate,
  hasMyEyesReaction,
  mailToCandidate,
  type GraphChat,
  type GraphChatMessage,
  type GraphMessage
} from '../src/main/outlook-map'
import { diffExternalSync } from '../src/main/connectors/common'
import { ownPrToCandidate, reviewRequestToCandidate, type GithubSearchItem } from '../src/main/connectors/github'
import { issueToCandidate } from '../src/main/connectors/jira'

function makeMessage(overrides: Partial<GraphMessage>): GraphMessage {
  return {
    id: 'AAMk123',
    subject: 'RKSV export format',
    bodyPreview: 'Hi Tom, could you clarify…',
    receivedDateTime: '2026-07-11T08:15:00Z',
    webLink: 'https://outlook.office365.com/owa/?ItemID=AAMk123',
    from: { emailAddress: { name: 'BMF Auditor', address: 'auditor@bmf.gv.at' } },
    ...overrides
  }
}

describe('mailToCandidate', () => {
  it('maps a Graph message to an inbox candidate', () => {
    const c = mailToCandidate(makeMessage({}))
    expect(c.externalId).toBe('outlook:AAMk123')
    expect(c.title).toBe('RKSV export format')
    expect(c.rawText).toContain('BMF Auditor <auditor@bmf.gv.at>')
    expect(c.rawText).toContain('Subject: RKSV export format')
    expect(c.meta).toBe('outlook · BMF Auditor · flagged')
    expect(c.url).toContain('outlook.office365.com')
  })

  it('handles missing subject and sender', () => {
    const c = mailToCandidate(makeMessage({ subject: '  ', from: undefined }))
    expect(c.title).toBe('(no subject)')
    expect(c.meta).toBe('outlook · unknown sender · flagged')
  })
})

describe('eventToMeeting', () => {
  it('normalizes naive UTC datetimes to ISO', () => {
    const m = eventToMeeting({
      subject: 'Platform standup',
      isAllDay: false,
      start: { dateTime: '2026-07-11T07:30:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-07-11T07:45:00.0000000', timeZone: 'UTC' }
    })
    expect(m.start).toBe('2026-07-11T07:30:00Z')
    expect(m.subject).toBe('Platform standup')
  })
})

describe('diffExternalSync', () => {
  const candidate = (id: string) => ({ externalId: `outlook:${id}` })

  it('adds new entries, skips existing and tombstoned ones', () => {
    const matched = [candidate('a'), candidate('b'), candidate('c')]
    const local = [{ id: 'item-1', externalId: 'outlook:a', bucket: 'inbox', source: 'outlook' }]
    const { addIds } = diffExternalSync(matched, local, ['outlook:c'], 'outlook')
    expect([...addIds]).toEqual(['outlook:b'])
  })

  it('drops untriaged candidates of the same source, flags triaged ones as resolved', () => {
    const local = [
      { id: 'untriaged', externalId: 'outlook:gone', bucket: 'inbox', source: 'outlook' },
      { id: 'triaged', externalId: 'outlook:also-gone', bucket: 'next', source: 'outlook' },
      { id: 'other-source', externalId: 'github:x', bucket: 'inbox', source: 'github' },
      { id: 'manual', externalId: null, bucket: 'inbox', source: 'capture' }
    ]
    const { removeIds, resolvedIds } = diffExternalSync([], local, [], 'outlook')
    expect(removeIds).toEqual(['untriaged'])
    // Triaged items are never deleted — they only earn a "mark done?" chip.
    expect(resolvedIds).toEqual(['triaged'])
  })

  it('does not resurrect a completed item whose mail is still flagged', () => {
    // Completed items stay in `local` (bucket done): still-matching entries are
    // neither re-added nor removed.
    const local = [{ id: 'done-item', externalId: 'outlook:a', bucket: 'done', source: 'outlook' }]
    const { addIds, removeIds } = diffExternalSync([candidate('a')], local, [], 'outlook')
    expect([...addIds]).toEqual([])
    expect(removeIds).toEqual([])
  })

  it('never asks about an already-completed item', () => {
    const local = [
      { id: 'by-bucket', externalId: 'outlook:a', bucket: 'done', source: 'outlook' },
      {
        id: 'by-timestamp',
        externalId: 'outlook:b',
        bucket: 'next',
        source: 'outlook',
        completedAt: '2026-08-01T10:00:00Z'
      }
    ]
    const { removeIds, resolvedIds } = diffExternalSync([], local, [], 'outlook')
    expect(removeIds).toEqual([])
    expect(resolvedIds).toEqual([])
  })

  it('with a seen window, removes only candidates observed without a match', () => {
    // Teams polls a window of recent messages: a candidate seen this sync but no
    // longer matched was un-reacted (remove); one outside the window is just old (keep).
    const local = [
      { id: 'unreacted', externalId: 'teams:in-window', bucket: 'inbox', source: 'teams' },
      { id: 'out-of-window', externalId: 'teams:old', bucket: 'inbox', source: 'teams' }
    ]
    const { removeIds } = diffExternalSync([], local, [], 'teams', new Set(['teams:in-window']))
    expect(removeIds).toEqual(['unreacted'])
  })

  it('the seen window guards the resolved chip too', () => {
    // A triaged Teams item whose message fell out of the poll window must not be
    // reported as resolved — only an explicitly un-reacted one is.
    const local = [
      { id: 'unreacted', externalId: 'teams:in-window', bucket: 'waiting', source: 'teams' },
      { id: 'out-of-window', externalId: 'teams:old', bucket: 'waiting', source: 'teams' }
    ]
    const { resolvedIds } = diffExternalSync([], local, [], 'teams', new Set(['teams:in-window']))
    expect(resolvedIds).toEqual(['unreacted'])
  })
})

describe('teams 👀 mapping', () => {
  const chat: GraphChat = { id: '19:chat@thread.v2', topic: null, chatType: 'oneOnOne' }
  const msg = (overrides: Partial<GraphChatMessage>): GraphChatMessage => ({
    id: 'msg-1',
    messageType: 'message',
    createdDateTime: '2026-07-17T09:00:00Z',
    from: { user: { id: 'julia-id', displayName: 'Julia' } },
    body: { content: '<p>rollout window Friday ok?</p>' },
    reactions: [{ reactionType: '👀', user: { user: { id: 'my-id' } } }],
    ...overrides
  })

  it('detects my 👀 reaction and nobody else’s', () => {
    expect(hasMyEyesReaction(msg({}), 'my-id')).toBe(true)
    expect(hasMyEyesReaction(msg({}), 'other-id')).toBe(false)
    expect(
      hasMyEyesReaction(msg({ reactions: [{ reactionType: 'like', user: { user: { id: 'my-id' } } }] }), 'my-id')
    ).toBe(false)
    expect(hasMyEyesReaction(msg({ reactions: undefined }), 'my-id')).toBe(false)
  })

  it('maps a 👀-marked message to a triage candidate (no canned proposal)', () => {
    const c = eyesMessageToCandidate(msg({}), chat)
    expect(c.externalId).toBe('teams:msg-1')
    // Placeholder title until the AI triages it.
    expect(c.title).toBe('Follow up with Julia')
    // rawText carries the sender, context and message body so triage can compose a real task.
    expect(c.rawText).toContain('From: Julia')
    expect(c.rawText).toContain('rollout window Friday ok?')
    expect(c.meta).toBe('teams · Julia · 👀')
    // null proposal => routed through AI triage, like a flagged mail.
    expect(c.proposal).toBeNull()
  })

  it('strips HTML from the message body', () => {
    const c = eyesMessageToCandidate(msg({ body: { content: '<p>ship <b>v2</b> today</p>' } }), chat)
    expect(c.rawText).toContain('ship v2 today')
    expect(c.rawText).not.toContain('<')
  })

  it('names group chats by topic', () => {
    const c = eyesMessageToCandidate(msg({}), { ...chat, chatType: 'group', topic: '#ops' })
    expect(c.title).toBe('Follow up with Julia in "#ops"')
  })
})

describe('github mapping', () => {
  const pr: GithubSearchItem = {
    id: 42,
    number: 495,
    title: 'Fix retry queue',
    html_url: 'https://github.com/acme/fiscal-core/pull/495',
    repository_url: 'https://api.github.com/repos/acme/fiscal-core'
  }

  it('maps review requests to do-candidates', () => {
    const c = reviewRequestToCandidate(pr)
    expect(c.externalId).toBe('github:review:42')
    expect(c.title).toBe('Review PR acme/fiscal-core#495 — Fix retry queue')
    expect(c.proposal?.bucket).toBe('next')
  })

  it('maps own PRs to waiting-on candidates', () => {
    const c = ownPrToCandidate(pr)
    expect(c.externalId).toBe('github:own:42')
    expect(c.proposal?.bucket).toBe('waiting')
    expect(c.proposal?.owner).toBe('reviewers')
  })
})

describe('jira mapping', () => {
  it('maps assigned issues with due date and priority', () => {
    const c = issueToCandidate(
      { key: 'CON-1514', fields: { summary: 'Preview event crash', duedate: '2026-07-20', priority: { name: 'High' } } },
      'https://acme.atlassian.net/'
    )
    expect(c.externalId).toBe('jira:CON-1514')
    expect(c.url).toBe('https://acme.atlassian.net/browse/CON-1514')
    expect(c.proposal?.deadline).toBe('2026-07-20')
    expect(c.proposal?.priority).toBe(1)
  })
})
