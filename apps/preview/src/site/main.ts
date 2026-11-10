import '@videojs/html/i18n';
import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';
import { tintTranslations } from '@/video/tint/i18n';
import { TintModel } from '@/video/tint/model';
import { registerI18n } from '@videojs/html/i18n';
import type { MediaTextCue } from '@videojs/html';

import { FILMS, type Film } from './films';
import './site.css';

const PLACEHOLDER = '<!-- Add a compatible media component here. -->';
const LIT = 'saturate(1.4) contrast(1.08) brightness(1.06)';
const BRAND = '#f5c518';
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.tintMotion === 'reduce';
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- Fingerprints for the page

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
      const model = new TintModel();
      await model.setTrack({ cues: parseVtt(await (await fetch(src)).text()), src, crossOrigin: 'anonymous' });
      return model;
    })();
    models.set(film.id, p);
  }
  return p;
}

function sizeOf(el: Element): { w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { w: Math.max(1, Math.round(r.width * dpr())), h: Math.max(1, Math.round(r.height * dpr())) };
}

function draw(canvas: HTMLCanvasElement, source: HTMLCanvasElement | null): void {
  if (!source) return;
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d')!.drawImage(source, 0, 0);
}

/** Show one storyboard frame in an element, scaled to the element's width. */
function showFrame(model: TintModel, el: HTMLElement, index: number): void {
  const f = model.frames[index];
  const img = f && model.image(f.url);
  if (!f || !img) return;
  const k = (el.getBoundingClientRect().width || 200) / f.w;
  el.style.backgroundImage = `url("${f.url}")`;
  el.style.backgroundSize = `${img.naturalWidth * k}px ${img.naturalHeight * k}px`;
  el.style.backgroundPosition = `${-f.x * k}px ${-f.y * k}px`;
}

const accent = (model: TintModel, frame: number) => {
  const a = model.accentOf(frame);
  return `oklch(${a.l} ${a.c} ${a.h})`;
};

// ---------------------------------------------------------------- The player

let current: Film = FILMS[0]!;
const frame = $('.player-frame');
const i18n = document.createElement('media-i18n');
i18n.setAttribute('lang', 'en');
const player = document.createElement('video-player');
player.setAttribute('content-title', current.title);
player.innerHTML = skinTemplate.replace(
  PLACEHOLDER,
  `<mux-video src="https://stream.mux.com/${current.id}.m3u8" playsinline crossorigin="anonymous" preload="metadata"></mux-video>`
);
i18n.append(player);
$('#player').append(i18n);
const media = () => player.querySelector('mux-video') as (HTMLElement & HTMLMediaElement) | null;
const skin = () => player.querySelector<HTMLElement>('.media-skin');

// ---------------------------------------------------------------- The stage: the film, then the player

const stage = $('.stage');
const pin = $('.stage-pin');
const view = $('.stage-view');
const hero = $('.hero');
const heroFilm = $('.hero-film');
const heroCanvas = $<HTMLCanvasElement>('.hero-print');
const heroCopy = $('.hero-copy');
const caption = $('.hero-caption');
const shade = $('.hero-shade');
let heroModel: TintModel | null = null;

async function paintHero(film: Film): Promise<void> {
  const model = await modelFor(film);
  if (film !== current || model.status !== 'ready') return;
  // Always drawn at full-screen size; while the film shrinks into the player, the browser scales this bitmap.
  const print = model.print(Math.round(view.clientWidth * dpr()), Math.round(view.clientHeight * dpr()), LIT);
  if (!print) return;
  heroModel = model;
  draw(heroCanvas, print);
  heroFilm.dataset.ready = '';
  // The accent swatch shows this film's scene colours; the bar's dot wears its signature colour.
  const stops = model.scenes.map((s) => accent(model, s.face));
  if (stops.length > 1) $('.console').style.setProperty('--film-swatch', `conic-gradient(${[...stops, stops[0]].join(', ')})`);
  $('.dock').style.setProperty('--dock-chip', accent(model, model.signature()));
  startIdle();
}

// How far the film has shrunk into the player: 0 is full screen, 1 is landed.
let progress = 0;
let radius = 16;
const travel = () => Math.max(1, stage.offsetHeight - pin.offsetHeight);
const stageEnd = () => stage.getBoundingClientRect().top + window.scrollY + travel();

function layoutStage(): void {
  const p = clamp(-stage.getBoundingClientRect().top / travel(), 0, 1);
  progress = p;
  const target = skin()?.getBoundingClientRect();
  const v = view.getBoundingClientRect();
  if (target?.width) {
    const quiet = calm();
    const e = quiet ? 0 : easeInOut(p);
    const x = lerp(0, target.left - v.left, e);
    const y = lerp(0, target.top - v.top, e);
    const w = lerp(v.width, target.width, e);
    const h = lerp(v.height, target.height, e);
    const s = hero.style;
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.width = `${w}px`;
    s.height = `${h}px`;
    s.borderRadius = `${lerp(0, radius, e)}px`;
    // Hand over to the real player, whose poster is the same fingerprint, as the film lands.
    const gone = quiet ? p > 0.3 : p > 0.985;
    hero.style.opacity = quiet ? (gone ? '0' : '1') : String(1 - smooth(0.9, 0.985, p));
    hero.toggleAttribute('data-gone', gone);
    hero.toggleAttribute('data-calm', quiet);
    hero.toggleAttribute('data-moving', p > 0.01);
    const fade = 1 - smooth(0, quiet ? 0.2 : 0.32, p);
    heroCopy.style.opacity = caption.style.opacity = String(fade);
    heroCopy.style.translate = caption.style.translate = quiet ? '' : `0 ${-p * 90}px`;
    shade.style.opacity = String(1 - smooth(0.1, 0.6, p));
  }
  if (p <= 0.01) startIdle();
  if (pending && p >= 0.999) runPending();
  markSection();
}

let layoutRaf = 0;
const requestLayout = () => {
  if (!layoutRaf) layoutRaf = requestAnimationFrame(() => ((layoutRaf = 0), layoutStage()));
};
window.addEventListener('scroll', requestLayout, { passive: true });
new ResizeObserver(() => {
  const s = skin();
  if (s) radius = parseFloat(getComputedStyle(s).borderTopLeftRadius) || 16;
  requestLayout();
}).observe(frame);

/** Scroll to where the film has landed in the player. */
function goToPlayer(instant = false): void {
  window.scrollTo({ top: stageEnd(), behavior: instant || calm() ? 'auto' : 'smooth' });
  requestLayout();
}

// After a click on a moment, play from there once the film has landed, so the poster's fold is seen.
let pending: (() => void) | null = null;
let pendingTimer = 0;
function runPending(): void {
  const run = pending;
  pending = null;
  window.clearTimeout(pendingTimer);
  run?.();
}
function watchFrom(time: number): void {
  const m = media();
  if (!m) return;
  const seek = () => (m.currentTime = Math.max(0, time - 0.5));
  if (m.readyState >= 1) seek();
  else m.addEventListener('loadedmetadata', seek, { once: true });
  pending = () => void m.play().catch(() => undefined);
  pendingTimer = window.setTimeout(runPending, 1800);
  goToPlayer();
}

// Keyboard users who tab into the player while the film still covers it are taken to it.
pin.addEventListener('focusin', (e) => {
  if (progress < 0.99 && !(e.target as Element).closest('.stage-view')) goToPlayer(true);
});
for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href="#watch"]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    goToPlayer();
  });
}
$('.skip').addEventListener('click', (e) => {
  e.preventDefault();
  goToPlayer(true);
  player.querySelector<HTMLElement>('[tabindex]')?.focus({ preventScroll: true });
});

// ---------------------------------------------------------------- The lens: move across the film to see its moments

const lens = $('.hero-lens');
const lensFrame = $('.hero-lens-frame');
const lensCard = $('.hero-lens-card');
const lensScene = $('.hero-lens-scene');
const lensTime = $('.hero-lens-time');

// The lens follows the pointer with a little lag, so it feels like moving through the film rather than jumping.
let lensTarget = 0;
let lensX = 0;
let lensFrameIndex = -1;
let lensRaf = 0;
function moveLens(): void {
  lensX = calm() ? lensTarget : lensX + (lensTarget - lensX) * 0.22;
  const width = heroFilm.clientWidth;
  lens.style.setProperty('--x', `${lensX}px`);
  const half = (lensCard.offsetWidth || 220) / 2 + 12;
  lens.style.setProperty('--card-x', `${Math.max(half, Math.min(width - half, lensX))}px`);
  hero.style.setProperty('--light-x', `${(lensX / width) * 100}%`);
  if (heroModel) {
    const t = (lensX / width) * heroModel.duration;
    const f = heroModel.frameAt(t);
    if (f !== lensFrameIndex) {
      lensFrameIndex = f;
      const fr = heroModel.frames[f];
      if (fr?.w && fr.h) lensFrame.style.aspectRatio = `${fr.w} / ${fr.h}`;
      showFrame(heroModel, lensFrame, f);
      lens.style.setProperty('--lens-color', accent(heroModel, f));
      const scene = heroModel.scenes[heroModel.sceneAt(t)];
      lensScene.textContent = scene ? scene.title || `Scene ${scene.index + 1}` : '';
    }
    lensTime.textContent = formatTime(t);
  }
  if (Math.abs(lensTarget - lensX) > 0.5) lensRaf = requestAnimationFrame(moveLens);
  else lensRaf = 0;
}

function pointAt(clientX: number): void {
  const r = heroFilm.getBoundingClientRect();
  lensTarget = clamp(clientX - r.left, 0, r.width);
  if (!hero.hasAttribute('data-looking')) {
    lensX = lensTarget;
    hero.dataset.looking = '';
  }
  if (!lensRaf) lensRaf = requestAnimationFrame(moveLens);
}

hero.addEventListener('pointermove', (e) => {
  lastTouch = performance.now();
  pointAt(e.clientX);
});
hero.addEventListener('pointerdown', (e) => {
  lastTouch = performance.now();
  pointAt(e.clientX);
});
hero.addEventListener('pointerleave', () => {
  lastTouch = performance.now();
  delete hero.dataset.looking;
});
hero.addEventListener('click', (e) => {
  if (!heroModel) return;
  const r = heroFilm.getBoundingClientRect();
  watchFrom(((e.clientX - r.left) / r.width) * heroModel.duration);
});

// Until someone moves across the film, the lens wanders through it on its own, so the first seconds already
// show what the film can do. It stops when a pointer arrives, waits after it leaves, and never runs with
// reduced motion, off screen, or once the film starts shrinking.
const IDLE_AFTER_MS = 3500;
let lastTouch = -Infinity;
let idleRaf = 0;
let idleStart = 0;
function idle(now: number): void {
  idleRaf = 0;
  if (calm() || progress > 0.01 || document.hidden || !heroModel) return;
  idleRaf = requestAnimationFrame(idle);
  if (now - lastTouch < IDLE_AFTER_MS) return;
  if (!idleStart) idleStart = now;
  const t = (now - idleStart) / 1000;
  // Two slow waves, so the path through the film never looks like a metronome.
  const p = 0.5 - 0.36 * Math.cos(t * 0.21) + 0.06 * Math.sin(t * 0.53);
  lensTarget = clamp(p * heroFilm.clientWidth, 0, heroFilm.clientWidth);
  hero.dataset.looking = '';
  if (!lensRaf) lensRaf = requestAnimationFrame(moveLens);
}
function startIdle(): void {
  if (!idleRaf) idleRaf = requestAnimationFrame(idle);
}
document.addEventListener('visibilitychange', startIdle);

// ---------------------------------------------------------------- Choosing a film (one place, under the player)

const picks = FILMS.map((film) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pick';
  b.innerHTML = '<canvas aria-hidden="true"></canvas><span></span>';
  b.querySelector('span')!.textContent = film.title;
  b.addEventListener('click', () => select(film));
  $('.films-pick').append(b);
  return { film, button: b, canvas: b.querySelector('canvas')! };
});

async function paintPicks(): Promise<void> {
  await Promise.all(
    picks.map(async ({ film, canvas }) => {
      const model = await modelFor(film).catch(() => null);
      if (!model || model.status !== 'ready') return;
      const s = sizeOf(canvas);
      draw(canvas, model.print(s.w, s.h, LIT));
    })
  );
}

function syncChoice(): void {
  for (const p of picks) p.button.setAttribute('aria-pressed', String(p.film === current));
  $('.cap-title').textContent = `${current.title} (${current.year})`;
  $('.cap-line').textContent = current.line;
}

function select(film: Film): void {
  if (film === current) return;
  current = film;
  const m = media();
  m?.pause();
  player.setAttribute('content-title', film.title);
  m?.setAttribute('src', `https://stream.mux.com/${film.id}.m3u8`);
  syncChoice();
  void paintHero(film);
  void paintSteps(film);
}

// ---------------------------------------------------------------- How it works, drawn from the current film

async function paintSteps(film: Film): Promise<void> {
  const model = await modelFor(film);
  if (film !== current || model.status !== 'ready') return;

  $<HTMLImageElement>('.step-storyboard img').src = model.frames[0]!.url;
  $('.step-frames').textContent = String(model.frames.length);
  $('.step-scenes').textContent = String(model.scenes.length);

  // One bright, colourful frame cut into strips, each strip squeezed to a single line of colour.
  const slits = $<HTMLCanvasElement>('.step-slits');
  const { w, h } = sizeOf(slits);
  slits.width = w;
  slits.height = h;
  const g = slits.getContext('2d')!;
  const f = model.frames.reduce((best, fr) => (fr.chroma * fr.lab[0] > best.chroma * best.lab[0] ? fr : best), model.frames[0]!);
  const img = model.image(f.url);
  if (img) {
    const K = 12;
    const frameW = w * 0.6;
    const frameH = Math.min(h * 0.9, (frameW * f.h) / f.w);
    const top = (h - frameH) / 2;
    g.drawImage(img, f.x, f.y, f.w, f.h, 0, top, frameW, frameH);
    g.fillStyle = 'rgba(0,0,0,0.9)';
    for (let k = 1; k < K; k++) g.fillRect(Math.round((k * frameW) / K), top, Math.max(1, dpr()), frameH);
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
      cg.drawImage(img, f.x + (k * f.w) / K, f.y, f.w / K, f.h, 0, 0, 1, column.height);
      g.drawImage(column, barsX + k * (barW + gap), top, barW, frameH);
    }
  }

  const printCanvas = $<HTMLCanvasElement>('.step-print');
  const size = sizeOf(printCanvas);
  draw(printCanvas, model.print(size.w, size.h, LIT));
  const pg = printCanvas.getContext('2d')!;
  pg.fillStyle = 'rgba(0,0,0,0.95)';
  for (const scene of model.scenes.slice(1)) pg.fillRect(Math.round((scene.start / model.duration) * size.w) - dpr(), 0, 2 * dpr(), size.h);
}

// ---------------------------------------------------------------- Test the player

const loadedLocales = new Set(['en']);
async function setLanguage(lang: string): Promise<void> {
  if (!loadedLocales.has(lang)) {
    const packs: Record<string, () => Promise<{ default: unknown }>> = {
      fr: () => import('@videojs/html/i18n/locales/fr'),
      ja: () => import('@videojs/html/i18n/locales/ja'),
      ar: () => import('@videojs/html/i18n/locales/ar'),
    };
    const pack = await packs[lang]?.();
    if (pack) registerI18n(lang, pack.default as never);
    if (tintTranslations[lang]) registerI18n(lang, tintTranslations[lang] as never);
    loadedLocales.add(lang);
  }
  i18n.setAttribute('lang', lang);
  frame.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
}
registerI18n('en', tintTranslations.en as never);

const form = $<HTMLFormElement>('.console');
const langButton = $<HTMLButtonElement>('[popovertarget="lang-menu"]');
const langMenu = $('#lang-menu');
const LANG_NAMES: Record<string, string> = { en: 'English', fr: 'Français', ja: '日本語', ar: 'العربية' };

// Open the language menu next to its button: below if it fits, otherwise above.
langMenu.addEventListener('toggle', (event) => {
  const open = (event as ToggleEvent).newState === 'open';
  langButton.setAttribute('aria-expanded', String(open));
  if (!open) return;
  const b = langButton.getBoundingClientRect();
  const m = langMenu.getBoundingClientRect();
  const below = b.bottom + 8 + m.height <= window.innerHeight;
  langMenu.style.top = `${below ? b.bottom + 8 : b.top - 8 - m.height}px`;
  langMenu.style.left = `${clamp(b.left + b.width / 2 - m.width / 2, 12, window.innerWidth - m.width - 12)}px`;
  langMenu.querySelector<HTMLInputElement>('input:checked')?.focus();
});
window.addEventListener('scroll', () => langMenu.matches(':popover-open') && langMenu.hidePopover(), { passive: true });
langButton.setAttribute('aria-expanded', 'false');

// Arrow keys browse the languages with the menu open; a click, a tap, Enter or Space picks and closes.
let keyboardPick = false;
langMenu.addEventListener('keydown', (e) => {
  keyboardPick = e.key.startsWith('Arrow');
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    langMenu.hidePopover();
    langButton.focus();
  }
});
langMenu.addEventListener('pointerdown', () => (keyboardPick = false));

form.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const on = input.type !== 'checkbox' || input.checked;
  const value = input.value;
  const root = document.documentElement;
  switch (input.name) {
    case 'page':
      root.dataset.theme = value;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'light' ? '#ffffff' : '#000000');
      break;
    case 'size':
      frame.dataset.size = value;
      break;
    case 'shape': {
      const [a, b] = value.split('/').map(Number);
      frame.style.setProperty('--shape', value);
      frame.style.setProperty('--ar', String((a ?? 16) / (b ?? 9)));
      break;
    }
    case 'motion':
      if (on) root.dataset.tintMotion = 'reduce';
      else delete root.dataset.tintMotion;
      requestLayout();
      break;
    case 'contrast':
      if (on) frame.dataset.tintContrast = 'more';
      else delete frame.dataset.tintContrast;
      break;
    case 'accent':
      if (value === 'brand') frame.style.setProperty('--media-accent-color', BRAND);
      else frame.style.removeProperty('--media-accent-color');
      break;
    case 'lang': {
      void setLanguage(value);
      const name = LANG_NAMES[value] ?? value;
      const now = langButton.querySelector('.lang-now')!;
      now.textContent = name;
      now.setAttribute('lang', value);
      langButton.setAttribute('aria-label', `Player language: ${name}`);
      if (event.isTrusted && !keyboardPick) {
        langMenu.hidePopover();
        langButton.focus();
      }
      break;
    }
  }
});
form.addEventListener('submit', (e) => e.preventDefault());

// ---------------------------------------------------------------- The bar marks the section you are reading

const dockLinks = [...document.querySelectorAll<HTMLAnchorElement>('.dock-links a')];
const sections: [string, HTMLElement][] = [
  ['watch', $('#test')],
  ['how', $('#how')],
  ['care', $('#care')],
  ['install', $('#install')],
];
function markSection(): void {
  const mid = window.innerHeight / 2;
  let id: string | null = progress > 0.5 && stage.getBoundingClientRect().bottom > mid ? 'watch' : null;
  for (const [name, el] of sections) {
    const r = el.getBoundingClientRect();
    if (r.top <= mid && r.bottom > mid) id = name;
  }
  for (const a of dockLinks) {
    if (a.dataset.section === id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
}

// ---------------------------------------------------------------- Copy the snippet

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

// ---------------------------------------------------------------- Start

syncChoice();
void paintHero(current);
void paintPicks();
void paintSteps(current);
layoutStage();

// Repaint when the screen size changes.
let resizeFrame = 0;
let lastSize = '';
new ResizeObserver(() => {
  const size = `${view.clientWidth}x${view.clientHeight}`;
  if (size === lastSize) return;
  const widthChanged = lastSize.split('x')[0] !== String(view.clientWidth);
  lastSize = size;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    void paintHero(current);
    if (widthChanged) {
      void paintPicks();
      void paintSteps(current);
    }
    requestLayout();
  });
}).observe(view);
