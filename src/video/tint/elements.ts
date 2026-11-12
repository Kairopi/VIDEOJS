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
import { SlitScanGL } from './slitscan';

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

type Box = { x: number; y: number; w: number; h: number };

/**
 * The contact sheet: every frame of the film at the storyboard's own shape, in as many columns as fit the area, with a
 * short last row centred like a printed sheet. Shared by the unpacking and the end sheet so both land on the same tiles.
 */
function sheetGrid(area: Box, n: number, aspect: number, width: number, valign = 0.5) {
  const gap = Math.max(1.5, width * 0.0035);
  // The column count that gives the largest tiles in this area.
  const fit = (c: number) => {
    const r = Math.ceil(n / c);
    return Math.min((area.w - gap * (c - 1)) / c, ((area.h - gap * (r - 1)) / r) * aspect);
  };
  let cols = 1;
  for (let c = 2; c <= n; c++) if (fit(c) > fit(cols)) cols = c;
  const rows = Math.ceil(n / cols);
  const tw = Math.max(1, fit(cols));
  const th = tw / aspect;
  const gx = area.x + (area.w - (cols * tw + (cols - 1) * gap)) / 2;
  const height = rows * th + (rows - 1) * gap;
  const gy = area.y + (area.h - height) * valign;
  const lastRow = rows - 1;
  const lastShift = ((cols - (n - lastRow * cols)) * (tw + gap)) / 2;
  const tile = (i: number): Box => {
    const r = Math.floor(i / cols);
    return { x: gx + (i % cols) * (tw + gap) + (r === lastRow ? lastShift : 0), y: gy + r * (th + gap), w: tw, h: th };
  };
  return { tile, tw, th, height, radius: Math.min(6, tw * 0.08) };
}

/** One storyboard frame as a tile: the picture, clipped round, with a hairline so a black frame still reads as a frame. */
function drawTile(g: CanvasRenderingContext2D, model: TintModel, i: number, box: Box, radius: number, sharpWidth = 0): void {
  const f = model.frames[i];
  const img = f && model.image(f.url);
  if (!f || !img) return;
  const r = Math.min(radius, box.w / 2, box.h / 2);
  g.save();
  g.beginPath();
  g.roundRect(box.x, box.y, box.w, box.h, r);
  g.clip();
  // The sharp picture when it has arrived (cropped to the tile's shape), the storyboard tile until then.
  const hi = sharpWidth ? model.sharp(i, sharpWidth) : undefined;
  if (hi) {
    const a = box.w / box.h;
    const ia = hi.naturalWidth / hi.naturalHeight;
    const sw = ia > a ? hi.naturalHeight * a : hi.naturalWidth;
    const sh = ia > a ? hi.naturalHeight : hi.naturalWidth / a;
    g.drawImage(hi, (hi.naturalWidth - sw) / 2, (hi.naturalHeight - sh) / 2, sw, sh, box.x, box.y, box.w, box.h);
  } else g.drawImage(img, f.x, f.y, f.w, f.h, box.x, box.y, box.w, box.h);
  g.restore();
  if (box.w > 8) {
    g.save();
    g.strokeStyle = 'rgb(255 255 255 / 0.1)';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, Math.max(0, r - 0.5));
    g.stroke();
    g.restore();
  }
}

/** Where the video draws its picture inside the player (contain, or cover when the page asks for it). */
function pictureBox(container: HTMLElement, W: number, H: number, aspect: number): Box {
  const cover = getComputedStyle(container).getPropertyValue('--media-object-fit').trim() === 'cover';
  const fitW = cover ? Math.max(W, H * aspect) : Math.min(W, H * aspect);
  const fitH = fitW / aspect;
  return { x: (W - fitW) / 2, y: (H - fitH) / 2, w: fitW, h: fitH };
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
      this.#runFold('in', prev === 'ended' && this.#container?.hasAttribute('data-tint-contact'));
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
  #runFold(direction: 'in' | 'out', fromSheet = false): void {
    const container = this.#container!;
    const model = this.#model;
    const target = container.querySelector<HTMLElement>('[data-tint-fold-target]');
    // At the end the film packs up into the end sheet and stays there; from the sheet, it unpacks again.
    const endSheet = container.querySelector<TintContactElement>('tint-contact');
    const toSheet = direction === 'out' && Boolean(endSheet?.available());
    const sheetLayout = toSheet || fromSheet;
    if (toSheet) endSheet!.preload();
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
        // The end sheet (or the poster) draws under the last frame before the canvas goes.
        this.#setState('ended');
        endSheet?.render();
        this.#foldTimer = window.setTimeout(() => this.#fold.replaceChildren(), toSheet ? 60 : 200);
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
    // From the end sheet, the seek that picked the frame (or Replay's own rewind) is still arriving: give it longer.
    const armed = performance.now() + (fromSheet ? 360 : 120);
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
    // It sits above the timeline, so the tiles have somewhere to fall to; or exactly on the end sheet's tiles.
    const aspect = frames[0]!.w / frames[0]!.h || 16 / 9;
    const pad = Math.min(W, H) * 0.05;
    const area = (sheetLayout && endSheet?.area()) || { x: pad, y: pad, w: W - 2 * pad, h: Math.max(H * 0.4, T.top - P.top - pad * 1.2 - pad) };
    const { tile, th, radius } = sheetGrid(area, N, aspect, W);

    // The frame you start on, or end on, is the film itself: its tile on the sheet shows the live video, already
    // playing, and that tile grows into the picture. Live pixels stay sharp at full size and match the video exactly,
    // so the hand-off has no cut. Without a drawable video it falls back to the storyboard frame and a dissolve.
    const time = this.#time.value?.currentTime ?? 0;
    const picked = Number(container.dataset.tintFrom);
    container.removeAttribute('data-tint-from');
    const hero = clamp(direction === 'in' ? (Number.isInteger(picked) && fromSheet ? picked : model.frameAt(time)) : N - 1, 0, N - 1);
    const video = videoOf(container);

    // Each tile starts as its stripe in the poster's fingerprint band.
    const B = this.#band.getBoundingClientRect();
    const band = B.width ? { x: B.left - P.left, y: B.top - P.top, w: B.width, h: B.height } : { x: 0, y: 0, w: W, h: H };
    const stripe = (i: number): Box => ({ x: band.x + (i * band.w) / N, y: band.y, w: band.w / N + 0.5, h: band.h });
    const slot = (i: number): Box => ({ x: T.left - P.left + (i * T.width) / N, y: T.top - P.top, w: T.width / N + 0.5, h: T.height });
    // The hero lands exactly where the video draws its picture (contain), so the hand-off has no jump.
    const full = pictureBox(container, W, H, aspect);
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

    // From the end sheet the frames are already open, so only the drop runs; to it, only the rise.
    const sheetAt = OPEN + OPEN_SPREAD;
    const from = direction === 'in' ? (fromSheet ? sheetAt : 0) : TOTAL;
    const to = direction === 'in' ? TOTAL : toSheet ? sheetAt : 0;
    const length = Math.abs(to - from);
    const start = performance.now();
    const frame = (now: number) => {
      const elapsed = Math.min(length, now - start);
      draw(from + Math.sign(to - from) * elapsed);
      if (elapsed < length) this.#foldRaf = requestAnimationFrame(frame);
      else finish();
    };
    draw(from);
    cancelAnimationFrame(this.#foldRaf);
    this.#foldRaf = requestAnimationFrame(frame);
    // A hidden tab pauses animation frames; the player must not wait on it.
    window.clearTimeout(this.#foldTimer);
    this.#foldTimer = window.setTimeout(finish, length + 600);
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
  // The seek streak: a jump (ten seconds back, a click further along) leaves a short trail of light from where you
  // were to where you landed, so the move is seen, not just the result.
  #streak = document.createElement('span');
  #lastTime = -1;

  protected override update(changed: PropertyValues): void {
    super.update(changed);
    const time = this.#time.value;
    if (!time) return;
    const now = time.currentTime;
    const before = this.#lastTime;
    this.#lastTime = now;
    const duration = time.duration || this.#model?.duration || 0;
    if (before < 0 || !duration || this.#slider?.hasAttribute('data-dragging')) return;
    // Only on the playing film: the unpacking and the end sheet have their own motion.
    if (containerOf(this)?.getAttribute('data-tint-state') !== 'playing') return;
    // Playback moves a fraction of a second per update; anything larger is a jump.
    const jump = now - before;
    if (Math.abs(jump) < 1.5) return;
    this.#runStreak(before / duration, now / duration);
  }

  #runStreak(from: number, to: number): void {
    if (reducedMotion(this) || !this.isConnected) return;
    const track = this.parentElement;
    const width = track?.getBoundingClientRect().width ?? 0;
    if (!track || !width) return;
    const forward = to > from;
    // At least a short comet tail behind the landing point, so a ten-second step on a long film still reads.
    const tail = Math.max(Math.abs(to - from), Math.min(0.4, 150 / width));
    const land = clamp(to, 0, 1);
    const a = (forward ? Math.max(0, land - tail) : land) * 100;
    const b = (forward ? land : Math.min(1, land + tail)) * 100;
    if (b - a < 0.2) return;
    const s = this.#streak;
    s.style.left = `${a}%`;
    s.style.width = `${b - a}%`;
    s.dataset.dir = forward ? 'forward' : 'back';
    if (!s.isConnected) track.append(s);
    s.getAnimations().forEach((x) => x.cancel());
    // Each leg eases on its own: the light runs out quickly, holds a moment at the landing, then fades.
    s.animate(
      [
        { opacity: 0.2, transform: 'scaleX(0)', easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
        { opacity: 1, transform: 'scaleX(1)', offset: 0.35, easing: 'linear' },
        { opacity: 1, transform: 'scaleX(1)', offset: 0.5, easing: 'ease-in' },
        { opacity: 0, transform: 'scaleX(1)' },
      ],
      // Short, because it follows every press of the 10 s buttons.
      { duration: 420 }
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    this.#dim.className = 'tint-track-dim';
    this.#lit.className = 'tint-track-lit';
    this.#streak.className = 'tint-streak';
    this.#streak.setAttribute('aria-hidden', 'true');
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
    const rect = this.getBoundingClientRect();
    const width = rect.width;
    if (!width) return;
    // Drawn at the strip's own height, so the stripes stay crisp however tall the bar is.
    const height = Math.max(28, Math.round(rect.height));
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
    const base = Math.max(1, t.height);
    // Frames rise well clear of the strip, however tall the strip is.
    // Frames float clear of the strip by GAP, with PAD above for the ring, so the frame you will land on is never cut.
    const GAP = 7;
    const PAD = 3;
    // On a short player, leave room above the frame for the time and scene label (about 30 px) inside the player.
    const above = player ? t.top - player.top - GAP - PAD - 30 : Infinity;
    const H = Math.round(base + GAP + PAD + Math.max(36, Math.min(104, (player?.height ?? 300) * 0.27, above)));
    const room = H - base - GAP - PAD;
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
    // Keep to the strip's rounded corners where it is strip-high; frames that rise may use the space above it.
    const r = Math.min(base / 2, parseFloat(getComputedStyle(track).borderTopLeftRadius) || 0);
    g.save();
    if (r > 0) {
      g.beginPath();
      g.roundRect(0, H - base, W, base, r);
      g.rect(0, 0, W, H - base - 1);
      g.clip();
    }

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
    // The strip shares the bar with the controls, so on a short strip the lens may take a larger share of it.
    const target = Math.min(room * aspect, Math.max(W * 0.24, Math.min(W * 0.5, 300)));
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
    const top = Math.max(8, Math.min(room, wmax / aspect));
    const floor = H - base - GAP;

    const now = this.#time.value?.currentTime ?? 0;
    let focusBox: [number, number, number, number] | null = null;
    for (let i = 0; i < n; i++) {
      const x0 = edges[i]!;
      const w = edges[i + 1]! - x0;
      const f = model.frames[i]!;
      const sprite = this.#sprite(f.url);
      if (sprite && w > 0.05) {
        const src = f.start < now ? sprite.lit : sprite.dim;
        // In the strip, every frame stays a stripe: the whole frame squeezed to its width, as in the fingerprint
        // (and as dim ahead as the strip). The lens only widens it.
        g.globalAlpha = f.start < now ? 1 : 0.62;
        g.drawImage(src, f.x, f.y, f.w, f.h, x0, H - base, w + 0.4, base);
        // Above the strip, the frames that widen rise out of it as pictures, tallest at the lens.
        const grow = wmax > unit * 1.6 ? Math.min(1, Math.max(0, (w - unit * 1.5) / (wmax - unit * 1.5))) : 0;
        const h = top * grow * grow * (3 - 2 * grow);
        const y = floor - h;
        const gap = w > 14 ? 1 : 0;
        if (grow > 0 && h > 1) {
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
    g.restore();
    // The time and scene ride just above the frame you will land on.
    slider.style.setProperty('--tint-bloom-lift', `${base + GAP + top - (t.bottom - s.top) + 10}px`);

    // The frame you will land on, ringed in its own colour over a dark halo so it reads on any picture.
    if (focusBox && open > 0.5 && focusBox[3] > 8) {
      // Kept inside the canvas, so the ring is whole at either end of the strip too.
      const x = Math.max(3, focusBox[0]);
      const w = Math.min(W - 3, focusBox[0] + focusBox[2]) - x;
      const [, y, , h] = focusBox;
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

/**
 * <tint-pause>: what a pause shows. Streaming services use a pause to say where you are (Netflix's title card, Prime
 * Video's X-Ray); Apple TV dims a little so the controls read, then gets out of the way so you can study the frame.
 * Tint does both: after a beat, a card with the title and the film's one line (and a chapter's name, when the video
 * has chapters). After a while untouched, the card and the shade lift and leave the frame clean.
 * Display only, so it is hidden from assistive tech (the player already announces the pause).
 */
export class TintPauseElement extends UIElement {
  static readonly tagName = 'tint-pause';

  static readonly SHOW_AFTER_MS = 900;
  static readonly REST_AFTER_MS = 9000;

  #playback = new PlayerController(this, playerContext, selectPlayback);
  #time = new PlayerController(this, playerContext, selectTime);
  #model: TintModel | null = null;
  #container: HTMLElement | null = null;
  #kicker = document.createElement('p');
  #chapter = document.createElement('p');
  #line = document.createElement('p');
  #showTimer = 0;
  #restTimer = 0;
  #shownScene = -1;
  #disconnect: AbortController | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    // Only what means something to the person watching, as on Netflix's pause: what this is, in words. A chapter
    // name when the video has real chapters; never a detected scene number or a time range, which the timeline
    // already shows and which name nothing.
    this.#kicker.className = 'tint-pause-kicker';
    this.#kicker.append(text('tint.watching', "You're watching"));
    this.#chapter.className = 'tint-pause-chapter';
    this.#line.className = 'tint-pause-line';
    // The title stays as authored in the template (a <media-title>); the kicker goes above it, the rest below.
    this.prepend(this.#kicker);
    this.append(this.#chapter, this.#line);

    this.#container = containerOf(this);
    if (!this.#container) return;
    this.#model = getModel(this.#container);
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    // Any movement over a resting pause brings the card back for another while.
    this.#container.addEventListener('pointermove', () => this.#wake(), { signal, passive: true });
    this.#container.addEventListener('keydown', () => this.#wake(), { signal, capture: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    window.clearTimeout(this.#showTimer);
    window.clearTimeout(this.#restTimer);
  }

  protected override update(changed: PropertyValues): void {
    super.update(changed);
    const playback = this.#playback.value;
    const container = this.#container;
    if (!playback || !container) return;
    const paused = Boolean(playback.started && playback.paused && !playback.ended);
    if (!paused) {
      window.clearTimeout(this.#showTimer);
      window.clearTimeout(this.#restTimer);
      this.#showTimer = 0;
      container.removeAttribute('data-tint-pause');
      container.removeAttribute('data-tint-pause-rest');
      this.#shownScene = -1;
      return;
    }
    // A quick pause and resume should not flash a card.
    if (!container.hasAttribute('data-tint-pause') && !this.#showTimer) {
      this.#showTimer = window.setTimeout(() => {
        this.#showTimer = 0;
        if (!this.#playback.value?.paused) return;
        this.#fill();
        container.setAttribute('data-tint-pause', '');
        this.#wake();
      }, TintPauseElement.SHOW_AFTER_MS);
    }
    // Stepping through a paused film (arrow keys, the 10 s buttons) keeps the card on the scene you are in.
    if (container.hasAttribute('data-tint-pause')) this.#fill();
  }

  #wake(): void {
    const container = this.#container;
    if (!container?.hasAttribute('data-tint-pause')) return;
    container.removeAttribute('data-tint-pause-rest');
    window.clearTimeout(this.#restTimer);
    this.#restTimer = window.setTimeout(() => container.setAttribute('data-tint-pause-rest', ''), TintPauseElement.REST_AFTER_MS);
  }

  #fill(): void {
    // The film's one line, when the page gives the title card one.
    const line = this.#container?.querySelector('.tint-logline')?.textContent?.trim() ?? '';
    if (this.#line.textContent !== line) this.#line.textContent = line;
    const model = this.#model;
    const now = this.#time.value?.currentTime ?? 0;
    const k = model?.status === 'ready' && model.scenes.length ? model.sceneAt(now) : -1;
    if (k === this.#shownScene) return;
    this.#shownScene = k;
    this.#chapter.textContent = (k >= 0 && model!.scenes[k]!.title) || '';
  }
}

/**
 * <tint-scrub>: slit-scan scrubbing. Drag the playhead quickly and the picture smears through time: each vertical
 * slice of the screen shows the same slice of a different moment, the one you are on at the leading edge and the ones
 * you have just passed trailing behind, the way slit-scan photography records time across space. The faster you drag,
 * the longer the trail. Slow down or let go and the slices converge on one frame and dissolve into the real picture.
 *
 * Drawn in WebGL 2 (see slitscan.ts), sharpening as Mux's stills arrive; on a 2D canvas where WebGL 2 is missing.
 * Skipped under reduced motion.
 */
export class TintScrubElement extends UIElement {
  static readonly tagName = 'tint-scrub';

  #time = new PlayerController(this, playerContext, selectTime);
  #model: TintModel | null = null;
  #container: HTMLElement | null = null;
  #slider: HTMLElement | null = null;
  #canvas = document.createElement('canvas');
  #dragging = false;
  #raf = 0;
  #last = 0;
  #u = -1;
  #prevU = -1;
  #vel = 0;
  #len = 0;
  #dir = 1;
  #disconnect: AbortController | null = null;
  #watch: MutationObserver | null = null;
  // The WebGL picture once made (null where it can't be), and the canvas currently on show.
  #gl: SlitScanGL | null | undefined = undefined;
  #shown: HTMLCanvasElement = this.#canvas;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    this.#canvas.className = 'tint-scrub-canvas';
    this.replaceChildren(this.#canvas);
    this.#container = containerOf(this);
    this.#slider = this.#container?.querySelector('media-time-slider') ?? null;
    if (!this.#container || !this.#slider) return;
    this.#model = getModel(this.#container);
    this.#disconnect = new AbortController();
    // A new film needs a new atlas.
    this.#model.addEventListener('change', () => {
      this.#gl?.canvas.remove();
      this.#gl = undefined;
      this.#shown = this.#canvas;
      if (!this.#canvas.isConnected) this.append(this.#canvas);
    }, { signal: this.#disconnect.signal });
    this.#watch = new MutationObserver(() => {
      // The first time anyone points at the strip, get the sharp frames on their way.
      if (this.#slider?.hasAttribute('data-pointing') || this.#slider?.hasAttribute('data-dragging')) this.#prepare();
      const dragging = Boolean(this.#slider?.hasAttribute('data-dragging'));
      if (dragging === this.#dragging) return;
      this.#dragging = dragging;
      this.#prevU = -1;
      if (dragging && !this.#raf && !reducedMotion(this) && this.#model?.status === 'ready') {
        this.#last = performance.now();
        this.#raf = requestAnimationFrame(this.#tick);
      }
    });
    this.#watch.observe(this.#slider, { attributes: true, attributeFilter: ['data-dragging', 'data-pointing'] });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#watch?.disconnect();
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  #prepare(): void {
    const model = this.#model;
    if (this.#gl !== undefined || !model || model.status !== 'ready' || reducedMotion(this)) return;
    this.#gl = SlitScanGL.create(model, this.#container?.clientWidth ?? 0);
    if (!this.#gl) return;
    this.#gl.canvas.className = 'tint-scrub-canvas';
    this.#canvas.replaceWith(this.#gl.canvas);
    this.#shown = this.#gl.canvas;
    this.#gl.sharpen();
  }

  #tick = (now: number): void => {
    this.#raf = 0;
    const model = this.#model;
    const slider = this.#slider;
    if (!model || model.status !== 'ready' || !slider) return this.#hide();
    const dt = clamp((now - this.#last) / 1000, 0.001, 0.064);
    this.#last = now;
    let raw = 0;
    if (this.#dragging) {
      const p = parseFloat(getComputedStyle(slider).getPropertyValue('--media-slider-pointer'));
      if (Number.isFinite(p)) {
        const u = clamp(p / 100, 0, 1);
        if (this.#prevU >= 0) raw = (u - this.#prevU) / dt;
        this.#prevU = u;
        this.#u = u;
      }
    }
    // The pointer's speed along the film, smoothed so a jittery hand still draws a steady trail.
    this.#vel += (raw - this.#vel) * (1 - Math.exp(-dt / 0.07));
    if (Math.abs(this.#vel) > 0.03) this.#dir = Math.sign(this.#vel);
    const D = this.#time.value?.duration || model.duration;
    const n = model.frames.length;
    // Trail length in film seconds: about a third of the film for a sweep across the whole strip in a second.
    const want = this.#dragging ? Math.min(D * 0.3, Math.abs(this.#vel) * D * 0.4) : 0;
    this.#len += (want - this.#len) * (1 - Math.exp(-dt / (want > this.#len ? 0.05 : 0.14)));
    // Seen only once the trail spans a few frames; below that it fades back to the real picture.
    const span = n && D ? this.#len / (D / n) : 0;
    const t = clamp((span - 0.8) / 2, 0, 1);
    const alpha = t * t * (3 - 2 * t);
    if (alpha > 0.01 && this.#u >= 0) this.#draw(model, D, alpha);
    else this.#hide();
    if (this.#dragging || alpha > 0.01) this.#raf = requestAnimationFrame(this.#tick);
  };

  #hide(): void {
    this.#shown.style.opacity = '0';
    this.#container?.removeAttribute('data-tint-scrubbing');
  }

  #draw(model: TintModel, D: number, alpha: number): void {
    const container = this.#container!;
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (!W || !H) return;
    this.#prepare();
    // A lost WebGL context falls back to the 2D canvas for good.
    if (this.#gl?.lost) {
      this.#gl.canvas.replaceWith(this.#canvas);
      this.#gl = null;
      this.#shown = this.#canvas;
    }
    if (this.#gl) {
      const f0 = model.frames[0]!;
      const box = pictureBox(container, W, H, f0.w / f0.h || 16 / 9);
      this.#gl.draw(W, H, Math.min(2, dpr()), box, this.#u * D, this.#len, this.#dir >= 0 ? 1 : -1);
      this.#gl.canvas.style.opacity = alpha.toFixed(3);
      container.setAttribute('data-tint-scrubbing', '');
      return;
    }
    // Storyboard frames are small: a lower-resolution canvas costs nothing in sharpness.
    const k = Math.min(1.5, dpr());
    if (this.#canvas.width !== Math.round(W * k) || this.#canvas.height !== Math.round(H * k)) {
      this.#canvas.width = Math.round(W * k);
      this.#canvas.height = Math.round(H * k);
    }
    const g = this.#canvas.getContext('2d')!;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, W, H);
    const f0 = model.frames[0]!;
    const aspect = f0.w / f0.h || 16 / 9;
    const box = pictureBox(container, W, H, aspect);
    g.fillStyle = '#000';
    g.fillRect(box.x, box.y, box.w, box.h);
    g.imageSmoothingQuality = 'high';

    const c = this.#u * D;
    const L = this.#len;
    const forward = this.#dir >= 0;
    // Time at a point across the picture: now at the leading edge, further back toward the trailing edge, with the
    // slices widest near now and thinning out into the past, like a long exposure.
    const timeAt = (q: number) => (forward ? c - L * (1 - q) ** 1.4 : c + L * q ** 1.4);
    const STEP = 2;
    const cuts: number[] = [];
    let runStart = box.x;
    let runFrame = model.frameAt(timeAt(0));
    const paint = (x0: number, x1: number, i: number) => {
      const f = model.frames[i];
      const img = f && model.image(f.url);
      if (!f || !img || x1 <= x0) return;
      const q0 = (x0 - box.x) / box.w;
      const q1 = (x1 - box.x) / box.w;
      g.drawImage(img, f.x + q0 * f.w, f.y, (q1 - q0) * f.w, f.h, x0, box.y, x1 - x0 + 0.5, box.h);
    };
    for (let x = box.x + STEP; x <= box.x + box.w + STEP; x += STEP) {
      const xe = Math.min(x, box.x + box.w);
      const i = model.frameAt(clamp(timeAt((xe - box.x) / box.w), 0, D));
      if (i !== runFrame || xe >= box.x + box.w) {
        paint(runStart, xe, runFrame);
        if (xe < box.x + box.w) cuts.push(xe);
        runStart = xe;
        runFrame = i;
      }
    }
    // The seams between moments, as fine light lines, and the past falling into shadow toward the trailing edge.
    g.fillStyle = 'rgb(255 255 255 / 0.14)';
    for (const x of cuts) g.fillRect(Math.round(x), box.y, 1, box.h);
    const shade = g.createLinearGradient(forward ? box.x + box.w : box.x, 0, forward ? box.x : box.x + box.w, 0);
    shade.addColorStop(0, 'rgb(0 0 0 / 0)');
    shade.addColorStop(0.35, 'rgb(0 0 0 / 0.08)');
    shade.addColorStop(1, 'rgb(0 0 0 / 0.5)');
    g.fillStyle = shade;
    g.fillRect(box.x, box.y, box.w, box.h);
    this.#canvas.style.opacity = alpha.toFixed(3);
    container.setAttribute('data-tint-scrubbing', '');
  }
}

/**
 * <tint-contact>: the end sheet. When the film ends, the timeline rises back into a contact sheet of the whole film and
 * stays there: every storyboard frame in order, the way Brendan Dawes's Cinema Redux prints a film on one page. Point
 * at a frame to see its scene; press it to play from there. Replay starts again from the top, and Save poster
 * downloads the sheet as a print-sized PNG with the title and the fingerprint.
 *
 * Keyboard: each scene is a button over its first frame, then Replay, then Save poster.
 */
export class TintContactElement extends UIElement {
  static readonly tagName = 'tint-contact';

  #time = new PlayerController(this, playerContext, selectTime);
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #model: TintModel | null = null;
  #container: HTMLElement | null = null;
  #head = document.createElement('div');
  #kicker = document.createElement('p');
  #canvas = document.createElement('canvas');
  #scenes = document.createElement('div');
  #tip = document.createElement('span');
  #foot = document.createElement('div');
  #save = document.createElement('button');
  #hover = -1;
  #shown = false;
  #disconnect: AbortController | null = null;
  #watch: MutationObserver | null = null;
  #resize: ResizeObserver | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', 'The whole film');
    const title = this.querySelector('media-title');
    const replay = this.querySelector('media-play-button');
    this.#head.className = 'tint-contact-head';
    this.#kicker.className = 'tint-contact-kicker';
    this.#head.append(this.#kicker);
    if (title) this.#head.append(title);
    this.#canvas.className = 'tint-contact-canvas';
    this.#canvas.setAttribute('aria-hidden', 'true');
    this.#scenes.className = 'tint-contact-scenes';
    this.#tip.className = 'tint-contact-tip';
    this.#tip.setAttribute('aria-hidden', 'true');
    this.#foot.className = 'tint-contact-foot';
    this.#save.type = 'button';
    this.#save.className = 'tint-contact-save';
    this.#save.innerHTML = '<media-icon family="tint" name="download" class="tint-contact-icon"></media-icon>';
    this.#save.append(text('tint.savePoster', 'Save poster'));
    const hint = document.createElement('span');
    hint.className = 'tint-contact-hint';
    hint.append(text('tint.pickFrame', 'Pick any frame to play from there'));
    if (replay) this.#foot.append(replay);
    this.#foot.append(this.#save, hint);
    this.replaceChildren(this.#canvas, this.#head, this.#scenes, this.#tip, this.#foot);

    this.#container = containerOf(this);
    if (!this.#container) return;
    this.#model = getModel(this.#container);
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    this.#model.addEventListener('change', () => ((this.#hover = -1), this.#scenes.replaceChildren(), this.#sync()), { signal });
    this.#model.addEventListener('sharp', this.#onSharp, { signal });
    this.#canvas.addEventListener('pointermove', this.#onMove, { signal });
    this.#canvas.addEventListener('pointerleave', () => this.#setHover(-1), { signal });
    this.#canvas.addEventListener('click', this.#onPick, { signal });
    // The press is the sheet's own, not the player's tap-to-pause.
    for (const type of ['pointerdown', 'pointerup'] as const) this.addEventListener(type, (e) => e.stopPropagation(), { signal });
    replay?.addEventListener('click', () => this.#container?.setAttribute('data-tint-from', '0'), { signal, capture: true });
    this.#save.addEventListener('click', () => void this.#savePoster(), { signal });
    this.#watch = new MutationObserver(() => this.#sync());
    this.#watch.observe(this.#container, { attributes: true, attributeFilter: ['data-tint-state'] });
    this.#resize = new ResizeObserver(() => this.#sync());
    this.#resize.observe(this.#container);
    this.#sync();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#watch?.disconnect();
    this.#resize?.disconnect();
  }

  /** Whether the sheet can be shown: the storyboard is read and the player is big enough for it to mean something. */
  available(): boolean {
    const c = this.#container;
    return Boolean(this.#model?.status === 'ready' && this.#model.frames.length > 1 && c && c.clientWidth >= 300 && c.clientHeight >= 190);
  }

  /** Start fetching sharp tiles, so the sheet is crisp by the time the frames land in it. */
  preload(): void {
    const model = this.#model;
    const grid = this.#grid();
    if (!model || !grid) return;
    model.frames.forEach((_, i) => model.sharp(i, grid.tw * dpr()));
  }

  #redraw = 0;
  #onSharp = (): void => {
    if (!this.#shown || this.#redraw) return;
    this.#redraw = requestAnimationFrame(() => ((this.#redraw = 0), this.render()));
  };

  /** Where the tiles go, in the player's coordinates: between the title and the buttons. */
  area(): Box | null {
    const c = this.#container;
    if (!c || !this.available()) return null;
    const P = c.getBoundingClientRect();
    const head = this.#head.getBoundingClientRect();
    const foot = this.#foot.getBoundingClientRect();
    const pad = clamp(P.width * 0.04, 14, 40);
    const gap = clamp(P.height * 0.035, 8, 24);
    const top = head.bottom - P.top + gap;
    const bottom = foot.top - P.top - gap;
    return { x: pad, y: top, w: P.width - 2 * pad, h: Math.max(40, bottom - top) };
  }

  #sync(): void {
    const container = this.#container;
    if (!container) return;
    const state = container.getAttribute('data-tint-state');
    const shown = state === 'ended' && this.available();
    if (shown !== this.#shown) {
      this.#shown = shown;
      container.toggleAttribute('data-tint-contact', shown);
      if (shown) {
        this.#fill();
        // Focus that was on a control now hidden (the bar's Play) moves to Replay, not off into the page.
        requestAnimationFrame(() => {
          const active = container.ownerDocument.activeElement as HTMLElement | null;
          if (active && active !== container && container.contains(active) && !this.contains(active) && !active.checkVisibility?.()) {
            this.querySelector<HTMLElement>('media-play-button')?.focus();
          }
        });
      } else this.#setHover(-1);
    }
    if (shown) this.render();
  }

  #fill(): void {
    const model = this.#model!;
    const words = [`${model.frames.length} frames`];
    if (model.scenes.length > 1) words.push(`${model.scenes.length} scenes`);
    if (model.duration) words.push(formatTime(model.duration));
    this.#kicker.replaceChildren(text('tint.wholeFilm', 'The whole film'), document.createTextNode(` · ${words.join(' · ')}`));
  }

  #grid() {
    const area = this.area();
    const model = this.#model;
    if (!area || !model) return null;
    const f0 = model.frames[0]!;
    return sheetGrid(area, model.frames.length, f0.w / f0.h || 16 / 9, this.#container!.clientWidth);
  }

  /** Draw the sheet, with the pointed-at scene lit and the rest held back. */
  render(): void {
    const model = this.#model;
    const container = this.#container;
    const grid = this.#grid();
    if (!model || !container || !grid || !this.#shown) return;
    const W = container.clientWidth;
    const H = container.clientHeight;
    const k = dpr();
    if (this.#canvas.width !== Math.round(W * k) || this.#canvas.height !== Math.round(H * k)) {
      this.#canvas.width = Math.round(W * k);
      this.#canvas.height = Math.round(H * k);
    }
    const g = this.#canvas.getContext('2d')!;
    g.setTransform(k, 0, 0, k, 0, 0);
    // The same dark as the unpacking's room, so the hand-off from it has no seam.
    g.fillStyle = 'rgb(6 6 8)';
    g.fillRect(0, 0, W, H);
    const scene = this.#hover >= 0 ? model.sceneAt(model.frames[this.#hover]!.start) : -1;
    const sharpWidth = grid.tw * k;
    model.frames.forEach((f, i) => {
      g.globalAlpha = scene < 0 || model.sceneAt(f.start) === scene ? 1 : 0.38;
      drawTile(g, model, i, grid.tile(i), grid.radius, sharpWidth);
    });
    g.globalAlpha = 1;
    if (this.#hover >= 0) {
      const b = grid.tile(this.#hover);
      g.lineWidth = 4;
      g.strokeStyle = 'rgb(0 0 0 / 0.6)';
      g.beginPath();
      g.roundRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4, grid.radius + 2);
      g.stroke();
      g.lineWidth = 2;
      g.strokeStyle = accentCss(model, this.#hover);
      g.beginPath();
      g.roundRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4, grid.radius + 2);
      g.stroke();
    }
    this.#placeScenes(grid);
  }

  /** One button per scene, over its first frame, for the keyboard. */
  #placeScenes(grid: ReturnType<typeof sheetGrid>): void {
    const model = this.#model!;
    const scenes = model.scenes.length > 1 ? model.scenes : [{ index: 0, start: 0, end: model.duration, face: 0, title: '' }];
    if (this.#scenes.childElementCount !== scenes.length) {
      this.#scenes.replaceChildren(
        ...scenes.map((s, k) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tint-contact-scene';
          const first = model.frameAt(s.start);
          b.setAttribute('aria-label', `Play from ${s.title || `scene ${k + 1}`}, ${spokenTime(s.start)}`);
          b.addEventListener('click', () => this.#play(first));
          b.addEventListener('focus', () => this.#setHover(first));
          b.addEventListener('blur', () => this.#setHover(-1));
          return b;
        })
      );
    }
    [...this.#scenes.children].forEach((el, k) => {
      const b = grid.tile(model.frameAt(scenes[k]!.start));
      const s = (el as HTMLElement).style;
      s.left = `${b.x}px`;
      s.top = `${b.y}px`;
      s.width = `${b.w}px`;
      s.height = `${b.h}px`;
    });
  }

  #indexAt(event: PointerEvent | MouseEvent): number {
    const grid = this.#grid();
    const model = this.#model;
    const c = this.#container;
    if (!grid || !model || !c) return -1;
    const P = c.getBoundingClientRect();
    const x = event.clientX - P.left;
    const y = event.clientY - P.top;
    for (let i = 0; i < model.frames.length; i++) {
      const b = grid.tile(i);
      if (x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1) return i;
    }
    return -1;
  }

  #onMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    this.#setHover(this.#indexAt(event));
  };

  #onPick = (event: MouseEvent): void => {
    const i = this.#indexAt(event);
    if (i >= 0) this.#play(i);
  };

  #setHover(i: number): void {
    if (i === this.#hover) return;
    this.#hover = i;
    this.#canvas.style.cursor = i >= 0 ? 'pointer' : '';
    const model = this.#model;
    const grid = this.#grid();
    if (i >= 0 && model && grid) {
      const f = model.frames[i]!;
      const k = model.sceneAt(f.start);
      const title = model.scenes[k]?.title;
      const b = grid.tile(i);
      this.#tip.replaceChildren(
        ...(model.scenes.length > 1 ? [title ? document.createTextNode(title) : text('tint.scene', 'Scene'), document.createTextNode(title ? '' : ` ${k + 1}`)] : []),
        Object.assign(document.createElement('b'), { textContent: formatTime(f.start) })
      );
      this.#tip.style.left = `${b.x + b.w / 2}px`;
      this.#tip.style.top = `${b.y}px`;
      this.#tip.setAttribute('data-open', '');
    } else this.#tip.removeAttribute('data-open');
    this.render();
  }

  #play(i: number): void {
    const model = this.#model;
    const time = this.#time.value;
    const playback = this.#playback.value;
    const f = model?.frames[i];
    if (!f || !time || !playback) return;
    this.#container?.setAttribute('data-tint-from', String(i));
    void Promise.resolve(time.seek(f.start)).finally(() => void playback.play());
  }

  /** A print of the sheet, about 3:4: kicker, title, every frame, the fingerprint, and the facts underneath. */
  async #savePoster(): Promise<void> {
    const model = this.#model;
    const container = this.#container;
    if (!model || model.status !== 'ready' || !container) return;
    await document.fonts?.ready;
    const W = 1800;
    const m = 120;
    const f0 = model.frames[0]!;
    const aspect = f0.w / f0.h || 16 / 9;
    // Black frames (a fade, a logo on black) are left out of the print; everything else is there, credits included,
    // as in Cinema Redux.
    const shown = model.frames.map((_, i) => i).filter((i) => model.frames[i]!.lab[0] > 0.12 || model.frames[i]!.chroma > 0.02);
    // The columns are chosen for a page about 3:4; the page then takes the sheet's own height, so nothing floats.
    const top = 420;
    const grid = sheetGrid({ x: m, y: top, w: W - 2 * m, h: W * 1.3 - top - 340 }, shown.length, aspect, W * 1.4, 0);
    const bandH = 96;
    const bandY = top + grid.height + 72;
    const H = Math.round(bandY + bandH + 72 + 40 + m);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const hue = model.accentOf(model.signature()).h;
    g.fillStyle = '#0b0b0d';
    g.fillStyle = `oklch(0.14 0.018 ${hue})`;
    g.fillRect(0, 0, W, H);
    const font = getComputedStyle(this).fontFamily || 'system-ui, sans-serif';
    const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const title = clean(this.querySelector('media-title')?.textContent) || clean(container.querySelector('media-title')?.textContent) || 'Untitled';
    const kicker = clean(container.querySelector('.tint-kicker')?.textContent);
    const facts = clean(container.querySelector('.tint-meta-facts')?.textContent);
    const ink = 'rgb(246 244 240)';
    const ink2 = 'rgb(246 244 240 / 0.62)';
    g.textBaseline = 'alphabetic';

    let y = m + 34;
    if (kicker) {
      g.fillStyle = ink2;
      g.font = `650 30px ${font}`;
      g.letterSpacing = '5px';
      g.fillText(kicker.toUpperCase(), m, y);
      y += 40;
    }
    g.letterSpacing = '-4px';
    // Wide, as on the player's title card (Mona Sans has a width axis).
    g.fontStretch = 'expanded';
    let size = 168;
    g.font = `800 ${size}px ${font}`;
    while (size > 72 && g.measureText(title).width > W - 2 * m) g.font = `800 ${(size -= 8)}px ${font}`;
    y += size * 0.92;
    g.fillStyle = ink;
    g.fillText(title, m - 4, y);
    g.letterSpacing = '0px';
    g.fontStretch = 'normal';

    // The sheet, then the fingerprint under it: the same film twice, as pictures and as colour.
    const sharpWidth = grid.tw;
    this.#save.setAttribute('aria-busy', 'true');
    await model.sharpAll(shown, sharpWidth, 5000);
    this.#save.removeAttribute('aria-busy');
    shown.forEach((i, k) => drawTile(g, model, i, grid.tile(k), grid.radius * 1.4, sharpWidth));
    const print = model.print(W - 2 * m, bandH, LIT);
    if (print) {
      g.save();
      g.beginPath();
      g.roundRect(m, bandY, W - 2 * m, bandH, 12);
      g.clip();
      g.drawImage(print, m, bandY);
      g.restore();
    }
    g.font = `560 26px ${font}`;
    g.fillStyle = ink2;
    g.fillText('0:00', m, bandY + bandH + 40);
    g.textAlign = 'right';
    g.fillText(formatTime(model.duration), W - m, bandY + bandH + 40);
    g.textAlign = 'left';
    g.fillStyle = 'rgb(246 244 240 / 0.14)';
    g.fillRect(m, H - m - 50, W - 2 * m, 1);

    const line = [facts, model.scenes.length > 1 ? `${model.scenes.length} scenes` : '', `${shown.length} frames`].filter(Boolean).join('  ·  ');
    g.font = `560 30px ${font}`;
    g.fillStyle = ink;
    g.fillText(line, m, H - m);
    g.textAlign = 'right';
    g.fillStyle = ink2;
    g.fillText('Tint for Video.js', W - m, H - m);

    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob(resolve, 'image/png');
      } catch {
        resolve(null);
      }
    });
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'film'}-tint-poster.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

export function defineTintElements(): void {
  for (const element of [TintPrintElement, TintTrackElement, TintBloomElement, TintSceneCountElement, TintScenesElement, TintPauseElement, TintScrubElement, TintContactElement]) {
    if (!customElements.get(element.tagName)) customElements.define(element.tagName, element);
  }
}
