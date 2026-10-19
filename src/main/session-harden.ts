import { desktopCapturer, dialog, type Session } from 'electron'
import { hostMatches } from '../shared/services'
import { attachDownloadHandler } from './downloads'
import { cleanUserAgent } from './user-agent'

/**
 * Electron GRANTS permissions by default when no handler is installed, so every
 * account session needs both handlers — not just the default session.
 */
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media', // camera + mic: voice notes, voice/video calls
  'display-capture', // screen share (M6)
  'clipboard-read', // "copy image" out of WhatsApp
  'clipboard-sanitized-write',
  'fullscreen',
  'speaker-selection',
  'pointerLock',
])

const PROMPT_PERMISSIONS = new Set(['media', 'clipboard-read'])
const SAFE_AUTOMATIC_PERMISSIONS = new Set([
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
  'speaker-selection',
  'pointerLock',
])

function isAllowedOrigin(origin: string | undefined, hosts: string[]): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    return u.protocol === 'https:' && hostMatches(u.hostname, hosts)
  } catch {
    return false
  }
}

export function hardenSession(
  ses: Session,
  hosts: string[],
  permissionHosts: string[] = hosts,
): void {
  // Permissions are granted to the service itself, never to an identity
  // provider we merely allow navigation through.
  // Sensitive approvals live only for this in-memory session and exact origin.
  const decisions = new Map<string, boolean>()
  const decisionKey = (permission: string, origin: string): string => `${permission}\n${origin}`
  const ua = cleanUserAgent(ses.getUserAgent())
  ses.setUserAgent(ua)

  // The header path is separate from navigator.userAgent — setting only one of
  // them leaves some request types advertising Electron.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = ua
    callback({ requestHeaders: details.requestHeaders })
  })

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const origin =
      'securityOrigin' in details && details.securityOrigin
        ? details.securityOrigin
        : details.requestingUrl
    if (
      !ALLOWED_PERMISSIONS.has(permission) ||
      !details.isMainFrame ||
      !isAllowedOrigin(origin, permissionHosts)
    ) {
      callback(false)
      return
    }

    // The display-source chooser below is the explicit consent step for screen
    // capture. Do not grant a source here.
    if (permission === 'display-capture') {
      callback(true)
      return
    }

    if (SAFE_AUTOMATIC_PERMISSIONS.has(permission)) {
      callback(true)
      return
    }

    if (!PROMPT_PERMISSIONS.has(permission) || !origin) {
      callback(false)
      return
    }

    const key = decisionKey(permission, origin)
    const prior = decisions.get(key)
    if (prior !== undefined) {
      callback(prior)
      return
    }

    const hostname = new URL(origin).hostname
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes ?? [] : []
    const requested = permission === 'media'
      ? mediaTypes.length > 0
        ? mediaTypes.map((type) => (type === 'audio' ? 'microphone' : 'camera')).join(' and ')
        : 'camera or microphone'
      : 'clipboard contents'

    void dialog
      .showMessageBox({
        type: 'question',
        title: 'Permission request',
        message: `${hostname} wants to access your ${requested}.`,
        detail: 'Allow only if you started this action and trust this site.',
        buttons: ['Allow', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        const allowed = response === 0
        decisions.set(key, allowed)
        callback(allowed)
      })
      .catch(() => callback(false))
  })

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (
      !ALLOWED_PERMISSIONS.has(permission) ||
      !details.isMainFrame ||
      !isAllowedOrigin(requestingOrigin, permissionHosts)
    ) {
      return false
    }
    if (SAFE_AUTOMATIC_PERMISSIONS.has(permission)) return true
    return decisions.get(decisionKey(permission, requestingOrigin)) === true
  })

  configureSpellcheck(ses)
  configureScreenShare(ses, permissionHosts)
  attachDownloadHandler(ses)
}

/**
 * Screen share during a call. A user gesture from the exact configured origin
 * is required, and the user chooses the specific screen/window in a native
 * dialog. This keeps X11 from silently granting the first enumerated source;
 * on Wayland, desktopCapturer may first invoke the compositor's PipeWire picker.
 */
function configureScreenShare(ses: Session, permissionHosts: string[]): void {
  ses.setDisplayMediaRequestHandler((request, callback) => {
    if (
      !request.userGesture ||
      !request.videoRequested ||
      !request.frame ||
      request.frame !== request.frame.top ||
      !isAllowedOrigin(request.securityOrigin, permissionHosts)
    ) {
      callback({})
      return
    }

    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .then(async (sources) => {
        if (sources.length === 0) {
          callback({})
          return
        }

        const hostname = new URL(request.securityOrigin).hostname
        const buttons = sources.map((source, index) => {
          const name = source.name.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 100)
          return `${index + 1}. ${name || 'Untitled window'}`
        })
        const cancelId = buttons.length
        buttons.push('Cancel')

        const { response } = await dialog.showMessageBox({
          type: 'question',
          title: 'Choose what to share',
          message: `${hostname} is requesting screen or window sharing.`,
          detail: 'Select one source to share. Cancel denies access.',
          buttons,
          defaultId: cancelId,
          cancelId,
          noLink: true,
        })

        const selected = response >= 0 && response < sources.length ? sources[response] : null
        callback(selected ? { video: selected } : {})
      })
      .catch((err) => {
        console.warn('[screenshare] source enumeration failed:', err)
        callback({})
      })
  })
}

/**
 * setSpellCheckerLanguages THROWS on any code that has no Hunspell dictionary,
 * and app.getPreferredSystemLanguages() happily returns such codes (bare "en",
 * region-only entries). Always intersect with what the session actually offers.
 */
function configureSpellcheck(ses: Session): void {
  try {
    const available = new Set(ses.availableSpellCheckerLanguages)
    const wanted = Intl.DateTimeFormat()
      .resolvedOptions()
      .locale.split(',')
      .map((l) => l.trim())
      .filter(Boolean)

    const langs = wanted.filter((l) => available.has(l))
    if (langs.length === 0 && available.has('en-US')) langs.push('en-US')
    if (langs.length > 0) ses.setSpellCheckerLanguages(langs)
  } catch (err) {
    console.warn('[spellcheck] disabled:', err)
  }
}
