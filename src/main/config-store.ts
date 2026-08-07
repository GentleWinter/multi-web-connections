import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  ACCOUNT_COLORS,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_ALERTS,
  type AccountRecord,
  type AlertSettings,
  type AppConfig,
} from '../shared/types'
import { sanitizeAlerts } from './alerts'
import { SERVICES, serviceById, type ServiceDefinition } from '../shared/services'
import { configPath } from './paths'

/**
 * ~60 lines instead of electron-store: that package (and conf) are ESM-only with
 * no CommonJS entry point, and our main process is CommonJS on purpose so the
 * sandboxed preload keeps working.
 */

const EMPTY: AppConfig = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  accounts: [],
  activeAccountId: null,
  alerts: DEFAULT_ALERTS,
}

let config: AppConfig = { ...EMPTY, accounts: [] }
let writeTimer: NodeJS.Timeout | null = null

/**
 * How the last loadConfig() went. Two things depend on this:
 *  - flushConfig() refuses to write before a successful load, so a process that
 *    exits early (e.g. a second instance losing the single-instance lock) can
 *    never overwrite a real config with the empty default.
 *  - pruneOrphanAccountDirs() refuses to run on 'corrupt', because "no accounts
 *    in config" would otherwise mean "delete every account's session data".
 */
export type LoadStatus = 'loaded' | 'missing' | 'corrupt'
let loadStatus: LoadStatus | null = null

export function getLoadStatus(): LoadStatus | null {
  return loadStatus
}

/** Set by migrate() when the on-disk shape needed upgrading. */
let migrated = false

function migrate(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') return { ...EMPTY, accounts: [] }
  const c = raw as Partial<AppConfig>
  // Only one schema version so far; the switch is here so v2 has an obvious home.
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    accounts: Array.isArray(c.accounts) ? c.accounts.filter(isAccount).map(normalizeAccount) : [],
    activeAccountId: typeof c.activeAccountId === 'string' ? c.activeAccountId : null,
    // Absent in configs written before priority alerts existed.
    alerts: sanitizeAlerts(c.alerts),
  }
}

function isAccount(a: unknown): a is AccountRecord {
  if (!a || typeof a !== 'object') return false
  const r = a as Partial<AccountRecord>
  return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.color === 'string'
}

/**
 * Fill in the service fields added when the app stopped being WhatsApp-only.
 * Configs written before that have logged-in sessions on disk, so they must
 * keep working untouched — an account with no serviceId is a WhatsApp account.
 */
function normalizeAccount(a: AccountRecord): AccountRecord {
  if (!a.serviceId || !a.url || !Array.isArray(a.hosts) || !a.unread) migrated = true
  const whatsapp = SERVICES[0]
  const service = (a.serviceId && serviceById(a.serviceId)) || whatsapp
  const isCustom = a.serviceId === 'custom'
  return {
    ...a,
    serviceId: a.serviceId || whatsapp.id,
    url: typeof a.url === 'string' && a.url ? a.url : service.url,
    hosts:
      Array.isArray(a.hosts) && a.hosts.length > 0
        ? a.hosts.filter((h) => typeof h === 'string')
        : service.hosts,
    unread: a.unread || (isCustom ? 'title-count' : service.unread),
  }
}

export function loadConfig(): AppConfig {
  let raw: string
  try {
    raw = readFileSync(configPath(), 'utf8')
  } catch {
    // Genuinely absent: first run. Safe to treat as empty.
    config = { ...EMPTY, accounts: [], alerts: { ...DEFAULT_ALERTS } }
    loadStatus = 'missing'
    return config
  }

  try {
    migrated = false
    config = migrate(JSON.parse(raw))
    loadStatus = 'loaded'
  } catch (err) {
    // The file exists but we cannot read it. Do NOT present this as "no
    // accounts" — that would invite the pruner to delete every session dir.
    console.error('[config] unreadable, refusing to treat as empty:', err)
    config = { ...EMPTY, accounts: [], alerts: { ...DEFAULT_ALERTS } }
    loadStatus = 'corrupt'
    return config
  }
  // Drop a dangling active id (e.g. config hand-edited, or account dir removed).
  if (config.activeAccountId && !config.accounts.some((a) => a.id === config.activeAccountId)) {
    config.activeAccountId = config.accounts[0]?.id ?? null
  }
  // Persist an upgraded shape once, rather than re-deriving it on every launch
  // and leaving the file looking half-written to anyone who inspects it.
  if (migrated) {
    console.log(`[config] migrated ${config.accounts.length} account(s) to the service schema`)
    saveConfig()
  }
  return config
}

export function getConfig(): AppConfig {
  return config
}

/** Debounced atomic write: tmp file + rename, so a crash mid-write cannot
 *  truncate the real config. */
export function saveConfig(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(flushConfig, 150)
}

export function flushConfig(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  // Never write from a process that never successfully loaded, and never write
  // the empty default over a config we failed to parse.
  if (loadStatus === null || loadStatus === 'corrupt') return
  const target = configPath()
  const tmp = `${target}.${process.pid}.tmp`
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
  renameSync(tmp, target)
}

export interface NewAccountSpec {
  name?: string
  serviceId: string
  url: string
  hosts: string[]
  unread: ServiceDefinition['unread']
  color?: string
}

export function addAccount(spec: NewAccountSpec): AccountRecord {
  const account: AccountRecord = {
    // Lowercase uuid: partition-name escaping bit other projects here, and a
    // lowercase id keeps the on-disk name identical to the id even if we ever
    // fall back to persist: partitions.
    id: randomUUID().toLowerCase(),
    name: (spec.name ?? '').trim() || `Account ${config.accounts.length + 1}`,
    color: spec.color || ACCOUNT_COLORS[config.accounts.length % ACCOUNT_COLORS.length],
    createdAt: new Date().toISOString(),
    serviceId: spec.serviceId,
    url: spec.url,
    hosts: spec.hosts,
    unread: spec.unread,
  }
  config.accounts.push(account)
  if (!config.activeAccountId) config.activeAccountId = account.id
  saveConfig()
  return account
}

export function removeAccount(id: string): AccountRecord | null {
  const i = config.accounts.findIndex((a) => a.id === id)
  if (i === -1) return null
  const [removed] = config.accounts.splice(i, 1)
  if (config.activeAccountId === id) {
    config.activeAccountId = config.accounts[0]?.id ?? null
  }
  saveConfig()
  return removed
}

export function renameAccount(id: string, name: string): boolean {
  const account = config.accounts.find((a) => a.id === id)
  if (!account) return false
  account.name = name.trim() || account.name
  saveConfig()
  return true
}

export function getAlerts(): AlertSettings {
  return config.alerts
}

export function setAlerts(next: unknown): AlertSettings {
  config.alerts = sanitizeAlerts(next)
  saveConfig()
  return config.alerts
}

export function setActiveAccount(id: string | null): void {
  if (id !== null && !config.accounts.some((a) => a.id === id)) return
  config.activeAccountId = id
  saveConfig()
}
