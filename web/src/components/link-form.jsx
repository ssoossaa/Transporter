import { useEffect, useRef, useState } from 'react'
import { ClipboardPaste, FileUp, Loader2, Sparkles } from 'lucide-react'
import { ACTIONS, KIND_LABELS } from '@/components/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'

const TIKTOK_URL = /https?:\/\/(?:[a-z0-9-]+\.)*tiktok\.com\/[^\s,;"'<>]+/gi
const INSPECT_DELAY_MS = 350
const MAX_ROWS = 6

// Every TikTok link in a pasted text or file (e.g. an account's posts.csv), once each.
function extractUrls(text) {
  return [...new Set(text.match(TIKTOK_URL) || [])]
}

// The link field, plus a menu of what can be done with what was pasted: one link
// once the server has recognised it (account, video or carousel), or a list of links.
export function LinkForm({ url, onUrlChange, onStart, onStartBatch, busy, error }) {
  // Only what the user types, pastes or imports is analysed, not the link of a reloaded job.
  const [query, setQuery] = useState(null)
  const [inspect, setInspect] = useState({ status: 'idle' })
  const [action, setAction] = useState(null)
  const fileRef = useRef(null)

  const urls = extractUrls(url)
  const isBatch = urls.length > 1
  // The menus only show for what was just typed, pasted or imported.
  const edited = query != null

  useEffect(() => {
    const found = query == null ? [] : extractUrls(query)
    if (found.length !== 1) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setInspect({ status: 'loading' })
      try {
        const res = await fetch(`/api/inspect?url=${encodeURIComponent(found[0])}`, { signal: controller.signal })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setInspect({ status: 'ready', data })
        setAction(data.actions[0])
      } catch (err) {
        if (err.name !== 'AbortError') setInspect({ status: 'error', error: err.message })
      }
    }, INSPECT_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  function change(value) {
    onUrlChange(value)
    setQuery(value)
    setInspect({ status: 'idle' })
  }

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (text) change(text)
    } catch {
      // Clipboard permission denied; the user can paste manually.
    }
  }

  async function importFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const found = extractUrls(await file.text())
    change(found.length ? found.join('\n') : '')
  }

  function submit(e) {
    e?.preventDefault()
    if (!url.trim() || busy) return
    if (isBatch) onStartBatch(urls)
    else onStart(urls[0] || url.trim(), inspect.status === 'ready' ? action : null)
    setQuery(null)
    setInspect({ status: 'idle' })
  }

  const menu = edited && !busy && !isBatch && inspect.status === 'ready' ? inspect.data : null
  const lines = url.split('\n').length
  const multiline = lines > 1

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-2xl text-left">
      <div
        className={cn(
          'flex flex-col gap-2 rounded-2xl border bg-card p-2 shadow-2xl shadow-black/50 transition-shadow focus-within:ring-4 focus-within:ring-cyan/10 sm:flex-row',
          multiline ? 'sm:items-end' : 'sm:items-center sm:rounded-full',
        )}
      >
        <textarea
          rows={Math.min(lines, MAX_ROWS)}
          // One link per line, never wrapped: long links scroll sideways like in a field.
          wrap="off"
          placeholder="Un ou plusieurs liens TikTok"
          value={url}
          onChange={(e) => change(e.target.value)}
          // Enter launches; Shift+Enter adds a line, for typing a list by hand.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
          }}
          disabled={busy}
          autoFocus
          spellCheck={false}
          aria-label="Lien TikTok, ou plusieurs liens un par ligne"
          className="min-h-11 w-full min-w-0 flex-1 resize-none overflow-x-auto bg-transparent px-4 py-2.5 text-base leading-6 [scrollbar-width:none] outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <div className="flex gap-2">
          {!url && !busy && (
            <>
              <Button type="button" variant="outline" size="lg" className="flex-1 rounded-full" onClick={paste}>
                <ClipboardPaste />
                Coller
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="flex-1 rounded-full"
                onClick={() => fileRef.current?.click()}
                title="Importer une liste de liens (.txt, .csv)"
              >
                <FileUp />
                Importer
              </Button>
              <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" hidden onChange={importFile} />
            </>
          )}
          <Button type="submit" size="lg" className="flex-1 rounded-full px-6" disabled={!url.trim() || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? 'En cours…' : 'Lancer'}
          </Button>
        </div>
      </div>

      {inspect.status === 'loading' && !isBatch && (
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Analyse du lien…
        </p>
      )}
      {inspect.status === 'error' && !isBatch && <p className="mt-3 text-center text-sm text-destructive">{inspect.error}</p>}
      {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}

      {edited && isBatch && !busy && (
        <ActionMenu
          badge="Lot"
          title={plural(urls.length, 'lien')}
          actions={['batch']}
          value="batch"
        />
      )}
      {menu && (
        <ActionMenu
          badge={KIND_LABELS[menu.kind]}
          title={`@${menu.author}`}
          detail={menu.slides && plural(menu.slides, 'slide')}
          actions={menu.actions}
          value={action}
          onChange={setAction}
        />
      )}
    </form>
  )
}

function ActionMenu({ badge, title, detail, actions, value, onChange }) {
  return (
    <div className="mt-4 animate-in fade-in-0 slide-in-from-top-2 duration-300">
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-sm">
        <Badge variant="secondary">{badge}</Badge>
        <span className="font-medium">{title}</span>
        {detail && <span className="text-muted-foreground">· {detail}</span>}
      </div>
      <RadioGroup
        value={value}
        onValueChange={onChange}
        // Enter on an option launches, like it does in the field.
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.closest('form').requestSubmit()}
        className={cn('grid gap-2', actions.length === 2 && 'sm:grid-cols-2', actions.length > 2 && 'sm:grid-cols-3')}
        aria-label="Que veux-tu récupérer ?"
      >
        {actions.map((key) => {
          const { icon: Icon, title: label, description } = ACTIONS[key]
          return (
            <Label
              key={key}
              htmlFor={`action-${key}`}
              className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 font-normal transition-colors hover:bg-accent/50 has-[[data-state=checked]]:border-cyan/50 has-[[data-state=checked]]:bg-cyan/5"
            >
              <RadioGroupItem id={`action-${key}`} value={key} className="mt-0.5" />
              <div className="grid gap-1">
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="size-4 shrink-0 text-cyan" />
                  {label}
                </span>
                <span className="text-sm leading-snug text-muted-foreground">{description}</span>
              </div>
            </Label>
          )
        })}
      </RadioGroup>
    </div>
  )
}
