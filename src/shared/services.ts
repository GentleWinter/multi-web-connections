/**
 * Which web apps this shell knows how to host.
 *
 * Almost nothing in the app is service-specific: session isolation, the
 * notification shim, the User-Agent strip, permissions, downloads, the context
 * menu and priority alerts all work against any site. Only two things vary —
 * which hosts a view may navigate to, and how to read an unread count.
 */

/**
 * Single source of truth for the strategies. The type is DERIVED from this list
 * so a new strategy cannot be added to one and missed in the other — which is
 * exactly how 'matrix-idb' ended up rejected by the preload's runtime check
 * while typechecking cleanly everywhere.
 */
export const UNREAD_STRATEGIES = [
  /** WhatsApp's IndexedDB (model-storage / chat). Exact, survives UI rewrites. */
  'whatsapp-idb',
  /** matrix-js-sdk's IndexedDB sync store — Reddit Chat and Element both use it. */
  'matrix-idb',
  /** Leading "(3)" in document.title — the common web-chat convention. */
  'title-count',
  /** No unread reporting. */
  'none',
] as const

export type UnreadStrategy = (typeof UNREAD_STRATEGIES)[number]

export function isUnreadStrategy(value: unknown): value is UnreadStrategy {
  return typeof value === 'string' && (UNREAD_STRATEGIES as readonly string[]).includes(value)
}

export interface ServiceDefinition {
  id: string
  name: string
  url: string
  /**
   * Hosts this view may navigate to. A leading dot means "this domain and its
   * subdomains"; anything else is an exact match. Everything else opens in the
   * system browser.
   */
  hosts: string[]
  color: string
  unread: UnreadStrategy
  /** Shown in the picker when the service needs explaining. */
  note?: string
}

/**
 * Third-party identity providers. Sign-in flows routinely bounce through these,
 * and pinning them out breaks login in a way that is very hard to diagnose —
 * the view just refuses to move and the browser opens instead.
 */
export const AUTH_HOSTS = [
  '.accounts.google.com',
  'accounts.google.com',
  '.appleid.apple.com',
  'appleid.apple.com',
  '.login.microsoftonline.com',
  'login.microsoftonline.com',
  'login.live.com',
  '.okta.com',
  '.auth0.com',
  '.duosecurity.com',
]

export const SERVICES: ServiceDefinition[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    url: 'https://web.whatsapp.com/',
    hosts: ['web.whatsapp.com'],
    color: '#25D366',
    unread: 'whatsapp-idb',
    note: 'Uses one of the 4 linked-device slots for that number.',
  },
  {
    id: 'discord',
    name: 'Discord',
    url: 'https://discord.com/app',
    hosts: ['.discord.com', 'discord.com', '.discordapp.com', 'discordapp.com'],
    color: '#5865F2',
    unread: 'title-count',
    note: 'Sign in with email, or scan the QR from the mobile app.',
  },
  {
    id: 'slack',
    name: 'Slack',
    url: 'https://app.slack.com/client',
    hosts: ['.slack.com', 'slack.com'],
    color: '#4A154B',
    unread: 'title-count',
    note: 'Asks for your workspace URL first — add one account per workspace.',
  },
  {
    id: 'messenger',
    name: 'Messenger',
    url: 'https://www.messenger.com/',
    hosts: ['.messenger.com', 'messenger.com', '.facebook.com', 'facebook.com'],
    color: '#0084FF',
    unread: 'title-count',
    note: 'Signs in with your Facebook account.',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: 'https://web.telegram.org/a/',
    hosts: ['.telegram.org', 'telegram.org'],
    color: '#2AABEE',
    unread: 'title-count',
    note: 'Log in by QR code or phone number.',
  },
  {
    id: 'google-messages',
    name: 'Google Messages',
    url: 'https://messages.google.com/web',
    hosts: ['.messages.google.com', 'messages.google.com'],
    color: '#1A73E8',
    unread: 'title-count',
    note: 'Pairs with your Android phone, which must stay online.',
  },
  {
    id: 'reddit-chat',
    name: 'Reddit Chat',
    // chat.reddit.com redirects here; going straight there avoids the bounce.
    url: 'https://www.reddit.com/chat/',
    hosts: ['.reddit.com', 'reddit.com', '.redditstatic.com'],
    color: '#FF4500',
    unread: 'matrix-idb',
    note: 'Reddit Chat runs on Matrix. Reddit itself does not raise desktop notifications.',
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    url: 'https://teams.microsoft.com/',
    hosts: ['.microsoft.com', 'microsoft.com', '.office.com', '.teams.microsoft.com'],
    color: '#6264A7',
    unread: 'title-count',
    note: 'Work or personal Microsoft account.',
  },
  {
    id: 'element',
    name: 'Element (Matrix)',
    url: 'https://app.element.io/',
    hosts: ['.element.io', 'element.io', '.matrix.org'],
    color: '#0DBD8B',
    unread: 'matrix-idb',
    note: 'Defaults to matrix.org — for your own homeserver, use a Custom URL.',
  },
  {
    id: 'custom',
    name: 'Custom URL…',
    url: '',
    hosts: [],
    color: '#8696A0',
    unread: 'title-count',
    note: 'Any web app. Pinned to that domain and its subdomains.',
  },
]

export const CUSTOM_SERVICE_ID = 'custom'

export function serviceById(id: string): ServiceDefinition | undefined {
  return SERVICES.find((s) => s.id === id)
}

/** `.example.com` matches example.com and any subdomain; otherwise exact. */
export function hostMatches(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase()
  return patterns.some((raw) => {
    const p = raw.toLowerCase()
    if (p.startsWith('.')) return h === p.slice(1) || h.endsWith(p)
    return h === p
  })
}

/**
 * Accept what a person actually types.
 *
 * A bare "chat.example.com" is the natural input, and rejecting it silently
 * (with only a dead button as feedback) is a bad trade for the strictness. A
 * scheme is added when missing, and validation goes through the URL parser
 * rather than a regex so hosts with no dot — localhost, intranet names — work.
 *
 * @returns the absolute URL, or null if it cannot be one.
 */
export function normalizeCustomUrl(raw: string): string | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname) return null
  // "https://" alone parses with an empty host on some inputs; also reject a
  // hostname that is nothing but dots.
  if (!/[a-z0-9]/i.test(url.hostname)) return null
  return url.toString()
}

/**
 * Navigation allowlist for a custom URL: the registrable-ish domain and its
 * subdomains, so a login that hops from example.com to auth.example.com still
 * works. Not a real public-suffix lookup — good enough for pinning, and erring
 * wide only costs us a navigation we would otherwise send to the browser.
 */
export function hostsForCustomUrl(rawUrl: string): string[] {
  try {
    const { hostname } = new URL(rawUrl)
    const labels = hostname.split('.')
    if (labels.length <= 2) return [hostname, `.${hostname}`]
    const base = labels.slice(-2).join('.')
    return [hostname, `.${base}`]
  } catch {
    return []
  }
}
