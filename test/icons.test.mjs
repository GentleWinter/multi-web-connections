import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SIZES, decodePng, encodePng, render } from '../scripts/icon-render.mjs'

const ICONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icons')

test('render is deterministic', () => {
  assert.ok(render(32).equals(render(32)))
})

test('encode/decode round-trips the exact pixels', () => {
  const px = render(24)
  const decoded = decodePng(encodePng(24, px))
  assert.equal(decoded.width, 24)
  assert.equal(decoded.height, 24)
  assert.ok(decoded.rgba.equals(px))
})

test('committed icons match the generator', () => {
  // Pixel comparison, not bytes: the same image compresses differently under
  // different zlib builds, which is what broke this check in CI.
  for (const size of SIZES) {
    const decoded = decodePng(readFileSync(join(ICONS, `${size}x${size}.png`)))
    assert.equal(decoded.width, size, `${size}x${size}.png has wrong width`)
    assert.ok(decoded.rgba.equals(render(size)), `${size}x${size}.png pixels differ`)
  }
})

test('the icon is not blank or fully opaque', () => {
  // Guards against a rendering change that silently produces an empty square.
  const px = render(64)
  let transparent = 0
  let opaque = 0
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] === 0) transparent++
    else if (px[i] === 255) opaque++
  }
  assert.ok(transparent > 0, 'expected transparent corners outside the rounded square')
  assert.ok(opaque > 0, 'expected an opaque body')
})
