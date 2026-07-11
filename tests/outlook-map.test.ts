import { describe, expect, it } from 'vitest'
import { diffMailSync, eventToMeeting, mailToCandidate, type GraphMessage } from '../src/main/outlook-map'

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

describe('diffMailSync', () => {
  const candidate = (id: string) => ({
    externalId: `outlook:${id}`,
    title: id,
    rawText: id,
    meta: 'outlook',
    url: null
  })

  it('adds new mails, skips existing and tombstoned ones', () => {
    const matched = [candidate('a'), candidate('b'), candidate('c')]
    const local = [{ id: 'item-1', externalId: 'outlook:a', bucket: 'inbox', source: 'outlook' }]
    const { add } = diffMailSync(matched, local, ['outlook:c'])
    expect(add.map((m) => m.externalId)).toEqual(['outlook:b'])
  })

  it('removes untriaged candidates whose mail was handled, but keeps triaged items', () => {
    const local = [
      { id: 'untriaged', externalId: 'outlook:gone', bucket: 'inbox', source: 'outlook' },
      { id: 'triaged', externalId: 'outlook:also-gone', bucket: 'next', source: 'outlook' },
      { id: 'manual', externalId: null, bucket: 'inbox', source: 'capture' }
    ]
    const { removeIds } = diffMailSync([], local, [])
    expect(removeIds).toEqual(['untriaged'])
  })
})
