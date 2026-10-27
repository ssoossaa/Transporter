import { useEffect, useState } from 'react'
import { JobPanel } from '@/components/job-panel'
import { LinkForm } from '@/components/link-form'
import { AccountResult } from '@/components/results/account-result'
import { CarouselResult } from '@/components/results/carousel-result'
import { CarouselTextResult } from '@/components/results/carousel-text-result'
import { VideoResult } from '@/components/results/video-result'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const POLL_MS = 800
const HEARTBEAT_MS = 30_000

function readJobFromHash() {
  return new URLSearchParams(location.hash.slice(1)).get('job')
}

export default function App() {
  const [url, setUrl] = useState('')
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const jobId = job?.id
  const running = job?.status === 'running'

  // Tells the server the page is open. Once the tab is closed (or hidden) the pings
  // stop and the server shuts itself down; the next request starts it again.
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === 'visible') fetch('/api/ping').catch(() => {})
    }
    const timer = setInterval(ping, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', ping)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [])

  // Restore the job in the URL on reload, and on Back (e.g. from a post to its account list).
  useEffect(() => {
    const load = () => {
      const id = readJobFromHash()
      if (!id) {
        setJob(null)
        setUrl('')
        return
      }
      fetch(`/api/jobs/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j) return
          setJob(j)
          setUrl(j.url)
        })
        .catch(() => {})
    }
    load()
    window.addEventListener('popstate', load)
    return () => window.removeEventListener('popstate', load)
  }, [])

  useEffect(() => {
    if (!jobId || !running) return
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`)
        if (res.ok) setJob(await res.json())
        // Jobs live in memory until they finish: a restart mid-job loses them.
        else if (res.status === 404)
          setJob((j) => ({
            ...j,
            status: 'error',
            error: 'Le serveur a redémarré pendant le traitement. Relance-le.',
            steps: j.steps.map((st) => (st.status === 'running' ? { ...st, status: 'error' } : st)),
          }))
      } catch {
        // Server briefly unavailable (e.g. dev restart); keep polling.
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [jobId, running])

  // Every way of starting a job ends here. `fromList`: opened from a result
  // (a post of an account, a rerun…), so Back returns to that result.
  async function launch(request, { fromList = false } = {}) {
    if (submitting || running) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await request()
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur inattendue.')
      setJob(data)
      setUrl(data.url)
      history[fromList ? 'pushState' : 'replaceState'](null, '', `#job=${data.id}`)
      if (fromList) window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const start = (target, action = null, options) =>
    launch(
      () =>
        fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, action }),
        }),
      options,
    )

  // Reads the carousels of an account already listed, without listing it again.
  const extractCarouselText = (accountJob) =>
    launch(() => fetch(`/api/jobs/${accountJob.id}/carousel-text`, { method: 'POST' }), { fromList: true })

  async function cancel() {
    const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' })
    if (res.ok) setJob(await res.json())
  }

  function reset() {
    setJob(null)
    setUrl('')
    setError(null)
    history.replaceState(null, '', location.pathname)
  }

  const openPost = (postUrl) => start(postUrl, null, { fromList: true })

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20">
      <section className={cn('relative text-center transition-[padding] duration-500', job ? 'pt-14 pb-8' : 'pt-[16vh] pb-10')}>
        <div className="glow pointer-events-none absolute inset-x-[10%] top-0 -z-10 h-80" aria-hidden />
        <Badge variant="outline" className="mb-5 rounded-full px-3 py-1 font-normal text-muted-foreground">
          TikTok → MP4 · Slides · Transcription · Comptes
        </Badge>
        <h1 className="text-[clamp(40px,7vw,72px)] leading-[1.02] font-bold tracking-[-0.04em]">
          Colle un lien.
          <br />
          <span className="text-gradient">Récupère tout.</span>
        </h1>
        {!job && (
          <p className="mx-auto mt-5 mb-9 max-w-lg text-[17px] leading-relaxed text-muted-foreground">
            Une vidéo, un carrousel ou un compte TikTok : choisis ce que tu veux récupérer. Tout tourne en local sur ta
            machine.
          </p>
        )}
        <div className={cn(job && 'mt-8')}>
          <LinkForm url={url} onUrlChange={setUrl} onStart={start} busy={running || submitting} error={error} />
        </div>
      </section>

      {job && (
        <JobPanel job={job} onReset={reset} onCancel={cancel} onRetry={() => start(job.url, job.action)}>
          {job.type === 'video' && <VideoResult job={job} onStart={start} />}
          {job.type === 'carousel' && <CarouselResult job={job} />}
          {job.type === 'account' && (
            <AccountResult job={job} onOpen={openPost} onExtractText={() => extractCarouselText(job)} />
          )}
          {job.type === 'carousel-text' && (
            <CarouselTextResult job={job} onOpen={openPost} onStart={(u, a) => start(u, a, { fromList: true })} />
          )}
        </JobPanel>
      )}
    </main>
  )
}
