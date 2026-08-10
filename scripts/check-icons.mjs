#!/usr/bin/env node
/**
 * Verify the committed icons still match the generator.
 *
 * Compares decoded PIXELS, not file bytes. Identical pixel data compresses to a
 * slightly different byte stream under different zlib builds, so a byte
 * comparison fails on any machine whose Node differs from the one that last ran
 * the generator — which is exactly how this check first failed in CI while the
 * images were in fact identical.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SIZES, decodePng, render } from './icon-render.mjs'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icons')

let failed = 0
for (const size of SIZES) {
  const file = join(DIR, `${size}x${size}.png`)
  let committed
  try {
    committed = decodePng(readFileSync(file))
  } catch (err) {
    console.error(`  MISSING/UNREADABLE ${size}x${size}.png — ${err.message}`)
    failed++
    continue
  }

  if (committed.width !== size || committed.height !== size) {
    console.error(`  WRONG SIZE ${size}x${size}.png is ${committed.width}x${committed.height}`)
    failed++
    continue
  }

  const expected = render(size)
  if (!committed.rgba.equals(expected)) {
    let differing = 0
    for (let i = 0; i < expected.length; i += 4) {
      if (committed.rgba.readUInt32LE(i) !== expected.readUInt32LE(i)) differing++
    }
    console.error(`  PIXELS DIFFER ${size}x${size}.png — ${differing} of ${expected.length / 4} px`)
    failed++
    continue
  }

  console.log(`  ok ${size}x${size}.png`)
}

if (failed > 0) {
  console.error(`\n${failed} icon(s) differ from the generator. Run: npm run icons`)
  process.exit(1)
}
console.log(`\nall ${SIZES.length} icons match the generator`)
