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

test('service lookup', () => {
  assert.equal(serviceById('discord')?.name, 'Discord')
  assert.equal(serviceById('nope'), undefined)
})
