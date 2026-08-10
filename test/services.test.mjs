import test from 'node:test'
import assert from 'node:assert/strict'
import { hostMatches, hostsForCustomUrl, serviceById, SERVICES } from './.build/shared/services.js'

test('exact hosts match only themselves', () => {
  assert.equal(hostMatches('web.whatsapp.com', ['web.whatsapp.com']), true)
  assert.equal(hostMatches('evil.com', ['web.whatsapp.com']), false)
  // A suffix must not match without the leading dot form.
  assert.equal(hostMatches('notweb.whatsapp.com', ['web.whatsapp.com']), false)
})

test('a leading dot matches the domain and its subdomains', () => {
  assert.equal(hostMatches('slack.com', ['.slack.com']), true)
  assert.equal(hostMatches('app.slack.com', ['.slack.com']), true)
  assert.equal(hostMatches('a.b.slack.com', ['.slack.com']), true)
})

test('subdomain patterns cannot be spoofed by a lookalike domain', () => {
  // The bug this guards: endsWith('slack.com') would accept both of these.
  assert.equal(hostMatches('evilslack.com', ['.slack.com']), false)
  assert.equal(hostMatches('slack.com.evil.net', ['.slack.com']), false)
})

test('matching is case-insensitive', () => {
  assert.equal(hostMatches('App.Slack.COM', ['.slack.com']), true)
})

test('custom URLs pin to the registrable domain and its subdomains', () => {
  assert.deepEqual(hostsForCustomUrl('https://chat.example.com/x'), [
    'chat.example.com',
    '.example.com',
  ])
  assert.deepEqual(hostsForCustomUrl('https://example.com'), ['example.com', '.example.com'])
})

test('an unparseable custom URL yields no hosts, so nothing is allowed', () => {
  assert.deepEqual(hostsForCustomUrl('not a url'), [])
  assert.deepEqual(hostsForCustomUrl(''), [])
})

test('every service declares hosts that admit its own start URL', () => {
  for (const s of SERVICES) {
    if (!s.url) continue // the custom placeholder has none
    const host = new URL(s.url).hostname
    assert.equal(hostMatches(host, s.hosts), true, `${s.name}: ${host} not in ${s.hosts}`)
  }
})

test('every service explains itself in the picker', () => {
  // The picker is the only place a user learns what they are signing into, so
  // an entry without a note is a gap in the UI, not a cosmetic omission.
  for (const s of SERVICES) {
    assert.ok(s.note && s.note.trim().length > 0, `${s.name} has no note`)
    assert.ok(s.note.length <= 90, `${s.name} note is too long for the card: ${s.note.length}`)
  }
})

test('service lookup', () => {
  assert.equal(serviceById('discord')?.name, 'Discord')
  assert.equal(serviceById('nope'), undefined)
})

test('custom URLs accept what a person actually types', async () => {
  const { normalizeCustomUrl } = await import('./.build/shared/services.js')

  // A bare domain is the natural input; rejecting it left the Add button dead
  // with no explanation.
  assert.equal(normalizeCustomUrl('chat.example.com'), 'https://chat.example.com/')
  assert.equal(normalizeCustomUrl('example.com'), 'https://example.com/')
  assert.equal(normalizeCustomUrl('  spaces.example.com  '), 'https://spaces.example.com/')

  // Hosts with no dot are legitimate — a regex requiring one rejected these.
  assert.equal(normalizeCustomUrl('localhost:3000'), 'https://localhost:3000/')
  assert.equal(normalizeCustomUrl('http://localhost:3000'), 'http://localhost:3000/')
  assert.equal(normalizeCustomUrl('https://intranet/chat'), 'https://intranet/chat')

  // Explicit schemes are preserved, not double-prefixed.
  assert.equal(normalizeCustomUrl('https://a.example.com/x'), 'https://a.example.com/x')
})

test('custom URLs reject what cannot be loaded', async () => {
  const { normalizeCustomUrl } = await import('./.build/shared/services.js')
  assert.equal(normalizeCustomUrl('ftp://x.com'), null)
  assert.equal(normalizeCustomUrl('file:///etc/passwd'), null)
  assert.equal(normalizeCustomUrl('javascript://x'), null)
  assert.equal(normalizeCustomUrl(''), null)
  assert.equal(normalizeCustomUrl('   '), null)
  assert.equal(normalizeCustomUrl('...'), null)
  assert.equal(normalizeCustomUrl(null), null)
})

test('a normalised custom URL yields usable navigation hosts', async () => {
  const { normalizeCustomUrl, hostsForCustomUrl, hostMatches } = await import(
    './.build/shared/services.js'
  )
  const url = normalizeCustomUrl('chat.example.com')
  const hosts = hostsForCustomUrl(url)
  assert.equal(hostMatches('chat.example.com', hosts), true)
  assert.equal(hostMatches('auth.example.com', hosts), true, 'login hops must be allowed')
  assert.equal(hostMatches('example.com.evil.net', hosts), false)
})
