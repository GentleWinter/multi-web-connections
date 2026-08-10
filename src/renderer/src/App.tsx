import { useEffect, useState } from 'react'
import { CUSTOM_SERVICE_ID, SERVICES, normalizeCustomUrl } from '../../shared/services'
import {
  DEFAULT_ALERTS,
  EMPTY_UNREAD,
  type AccountRecord,
  type AlertSettings,
  type ShellState,
  type UnreadReport,
} from '../../shared/types'

/**
 * A number for real unread, a plain dot for muted-only or manually-flagged
 * activity, and a distinct marker when we genuinely cannot tell — "unknown"
 * must never render as "caught up".
 */
function Badge({ unread }: { unread: UnreadReport }): React.JSX.Element | null {
  if (unread.status === 'error') {
    return (
      <span className="badge badge-unknown" title="Could not read unread count">
        !
      </span>
    )
  }
  if (unread.status === 'db-absent') return null // not signed in yet — nothing to report

  if (unread.direct > 0) {
    return (
      <span className="badge" title={`${unread.direct} unread`}>
        {unread.direct > 99 ? '99+' : unread.direct}
      </span>
    )
  }
  if (unread.muted > 0 || unread.markedUnread > 0) {
    const why = unread.muted > 0 ? `${unread.muted} unread (muted)` : 'marked unread'
    return <span className="badge badge-dot" title={why} />
  }
  return null
}

/** Inline rename editor. Native prompt() does not work in Electron renderers. */
function RenameField({
  account,
  onDone,
}: {
  account: AccountRecord
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(account.name)
  return (
    <input
      className="tab-rename"
      autoFocus
      value={value}
      title="Enter to save, Escape to cancel"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value)
        else if (e.key === 'Escape') onDone(null)
      }}
      onFocus={(e) => e.currentTarget.select()}
    />
  )
}

/** Choose which web app a new account hosts. */
function ServicePicker({
  onPick,
  onClose,
}: {
  onPick: (serviceId: string, url?: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [customUrl, setCustomUrl] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  // Shared with main, so what the picker accepts and what the handler accepts
  // cannot drift apart.
  const normalized = normalizeCustomUrl(customUrl)
  const customValid = normalized !== null
  const typedSomething = customUrl.trim().length > 0

  return (
    <main className="panel">
      <div className="panel-inner">
        <h1>Add an account</h1>
        <p className="panel-sub">
          Each account gets its own isolated session, so several accounts of the same service
          can be signed in at once.
        </p>

        <div className="service-grid">
          {SERVICES.filter((s) => s.id !== CUSTOM_SERVICE_ID).map((s) => (
            <button key={s.id} type="button" className="service" onClick={() => onPick(s.id)}>
              <span className="service-dot" style={{ background: s.color }} />
              <span className="service-name">{s.name}</span>
              {s.note && <span className="service-note">{s.note}</span>}
            </button>
          ))}

          <button
            type="button"
            className={`service${showCustom ? ' selected' : ''}`}
            onClick={() => setShowCustom((v) => !v)}
          >
            <span className="service-dot" style={{ background: '#8696A0' }} />
            <span className="service-name">Custom URL…</span>
            <span className="service-note">Any web app</span>
          </button>
        </div>

        {showCustom && (
          <label className="field">
            <span className="field-label">
              Address — pinned to that domain and its subdomains
            </span>
            <input
              className="text-input"
              autoFocus
              placeholder="chat.example.com"
              value={customUrl}
              spellCheck={false}
              onChange={(e) => setCustomUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && normalized) onPick(CUSTOM_SERVICE_ID, normalized)
              }}
            />
            {/* A disabled button with no explanation is the worst outcome here. */}
            {typedSomething && !customValid && (
              <span className="field-error">
                That does not look like a web address. Try something like
                <code> chat.example.com</code>.
              </span>
            )}
            {customValid && normalized !== customUrl.trim() && (
              <span className="field-hint">Will open {normalized}</span>
            )}
          </label>
        )}

        <div className="panel-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {showCustom && (
            <button
              type="button"
              className="btn primary"
              disabled={!customValid}
              onClick={() => normalized && onPick(CUSTOM_SERVICE_ID, normalized)}
            >
              Add
            </button>
          )}
        </div>
      </div>
    </main>
  )
}

type Section = 'general' | 'notifications' | 'accounts' | 'about'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'about', label: 'About' },
]

/**
 * All settings in one place. Shown full-window: account views paint above the
 * DOM, so main hides them while this is open and restores them on close.
 *
 * Adding a setting means adding a row to one of these sections — the surfaces
 * that used to carry them (gear menu, tab context menu, tray, menu bar) stay as
 * shortcuts, not as the only route.
 */
function SettingsPanel({
  state,
  apply,
  onClose,
}: {
  state: ShellState
  apply: (s: ShellState | null) => void
  onClose: () => void
}): React.JSX.Element {
  const [section, setSection] = useState<Section>('general')
  const [keywords, setKeywords] = useState(state.alerts.keywords.join('\n'))

  const saveAlerts = (patch: Partial<AlertSettings>): void => {
    const next: AlertSettings = {
      enabled: state.alerts.enabled,
      wholeWord: state.alerts.wholeWord,
      keywords: keywords.split('\n').map((k) => k.trim()).filter(Boolean),
      ...patch,
    }
    void window.shell.setAlerts(next).then(apply)
  }

  return (
    <main className="panel settings">
      <nav className="settings-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`settings-navitem${section === s.id ? ' active' : ''}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
        <button type="button" className="btn settings-close" onClick={onClose}>
          Done
        </button>
      </nav>

      <div className="settings-body">
        {section === 'general' && (
          <section>
            <h2>General</h2>
            <label className="row">
              <input
                type="checkbox"
                checked={state.autostart.enabled}
                disabled={!state.autostart.supported}
                onChange={(e) => void window.shell.setAutostart(e.target.checked).then(apply)}
              />
              <span>
                Start at login
                <em>
                  Launches into the tray so it does not steal focus. Accounts still connect and
                  notifications still arrive.
                </em>
              </span>
            </label>
            <p className="note">
              Closing the window hides it to the tray rather than quitting, so accounts stay
              connected. Use <strong>Quit</strong> in the tray menu to exit properly.
            </p>
          </section>
        )}

        {section === 'notifications' && (
          <section>
            <h2>Notifications</h2>

            <h3>Per account</h3>
            <p className="note">
              Turning an account off silences it completely, including priority alerts. Unread
              badges are unaffected.
            </p>
            {state.accounts.length === 0 && <p className="note">No accounts yet.</p>}
            {state.accounts.map((a) => (
              <label className="row" key={a.id}>
                <input
                  type="checkbox"
                  checked={a.notifications !== false}
                  onChange={(e) =>
                    void window.shell.setAccountNotifications(a.id, e.target.checked).then(apply)
                  }
                />
                <span>
                  <span className="swatch" style={{ background: a.color }} />
                  {a.name}
                </span>
              </label>
            ))}

            <h3>Priority alerts</h3>
            <p className="note">
              Messages containing one of these words get a notification that stays on screen until
              dismissed, instead of one that disappears after a few seconds.
            </p>
            <label className="row">
              <input
                type="checkbox"
                checked={state.alerts.enabled}
                onChange={(e) => saveAlerts({ enabled: e.target.checked })}
              />
              <span>Enable priority alerts</span>
            </label>
            <label className="field">
              <span className="field-label">Keywords — one per line, case-insensitive</span>
              <textarea
                rows={6}
                value={keywords}
                spellCheck={false}
                disabled={!state.alerts.enabled}
                placeholder={'urgent\nasap\noutage'}
                onChange={(e) => setKeywords(e.target.value)}
                onBlur={() => saveAlerts({})}
              />
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={state.alerts.wholeWord}
                disabled={!state.alerts.enabled}
                onChange={(e) => saveAlerts({ wholeWord: e.target.checked })}
              />
              <span>
                Match whole words only
                <em>“urgent” will not fire on “insurgent”.</em>
              </span>
            </label>
          </section>
        )}

        {section === 'accounts' && (
          <section>
            <h2>Accounts</h2>
            <p className="note">
              Rename, reload or remove from the tab’s right-click menu. Each account keeps its own
              isolated session.
            </p>
            {state.accounts.map((a) => {
              const u = state.unread[a.id]
              return (
                <div className="acct" key={a.id}>
                  <span className="swatch" style={{ background: a.color }} />
                  <span className="acct-name">{a.name}</span>
                  <span className="acct-meta">
                    {a.serviceId}
                    {u && u.status === 'ok' && u.direct > 0 ? ` · ${u.direct} unread` : ''}
                    {u && u.status === 'error' ? ' · count unavailable' : ''}
                  </span>
                </div>
              )
            })}
          </section>
        )}

        {section === 'about' && (
          <section>
            <h2>About</h2>
            <dl className="about">
              <dt>Version</dt>
              <dd>{state.app.version}</dd>
              <dt>Electron</dt>
              <dd>{state.app.electron}</dd>
              <dt>Chromium</dt>
              <dd>{state.app.chrome}</dd>
              <dt>Config</dt>
              <dd className="mono">{state.app.configDir}</dd>
              <dt>Desktop entry</dt>
              <dd className="mono">
                {state.app.desktopEntry ?? 'not installed — run npm run desktop:install'}
              </dd>
            </dl>
          </section>
        )}
      </div>
    </main>
  )
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<ShellState>({
    accounts: [],
    activeAccountId: null,
    unread: {},
    alerts: DEFAULT_ALERTS,
    autostart: { supported: false, enabled: false },
    app: { version: '', electron: '', chrome: '', configDir: '', desktopEntry: null },
  })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const apply = (result: ShellState | null): void => {
    if (result) setState(result)
  }

  const confirmRemove = (account: AccountRecord): void => {
    const ok = window.confirm(
      `Remove "${account.name}"?\n\nThis signs the account out and deletes its local data. Other accounts are unaffected.`,
    )
    if (ok) void window.shell.removeAccount(account.id).then(apply)
  }

  useEffect(() => {
    void window.shell.getState().then((s) => s && setState(s))
    const offState = window.shell.onState(setState)
    const offRename = window.shell.onBeginRename((id) => setRenamingId(id))
    const offAlerts = window.shell.onOpenAlerts(() => setAlertsOpen(true))
    const offPicker = window.shell.onOpenServicePicker(() => setPickerOpen(true))
    const offRemove = window.shell.onConfirmRemove((id) => {
      const account = state.accounts.find((a) => a.id === id)
      if (account) confirmRemove(account)
    })
    return () => {
      offState()
      offRename()
      offRemove()
      offAlerts()
      offPicker()
    }
    // state.accounts is read inside onConfirmRemove, so the listener is rebound
    // when the account list changes.
  }, [state.accounts])

  // Must ask main to hide the account views first, or the picker renders behind
  // them and the button looks dead.
  const onAdd = (): void => {
    void window.shell.openPanel().then((s) => {
      apply(s)
      setPickerOpen(true)
    })
  }

  const closePanels = (): void => {
    setPickerOpen(false)
    setAlertsOpen(false)
  }

  const addService = (serviceId: string, url?: string): void => {
    setPickerOpen(false)
    void window.shell.addAccount({ serviceId, url }).then(apply)
  }

  const finishRename = (account: AccountRecord, name: string | null): void => {
    setRenamingId(null)
    if (name !== null && name.trim() && name !== account.name) {
      void window.shell.renameAccount(account.id, name.trim()).then(apply)
    }
  }

  return (
    <div className="app">
      <nav className="tabbar">
        {state.accounts.map((account) =>
          renamingId === account.id ? (
            <RenameField
              key={account.id}
              account={account}
              onDone={(name) => finishRename(account, name)}
            />
          ) : (
            <button
              key={account.id}
              type="button"
              className={`tab${account.id === state.activeAccountId ? ' active' : ''}`}
              title={`${account.name}\nDouble-click to rename · Right-click for options`}
              onClick={() => {
                closePanels()
                void window.shell.activateAccount(account.id).then(apply)
              }}
              onDoubleClick={() => setRenamingId(account.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                void window.shell.tabMenu(account.id)
              }}
            >
              <span className="tab-dot" style={{ background: account.color }} />
              <span className="tab-name">{account.name}</span>
              <Badge unread={state.unread[account.id] ?? EMPTY_UNREAD} />
            </button>
          ),
        )}

        <button type="button" className="tab-add" title="Add account" onClick={onAdd}>
          +
        </button>

        <button
          type="button"
          className="tab-settings"
          title="Settings"
          onClick={() =>
            void window.shell.openSettings().then((s) => {
              apply(s)
              setAlertsOpen(true)
            })
          }
        >
          <span className="gear" aria-hidden="true">
            ⚙
          </span>
          <span className="label">Settings</span>
        </button>
      </nav>

      {pickerOpen && (
        <ServicePicker
          onPick={addService}
          onClose={() => {
            setPickerOpen(false)
            void window.shell.closePanel().then(apply)
          }}
        />
      )}

      {alertsOpen && (
        <SettingsPanel
          state={state}
          apply={apply}
          onClose={() => {
            setAlertsOpen(false)
            void window.shell.closePanel().then(apply)
          }}
        />
      )}

      {!alertsOpen && !pickerOpen && state.accounts.length === 0 && (
        <main className="empty">
          <div>
            <h1>No accounts yet</h1>
            <p>Press + to add one — WhatsApp, Discord, Slack, Messenger, or any URL.</p>
          </div>
        </main>
      )}
    </div>
  )
}
