import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// autostart resolves paths from app.getPath('home'), which the stub reads from
// TEST_HOME. Must be set before the module is imported.
const home = mkdtempSync(join(tmpdir(), 'autostart-test-'))
process.env.TEST_HOME = home
delete process.env.XDG_CONFIG_HOME

const A = await import('./.build/main/autostart.js')
const ENTRY = join(home, '.config', 'autostart', 'com.sheryar.WhatsAppMulti.desktop')

test('disabled until an entry is written', () => {
  assert.equal(A.isEnabled(), false)
})

test('enable writes an entry and reports enabled', () => {
  assert.equal(A.setEnabled(true), true)
  assert.equal(A.isEnabled(), true)
})

test('the generated Exec is launchable', () => {
  const body = readFileSync(ENTRY, 'utf8')
  // Without this the app runs as plain Node at login and exits silently.
  assert.match(body, /Exec=env -u ELECTRON_RUN_AS_NODE/)
  // Comes up in the tray instead of stealing focus.
  assert.match(body, /--hidden\s*$/m)
  assert.match(body, /StartupWMClass=com\.sheryar\.WhatsAppMulti/)
})

test('entries disabled by a settings editor are not reported as enabled', () => {
  const body = readFileSync(ENTRY, 'utf8')

  writeFileSync(ENTRY, body.replace('X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-enabled=false'))
  assert.equal(A.isEnabled(), false)

  writeFileSync(ENTRY, `${body}\nHidden=true\n`)
  assert.equal(A.isEnabled(), false)

  writeFileSync(ENTRY, body)
  assert.equal(A.isEnabled(), true)
})

test('disable removes the entry and is idempotent', () => {
  assert.equal(A.setEnabled(false), true)
  assert.equal(A.isEnabled(), false)
  assert.equal(A.setEnabled(false), true)
})
