import test from 'node:test'
import assert from 'node:assert/strict'
import { sniffImageType } from './.build/main/favicons.js'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const gif = Buffer.from('GIF89a....', 'ascii')
const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')])
const ico = Buffer.from([0x00, 0x00, 0x01, 0x00, 0, 0])
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')

test('recognises the formats favicons actually use', () => {
  assert.equal(sniffImageType(png), 'image/png')
  assert.equal(sniffImageType(jpeg), 'image/jpeg')
  assert.equal(sniffImageType(gif), 'image/gif')
  assert.equal(sniffImageType(webp), 'image/webp')
  assert.equal(sniffImageType(ico), 'image/x-icon')
  assert.equal(sniffImageType(svg), 'image/svg+xml')
})

test('trusts the bytes over a wrong Content-Type', () => {
  // Real case: WhatsApp serves a WebP favicon labelled image/png. Emitting a
  // data URL that contradicts its payload is a trap for stricter consumers.
  assert.equal(sniffImageType(webp), 'image/webp')
})

test('rejects non-images', () => {
  assert.equal(sniffImageType(Buffer.from('<!doctype html><html>', 'utf8')), null)
  assert.equal(sniffImageType(Buffer.from('not an image at all', 'utf8')), null)
  assert.equal(sniffImageType(Buffer.alloc(0)), null)
})
