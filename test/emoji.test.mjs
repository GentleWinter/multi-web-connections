import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_EMOJI, EMOJI_CATEGORIES, searchEmoji } from './.build/shared/emoji.js'

test('every entry has a character and keywords', () => {
  for (const e of ALL_EMOJI) {
    assert.ok(e.char.length > 0, 'empty char')
    assert.ok(e.keywords.trim().length > 0, `${e.char} has no keywords`)
    // A stray space in the source would split char and keywords wrongly.
    assert.ok(!e.char.includes(' '), `char "${e.char}" contains a space`)
  }
})

test('categories are non-empty and uniquely named', () => {
  const ids = new Set()
  for (const c of EMOJI_CATEGORIES) {
    assert.ok(c.entries.length > 0, `${c.id} is empty`)
    assert.ok(!ids.has(c.id), `duplicate category ${c.id}`)
    ids.add(c.id)
  }
})

test('search ranks the obvious match first', () => {
  // The reason for ranking at all: a substring match would surface
  // "communication" ahead of the cat.
  assert.equal(searchEmoji('rocket')[0].char, '🚀')
  assert.equal(searchEmoji('fire')[0].char, '🔥')
  assert.equal(searchEmoji('cat')[0].char, '🐱')
  assert.equal(searchEmoji('thumbs')[0].char, '👍')
  assert.equal(searchEmoji('pizza')[0].char, '🍕')
})

test('search is case-insensitive and trims', () => {
  assert.equal(searchEmoji('  ROCKET ')[0].char, '🚀')
})

test('prefix matches are found', () => {
  assert.ok(searchEmoji('celebr').some((e) => e.char === '🎉'))
  assert.ok(searchEmoji('lapt').some((e) => e.char === '💻'))
})

test('empty or unmatched queries return nothing', () => {
  assert.deepEqual(searchEmoji(''), [])
  assert.deepEqual(searchEmoji('   '), [])
  assert.deepEqual(searchEmoji('zzzznotanemoji'), [])
})

test('results are capped', () => {
  assert.ok(searchEmoji('a', 10).length <= 10)
})
