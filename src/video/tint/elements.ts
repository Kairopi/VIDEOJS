/**
 * Tint's own elements. Each one reads player state through Video.js's PlayerController, and colour data through the
 * shared model for its container.
 */

import {
  PlayerController,
  playerContext,
  selectError,
  selectPlayback,
  selectTextTrack,
  selectTime,
  UIElement,
  type PropertyValues,
} from '@videojs/html';

import { getModel, type TintModel } from './model';

const LIT = 'saturate(1.4) contrast(1.08) brightness(1.06)';
const DIM = 'saturate(0.6) brightness(0.78)';
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** The <video> that draws the picture: the media itself, or the one inside a media component such as <mux-video>. */
function videoOf(container: HTMLElement): HTMLVideoElement | null {
  for (const el of container.children) {
    if (el instanceof HTMLVideoElement) return el;
    const inner = el.shadowRoot?.querySelector('video');
    if (inner) return inner;
  }
  return null;
}

type TintState = 'poster' | 'folding' | 'playing' | 'unfolding' | 'ended' | 'error';

/** The system setting, or a page that asks for calm with `data-tint-motion="reduce"` on any ancestor. */
const reducedMotion = (el: Element) =>
  matchMedia('(prefers-reduced-motion: reduce)').matches || Boolean(el.closest('[data-tint-motion="reduce"]'));
const dpr = () => Math.min(2, window.devicePixelRatio || 1);

function containerOf(el: Element): HTMLElement | null {
  return el.closest('media-container');
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m} min ${r} s` : `${r} s`;
}

/** A translated word with an English default, using Video.js's i18n machinery. */
function text(token: string, english: string): HTMLElement {
  const el = document.createElement('media-text');
  el.setAttribute('token', token);
  el.textContent = english;
  return el;
}

/** Paint a storyboard frame into an element as a background, scaled to the element's width. */
function paintFrame(model: TintModel, el: HTMLElement, index: number): void {
  const f = model.frames[index];
  const img = f && model.image(f.url);
  if (!f || !img) return;
  // Layout width, so a menu that is still scaling in doesn't paint its pictures a little small.
  const width = el.offsetWidth || el.getBoundingClientRect().width || 160;
  const k = width / (f.w || img.naturalWidth);
  el.style.backgroundImage = `url("${f.url}")`;
  el.style.backgroundSize = `${img.naturalWidth * k}px ${img.naturalHeight * k}px`;
  el.style.backgroundPosition = `${-f.x * k}px ${-f.y * k}px`;
}

function accentCss(model: TintModel, frame: number): string {
  const a = model.accentOf(frame);
  return `oklch(${a.l} ${a.c} ${a.h})`;
}

/**
 * <tint-print>: the fingerprint poster, the fold and unfold, and the scene accent.
 *
 * Sets on its container:
 * - `data-tint-state`: poster | folding | playing | unfolding | ended | error
 * - `data-tint-ready` once the fingerprint is drawn
 * - `--tint-l`, `--tint-c`, `--tint-h`: the current accent in OKLCH
 */
export class TintPrintElement extends UIElement {
  static readonly tagName = 'tint-print';

  #tracks = new PlayerController(this, playerContext, selectTextTrack);
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #time = new PlayerController(this, playerContext, selectTime);
  #error = new PlayerController(this, playerContext, selectError);

  #container: HTMLElement | null = null;
  #model: TintModel | null = null;
  #canvas = document.createElement('canvas');
  #fold = document.createElement('div');
  #live = document.createElement('p');
  // The key art: a storyboard frame at once (softened), then a sharp still over it when the source can make one.
  #art = document.createElement('canvas');
  #artHi = document.createElement('img');
  #artIndex = -1;
  #artTimer = 0;
  // The fingerprint band along the bottom of the poster: point along it to riffle through the film, press to play.
  #band = document.createElement('div');
  #mark = document.createElement('span');
  #markTime = document.createElement('span');
  #riffle = -1;
  #state: TintState | null = null;
  #frame = -2;
  #hue = 70;
  #foldTimer = 0;
  #foldRaf = 0;
  #disconnect: AbortController | null = null;
  #resize: ResizeObserver | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    this.#canvas.className = 'tint-print-canvas';
    this.#fold.className = 'tint-fold';
    this.#live.className = 'tint-announcer';
    this.#live.setAttribute('aria-live', 'polite');
    this.#art.className = 'tint-art';
    this.#artHi.className = 'tint-art tint-art-hi';
    this.#artHi.alt = '';
    this.#artHi.decoding = 'async';
    this.#artHi.crossOrigin = 'anonymous';
    this.#band.className = 'tint-band';
    this.#mark.className = 'tint-band-mark';
    this.#markTime.className = 'tint-band-time';
    this.#mark.append(this.#markTime);
    this.#band.append(this.#canvas, this.#mark);
    this.replaceChildren(this.#art, this.#artHi, this.#band, this.#fold);

    this.#container = containerOf(this);
    if (!this.#container) return;
    // The announcer lives outside this aria-hidden element so screen readers hear it.
    this.#container.append(this.#live);
    this.#model = getModel(this.#container);

    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    this.#model.addEventListener('change', this.#onModel, { signal });
    this.#container.addEventListener('keydown', this.#onKey, { signal });
    this.#band.addEventListener('pointermove', this.#onRiffle, { signal });
    this.#band.addEventListener('pointerleave', this.#endRiffle, { signal });
    this.#band.addEventListener('click', this.#onBandPress, { signal });
    // The band's press is its own: it must not also reach the player's tap-to-pause gesture.
    for (const type of ['pointerdown', 'pointerup'] as const) this.#band.addEventListener(type, (e) => e.stopPropagation(), { signal });
    this.#resize = new ResizeObserver(() => this.#paint());
    this.#resize.observe(this.#container);
    this.#onModel();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    this.#resize?.disconnect();
    this.#resize = null;
    this.#live.remove();
    window.clearTimeout(this.#foldTimer);
    window.clearTimeout(this.#artTimer);
    cancelAnimationFrame(this.#foldRaf);
  }

  protected override update(changed: PropertyValues): void {
    super.update(changed);
    const tracks = this.#tracks.value;
    const playback = this.#playback.value;
    const time = this.#time.value;
    const model = this.#model;
    if (!model || !this.#container) return;

    if (tracks) {
      void model.setTrack(tracks.thumbnailsTrack);
      model.setChapters(tracks.chaptersCues);
    }

    const error = this.#error.value?.error;
    const started = playback?.started ?? false;
    const ended = playback?.ended ?? false;
    const target: TintState = error ? 'error' : !started ? 'poster' : ended ? 'ended' : 'playing';
    this.#transition(target);

    // Accent: the key art's colour on the poster (or the riffled frame's), the current frame's colour after that.
    if (model.status === 'ready') {
      const resting = target === 'poster' || target === 'ended';
      if (resting && this.#riffle < 0 && this.#artIndex !== model.keyArt()) this.#showArt(model.keyArt(), true);
      const frame = resting ? (this.#riffle >= 0 ? this.#riffle : model.keyArt()) : model.frameAt(time?.currentTime ?? 0);
      if (frame !== this.#frame) {
        this.#frame = frame;
        this.#setAccent(model, frame, Boolean(time?.seeking));
      }
    }
  }

  #transition(target: TintState): void {
    const prev = this.#state;
    if (prev === target) return;
    if (prev === 'folding' && target === 'playing') return; // the fold finishes on its own
    if (prev === 'unfolding' && target === 'ended') return;

    window.clearTimeout(this.#foldTimer);
    cancelAnimationFrame(this.#foldRaf);
    const canAnimate = prev !== null && !reducedMotion(this) && this.#model?.status === 'ready';

    if (canAnimate && (prev === 'poster' || prev === 'ended') && target === 'playing') {
      this.#runFold('in');
    } else if (canAnimate && (prev === 'playing' || prev === 'folding') && target === 'ended') {
      this.#runFold('out');
    } else {
      this.#fold.replaceChildren();
      this.#container?.removeAttribute('data-tint-sheet');
      this.#setState(target);
    }

    if (target === 'ended') this.#announce('Finished');
  }

  #setState(state: TintState): void {
    this.#state = state;
    this.#container?.setAttribute('data-tint-state', state);
  }

  /**
   * The unpacking (in), or the packing back up (out). Every stripe of the poster is one storyboard frame squeezed thin.
   * On play, each stripe opens back into its frame and the whole film lies out as a contact sheet. Then the frame you
   * start on grows into the picture while the rest drop into the timeline, each to its own moment. At the end it runs
   * backwards: the timeline rises into the sheet, and the sheet closes into the poster.
   *
   * One 2D canvas over the video; nothing is sampled from the video itself.
   */
  #runFold(direction: 'in' | 'out'): void {
    const container = this.#container!;
    const model = this.#model;
    const target = container.querySelector<HTMLElement>('[data-tint-fold-target]');
    const skip = new AbortController();
    const finish = () => {
      skip.abort();
      cancelAnimationFrame(this.#foldRaf);
      window.clearTimeout(this.#foldTimer);
      const playback = this.#playback.value;
      container.removeAttribute('data-tint-sheet');
      if (direction === 'in') {
        this.#fold.replaceChildren();
        this.#setState(playback?.ended ? 'ended' : 'playing');
      } else {
        // Let the poster fade in under the last frame before the canvas goes.
        this.#setState('ended');
        this.#foldTimer = window.setTimeout(() => this.#fold.replaceChildren(), 200);
      }
    };
    const P = container.getBoundingClientRect();
    const T = target?.getBoundingClientRect();
    if (!model || model.status !== 'ready' || !model.frames.length || !T?.width || !P.width) {
      this.#fold.replaceChildren();
      this.#setState(direction === 'in' ? 'playing' : 'ended');
      return;
    }
    this.#setState(direction === 'in' ? 'folding' : 'unfolding');
    // It never stands between the viewer and the film: any key, press or seek ends it on the spot.
    // A press needs a moment's grace, or the very click on Play would cancel it.
    const armed = performance.now() + 120;
    const cut = (event: Event) => {
      if (event instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      if (performance.now() >= armed) finish();
    };
    // Not wheel: on a page, the scroll that brings the player into view must not cancel what it starts.
    container.addEventListener('pointerdown', cut, { capture: true, passive: true, signal: skip.signal });
    // Keys count when they are meant for the player: focus inside it, or nowhere in particular (the Play button
    // that had focus has just gone away with the poster).
    const doc = container.ownerDocument;
    doc.addEventListener(
      'keydown',
      (event) => {
        const active = doc.activeElement;
        if (!active || active === doc.body || container.contains(active)) cut(event);
      },
      { capture: true, passive: true, signal: skip.signal }
    );
    videoOf(container)?.addEventListener('seeking', cut, { signal: skip.signal });

    const W = P.width;
    const H = P.height;
    const k = Math.min(2, dpr());
    const canvas = document.createElement('canvas');
    canvas.className = 'tint-fold-canvas';
    canvas.width = Math.round(W * k);
    canvas.height = Math.round(H * k);
    const g = canvas.getContext('2d')!;
    g.scale(k, k);
    this.#fold.replaceChildren(canvas);

    const frames = model.frames;
    const N = frames.length;
    const print = model.print(canvas.width, canvas.height, LIT);
    const pw = print ? print.width / N : 0;

    // The contact sheet: as many columns as fit the player's shape, tiles at the storyboard's own shape.
    // It sits above the timeline, so the tiles have somewhere to fall to.
    const aspect = frames[0]!.w / frames[0]!.h || 16 / 9;
    const pad = Math.min(W, H) * 0.05;
    const area = { x: pad, y: pad, w: W - 2 * pad, h: Math.max(H * 0.4, T.top - P.top - pad * 1.2 - pad) };
    const cols = Math.max(1, Math.round(Math.sqrt((N * (area.w / area.h)) / aspect)));
    const rows = Math.ceil(N / cols);
    const gap = Math.max(1.5, W * 0.0035);
    const tw = Math.min((area.w - gap * (cols - 1)) / cols, ((area.h - gap * (rows - 1)) / rows) * aspect);
    const th = tw / aspect;
    const gx = area.x + (area.w - (cols * tw + (cols - 1) * gap)) / 2;
    const gy = area.y + (area.h - (rows * th + (rows - 1) * gap)) / 2;
    const radius = Math.min(6, tw * 0.08);

    // The frame you start on, or end on, is the film itself: its tile on the sheet shows the live video, already
    // playing, and that tile grows into the picture. Live pixels stay sharp at full size and match the video exactly,
    // so the hand-off has no cut. Without a drawable video it falls back to the storyboard frame and a dissolve.
    const time = this.#time.value?.currentTime ?? 0;
    const hero = clamp(direction === 'in' ? model.frameAt(time) : N - 1, 0, N - 1);
    const video = videoOf(container);

    type Box = { x: number; y: number; w: number; h: number };
    // Each tile starts as its stripe in the poster's fingerprint band.
    const B = this.#band.getBoundingClientRect();
    const band = B.width ? { x: B.left - P.left, y: B.top - P.top, w: B.width, h: B.height } : { x: 0, y: 0, w: W, h: H };
    const stripe = (i: number): Box => ({ x: band.x + (i * band.w) / N, y: band.y, w: band.w / N + 0.5, h: band.h });
    // A short last row is centred, like a printed sheet, rather than left hanging at one edge.
    const lastRow = rows - 1;
    const lastShift = ((cols - (N - lastRow * cols)) * (tw + gap)) / 2;
    const tile = (i: number): Box => {
      const r = Math.floor(i / cols);
      return { x: gx + (i % cols) * (tw + gap) + (r === lastRow ? lastShift : 0), y: gy + r * (th + gap), w: tw, h: th };
    };
    const slot = (i: number): Box => ({ x: T.left - P.left + (i * T.width) / N, y: T.top - P.top, w: T.width / N + 0.5, h: T.height });
    // The hero lands exactly where the video draws its picture (contain), so the hand-off has no jump.
    const cover = getComputedStyle(container).getPropertyValue('--media-object-fit').trim() === 'cover';
    const fitW = cover ? Math.max(W, H * aspect) : Math.min(W, H * aspect);
    const fitH = fitW / aspect;
    const full: Box = { x: (W - fitW) / 2, y: (H - fitH) / 2, w: fitW, h: fitH };
    const mix = (a: Box, b: Box, t: number): Box => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t });

    // Timing, in ms (about 1.4 s, with the film playing from the first frame, so nobody waits on it).
    // Open: stripes become tiles in film order. Hold a beat. Settle: tiles drop to the timeline.
    const OPEN = 340;
    const OPEN_SPREAD = 220;
    const HOLD = 120;
    const SETTLE = 440;
    const SETTLE_SPREAD = 320;
    const settleAt = OPEN + OPEN_SPREAD + HOLD;
    const TOTAL = settleAt + SETTLE + SETTLE_SPREAD;
    const outQuart = (t: number) => 1 - (1 - t) ** 4;
    const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const step = (t: number, a: number, b: number) => {
      const x = clamp((t - a) / (b - a), 0, 1);
      return x * x * (3 - 2 * x);
    };

    const drawItem = (i: number, box: Box, picture: number, round: number, alpha = 1, live = false) => {
      const f = frames[i]!;
      const img = model.image(f.url);
      if (alpha <= 0) return;
      const source: [CanvasImageSource, number, number, number, number] | null =
        live && video ? [video, 0, 0, video.videoWidth, video.videoHeight] : img ? [img, f.x, f.y, f.w, f.h] : null;
      g.save();
      g.globalAlpha = alpha;
      g.beginPath();
      g.roundRect(box.x, box.y, box.w, box.h, Math.min(round, box.w / 2, box.h / 2));
      g.clip();
      // The stripe's colour underneath; the real frame fades up over it.
      if (print && picture < 1) g.drawImage(print, i * pw, 0, pw, print.height, box.x, box.y, box.w, box.h);
      if (source && picture > 0) {
        g.globalAlpha = picture * alpha;
        if (live) {
          // A black opening (fade, studio logo) still reads as a window, not a hole.
          g.fillStyle = '#000';
          g.fillRect(box.x, box.y, box.w, box.h);
        }
        g.drawImage(source[0], source[1], source[2], source[3], source[4], box.x, box.y, box.w, box.h);
      }
      g.restore();
      // A hairline edge while it is a tile, so a black frame (a fade, a logo) still reads as a frame on the sheet.
      if (picture > 0.05 && box.w > 8) {
        g.save();
        g.globalAlpha = picture * alpha;
        g.strokeStyle = 'rgb(255 255 255 / 0.1)';
        g.lineWidth = 1;
        g.beginPath();
        g.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, Math.max(0, Math.min(round, box.w / 2, box.h / 2) - 0.5));
        g.stroke();
        g.restore();
      }
    };

    let heroLive = direction === 'out' && video !== null && video.readyState >= 2 && video.videoWidth > 0;
    const DARK_IN = 200;
    const draw = (t: number) => {
      g.clearRect(0, 0, W, H);
      // The room goes dark over the key art as the sheet opens, and the film shows through as the tiles leave.
      const dark = step(t, 0, DARK_IN) * (1 - step(t, settleAt + SETTLE * 0.5, TOTAL - 40));
      // Once the dark is complete the key art can go (and comes back as it lifts, on the way out).
      container.toggleAttribute('data-tint-sheet', t >= DARK_IN);
      if (dark > 0) {
        g.fillStyle = `rgb(6 6 8 / ${dark})`;
        g.fillRect(0, 0, W, H);
      }
      const order = hero;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < N; i++) {
          // The hero is drawn first, underneath: the film opens out beneath the sheet, and is uncovered as the
          // other frames pour into the timeline.
          if ((pass === 0) !== (i === order)) continue;
          const pos = N > 1 ? i / (N - 1) : 0;
          const open = outQuart(clamp((t - pos * OPEN_SPREAD) / OPEN, 0, 1));
          const settle = inOutCubic(clamp((t - settleAt - pos * SETTLE_SPREAD) / SETTLE, 0, 1));
          const isHero = i === order;
          const end = isHero ? full : slot(i);
          let box = mix(stripe(i), tile(i), open);
          box = mix(box, end, settle);
          // A little lift as each tile leaves the sheet, so the drop reads as a fall rather than a slide.
          if (!isHero) box.y -= Math.sin(Math.PI * settle) * th * 0.35;
          // Each frame stays a picture for most of its fall, and becomes its stripe again as it lands.
          // A live hero simply arrives where the video is. A storyboard hero is a few seconds off the real frame
          // and soft when large, so it dissolves into the video instead.
          // Go live once the video has a frame, but never part-way through a dissolve.
          if (isHero && !heroLive && settle === 0 && video && video.readyState >= 2 && video.videoWidth > 0) heroLive = true;
          const live = isHero && heroLive;
          const picture = isHero ? open : open * (1 - step(settle, 0.6, 1));
          const alpha = isHero && !live ? 1 - step(settle, 0.5, 0.95) : 1;
          drawItem(i, box, picture, radius * (1 - settle) + (isHero ? 0 : 1), alpha, live);
          if (isHero && open > 0.5 && settle < 0.7) {
            // The frame you are about to watch is ringed in its own colour, and the ring carries it as it grows.
            g.save();
            g.globalAlpha = step(open, 0.5, 1) * (1 - step(settle, 0.25, 0.7));
            g.strokeStyle = accentCss(model, i);
            g.lineWidth = 2;
            g.beginPath();
            g.roundRect(box.x - 2.5, box.y - 2.5, box.w + 5, box.h + 5, radius + 2.5);
            g.stroke();
            g.restore();
          }
        }
      }
    };

    const start = performance.now();
    const frame = (now: number) => {
      const elapsed = now - start;
      draw(direction === 'in' ? elapsed : TOTAL - elapsed);
      if (elapsed < TOTAL) this.#foldRaf = requestAnimationFrame(frame);
      else finish();
    };
    draw(direction === 'in' ? 0 : TOTAL);
    cancelAnimationFrame(this.#foldRaf);
    this.#foldRaf = requestAnimationFrame(frame);
    // A hidden tab pauses animation frames; the player must not wait on it.
    window.clearTimeout(this.#foldTimer);
    this.#foldTimer = window.setTimeout(finish, TOTAL + 600);
  }

  #setAccent(model: TintModel, frame: number, seeking: boolean): void {
    const a = model.accentOf(frame);
    this.#hue += ((a.h - this.#hue + 540) % 360) - 180; // the short way round the colour wheel
    const style = this.#container!.style;
    style.setProperty('--tint-color-duration', seeking ? '320ms' : '');
    style.setProperty('--tint-l', String(a.l));
    style.setProperty('--tint-c', a.c.toFixed(4));
    style.setProperty('--tint-h', this.#hue.toFixed(2));
  }

  #onModel = (): void => {
    const model = this.#model;
    const container = this.#container;
    if (!model || !container) return;
    container.toggleAttribute('data-tint-ready', model.status === 'ready');
    container.style.setProperty('--tint-scene-count', String(model.scenes.length));
    this.#frame = -2;
    this.#paint();
    this.requestUpdate();
  };

  #paint(): void {
    const model = this.#model;
    if (!model || model.status !== 'ready') return;
    const rect = this.#band.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const print = model.print(rect.width * dpr(), rect.height * dpr(), LIT);
    if (!print) return;
    this.#canvas.width = print.width;
    this.#canvas.height = print.height;
    this.#canvas.getContext('2d')!.drawImage(print, 0, 0);
    this.#placeMark();
  }

  /** Show a frame as the key art: the storyboard frame now, the sharp still when it arrives. */
  #showArt(index: number, now: boolean): void {
    const model = this.#model;
    const f = model?.frames[index];
    if (!model || !f) return;
    if (index !== this.#artIndex) {
      this.#artIndex = index;
      const img = model.image(f.url);
      if (img) {
        this.#art.width = f.w;
        this.#art.height = f.h;
        this.#art.getContext('2d')!.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      }
      this.#artHi.removeAttribute('data-ready');
      this.#placeMark();
    }
    window.clearTimeout(this.#artTimer);
    const load = () => {
      const src = model.stillUrl(f.start, this.getBoundingClientRect().width * dpr());
      if (!src) return;
      const hi = this.#artHi;
      hi.onload = () => {
        if (hi.dataset.src === src && this.#artIndex === index) hi.setAttribute('data-ready', '');
      };
      if (hi.dataset.src === src && hi.complete && hi.naturalWidth) return hi.onload(new Event('load'));
      hi.dataset.src = src;
      hi.src = src;
    };
    // While riffling, only fetch a still once the pointer settles on a frame.
    if (now) load();
    else this.#artTimer = window.setTimeout(load, 160);
  }

  #placeMark(): void {
    const n = this.#model?.frames.length ?? 0;
    if (!n || this.#artIndex < 0) return;
    this.#mark.style.setProperty('--at', `${((this.#artIndex + 0.5) / n) * 100}%`);
    const f = this.#model!.frames[this.#artIndex]!;
    this.#markTime.textContent = formatTime(f.start);
  }

  #resting(): boolean {
    return this.#state === 'poster' || this.#state === 'ended';
  }

  #bandIndex(event: PointerEvent | MouseEvent): number {
    const n = this.#model?.frames.length ?? 0;
    const r = this.#band.getBoundingClientRect();
    if (!n || !r.width) return -1;
    return clamp(Math.floor(((event.clientX - r.left) / r.width) * n), 0, n - 1);
  }

  #onRiffle = (event: PointerEvent): void => {
    const model = this.#model;
    if (!model || model.status !== 'ready' || !this.#resting() || event.pointerType === 'touch') return;
    const index = this.#bandIndex(event);
    if (index < 0 || index === this.#riffle) return;
    this.#riffle = index;
    this.#container?.setAttribute('data-tint-riffle', '');
    this.#showArt(index, false);
    this.#frame = index;
    this.#setAccent(model, index, true);
  };

  #endRiffle = (): void => {
    if (this.#riffle < 0) return;
    this.#riffle = -1;
    this.#container?.removeAttribute('data-tint-riffle');
    const model = this.#model;
    if (model?.status === 'ready' && this.#resting()) this.#showArt(model.keyArt(), true);
    this.#frame = -2;
    this.requestUpdate();
  };

  /** A press on the band plays the film from that moment. */
  #onBandPress = (event: MouseEvent): void => {
    const model = this.#model;
    const time = this.#time.value;
    const playback = this.#playback.value;
    if (!model || model.status !== 'ready' || !this.#resting() || !time || !playback) return;
    const index = this.#bandIndex(event);
    if (index < 0) return;
    event.stopPropagation();
    const at = model.frames[index]!.start;
    this.#showArt(index, true);
    void Promise.resolve(time.seek(at)).finally(() => void playback.play());
  };

  /** `[` and `]` jump between scenes. Typing in a field is left alone. */
  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== '[' && event.key !== ']') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    const model = this.#model;
    const time = this.#time.value;
    if (!model?.scenes.length || !time) return;
    event.preventDefault();
    const current = model.sceneAt(time.currentTime);
    const nearStart = time.currentTime - model.scenes[current]!.start < 2;
    const next =
      event.key === ']' ? Math.min(model.scenes.length - 1, current + 1) : Math.max(0, nearStart ? current - 1 : current);
    void time.seek(model.scenes[next]!.start);
    this.#announce(`Scene ${next + 1} of ${model.scenes.length}`);
  };

  #announce(message: string): void {
    this.#live.textContent = '';
    requestAnimationFrame(() => (this.#live.textContent = message));
  }
}

/**
 * <tint-track>: the fingerprint as the timeline, inside <media-slider-track>. Draws a dimmed and a lit copy; CSS clips
 * the lit copy to the slider's fill. Also cuts small gaps at scene changes, frames the preview in the colour of the
 * pointed-at moment, and snaps a drag to a nearby scene cut.
 */
export class TintTrackElement extends UIElement {
  static readonly tagName = 'tint-track';

  #time = new PlayerController(this, playerContext, selectTime);
  #model: TintModel | null = null;
  #dim = document.createElement('canvas');
  #lit = document.createElement('canvas');
  #slider: HTMLElement | null = null;
  #lastScene = -1;
  #pointerTime = 0;
  #disconnect: AbortController | null = null;
  #resize: ResizeObserver | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    this.#dim.className = 'tint-track-dim';
    this.#lit.className = 'tint-track-lit';
    this.replaceChildren(this.#dim, this.#lit);

    const container = containerOf(this);
    this.#slider = this.closest('media-time-slider');
    if (!container) return;
    this.#model = getModel(container);

    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    this.#model.addEventListener('change', this.#paint, { signal });
    this.#slider?.addEventListener('pointermove', this.#onPointer, { signal });
    this.#slider?.addEventListener('pointerdown', this.#onPointer, { signal });
    this.#slider?.addEventListener('drag-end', this.#onDragEnd, { signal });
    this.#resize = new ResizeObserver(this.#paint);
    this.#resize.observe(this);
    this.#paint();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    this.#resize?.disconnect();
    this.#resize = null;
  }

  #paint = (): void => {
    const model = this.#model;
    const track = this.parentElement;
    if (!model || model.status !== 'ready') {
      track?.style.removeProperty('--tint-cuts');
      return;
    }
    const width = this.getBoundingClientRect().width;
    if (!width) return;
    // Drawn at the expanded height so it stays sharp when the timeline grows.
    const height = 28;
    for (const [canvas, filter] of [
      [this.#dim, DIM],
      [this.#lit, LIT],
    ] as const) {
      const print = model.print(width * dpr(), height * dpr(), filter);
      if (!print) continue;
      canvas.width = print.width;
      canvas.height = print.height;
      canvas.getContext('2d')!.drawImage(print, 0, 0);
    }

    const cuts = model.scenes.slice(1).map((s) => (s.start / model.duration) * 100);
    track?.style.setProperty(
      '--tint-cuts',
      cuts.length
        ? `linear-gradient(to right, ${cuts
            .map((c) => `#000 calc(${c}% - 1.5px), transparent calc(${c}% - 1.5px) calc(${c}% + 1.5px), #000 calc(${c}% + 1.5px)`)
            .join(', ')})`
        : 'none'
    );
  };

  #onPointer = (event: PointerEvent): void => {
    const model = this.#model;
    const slider = this.#slider;
    if (!model || model.status !== 'ready' || !slider) return;
    const rect = this.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const t = fraction * (this.#time.value?.duration || model.duration);
    this.#pointerTime = t;
    const frame = model.frameAt(t);
    slider.style.setProperty('--tint-pointer-color', accentCss(model, frame));
    const scene = model.sceneAt(t);
    for (const label of slider.querySelectorAll<HTMLElement>('[data-tint-pointer-scene]')) {
      const title = model.scenes[scene]?.title;
      if (label.dataset.scene !== String(scene)) {
        label.dataset.scene = String(scene);
        label.replaceChildren(...(title ? [document.createTextNode(title)] : [text('tint.scene', 'Scene'), document.createTextNode(` ${scene + 1}`)]));
      }
    }
    // A small tick on phones that support it when the drag crosses into another scene.
    if (slider.hasAttribute('data-dragging') && scene !== this.#lastScene && this.#lastScene !== -1) navigator.vibrate?.(8);
    this.#lastScene = scene;
  };

  /** Releasing within 6 px of a scene cut lands exactly on it. */
  #onDragEnd = (): void => {
    const model = this.#model;
    const time = this.#time.value;
    if (!model || !time || !model.scenes.length) return;
    const width = this.getBoundingClientRect().width;
    const duration = time.duration || model.duration;
    const tolerance = (6 / width) * duration;
    const cut = model.scenes.find((s) => s.index > 0 && Math.abs(s.start - this.#pointerTime) <= tolerance);
    this.#lastScene = -1;
    if (cut) window.setTimeout(() => void time.seek(cut.start), 0);
  };
}

/**
 * <tint-bloom>: the fingerprint opens into the film under your pointer.
 *
 * Every stripe in the timeline is one frame squeezed thin. While you point at, drag or step through the timeline, the
 * stripes near that moment widen and rise back into the frames they came from, and the rest of the film squeezes
 * aside. The magnification is a one-dimensional graphical fisheye (Sarkar & Brown, 1992): the frame under the pointer
 * stays exactly under the pointer, so what you see is where you will land. Frames already watched are lit, the rest
 * dimmed, as on the track.
 */
export class TintBloomElement extends UIElement {
  static readonly tagName = 'tint-bloom';

  #time = new PlayerController(this, playerContext, selectTime);
  #model: TintModel | null = null;
  #canvas = document.createElement('canvas');
  #slider: HTMLElement | null = null;
  #track: HTMLElement | null = null;
  #sprites = new Map<string, { lit: HTMLCanvasElement; dim: HTMLCanvasElement }>();
  #open = 0;
  #want = 0;
  #focus = 0;
  #keys = false;
  #keyTimer = 0;
  #raf = 0;
  #disconnect: AbortController | null = null;
  #watch: MutationObserver | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    this.#canvas.className = 'tint-bloom-canvas';
    this.replaceChildren(this.#canvas);

    const container = containerOf(this);
    this.#slider = this.closest('media-time-slider');
    this.#track = this.#slider?.querySelector('media-slider-track') ?? null;
    if (!container || !this.#slider) return;
    this.#model = getModel(container);

    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    const onModel = () => {
      this.#sprites.clear();
      container.toggleAttribute('data-tint-bloom', this.#model?.status === 'ready');
    };
    this.#model.addEventListener('change', onModel, { signal });
    onModel();

    // Open while the timeline is pointed at or dragged; Video.js marks both on the slider.
    this.#watch = new MutationObserver(() => this.#sync());
    this.#watch.observe(this.#slider, { attributes: true, attributeFilter: ['data-pointing', 'data-dragging'] });
    // Keyboard users get the same view: each step opens the strip around the current time for a moment.
    this.#slider.addEventListener(
      'keydown',
      (e) => {
        if (!/^(Arrow|Home|End|Page|\d)/.test(e.key)) return;
        this.#keys = true;
        window.clearTimeout(this.#keyTimer);
        this.#keyTimer = window.setTimeout(() => ((this.#keys = false), this.#sync()), 1400);
        this.#sync();
      },
      // Capture, so the player's own key handling can't swallow the step before we see it.
      { signal, capture: true }
    );
    this.#slider.addEventListener('focusout', () => ((this.#keys = false), this.#sync()), { signal });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    this.#watch?.disconnect();
    this.#watch = null;
    cancelAnimationFrame(this.#raf);
    window.clearTimeout(this.#keyTimer);
  }

  #sync(): void {
    const s = this.#slider;
    const active = Boolean(s && (s.hasAttribute('data-pointing') || s.hasAttribute('data-dragging') || this.#keys));
    this.#want = active && this.#model?.status === 'ready' && !s?.hasAttribute('data-disabled') ? 1 : 0;
    if (!this.#raf) this.#raf = requestAnimationFrame(this.#tick);
  }

  #alive = false;
  #keepAlive(): void {
    this.#alive = true;
  }

  #tick = (): void => {
    this.#raf = 0;
    const calm = reducedMotion(this);
    this.#open = calm ? this.#want : this.#open + (this.#want - this.#open) * 0.24;
    if (Math.abs(this.#want - this.#open) < 0.004) this.#open = this.#want;
    this.#alive = false;
    this.#draw();
    // Keep drawing while open, so the bloom follows the pointer and the playhead.
    if (this.#open > 0 || this.#want > 0 || this.#alive) this.#raf = requestAnimationFrame(this.#tick);
  };

  /** The storyboard image lit or dimmed once, so each frame is a plain copy. */
  #sprite(url: string): { lit: HTMLCanvasElement; dim: HTMLCanvasElement } | null {
    let s = this.#sprites.get(url);
    if (s) return s;
    const img = this.#model?.image(url);
    if (!img?.naturalWidth) return null;
    const make = (filter: string) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.filter = filter;
      g.drawImage(img, 0, 0);
      return c;
    };
    s = { lit: make(LIT), dim: make(DIM) };
    this.#sprites.set(url, s);
    return s;
  }

  #draw(): void {
    const model = this.#model;
    const slider = this.#slider;
    const track = this.#track;
    if (!model || model.status !== 'ready' || !slider || !track) return;
    const open = this.#open;
    this.toggleAttribute('data-open', open > 0.01);
    if (open <= 0.01) return;

    const s = slider.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    const player = containerOf(this)?.getBoundingClientRect();
    const W = t.width;
    const H = Math.round(Math.min(124, Math.max(54, (player?.height ?? 300) * 0.24)));
    const base = Math.max(1, t.height);
    // Sit on the track and rise from it; lift the time label above the tallest frame.
    this.style.left = `${t.left - s.left}px`;
    this.style.width = `${W}px`;
    this.style.height = `${H}px`;
    this.style.bottom = `${s.bottom - t.bottom}px`;

    const k = dpr();
    if (this.#canvas.width !== Math.round(W * k) || this.#canvas.height !== Math.round(H * k)) {
      this.#canvas.width = Math.round(W * k);
      this.#canvas.height = Math.round(H * k);
    }
    const g = this.#canvas.getContext('2d')!;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, W, H);
    this.#canvas.style.opacity = String(Math.min(1, open * 1.6));

    // Where we are looking: the pointer while pointing or dragging, otherwise the playhead.
    const css = getComputedStyle(slider);
    const pointing = slider.hasAttribute('data-pointing') || slider.hasAttribute('data-dragging');
    const raw = parseFloat(css.getPropertyValue(pointing ? '--media-slider-pointer' : '--media-slider-fill'));
    const n = model.frames.length;
    const unit = W / n;
    const rawU = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw / 100)) : this.#focus;
    const focusIndex = Math.min(n - 1, Math.floor(rawU * n));
    // The lens centres on the frame you are pointing at, gliding from frame to frame rather than jumping.
    const centre = (focusIndex + 0.5) / n;
    const glide = reducedMotion(this) || open < 0.05 ? 1 : 0.35;
    this.#focus += (centre - this.#focus) * glide;
    if (Math.abs(centre - this.#focus) > 0.0005) this.#keepAlive();
    const c = this.#focus;

    // A fisheye lens of fixed reach (Sarkar & Brown): the frame at its centre grows most, its neighbours less and less,
    // and stripes beyond its reach keep their place, so only the part of the film you are looking at opens.
    const f0 = model.frames[focusIndex]!;
    const aspect = f0.w && f0.h ? f0.w / f0.h : 16 / 9;
    const target = Math.min(H * aspect, W * 0.24);
    const reach = Math.min(0.5, (1.6 * target) / W);
    const d = Math.max(0, (target / unit - 1) * open);
    const lens = (q: number) => ((d + 1) * q) / (d * q + 1);
    const fish = (x: number) => {
      const dx = x - c;
      const r = dx >= 0 ? Math.min(reach, 1 - c) : Math.min(reach, c);
      if (r <= 0 || Math.abs(dx) >= r) return x;
      return c + Math.sign(dx) * r * lens(Math.abs(dx) / r);
    };

    // First pass: where every frame lands, and how wide the widest one is.
    const edges = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) edges[i] = fish(i / n) * W;
    let wmax = 0;
    for (let i = 0; i < n; i++) wmax = Math.max(wmax, edges[i + 1]! - edges[i]!);
    // Show the frame you will land on whole: the bloom is as tall as that frame's picture, within limits.
    const top = Math.max(base, Math.min(H, wmax / aspect));

    const now = this.#time.value?.currentTime ?? 0;
    let focusBox: [number, number, number, number] | null = null;
    for (let i = 0; i < n; i++) {
      const x0 = edges[i]!;
      const w = edges[i + 1]! - x0;
      const f = model.frames[i]!;
      const sprite = this.#sprite(f.url);
      if (sprite && w > 0.05) {
        const src = f.start < now ? sprite.lit : sprite.dim;
        // Thin stripes stay track-high; frames rise toward full height as they widen.
        const grow = wmax > unit * 1.6 ? Math.min(1, Math.max(0, (w - unit * 1.5) / (wmax - unit * 1.5))) : 0;
        const h = base + (top - base) * grow * grow * (3 - 2 * grow);
        const y = H - h;
        const gap = w > 14 ? 1 : 0;
        if (grow < 1) {
          // As a stripe: the whole frame squeezed to its width, as in the fingerprint.
          g.globalAlpha = 1;
          g.drawImage(src, f.x, f.y, f.w, f.h, x0, y, w + 0.4, h);
        }
        if (grow > 0) {
          // As a frame: the middle of the picture, cropped to the space it has.
          const box = (w - gap) / h;
          const fa = f.w / f.h;
          const sw = box < fa ? f.h * box : f.w;
          const sh = box < fa ? f.h : f.w / box;
          g.globalAlpha = grow;
          g.save();
          g.beginPath();
          g.roundRect(x0 + gap / 2, y, w - gap, h, Math.min(6, w / 6) * grow);
          g.clip();
          g.drawImage(src, f.x + (f.w - sw) / 2, f.y + (f.h - sh) / 2, sw, sh, x0 + gap / 2, y, w - gap, h);
          g.restore();
        }
        if (i === focusIndex) focusBox = [x0 + gap / 2, y, w - gap, h];
      }
    }
    g.globalAlpha = 1;
    // The time and scene ride just above the frame you will land on.
    slider.style.setProperty('--tint-bloom-lift', `${top - (t.bottom - s.top) + 10}px`);

    // The frame you will land on, ringed in its own colour over a dark halo so it reads on any picture.
    if (focusBox && open > 0.5) {
      const [x, y, w, h] = focusBox;
      g.lineWidth = 4;
      g.strokeStyle = 'rgb(0 0 0 / 0.55)';
      g.beginPath();
      g.roundRect(x - 1, y - 1, w + 2, h + 2, 7);
      g.stroke();
      g.lineWidth = 2;
      g.strokeStyle = accentCss(model, focusIndex);
      g.beginPath();
      g.roundRect(x - 1, y - 1, w + 2, h + 2, 7);
      g.stroke();
    }
  }
}

/** <tint-scene-count>: "7 scenes", shown on the poster once the fingerprint is read. */
export class TintSceneCountElement extends UIElement {
  static readonly tagName = 'tint-scene-count';

  #model: TintModel | null = null;
  #disconnect: AbortController | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    const container = containerOf(this);
    if (!container) return;
    this.#model = getModel(container);
    this.#disconnect = new AbortController();
    this.#model.addEventListener('change', this.#render, { signal: this.#disconnect.signal });
    this.#render();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
  }

  #render = (): void => {
    const n = this.#model?.status === 'ready' ? this.#model.scenes.length : 0;
    this.toggleAttribute('hidden', n < 2);
    this.replaceChildren(document.createTextNode(`${n} `), text('tint.scenes', 'scenes'));
  };
}

/**
 * <tint-scenes>: fills a <media-menu-content> with one item per scene. Selecting an item seeks to the scene.
 */
export class TintScenesElement extends UIElement {
  static readonly tagName = 'tint-scenes';

  #time = new PlayerController(this, playerContext, selectTime);
  #model: TintModel | null = null;
  #items: HTMLElement[] = [];
  #current = -1;
  #disconnect: AbortController | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    const container = containerOf(this);
    if (!container) return;
    this.#model = getModel(container);
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    this.#model.addEventListener('change', this.#build, { signal });
    // Thumbnails are painted when the menu opens, once the items have a size. Then each scene lifts off the timeline.
    const menu = this.closest('media-menu');
    menu?.addEventListener(
      'open-change',
      (event) => {
        if (event.target !== menu) return;
        const open = Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open);
        this.#land();
        requestAnimationFrame(() => {
          this.#paintThumbs();
          if (open) requestAnimationFrame(this.#lift);
        });
      },
      { signal }
    );
    this.#build();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#land();
    this.#disconnect?.abort();
    this.#disconnect = null;
    for (const old of this.#items) old.remove();
    this.#items = [];
  }

  protected override update(changed: PropertyValues): void {
    super.update(changed);
    const model = this.#model;
    const time = this.#time.value;
    if (!model || !time || !this.#items.length) return;
    const k = model.sceneAt(time.currentTime);
    if (k === this.#current) return;
    this.#current = k;
    this.#items.forEach((item, i) => item.toggleAttribute('data-current', i === k));
  }

  #build = (): void => {
    const model = this.#model;
    this.#current = -1;
    if (!model || model.status !== 'ready') {
      for (const old of this.#items) old.remove();
      this.#items = [];
      return;
    }
    for (const old of this.#items) old.remove();
    this.#items = model.scenes.map((scene) => {
      const item = document.createElement('media-menu-item');
      item.className = 'tint-scene-item';
      item.style.setProperty('--tint-scene-color', accentCss(model, scene.face));

      const thumb = document.createElement('span');
      thumb.className = 'tint-scene-thumb';
      thumb.dataset.frame = String(scene.face);
      thumb.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'tint-scene-name';
      if (scene.title) name.textContent = scene.title;
      else name.append(text('tint.scene', 'Scene'), document.createTextNode(` ${scene.index + 1}`));

      const at = document.createElement('span');
      at.className = 'tint-scene-time';
      at.textContent = formatTime(scene.start);
      at.setAttribute('aria-label', spokenTime(scene.start));

      item.append(thumb, name, at);
      item.addEventListener('select', () => void this.#time.value?.seek(scene.start));
      return item;
    });
    // Items go straight into the menu page, next to this element, so the menu can measure them like any other item.
    this.before(...this.#items);
    this.requestUpdate();
  };

  #paintThumbs = (): void => {
    const model = this.#model;
    if (!model) return;
    for (const item of this.#items) {
      const thumb = item.querySelector<HTMLElement>('.tint-scene-thumb');
      if (thumb) paintFrame(model, thumb, Number(thumb.dataset.frame));
    }
  };

  // ---------- The lift: each scene's stretch of the timeline rises into its row ----------

  #layer: HTMLElement | null = null;
  #flying: HTMLElement[] = [];

  /** Put the thumbnails back and clear any flight in progress. Safe to call at any time. */
  #land = (): void => {
    for (const thumb of this.#flying) thumb.style.removeProperty('visibility');
    this.#flying = [];
    if (this.#layer) {
      for (const a of this.#layer.getAnimations({ subtree: true })) a.cancel();
      this.#layer.replaceChildren();
      try {
        this.#layer.hidePopover();
      } catch {
        // Already hidden.
      }
    }
  };

  #lift = (): void => {
    const model = this.#model;
    const container = containerOf(this);
    const menu = this.closest<HTMLElement>('media-menu');
    const track = container?.querySelector<HTMLElement>('.tint-track');
    if (!model || model.status !== 'ready' || !container || !menu || !track || !model.duration) return;
    if (reducedMotion(this) || matchMedia('(forced-colors: active)').matches) return;
    if (!menu.matches(':popover-open') || !menu.offsetWidth) return;
    const cr = container.getBoundingClientRect();
    const tr = track.getBoundingClientRect();
    if (!tr.width || !cr.width) return;

    // The menu is still growing and scaling in. Read where each thumbnail will come to rest by holding the menu's
    // transitions at their end for one synchronous measurement, then putting them back.
    const running = menu.getAnimations({ subtree: true });
    const held = running.map((a) => a.currentTime);
    for (const a of running) {
      const end = a.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end)) a.currentTime = end;
    }
    const menuBottom = menu.getBoundingClientRect().bottom;
    const rests = this.#items.map((item) => item.querySelector<HTMLElement>('.tint-scene-thumb')?.getBoundingClientRect() ?? null);
    running.forEach((a, i) => (a.currentTime = held[i] ?? null));
    const rest = (r: DOMRect) => ({ left: r.left - cr.left, top: r.top - cr.top, width: r.width, height: r.height, bottom: r.bottom });

    // The flight is drawn in its own top-layer sheet over the menu, clipped to the player.
    let layer = this.#layer;
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'tint-lift';
      layer.setAttribute('popover', 'manual');
      layer.setAttribute('aria-hidden', 'true');
      container.append(layer);
      this.#layer = layer;
    }
    Object.assign(layer.style, { left: `${cr.left}px`, top: `${cr.top}px`, width: `${cr.width}px`, height: `${cr.height}px` });
    try {
      layer.showPopover();
    } catch {
      return;
    }

    const print = model.print(Math.round(tr.width * dpr()), Math.round(28 * dpr()), LIT);
    const radius = getComputedStyle(this.#items[0]?.querySelector('.tint-scene-thumb') ?? menu).borderRadius;
    const DURATION = 460;
    const STEP = 26;
    let flown = 0;

    model.scenes.forEach((scene, i) => {
      const thumb = this.#items[i]?.querySelector<HTMLElement>('.tint-scene-thumb');
      const at = rests[i];
      if (!thumb || !at) return;
      const to = rest(at);
      // Rows scrolled out of the menu stay where they are.
      if (!to.width || to.bottom > menuBottom + 1) return;
      const end = model.scenes[i + 1]?.start ?? model.duration;
      const from = {
        left: tr.left - cr.left + (tr.width * scene.start) / model.duration,
        top: tr.top - cr.top,
        width: Math.max(2, (tr.width * (end - scene.start)) / model.duration),
        height: tr.height,
      };

      const ghost = document.createElement('span');
      ghost.className = 'tint-lift-ghost';
      Object.assign(ghost.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: radius });
      const picture = document.createElement('span');
      picture.className = 'tint-lift-frame';
      ghost.append(picture);
      if (print) {
        const slice = document.createElement('canvas');
        slice.className = 'tint-lift-slice';
        const sx = Math.floor((print.width * scene.start) / model.duration);
        const sw = Math.max(1, Math.ceil((print.width * (end - scene.start)) / model.duration));
        slice.width = sw;
        slice.height = print.height;
        slice.getContext('2d')!.drawImage(print, sx, 0, sw, print.height, 0, 0, sw, print.height);
        ghost.append(slice);
      }
      layer!.append(ghost);
      paintFrame(model, picture, scene.face);
      thumb.style.visibility = 'hidden';
      this.#flying.push(thumb);

      const delay = flown++ * STEP;
      const options: KeyframeAnimationOptions = { duration: DURATION, delay, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'backwards' };
      const motion = ghost.animate(
        [
          {
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
            borderRadius: '1px',
          },
          { transform: 'none', borderRadius: radius },
        ],
        options
      );
      ghost.querySelector('.tint-lift-slice')?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], options);
      motion.onfinish = () => {
        thumb.style.removeProperty('visibility');
        ghost.remove();
        this.#flying = this.#flying.filter((t) => t !== thumb);
        if (!this.#flying.length) this.#land();
      };
    });
    if (!flown) this.#land();
  };
}

export function defineTintElements(): void {
  for (const element of [TintPrintElement, TintTrackElement, TintBloomElement, TintSceneCountElement, TintScenesElement]) {
    if (!customElements.get(element.tagName)) customElements.define(element.tagName, element);
  }
}
