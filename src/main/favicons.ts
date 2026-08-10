import { nativeImage, type Session } from 'electron'

/**
 * Turn a page's favicon into a data URL the shell renderer can draw.
 *
 * The renderer runs under a CSP with `img-src 'self' data: blob:`, and it lives
 * in a different session from the account anyway — so a remote URL cannot
 * simply be handed to an <img>. The bytes are fetched in main, through that
 * account's own session (which has its cookies and cache), and inlined.
 *
 * Using the real favicon rather than bundled logos keeps the tabs correct for
 * custom URLs too, and avoids shipping other people's trademarks.
 */
const MAX_BYTES = 256 * 1024
const cache = new Map<string, string>()

/**
 * Believe the bytes, not the Content-Type.
 *
 * WhatsApp serves a WebP favicon labelled image/png. Chromium sniffs data URLs
 * and renders it regardless, but emitting a data URL whose declared type
 * contradicts its payload is a latent trap for anything stricter.
 */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 6 && buf.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif'
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp'
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00)
    return 'image/x-icon'
  const head = buf.subarray(0, 200).toString('utf8').trimStart()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml'
  return null
}

export function cachedIcon(accountId: string): string | undefined {
  return cache.get(accountId)
}

export function forgetIcon(accountId: string): void {
  cache.delete(accountId)
}

/**
 * Favicons are routinely served from a CDN unrelated to the site: Google
 * Messages uses ssl.gstatic.com, Messenger static.xx.fbcdn.net, Teams
 * aadcdn.msftauth.net. Restricting fetches to the account's *navigation*
 * allowlist meant those services silently never got an icon.
 *
 * Any https URL is accepted instead. That grants no capability the page did not
 * already have — the URL comes from its own <link rel=icon>, and it could fetch
 * it itself. The response is never handed back to the page; it is size-capped
 * and must sniff as an image.
 */
function isFetchableUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === 'https:'
  } catch {
    return false
  }
}

/** Some sites inline the favicon (Discord). Nothing to fetch. */
export function fromDataUrl(rawUrl: string): Buffer | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(rawUrl)
  if (!match) return null
  try {
    return match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]))
  } catch {
    return null
  }
}

/**
 * @returns the data URL if it changed, otherwise null (so callers can skip a
 *   pointless broadcast — favicon events fire repeatedly on SPA navigation).
 */
/**
 * Downscale to a uniform 32px PNG (2x the 16px the tab draws, for HiDPI).
 *
 * Sites advertise wildly different sizes and formats — a 256x256 multi-image
 * .ico from Messenger came to 90 KB of base64 for a 16px slot. Normalising
 * keeps every tab consistent and the IPC payload small.
 *
 * nativeImage cannot decode SVG, so anything it rejects is passed through
 * unchanged rather than dropped.
 */
const TAB_ICON_PX = 32
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Pull a PNG out of an .ico.
 *
 * nativeImage decodes PNG and JPEG only, so Messenger, Teams and Slack — all of
 * which serve .ico — fell through unresized, one at 90 KB of base64 for a 16px
 * slot. Modern .ico files embed PNG data for the larger entries, so the
 * directory can simply be walked for one.
 *
 * @returns the smallest embedded PNG at least TAB_ICON_PX wide, else the
 *   largest available, else null for a legacy BMP-only icon.
 */
export function extractPngFromIco(buf: Buffer): Buffer | null {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null
  const count = buf.readUInt16LE(4)
  if (count === 0 || buf.length < 6 + count * 16) return null

  const candidates: { width: number; data: Buffer }[] = []
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    const width = buf[entry] === 0 ? 256 : buf[entry]
    const size = buf.readUInt32LE(entry + 8)
    const offset = buf.readUInt32LE(entry + 12)
    if (size === 0 || offset + size > buf.length) continue
    const data = buf.subarray(offset, offset + size)
    if (data.length >= 8 && data.subarray(0, 8).equals(PNG_MAGIC)) candidates.push({ width, data })
  }
  if (candidates.length === 0) return null

  candidates.sort((a, b) => a.width - b.width)
  return (candidates.find((c) => c.width >= TAB_ICON_PX) ?? candidates[candidates.length - 1]).data
}

function normalize(buffer: Buffer, type: string): string {
  try {
    const source = type === 'image/x-icon' ? (extractPngFromIco(buffer) ?? buffer) : buffer
    const image = nativeImage.createFromBuffer(source)
    if (!image.isEmpty()) {
      const resized = image.resize({ width: TAB_ICON_PX, height: TAB_ICON_PX, quality: 'best' })
      const png = resized.toPNG()
      if (png.byteLength > 0) return `data:image/png;base64,${png.toString('base64')}`
    }
  } catch {
    /* fall through to the original bytes */
  }
  return `data:${type};base64,${buffer.toString('base64')}`
}

async function load(session: Session, url: string): Promise<Buffer | null> {
  const inline = fromDataUrl(url)
  if (inline) return inline
  if (!isFetchableUrl(url)) return null

  try {
    // session.fetch() rather than net.fetch(): this goes through the account's
    // own session, which holds its cookies and cache.
    const response = await session.fetch(url)
    if (!response.ok) return null
    const declared = (response.headers.get('content-type') || '').split(';')[0].trim()
    if (declared && !declared.startsWith('image/')) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Try each advertised icon until one works. Pages list several sizes and the
 * first choice may 404 or be a format we will not take, so a single attempt
 * loses the icon for the whole account.
 *
 * @returns the data URL if it changed, otherwise null (so callers can skip a
 *   pointless broadcast — favicon events fire repeatedly on SPA navigation).
 */
export async function fetchFavicon(
  accountId: string,
  session: Session,
  urls: string[],
): Promise<string | null> {
  // Last first: pages conventionally list ascending by size, and a crisper
  // source downscales better than a 16px one scales up.
  for (const url of [...urls].reverse()) {
    const buffer = await load(session, url)
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) continue

    // Reject anything that is not actually an image, whatever the header said.
    const type = sniffImageType(buffer)
    if (!type) continue

    const dataUrl = normalize(buffer, type)
    if (cache.get(accountId) === dataUrl) return null
    cache.set(accountId, dataUrl)
    return dataUrl
  }
  return null
}
