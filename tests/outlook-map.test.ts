import { describe, expect, it } from 'vitest'
import {
  chatToCandidate,
  eventToMeeting,
  mailToCandidate,
  type GraphChat,
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
    flag: { flagStatus: 'notFlagged' },
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
    expect(c.meta).toBe('outlook · BMF Auditor · unread')
    expect(c.url).toContain('outlook.office365.com')
  })

  it('handles flagged mail, missing subject and sender', () => {
    const c = mailToCandidate(
      makeMessage({ subject: '  ', from: undefined, flag: { flagStatus: 'flagged' } })
    )
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

  it('removes untriaged candidates of the same source only, keeps triaged items', () => {
    const local = [
      { id: 'untriaged', externalId: 'outlook:gone', bucket: 'inbox', source: 'outlook' },
      { id: 'triaged', externalId: 'outlook:also-gone', bucket: 'next', source: 'outlook' },
      { id: 'other-source', externalId: 'github:x', bucket: 'inbox', source: 'github' },
      { id: 'manual', externalId: null, bucket: 'inbox', source: 'capture' }
    ]
    const { removeIds } = diffExternalSync([], local, [], 'outlook')
    expect(removeIds).toEqual(['untriaged'])
  })
})

describe('chatToCandidate', () => {
  const chat = (overrides: Partial<GraphChat>): GraphChat => ({
    id: '19:chat',
    topic: null,
    chatType: 'oneOnOne',
    viewpoint: { lastMessageReadDateTime: '2026-07-11T08:00:00Z' },
    lastMessagePreview: {
      id: 'msg-1',
      createdDateTime: '2026-07-11T09:00:00Z',
      from: { user: { id: 'julia-id', displayName: 'Julia' } },
      body: { content: '<p>rollout window Friday ok?</p>' }
    },
    ...overrides
  })

  it('flags unread chats from others as reply candidates', () => {
    const c = chatToCandidate(chat({}), 'my-id')
    expect(c?.title).toBe('Reply to Julia')
    expect(c?.externalId).toBe('teams:msg-1')
    expect(c?.rawText).toContain('rollout window Friday ok?')
    expect(c?.proposal?.bucket).toBe('next')
  })

  it('skips own messages and already-read chats', () => {
    expect(
      chatToCandidate(chat({ lastMessagePreview: { ...chat({}).lastMessagePreview!, from: { user: { id: 'my-id' } } } }), 'my-id')
    ).toBeNull()
    expect(
      chatToCandidate(chat({ viewpoint: { lastMessageReadDateTime: '2026-07-11T10:00:00Z' } }), 'my-id')
    ).toBeNull()
  })

  it('names group chats by topic', () => {
    const c = chatToCandidate(chat({ chatType: 'group', topic: '#ops' }), 'my-id')
    expect(c?.title).toBe('Reply to Julia in "#ops"')
  })
})

describe('github mapping', () => {
  const pr: GithubSearchItem = {
    id: 42,
    number: 495,
    title: 'Fix retry queue',
    html_url: 'https://github.com/efsta/fiscal-core/pull/495',
    repository_url: 'https://api.github.com/repos/efsta/fiscal-core'
  }

  it('maps review requests to do-candidates', () => {
    const c = reviewRequestToCandidate(pr)
    expect(c.externalId).toBe('github:review:42')
    expect(c.title).toBe('Review PR efsta/fiscal-core#495 — Fix retry queue')
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
      'https://efsta.atlassian.net/'
    )
    expect(c.externalId).toBe('jira:CON-1514')
    expect(c.url).toBe('https://efsta.atlassian.net/browse/CON-1514')
    expect(c.proposal?.deadline).toBe('2026-07-20')
    expect(c.proposal?.priority).toBe(1)
  })
})
