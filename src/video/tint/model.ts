/**
 * The colour model behind Tint.
 *
 * Everything comes from the player's thumbnails track (the same storyboard the time slider preview reads). Each
 * storyboard frame gives one slit-scanned column of the fingerprint, one accent colour, and a point for finding scene
 * cuts. Nothing samples the playing video, so there is no per-frame cost and no tainted cross-origin video.
 */

import type { MediaTextCue, MediaThumbnailsTrack } from '@videojs/html';

export interface Frame {
  start: number;
  end: number;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mean OKLab colour of the frame, for scene detection. */
  lab: [number, number, number];
  /** Strongest hue in the frame, as OKLCH chroma and hue. */
  chroma: number;
  hue: number;
}

export interface Scene {
  index: number;
  start: number;
  end: number;
  /** The scene's most colourful frame, used for its picture and colour. */
  face: number;
  title: string;
}

export interface Accent {
  l: number;
  c: number;
  h: number;
}

type Status = 'idle' | 'loading' | 'ready' | 'unavailable';

const registry = new WeakMap<Element, TintModel>();

/** One model per player container, shared by every Tint element inside it. */
export function getModel(container: Element): TintModel {
  let model = registry.get(container);
  if (!model) {
    model = new TintModel();
    registry.set(container, model);
  }
  return model;
}

export class TintModel extends EventTarget {
  status: Status = 'idle';
  frames: Frame[] = [];
  scenes: Scene[] = [];
  duration = 0;
  #images = new Map<string, HTMLImageElement>();
  #key = '';
  #chapters: MediaTextCue[] = [];
  #prints = new Map<string, HTMLCanvasElement>();

  /** Load a thumbnails track. Calling again with the same track does nothing. */
  async setTrack(track: MediaThumbnailsTrack | null): Promise<void> {
    const key = track?.cues.length ? `${track.src ?? ''}|${track.cues.length}|${track.cues[0]?.text}` : '';
    if (key === this.#key) return;
    this.#key = key;
    this.#prints.clear();

    if (!track || !key) {
      this.#set('unavailable', [], 0);
      return;
    }

    this.#set('loading', [], 0);
    try {
      const frames = parseCues(track.cues, track.src);
      const urls = [...new Set(frames.map((f) => f.url))];
      const crossOrigin = track.crossOrigin ?? 'anonymous';
      const images = await Promise.all(urls.map((u) => loadImage(u, crossOrigin)));
      if (key !== this.#key) return; // a newer track arrived while loading
      this.#images = new Map(urls.map((u, i) => [u, images[i]!]));
      analyse(frames, this.#images);
      this.#set('ready', frames, frames.at(-1)?.end ?? 0);
    } catch {
      if (key === this.#key) this.#set('unavailable', [], 0);
    }
  }

  /** Authored chapters win over detected scenes. */
  setChapters(cues: MediaTextCue[]): void {
    const same = cues.length === this.#chapters.length && cues.every((c, i) => c.startTime === this.#chapters[i]?.startTime);
    if (same) return;
    this.#chapters = cues;
    if (this.status === 'ready') {
      this.scenes = this.#buildScenes();
      this.dispatchEvent(new Event('change'));
    }
  }

  frameAt(time: number): number {
    const { frames } = this;
    if (!frames.length) return -1;
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid]!.start <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  sceneAt(time: number): number {
    let k = 0;
    this.scenes.forEach((s, i) => {
      if (time >= s.start) k = i;
    });
    return k;
  }

  /** The accent for a frame: its strongest hue, set to a lightness that reads on the dark controls surface. */
  accentOf(index: number): Accent {
    const f = this.frames[index];
    if (!f || f.chroma < 0.025) return { l: 0.9, c: 0.01, h: f?.hue ?? 70 };
    return { l: 0.8, c: Math.min(0.17, Math.max(0.1, f.chroma * 1.6)), h: f.hue };
  }

  /** The film's most vivid frame, its signature colour. */
  signature(): number {
    let best = 0;
    this.frames.forEach((f, i) => {
      if (f.chroma > this.frames[best]!.chroma) best = i;
    });
    return best;
  }

  image(url: string): HTMLImageElement | undefined {
    return this.#images.get(url);
  }

  /**
   * The fingerprint at a given pixel size: each frame is cut into thin vertical slits and each slit is squeezed to one
   * column, so stripes keep the image's real structure. Cached per size and filter.
   */
  print(width: number, height: number, filter = 'none'): HTMLCanvasElement | null {
    if (this.status !== 'ready') return null;
    const W = Math.max(1, Math.round(width));
    const H = Math.max(1, Math.round(height));
    const key = `${W}x${H}|${filter}`;
    const cached = this.#prints.get(key);
    if (cached) return cached;

    const n = this.frames.length;
    const slits = Math.max(2, Math.min(10, Math.round(W / n / 3)));
    const cols = document.createElement('canvas');
    cols.width = n * slits;
    cols.height = H;
    const cg = cols.getContext('2d')!;
    cg.imageSmoothingQuality = 'high';
    this.frames.forEach((f, i) => {
      const img = this.#images.get(f.url);
      if (!img) return;
      for (let k = 0; k < slits; k++) {
        cg.drawImage(img, f.x + (k * f.w) / slits, f.y, f.w / slits, f.h, i * slits + k, 0, 1, H);
      }
    });

    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const g = out.getContext('2d')!;
    g.imageSmoothingEnabled = false; // crisp stripe edges, like a printed barcode
    g.filter = filter;
    g.drawImage(cols, 0, 0, W, H);

    if (this.#prints.size > 12) this.#prints.clear();
    this.#prints.set(key, out);
    return out;
  }

  #set(status: Status, frames: Frame[], duration: number): void {
    this.status = status;
    this.frames = frames;
    this.duration = duration;
    this.scenes = status === 'ready' ? this.#buildScenes() : [];
    this.dispatchEvent(new Event('change'));
  }

  #buildScenes(): Scene[] {
    const { frames } = this;
    if (!frames.length) return [];
    const faceOf = (from: number, to: number) => {
      let face = from;
      for (let i = from; i <= to; i++) {
        if (frames[i]!.chroma * frames[i]!.lab[0] > frames[face]!.chroma * frames[face]!.lab[0]) face = i;
      }
      return face;
    };

    const chapters = this.#chapters.filter((c) => Number.isFinite(c.startTime));
    if (chapters.length > 1) {
      return chapters.map((c, i) => {
        const first = this.frameAt(c.startTime);
        const last = Math.max(first, this.frameAt(Math.max(c.startTime, c.endTime - 0.01)));
        return { index: i, start: c.startTime, end: c.endTime, face: faceOf(first, last), title: c.text.trim() };
      });
    }

    // Scene cuts: frames whose mean colour jumps further than usual from the frame before.
    const d = frames.slice(1).map((f, i) => {
      const p = frames[i]!.lab;
      return Math.hypot(f.lab[0] - p[0], f.lab[1] - p[1], f.lab[2] - p[2]);
    });
    const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, d.length));
    const threshold = Math.max(0.035, mean + 0.45 * sd);
    const starts = [0];
    d.forEach((v, i) => {
      if (v > threshold && i + 1 - starts.at(-1)! >= 2) starts.push(i + 1);
    });
    const kept = starts.slice(0, 12);
    return kept.map((first, k) => {
      const last = k + 1 < kept.length ? kept[k + 1]! - 1 : frames.length - 1;
      return { index: k, start: frames[first]!.start, end: frames[last]!.end, face: faceOf(first, last), title: '' };
    });
  }
}

function parseCues(cues: MediaTextCue[], base: string | null): Frame[] {
  const frames: Frame[] = [];
  for (const cue of cues) {
    const text = cue.text.trim();
    const hash = text.indexOf('#xywh=');
    const raw = hash === -1 ? text : text.slice(0, hash);
    let url: string;
    try {
      url = new URL(raw, base ?? location.href).href;
    } catch {
      continue;
    }
    const xywh = hash === -1 ? null : text.slice(hash + 6).split(',').map(Number);
    frames.push({
      start: cue.startTime,
      end: cue.endTime,
      url,
      x: xywh?.[0] ?? 0,
      y: xywh?.[1] ?? 0,
      w: xywh?.[2] ?? 0,
      h: xywh?.[3] ?? 0,
      lab: [0, 0, 0],
      chroma: 0,
      hue: 70,
    });
  }
  return frames.sort((a, b) => a.start - b.start);
}

function loadImage(url: string, crossOrigin: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = crossOrigin;
  img.decoding = 'async';
  img.src = url;
  return img.decode().then(() => img);
}

// sRGB → OKLab (Björn Ottosson's matrices).
const lin = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function oklab(r8: number, g8: number, b8: number): [number, number, number] {
  const r = lin(r8);
  const g = lin(g8);
  const b = lin(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function analyse(frames: Frame[], images: Map<string, HTMLImageElement>): void {
  const W = 32;
  const H = 18;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const BINS = 24;

  for (const f of frames) {
    const img = images.get(f.url);
    if (!img) continue;
    const w = f.w || img.naturalWidth;
    const h = f.h || img.naturalHeight;
    g.clearRect(0, 0, W, H);
    g.drawImage(img, f.x, f.y, w, h, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;

    const bins = Array.from({ length: BINS }, () => ({ w: 0, a: 0, b: 0, c: 0 }));
    let sL = 0;
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [L, a, b] = oklab(px[i]!, px[i + 1]!, px[i + 2]!);
      sL += L;
      sa += a;
      sb += b;
      const C = Math.hypot(a, b);
      // Ignore near-black and near-white pixels; weight by chroma² so the strongest colour wins.
      const band = Math.max(0, Math.min(1, (L - 0.18) / 0.12)) * Math.max(0, Math.min(1, (0.95 - L) / 0.1));
      const weight = C * C * band;
      if (weight <= 0) continue;
      const deg = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
      const bin = bins[Math.floor(deg / (360 / BINS)) % BINS]!;
      bin.w += weight;
      bin.a += a * weight;
      bin.b += b * weight;
      bin.c += C * weight;
    }
    const n = px.length / 4;
    f.lab = [sL / n, sa / n, sb / n];

    let best = -1;
    let bestW = 0;
    for (let k = 0; k < BINS; k++) {
      const merged = bins[k]!.w + 0.5 * (bins[(k + 1) % BINS]!.w + bins[(k + BINS - 1) % BINS]!.w);
      if (merged > bestW) {
        bestW = merged;
        best = k;
      }
    }
    const top = best >= 0 ? bins[best]! : null;
    if (top && top.w > 1e-6) {
      f.chroma = top.c / top.w;
      f.hue = (Math.atan2(top.b, top.a) * 180) / Math.PI;
    }
  }
}
