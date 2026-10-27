import { useEffect, useRef, useState } from 'react'

const POLL_MS = 800
const HEARTBEAT_MS = 30_000

function fileUrl(job, file, download = false) {
  return `/files/${job.id}/${file.path}${download ? '?download=1' : ''}`
}

function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

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
      } catch {
        // Server briefly unavailable (e.g. dev restart); keep polling.
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [jobId, running])

  // `fromList`: opened from an account's post list, so Back returns to that list.
  async function start(target, { fromList = false } = {}) {
    if (!target.trim() || submitting || running) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur inattendue.')
      setJob(data)
      setUrl(target)
      history[fromList ? 'pushState' : 'replaceState'](null, '', `#job=${data.id}`)
      if (fromList) window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Batch job built from an account's list; Back returns to that list.
  async function extractCarouselText(accountJob) {
    setError(null)
    try {
      const res = await fetch(`/api/jobs/${accountJob.id}/carousel-text`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur inattendue.')
      setJob(data)
      history.pushState(null, '', `#job=${data.id}`)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err.message)
    }
  }

  async function cancel() {
    const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' })
    if (res.ok) setJob(await res.json())
  }

  function submit(e) {
    e.preventDefault()
    start(url)
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch {
      // Clipboard permission denied; the user can paste manually.
    }
  }

  function reset() {
    setJob(null)
    setUrl('')
    setError(null)
    history.replaceState(null, '', location.pathname)
  }

  return (
    <main className="page">
      <section className={`hero ${job ? 'hero--compact' : ''}`}>
        <div className="glow" aria-hidden />
        <p className="eyebrow">TikTok → MP4 · Slides · Transcription · Comptes</p>
        <h1>
          Colle un lien.
          <br />
          <span className="gradient">Récupère tout.</span>
        </h1>
        <p className="lede">
          La vidéo en MP4 et sa transcription, toutes les slides d'un carrousel en .zip, ou la liste des posts d'un
          compte. Tout tourne en local sur ta machine.
        </p>

        <form className="search" onSubmit={submit}>
          <input
            type="url"
            inputMode="url"
            placeholder="Lien d'une vidéo, d'un carrousel ou d'un compte TikTok"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={running}
            autoFocus
            aria-label="Lien TikTok"
          />
          {!url && !running && (
            <button type="button" className="ghost" onClick={paste}>
              Coller
            </button>
          )}
          <button type="submit" className="primary" disabled={!url.trim() || submitting || running}>
            {running ? 'En cours…' : 'Lancer'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      {job && (
        <section className="panel">
          <JobHeader job={job} onReset={reset} onCancel={cancel} />
          {job.status !== 'done' && <Steps job={job} />}
          {job.status === 'error' && <p className="error">{job.error}</p>}
          {job.status === 'done' && job.type === 'video' && <VideoResult job={job} />}
          {job.status === 'done' && job.type === 'carousel' && <CarouselResult job={job} />}
          {job.status === 'done' && job.type === 'account' && (
            <AccountResult
              job={job}
              onOpen={(postUrl) => start(postUrl, { fromList: true })}
              onExtractText={() => extractCarouselText(job)}
            />
          )}
          {job.status === 'done' && job.type === 'carousel-text' && (
            <CarouselTextResult job={job} onOpen={(postUrl) => start(postUrl, { fromList: true })} />
          )}
        </section>
      )}
    </main>
  )
}

function badgeLabel(job) {
  if (job.type === 'carousel') return `Carrousel · ${job.info.slides} slides`
  if (job.type === 'account') return job.info.posts ? `Compte · ${job.info.posts} posts` : 'Compte'
  if (job.type === 'carousel-text')
    return job.info.carousels != null ? `Texte des carrousels · ${job.info.carousels}` : 'Texte des carrousels'
  return 'Vidéo'
}

function JobHeader({ job, onReset, onCancel }) {
  const info = job.info
  return (
    <header className="job-header">
      <div className="job-meta">
        {info ? (
          <>
            <span className="badge">{badgeLabel(job)}</span>
            <a href={info.url} target="_blank" rel="noreferrer" className="author">
              @{info.author}
            </a>
            {info.description && <p className="desc">{info.description}</p>}
          </>
        ) : (
          <span className="badge">Analyse…</span>
        )}
      </div>
      {job.status !== 'running' && (
        <button className="ghost" onClick={onReset}>
          Nouveau lien
        </button>
      )}
      {job.status === 'running' && job.type === 'carousel-text' && (
        <button className="ghost" onClick={onCancel} disabled={job.cancelRequested}>
          {job.cancelRequested ? 'Arrêt…' : 'Arrêter'}
        </button>
      )}
    </header>
  )
}

function Steps({ job }) {
  return (
    <ol className="steps">
      {job.steps.map((s) => (
        <li key={s.key} className={`step step--${s.status}`}>
          <span className="dot" />
          <span className="step-label">{s.label}</span>
          {s.status === 'running' && (s.detail || s.progress != null) && (
            <span className="pct">{s.detail || `${s.progress}%`}</span>
          )}
          {s.status === 'running' && (
            <span className="bar">
              <span style={{ width: s.progress != null ? `${s.progress}%` : '35%' }} className={s.progress == null ? 'indeterminate' : ''} />
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

function VideoResult({ job }) {
  const { result } = job
  const videoRef = useRef(null)
  const [view, setView] = useState('text')
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(result.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function seek(t) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = t
    v.play()
  }

  return (
    <div className="result">
      <div className="media">
        <video ref={videoRef} src={fileUrl(job, result.files.video)} controls playsInline />
        <a className="primary block" href={fileUrl(job, result.files.video, true)}>
          Télécharger le MP4
        </a>
      </div>

      <div className="transcript">
        <div className="transcript-bar">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={view === 'text'} onClick={() => setView('text')}>
              Texte
            </button>
            <button role="tab" aria-selected={view === 'segments'} onClick={() => setView('segments')}>
              Horodaté
            </button>
          </div>
          {result.language && <span className="lang">{result.language.toUpperCase()}</span>}
        </div>

        <div className="transcript-body">
          {!result.text && <p className="muted">Aucune parole détectée dans cette vidéo.</p>}
          {result.text && view === 'text' && <p className="transcript-text">{result.text}</p>}
          {result.text && view === 'segments' && (
            <ul className="segments">
              {result.segments.map((s, i) => (
                <li key={i}>
                  <button className="ts" onClick={() => seek(s.start)}>
                    {formatTime(s.start)}
                  </button>
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="actions">
          <button className="primary" onClick={copy} disabled={!result.text}>
            {copied ? 'Copié ✓' : 'Copier le texte'}
          </button>
          <a className="ghost" href={fileUrl(job, result.files.txt, true)}>
            .txt
          </a>
          <a className="ghost" href={fileUrl(job, result.files.srt, true)}>
            .srt
          </a>
        </div>
      </div>
    </div>
  )
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
const countFormat = new Intl.NumberFormat('fr-FR', { notation: 'compact' })

function AccountResult({ job, onOpen, onExtractText }) {
  const { result } = job
  const [copied, setCopied] = useState(false)
  // Lists made before posts had a type: assume any of them may be a carousel.
  const carousels = result.posts.filter((p) => p.type !== 'video').length

  async function copyAll() {
    await navigator.clipboard.writeText(result.posts.map((p) => p.url).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="account">
      <div className="actions">
        <button className="primary" onClick={copyAll}>
          {copied ? 'Copié ✓' : `Copier les ${result.posts.length} URLs`}
        </button>
        <a className="ghost" href={fileUrl(job, result.files.txt, true)}>
          .txt
        </a>
        <a className="ghost" href={fileUrl(job, result.files.csv, true)}>
          .csv
        </a>
      </div>
      {carousels > 0 && (
        <div className="callout">
          <div>
            <strong>Texte des carrousels</strong>
            <p className="muted">
              Lit le texte de chaque slide des {carousels} carrousels du compte (environ 1 s par carrousel), à exporter
              en tableur, JSON ou Markdown.
            </p>
          </div>
          <button className="primary" onClick={onExtractText}>
            Extraire le texte
          </button>
        </div>
      )}
      {result.partial && (
        <p className="muted note">TikTok a interrompu la liste : certains posts plus anciens peuvent manquer.</p>
      )}
      <ol className="posts">
        {result.posts.map((p) => (
          <li key={p.id} className="post">
            <div className="post-main">
              <a href={p.url} target="_blank" rel="noreferrer" className="post-desc">
                {p.description || <span className="muted">Sans description</span>}
              </a>
              <span className="post-meta">
                {p.type && `${p.type === 'carousel' ? 'Carrousel' : 'Vidéo'} · `}
                {p.date && dateFormat.format(new Date(p.date))}
                {p.views != null && ` · ${countFormat.format(p.views)} vues`}
              </span>
            </div>
            <button className="ghost small" onClick={() => onOpen(p.url)}>
              Récupérer
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function CarouselResult({ job }) {
  const { result } = job
  const [copied, setCopied] = useState(false)
  // Jobs from before the OCR step have no `text` on their slides.
  const hasOcr = result.slides.some((s) => s.text !== undefined)
  const texts = result.slides.map((s, i) => ({ n: i + 1, text: s.text })).filter((s) => s.text)

  async function copy() {
    await navigator.clipboard.writeText(texts.map((s) => s.text).join('\n\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="carousel">
      <div className="actions">
        <a className="primary" href={fileUrl(job, result.files.zip, true)}>
          Télécharger le .zip ({result.slides.length} slides)
        </a>
        {result.files.audio && (
          <a className="ghost" href={fileUrl(job, result.files.audio, true)}>
            Son (.mp3)
          </a>
        )}
      </div>
      <div className="slides">
        {result.slides.map((s, i) => (
          <a key={s.path} href={fileUrl(job, s, true)} className="slide" title={`Télécharger la slide ${i + 1}`}>
            <img src={fileUrl(job, s)} alt={`Slide ${i + 1}`} loading="lazy" />
            <span>{i + 1}</span>
          </a>
        ))}
      </div>

      {hasOcr && (
        <div className="transcript slide-text">
          <div className="transcript-bar">
            <span className="slide-text-title">Texte des slides</span>
          </div>
          <div className="transcript-body">
            {!texts.length && <p className="muted">Aucun texte détecté sur les slides.</p>}
            {texts.length > 0 && (
              <ul className="segments">
                {texts.map((s) => (
                  <li key={s.n}>
                    <span className="slide-num">{s.n}</span>
                    <span className="transcript-text">{s.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="actions">
            <button className="primary" onClick={copy} disabled={!texts.length}>
              {copied ? 'Copié ✓' : 'Copier le texte'}
            </button>
            {result.files.text && (
              <a className="ghost" href={fileUrl(job, result.files.text, true)}>
                .txt
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CarouselTextResult({ job, onOpen }) {
  const { result } = job
  const [copied, setCopied] = useState(false)
  const fullText = (c) => c.slides.map((s) => s.text).filter(Boolean).join('\n\n')

  async function copyAll() {
    await navigator.clipboard.writeText(result.carousels.map((c) => `${c.url}\n\n${fullText(c)}`).join('\n\n---\n\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const summary = [
    `${result.carousels.length} carrousel${result.carousels.length > 1 ? 's' : ''} lu${result.carousels.length > 1 ? 's' : ''}`,
    result.videos > 0 && `${result.videos} vidéo${result.videos > 1 ? 's' : ''} ignorée${result.videos > 1 ? 's' : ''}`,
    result.failed.length > 0 && `${result.failed.length} échec${result.failed.length > 1 ? 's' : ''}`,
  ].filter(Boolean)

  return (
    <div className="account">
      <div className="actions">
        <button className="primary" onClick={copyAll} disabled={!result.carousels.length}>
          {copied ? 'Copié ✓' : 'Copier tout le texte'}
        </button>
        <a className="ghost" href={fileUrl(job, result.files.csv, true)} title="Une ligne par carrousel, une colonne par slide">
          .csv
        </a>
        <a className="ghost" href={fileUrl(job, result.files.json, true)} title="Pour un script ou un outil">
          .json
        </a>
        <a className="ghost" href={fileUrl(job, result.files.md, true)} title="Lisible, à coller dans un assistant IA">
          .md
        </a>
      </div>
      <p className="muted note">
        {summary.join(' · ')}
        {result.cancelled && ` · arrêté à ${result.read}/${result.total} posts`}
      </p>
      {result.failed.length > 0 && (
        <details className="note muted">
          <summary>Posts non lus</summary>
          <ul>
            {result.failed.map((f) => (
              <li key={f.url}>
                <a href={f.url} target="_blank" rel="noreferrer">
                  {f.url}
                </a>{' '}
                : {f.error}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ol className="posts">
        {result.carousels.map((c) => (
          <li key={c.id} className="post post--text">
            <div className="post-row">
              <img className="post-thumb" src={fileUrl(job, c.slides[0])} alt="" loading="lazy" />
              <div className="post-main">
                <a href={c.url} target="_blank" rel="noreferrer" className="post-desc">
                  {c.slides[0]?.text?.split('\n')[0] || c.description || <span className="muted">Sans texte</span>}
                </a>
                <span className="post-meta">
                  {c.date && `${dateFormat.format(new Date(c.date))} · `}
                  {c.slides.length} slides
                  {c.views != null && ` · ${countFormat.format(c.views)} vues`}
                </span>
              </div>
              <button className="ghost small" onClick={() => onOpen(c.url)}>
                Récupérer
              </button>
            </div>
            <details>
              <summary>Voir le texte</summary>
              <ul className="segments">
                {c.slides.map((s) => (
                  <li key={s.n}>
                    <span className="slide-num">{s.n}</span>
                    <span className="transcript-text">{s.text || <span className="muted">Pas de texte</span>}</span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ol>
    </div>
  )
}
