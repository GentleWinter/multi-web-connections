/**
 * Bundle the modules under test into test/.build/ with `electron` aliased to a
 * stub. They are TypeScript and import Electron, neither of which `node --test`
 * can consume directly.
 */
import { build } from 'esbuild'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT = join(HERE, '.build')

const ENTRIES = [
  'src/main/alerts.ts',
  'src/shared/services.ts',
  'src/main/autostart.ts',
  'src/main/downloads.ts',
  'src/main/unread.ts',
  'src/preload/unread-reader.ts',
]

await build({
  entryPoints: ENTRIES.map((e) => join(ROOT, e)),
  outdir: OUT,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  logLevel: 'error',
  alias: { electron: join(HERE, 'electron-stub.cjs') },
})

console.log(`bundled ${ENTRIES.length} modules -> test/.build/`)
