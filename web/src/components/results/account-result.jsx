import { Copy, Download, ScanText, TextQuote, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { copyText, countFormat, dateFormat, fileUrl, plural } from '@/lib/format'

export function AccountResult({ job, onOpen, onExtractText }) {
  const { result } = job
  // Lists made before posts had a type: assume any of them may be a carousel.
  const carousels = result.posts.filter((p) => p.type !== 'video').length
  const videos = result.posts.length - carousels

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => copyText(result.posts.map((p) => p.url).join('\n'), `${plural(result.posts.length, 'URL')} copiées`)}>
          <Copy />
          Copier les {result.posts.length} URLs
        </Button>
        <Button variant="outline" asChild>
          <a href={fileUrl(job, result.files.txt, true)}>.txt</a>
        </Button>
        <Button variant="outline" asChild>
          <a href={fileUrl(job, result.files.csv, true)}>.csv</a>
        </Button>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {carousels > 0 && videos > 0 && (
            <Button variant="outline" onClick={() => onExtractText('carousels')}>
              <ScanText />
              Texte des {plural(carousels, 'carrousel')}
            </Button>
          )}
          <Button variant="outline" onClick={() => onExtractText('all')}>
            <TextQuote />
            {videos && carousels ? 'Texte de tous les posts' : videos ? `Transcrire les ${plural(videos, 'vidéo')}` : `Texte des ${plural(carousels, 'carrousel')}`}
          </Button>
        </div>
      </div>
      {result.partial && (
        <Alert>
          <TriangleAlert />
          <AlertDescription>TikTok a interrompu la liste : certains posts plus anciens peuvent manquer.</AlertDescription>
        </Alert>
      )}
      <PostList>
        {result.posts.map((p) => (
          <PostRow
            key={p.id}
            title={p.description || <span className="text-muted-foreground">Sans description</span>}
            href={p.url}
            meta={[p.date && dateFormat.format(new Date(p.date)), p.views != null && `${countFormat.format(p.views)} vues`]}
            badge={p.type && (p.type === 'carousel' ? 'Carrousel' : 'Vidéo')}
            onOpen={() => onOpen(p.url)}
          />
        ))}
      </PostList>
    </div>
  )
}

export function PostList({ children }) {
  return <ol className="divide-y overflow-hidden rounded-xl border bg-background">{children}</ol>
}

export function PostRow({ thumb, placeholder, title, href, meta, badge, onOpen, children }) {
  return (
    <li className="p-3 sm:px-4">
      <div className="flex items-center gap-3 sm:gap-4">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className="h-14 w-11 flex-none rounded-md bg-secondary object-cover" />
        ) : (
          placeholder && <div className="grid h-14 w-11 flex-none place-items-center rounded-md bg-secondary">{placeholder}</div>
        )}
        <div className="grid min-w-0 flex-1 gap-1">
          <a href={href} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:underline sm:text-[15px]">
            {title}
          </a>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {badge && (
              <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
                {badge}
              </Badge>
            )}
            {meta.filter(Boolean).join(' · ')}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={onOpen} aria-label="Récupérer ce post">
          <Download />
          <span className="max-sm:hidden">Récupérer</span>
        </Button>
      </div>
      {children}
    </li>
  )
}
