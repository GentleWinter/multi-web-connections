#!/usr/bin/env node
/**
 * Write the app icon set as PNGs, with no image-library dependency.
 *
 * electron-builder wants a directory of <N>x<N>.png files, and the tray needs a
 * small one. Committing the generator alongside the output keeps the icon
 * editable — a binary blob with no source is not.
 *
 *   node scripts/generate-icons.mjs
 *   node scripts/check-icons.mjs    # verify the committed files still match
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SIZES, encodePng, render } from './icon-render.mjs'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icons')

mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}x${size}.png`)
  writeFileSync(file, encodePng(size, render(size)))
  console.log(`wrote ${file}`)
}
