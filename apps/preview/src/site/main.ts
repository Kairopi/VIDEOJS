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

// ---------------------------------------------------------------- Hero: the film you can move through

const hero = $('.hero');
const heroFilm = $('.hero-film');
const heroCanvas = $<HTMLCanvasElement>('.hero-print');
const heroRise = $('.hero-rise');
const lens = $('.hero-lens');
const lensFrame = $('.hero-lens-frame');
const lensCard = $('.hero-lens-card');
const lensScene = $('.hero-lens-scene');
const lensTime = $('.hero-lens-time');
let heroModel: TintModel | null = null;

async function paintHero(film: Film, rise: boolean): Promise<void> {
  const model = await modelFor(film);
  if (film !== current || model.status !== 'ready') return;
  const { w, h } = sizeOf(heroFilm);
  const print = model.print(w, h, LIT);
  if (!print) return;
  heroModel = model;
  hero.style.setProperty('--hero-accent', accent(model, model.signature()));
  // The console's "follows the film" swatch shows this film's scene colours; the section bar wears its signature.
  const stops = model.scenes.map((s) => accent(model, s.face));
  if (stops.length > 1) $('.console').style.setProperty('--film-swatch', `conic-gradient(${[...stops, stops[0]].join(', ')})`);
  $('.dock').style.setProperty('--dock-chip', accent(model, model.signature()));
  startIdle();

  if (!rise || calm() || !heroCanvas.width) {
    draw(heroCanvas, print);
    heroFilm.dataset.ready = '';
    return;
  }

  // The new film rises up through the old one, column by column.
  const url = print.toDataURL('image/jpeg', 0.9);
  const n = 64;
  const cw = heroFilm.clientWidth / n;
  const slices = Array.from({ length: n }, (_, i) => {
    const s = document.createElement('i');
    s.style.cssText = `left:${i * cw}px;width:${cw + 1}px;background-image:url(${url});background-size:${heroFilm.clientWidth}px 100%;background-position:${-i * cw}px 0;transition-delay:${Math.abs(i - n / 2) * 9}ms`;
    return s;
  });
  heroRise.replaceChildren(...slices);
  void heroRise.offsetWidth;
  heroRise.dataset.on = '';
  window.setTimeout(() => {
    if (film !== current) return;
    draw(heroCanvas, print);
    delete heroRise.dataset.on;
    heroRise.replaceChildren();
  }, 1100);
}

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
  lensTarget = Math.max(0, Math.min(r.width, clientX - r.left));
  if (!hero.hasAttribute('data-looking')) {
    lensX = lensTarget;
    hero.dataset.looking = '';
  }
  if (!lensRaf) lensRaf = requestAnimationFrame(moveLens);
}

const onFilmArea = (e: PointerEvent) => !(e.target as Element).closest('.hero-side, a');
hero.addEventListener('pointermove', (e) => {
  lastTouch = performance.now();
  if (onFilmArea(e) || e.pointerType === 'touch') pointAt(e.clientX);
  else delete hero.dataset.looking;
});
hero.addEventListener('pointerdown', (e) => {
  lastTouch = performance.now();
  if (onFilmArea(e)) pointAt(e.clientX);
});
hero.addEventListener('pointerleave', () => {
  lastTouch = performance.now();
  delete hero.dataset.looking;
});

// Until someone moves across the film, the lens wanders through it on its own, so the first
// second already shows what the hero does. It stops the moment a pointer arrives, waits a few
// seconds after it leaves, and never runs with reduced motion or off screen.
const IDLE_AFTER_MS = 3500;
let lastTouch = -Infinity;
let idleRaf = 0;
let idleStart = 0;
let heroOnScreen = true;
function idle(now: number): void {
  idleRaf = 0;
  if (calm() || !heroOnScreen || document.hidden || !heroModel) return;
  idleRaf = requestAnimationFrame(idle);
  if (now - lastTouch < IDLE_AFTER_MS) return;
  if (!idleStart) idleStart = now;
  const t = (now - idleStart) / 1000;
  const width = heroFilm.clientWidth;
  // Two slow waves, so the path through the film never looks like a metronome.
  const p = 0.5 - 0.36 * Math.cos(t * 0.21) + 0.06 * Math.sin(t * 0.53);
  lensTarget = Math.max(0, Math.min(width, p * width));
  // Glide in from wherever the lens last was rather than jumping.
  hero.dataset.looking = '';
  if (!lensRaf) lensRaf = requestAnimationFrame(moveLens);
}
function startIdle(): void {
  if (!idleRaf) idleRaf = requestAnimationFrame(idle);
}
new IntersectionObserver(([entry]) => {
  heroOnScreen = !!entry?.isIntersecting;
  if (heroOnScreen) startIdle();
}).observe(hero);
document.addEventListener('visibilitychange', startIdle);
hero.addEventListener('click', (e) => {
  if (!onFilmArea(e as PointerEvent) || !heroModel) return;
  const r = heroFilm.getBoundingClientRect();
  watchFrom(((e.clientX - r.left) / r.width) * heroModel.duration);
});

function watchFrom(time: number): void {
  const m = media();
  if (!m) return;
  $('#watch').scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
  const start = () => {
    m.currentTime = Math.max(0, time - 0.5);
    void m.play().catch(() => undefined);
  };
  if (m.readyState >= 1) start();
  else m.addEventListener('loadedmetadata', start, { once: true });
}

// ---------------------------------------------------------------- Film choice (hero buttons and the wall)

const filmButtons = $('.films');
const bands = $('.bands');

const heroButtons = FILMS.map((film) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'film-button';
  b.innerHTML = '<canvas aria-hidden="true"></canvas><span></span>';
  b.querySelector('span')!.textContent = film.title;
  b.addEventListener('click', () => select(film));
  filmButtons.append(b);
  return { film, button: b, canvas: b.querySelector('canvas')! };
});

// The same choice again beside the player's title, so switching films never needs a scroll.
const pickButtons = FILMS.map((film) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pick';
  b.innerHTML = '<canvas aria-hidden="true"></canvas><span></span>';
  b.querySelector('span')!.textContent = film.title;
  b.addEventListener('click', () => select(film));
  $('.films-pick').append(b);
  return { film, button: b, canvas: b.querySelector('canvas')! };
});

const wallBands = FILMS.map((film) => {
  const li = document.createElement('li');
  li.innerHTML = `
    <button class="band" type="button">
      <canvas aria-hidden="true"></canvas>
      <span class="band-text">
        <span class="band-title"></span>
        <span class="band-line"></span>
      </span>
      <span class="band-meta"></span>
    </button>`;
  li.querySelector('.band-title')!.textContent = film.title;
  li.querySelector('.band-line')!.textContent = film.line;
  const button = li.querySelector<HTMLButtonElement>('.band')!;
  button.addEventListener('click', () => {
    select(film);
    $('#watch').scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
  });
  bands.append(li);
  return { film, button, canvas: li.querySelector('canvas')!, meta: li.querySelector<HTMLElement>('.band-meta')! };
});

async function paintChoices(): Promise<void> {
  await Promise.all(
    FILMS.map(async (film) => {
      const model = await modelFor(film).catch(() => null);
      if (!model || model.status !== 'ready') return;
      for (const list of [heroButtons, pickButtons]) {
        const b = list.find((x) => x.film === film)!;
        const s = sizeOf(b.canvas);
        draw(b.canvas, model.print(s.w, s.h, LIT));
      }
      const band = wallBands.find((b) => b.film === film)!;
      const s2 = sizeOf(band.canvas);
      draw(band.canvas, model.print(s2.w, s2.h, LIT));
      band.meta.textContent = `${formatTime(model.duration)} · ${model.scenes.length} scenes · ${film.year}`;
      band.button.setAttribute('aria-label', `Watch ${film.title}, ${film.year}. ${film.line}`);
    })
  );
}

function syncChoice(): void {
  for (const b of [...heroButtons, ...pickButtons]) b.button.setAttribute('aria-pressed', String(b.film === current));
  for (const b of wallBands) {
    b.button.toggleAttribute('data-current', b.film === current);
    if (b.film === current) b.button.setAttribute('aria-current', 'true');
    else b.button.removeAttribute('aria-current');
  }
  $('.watch-film').textContent = current.title;
  $('.watch-line').textContent = current.line;
}

function select(film: Film): void {
  if (film === current) return;
  current = film;
  const m = media();
  m?.pause();
  player.setAttribute('content-title', film.title);
  m?.setAttribute('src', `https://stream.mux.com/${film.id}.m3u8`);
  syncChoice();
  void paintHero(film, true);
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
    g.fillStyle = 'rgba(11,11,12,0.9)';
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
  pg.fillStyle = 'rgba(11,11,12,0.95)';
  for (const scene of model.scenes.slice(1)) pg.fillRect(Math.round((scene.start / model.duration) * size.w) - dpr(), 0, 2 * dpr(), size.h);

  $('.palette-list').replaceChildren(
    ...model.scenes.map((scene) => {
      const li = document.createElement('li');
      li.style.setProperty('--swatch', accent(model, scene.face));
      li.innerHTML = '<span class="swatch" aria-hidden="true"></span><span class="swatch-name"></span><span class="swatch-time"></span>';
      li.querySelector('.swatch-name')!.textContent = scene.title || `Scene ${scene.index + 1}`;
      li.querySelector('.swatch-time')!.textContent = formatTime(scene.start);
      return li;
    })
  );
}

// ---------------------------------------------------------------- Test it

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

const test = $<HTMLFormElement>('.console');
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
  langMenu.style.left = `${Math.max(12, Math.min(window.innerWidth - m.width - 12, b.left + b.width / 2 - m.width / 2))}px`;
  langMenu.querySelector<HTMLInputElement>('input:checked')?.focus();
});
window.addEventListener('scroll', () => langMenu.matches(':popover-open') && langMenu.hidePopover(), { passive: true });
langButton.setAttribute('aria-expanded', 'false');

test.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const value = input.type === 'checkbox' && !input.checked ? '' : input.value;
  const root = document.documentElement;
  switch (input.name) {
    case 'page':
      root.dataset.theme = value;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'light' ? '#ffffff' : '#0b0b0c');
      break;
    case 'size':
      frame.dataset.size = value;
      break;
    case 'shape':
      frame.style.setProperty('--shape', value);
      break;
    case 'motion':
      if (value === 'reduce') root.dataset.tintMotion = 'reduce';
      else delete root.dataset.tintMotion;
      break;
    case 'contrast':
      if (value === 'more') frame.dataset.tintContrast = 'more';
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
      // Close once a language is picked with a click or tap; arrow keys keep the menu open to browse.
      if (event.isTrusted && !keyboardPick) {
        langMenu.hidePopover();
        langButton.focus();
      }
      break;
    }
  }
});
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
test.addEventListener('submit', (e) => e.preventDefault());

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

// ---------------------------------------------------------------- The section bar

const dock = $('.dock');
new IntersectionObserver(([entry]) => {
  // Show the bar once most of the hero has scrolled away; the hero has its own links.
  if (entry && entry.intersectionRatio < 0.2) dock.dataset.on = '';
  else delete dock.dataset.on;
}, { threshold: [0, 0.2, 0.4] }).observe(hero);

const dockLinks = [...document.querySelectorAll<HTMLAnchorElement>('.dock-links a')];
const sectionObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const a of dockLinks) {
        if (a.hash === `#${entry.target.id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }
  },
  { rootMargin: '-45% 0px -50% 0px' }
);
for (const a of dockLinks) {
  const section = document.querySelector(a.hash);
  if (section) sectionObserver.observe(section);
}

// ---------------------------------------------------------------- Start

syncChoice();
void paintHero(current, false);
void paintChoices();
void paintSteps(current);

// Repaint when the page width changes.
let resizeFrame = 0;
let lastWidth = document.documentElement.clientWidth;
new ResizeObserver(() => {
  const width = document.documentElement.clientWidth;
  if (width === lastWidth) return;
  lastWidth = width;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    void paintHero(current, false);
    void paintChoices();
    void paintSteps(current);
  });
}).observe(document.documentElement);
