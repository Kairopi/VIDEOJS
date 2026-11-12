import '@videojs/html/i18n';
import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';
import { tintTranslations } from '@/video/tint/i18n';
import { polarPrint } from '@/video/tint/jelly';
import { TintModel } from '@/video/tint/model';
import { registerI18n } from '@videojs/html/i18n';
import type { MediaTextCue } from '@videojs/html';

import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

import { FILMS, type Film } from './films';
import { Glass } from './glass';
import './site.css';

/**
 * The site, in three parts: the player first, with the four films under it; how it works, told by the film as you
 * scroll; and how to use it. Every picture on the page comes from the films' own storyboards and stills.
 */

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
  const s = Math.max(0, Math.floor(seconds));
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
const filmModels: (TintModel | null)[] = FILMS.map(() => null);

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

const accent = (model: TintModel, frame: number) => {
  const a = model.accentOf(frame);
  return `oklch(${a.l} ${a.c} ${a.h})`;
};

// ---------------------------------------------------------------- The player

let current: Film = FILMS[0]!;
const frame = $('.player-frame');
const bar = $('.bar');
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

/** The poster's title card, the way a streaming service presents a film: studio, facts, licence, one line. */
function fillTitleCard(film: Film): void {
  const set = (selector: string, fill: (el: HTMLElement) => void) => {
    const el = player.querySelector<HTMLElement>(selector);
    if (el) fill(el);
  };
  // Just the title, the year and the length on the poster; the credit and licence are in the line under the player.
  // The logline is still given, for the pause card, but the poster doesn't show it (site.css).
  set('.tint-kicker', (el) => (el.textContent = ''));
  set('.tint-meta-facts', (el) => el.replaceChildren(String(film.year)));
  set('.tint-logline', (el) => (el.textContent = film.logline));
}
fillTitleCard(current);

// ---------------------------------------------------------------- The four films, under the player

interface Pick {
  film: Film;
  button: HTMLButtonElement;
  band: HTMLCanvasElement;
  art: HTMLCanvasElement;
  shown: number;
}

// A small title card per film, like a streaming shelf: a real still from the film, its name and facts, and its
// fingerprint as a thin band along the bottom. Point along a card to riffle through that film; the one playing shows
// where you are on its band.
const pickEls: Pick[] = FILMS.map((film) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pick';
  b.innerHTML =
    '<canvas class="pick-art" aria-hidden="true"></canvas><span class="pick-shade" aria-hidden="true"></span>' +
    '<span class="pick-text"><b></b><small></small></span>' +
    '<span class="pick-band" aria-hidden="true"><canvas></canvas><i class="pick-head"></i></span>';
  b.querySelector('b')!.textContent = film.title;
  b.querySelector('small')!.textContent = String(film.year);
  b.setAttribute('aria-label', `${film.title}, ${film.year}. ${film.line}`);
  b.addEventListener('click', () => select(film));
  $('.films-pick').append(b);
  const pick: Pick = { film, button: b, band: b.querySelector<HTMLCanvasElement>('.pick-band canvas')!, art: b.querySelector<HTMLCanvasElement>('.pick-art')!, shown: -1 };
  b.addEventListener('pointermove', (e) => {
    const model = filmModels[FILMS.indexOf(film)];
    if (e.pointerType === 'touch' || !model || model.status !== 'ready') return;
    const r = b.getBoundingClientRect();
    paintArt(pick, model, clamp(Math.floor(((e.clientX - r.left) / r.width) * model.frames.length), 0, model.frames.length - 1));
  });
  b.addEventListener('pointerleave', () => {
    const model = filmModels[FILMS.indexOf(film)];
    if (model?.status === 'ready') paintArt(pick, model, model.keyArt());
  });
  return pick;
});
const currentIndex = () => FILMS.indexOf(current);

/** Draw an image into a box, cropped to the box's shape from the middle. */
function cover(g: CanvasRenderingContext2D, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, x: number, y: number, w: number, h: number): void {
  const a = w / h;
  const cw = sw / sh > a ? sh * a : sw;
  const ch = sw / sh > a ? sh : sw / a;
  g.drawImage(src, sx + (sw - cw) / 2, sy + (sh - ch) / 2, cw, ch, x, y, w, h);
}

/** A frame into a card: the sharp still when it has arrived (and asked for when it hasn't), the storyboard tile till then. */
function paintArt(pick: Pick, model: TintModel, index: number): void {
  const f = model.frames[index];
  const tile = f && model.image(f.url);
  if (!f || !tile) return;
  const s = sizeOf(pick.art);
  const sharp = model.sharp(index, s.w);
  const key = `${index}:${sharp ? 'hi' : 'lo'}:${s.w}x${s.h}`;
  if (pick.art.dataset.key === key) return;
  pick.art.dataset.key = key;
  pick.shown = index;
  if (pick.art.width !== s.w || pick.art.height !== s.h) {
    pick.art.width = s.w;
    pick.art.height = s.h;
  }
  const g = pick.art.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  if (sharp) cover(g, sharp, 0, 0, sharp.naturalWidth, sharp.naturalHeight, 0, 0, s.w, s.h);
  else cover(g, tile, f.x, f.y, f.w, f.h, 0, 0, s.w, s.h);
}

function paintPicks(): void {
  pickEls.forEach((pick, i) => {
    const model = filmModels[i];
    if (!model || model.status !== 'ready') return;
    const s = sizeOf(pick.band);
    draw(pick.band, model.print(s.w, s.h, LIT));
    if (!pick.button.matches(':hover')) paintArt(pick, model, model.keyArt());
    pick.button.querySelector('small')!.textContent = `${pick.film.year} · ${formatTime(model.duration)}`;
    // The sharp still replaces the tile when it lands.
    if (!pick.art.dataset.listening) {
      pick.art.dataset.listening = '';
      model.addEventListener('sharp', () => {
        if (pick.shown < 0) return;
        delete pick.art.dataset.key;
        paintArt(pick, model, pick.shown);
      });
    }
  });
}

// The card that is playing shows where you are along its band.
player.addEventListener(
  'timeupdate',
  () => {
    const m = media();
    const pick = pickEls[currentIndex()];
    if (m && pick && m.duration) pick.button.style.setProperty('--at', `${(m.currentTime / m.duration) * 100}%`);
  },
  true
);

function syncChoice(): void {
  for (const p of pickEls) p.button.setAttribute('aria-pressed', String(p.film === current));
  $('.credit-title').textContent = current.title;
  $('.credit-year').textContent = String(current.year);
  const model = filmModels[currentIndex()];
  if (model?.status === 'ready') {
    const stops = model.scenes.map((s) => accent(model, s.face));
    if (stops.length > 1) document.documentElement.style.setProperty('--film-swatch', `conic-gradient(${[...stops, stops[0]].join(', ')})`);
    document.documentElement.style.setProperty('--film-accent', accent(model, model.signature()));
    bar.style.setProperty('--bar-chip', accent(model, model.signature()));
    paintMark(model);
    paintLights();
  }
}

/** The logo is the film that's on: its fingerprint as a tiny reel round a hub in its own colour. */
function paintMark(model: TintModel): void {
  const canvas = document.querySelector<HTMLCanvasElement>('.bar-reel');
  const print = model.print(360, 24, 'saturate(1.4) contrast(1.08) brightness(1.06)');
  if (!canvas || !print) return;
  const ring = polarPrint(print, canvas.width, 0.4);
  if (!ring) return;
  const g = canvas.getContext('2d')!;
  const c = canvas.width / 2;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(ring, 0, 0);
  g.beginPath();
  g.arc(c, c, c * 0.4, 0, Math.PI * 2);
  g.fillStyle = accent(model, model.signature());
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgb(0 0 0 / 0.5)';
  g.stroke();
}

function select(film: Film): void {
  if (film === current) return;
  current = film;
  const m = media();
  if (m) {
    m.pause();
    m.muted = false;
  }
  player.setAttribute('content-title', film.title);
  fillTitleCard(film);
  m?.setAttribute('src', `https://stream.mux.com/${film.id}.m3u8`);
  syncChoice();
  story.reset();
}

// ---------------------------------------------------------------- The house lights follow the film

// As in a cinema: down while the film plays, half up when it's paused, up when it ends or you look away from the
// screen. The page around the screen fades; the screen and its light stay. Point at the bar or the films to use them.
const root = document.documentElement;
const skin = () => player.querySelector<HTMLElement>('.media-skin');
let screenInView = true;
function room(): void {
  const m = media();
  const state = skin()?.dataset.tintState;
  let level: 'up' | 'half' | 'down' = 'up';
  if (m && screenInView && frame.dataset.tint !== 'quiet' && state !== 'ended' && state !== 'poster') {
    if (!m.paused) level = 'down';
    else if (m.currentTime > 0) level = 'half';
  }
  if (root.dataset.room !== level) root.dataset.room = level;
}
for (const type of ['play', 'playing', 'pause', 'ended', 'seeked', 'emptied']) player.addEventListener(type, room, true);
new IntersectionObserver(
  ([entry]) => {
    screenInView = Boolean(entry && entry.intersectionRatio > 0.6);
    room();
  },
  { threshold: [0, 0.6, 1] }
).observe(frame);
// The skin's own state changes (the end sheet, the poster) light the room too.
new MutationObserver(room).observe(player, { subtree: true, attributes: true, attributeFilter: ['data-tint-state'] });

// ---------------------------------------------------------------- How it works: the film tells it as you scroll

/**
 * One canvas, pinned while its section scrolls past, in three steps:
 *   1. the storyboard, every frame of the film laid out as a sheet;
 *   2. each frame squeezes into a stripe, and the stripes close up into the fingerprint;
 *   3. the fingerprint narrows into the timeline under the film's picture, and as the playhead moves along it the
 *      colour under the playhead tints the time and the light around the picture.
 * With reduced motion it holds each step instead of moving between them.
 */
const story = (() => {
  const section = $('.how-track');
  const pin = $('.how-pin');
  const canvas = $<HTMLCanvasElement>('.how-canvas');
  const steps = [...document.querySelectorAll<HTMLElement>('.how-step')];
  const g = canvas.getContext('2d')!;
  let raf = 0;
  let model: TintModel | null = null;
  let film: Film | null = null;

  type Box = { x: number; y: number; w: number; h: number };
  const mix = (a: Box, b: Box, t: number): Box => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });

  function progress(): number {
    const r = section.getBoundingClientRect();
    const travel = Math.max(1, r.height - pin.offsetHeight);
    const p = clamp((bar.offsetHeight - r.top) / travel, 0, 1);
    // Calm: hold each step, no motion between them.
    return calm() ? (p < 0.36 ? 0 : p < 0.7 ? 0.62 : 1) : p;
  }

  function render(): void {
    raf = 0;
    const p = progress();
    const step = p < 0.36 ? 0 : p < 0.7 ? 1 : 2;
    steps.forEach((el, i) => el.toggleAttribute('data-on', i === step));
    if (!model || model.status !== 'ready') return;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const k = dpr();
    if (canvas.width !== Math.round(W * k) || canvas.height !== Math.round(H * k)) {
      canvas.width = Math.round(W * k);
      canvas.height = Math.round(H * k);
    }
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high';

    const frames = model.frames;
    const N = frames.length;
    const f0 = frames[0]!;
    const aspect = f0.w / f0.h || 16 / 9;
    // The picture's area: to the right of the words on a wide screen, under them on a narrow one.
    const wide = W >= 900;
    const pad = clamp(W * 0.04, 16, 56);
    const A: Box = wide ? { x: W * 0.4, y: pad * 1.5, w: W * 0.6 - pad, h: H - pad * 3 } : { x: pad, y: H * 0.42, w: W - 2 * pad, h: H * 0.54 };

    // Step 1: the sheet.
    let cols = 1;
    const fit = (c: number) => Math.min(A.w / c, (A.h / Math.ceil(N / c)) * aspect);
    for (let c = 2; c <= N; c++) if (fit(c) > fit(cols)) cols = c;
    const gap = Math.max(2, A.w * 0.006);
    const rows = Math.ceil(N / cols);
    const tw = (Math.min(A.w, fit(cols) * cols) - gap * (cols - 1)) / cols;
    const th = tw / aspect;
    const gx = A.x + (A.w - (cols * tw + (cols - 1) * gap)) / 2;
    const gy = A.y + (A.h - (rows * th + (rows - 1) * gap)) / 2;
    const tile = (i: number): Box => ({ x: gx + (i % cols) * (tw + gap), y: gy + Math.floor(i / cols) * (th + gap), w: tw, h: th });

    // Step 2: the fingerprint, as tall as a picture, across the area.
    const bandH = Math.min(A.h * 0.62, (A.w / aspect) * 0.9);
    const band: Box = { x: A.x, y: A.y + (A.h - bandH) / 2, w: A.w, h: bandH };
    const stripe = (i: number): Box => ({ x: band.x + (i * band.w) / N, y: band.y, w: band.w / N + 0.4, h: band.h });

    // Step 3: the player: the picture, with the fingerprint as its timeline under it.
    const picW = Math.min(A.w, (A.h - 40) * aspect);
    const picH = picW / aspect;
    const pic: Box = { x: A.x + (A.w - picW) / 2, y: A.y + (A.h - picH - 34) / 2, w: picW, h: picH };
    const strip: Box = { x: pic.x + picW * 0.04, y: pic.y + picH - 30, w: picW * 0.92, h: 10 };
    const slot = (i: number): Box => ({ x: strip.x + (i * strip.w) / N, y: strip.y, w: strip.w / N + 0.4, h: strip.h });

    const toBand = p; // 0..1 across the page; each transition below picks its own stretch of it
    const squeeze = (i: number) => easeInOut(clamp((toBand - 0.22 - (i / N) * 0.12) / 0.2, 0, 1));
    const narrow = easeInOut(clamp((p - 0.66) / 0.16, 0, 1));
    // Where the playhead is along the film, in step 3.
    const u = lerp(0.12, 0.82, smooth(0.8, 1, p));
    const playing = model.frameAt(u * model.duration);

    // The picture fades up behind the timeline as the band narrows.
    if (narrow > 0) {
      const glow = g.createRadialGradient(pic.x + pic.w * u, pic.y + pic.h, 0, pic.x + pic.w / 2, pic.y + pic.h / 2, pic.w * 0.75);
      glow.addColorStop(0, accent(model, playing).replace(')', ` / ${0.35 * narrow})`));
      glow.addColorStop(1, 'transparent');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      g.save();
      g.globalAlpha = narrow;
      g.beginPath();
      g.roundRect(pic.x, pic.y, pic.w, pic.h, 14);
      g.clip();
      g.fillStyle = '#000';
      g.fillRect(pic.x, pic.y, pic.w, pic.h);
      const f = frames[playing]!;
      const sharp = model.sharp(playing, pic.w * k);
      if (sharp) cover(g, sharp, 0, 0, sharp.naturalWidth, sharp.naturalHeight, pic.x, pic.y, pic.w, pic.h);
      else {
        const img = model.image(f.url);
        if (img) cover(g, img, f.x, f.y, f.w, f.h, pic.x, pic.y, pic.w, pic.h);
      }
      // Shade for the timeline, as in the skin.
      const shade = g.createLinearGradient(0, pic.y + pic.h * 0.55, 0, pic.y + pic.h);
      shade.addColorStop(0, 'transparent');
      shade.addColorStop(1, 'rgb(0 0 0 / 0.7)');
      g.fillStyle = shade;
      g.fillRect(pic.x, pic.y, pic.w, pic.h);
      g.restore();
    }

    // The frames: tiles, then stripes, then the timeline.
    for (let i = 0; i < N; i++) {
      const f = frames[i]!;
      const img = model.image(f.url);
      if (!img) continue;
      const s = squeeze(i);
      let box = mix(tile(i), stripe(i), s);
      box = mix(box, slot(i), narrow);
      // As a stripe the whole frame squeezes to its width, which is what the fingerprint is made of.
      g.save();
      g.globalAlpha = narrow > 0 && f.start > u * model.duration ? lerp(1, 0.55, narrow) : 1;
      const r = lerp(Math.min(5, tw * 0.06), 0, s);
      g.beginPath();
      g.roundRect(box.x, box.y, box.w, box.h, r);
      g.clip();
      if (s < 1) cover(g, img, f.x, f.y, f.w, f.h, box.x, box.y, box.w, box.h);
      else g.drawImage(img, f.x, f.y, f.w, f.h, box.x, box.y, box.w, box.h);
      g.restore();
    }

    // Step 3: the playhead, in the colour of the frame under it.
    if (narrow > 0.6) {
      const a = clamp((narrow - 0.6) / 0.4, 0, 1);
      const x = strip.x + strip.w * u;
      const label = formatTime(u * model.duration);
      g.globalAlpha = a;
      g.font = `700 12px ${getComputedStyle(document.body).fontFamily}`;
      const lw = g.measureText(label).width + 18;
      g.fillStyle = accent(model, playing);
      g.beginPath();
      g.roundRect(x - lw / 2, strip.y + strip.h / 2 - 11, lw, 22, 11);
      g.fill();
      g.fillStyle = 'rgb(16 16 18)';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, x, strip.y + strip.h / 2 + 0.5);
      g.textAlign = 'start';
      g.globalAlpha = 1;
    }
  }

  function request(): void {
    if (!raf) raf = requestAnimationFrame(render);
  }

  async function load(): Promise<void> {
    const want = current;
    const m = await modelFor(want);
    if (want !== current) return;
    film = want;
    model = m;
    $('.how-frames').textContent = String(m.frames.length);
    m.addEventListener('sharp', request);
    request();
  }

  window.addEventListener('scroll', request, { passive: true });
  new ResizeObserver(request).observe(canvas);
  return {
    request,
    reset: () => {
      if (film !== current) void load();
    },
    load,
  };
})();

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

// "Made for everyone" sends you to the real player, with the panel open on it.
$('.access-open').addEventListener('click', () => {
  const open = () => {
    opener.focus({ preventScroll: true });
    panel.showPopover();
  };
  if (lenis && !calm()) lenis.scrollTo(0, { duration: 1.1, onComplete: open });
  else {
    window.scrollTo({ top: 0, behavior: 'auto' });
    requestAnimationFrame(open);
  }
});

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
      story.request();
      break;
    case 'contrast':
      if (on) frame.dataset.tintContrast = 'more';
      else delete frame.dataset.tintContrast;
      break;
    case 'quiet':
      if (on) frame.dataset.tint = 'quiet';
      else delete frame.dataset.tint;
      room();
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

// ---------------------------------------------------------------- Smooth scroll (Lenis, MIT); off with reduced motion

let lenis: Lenis | null = null;
function lenisFrame(time: number): void {
  if (!lenis) return;
  lenis.raf(time);
  requestAnimationFrame(lenisFrame);
}
function setSmooth(): void {
  const want = !calm();
  if (want && !lenis) {
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.95, anchors: true });
    requestAnimationFrame(lenisFrame);
  } else if (!want && lenis) {
    lenis.destroy();
    lenis = null;
  }
}

$('.skip').addEventListener('click', (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0 });
  player.querySelector<HTMLElement>('.tint-start, [tabindex]')?.focus({ preventScroll: true });
});

// ---------------------------------------------------------------- The bar: solid once the page moves, and the section you are in

const barLinks = [...document.querySelectorAll<HTMLAnchorElement>('.bar-links a[data-section]')];
const sections: [string, HTMLElement][] = [
  ['watch', $('#watch')],
  ['how', $('#how')],
  ['install', $('#install')],
];
function markSection(): void {
  bar.toggleAttribute('data-solid', window.scrollY > 4);
  const mid = window.innerHeight / 2;
  let id: string | null = null;
  for (const [name, el] of sections) {
    const r = el.getBoundingClientRect();
    if (r.top <= mid && r.bottom > mid) id = name;
  }
  for (const a of barLinks) {
    if (a.dataset.section === id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
}
window.addEventListener('scroll', markSection, { passive: true });

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
markSection();
FILMS.forEach((film, i) => {
  void modelFor(film).then((model) => {
    filmModels[i] = model;
    if (film === current) {
      syncChoice();
      void story.load();
    }
    paintPicks();
  });
});

setSmooth();
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', setSmooth);

let lastWidth = 0;
new ResizeObserver(() => {
  if (document.documentElement.clientWidth === lastWidth) return;
  lastWidth = document.documentElement.clientWidth;
  paintPicks();
  paintLights();
  story.request();
}).observe(document.documentElement);
