import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  WebContentsView,
  app,
  session,
  type BrowserWindow,
  type Session,
  type WebContents,
} from 'electron'
import { attachContextMenu } from './context-menu'
import { TAB_BAR_HEIGHT, type AccountRecord } from '../shared/types'
import { pinNavigation } from './navigation'
import { accountSessionDir } from './paths'
import { hardenSession } from './session-harden'

const ACCOUNT_PRELOAD = join(__dirname, '../preload/account.cjs')

/**
 * One WebContentsView per account, each on its own on-disk session.
 *
 * WebContentsView (not <webview>, not BrowserView): BrowserView is formally
 * deprecated and <webview> carries a standing "we recommend not using this"
 * warning from the Electron team. The cost we accept is manual bounds
 * management and views painting above the HTML shell.
 */
export class AccountViewManager {
  private views = new Map<string, WebContentsView>()
  /** webContents.id -> accountId, so IPC from an account view can be attributed. */
  private wcToAccount = new Map<number, string>()
  private activeId: string | null = null

  /**
   * @param getLabel Prefix applied to that account's notifications. Empty string
   *   means "don't prefix" (the sensible default with a single account).
   */
  /** Set by the IPC layer to push alert rules once a view's preload is live. */
  onViewReady?: (accountId: string) => void

  /** Set by the IPC layer; fires when a page advertises new favicons. */
  onFavicon?: (accountId: string, session: Session, urls: string[]) => void

  /** Set by the IPC layer; fires on the emoji-picker shortcut. */
  onEmojiShortcut?: (contents: WebContents) => void

  constructor(
    private readonly win: BrowserWindow,
    private readonly getLabel: (accountId: string) => string,
  ) {
    // 'resize' alone is not enough. A view created before the window has settled
    // at its final content size keeps those stale bounds until the user happens
    // to resize — which left the page overhanging the bottom of the window.
    // (Listed individually: BrowserWindow.on is overloaded per event name and
    // will not accept a union.)
    const relayout = (): void => this.layout()
    this.win.on('resize', relayout)
    this.win.on('show', relayout)
    this.win.on('restore', relayout)
    this.win.on('maximize', relayout)
    this.win.on('unmaximize', relayout)
    this.win.on('enter-full-screen', relayout)
    this.win.on('leave-full-screen', relayout)
  }

  has(id: string): boolean {
    return this.views.has(id)
  }

  accountIdForWebContentsId(wcId: number): string | null {
    return this.wcToAccount.get(wcId) ?? null
  }

  /** Push the notification prefix into a view's preload. Safe to call often. */
  pushLabel(accountId: string): void {
    const view = this.views.get(accountId)
    if (!view || view.webContents.isDestroyed()) return
    view.webContents.send('wa:set-label', this.getLabel(accountId))
  }

  pushAllLabels(): void {
    for (const id of this.views.keys()) this.pushLabel(id)
  }

  /**
   * Push the priority-alert rules into a view's page. Matching must happen
   * inside the page so it can suppress WhatsApp's own notification before it is
   * shown; by the time main hears about a notification it has already appeared.
   */
  pushAlerts(accountId: string, alerts: unknown): void {
    const view = this.views.get(accountId)
    if (!view || view.webContents.isDestroyed()) return
    view.webContents.send('wa:set-alerts', alerts)
  }

  pushAllAlerts(alerts: unknown): void {
    for (const id of this.views.keys()) this.pushAlerts(id, alerts)
  }

  /**
   * Per-account notification toggle. Enforced inside the page: for ordinary
   * messages the SITE constructs the notification, so main cannot suppress one
   * after the fact — it has to not be created.
   */
  pushNotificationsEnabled(accountId: string, enabled: boolean): void {
    const view = this.views.get(accountId)
    if (!view || view.webContents.isDestroyed()) return
    view.webContents.send('wa:set-notifications', enabled)
  }

  /** Replay a click on the notification main fired for this account. */
  sendPriorityClick(accountId: string, alertId: number): void {
    const view = this.views.get(accountId)
    if (!view || view.webContents.isDestroyed()) return
    view.webContents.send('wa:priority-click', alertId)
  }

  /** Create the view if absent. Idempotent. */
  ensure(account: AccountRecord): WebContentsView {
    const existing = this.views.get(account.id)
    if (existing) return existing

    const dir = accountSessionDir(account.id)
    mkdirSync(dir, { recursive: true })

    // fromPath() rather than fromPartition('persist:…') so the directory name is
    // exactly the account id and deletion is a plain fs.rm.
    const ses = session.fromPath(dir)
    hardenSession(ses, account.hosts)

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        preload: ACCOUNT_PRELOAD,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
        // Background accounts must keep their WebSocket alive and their timers
        // unthrottled — that connection is the only source of notifications.
        // Set at construction; toggling this at runtime desyncs visibility.
        backgroundThrottling: false,
      },
    })

    // WebContentsView defaults to opaque white, which flashes on every switch.
    view.setBackgroundColor('#111b21')

    pinNavigation(view.webContents, account.hosts)

    // Ctrl+. is handled here rather than as a global shortcut: globalShortcut is
    // blocked under Wayland, and this keeps the binding scoped to the app.
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.control && !input.alt && !input.meta && input.key === '.') {
        event.preventDefault()
        this.onEmojiShortcut?.(view.webContents)
      }
    })
    // Embedded content gets no context menu from Electron, so right-click
    // copy/paste and spellcheck suggestions have to be built by hand.
    attachContextMenu(view.webContents, !app.isPackaged)

    const label = `${account.name} (${account.id.slice(0, 8)})`
    view.webContents.on('did-finish-load', () => {
      console.log(`[account] ${label} loaded: "${view.webContents.getTitle()}"`)
    })
    view.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame) console.error(`[account] ${label} FAILED ${code} ${desc} ${url}`)
    })
    // Tabs show the service's real favicon. All advertised sizes are passed on;
    // picking just one loses the icon when that one 404s or is a format we
    // will not take.
    view.webContents.on('page-favicon-updated', (_e, favicons) => {
      if (favicons.length > 0) this.onFavicon?.(account.id, ses, favicons)
    })

    view.webContents.on('render-process-gone', (_e, details) => {
      console.error(`[account] ${label} renderer gone:`, details.reason)
    })

    this.win.contentView.addChildView(view)
    this.views.set(account.id, view)
    this.wcToAccount.set(view.webContents.id, account.id)

    // The preload installs its main-world shim at document-start but cannot know
    // which account it belongs to until we tell it.
    view.webContents.on('dom-ready', () => {
      this.pushLabel(account.id)
      // How to read an unread count is the one genuinely per-service thing.
      view.webContents.send('wa:set-unread-strategy', account.unread)
      view.webContents.send('wa:set-visible', this.activeId === account.id)
      view.webContents.send('wa:set-notifications', account.notifications !== false)
      this.onViewReady?.(account.id)
    })

    // Start hidden; setActive() decides what is on screen.
    view.setVisible(false)
    this.layoutOne(view)

    void view.webContents.loadURL(account.url)
    return view
  }

  /**
   * Show one account and background the rest.
   *
   * Inactive views are DETACHED from the window, not merely setVisible(false).
   * Measured: once a view has been shown, setVisible(false) stops propagating
   * to the page — document.visibilityState stays "visible" forever. Every
   * service then believes it is in the foreground, and any app that gates
   * desktop notifications on document.hidden goes permanently silent.
   * Detaching is what actually marks the WebContents hidden.
   */
  setActive(id: string | null): void {
    this.activeId = id
    for (const [accountId, view] of this.views) {
      const active = accountId === id
      if (active) {
        // addChildView on an existing child reorders it to topmost.
        this.win.contentView.addChildView(view)
        view.setVisible(true)
        this.layoutOne(view)
      } else {
        view.setVisible(false)
        try {
          this.win.contentView.removeChildView(view)
        } catch {
          /* already detached */
        }
      }
      // Electron stops propagating visibility to a view that has been shown
      // once, so the page is told directly.
      if (!view.webContents.isDestroyed()) {
        view.webContents.send('wa:set-visible', active)
      }
    }
  }

  /** The page for an account, for callers that need to act on it directly. */
  webContentsFor(id: string): WebContents | null {
    const view = this.views.get(id)
    return view && !view.webContents.isDestroyed() ? view.webContents : null
  }

  /** Reload an account's page — the usual fix when a web app wedges. */
  reload(id: string): void {
    const view = this.views.get(id)
    if (view && !view.webContents.isDestroyed()) view.webContents.reload()
  }

  getActiveId(): string | null {
    return this.activeId
  }

  /**
   * Full teardown. WebContentsView has no destroy(); removing the child view
   * alone leaves the renderer process alive forever.
   */
  destroy(id: string): void {
    const view = this.views.get(id)
    if (!view) return
    this.views.delete(id)
    if (!view.webContents.isDestroyed()) this.wcToAccount.delete(view.webContents.id)
    try {
      this.win.contentView.removeChildView(view)
    } catch {
      /* window may already be gone */
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
    if (this.activeId === id) this.activeId = null
  }

  destroyAll(): void {
    for (const id of [...this.views.keys()]) this.destroy(id)
  }

  /** Per-account renderer pids, for leak-checking against app.getAppMetrics(). */
  processIds(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [id, view] of this.views) {
      if (!view.webContents.isDestroyed()) out[id] = view.webContents.getOSProcessId()
    }
    return out
  }

  layout(): void {
    for (const view of this.views.values()) this.layoutOne(view)
  }

  private layoutOne(view: WebContentsView): void {
    const [width, height] = this.win.getContentSize()
    // Account views sit below the tab bar, which the shell renderer owns.
    view.setBounds({
      x: 0,
      y: TAB_BAR_HEIGHT,
      width: Math.max(0, width),
      height: Math.max(0, height - TAB_BAR_HEIGHT),
    })
  }
}
