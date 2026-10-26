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

  // Restore the last job on reload so results aren't lost.
  useEffect(() => {
    const id = readJobFromHash()
    if (!id) return
    fetch(`/api/jobs/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return
        setJob(j)
        setUrl(j.url)
      })
      .catch(() => {})
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

  async function submit(e) {
    e.preventDefault()
    if (!url.trim() || submitting || running) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur inattendue.')
      setJob(data)
      history.replaceState(null, '', `#job=${data.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
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
        <p className="eyebrow">TikTok → MP4 · Slides · Transcription</p>
        <h1>
          Colle un lien.
          <br />
          <span className="gradient">Récupère tout.</span>
        </h1>
        <p className="lede">
          La vidéo en MP4 et sa transcription, ou toutes les slides d'un carrousel en .zip. Tout tourne en local sur ta
          machine.
        </p>

        <form className="search" onSubmit={submit}>
          <input
            type="url"
            inputMode="url"
            placeholder="https://www.tiktok.com/@compte/video/…"
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
            {running ? 'En cours…' : 'Transcrire'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      {job && (
        <section className="panel">
          <JobHeader job={job} onReset={reset} />
          {job.status !== 'done' && <Steps job={job} />}
          {job.status === 'error' && <p className="error">{job.error}</p>}
          {job.status === 'done' && job.type === 'video' && <VideoResult job={job} />}
          {job.status === 'done' && job.type === 'carousel' && <CarouselResult job={job} />}
        </section>
      )}
    </main>
  )
}

function JobHeader({ job, onReset }) {
  const info = job.info
  return (
    <header className="job-header">
      <div className="job-meta">
        {info ? (
          <>
            <span className="badge">{job.type === 'carousel' ? `Carrousel · ${info.slides} slides` : 'Vidéo'}</span>
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
          {s.status === 'running' && s.progress != null && <span className="pct">{s.progress}%</span>}
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

function CarouselResult({ job }) {
  const { result } = job
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
    </div>
  )
}
