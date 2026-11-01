import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HEADERS, getPostInfo, isPostUrl, parseAccountUrl, resolveUrl, timeout } from './tiktok.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const MODEL = path.resolve(process.env.WHISPER_MODEL || 'models/ggml-large-v3-turbo.bin');
// Voice activity detection skips music/noise, which otherwise makes Whisper invent text.
const VAD_MODEL = path.resolve(process.env.WHISPER_VAD_MODEL || 'models/ggml-silero-v6.2.0.bin');
const LANGUAGE = process.env.WHISPER_LANGUAGE || 'auto';

// Phrases Whisper is known to hallucinate on silence or music.
const HALLUCINATIONS = [
  /^(thank you|thanks for watching|we'll be right back|you)[.!]*$/i,
  /^(merci|merci d'avoir regardé|merci de votre attention)[.!]*$/i,
  /sous-titr(es|age).*(amara|communauté|radio-canada)/i,
  /^(oh|ah|hmm|gracias)[.!]*$/i,
];
// The network cut the connection to TikTok (firewall, filtering Wi-Fi, VPN…): say so,
// rather than a raw "fetch failed" or a misleading "account not found".
const NETWORK_ERROR = /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT|Connection reset|Failed to perform|Could not resolve|timed out/i;
const NETWORK_MESSAGE = "TikTok est injoignable depuis ta connexion : le réseau coupe la connexion (Wi-Fi qui filtre les réseaux sociaux, VPN, pare-feu…). Réessaie sur un autre réseau, ou en activant/désactivant ton VPN.";

function isNetworkError(err) {
  for (let e = err; e; e = e.cause) {
    if (NETWORK_ERROR.test(`${e.code || ''} ${e.message || ''} ${e.output || ''}`)) return true;
  }
  return false;
}

const BIN = {
  ytdlp: process.env.YTDLP_BIN || 'yt-dlp',
  ffmpeg: process.env.FFMPEG_BIN || 'ffmpeg',
  whisper: process.env.WHISPER_BIN || 'whisper-cli',
  // Built from scripts/ocr/ocr.swift by « npm install » and « npm run install-app ».
  ocr: process.env.OCR_BIN || path.resolve('bin/transporter-ocr'),
};

const STEPS = {
  video: [
    { key: 'fetch', label: 'Analyse du lien' },
    { key: 'download', label: 'Téléchargement de la vidéo' },
    { key: 'audio', label: "Extraction de l'audio" },
    { key: 'transcribe', label: 'Transcription' },
  ],
  carousel: [
    { key: 'fetch', label: 'Analyse du lien' },
    { key: 'download', label: 'Téléchargement des slides' },
    { key: 'ocr', label: 'Lecture du texte des slides' },
    { key: 'zip', label: "Création de l'archive" },
  ],
  'video-only': [
    { key: 'fetch', label: 'Analyse du lien' },
    { key: 'download', label: 'Téléchargement de la vidéo' },
  ],
  account: [
    { key: 'fetch', label: 'Analyse du lien' },
    { key: 'list', label: 'Récupération des posts' },
  ],
};

// The three ways of reading many posts at once: what they read, how the step and
// the exports are named.
const BATCH_MODES = {
  carousels: {
    read: 'Lecture du texte de chaque carrousel',
    base: (info) => `${info.author}-carrousels`,
    title: (info) => `@${info.author} : texte des carrousels`,
  },
  all: {
    read: 'Lecture du texte de chaque post',
    base: (info) => `${info.author}-textes`,
    title: (info) => `@${info.author} : texte de tous les posts`,
  },
  urls: {
    read: 'Lecture du texte de chaque lien',
    base: () => `transporter-lot-${new Date().toISOString().slice(0, 10)}`,
    title: () => 'Texte des liens',
  },
};

function batchSteps(mode) {
  return [
    { key: 'read', label: BATCH_MODES[mode].read },
    { key: 'export', label: 'Création des exports' },
  ];
}

const MAX_BATCH_URLS = 500;
// Posts read in parallel by a batch: enough to go fast, few enough not to get throttled.
const BATCH_CONCURRENCY = 3;

const jobs = new Map();

// whisper.cpp saturates the GPU; running one transcription at a time is faster overall.
let transcribeQueue = Promise.resolve();

export function getJob(id) {
  return jobs.get(id);
}

export function hasRunningJobs() {
  return [...jobs.values()].some((j) => j.status === 'running');
}

// What the user picked in the menu for this kind of link. A choice that doesn't
// fit the link (e.g. 'carousel-text' on a video) falls back to the default.
export const ACTIONS = {
  account: ['posts', 'carousel-text', 'all-text'],
  video: ['video', 'video-only'],
  carousel: ['carousel'],
};

export function createJob(url, action = null) {
  const job = newJob(url, null, STEPS.video.slice(0, 1));
  job.action = action;
  return launch(job, run);
}

// Tells the menu what a link points to, before anything is downloaded.
export async function inspectUrl(raw) {
  try {
    return await inspect(raw);
  } catch (err) {
    throw new Error(isNetworkError(err) ? NETWORK_MESSAGE : err.message, { cause: err });
  }
}

async function inspect(raw) {
  const url = await resolveUrl(raw);
  const account = parseAccountUrl(url);
  if (account) return { kind: 'account', author: account.author, url: account.url, actions: ACTIONS.account };
  const info = await getPostInfo(url);
  // Without the page data, trust the URL: TikTok shares carousels as /photo/.
  const kind = info.found ? info.type : /\/photo\//.test(url) ? 'carousel' : 'video';
  return { kind, author: info.author, url: info.url, description: info.description, slides: info.images.length || null, actions: ACTIONS[kind] };
}

// Reads the text of the posts of an account already listed by `accountJob`:
// its carousels only, or every post (videos are transcribed).
export function createAccountBatchJob(accountJob, mode) {
  const { author, url } = accountJob.info;
  const job = newJob(url, 'text-batch', batchSteps(mode));
  job.action = mode === 'all' ? 'all-text' : 'carousel-text';
  job.info = { mode, author, url, source: accountJob.id, posts: accountJob.result.posts.length, items: null };
  return launch(job, async (j) => {
    j.result = await runTextBatch(j, accountJob.result.posts);
    j.status = 'done';
    await saveMeta(j);
  });
}

// Reads the text of a list of links: transcription for videos, OCR for carousels.
export function createUrlBatchJob(urls) {
  const job = newJob(null, 'text-batch', batchSteps('urls'));
  job.input = urls;
  job.info = { mode: 'urls', author: null, url: null, posts: urls.length, items: null };
  // /photo/ links are carousels; the others are found out when each page is read.
  const posts = urls.map((url) => ({ url, type: /\/photo\//.test(url) ? 'carousel' : null }));
  return launch(job, async (j) => {
    j.result = await runTextBatch(j, posts);
    j.status = 'done';
    await saveMeta(j);
  });
}

// Keeps the TikTok links of a pasted list or file, without duplicates.
export function cleanUrlList(urls) {
  return [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))].slice(0, MAX_BATCH_URLS);
}

// Stops a batch after the posts in progress; what was read so far is still exported.
export function cancelJob(job) {
  if (job.status === 'running') job.cancelRequested = true;
}

function newJob(url, type, steps) {
  return {
    id: randomUUID(),
    url,
    status: 'running',
    type,
    steps: steps.map((s, i) => ({ ...s, status: i ? 'pending' : 'running', progress: null })),
    info: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
}

function launch(job, work) {
  jobs.set(job.id, job);
  work(job).catch((err) => {
    const current = job.steps.find((s) => s.status === 'running');
    if (current) current.status = 'error';
    job.status = 'error';
    job.error = isNetworkError(err) ? NETWORK_MESSAGE : err.message || String(err);
    console.error(`[job ${job.id}]`, err);
    saveMeta(job);
  });
  return job;
}

function step(job, key) {
  const s = job.steps.find((x) => x.key === key);
  return {
    start() {
      s.status = 'running';
    },
    progress(p) {
      s.progress = Math.max(0, Math.min(100, Math.round(p)));
    },
    // Free-text progress, for steps whose total isn't known in advance.
    detail(text) {
      s.detail = text;
    },
    done() {
      s.status = 'done';
      s.progress = 100;
    },
  };
}

async function run(job) {
  const dir = path.join(DATA_DIR, job.id);
  await fs.mkdir(dir, { recursive: true });

  const url = await resolveUrl(job.url);
  const account = parseAccountUrl(url);
  if (account) {
    // Text of the account's posts straight from its link: list, then read.
    const mode = { 'carousel-text': 'carousels', 'all-text': 'all' }[job.action];
    job.type = mode ? 'text-batch' : 'account';
    job.info = { author: account.author, url: account.url, posts: null, ...(mode && { mode, items: null }) };
    job.steps = [...STEPS.account, ...(mode ? batchSteps(mode) : [])].map((s) => ({ ...s, status: 'pending', progress: null }));
    step(job, 'fetch').done();
    const listing = await runAccount(job, account, dir);
    job.result = mode ? await runTextBatch(job, listing.posts) : listing;
    job.status = 'done';
    await saveMeta(job);
    return;
  }

  const info = await getPostInfo(url);
  job.type = info.type;
  job.info = { id: info.id, url: info.url, author: info.author, description: info.description, cover: info.cover, duration: info.duration, slides: info.images.length };
  const videoOnly = info.type === 'video' && job.action === 'video-only';
  job.steps = STEPS[videoOnly ? 'video-only' : info.type].map((s) => ({ ...s, status: 'pending', progress: null }));
  step(job, 'fetch').done();

  job.result = info.type === 'carousel' ? await runCarousel(job, info, dir) : await runVideo(job, info, dir);
  job.status = 'done';
  await saveMeta(job);
}

async function runVideo(job, info, dir) {
  const base = `${info.author}-${info.id}`;
  const videoPath = path.join(dir, 'video.mp4');

  const dl = step(job, 'download');
  dl.start();
  await downloadVideo(info.url, videoPath, (p) => dl.progress(p));
  dl.done();

  const video = { path: 'video.mp4', name: `${base}.mp4` };
  if (job.action === 'video-only') return { language: null, text: null, segments: [], files: { video } };

  const audio = step(job, 'audio');
  const tr = step(job, 'transcribe');
  audio.start();
  const { language, text, segments } = await transcribeVideo(videoPath, path.join(dir, 'transcript'), {
    onAudioReady: () => {
      audio.done();
      tr.start();
    },
    onProgress: (p) => tr.progress(p),
  });
  tr.done();

  return {
    language,
    text,
    segments,
    files: {
      video,
      txt: { path: 'transcript.txt', name: `${base}.txt` },
      srt: { path: 'transcript.srt', name: `${base}.srt` },
    },
  };
}

async function downloadVideo(url, dest, onProgress) {
  // Prefer H.264 so the preview plays in every browser (TikTok also serves H.265).
  await exec(BIN.ytdlp, [
    '-f', 'b[vcodec^=h264]/b[vcodec^=avc]/b',
    '--no-playlist', '--no-part', '--newline',
    '--progress-template', 'download:%(progress._percent_str)s',
    '-o', dest,
    url,
  ], (line) => {
    const m = line.match(/([\d.]+)%/);
    if (m) onProgress?.(parseFloat(m[1]));
  });
}

// Video → 16 kHz WAV → Whisper. Writes <outPrefix>.txt and .srt from the filtered
// segments, and returns them with the detected language.
async function transcribeVideo(videoPath, outPrefix, { onAudioReady, onProgress } = {}) {
  const wavPath = `${outPrefix}.wav`;
  await exec(BIN.ffmpeg, ['-y', '-loglevel', 'error', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath]);
  onAudioReady?.();

  const vad = (await exists(VAD_MODEL)) ? ['--vad', '-vm', VAD_MODEL] : [];
  const whisper = () =>
    exec(BIN.whisper, [
      '-m', MODEL,
      '-f', wavPath,
      '-l', LANGUAGE,
      '-t', String(Math.max(4, os.cpus().length - 2)),
      '-sns', '-pp',
      ...vad,
      '-oj',
      '-of', outPrefix,
    ], (line) => {
      const m = line.match(/progress\s*=\s*(\d+)%/);
      if (m) onProgress?.(parseInt(m[1], 10));
    });
  const queued = transcribeQueue.then(whisper);
  transcribeQueue = queued.catch(() => {});
  try {
    await queued;
  } finally {
    await fs.rm(wavPath, { force: true });
  }

  const json = JSON.parse(await fs.readFile(`${outPrefix}.json`, 'utf8'));
  const segments = (json.transcription || [])
    .map((s) => ({ start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim() }))
    .filter((s) => s.text && !HALLUCINATIONS.some((re) => re.test(s.text)));
  const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  // Written here rather than by whisper-cli so the files match the filtered segments.
  await fs.writeFile(`${outPrefix}.txt`, text ? `${text}\n` : '');
  await fs.writeFile(`${outPrefix}.srt`, toSrt(segments));
  return { language: segments.length ? json.result?.language || null : null, text, segments };
}

async function runCarousel(job, info, dir) {
  const base = `${info.author}-${info.id}`;
  const slidesDir = path.join(dir, 'slides');
  await fs.mkdir(slidesDir, { recursive: true });

  const dl = step(job, 'download');
  dl.start();
  const slides = (await downloadSlides(info.imageSources, slidesDir, (p) => dl.progress(p * 100))).map((name) => ({
    path: `slides/${name}`,
    name: `${base}-${name}`,
  }));
  let audio = null;
  if (info.musicUrl) {
    try {
      await download(info.musicUrl, path.join(dir, 'sound.mp3'));
      audio = { path: 'sound.mp3', name: `${base}-son.mp3` };
    } catch {
      // The sound is a bonus; the slides are what matter.
    }
  }
  dl.done();

  const ocr = step(job, 'ocr');
  ocr.start();
  let text = null;
  try {
    const texts = await readSlidesText(slides.map((s) => path.join(dir, s.path)));
    slides.forEach((s, i) => (s.text = texts[i]));
    if (texts.some(Boolean)) {
      const all = texts.map((t, i) => `Slide ${i + 1}\n${t || '(pas de texte)'}`).join('\n\n');
      await fs.writeFile(path.join(dir, 'texte.txt'), `${all}\n`);
      text = { path: 'texte.txt', name: `${base}-texte.txt` };
    }
  } catch (err) {
    // The slides are what matter; the text is a bonus.
    console.warn(`[job ${job.id}] OCR impossible :`, err.message);
  }
  ocr.done();

  const zip = step(job, 'zip');
  zip.start();
  const zipPath = path.join(dir, `${base}.zip`);
  const zipped = [...slides.map((s) => s.path), ...(text ? [text.path] : [])];
  await exec('zip', ['-j', '-q', zipPath, ...zipped.map((p) => path.join(dir, p))]);
  zip.done();

  return {
    slides,
    files: {
      zip: { path: `${base}.zip`, name: `${base}.zip` },
      ...(text && { text }),
      ...(audio && { audio }),
    },
  };
}

// Downloads slide images as slide-01.jpg, slide-02.jpg… and returns their file names.
// Each slide comes with several sources (CDN hosts): the next one is tried if one fails.
async function downloadSlides(sourceLists, slidesDir, onProgress) {
  await fs.mkdir(slidesDir, { recursive: true });
  const names = [];
  for (const [i, sources] of sourceLists.entries()) {
    const name = `slide-${String(i + 1).padStart(2, '0')}.jpg`;
    await downloadFirst(sources, path.join(slidesDir, name));
    names.push(name);
    onProgress?.((i + 1) / sourceLists.length);
  }
  return names;
}

async function runTextBatch(job, posts) {
  const { mode } = job.info;
  const dir = path.join(DATA_DIR, job.id);
  await fs.mkdir(dir, { recursive: true });
  const read = step(job, 'read');
  read.start();
  const items = Array.from({ length: posts.length }, () => null);
  const failed = [];
  let skipped = 0;
  let done = 0;
  let next = 0;

  // Returns the post's text, or null for a video in carousels-only mode.
  const readPost = async (post) => {
    if (mode === 'carousels' && post.type === 'video') return null;
    const url = isPostUrl(post.url) ? post.url : await resolveUrl(post.url);
    if (parseAccountUrl(url)) throw new Error('Lien de compte : colle-le seul pour lire tous ses posts.');
    const info = await getPostInfo(url);
    if (!info.found) throw new Error('TikTok n’a pas renvoyé ce post.');
    if (mode === 'carousels' && info.type !== 'carousel') return null;

    const rel = `posts/${info.id}`;
    await fs.mkdir(path.join(dir, rel), { recursive: true });
    const item = {
      url: info.url,
      id: info.id,
      type: info.type,
      date: post.date ?? info.date,
      description: (info.description || post.description || '').trim(),
      views: post.views ?? info.views,
      likes: post.likes ?? info.likes,
    };

    if (info.type === 'carousel') {
      const names = await downloadSlides(info.imageSources, path.join(dir, rel));
      const texts = await readSlidesText(names.map((n) => path.join(dir, rel, n)));
      const slides = names.map((n, i) => ({ n: i + 1, path: `${rel}/${n}`, text: texts[i] }));
      return { ...item, text: texts.filter(Boolean).join('\n\n'), slides };
    }

    // Videos: only the transcript is kept (and the cover, for the list).
    const videoPath = path.join(dir, rel, 'video.mp4');
    await downloadVideo(info.url, videoPath);
    let cover = null;
    if (info.cover) {
      try {
        await download(info.cover, path.join(dir, rel, 'cover.jpg'));
        cover = { path: `${rel}/cover.jpg` };
      } catch {
        // The list shows a placeholder instead.
      }
    }
    try {
      const { language, text, segments } = await transcribeVideo(videoPath, path.join(dir, rel, 'transcript'));
      return { ...item, cover, language, text, segments };
    } finally {
      await fs.rm(videoPath, { force: true });
    }
  };

  // A few workers pull posts from a shared index; results keep the list's order.
  // Downloads overlap, while transcriptions wait their turn in transcribeQueue.
  const worker = async () => {
    while (next < posts.length && !job.cancelRequested) {
      const i = next++;
      try {
        const item = await readPost(posts[i]);
        if (item) items[i] = item;
        else skipped++;
      } catch (err) {
        failed.push({ url: posts[i].url, error: err.message, network: isNetworkError(err) });
      }
      done++;
      read.progress((done / posts.length) * 100);
      read.detail(`${done}/${posts.length}`);
    }
  };
  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker));

  const found = items.filter(Boolean);
  if (!found.length && failed.length && failed.every((f) => f.network)) throw new Error(NETWORK_MESSAGE);
  job.info.items = found.length;
  read.done();

  const exp = step(job, 'export');
  exp.start();
  const files = await writeTextExports(dir, job.info, found);
  exp.done();

  return { items: found, skipped, failed, read: done, total: posts.length, cancelled: Boolean(job.cancelRequested), files };
}

// Three formats of the same data: a spreadsheet, a structured file for scripts,
// and a readable document (handy to paste into an AI assistant).
async function writeTextExports(dir, info, items) {
  const mode = BATCH_MODES[info.mode];
  const base = mode.base(info);
  const typeLabel = (i) => (i.type === 'carousel' ? 'carrousel' : 'vidéo');

  const maxSlides = Math.max(0, ...items.map((i) => i.slides?.length || 0));
  const slideCols = Array.from({ length: maxSlides }, (_, n) => `slide_${n + 1}`);
  await writeCsv(path.join(dir, 'textes.csv'), [
    ['url', 'type', 'date', 'description', 'vues', 'likes', 'langue', 'nb_slides', 'texte', ...slideCols],
    ...items.map((i) => [
      i.url, typeLabel(i), i.date, i.description, i.views, i.likes, i.language, i.slides?.length, i.text,
      ...slideCols.map((_, n) => i.slides?.[n]?.text ?? ''),
    ]),
  ]);

  const json = {
    source: info.author ? `@${info.author}` : null,
    url: info.url,
    extractedAt: new Date().toISOString(),
    items: items.map(({ slides, cover: _cover, ...i }) => ({
      ...i,
      ...(slides && { slides: slides.map(({ n, text }) => ({ n, text })) }),
    })),
  };
  await fs.writeFile(path.join(dir, 'textes.json'), `${JSON.stringify(json, null, 2)}\n`);

  const day = (d) => (d ? d.slice(0, 10) : 'date inconnue');
  const md = [
    `# ${mode.title(info)}`,
    ...items.map((i, n) => [
      `## ${n + 1}. ${day(i.date)}${i.description ? ` · ${i.description}` : ''}`,
      i.url,
      ...(i.type === 'carousel'
        ? i.slides.map((s) => `**Slide ${s.n}**\n${s.text || '_(pas de texte)_'}`)
        : [`**Transcription${i.language ? ` (${i.language})` : ''}**\n${i.text || '_(aucune parole détectée)_'}`]),
    ].join('\n\n')),
  ].join('\n\n');
  await fs.writeFile(path.join(dir, 'textes.md'), `${md}\n`);

  return {
    csv: { path: 'textes.csv', name: `${base}.csv` },
    json: { path: 'textes.json', name: `${base}.json` },
    md: { path: 'textes.md', name: `${base}.md` },
  };
}

// Returns each slide's text, in reading order: lines of a paragraph are joined
// (they are wrapped by the layout, not by the author), paragraphs are separated
// by a blank line.
async function readSlidesText(files) {
  const byFile = new Map();
  await exec(BIN.ocr, files, (line) => {
    if (!line.startsWith('{')) return;
    const r = JSON.parse(line);
    byFile.set(r.file, r.lines);
  });
  // Vision scores what it's unsure of 0.3 or 0.5: on TikTok slides that's always
  // background noise (handwriting, signs, blurry print), never the caption.
  return files.map((f) => {
    const lines = (byFile.get(f) || []).filter((l) => l.confidence >= 0.9);
    return toParagraphs(lines.filter((l) => !isStrayText(l, lines)));
  });
}

const overlapsX = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w;

// Short text standing alone, away from the caption, is part of the photo
// (a sign, a jersey number…), not of what the author wrote.
function isStrayText(line, all) {
  if (/\p{L}.*\p{L}/u.test(line.text)) return false;
  return !all.some((o) => o !== line && overlapsX(o, line) && Math.abs(o.y - line.y) < 3 * Math.max(o.h, line.h));
}

function toParagraphs(lines) {
  const paragraphs = [];
  let prev = null;
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const gap = prev && line.y - (prev.y + prev.h);
    const sameParagraph = prev && overlapsX(prev, line) && gap > -prev.h && gap < 0.6 * Math.min(prev.h, line.h);
    if (sameParagraph) {
      const last = paragraphs.length - 1;
      paragraphs[last] += /\p{L}-$/u.test(paragraphs[last]) ? text : ` ${text}`;
    } else {
      paragraphs.push(text);
    }
    prev = line;
  }
  return paragraphs.join('\n\n');
}

async function runAccount(job, account, dir) {
  const list = step(job, 'list');
  list.start();
  const posts = [];
  // --flat-playlist lists posts without downloading them; -j prints one JSON line per
  // post as pages arrive, so the count updates live. Carousels are listed too
  // (as /video/ URLs, rewritten to /photo/ below).
  const listing = exec(BIN.ytdlp, ['--flat-playlist', '-j', '--socket-timeout', '20', account.url], (line) => {
    if (!line.startsWith('{')) return;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    if (!e.url) return;
    // yt-dlp lists every post under /video/; carousel covers come from TikTok's "photomode".
    const type = (e.thumbnails || []).some((t) => /photomode/.test(t.url)) ? 'carousel' : 'video';
    posts.push({
      url: type === 'carousel' ? e.url.replace('/video/', '/photo/') : e.url,
      id: String(e.id),
      type,
      description: e.description || e.title || '',
      date: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : null,
      views: e.view_count ?? null,
      likes: e.like_count ?? null,
      duration: e.duration ?? null,
    });
    list.detail(`${posts.length} posts trouvés`);
  });
  let partial = false;
  try {
    await listing;
  } catch (err) {
    partial = true;
    // TikTok sometimes cuts long listings short: keep what we got rather than failing.
    if (!posts.length) throw new Error('Compte introuvable, privé ou sans post public.', { cause: err });
    console.warn(`[job ${job.id}] liste incomplète :`, err.message);
  }
  if (!posts.length) throw new Error('Aucun post trouvé : le compte est peut-être privé ou vide.');
  job.info.posts = posts.length;
  list.done();

  const base = `${account.author}-posts`;
  await fs.writeFile(path.join(dir, 'posts.txt'), posts.map((p) => p.url).join('\n') + '\n');
  await writeCsv(path.join(dir, 'posts.csv'), [
    ['url', 'type', 'date', 'description', 'vues', 'likes', 'duree_s'],
    ...posts.map((p) => [p.url, p.type === 'carousel' ? 'carrousel' : 'vidéo', p.date, p.description, p.views, p.likes, p.duration]),
  ]);

  return {
    posts,
    partial,
    files: {
      txt: { path: 'posts.txt', name: `${base}.txt` },
      csv: { path: 'posts.csv', name: `${base}.csv` },
    },
  };
}

async function writeCsv(file, rows) {
  const cell = (v) => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  // BOM so Excel reads the accents correctly.
  await fs.writeFile(file, `\ufeff${rows.map((row) => row.map(cell).join(',')).join('\n')}\n`);
}

function toSrt(segments) {
  const ts = (sec) => {
    const ms = Math.round(sec * 1000);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return segments.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text}\n`).join('\n');
}

function exists(p) {
  return fs.access(p).then(() => true, () => false);
}

// TikTok's CDN sometimes answers 404 or drops a request for a file that is there:
// one retry after a short pause is usually enough.
async function download(url, dest, attempts = 2) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: timeout() });
      if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
      await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function downloadFirst(urls, dest) {
  let lastError;
  for (const url of urls) {
    try {
      return await download(url, dest);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function exec(cmd, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    // Chunks can end mid-line (e.g. a long JSON line), so keep the remainder per stream.
    const readLines = (stream) => {
      let pending = '';
      stream.on('data', (chunk) => {
        const text = chunk.toString();
        tail = (tail + text).slice(-4000);
        if (!onLine) return;
        const lines = (pending + text).split(/\r|\n/);
        pending = lines.pop();
        lines.forEach((l) => l && onLine(l));
      });
      stream.on('end', () => pending && onLine?.(pending));
    };
    readLines(child.stdout);
    readLines(child.stderr);
    child.on('error', (err) =>
      reject(err.code === 'ENOENT' ? new Error(`${cmd} est introuvable. Lance « npm run setup ».`) : err),
    );
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const lastError = tail.split('\n').filter((l) => /error/i.test(l)).pop() || tail.trim().split('\n').pop();
      reject(Object.assign(new Error(`${path.basename(cmd)} a échoué : ${lastError}`), { output: tail }));
    });
  });
}

async function saveMeta(job) {
  try {
    await fs.writeFile(path.join(DATA_DIR, job.id, 'job.json'), JSON.stringify(job, null, 2));
  } catch {
    // The job directory may not exist if we failed before creating it.
  }
}

// Reload finished jobs so result links keep working after a restart.
export async function loadJobs() {
  const entries = await fs.readdir(DATA_DIR).catch(() => []);
  for (const id of entries) {
    try {
      const job = JSON.parse(await fs.readFile(path.join(DATA_DIR, id, 'job.json'), 'utf8'));
      jobs.set(job.id, job);
    } catch {
      // Not a job directory, or an unfinished one.
    }
  }
}
