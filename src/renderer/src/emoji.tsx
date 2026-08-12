import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { EmojiEntry } from '../../shared/emoji'
import './emoji.css'

const COLUMNS = 9

function Picker(): React.JSX.Element {
  const categories = window.emoji.categories
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(0)
  const [recents, setRecents] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  const reset = (): void => {
    setQuery('')
    setCategory(0)
    setCursor(0)
    void window.emoji.recents().then(setRecents)
    searchRef.current?.focus()
  }

  useEffect(() => {
    reset()
    return window.emoji.onReset(reset)
  }, [])

  const entries: EmojiEntry[] = useMemo(() => {
    if (query.trim()) return window.emoji.search(query)
    if (category === 0) {
      // Recents first, then the rest of Smileys, so the grid is never empty.
      const recent = recents.map((char) => ({ char, keywords: 'recent' }))
      const rest = categories[0].entries.filter((e) => !recents.includes(e.char))
      return [...recent, ...rest]
    }
    return categories[category].entries
  }, [query, category, recents, categories])

  useEffect(() => setCursor(0), [query, category])

  // Keep the highlighted cell in view while arrowing around.
  useEffect(() => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const choose = (char: string): void => {
    void window.emoji.pick(char)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      window.emoji.close()
      return
    }
    if (entries.length === 0) return

    const move = (delta: number): void => {
      e.preventDefault()
      setCursor((c) => Math.max(0, Math.min(entries.length - 1, c + delta)))
    }
    if (e.key === 'ArrowRight') move(1)
    else if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'ArrowDown') move(COLUMNS)
    else if (e.key === 'ArrowUp') move(-COLUMNS)
    else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = entries[cursor]
      if (entry) choose(entry.char)
    }
  }

  return (
    <div className="picker" onKeyDown={onKeyDown}>
      <input
        ref={searchRef}
        className="search"
        autoFocus
        placeholder="Search emoji…   ↑↓←→ to move, Enter to insert, Esc to close"
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!query.trim() && (
        <div className="cats">
          {categories.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`cat${i === category ? ' active' : ''}`}
              title={c.label}
              onClick={() => setCategory(i)}
              tabIndex={-1}
            >
              {c.entries[0].char}
            </button>
          ))}
        </div>
      )}

      <div className="grid" ref={gridRef}>
        {entries.map((entry, i) => (
          <button
            key={`${entry.char}-${i}`}
            type="button"
            data-index={i}
            className={`cell${i === cursor ? ' cursor' : ''}`}
            title={entry.keywords}
            onClick={() => choose(entry.char)}
            onMouseEnter={() => setCursor(i)}
            tabIndex={-1}
          >
            {entry.char}
          </button>
        ))}
        {entries.length === 0 && <p className="empty">No emoji matches “{query}”.</p>}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Picker />
  </StrictMode>,
)
