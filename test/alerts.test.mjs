import test from 'node:test'
import assert from 'node:assert/strict'
import { matchKeyword, normalizeKeywords, sanitizeAlerts } from './.build/main/alerts.js'

const KW = ['urgent', 'asap', 'production down']

test('matches a keyword and reports which one', () => {
  assert.equal(matchKeyword('This is URGENT!', KW, true), 'urgent')
  assert.equal(matchKeyword('do it asap please', KW, true), 'asap')
  assert.equal(matchKeyword('the production down again', KW, true), 'production down')
  assert.equal(matchKeyword('all good here', KW, true), null)
})

test('whole-word mode rejects substring hits', () => {
  // The reason this option exists: "insurgent" must not page you.
  assert.equal(matchKeyword('insurgent forces', ['urgent'], true), null)
  assert.equal(matchKeyword('urgently needed', ['urgent'], true), null)
  assert.equal(matchKeyword('not_urgent_at_all', ['urgent'], true), null)
})

test('substring mode accepts them', () => {
  assert.equal(matchKeyword('insurgent forces', ['urgent'], false), 'urgent')
})

test('punctuation and string edges count as boundaries', () => {
  assert.equal(matchKeyword('is it urgent?', ['urgent'], true), 'urgent')
  assert.equal(matchKeyword('urgent: fix', ['urgent'], true), 'urgent')
  assert.equal(matchKeyword('this is urgent', ['urgent'], true), 'urgent')
})

test('word boundaries work in non-Latin text', () => {
  // JS \b is ASCII-only, which is why this uses Unicode classes instead.
  assert.equal(matchKeyword('یہ ضروری ہے', ['ضروری'], true), 'ضروری')
  assert.equal(matchKeyword('غیرضروری', ['ضروری'], true), null)
  assert.equal(matchKeyword('یہ urgent ہے', ['urgent'], true), 'urgent')
})

test('scanning continues past a boundary-rejected hit', () => {
  assert.equal(matchKeyword('xurgent urgent', ['urgent'], true), 'urgent')
})

test('degenerate input never throws', () => {
  assert.equal(matchKeyword('urgent', [], true), null)
  assert.equal(matchKeyword('', KW, true), null)
  assert.equal(matchKeyword(null, KW, true), null)
  assert.equal(matchKeyword(undefined, KW, true), null)
})

test('keywords are normalised', () => {
  assert.deepEqual(normalizeKeywords([' Urgent ', 'URGENT', 'asap', '']), ['urgent', 'asap'])
  assert.deepEqual(normalizeKeywords(['ok', 5, null, {}]), ['ok'])
  assert.deepEqual(normalizeKeywords('nope'), [])
})

test('settings are sanitised with safe defaults', () => {
  assert.deepEqual(sanitizeAlerts({}), { enabled: true, keywords: [], wholeWord: true })
  assert.deepEqual(sanitizeAlerts({ enabled: 'yes', keywords: 'x', wholeWord: 0 }), {
    enabled: true,
    keywords: [],
    wholeWord: true,
  })
})
