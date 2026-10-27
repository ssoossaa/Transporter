import { ChevronRight, Copy, Info, RotateCcw, TriangleAlert } from 'lucide-react'
import { PostList, PostRow } from '@/components/results/account-result'
import { SlideText } from '@/components/results/slide-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyText, countFormat, dateFormat, fileUrl, plural } from '@/lib/format'

const EXPORTS = [
  { key: 'csv', label: '.csv', hint: 'Tableur : une ligne par carrousel, une colonne par slide' },
  { key: 'json', label: '.json', hint: 'Données structurées, pour un script ou un outil' },
  { key: 'md', label: '.md', hint: 'Lisible, à coller dans un assistant IA' },
]

export function CarouselTextResult({ job, onOpen, onStart }) {
  const { result } = job
  const fullText = (c) => c.slides.map((s) => s.text).filter(Boolean).join('\n\n')
  const copyAll = () =>
    copyText(
      result.carousels.map((c) => `${c.url}\n\n${fullText(c)}`).join('\n\n---\n\n'),
      `Texte de ${plural(result.carousels.length, 'carrousel')} copié`,
    )

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={copyAll} disabled={!result.carousels.length}>
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
            Extraction arrêtée à {result.read}/{result.total} posts
          </AlertTitle>
          <AlertDescription>
            <p>Les exports contiennent les {plural(result.carousels.length, 'carrousel')} lus avant l'arrêt.</p>
            <Button variant="outline" size="sm" className="mt-2 text-foreground" onClick={() => onStart(job.info.url, 'carousel-text')}>
              <RotateCcw />
              Tout relancer
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          {[
            `${plural(result.carousels.length, 'carrousel')} lu${result.carousels.length > 1 ? 's' : ''}`,
            result.videos > 0 && `${plural(result.videos, 'vidéo')} ignorée${result.videos > 1 ? 's' : ''}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {result.failed.length > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{plural(result.failed.length, 'post')} non lu{result.failed.length > 1 ? 's' : ''}</AlertTitle>
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
        {result.carousels.map((c) => (
          <PostRow
            key={c.id}
            thumb={fileUrl(job, c.slides[0])}
            title={c.slides[0]?.text?.split('\n')[0] || c.description || 'Sans texte'}
            href={c.url}
            meta={[c.date && dateFormat.format(new Date(c.date)), `${c.slides.length} slides`, c.views != null && `${countFormat.format(c.views)} vues`]}
            onOpen={() => onOpen(c.url)}
          >
            <Collapsible>
              <CollapsibleTrigger className="group mt-2 flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                Voir le texte
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 pb-1 sm:pl-15">
                <SlideText slides={c.slides} />
              </CollapsibleContent>
            </Collapsible>
          </PostRow>
        ))}
      </PostList>
    </div>
  )
}
