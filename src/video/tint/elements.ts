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
const SLICES = 96;
const STAGGER_MS = 4;

type TintState = 'poster' | 'folding' | 'playing' | 'unfolding' | 'ended' | 'error';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const width = el.getBoundingClientRect().width || 160;
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
  #printUrl = '';
  #state: TintState | null = null;
  #frame = -2;
  #hue = 70;
  #foldTimer = 0;
  #disconnect: AbortController | null = null;
  #resize: ResizeObserver | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
    this.#canvas.className = 'tint-print-canvas';
    this.#fold.className = 'tint-fold';
    this.#live.className = 'tint-announcer';
    this.#live.setAttribute('aria-live', 'polite');
    this.replaceChildren(this.#canvas, this.#fold);

    this.#container = containerOf(this);
    if (!this.#container) return;
    // The announcer lives outside this aria-hidden element so screen readers hear it.
    this.#container.append(this.#live);
    this.#model = getModel(this.#container);

    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;
    this.#model.addEventListener('change', this.#onModel, { signal });
    this.#container.addEventListener('keydown', this.#onKey, { signal });
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
    if (this.#printUrl) URL.revokeObjectURL(this.#printUrl);
    this.#printUrl = '';
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

    // Accent: the film's signature colour on the poster, the current frame's colour after that.
    if (model.status === 'ready') {
      const frame = target === 'poster' ? model.signature() : model.frameAt(time?.currentTime ?? 0);
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
    const canAnimate = prev !== null && !reducedMotion() && this.#model?.status === 'ready' && this.#printUrl;

    if (canAnimate && (prev === 'poster' || prev === 'ended') && target === 'playing') {
      this.#runFold('in');
    } else if (canAnimate && (prev === 'playing' || prev === 'folding') && target === 'ended') {
      this.#runFold('out');
    } else {
      this.#fold.replaceChildren();
      this.#setState(target);
    }

    if (target === 'ended') this.#announce('Finished');
  }

  #setState(state: TintState): void {
    this.#state = state;
    this.#container?.setAttribute('data-tint-state', state);
  }

  /** The fingerprint pours into the timeline (in), or rises back out of it (out). */
  #runFold(direction: 'in' | 'out'): void {
    const container = this.#container!;
    const target = container.querySelector<HTMLElement>('[data-tint-fold-target]');
    if (!target) {
      this.#setState(direction === 'in' ? 'playing' : 'ended');
      return;
    }

    this.#setState(direction === 'in' ? 'folding' : 'unfolding');
    const P = container.getBoundingClientRect();
    const T = target.getBoundingClientRect();
    const w = P.width / SLICES;
    const slices = Array.from({ length: SLICES }, (_, i) => {
      const s = document.createElement('i');
      s.style.cssText =
        `left:${i * w}px;width:${w + 1}px;height:${P.height}px;` +
        `background-image:url("${this.#printUrl}");background-size:${P.width}px ${P.height}px;` +
        `background-position:${-i * w}px 0;transition-delay:${i * STAGGER_MS}ms`;
      return s;
    });
    const landed = (i: number) =>
      `translate(${T.left - P.left + (i * T.width) / SLICES - i * w}px, ${T.top - P.top}px) ` +
      `scale(${T.width / P.width}, ${T.height / P.height})`;

    if (direction === 'out') slices.forEach((s, i) => (s.style.transform = landed(i)));
    slices.forEach((s) => (s.style.transitionProperty = 'none'));
    this.#fold.replaceChildren(...slices);
    void this.#fold.offsetWidth; // commit the start positions before transitioning
    slices.forEach((s, i) => {
      s.style.transitionProperty = '';
      s.style.transform = direction === 'in' ? landed(i) : 'none';
    });

    const duration = parseFloat(getComputedStyle(container).getPropertyValue('--tint-duration-fold')) || 680;
    this.#foldTimer = window.setTimeout(() => {
      this.#fold.replaceChildren();
      const playback = this.#playback.value;
      if (direction === 'in') this.#setState(playback?.ended ? 'ended' : 'playing');
      else this.#setState('ended');
    }, duration + SLICES * STAGGER_MS + 60);
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
    const rect = this.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const print = model.print(rect.width * dpr(), rect.height * dpr(), LIT);
    if (!print) return;
    this.#canvas.width = print.width;
    this.#canvas.height = print.height;
    this.#canvas.getContext('2d')!.drawImage(print, 0, 0);
    // A blob URL for the fold slices, made now so pressing play never waits on encoding.
    print.toBlob(
      (blob) => {
        if (!blob) return;
        if (this.#printUrl) URL.revokeObjectURL(this.#printUrl);
        this.#printUrl = URL.createObjectURL(blob);
      },
      'image/jpeg',
      0.92
    );
  }

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

/** <tint-scene-chip>: the current scene's colour swatch and number, in the control row. */
export class TintSceneChipElement extends UIElement {
  static readonly tagName = 'tint-scene-chip';

  #time = new PlayerController(this, playerContext, selectTime);
  #model: TintModel | null = null;
  #label = document.createElement('span');
  #scene = -1;
  #disconnect: AbortController | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    const swatch = document.createElement('span');
    swatch.className = 'tint-chip-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    this.#label.className = 'tint-chip-label';
    this.replaceChildren(swatch, this.#label);
    const container = containerOf(this);
    if (!container) return;
    this.#model = getModel(container);
    this.#disconnect = new AbortController();
    this.#model.addEventListener('change', () => ((this.#scene = -1), this.requestUpdate()), { signal: this.#disconnect.signal });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
  }

  protected override update(changed: PropertyValues): void {
    super.update(changed);
    const model = this.#model;
    const time = this.#time.value;
    const ready = Boolean(model && model.status === 'ready' && model.scenes.length > 1);
    this.toggleAttribute('hidden', !ready);
    if (!ready || !model || !time) return;
    const scene = model.sceneAt(time.currentTime);
    if (scene === this.#scene) return;
    this.#scene = scene;
    const title = model.scenes[scene]?.title;
    this.#label.replaceChildren(
      ...(title ? [document.createTextNode(title)] : [text('tint.scene', 'Scene'), document.createTextNode(` ${scene + 1}`)])
    );
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
    // Thumbnails are painted when the menu opens, once the items have a size.
    this.closest('media-menu')?.addEventListener('open-change', () => requestAnimationFrame(this.#paintThumbs), { signal });
    this.#build();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
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
}

export function defineTintElements(): void {
  for (const element of [TintPrintElement, TintTrackElement, TintSceneChipElement, TintSceneCountElement, TintScenesElement]) {
    if (!customElements.get(element.tagName)) customElements.define(element.tagName, element);
  }
}
