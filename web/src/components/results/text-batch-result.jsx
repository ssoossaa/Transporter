import { ChevronRight, Copy, Film, Info, RotateCcw, TriangleAlert } from 'lucide-react'
import { PostList, PostRow } from '@/components/results/account-result'
import { SlideText } from '@/components/results/slide-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyText, countFormat, dateFormat, fileUrl, plural } from '@/lib/format'

const EXPORTS = [
  { key: 'csv', label: '.csv', hint: 'Tableur : une ligne par post, une colonne par slide' },
  { key: 'json', label: '.json', hint: 'Données structurées (avec les horodatages), pour un script ou un outil' },
  { key: 'md', label: '.md', hint: 'Lisible, à coller dans un assistant IA' },
]

// Batches made before videos were supported only had carousels, under `carousels`.
function itemsOf(result) {
  return result.items || result.carousels.map((c) => ({ ...c, type: 'carousel', text: c.slides.map((s) => s.text).filter(Boolean).join('\n\n') }))
}

function titleOf(item) {
  const first = item.type === 'carousel' ? item.slides[0]?.text : item.text
  return first?.split(/\n|(?<=[.!?])\s/)[0] || item.description || 'Sans texte'
}

export function TextBatchResult({ job, onOpen, onRetry }) {
  const { result } = job
  const items = itemsOf(result)
  const videos = items.filter((i) => i.type === 'video').length
  const carousels = items.length - videos

  const copyAll = () =>
    copyText(items.map((i) => `${i.url}\n\n${i.text || ''}`).join('\n\n---\n\n'), `Texte de ${plural(items.length, 'post')} copié`)

  const summary = [
    videos && `${plural(videos, 'vidéo')} transcrite${videos > 1 ? 's' : ''}`,
    carousels && `${plural(carousels, 'carrousel')} lu${carousels > 1 ? 's' : ''}`,
    (result.skipped ?? result.videos) > 0 && `${plural(result.skipped ?? result.videos, 'vidéo')} ignorée${(result.skipped ?? result.videos) > 1 ? 's' : ''}`,
  ].filter(Boolean)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={copyAll} disabled={!items.length}>
          <Copy />
          Copier tout le texte
        </Button>
        {EXPORTS.map((e) => (
          <Tooltip key={e.key}>
            <TooltipTrigger asChild>
              <Button variant="outline" asChild>
                <a href={fileUrl(job, result.files[e.key], true)}>{e.label}</a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{e.hint}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {result.cancelled ? (
        <Alert>
          <Info />
          <AlertTitle>
            Arrêté à {result.read}/{result.total} posts
          </AlertTitle>
          <AlertDescription>
            <p>Les exports contiennent les {plural(items.length, 'post')} lus avant l'arrêt.</p>
            <Button variant="outline" size="sm" className="mt-2 text-foreground" onClick={onRetry}>
              <RotateCcw />
              Tout relancer
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">{summary.join(' · ') || 'Aucun texte lu.'}</p>
      )}

      {result.failed.length > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>
            {plural(result.failed.length, 'lien')} non lu{result.failed.length > 1 ? 's' : ''}
          </AlertTitle>
          <AlertDescription>
            <ul className="grid gap-1 break-all">
              {result.failed.map((f) => (
                <li key={f.url}>
                  <a href={f.url} target="_blank" rel="noreferrer" className="underline">
                    {f.url}
                  </a>{' '}
                  : {f.error}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <PostList>
        {items.map((item) => {
          const thumb = item.type === 'carousel' ? item.slides[0] : item.cover
          return (
            <PostRow
              key={item.id}
              thumb={thumb ? fileUrl(job, thumb) : null}
              placeholder={<Film className="size-4 text-muted-foreground" />}
              title={titleOf(item)}
              href={item.url}
              badge={item.type === 'carousel' ? 'Carrousel' : 'Vidéo'}
              meta={[
                item.date && dateFormat.format(new Date(item.date)),
                item.type === 'carousel' && `${item.slides.length} slides`,
                item.views != null && `${countFormat.format(item.views)} vues`,
              ]}
              onOpen={() => onOpen(item.url)}
            >
              <Collapsible>
                <CollapsibleTrigger className="group mt-2 flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                  {item.type === 'carousel' ? 'Voir le texte' : 'Voir la transcription'}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 pb-1 sm:pl-15">
                  {item.type === 'carousel' ? (
                    <SlideText slides={item.slides} />
                  ) : (
                    <div className="grid gap-2">
                      {item.language && (
                        <Badge variant="outline" className="w-fit">
                          {item.language.toUpperCase()}
                        </Badge>
                      )}
                      <p className="leading-relaxed whitespace-pre-wrap">
                        {item.text || <span className="text-muted-foreground">Aucune parole détectée.</span>}
                      </p>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </PostRow>
          )
        })}
      </PostList>
    </div>
  )
}
