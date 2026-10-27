import { CircleAlert, CircleCheck, CircleDashed, CircleX, Loader2, RotateCcw, Square } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'

function badgeLabel(job) {
  const { info } = job
  if (job.type === 'carousel') return `Carrousel · ${plural(info.slides, 'slide')}`
  if (job.type === 'account') return info.posts ? `Compte · ${plural(info.posts, 'post')}` : 'Compte'
  if (job.type === 'carousel-text')
    return info.carousels != null ? `Texte des carrousels · ${info.carousels}` : 'Texte des carrousels'
  return 'Vidéo'
}

export function JobPanel({ job, onReset, onCancel, onRetry, children }) {
  const { info } = job
  const running = job.status === 'running'
  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-3 gap-0 py-0 duration-500">
      <div className="flex items-start justify-between gap-4 p-5 sm:p-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          {info ? (
            <>
              <Badge variant="secondary">{badgeLabel(job)}</Badge>
              <a href={info.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                @{info.author}
              </a>
              {info.description && (
                <p className="basis-full text-sm leading-relaxed break-words text-muted-foreground">{info.description}</p>
              )}
            </>
          ) : (
            <Badge variant="secondary">Analyse…</Badge>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {running && job.type === 'carousel-text' && (
            <Button variant="outline" onClick={onCancel} disabled={job.cancelRequested}>
              <Square />
              {job.cancelRequested ? 'Arrêt…' : 'Arrêter'}
            </Button>
          )}
          {!running && (
            <Button variant="outline" onClick={onReset}>
              Nouveau lien
            </Button>
          )}
        </div>
      </div>
      <Separator />
      <CardContent className="p-5 sm:p-6">
        {job.status !== 'done' && <Steps steps={job.steps} />}
        {job.status === 'error' && (
          <Alert variant="destructive" className="mt-5">
            <CircleAlert />
            <AlertTitle>Ça n'a pas marché</AlertTitle>
            <AlertDescription>
              <p>{job.error}</p>
              <Button variant="outline" size="sm" className="mt-2 text-foreground" onClick={onRetry}>
                <RotateCcw />
                Réessayer
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {job.status === 'done' && children}
      </CardContent>
    </Card>
  )
}

const STEP_ICONS = {
  pending: CircleDashed,
  running: Loader2,
  done: CircleCheck,
  error: CircleX,
}

function Steps({ steps }) {
  return (
    <ol className="grid gap-4">
      {steps.map((s) => {
        const Icon = STEP_ICONS[s.status]
        const running = s.status === 'running'
        return (
          <li key={s.key} className="grid grid-cols-[20px_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
            <Icon
              className={cn(
                'size-4',
                s.status === 'pending' && 'text-muted-foreground/50',
                running && 'animate-spin text-cyan',
                s.status === 'error' && 'text-destructive',
              )}
            />
            <span className={cn(s.status === 'pending' ? 'text-muted-foreground' : 'text-foreground', s.status === 'error' && 'text-destructive')}>
              {s.label}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {running && (s.detail || (s.progress != null && `${s.progress}%`))}
            </span>
            {running && (
              <div className="col-start-2 col-end-4">
                {s.progress != null ? (
                  <Progress value={s.progress} className="bar-gradient h-1 bg-secondary" />
                ) : (
                  <div className="h-1 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-linear-to-r from-cyan to-pink" />
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
