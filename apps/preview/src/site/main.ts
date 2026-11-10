import '@videojs/html/i18n';
import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';
import { tintTranslations } from '@/video/tint/i18n';
import { TintModel } from '@/video/tint/model';
import { registerI18n } from '@videojs/html/i18n';
import type { MediaTextCue } from '@videojs/html';

import Lenis from 'lenis';
import Snap from 'lenis/snap';
import 'lenis/dist/lenis.css';

import { FILMS, type Film } from './films';
import { Glass } from './glass';
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

// ---------------------------------------------------------------- Films and their storyboards

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
  if (f.w && f.h) el.style.aspectRatio = `${f.w} / ${f.h}`;
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

// ---------------------------------------------------------------- The columns: one per real storyboard frame

/** Each frame becomes one column, drawn from an atlas where it is SLITS pixels wide. */
const SLITS = 3;
const ATLAS_H = 240;
interface Column {
  film: number;
  frame: number;
  ax: number;
  /** Place in the spectrum, 0..1. */
  rank: number;
}
let columns: Column[] = [];
let spectrum: Column[] = [];
let atlas: HTMLCanvasElement | null = null;
const filmModels: (TintModel | null)[] = FILMS.map(() => null);

function buildColumns(): void {
  const ready = filmModels.every((m) => m?.status === 'ready');
  if (!ready) return;
  const all: (Column & { key: number })[] = [];
  let ax = 0;
  filmModels.forEach((model, film) => {
    model!.frames.forEach((f, i) => {
      // Sort by the frame's mean colour, which is what its column looks like. Near-greys open the spectrum, dark to
      // light; colours follow round the wheel from red, each hue band running dark to light.
      const [L, a, b] = f.lab;
      const chroma = Math.hypot(a, b);
      const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360 - 15) % 360;
      const key = chroma < 0.018 ? L : 1 + Math.floor(hue / 15) + L * 0.99;
      all.push({ film, frame: i, ax, rank: 0, key });
      ax += SLITS;
    });
  });
  const raw = document.createElement('canvas');
  raw.width = ax;
  raw.height = ATLAS_H;
  const rg = raw.getContext('2d')!;
  rg.imageSmoothingQuality = 'high';
  for (const c of all) {
    const model = filmModels[c.film]!;
    const f = model.frames[c.frame]!;
    const img = model.image(f.url);
    if (!img) continue;
    for (let k = 0; k < SLITS; k++) rg.drawImage(img, f.x + (k * f.w) / SLITS, f.y, f.w / SLITS, f.h, c.ax + k, 0, 1, ATLAS_H);
  }
  atlas = document.createElement('canvas');
  atlas.width = ax;
  atlas.height = ATLAS_H;
  const ag = atlas.getContext('2d')!;
  ag.filter = LIT;
  ag.drawImage(raw, 0, 0);

  spectrum = [...all].sort((p, q) => p.key - q.key);
  spectrum.forEach((c, r) => (c.rank = r / spectrum.length));
  columns = all;
  view.dataset.ready = '';
  requestDraw();
}

// ---------------------------------------------------------------- The stage

const stage = $('.stage');
const pin = $('.stage-pin');
const view = $('.stage-view');
const canvas = $<HTMLCanvasElement>('.sv-canvas');
const ctx = canvas.getContext('2d')!;
const back = $('.sv-back');
const shade = $('.sv-shade');
const copy = $('.sv-copy');
const caption = $('.sv-caption');
const titles = $('.sv-titles');
const lens = $('.sv-lens');
const lensFrame = $('.sv-lens-frame');
const lensCard = $('.sv-lens-card');
const lensName = $('.sv-lens-name');
const lensTime = $('.sv-lens-time');
const glassCanvas = $<HTMLCanvasElement>('.sv-glass-canvas');
const glass = Glass.create(glassCanvas);
if (glass) lens.dataset.glass = '';
const bar = $('.bar');

// The film names over the four panels in the first act.
const titleEls = FILMS.map((film) => {
  const s = document.createElement('span');
  s.innerHTML = '<b></b><small></small>';
  s.querySelector('b')!.textContent = film.title;
  s.querySelector('small')!.textContent = String(film.year);
  titles.append(s);
  return s;
});

// Pointing at a panel in the first act widens it.
const weights = FILMS.map(() => 1);
let hoverFilm = -1;

let progress = 0;
const travel = () => Math.max(1, stage.offsetHeight - pin.offsetHeight);
const stageEnd = () => stage.getBoundingClientRect().top + window.scrollY + travel();
/** Where the spectrum is held, and where the film has landed. */
const SPECTRUM_AT = 0.48;

// Act boundaries along the scroll.
const toSpectrum = (p: number) => (calm() ? (p > 0.24 ? 1 : 0) : smooth(0.08, 0.4, p));
const toPlayer = (p: number) => (calm() ? (p > 0.64 ? 1 : 0) : smooth(0.56, 0.9, p));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const rel = (el: Element | null, v: DOMRect): Box | null => {
  const r = el?.getBoundingClientRect();
  return r && r.width ? { x: r.left - v.left, y: r.top - v.top, w: r.width, h: r.height } : null;
};

/** Panel edges for the first act. */
function panels(W: number): { x: number; w: number }[] {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = 0;
  return weights.map((wt) => {
    const w = (wt / total) * W;
    const out = { x, w };
    x += w;
    return out;
  });
}

const STAGGER = 0.6;
const wave = (phase: number, pos: number) => (calm() ? phase : easeInOut(clamp(phase * (1 + STAGGER) - pos * STAGGER, 0, 1)));

let drawRaf = 0;
function requestDraw(): void {
  if (!drawRaf) drawRaf = requestAnimationFrame(() => ((drawRaf = 0), render()));
}

function render(): void {
  const p = clamp(-stage.getBoundingClientRect().top / travel(), 0, 1);
  progress = p;
  const v = view.getBoundingClientRect();
  const W = v.width;
  const H = v.height;
  const s1 = toSpectrum(p);
  const s2 = toPlayer(p);

  // Ease the panel widths toward the pointed-at film.
  let settling = false;
  weights.forEach((wt, k) => {
    const goal = hoverFilm === k && s1 === 0 ? 2.1 : 1;
    const next = calm() ? goal : wt + (goal - wt) * 0.16;
    if (Math.abs(next - goal) > 0.002) settling = true;
    weights[k] = Math.abs(next - goal) > 0.002 ? next : goal;
  });

  // Canvas at the view's pixel size.
  const k = dpr();
  const cw = Math.round(W * k);
  const ch = Math.round(H * k);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;

  const P = panels(W);
  P.forEach((panel, i) => {
    const t = titleEls[i]!;
    t.style.left = `${panel.x + 16}px`;
    t.style.maxWidth = `${Math.max(0, panel.w - 24)}px`;
  });

  if (atlas && columns.length) {
    const target = rel(skin(), v);
    const picks = pickEls.map((b) => rel(b.canvas, v));
    const counts = filmModels.map((m) => m?.frames.length ?? 1);
    for (const c of columns) {
      const n = counts[c.film]!;
      // Act 1: the film's own panel, in time order.
      const panel = P[c.film]!;
      const tx = panel.x + (panel.w * c.frame) / n;
      const tw = panel.w / n;
      // Act 2: its place in the spectrum.
      const sx = W * c.rank;
      const sw = W / spectrum.length;
      // Act 3: back in time order, in the player or in its film's button.
      const dest = c.film === currentIndex() ? target : picks[c.film];
      const box = dest ?? { x: sx, y: H, w: sw, h: 0 };
      const dx = box.x + (box.w * c.frame) / n;
      const dw = box.w / n;

      const e1 = wave(s1, (tx + tw / 2) / W);
      const e2 = wave(s2, sx / W);
      let x = lerp(tx, sx, e1);
      let w = lerp(tw, sw, e1);
      let y = 0;
      let h = H;
      // A lift as each column travels, so the wave reads as flight rather than a slide.
      const lift = calm() ? 0 : Math.sin(Math.PI * e1) * 0.1 + Math.sin(Math.PI * e2) * 0.06;
      y += (H * lift) / 2;
      h -= H * lift;
      x = lerp(x, dx, e2);
      w = lerp(w, dw, e2);
      y = lerp(y, box.y, e2);
      h = lerp(h, box.h, e2);
      ctx.drawImage(atlas, c.ax, 0, SLITS, ATLAS_H, x, y, w + 0.6, h);
    }
  }

  // Words and light for each act.
  const quiet = calm();
  const copyFade = 1 - smooth(0.02, 0.13, p);
  copy.style.opacity = String(copyFade);
  copy.style.translate = quiet ? '' : `0 ${-p * 260}px`;
  titles.style.opacity = String(1 - smooth(0.03, 0.1, p));
  const cap = smooth(0.32, 0.41, p) * (1 - smooth(0.55, 0.62, p));
  caption.style.opacity = String(cap);
  caption.style.translate = quiet ? '' : `0 ${(1 - smooth(0.3, 0.42, p)) * 30 - smooth(0.55, 0.62, p) * 30}px`;
  shade.style.opacity = String(1 - smooth(0.56, 0.7, p));

  // Hand over to the real player and buttons as the frames land. Its poster is the same fingerprint.
  const gone = quiet ? p > 0.7 : p > 0.985;
  const fade = quiet ? (gone ? 0 : 1) : 1 - smooth(0.9, 0.985, p);
  canvas.style.opacity = back.style.opacity = String(fade);
  view.toggleAttribute('data-gone', gone);
  view.toggleAttribute('data-touchable', !gone && (s2 === 0));
  bar.toggleAttribute('data-solid', p > 0.9);

  // The lens only while an act is held still.
  const still = (s1 === 0 || (s1 === 1 && s2 === 0)) && !gone;
  if (!still) lens.removeAttribute('data-on');
  else drawGlass();

  if (p >= 0.999) landed();
  else if (p < 0.6) leftPlayer();
  markSection();
  if (settling) requestDraw();
  if (p <= 0.01) startIdle();
}

window.addEventListener('scroll', requestDraw, { passive: true });
new ResizeObserver(requestDraw).observe(frame);
new ResizeObserver(requestDraw).observe(view);

// ---------------------------------------------------------------- The lens: point at a moment

let lensX = 0;
let lensTarget = 0;
let lensRaf = 0;
let lensKey = '';

/** The film and frame under a point, in whichever act is held. */
function hit(x: number): { film: number; frame: number } | null {
  if (!columns.length) return null;
  const W = view.clientWidth;
  const s1 = toSpectrum(progress);
  if (s1 === 1) {
    const c = spectrum[clamp(Math.floor((x / W) * spectrum.length), 0, spectrum.length - 1)]!;
    return { film: c.film, frame: c.frame };
  }
  const P = panels(W);
  const film = Math.max(0, P.findIndex((p) => x >= p.x && x < p.x + p.w));
  const n = filmModels[film]?.frames.length ?? 1;
  return { film, frame: clamp(Math.floor(((x - P[film]!.x) / P[film]!.w) * n), 0, n - 1) };
}

function moveLens(): void {
  lensRaf = 0;
  lensX = calm() ? lensTarget : lensX + (lensTarget - lensX) * 0.22;
  const W = view.clientWidth;
  lens.style.setProperty('--x', `${lensX}px`);
  const half = (lensCard.offsetWidth || 220) / 2 + 12;
  lens.style.setProperty('--card-x', `${clamp(lensX, half, W - half)}px`);
  const h = hit(lensX);
  const model = h && filmModels[h.film];
  if (h && model) {
    const key = `${h.film}:${h.frame}`;
    if (key !== lensKey) {
      lensKey = key;
      if (glass) setGlassFrame(h.film, model, h.frame, key);
      else showFrame(model, lensFrame, h.frame);
      lens.style.setProperty('--lens-color', accent(model, h.frame));
      lensName.textContent = FILMS[h.film]!.title;
      lensTime.textContent = formatTime(model.frames[h.frame]!.start);
    }
  }
  drawGlass((lensX - lensTarget) * 0.004);
  if (Math.abs(lensTarget - lensX) > 0.5) lensRaf = requestAnimationFrame(moveLens);
}

/** Draw the glass where its card sits, over the columns as they are now. */
function drawGlass(slide = 0): void {
  if (!glass || !lens.hasAttribute('data-on')) return;
  const v = view.getBoundingClientRect();
  const g = glassCanvas.getBoundingClientRect();
  if (!g.width) return;
  try {
    glass.draw(canvas, g.left - v.left + g.width / 2, g.top - v.top + g.height / 2, g.width, dpr(), slide);
  } catch {
    // A canvas the browser will not hand to WebGL: fall back to the flat card.
    delete lens.dataset.glass;
  }
}

// The storyboard tile shows at once; when the glass rests on a moment, a sharp frame from Mux replaces it.
const sharpFrames = new Map<string, HTMLImageElement>();
let sharpTimer = 0;
function setGlassFrame(film: number, model: TintModel, index: number, key: string): void {
  const f = model.frames[index];
  const img = f && model.image(f.url);
  if (!f || !img || !glass) return;
  glass.setFrame(img, f.x, f.y, f.w, f.h);
  lensFrame.style.removeProperty('background-image');
  window.clearTimeout(sharpTimer);
  sharpTimer = window.setTimeout(() => {
    const url = `https://image.mux.com/${FILMS[film]!.id}/thumbnail.webp?time=${f.start.toFixed(2)}&width=640`;
    let sharp = sharpFrames.get(url);
    const apply = () => {
      if (lensKey !== key || !sharp?.naturalWidth) return;
      glass.setFrame(sharp, 0, 0, sharp.naturalWidth, sharp.naturalHeight);
      drawGlass();
    };
    if (sharp?.complete) return apply();
    if (!sharp) {
      sharp = new Image();
      sharp.crossOrigin = 'anonymous';
      sharp.decoding = 'async';
      sharp.src = url;
      sharpFrames.set(url, sharp);
    }
    sharp.addEventListener('load', apply, { once: true });
  }, 220);
}

function pointAt(x: number): void {
  lensTarget = clamp(x, 0, view.clientWidth);
  if (!lens.hasAttribute('data-on')) lensX = lensTarget;
  lens.dataset.on = '';
  if (!lensRaf) lensRaf = requestAnimationFrame(moveLens);
}

const still = () => {
  const s1 = toSpectrum(progress);
  return (s1 === 0 || (s1 === 1 && toPlayer(progress) === 0)) && progress < 0.9;
};

canvas.addEventListener('pointermove', (e) => {
  lastTouch = performance.now();
  if (!still()) return;
  const x = e.clientX - view.getBoundingClientRect().left;
  pointAt(x);
  const film = toSpectrum(progress) === 0 ? (hit(x)?.film ?? -1) : -1;
  if (film !== hoverFilm) {
    hoverFilm = film;
    requestDraw();
  }
});
canvas.addEventListener('pointerleave', () => {
  lastTouch = performance.now();
  lens.removeAttribute('data-on');
  hoverFilm = -1;
  requestDraw();
});
canvas.addEventListener('click', (e) => {
  if (!still()) return;
  const h = hit(e.clientX - view.getBoundingClientRect().left);
  const model = h && filmModels[h.film];
  if (!h || !model) return;
  hoverFilm = -1;
  const switching = FILMS[h.film] !== current;
  if (switching) select(FILMS[h.film]!);
  watchFrom(model.frames[h.frame]!.start, switching);
});

// Until someone points at the films, the lens wanders through all four on its own.
const IDLE_AFTER_MS = 3500;
let lastTouch = -Infinity;
let idleRaf = 0;
let idleStart = 0;
function idle(now: number): void {
  idleRaf = 0;
  if (calm() || progress > 0.01 || document.hidden || !columns.length) return;
  idleRaf = requestAnimationFrame(idle);
  if (now - lastTouch < IDLE_AFTER_MS) return;
  if (!idleStart) idleStart = now;
  const t = (now - idleStart) / 1000;
  const p = 0.5 - 0.42 * Math.cos(t * 0.16) + 0.04 * Math.sin(t * 0.47);
  pointAt(p * view.clientWidth);
}
function startIdle(): void {
  if (!idleRaf) idleRaf = requestAnimationFrame(idle);
}
document.addEventListener('visibilitychange', startIdle);

// ---------------------------------------------------------------- Landing: the poster folds into the timeline

let pending: (() => void) | null = null;
let pendingTimer = 0;
let autoplayed = false;
let userPaused = false;
let ourPause = false;

function runPending(): void {
  const run = pending;
  pending = null;
  window.clearTimeout(pendingTimer);
  run?.();
}

// ---------------------------------------------------------------- Smooth scroll (Lenis, MIT)

// Inertial scrolling, so the three acts glide rather than step, with gentle stops at each act. Off with reduced motion,
// where the page scrolls natively and the CSS stops apply instead.
let lenis: Lenis | null = null;
let snap: Snap | null = null;
function lenisFrame(time: number): void {
  if (!lenis) return;
  lenis.raf(time);
  requestAnimationFrame(lenisFrame);
}
function placeSnaps(): void {
  if (!lenis) return;
  snap?.destroy();
  snap = new Snap(lenis, { type: 'proximity', distanceThreshold: '28%', duration: 0.9, debounce: 260 });
  const top = stage.getBoundingClientRect().top + window.scrollY;
  for (const at of [0, SPECTRUM_AT, 1]) snap.add(Math.round(top + travel() * at));
}
function setSmooth(): void {
  const want = !calm();
  if (want && !lenis) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, anchors: false });
    placeSnaps();
    requestAnimationFrame(lenisFrame);
  } else if (!want && lenis) {
    snap?.destroy();
    snap = null;
    lenis.destroy();
    lenis = null;
  }
}

/** Scroll to where the frames land in the player. */
function goToPlayer(instant = false): void {
  if (lenis && !instant) {
    lenis.scrollTo(stageEnd(), { duration: 1.8, easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2) });
  } else if (lenis) {
    lenis.scrollTo(stageEnd(), { immediate: true, force: true });
  } else {
    window.scrollTo({ top: stageEnd(), behavior: 'auto' });
  }
  requestDraw();
}

/** A click on a moment: land, then play from there with sound. */
function watchFrom(time: number, newSource = false): void {
  const m = media();
  if (!m) return;
  const at = Math.max(0, time - 0.5);
  const seek = () => {
    if (Math.abs(m.currentTime - at) > 1) m.currentTime = at;
  };
  // A just-switched film still reports the old source as ready, so wait for the new one.
  if (m.readyState >= 1 && !newSource) seek();
  else {
    m.addEventListener('loadedmetadata', seek, { once: true });
    m.addEventListener('canplay', seek, { once: true });
  }
  pending = () => {
    m.muted = false;
    void m.play().catch(() => undefined);
  };
  pendingTimer = window.setTimeout(runPending, 2600);
  goToPlayer();
}

function landed(): void {
  if (pending) return runPending();
  const m = media();
  // Arriving by scroll starts the film muted, so the poster folds into the timeline the moment the frames land.
  if (!m || calm() || autoplayed || userPaused || !m.paused) return;
  autoplayed = true;
  m.muted = true;
  void m.play().catch(() => undefined);
}

function leftPlayer(): void {
  const m = media();
  if (m && autoplayed && m.muted && !m.paused) {
    ourPause = true;
    m.pause();
  }
  autoplayed = false;
}

// A pause from the viewer, not from leaving the player, stops the muted start for good.
player.addEventListener(
  'pause',
  () => {
    if (!ourPause && progress > 0.9) userPaused = true;
    ourPause = false;
  },
  true
);

// Keyboard users who tab into the player while the frames still cover it are taken to it.
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

// ---------------------------------------------------------------- The four films, under the player

const pickEls = FILMS.map((film) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pick';
  b.innerHTML = '<canvas aria-hidden="true"></canvas><span></span>';
  b.querySelector('span')!.textContent = film.title;
  b.setAttribute('aria-label', `${film.title}, ${film.year}. ${film.line}`);
  b.addEventListener('click', () => select(film));
  $('.films-pick').append(b);
  return { film, button: b, canvas: b.querySelector('canvas')! };
});
const currentIndex = () => FILMS.indexOf(current);

function paintPicks(): void {
  pickEls.forEach(({ canvas: c }, i) => {
    const model = filmModels[i];
    if (!model || model.status !== 'ready') return;
    const s = sizeOf(c);
    draw(c, model.print(s.w, s.h, LIT));
  });
}

function syncChoice(): void {
  for (const p of pickEls) p.button.setAttribute('aria-pressed', String(p.film === current));
  $('.credit-title').textContent = current.title;
  $('.credit-year').textContent = String(current.year);
  const model = filmModels[currentIndex()];
  if (model?.status === 'ready') {
    const stops = model.scenes.map((s) => accent(model, s.face));
    if (stops.length > 1) document.documentElement.style.setProperty('--film-swatch', `conic-gradient(${[...stops, stops[0]].join(', ')})`);
    bar.style.setProperty('--bar-chip', accent(model, model.signature()));
    paintLights();
    glowKey = '';
    paintGlow();
  }
}

function select(film: Film): void {
  if (film === current) return;
  current = film;
  const m = media();
  if (m) {
    ourPause = true;
    m.pause();
    m.muted = false;
  }
  autoplayed = false;
  userPaused = false;
  player.setAttribute('content-title', film.title);
  m?.setAttribute('src', `https://stream.mux.com/${film.id}.m3u8`);
  syncChoice();
  void paintSteps(film);
  requestDraw();
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

const panel = $('#test-panel');
const opener = $<HTMLButtonElement>('.test-open');
const sheet = matchMedia('(max-width: 700px)');

// Open above its button on a laptop; a bottom sheet on a phone, placed by CSS.
panel.addEventListener('toggle', (event) => {
  const open = (event as ToggleEvent).newState === 'open';
  opener.setAttribute('aria-expanded', String(open));
  if (!open) return;
  if (sheet.matches) {
    panel.style.removeProperty('top');
    panel.style.removeProperty('left');
  } else {
    const b = opener.getBoundingClientRect();
    const m = panel.getBoundingClientRect();
    const barH = bar.getBoundingClientRect().height;
    // Grow up out of the button, right edges aligned.
    panel.style.top = `${Math.max(barH + 8, b.top - 10 - m.height)}px`;
    panel.style.left = `${clamp(b.right - m.width, 12, window.innerWidth - m.width - 12)}px`;
  }
  panel.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true });
});
window.addEventListener('scroll', () => !sheet.matches && panel.matches(':popover-open') && panel.hidePopover(), { passive: true });
opener.setAttribute('aria-expanded', 'false');

const form = $<HTMLFormElement>('.console');
form.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const on = input.type !== 'checkbox' || input.checked;
  const value = input.value;
  const root = document.documentElement;
  switch (input.name) {
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
      setSmooth();
      requestDraw();
      break;
    case 'contrast':
      if (on) frame.dataset.tintContrast = 'more';
      else delete frame.dataset.tintContrast;
      break;
    case 'accent':
      if (value === 'brand') frame.style.setProperty('--media-accent-color', BRAND);
      else frame.style.removeProperty('--media-accent-color');
      break;
    case 'lang':
      void setLanguage(value);
      break;
  }
});
form.addEventListener('submit', (e) => e.preventDefault());

// ---------------------------------------------------------------- House lights

const lights = $<HTMLButtonElement>('.lights');
const lightsPrint = $<HTMLCanvasElement>('.lights-print');
const lightsGlassCanvas = $<HTMLCanvasElement>('.lights-glass');
const lightsKnob = $('.lights-knob');
const lightsGlass = Glass.create(lightsGlassCanvas);
if (lightsGlass) lights.dataset.glass = '';
/** 0 is lights down (dark page), 1 is lights up. Eased between while the marble rolls. */
let lightsAt = 0;
let lightsRaf = 0;

/** The fingerprint in the track, dim with the lights down and lit with them up, and the marble over it. */
function paintLights(): void {
  const model = filmModels[currentIndex()];
  if (!model || model.status !== 'ready') return;
  const s = sizeOf(lightsPrint);
  if (lightsPrint.width !== s.w || lightsPrint.height !== s.h) {
    lightsPrint.width = s.w;
    lightsPrint.height = s.h;
  }
  const source = model.print(s.w, s.h, LIT);
  if (!source) return;
  const g = lightsPrint.getContext('2d')!;
  const t = lightsAt;
  g.filter = `brightness(${lerp(0.5, 1.05, t)}) saturate(${lerp(0.75, 1.15, t)})`;
  g.clearRect(0, 0, s.w, s.h);
  g.drawImage(source, 0, 0);
  g.filter = 'none';
  lightsKnob.style.setProperty('--lights-on', String(t));
  if (!lightsGlass) return;
  // The marble sits over the track; find its centre in the track's own pixels.
  const tr = lightsPrint.getBoundingClientRect();
  const kr = lightsKnob.getBoundingClientRect();
  const k = s.w / Math.max(1, tr.width);
  const cx = kr.left - tr.left + kr.width / 2;
  const cy = kr.top - tr.top + kr.height / 2;
  const half = kr.width * 0.5;
  try {
    lightsGlass.setFrame(lightsPrint, (cx - half) * k, 0, kr.width * k, s.h);
    lightsGlass.draw(lightsPrint, cx, cy, kr.width, k);
  } catch {
    delete lights.dataset.glass;
  }
}

function setPage(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#000000');
  lights.setAttribute('aria-checked', String(theme === 'light'));
}

function rollLights(to: number): void {
  cancelAnimationFrame(lightsRaf);
  const from = lightsAt;
  const start = performance.now();
  const DURATION = 560;
  const step = (now: number) => {
    const t = calm() ? 1 : clamp((now - start) / DURATION, 0, 1);
    lightsAt = lerp(from, to, easeInOut(t));
    paintLights();
    if (t < 1) lightsRaf = requestAnimationFrame(step);
  };
  lightsRaf = requestAnimationFrame(step);
}

lights.addEventListener('click', () => {
  const up = lights.getAttribute('aria-checked') !== 'true';
  rollLights(up ? 1 : 0);
  const theme = up ? 'light' : 'dark';
  type Doc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  const doc = document as Doc;
  if (calm() || !doc.startViewTransition) return setPage(theme);
  // The new page spreads out from the marble, as if the light came from the switch.
  const r = lightsKnob.getBoundingClientRect();
  // From where the marble comes to rest.
  const travelX = lights.offsetWidth - r.width - 2 * (r.top - lights.getBoundingClientRect().top);
  const x = r.left + r.width / 2 + (up ? 1 - lightsAt : -lightsAt) * travelX;
  const y = r.top + r.height / 2;
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = doc.startViewTransition(() => setPage(theme));
  void vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
      { duration: 900, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', pseudoElement: '::view-transition-new(root)' }
    );
  });
});

// ---------------------------------------------------------------- The screen lights the room

const glowCanvases = [...document.querySelectorAll<HTMLCanvasElement>('.player-glow canvas')];
let glowKey = '';
let glowFront = 0;

function paintGlow(): void {
  const model = filmModels[currentIndex()];
  const m = media();
  if (!model || model.status !== 'ready' || !m) return;
  const started = m.currentTime > 0.2 || !m.paused;
  const index = started ? model.frameAt(m.currentTime) : -1;
  const key = `${current.id}:${index}`;
  if (key === glowKey) return;
  glowKey = key;
  glowFront = 1 - glowFront;
  const c = glowCanvases[glowFront]!;
  c.width = 48;
  c.height = 27;
  const g = c.getContext('2d')!;
  const f = index >= 0 ? model.frames[index] : undefined;
  const img = f && model.image(f.url);
  if (f && img) g.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
  else {
    // Before the film starts, the room takes the poster's colours: the fingerprint.
    const print = model.print(c.width, c.height, LIT);
    if (print) g.drawImage(print, 0, 0, c.width, c.height);
  }
  c.dataset.on = '';
  glowCanvases[1 - glowFront]!.removeAttribute('data-on');
}
for (const type of ['timeupdate', 'seeked', 'loadedmetadata', 'emptied', 'play']) player.addEventListener(type, paintGlow, true);

// ---------------------------------------------------------------- The bar marks the section you are reading

const barLinks = [...document.querySelectorAll<HTMLAnchorElement>('.bar-links a[data-section]')];
const sections: [string, HTMLElement][] = [
  ['how', $('#how')],
  ['care', $('#care')],
  ['install', $('#install')],
];
function markSection(): void {
  const mid = window.innerHeight / 2;
  let id: string | null = progress > 0.9 && stage.getBoundingClientRect().bottom > mid ? 'watch' : null;
  for (const [name, el] of sections) {
    const r = el.getBoundingClientRect();
    if (r.top <= mid && r.bottom > mid) id = name;
  }
  for (const a of barLinks) {
    if (a.dataset.section === id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
}

// ---------------------------------------------------------------- Copy the snippet

const copyButton = $<HTMLButtonElement>('.code-copy');
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('.code code').textContent ?? '');
    copyButton.textContent = 'Copied';
  } catch {
    copyButton.textContent = 'Press Ctrl+C';
  }
  window.setTimeout(() => (copyButton.textContent = 'Copy'), 1600);
});

// ---------------------------------------------------------------- Start

syncChoice();
FILMS.forEach((film, i) => {
  void modelFor(film).then((model) => {
    filmModels[i] = model;
    if (film === current) {
      syncChoice();
      void paintSteps(film);
    }
    paintPicks();
    buildColumns();
  });
});
render();

setSmooth();
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', setSmooth);

let lastWidth = 0;
new ResizeObserver(() => {
  placeSnaps();
  if (view.clientWidth === lastWidth) return;
  lastWidth = view.clientWidth;
  paintPicks();
  paintLights();
  void paintSteps(current);
}).observe(view);
