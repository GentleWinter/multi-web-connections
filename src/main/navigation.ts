import { shell, type WebContents } from 'electron'
import { AUTH_HOSTS, hostMatches } from '../shared/services'

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'tel:'])

function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.hostname : null
  } catch {
    return null
  }
}

export function openExternal(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return
  }
  if (!EXTERNAL_PROTOCOLS.has(u.protocol)) return
  void shell.openExternal(url)
}

/**
 * Keep an account view pinned to its own service. Note will-navigate does not
 * fire for SPA history pushes, which is fine — these are all SPAs and we only
 * care about real navigations.
 *
 * AUTH_HOSTS is always allowed on top of the service's own list: sign-in flows
 * routinely bounce through Google/Apple/Microsoft, and pinning those out breaks
 * login in a way that looks like the app is simply ignoring the button.
 */
export function pinNavigation(wc: WebContents, hosts: string[]): void {
  const allowed = [...hosts, ...AUTH_HOSTS]

  wc.on('will-navigate', (event, url) => {
    const host = hostOf(url)
    if (host && hostMatches(host, allowed)) return
    event.preventDefault()
    openExternal(url)
  })

  wc.on('will-redirect', (event, url) => {
    const host = hostOf(url)
    if (host && hostMatches(host, allowed)) return
    event.preventDefault()
  })

  // Links with target=_blank, and WhatsApp's own click-to-chat popouts.
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
}
