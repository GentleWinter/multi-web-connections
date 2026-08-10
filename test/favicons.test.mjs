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

test('inline data: favicons are decoded, not fetched', async () => {
  // Discord advertises its favicon as a data: URL, which the first version
  // rejected outright because it was not http(s).
  const { fromDataUrl } = await import('./.build/main/favicons.js')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.ok(fromDataUrl(`data:image/png;base64,${png.toString('base64')}`).equals(png))
  assert.equal(fromDataUrl('https://example.com/x.png'), null)
  assert.equal(fromDataUrl('not a url'), null)
})

test('extracts an embedded PNG from an .ico', async () => {
  const { extractPngFromIco } = await import('./.build/main/favicons.js')
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  // Two entries: 16px and 64px, both PNG-encoded, as real favicons are.
  const small = Buffer.concat([PNG, Buffer.from('small')])
  const large = Buffer.concat([PNG, Buffer.from('large')])
  const header = Buffer.alloc(6 + 32)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(2, 4)
  const dataStart = 6 + 32
  header[6] = 16
  header.writeUInt32LE(small.length, 6 + 8)
  header.writeUInt32LE(dataStart, 6 + 12)
  header[22] = 64
  header.writeUInt32LE(large.length, 22 + 8)
  header.writeUInt32LE(dataStart + small.length, 22 + 12)
  const ico = Buffer.concat([header, small, large])

  // 32px is the target, so the 64px entry wins over the 16px one.
  assert.ok(extractPngFromIco(ico).equals(large))
})

test('returns null for a legacy BMP-only .ico', async () => {
  const { extractPngFromIco } = await import('./.build/main/favicons.js')
  const bmp = Buffer.alloc(40, 7)
  const header = Buffer.alloc(6 + 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = 32
  header.writeUInt32LE(bmp.length, 6 + 8)
  header.writeUInt32LE(22, 6 + 12)
  assert.equal(extractPngFromIco(Buffer.concat([header, bmp])), null)
})

test('rejects malformed .ico without throwing', async () => {
  const { extractPngFromIco } = await import('./.build/main/favicons.js')
  assert.equal(extractPngFromIco(Buffer.alloc(0)), null)
  assert.equal(extractPngFromIco(Buffer.from('not an ico')), null)
  assert.equal(extractPngFromIco(Buffer.alloc(6)), null)
})
