import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DATA_DIR, cancelJob, createCarouselTextJob, createJob, getJob, hasRunningJobs, inspectUrl, loadJobs } from './pipeline.js';
import { isTikTokUrl } from './tiktok.js';

// Not PORT: dev tooling often sets PORT for the frontend, which would collide with Vite.
const PORT = Number(process.env.API_PORT) || 3001;
const WEB_DIST = path.resolve('web/dist');
// Sockets handed over by launchd (see scripts/launcher): the bookmark starts us on demand.
const LISTEN_FDS = (process.env.LISTEN_FDS || '').split(',').filter(Boolean).map(Number);
const IDLE_EXIT_MS = Number(process.env.IDLE_EXIT_MINUTES || 0) * 60_000;

const app = express();
app.use(express.json());

let lastActivity = Date.now();
app.use((_req, _res, next) => {
  lastActivity = Date.now();
  next();
});

// The open page pings this so we know someone is still using the app.
app.get('/api/ping', (_req, res) => res.sendStatus(204));

const INVALID_URL = 'Colle un lien TikTok valide : une publication ou un compte (tiktok.com/@…).';

// What can be done with this link (account, video or carousel), for the menu.
app.get('/api/inspect', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!isTikTokUrl(url)) return res.status(400).json({ error: INVALID_URL });
  try {
    res.json(await inspectUrl(url));
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

app.post('/api/jobs', (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!isTikTokUrl(url)) return res.status(400).json({ error: INVALID_URL });
  const action = typeof req.body?.action === 'string' ? req.body.action : null;
  res.status(201).json(createJob(url, action));
});

// Batch: reads the text of every carousel listed by an account job.
app.post('/api/jobs/:id/carousel-text', (req, res) => {
  const source = getJob(req.params.id);
  if (source?.type !== 'account' || source.status !== 'done') return res.status(400).json({ error: 'Liste des posts introuvable : relance le lien du compte.' });
  res.status(201).json(createCarouselTextJob(source));
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tâche introuvable.' });
  cancelJob(job);
  res.json(job);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tâche introuvable.' });
  res.json(job);
});

// Serves a job's output; ?download=1 forces a download with a readable filename.
app.get('/files/:id/*file', (req, res) => {
  const job = getJob(req.params.id);
  const rel = [].concat(req.params.file).join('/');
  const filePath = path.join(DATA_DIR, req.params.id, rel);
  if (!job || !filePath.startsWith(path.join(DATA_DIR, req.params.id) + path.sep)) return res.sendStatus(404);
  if (req.query.download) {
    const entry = [...Object.values(job.result?.files || {}), ...(job.result?.slides || [])].find((f) => f.path === rel);
    return res.download(filePath, entry?.name || path.basename(rel));
  }
  res.sendFile(filePath);
});

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('/{*any}', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
}

await loadJobs();

if (LISTEN_FDS.length) {
  for (const fd of LISTEN_FDS) http.createServer(app).listen({ fd });
  console.log(`Transporter démarré à la demande (${new Date().toLocaleString('fr-FR')})`);
} else {
  app.listen(PORT, () => console.log(`Transporter API → http://localhost:${PORT}`));
}

// Exit once the page has been closed for a while; launchd restarts us on the next visit.
if (IDLE_EXIT_MS) {
  setInterval(() => {
    if (Date.now() - lastActivity < IDLE_EXIT_MS || hasRunningJobs()) return;
    console.log('Inactif, arrêt du serveur.');
    process.exit(0);
  }, 15_000).unref();
}
