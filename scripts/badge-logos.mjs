#!/usr/bin/env node
/**
 * Build data-URI logos for the README badges of services that shields.io cannot
 * draw itself.
 *
 * shields.io takes `logo=<simple-icons slug>`, but Slack and Microsoft Teams
 * have both been withdrawn from simple-icons, so those two badges rendered as
 * colour and text only. shields.io also accepts `logo=data:image/png;base64,…`,
 * so their own published favicons can be used instead — the same source the app
 * uses for tab icons.
 *
 *   node scripts/badge-logos.mjs        # prints the markdown to paste
 *
 * Re-run if a brand changes its favicon; the output is pasted into README.md
 * rather than fetched at render time, so the README has no live dependency.
 */
import { decodePng, downscale, encodePng } from './icon-render.mjs'

const LOGO_PX = 16 // shields draws the logo at roughly this size

const SERVICES = [
  {
    name: 'Slack',
    color: '4A154B',
    // Their marketing favicon is already a plain 32px PNG.
    url: 'https://a.slack-edge.com/80588/marketing/img/meta/favicon-32.png',
  },
  {
    name: 'Microsoft_Teams',
    color: '6264A7',
    // Advertised by teams.microsoft.com as its shortcut icon.
    url: 'https://teams.public.onecdn.static.microsoft/evergreen-assets/icons/microsoft_teams_logo_refresh_v2025.ico',
  },
]

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Modern .ico files store their larger entries as embedded PNGs. */
function extractPngFromIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null
  const count = buf.readUInt16LE(4)
  const found = []
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    if (entry + 16 > buf.length) break
    const width = buf[entry] === 0 ? 256 : buf[entry]
    const size = buf.readUInt32LE(entry + 8)
    const offset = buf.readUInt32LE(entry + 12)
    if (size === 0 || offset + size > buf.length) continue
    const data = buf.subarray(offset, offset + size)
    if (data.subarray(0, 8).equals(PNG_MAGIC)) found.push({ width, data })
  }
  if (found.length === 0) return null
  found.sort((a, b) => a.width - b.width)
  return (found.find((f) => f.width >= 64) ?? found[found.length - 1]).data
}

for (const service of SERVICES) {
  const response = await fetch(service.url)
  if (!response.ok) {
    console.error(`  ${service.name}: HTTP ${response.status} — skipped`)
    continue
  }
  const raw = Buffer.from(await response.arrayBuffer())
  const png = raw.subarray(0, 8).equals(PNG_MAGIC) ? raw : extractPngFromIco(raw)
  if (!png) {
    console.error(`  ${service.name}: no PNG available in that asset — skipped`)
    continue
  }

  const { width, height, rgba } = decodePng(png)
  const small = encodePng(LOGO_PX, downscale(rgba, width, height, LOGO_PX))
  const logo = `data:image/png;base64,${small.toString('base64')}`
  const label = service.name.replace(/_/g, ' ')

  console.error(`  ${label}: ${width}x${height} -> ${LOGO_PX}px, ${small.length}b`)
  console.log(
    `![${label}](https://img.shields.io/badge/${service.name}-${service.color}?style=flat-square&logo=${encodeURIComponent(logo)})`,
  )
}
