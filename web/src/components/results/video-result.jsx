import { useRef } from 'react'
import { Captions, Copy, Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { copyText, fileUrl, formatTime } from '@/lib/format'

export function VideoResult({ job, onStart }) {
  const { result } = job
  const videoRef = useRef(null)
  const transcribed = Boolean(result.files.txt)

  function seek(t) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = t
    v.play()
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <video
          ref={videoRef}
          src={fileUrl(job, result.files.video)}
          controls
          playsInline
          className="aspect-[9/16] max-h-[70vh] w-full rounded-xl bg-black object-contain"
        />
        <Button asChild size="lg">
          <a href={fileUrl(job, result.files.video, true)}>
            <Download />
            Télécharger le MP4
          </a>
        </Button>
      </div>

      {!transcribed ? (
        <div className="flex flex-col items-start justify-center gap-3 rounded-xl border border-dashed p-6">
          <p className="text-sm text-muted-foreground">Tu as demandé la vidéo seule, sans transcription.</p>
          <Button variant="outline" onClick={() => onStart(job.url, 'video')}>
            <Captions />
            Transcrire aussi
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="text" className="flex min-h-0 flex-col gap-0 rounded-xl border bg-background">
          <div className="flex items-center justify-between border-b p-3">
            <TabsList>
              <TabsTrigger value="text">Texte</TabsTrigger>
              <TabsTrigger value="segments">Horodaté</TabsTrigger>
            </TabsList>
            {result.language && <Badge variant="outline">{result.language.toUpperCase()}</Badge>}
          </div>
          <ScrollArea className="h-[56vh]">
            <div className="p-5">
              {!result.text && <p className="text-sm text-muted-foreground">Aucune parole détectée dans cette vidéo.</p>}
              <TabsContent value="text">
                {result.text && <p className="text-base leading-relaxed whitespace-pre-wrap">{result.text}</p>}
              </TabsContent>
              <TabsContent value="segments">
                <ul className="grid gap-2.5">
                  {result.segments.map((s, i) => (
                    <li key={i} className="grid grid-cols-[52px_1fr] gap-3 leading-relaxed">
                      <button
                        className="cursor-pointer self-start pt-0.5 text-left text-sm text-cyan tabular-nums hover:underline"
                        onClick={() => seek(s.start)}
                      >
                        {formatTime(s.start)}
                      </button>
                      <span>{s.text}</span>
                    </li>
                  ))}
                </ul>
              </TabsContent>
            </div>
          </ScrollArea>
          <div className="flex flex-wrap gap-2 border-t p-3">
            <Button onClick={() => copyText(result.text, 'Transcription copiée')} disabled={!result.text}>
              <Copy />
              Copier le texte
            </Button>
            <Button variant="outline" asChild>
              <a href={fileUrl(job, result.files.txt, true)}>.txt</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={fileUrl(job, result.files.srt, true)}>.srt</a>
            </Button>
          </div>
        </Tabs>
      )}
    </div>
  )
}
