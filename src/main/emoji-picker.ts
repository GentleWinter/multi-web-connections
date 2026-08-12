import { join } from 'node:path'
import { BrowserWindow, type WebContents } from 'electron'

/**
 * Ctrl+. emoji picker.
 *
 * A small frameless window rather than UI injected into the page: these are
 * third-party sites we do not control, and an overlay would have to survive
 * their DOM and re-render cycles. The window sits above the app, and the chosen
 * character goes back into whichever WebContents had focus via insertText() —
 * verified to land correctly in WhatsApp's React-controlled composer, which is
 * the case most likely to reject a synthetic insertion.
 */
const WIDTH = 360
const HEIGHT = 332

let picker: BrowserWindow | null = null
/** Where the emoji goes when one is chosen. */
let target: WebContents | null = null

function create(parent: BrowserWindow): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    parent,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#111b21',
    webPreferences: {
      preload: join(__dirname, '../preload/emoji.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void win.loadURL(`${rendererUrl}/emoji.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/emoji.html'))
  }

  // Losing focus is the natural dismiss for a popup.
  win.on('blur', () => hideEmojiPicker())
  win.on('closed', () => {
    picker = null
    target = null
  })

  return win
}

/** Centre horizontally over the parent, sitting above the compose area. */
function position(parent: BrowserWindow, win: BrowserWindow): void {
  const bounds = parent.getBounds()
  const x = Math.round(bounds.x + (bounds.width - WIDTH) / 2)
  const y = Math.round(bounds.y + bounds.height - HEIGHT - 96)
  win.setBounds({
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: WIDTH,
    height: HEIGHT,
  })
}

export function toggleEmojiPicker(parent: BrowserWindow, from: WebContents): void {
  const visible = !!picker && !picker.isDestroyed() && picker.isVisible()
  if (visible) {
    hideEmojiPicker()
    return
  }
  if (!picker || picker.isDestroyed()) picker = create(parent)

  target = from
  position(parent, picker)
  // The window is reused, so it would otherwise reopen showing the previous
  // search and scroll position.
  picker.webContents.send('emoji:reset')
  picker.show()
  picker.focus()
}

export function hideEmojiPicker(): void {
  if (picker && !picker.isDestroyed() && picker.isVisible()) picker.hide()
  // target is deliberately kept: hide() fires blur, and a click on an emoji
  // hides the window before the selection IPC arrives.
}

/**
 * @returns true if the character was delivered somewhere.
 */
export function insertEmoji(char: string): boolean {
  if (!target || target.isDestroyed()) return false
  target.focus()
  target.insertText(char)
  return true
}

export function destroyEmojiPicker(): void {
  if (picker && !picker.isDestroyed()) picker.destroy()
  picker = null
  target = null
}
