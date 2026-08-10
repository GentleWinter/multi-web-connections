import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVICES } from './.build/shared/services.js'

const README = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'),
  'utf8',
)

/** Badge labels and service names differ only in cosmetic suffixes. */
const normalize = (s) =>
  s
    .replace(/\s*\(Matrix\)/i, '')
    .replace(/…$/, '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase()

test('every service has a badge in the README', () => {
  // This README has gone stale twice. A service added to the catalog without a
  // badge is a silent documentation gap, so it fails here instead.
  const badges = [...README.matchAll(/^!\[([^\]]+)\]\(https:\/\/img\.shields\.io\//gm)].map((m) =>
    normalize(m[1]),
  )
  assert.ok(badges.length > 0, 'no shields.io badges found in the README')

  for (const service of SERVICES) {
    assert.ok(
      badges.includes(normalize(service.name)),
      `${service.name} has no badge in the README (badges: ${badges.join(', ')})`,
    )
  }
})

test('no badge names a service that no longer exists', () => {
  const names = SERVICES.map((s) => normalize(s.name))
  const badges = [...README.matchAll(/^!\[([^\]]+)\]\(https:\/\/img\.shields\.io\//gm)].map((m) =>
    normalize(m[1]),
  )
  for (const badge of badges) {
    assert.ok(names.includes(badge), `README badges "${badge}", which is not a service`)
  }
})

test('badge colours match the service definitions', () => {
  // A badge in the wrong brand colour is the kind of thing nobody notices.
  for (const service of SERVICES) {
    const escaped = normalize(service.name).replace(/ /g, '[_ ]')
    const re = new RegExp(`img\\.shields\\.io/badge/${escaped}[^-]*-([0-9A-Fa-f]{6})`, 'i')
    const found = re.exec(README)
    if (!found) continue // covered by the test above
    assert.equal(
      found[1].toUpperCase(),
      service.color.replace('#', '').toUpperCase(),
      `${service.name} badge colour does not match its service definition`,
    )
  }
})
