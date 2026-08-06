import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { __test } from './.build/main/downloads.js'

const { safeName, uniquePath } = __test

test('ordinary filenames survive intact', () => {
  assert.equal(safeName('photo.jpg'), 'photo.jpg')
  assert.equal(safeName('my holiday photo.jpg'), 'my holiday photo.jpg')
  assert.equal(safeName('photo (1).jpg'), 'photo (1).jpg')
  assert.equal(safeName('2026-07-29-report.pdf'), '2026-07-29-report.pdf')
  assert.equal(safeName('رپورٹ.pdf'), 'رپورٹ.pdf')
})

test('path traversal cannot escape the download directory', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd')
  assert.equal(safeName('/etc/shadow'), 'shadow')
  assert.equal(safeName('..\\..\\windows\\system32'), '.._.._windows_system32')
})

test('empty names fall back', () => {
  assert.equal(safeName(''), 'download')
  assert.equal(safeName('/'), 'download')
})

test('existing files are never clobbered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dl-test-'))
  assert.equal(basename(uniquePath(dir, 'a.jpg')), 'a.jpg')

  writeFileSync(join(dir, 'a.jpg'), 'x')
  assert.equal(basename(uniquePath(dir, 'a.jpg')), 'a (1).jpg')

  writeFileSync(join(dir, 'a (1).jpg'), 'x')
  assert.equal(basename(uniquePath(dir, 'a.jpg')), 'a (2).jpg')

  writeFileSync(join(dir, 'noext'), 'x')
  assert.equal(basename(uniquePath(dir, 'noext')), 'noext (1)')
})
