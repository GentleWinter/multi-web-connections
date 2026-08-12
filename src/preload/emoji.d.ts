import type { EmojiCategory, EmojiEntry } from '../shared/emoji'

declare global {
  interface Window {
    emoji: {
      categories: EmojiCategory[]
      search: (query: string) => EmojiEntry[]
      recents: () => Promise<string[]>
      pick: (char: string) => Promise<boolean>
      close: () => void
      onReset: (cb: () => void) => () => void
    }
  }
}

export {}
