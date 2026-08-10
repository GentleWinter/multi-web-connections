import type { UnreadReport } from '../shared/types'
import type { UnreadStrategy } from '../shared/services'

/**
 * Read unread counts straight out of WhatsApp's IndexedDB.
 *
 * Approach lifted from Ferdium's WhatsApp recipe (MIT). The alternative —
 * regexing a number out of document.title — matches any digit in the title, so
 * a group named "2024 Planning" reads as 2024 unread messages.
 *
 * Schema verified live against this build: model-storage v1990, object store
 * "chat", fields unreadCount / archive / muteExpiration / isAutoMuted.
 *
 * This runs in the preload's ISOLATED world, which is fine — IndexedDB is keyed
 * by origin, not by JS world, so no main-world injection is needed here.
 */
const DB_NAME = 'model-storage'
const STORE = 'chat'

/** matrix-js-sdk names its sync store per client: reddit-chat-sync, riot-web-sync… */
const MATRIX_DB = /^matrix-js-sdk:.*sync$/i
const MATRIX_STORE = 'sync'

/**
 * The Matrix sync record is the whole accumulator — ~700 KB, measured at 6-11 ms
 * to read. That is ~0.2% duty cycle at this cadence, which is worth paying:
 * a longer interval visibly misses short-lived unreads in an active chat.
 */
const POLL_MS: Record<UnreadStrategy, number> = {
  'whatsapp-idb': 6000,
  'matrix-idb': 6000,
  'title-count': 6000,
  none: 30000,
}

let db: IDBDatabase | null = null
let strategy: UnreadStrategy = 'none'
/** Until main tells us, 'none' is "not yet known", not "nothing to report". */
let strategyKnown = false
let onStrategyChange: (() => void) | null = null

/** Set by main once it knows which service this view is hosting. */
export function setUnreadStrategy(next: UnreadStrategy): void {
  const firstTime = !strategyKnown
  strategyKnown = true
  if (next === strategy) {
    if (firstTime) onStrategyChange?.()
    return
  }
  strategy = next
  // A handle opened for the previous strategy points at the wrong database.
  if (db) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
  db = null
  onStrategyChange?.()
}

/**
 * Leading "(3)" in the document title — what Discord, Slack, Messenger,
 * Telegram and most web chat apps use.
 *
 * Deliberately anchored. A loose /(\d+)/ over the whole title is how the
 * closest prior art ends up reading a group called "2024 Planning" as 2024
 * unread messages.
 */
const TITLE_COUNT = /^\s*\((\d+)\)/
/** A leading dot/asterisk means "activity, no count" in several of these apps. */
const TITLE_MARKER = /^\s*[•*]/

export function readTitleCount(): UnreadReport {
  const title = typeof document === 'undefined' ? '' : document.title || ''
  const m = TITLE_COUNT.exec(title)
  if (m) {
    const n = Number(m[1])
    return {
      status: 'ok',
      direct: Number.isFinite(n) && n > 0 ? Math.min(n, 99999) : 0,
      muted: 0,
      markedUnread: 0,
    }
  }
  if (TITLE_MARKER.test(title)) {
    return { status: 'ok', direct: 0, muted: 0, markedUnread: 1 }
  }
  return { status: 'ok', direct: 0, muted: 0, markedUnread: 0 }
}

interface ChatRow {
  unreadCount?: unknown
  archive?: unknown
  muteExpiration?: unknown
  isAutoMuted?: unknown
}

/**
 * indexedDB.open() CREATES the database when absent, which would plant an empty
 * store in the site's origin. Always resolve an existing name first.
 */
async function findDatabase(match: string | RegExp): Promise<string | null> {
  try {
    const list = await indexedDB.databases()
    for (const entry of list) {
      const name = entry.name
      if (!name) continue
      if (typeof match === 'string' ? name === match : match.test(name)) return name
    }
    return null
  } catch {
    return null
  }
}

function openDatabase(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(name)
    } catch {
      return resolve(null)
    }
    req.onsuccess = () => {
      const opened = req.result
      // WhatsApp deletes and upgrades this database; hold the handle loosely or
      // we block its migrations and go stale.
      opened.onversionchange = () => {
        try {
          opened.close()
        } catch {
          /* ignore */
        }
        if (db === opened) db = null
      }
      opened.onclose = () => {
        if (db === opened) db = null
      }
      resolve(opened)
    }
    req.onerror = () => resolve(null)
    // Opening versionless from a second context can block WhatsApp's own
    // upgrade. Back off rather than hold it up.
    req.onblocked = () => resolve(null)
  })
}

function readAll<T>(handle: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = handle.transaction(store, 'readonly')
    } catch (err) {
      return reject(err)
    }
    // NB: the Matrix sync store has a COMPOUND keyPath (['clobber']), so its key
    // is an array — get('-') silently returns nothing. getAll() sidesteps that.
    const req = tx.objectStore(store).getAll()
    req.onsuccess = () => resolve((req.result as T[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

interface MatrixRoom {
  unread_notifications?: { notification_count?: unknown; highlight_count?: unknown }
}

interface MatrixSyncRecord {
  roomsData?: { join?: Record<string, MatrixRoom> }
}

/**
 * Sum matrix-js-sdk's per-room notification counts. These are already
 * post-push-rules, so muted rooms do not contribute — no separate mute handling
 * is needed, unlike WhatsApp.
 */
export function computeMatrixCounts(rows: MatrixSyncRecord[]): Omit<UnreadReport, 'status'> {
  let direct = 0
  for (const row of rows) {
    const join = row?.roomsData?.join
    if (!join) continue
    for (const room of Object.values(join)) {
      const n = Number(room?.unread_notifications?.notification_count)
      if (Number.isFinite(n) && n > 0) direct += n
    }
  }
  return { direct: Math.min(direct, 99999), muted: 0, markedUnread: 0 }
}

export function computeCounts(rows: ChatRow[]): Omit<UnreadReport, 'status'> {
  let direct = 0
  let muted = 0
  let markedUnread = 0

  for (const chat of rows) {
    if (chat.archive) continue

    const n = Number(chat.unreadCount)
    if (!Number.isFinite(n) || n === 0) continue

    // A negative unreadCount is WhatsApp's "manually marked as unread" sentinel:
    // real attention needed, but no message count to show.
    if (n < 0) {
      markedUnread += 1
      continue
    }

    const isMuted =
      (chat.muteExpiration != null && Number(chat.muteExpiration) !== 0) ||
      chat.isAutoMuted === true

    if (isMuted) muted += n
    else direct += n
  }

  return { direct, muted, markedUnread }
}

const ABSENT: UnreadReport = { status: 'db-absent', direct: 0, muted: 0, markedUnread: 0 }

async function sample(): Promise<UnreadReport> {
  if (strategy === 'none') return ABSENT
  if (strategy === 'title-count') return readTitleCount()

  const wanted = strategy === 'matrix-idb' ? MATRIX_DB : DB_NAME
  const store = strategy === 'matrix-idb' ? MATRIX_STORE : STORE

  if (!db) {
    const name = await findDatabase(wanted)
    if (!name) return ABSENT
    db = await openDatabase(name)
    if (!db) return ABSENT
  }

  if (!db.objectStoreNames.contains(store)) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    db = null
    return ABSENT
  }

  try {
    if (strategy === 'matrix-idb') {
      const rows = await readAll<MatrixSyncRecord>(db, store)
      return { status: 'ok', ...computeMatrixCounts(rows) }
    }
    return { status: 'ok', ...computeCounts(await readAll<ChatRow>(db, store)) }
  } catch {
    db = null // force re-acquire next tick
    return { status: 'error', direct: 0, muted: 0, markedUnread: 0 }
  }
}

export function startUnreadPolling(
  report: (r: UnreadReport & { strategy: UnreadStrategy }) => void,
): void {
  let last = ''
  const tick = async (): Promise<void> => {
    // Reporting before the strategy is known would publish a zero that is
    // really "don't know yet", and the badge would blink on every navigation.
    if (!strategyKnown) return
    const result = await sample()
    const key = `${strategy}:${result.status}:${result.direct}:${result.muted}:${result.markedUnread}`
    if (key !== last) {
      last = key
      report({ ...result, strategy })
    }
  }

  // Re-read immediately when the strategy arrives, rather than waiting a tick.
  onStrategyChange = () => void tick()

  // A title-derived count should update as soon as the title does; polling
  // alone would lag by up to POLL_MS.
  try {
    const titleEl = document.querySelector('title')
    if (titleEl) {
      new MutationObserver(() => {
        if (strategy === 'title-count') void tick()
      }).observe(titleEl, { childList: true, characterData: true, subtree: true })
    }
  } catch {
    /* observer is an optimisation, not a requirement */
  }

  const loop = (): void => {
    void tick().finally(() => {
      setTimeout(loop, POLL_MS[strategy] ?? 6000)
    })
  }
  loop()
}
