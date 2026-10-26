import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HEADERS, getPostInfo } from './tiktok.js';

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
const BIN = {
  ytdlp: process.env.YTDLP_BIN || 'yt-dlp',
  ffmpeg: process.env.FFMPEG_BIN || 'ffmpeg',
  whisper: process.env.WHISPER_BIN || 'whisper-cli',
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
    { key: 'zip', label: "Création de l'archive" },
  ],
};

const jobs = new Map();

// whisper.cpp saturates the GPU; running one transcription at a time is faster overall.
let transcribeQueue = Promise.resolve();

export function getJob(id) {
  return jobs.get(id);
}

export function hasRunningJobs() {
  return [...jobs.values()].some((j) => j.status === 'running');
}

export function createJob(url) {
  const job = {
    id: randomUUID(),
    url,
    status: 'running',
    type: null,
    steps: STEPS.video.slice(0, 1).map((s) => ({ ...s, status: 'running', progress: null })),
    info: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  run(job).catch((err) => {
    const current = job.steps.find((s) => s.status === 'running');
    if (current) current.status = 'error';
    job.status = 'error';
    job.error = err.message || String(err);
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
    done() {
      s.status = 'done';
      s.progress = 100;
    },
  };
}

async function run(job) {
  const dir = path.join(DATA_DIR, job.id);
  await fs.mkdir(dir, { recursive: true });

  const info = await getPostInfo(job.url);
  job.type = info.type;
  job.info = { id: info.id, url: info.url, author: info.author, description: info.description, cover: info.cover, duration: info.duration, slides: info.images.length };
  job.steps = STEPS[info.type].map((s) => ({ ...s, status: 'pending', progress: null }));
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
  // Prefer H.264 so the preview plays in every browser (TikTok also serves H.265).
  await exec(BIN.ytdlp, [
    '-f', 'b[vcodec^=h264]/b[vcodec^=avc]/b',
    '--no-playlist', '--no-part', '--newline',
    '--progress-template', 'download:%(progress._percent_str)s',
    '-o', videoPath,
    info.url,
  ], (line) => {
    const m = line.match(/([\d.]+)%/);
    if (m) dl.progress(parseFloat(m[1]));
  });
  dl.done();

  const audio = step(job, 'audio');
  audio.start();
  const wavPath = path.join(dir, 'audio.wav');
  await exec(BIN.ffmpeg, ['-y', '-loglevel', 'error', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath]);
  audio.done();

  const tr = step(job, 'transcribe');
  tr.start();
  const outPrefix = path.join(dir, 'transcript');
  const vad = (await exists(VAD_MODEL)) ? ['--vad', '-vm', VAD_MODEL] : [];
  const transcribe = () =>
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
      if (m) tr.progress(parseInt(m[1], 10));
    });
  const queued = transcribeQueue.then(transcribe);
  transcribeQueue = queued.catch(() => {});
  await queued;
  await fs.rm(wavPath, { force: true });

  const json = JSON.parse(await fs.readFile(`${outPrefix}.json`, 'utf8'));
  const segments = (json.transcription || [])
    .map((s) => ({ start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim() }))
    .filter((s) => s.text && !HALLUCINATIONS.some((re) => re.test(s.text)));
  const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  // Written here rather than by whisper-cli so the files match the filtered segments.
  await fs.writeFile(`${outPrefix}.txt`, text ? `${text}\n` : '');
  await fs.writeFile(`${outPrefix}.srt`, toSrt(segments));
  tr.done();

  return {
    language: segments.length ? json.result?.language || null : null,
    text,
    segments,
    files: {
      video: { path: 'video.mp4', name: `${base}.mp4` },
      txt: { path: 'transcript.txt', name: `${base}.txt` },
      srt: { path: 'transcript.srt', name: `${base}.srt` },
    },
  };
}

async function runCarousel(job, info, dir) {
  const base = `${info.author}-${info.id}`;
  const slidesDir = path.join(dir, 'slides');
  await fs.mkdir(slidesDir, { recursive: true });

  const dl = step(job, 'download');
  dl.start();
  const slides = [];
  for (const [i, url] of info.images.entries()) {
    const name = `slide-${String(i + 1).padStart(2, '0')}.jpg`;
    await download(url, path.join(slidesDir, name));
    slides.push({ path: `slides/${name}`, name: `${base}-${name}` });
    dl.progress(((i + 1) / info.images.length) * 100);
  }
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

  const zip = step(job, 'zip');
  zip.start();
  const zipPath = path.join(dir, `${base}.zip`);
  await exec('zip', ['-j', '-q', zipPath, ...slides.map((s) => path.join(dir, s.path))]);
  zip.done();

  return {
    slides,
    files: {
      zip: { path: `${base}.zip`, name: `${base}.zip` },
      ...(audio && { audio }),
    },
  };
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

async function download(url, dest) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

function exec(cmd, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const handle = (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      if (onLine) text.split(/\r|\n/).forEach((l) => l && onLine(l));
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (err) =>
      reject(err.code === 'ENOENT' ? new Error(`${cmd} est introuvable. Lance « npm run setup ».`) : err),
    );
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const lastError = tail.split('\n').filter((l) => /error/i.test(l)).pop() || tail.trim().split('\n').pop();
      reject(new Error(`${path.basename(cmd)} a échoué : ${lastError}`));
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
