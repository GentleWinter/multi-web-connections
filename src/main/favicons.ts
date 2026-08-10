import type { Session } from 'electron'
import { hostMatches } from '../shared/services'

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

function isAllowed(rawUrl: string, hosts: string[]): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    // Favicons are often served from a sibling CDN (redditstatic.com), which is
    // already in the account's host list.
    return hostMatches(url.hostname, hosts)
  } catch {
    return false
  }
}

/**
 * @returns the data URL if it changed, otherwise null (so callers can skip a
 *   pointless broadcast — favicon events fire repeatedly on SPA navigation).
 */
export async function fetchFavicon(
  accountId: string,
  session: Session,
  url: string,
  hosts: string[],
): Promise<string | null> {
  if (!isAllowed(url, hosts)) return null

  try {
    // session.fetch() rather than net.fetch(): this must go through the
    // account's own session, which holds its cookies and cache.
    const response = await session.fetch(url)
    if (!response.ok) return null

    const declared = (response.headers.get('content-type') || '').split(';')[0].trim()
    if (declared && !declared.startsWith('image/')) return null

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null

    // Reject anything that is not actually an image, whatever the header said.
    const type = sniffImageType(buffer)
    if (!type) return null

    const dataUrl = `data:${type};base64,${buffer.toString('base64')}`
    if (cache.get(accountId) === dataUrl) return null
    cache.set(accountId, dataUrl)
    return dataUrl
  } catch {
    return null
  }
}
