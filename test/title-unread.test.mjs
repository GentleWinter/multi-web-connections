import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.document = { title: '' }
const { readTitleCount } = await import('./.build/preload/unread-reader.js')

const withTitle = (t) => {
  globalThis.document.title = t
  return readTitleCount()
}

test('reads a leading parenthesised count', () => {
  assert.equal(withTitle('(3) Discord').direct, 3)
  assert.equal(withTitle('(12) Slack | general').direct, 12)
  assert.equal(withTitle(' (7) Messenger').direct, 7)
})

test('a bare title is zero, not unknown', () => {
  const r = withTitle('Discord')
  assert.equal(r.status, 'ok')
  assert.equal(r.direct, 0)
})

test('digits elsewhere in the title are ignored', () => {
  // The whole point of anchoring: a channel or group named with a number must
  // not be read as a message count.
  assert.equal(withTitle('Slack | 2024 Planning').direct, 0)
  assert.equal(withTitle('Discord | #general (42 members)').direct, 0)
  assert.equal(withTitle('WhatsApp 2024').direct, 0)
})

test('a leading marker means activity without a count', () => {
  assert.equal(withTitle('• Slack').markedUnread, 1)
  assert.equal(withTitle('* Element').markedUnread, 1)
  assert.equal(withTitle('Slack •').markedUnread, 0)
})
