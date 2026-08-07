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

/**
 * Priority-alert settings. Shown full-window: account views paint above the DOM,
 * so main hides them while this is open and restores them on close.
 */
function AlertsPanel({
  alerts,
  onSave,
  onClose,
}: {
  alerts: AlertSettings
  onSave: (next: AlertSettings) => void
  onClose: () => void
}): React.JSX.Element {
  const [enabled, setEnabled] = useState(alerts.enabled)
  const [wholeWord, setWholeWord] = useState(alerts.wholeWord)
  const [text, setText] = useState(alerts.keywords.join('\n'))

  const save = (): void => {
    onSave({
      enabled,
      wholeWord,
      keywords: text
        .split('\n')
        .map((k) => k.trim())
        .filter(Boolean),
    })
    onClose()
  }

  const count = text.split('\n').filter((k) => k.trim()).length

  return (
    <main className="panel">
      <div className="panel-inner">
        <h1>Priority alerts</h1>
        <p className="panel-sub">
          Messages containing any of these words get a notification that <strong>stays on
          screen until you dismiss it</strong>, instead of the normal one that disappears after
          a few seconds. Clicking it opens that chat.
        </p>

        <label className="row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enable priority alerts</span>
        </label>

        <label className="field">
          <span className="field-label">Keywords — one per line, case-insensitive</span>
          <textarea
            rows={9}
            value={text}
            spellCheck={false}
            placeholder={'urgent\nasap\noutage\nproduction down'}
            onChange={(e) => setText(e.target.value)}
            disabled={!enabled}
          />
        </label>

        <label className="row">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
            disabled={!enabled}
          />
          <span>
            Match whole words only <em>— “urgent” will not fire on “insurgent”</em>
          </span>
        </label>

        <div className="panel-actions">
          <span className="hint">{count} keyword{count === 1 ? '' : 's'}</span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save}>
            Save
          </button>
        </div>
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
          title="Settings — start at login, version, quit"
          onClick={() => void window.shell.settingsMenu()}
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
        <AlertsPanel
          alerts={state.alerts}
          onSave={(next) => void window.shell.setAlerts(next).then(apply)}
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
