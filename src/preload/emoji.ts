import { contextBridge, ipcRenderer } from 'electron'
import { EMOJI_CATEGORIES, searchEmoji, type EmojiEntry } from '../shared/emoji'

/**
 * Bridge for the emoji picker window. The data is bundled into the preload
 * rather than fetched over IPC — it is static and small, and this keeps the
 * picker able to render the instant it opens.
 */
contextBridge.exposeInMainWorld('emoji', {
  categories: EMOJI_CATEGORIES,
  search: (query: string): EmojiEntry[] => searchEmoji(query),
  recents: (): Promise<string[]> => ipcRenderer.invoke('emoji:recents'),
  pick: (char: string): Promise<boolean> => ipcRenderer.invoke('emoji:pick', char),
  close: (): void => ipcRenderer.send('emoji:close'),
  /** Fires each time the window is reopened, so it can start clean. */
  onReset: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('emoji:reset', handler)
    return () => {
      ipcRenderer.removeListener('emoji:reset', handler)
    }
  },
})
