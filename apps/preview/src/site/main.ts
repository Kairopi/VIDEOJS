import '@videojs/html/i18n';
import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';
import { TintModel } from '@/video/tint/model';
import type { MediaTextCue } from '@videojs/html';

import { FILMS, type Film } from './films';
import './site.css';

const PLACEHOLDER = '<!-- Add a compatible media component here. -->';
const LIT = 'saturate(1.4) contrast(1.08) brightness(1.06)';
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;

// ---------- Fingerprints outside the player, from the same storyboard ----------

function parseVtt(text: string): MediaTextCue[] {
  const toSeconds = (s: string) => s.split(':').reduce((a, v) => a * 60 + parseFloat(v), 0);
  const cues: MediaTextCue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i === -1 || !lines[i + 1]) continue;
    const [a, b] = lines[i]!.split('-->').map((s) => s.trim().split(' ')[0]!);
    cues.push({ startTime: toSeconds(a!), endTime: toSeconds(b!), text: lines[i + 1]!.trim() });
  }
  return cues;
}

const models = new Map<string, Promise<TintModel>>();
function modelFor(film: Film): Promise<TintModel> {
  let p = models.get(film.id);
  if (!p) {
    p = (async () => {
      const src = `https://image.mux.com/${film.id}/storyboard.vtt`;
      const text = await (await fetch(src)).text();
      const model = new TintModel();
      await model.setTrack({ cues: parseVtt(text), src, crossOrigin: 'anonymous' });
      return model;
    })();
    models.set(film.id, p);
  }
  return p;
}

function draw(canvas: HTMLCanvasElement, source: HTMLCanvasElement | null): void {
  if (!source) return;
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d')!.drawImage(source, 0, 0);
}

function sized(el: Element): { w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { w: Math.max(1, r.width * dpr()), h: Math.max(1, r.height * dpr()) };
}

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- The player ----------

const playerHost = $<HTMLElement>('#player');
const i18n = document.createElement('media-i18n');
const player = document.createElement('video-player');
let current: Film = FILMS[0]!;
player.setAttribute('content-title', current.title);
player.innerHTML = skinTemplate.replace(
  PLACEHOLDER,
  `<mux-video src="https://stream.mux.com/${current.id}.m3u8" playsinline crossorigin="anonymous" preload="metadata"></mux-video>`
);
i18n.append(player);
playerHost.append(i18n);

// ---------- The wordmark, painted with the film ----------

const layers = [...document.querySelectorAll<HTMLElement>('.mark-layer')];
let activeLayer = 0;
async function paintMark(film: Film): Promise<void> {
  const model = await modelFor(film);
  if (film !== current) return;
  const mark = $<HTMLElement>('.mark');
  const { w, h } = sized(mark);
  const print = model.print(w, h, LIT);
  if (!print) return;
  const next = layers[1 - activeLayer]!;
  next.style.backgroundImage = `url(${print.toDataURL('image/jpeg', 0.9)})`;
  next.dataset.active = '';
  delete layers[activeLayer]!.dataset.active;
  activeLayer = 1 - activeLayer;
  document.documentElement.dataset.painted = '';
}

// ---------- The shelf ----------

const shelf = $<HTMLUListElement>('.shelf');
const cards = FILMS.map((film) => {
  const li = document.createElement('li');
  li.innerHTML = `
    <button class="card" type="button" aria-pressed="false">
      <span class="card-print"><canvas aria-hidden="true"></canvas></span>
      <span class="card-text">
        <span class="card-title"></span>
        <span class="card-line"></span>
        <span class="card-meta"></span>
      </span>
    </button>`;
  li.querySelector('.card-title')!.textContent = film.title;
  li.querySelector('.card-line')!.textContent = film.line;
  const button = li.querySelector<HTMLButtonElement>('.card')!;
  button.addEventListener('click', () => select(film));
  shelf.append(li);
  return { film, button, canvas: li.querySelector('canvas')!, meta: li.querySelector<HTMLElement>('.card-meta')! };
});
shelf.toggleAttribute('data-single', FILMS.length < 2);

async function paintCards(): Promise<void> {
  for (const card of cards) {
    const model = await modelFor(card.film).catch(() => null);
    if (!model || model.status !== 'ready') continue;
    const { w, h } = sized(card.canvas.parentElement!);
    draw(card.canvas, model.print(w, h, LIT));
    card.meta.textContent = `${formatTime(model.duration)}, ${model.scenes.length} scenes, ${card.film.year}`;
  }
}

// ---------- How it works, drawn from the current film ----------

async function paintSteps(film: Film): Promise<void> {
  const model = await modelFor(film);
  if (film !== current || model.status !== 'ready') return;
  const first = model.frames[0]!;
  const img = model.image(first.url);

  const storyboard = $<HTMLImageElement>('.step-storyboard img');
  storyboard.src = first.url;
  $('.step-frames').textContent = String(model.frames.length);
  $('.step-scenes').textContent = String(model.scenes.length);

  // Slits: the film's most vivid frame, cut into strips, each strip squeezed to one line.
  const slits = $<HTMLCanvasElement>('.step-slits');
  const { w, h } = sized(slits);
  slits.width = w;
  slits.height = h;
  const g = slits.getContext('2d')!;
  // The brightest colourful frame shows the slits most clearly.
  const f = model.frames.reduce((best, fr) => (fr.chroma * fr.lab[0] > best.chroma * best.lab[0] ? fr : best), model.frames[0]!);
  const frameImg = model.image(f.url) ?? img;
  if (frameImg) {
    const K = 12;
    const frameW = w * 0.6;
    const frameH = Math.min(h, (frameW * f.h) / f.w);
    const top = (h - frameH) / 2;
    g.drawImage(frameImg, f.x, f.y, f.w, f.h, 0, top, frameW, frameH);
    g.strokeStyle = 'rgba(10,10,11,0.9)';
    g.lineWidth = Math.max(1, dpr());
    for (let k = 1; k < K; k++) {
      const x = Math.round((k * frameW) / K) + 0.5;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, top + frameH);
      g.stroke();
    }
    const column = document.createElement('canvas');
    column.width = 1;
    column.height = Math.round(frameH);
    const cg = column.getContext('2d')!;
    const gap = w * 0.006;
    const barsX = w * 0.68;
    const barW = (w - barsX - gap * (K - 1)) / K;
    g.imageSmoothingEnabled = false;
    for (let k = 0; k < K; k++) {
      cg.clearRect(0, 0, 1, column.height);
      cg.drawImage(frameImg, f.x + (k * f.w) / K, f.y, f.w / K, f.h, 0, 0, 1, column.height);
      g.drawImage(column, barsX + k * (barW + gap), top, barW, frameH);
    }
  }

  // The fingerprint, with a hairline at each scene change.
  const printCanvas = $<HTMLCanvasElement>('.step-print');
  const size = sized(printCanvas);
  draw(printCanvas, model.print(size.w, size.h, LIT));
  const pg = printCanvas.getContext('2d')!;
  pg.fillStyle = 'rgba(10,10,11,0.95)';
  for (const scene of model.scenes.slice(1)) {
    const x = Math.round((scene.start / model.duration) * size.w);
    pg.fillRect(x - dpr(), 0, 2 * dpr(), size.h);
  }

  // Scene colours.
  const list = $<HTMLOListElement>('.palette-list');
  list.replaceChildren(
    ...model.scenes.map((scene) => {
      const a = model.accentOf(scene.face);
      const li = document.createElement('li');
      li.style.setProperty('--swatch', `oklch(${a.l} ${a.c} ${a.h})`);
      li.innerHTML = '<span class="swatch" aria-hidden="true"></span><span class="swatch-name"></span><span class="swatch-time"></span>';
      li.querySelector('.swatch-name')!.textContent = scene.title || `Scene ${scene.index + 1}`;
      li.querySelector('.swatch-time')!.textContent = formatTime(scene.start);
      return li;
    })
  );
}

// ---------- Choosing a film ----------

function select(film: Film): void {
  if (film === current) return;
  current = film;
  const media = player.querySelector('mux-video') as (HTMLElement & { pause?: () => void }) | null;
  media?.pause?.();
  player.setAttribute('content-title', film.title);
  media?.setAttribute('src', `https://stream.mux.com/${film.id}.m3u8`);
  syncCards();
  void paintMark(film);
  void paintSteps(film);
  const r = playerHost.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) playerHost.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
}

function syncCards(): void {
  for (const card of cards) card.button.setAttribute('aria-pressed', String(card.film === current));
}

// ---------- Copy the snippet ----------

const copy = $<HTMLButtonElement>('.code-copy');
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('.code code').textContent ?? '');
    copy.textContent = 'Copied';
  } catch {
    copy.textContent = 'Press Ctrl+C';
  }
  window.setTimeout(() => (copy.textContent = 'Copy'), 1600);
});

// ---------- Start ----------

syncCards();
void paintMark(current);
void paintCards();
void paintSteps(current);

// Repaint only when the page width changes, not when content below grows.
let resizeFrame = 0;
let lastWidth = document.documentElement.clientWidth;
new ResizeObserver(() => {
  const width = document.documentElement.clientWidth;
  if (width === lastWidth) return;
  lastWidth = width;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    void paintMark(current);
    void paintCards();
    void paintSteps(current);
  });
}).observe(document.documentElement);
