import { useEffect, useState } from 'react'
import { ClipboardPaste, Loader2, Sparkles } from 'lucide-react'
import { ACTIONS, KIND_LABELS } from '@/components/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'

const LOOKS_LIKE_TIKTOK = /tiktok\.com\/\S/i
const INSPECT_DELAY_MS = 350

// The link field, plus a menu of what can be done with the link once the server
// has recognised it (account, video or carousel).
export function LinkForm({ url, onUrlChange, onStart, busy, error }) {
  // Only links the user types or pastes are inspected, not the one of a reloaded job.
  const [query, setQuery] = useState(null)
  const [inspect, setInspect] = useState({ status: 'idle' })
  const [action, setAction] = useState(null)

  useEffect(() => {
    if (!query || !LOOKS_LIKE_TIKTOK.test(query)) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setInspect({ status: 'loading' })
      try {
        const res = await fetch(`/api/inspect?url=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
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

  function submit(e) {
    e.preventDefault()
    if (!url.trim() || busy) return
    onStart(url.trim(), inspect.status === 'ready' ? action : null)
    setQuery(null)
    setInspect({ status: 'idle' })
  }

  const menu = inspect.status === 'ready' ? inspect.data : null

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-2xl text-left">
      <div className="flex flex-col gap-2 rounded-2xl border bg-card p-2 shadow-2xl shadow-black/50 transition-shadow focus-within:ring-4 focus-within:ring-cyan/10 sm:flex-row sm:rounded-full">
        <Input
          type="url"
          inputMode="url"
          placeholder="Lien d'une vidéo, d'un carrousel ou d'un compte TikTok"
          value={url}
          onChange={(e) => change(e.target.value)}
          disabled={busy}
          autoFocus
          aria-label="Lien TikTok"
          className="h-11 border-0 bg-transparent px-4 text-base shadow-none focus-visible:ring-0 md:text-base dark:bg-transparent"
        />
        <div className="flex gap-2">
          {!url && !busy && (
            <Button type="button" variant="outline" size="lg" className="flex-1 rounded-full" onClick={paste}>
              <ClipboardPaste />
              Coller
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1 rounded-full px-6" disabled={!url.trim() || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? 'En cours…' : 'Lancer'}
          </Button>
        </div>
      </div>

      {inspect.status === 'loading' && (
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Analyse du lien…
        </p>
      )}
      {inspect.status === 'error' && <p className="mt-3 text-center text-sm text-destructive">{inspect.error}</p>}
      {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}

      {menu && !busy && (
        <div className="mt-4 animate-in fade-in-0 slide-in-from-top-2 duration-300">
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-sm">
            <Badge variant="secondary">{KIND_LABELS[menu.kind]}</Badge>
            <span className="font-medium">@{menu.author}</span>
            {menu.slides && <span className="text-muted-foreground">· {menu.slides} slides</span>}
          </div>
          <RadioGroup
            value={action}
            onValueChange={setAction}
            // Enter on an option launches, like it does in the field.
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.closest('form').requestSubmit()}
            className={cn('grid gap-2', menu.actions.length > 1 && 'sm:grid-cols-2')}
            aria-label="Que veux-tu récupérer ?"
          >
            {menu.actions.map((key) => {
              const { icon: Icon, title, description } = ACTIONS[key]
              return (
                <Label
                  key={key}
                  htmlFor={`action-${key}`}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 font-normal transition-colors hover:bg-accent/50 has-[[data-state=checked]]:border-cyan/50 has-[[data-state=checked]]:bg-cyan/5"
                >
                  <RadioGroupItem id={`action-${key}`} value={key} className="mt-0.5" />
                  <div className="grid gap-1">
                    <span className="flex items-center gap-2 font-medium">
                      <Icon className="size-4 text-cyan" />
                      {title}
                    </span>
                    <span className="text-sm leading-snug text-muted-foreground">{description}</span>
                  </div>
                </Label>
              )
            })}
          </RadioGroup>
        </div>
      )}
    </form>
  )
}
