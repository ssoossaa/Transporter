import { Copy, Download, Music } from 'lucide-react'
import { SlideText } from '@/components/results/slide-text'
import { Button } from '@/components/ui/button'
import { copyText, fileUrl } from '@/lib/format'

export function CarouselResult({ job }) {
  const { result } = job
  // Jobs from before the OCR step have no `text` on their slides.
  const hasOcr = result.slides.some((s) => s.text !== undefined)
  const slides = result.slides.map((s, i) => ({ ...s, n: i + 1 }))
  const texts = slides.filter((s) => s.text)

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={fileUrl(job, result.files.zip, true)}>
            <Download />
            Télécharger le .zip ({result.slides.length} slides)
          </a>
        </Button>
        {result.files.audio && (
          <Button variant="outline" asChild>
            <a href={fileUrl(job, result.files.audio, true)}>
              <Music />
              Son (.mp3)
            </a>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {slides.map((s) => (
          <a
            key={s.path}
            href={fileUrl(job, s, true)}
            title={`Télécharger la slide ${s.n}`}
            className="group relative block aspect-[3/4] overflow-hidden rounded-lg bg-secondary"
          >
            <img
              src={fileUrl(job, s)}
              alt={`Slide ${s.n}`}
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
            <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold">{s.n}</span>
          </a>
        ))}
      </div>

      {hasOcr && (
        <div className="rounded-xl border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3 pl-4">
            <h3 className="text-sm font-semibold">Texte des slides</h3>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => copyText(texts.map((s) => s.text).join('\n\n'), 'Texte copié')}
                disabled={!texts.length}
              >
                <Copy />
                Copier le texte
              </Button>
              {result.files.text && (
                <Button size="sm" variant="outline" asChild>
                  <a href={fileUrl(job, result.files.text, true)}>.txt</a>
                </Button>
              )}
            </div>
          </div>
          <div className="p-4">
            {texts.length ? (
              <SlideText slides={texts} />
            ) : (
              <p className="text-sm text-muted-foreground">Aucun texte détecté sur les slides.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
