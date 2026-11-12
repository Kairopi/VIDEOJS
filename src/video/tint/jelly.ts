/**
 * Jelly: a soft disc you can poke, pull and stretch.
 *
 * The disc is a ring of points on springs, each tied to its neighbours, around a body on its own spring. Point near it
 * and it swells toward you; press and it squashes; hold and drag and it stretches after the pointer, the far side
 * thinning, and lets go with a wobble that runs round the rim. It is drawn on a 2D canvas as a fan of triangles from
 * the centre, each one mapping the same wedge of an undeformed texture, so the picture on the disc stretches with it.
 * No library: about two hundred lines of springs and affine maps.
 *
 * The canvas is larger than its button and centred on it, so a stretch has room to leave the button's box. The button
 * stays the thing you press; a press that became a pull does not click it.
 */

/** Points around the rim. */
const N = 40;
/** The canvas reaches this many radii from the centre. */
const REACH = 2.3;

export interface JellyOptions {
  /** How far a pull can stretch, in radii. */
  stretch?: number;
  /** How strongly it swells toward a pointer nearby, in radii. */
  swell?: number;
}

export class Jelly {
  readonly canvas = document.createElement('canvas');
  /** A square image drawn onto the disc, centred, edge to edge. */
  texture: CanvasImageSource | null = null;
  /** The texture's turn, in radians. */
  rotation = 0;
  /** No deformation: reduced motion, forced colours. */
  still = false;
  /** Set when the last press turned into a pull, so the click it ends in can be dropped. */
  pulled = false;

  #host: HTMLElement;
  #u = new Float32Array(N);
  #v = new Float32Array(N);
  #t = new Float32Array(N);
  #bx = 0;
  #by = 0;
  #bvx = 0;
  #bvy = 0;
  #R = 0;
  #dpr = 1;
  #drawnRotation = NaN;
  #drawnTexture: CanvasImageSource | null = null;
  #pull: { id: number; x0: number; y0: number; x: number; y: number; moved: boolean } | null = null;
  #hover: { x: number; y: number } | null = null;
  #stretch: number;
  #swell: number;
  #onWake: () => void;

  constructor(host: HTMLElement, signal: AbortSignal, onWake: () => void, options: JellyOptions = {}) {
    this.#host = host;
    this.#onWake = onWake;
    this.#stretch = options.stretch ?? 1.1;
    this.#swell = options.swell ?? 0.14;
    this.canvas.className = 'tint-jelly';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.addEventListener('pointerdown', this.#down, { signal });
    host.addEventListener('pointermove', this.#drag, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) host.addEventListener(type, this.#up, { signal });
    // A press that became a pull ends in a click on the button; drop it before the button sees it.
    host.addEventListener(
      'click',
      (event) => {
        if (!this.pulled) return;
        this.pulled = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, signal }
    );
  }

  /** The texture's pixels changed: draw again on the next frame. */
  invalidate(): void {
    this.#drawnRotation = NaN;
  }

  /** Size the canvas to the button. Returns the disc's radius in CSS pixels. */
  fit(): number {
    const R = this.#host.offsetWidth / 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (R !== this.#R || dpr !== this.#dpr) {
      this.#R = R;
      this.#dpr = dpr;
      const side = Math.ceil(R * REACH * 2 * dpr);
      this.canvas.width = side;
      this.canvas.height = side;
      this.canvas.style.setProperty('--tint-jelly-reach', String(REACH));
      this.#drawnRotation = NaN;
    }
    return R;
  }

  /** The pointer, from anywhere on the player, or null when it leaves. Touch never swells it. */
  hover(x: number, y: number): void;
  hover(away: null): void;
  hover(x: number | null, y = 0): void {
    this.#hover = x === null ? null : { x, y };
  }

  /** A squash, as from a press: the rim falls in and springs back out. */
  poke(strength = 1): void {
    if (this.still) return;
    const kick = this.#R * 5.5 * strength;
    for (let i = 0; i < N; i++) this.#v[i]! -= kick;
    this.#onWake();
  }

  /** A shove sideways, as from a jump in time: the body lurches that way and the rim ripples. */
  shove(dx: number, dy = 0): void {
    if (this.still) return;
    this.#bvx += dx * this.#R * 6;
    this.#bvy += dy * this.#R * 6;
    this.#onWake();
  }

  /** Where the body is now, relative to its rest, for anything riding on it (the icon). */
  get offset(): [number, number] {
    return [this.#bx, this.#by];
  }

  #centre(): [number, number] {
    const r = this.#host.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  #down = (event: PointerEvent): void => {
    if (this.still || event.button !== 0) return;
    this.pulled = false;
    this.#pull = { id: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, moved: false };
    this.poke(0.55);
  };

  #drag = (event: PointerEvent): void => {
    const pull = this.#pull;
    if (!pull || event.pointerId !== pull.id) return;
    pull.x = event.clientX;
    pull.y = event.clientY;
    if (!pull.moved && Math.hypot(pull.x - pull.x0, pull.y - pull.y0) > 7) {
      pull.moved = true;
      // From here it is a pull, not a press: keep the pointer even when it leaves the button.
      try {
        this.#host.setPointerCapture(pull.id);
      } catch {
        /* the pointer is already gone */
      }
    }
    this.#onWake();
  };

  #up = (event: PointerEvent): void => {
    const pull = this.#pull;
    if (!pull || event.pointerId !== pull.id) return;
    this.pulled = pull.moved;
    this.#pull = null;
    // The click, if any, comes right after; after that a stale flag must not eat a later click.
    if (this.pulled) window.setTimeout(() => (this.pulled = false), 0);
    this.#onWake();
  };

  /** Advance the springs. Returns true while anything is still moving. */
  step(dt: number): boolean {
    const R = this.#R;
    if (!R) return false;
    const u = this.#u;
    const v = this.#v;
    const t = this.#t;
    t.fill(0);
    let tbx = 0;
    let tby = 0;

    if (!this.still) {
      const [cx, cy] = this.#centre();
      const pull = this.#pull?.moved ? this.#pull : null;
      const at = pull ?? this.#hover;
      if (at) {
        const dx = at.x - cx;
        const dy = at.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        const phi = Math.atan2(dy, dx);
        if (pull) {
          // Rubber band: easy at first, harder the further it goes, never past its limit.
          const L = R * this.#stretch;
          const reach = L * (1 - 1 / (d / L + 1));
          tbx = (dx / d) * reach * 0.38;
          tby = (dy / d) * reach * 0.38;
          for (let i = 0; i < N; i++) {
            const c = Math.cos((i / N) * Math.PI * 2 - phi);
            const front = c > 0 ? c ** 2.4 : 0;
            const back = c < 0 ? -c : 0;
            // The front runs after the pointer; the back flattens a little; the sides draw in, so it keeps its body.
            t[i] = reach * (0.62 * front - 0.14 * back) - reach * 0.1 * (1 - Math.abs(c));
          }
        } else {
          const near = R * 3.2;
          if (d < near && d > R * 0.2) {
            const f = (1 - d / near) ** 2;
            tbx = (dx / d) * R * 0.08 * f;
            tby = (dy / d) * R * 0.08 * f;
            for (let i = 0; i < N; i++) {
              const c = Math.cos((i / N) * Math.PI * 2 - phi);
              t[i] = c > 0 ? R * this.#swell * f * c ** 4 : 0;
            }
          }
        }
      }
    }

    // Springs, in small steps so a stiff rim stays stable at any frame rate.
    const K = 240; // rim stiffness
    const C = 6.5; // rim damping: low, so it wobbles
    const W = 520; // coupling between neighbours, so a dent spreads round the rim
    const KB = 200;
    const CB = 11;
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < N; i++) {
        const lap = u[(i + N - 1) % N]! + u[(i + 1) % N]! - 2 * u[i]!;
        v[i]! += (K * (t[i]! - u[i]!) - C * v[i]! + W * lap) * h;
      }
      for (let i = 0; i < N; i++) u[i]! += v[i]! * h;
      this.#bvx += (KB * (tbx - this.#bx) - CB * this.#bvx) * h;
      this.#bvy += (KB * (tby - this.#by) - CB * this.#bvy) * h;
      this.#bx += this.#bvx * h;
      this.#by += this.#bvy * h;
    }
    // Never further than the canvas can draw.
    const cap = R * (REACH - 1.08);
    for (let i = 0; i < N; i++) u[i] = Math.max(-R * 0.6, Math.min(cap - Math.hypot(this.#bx, this.#by), u[i]!));

    let energy = Math.abs(this.#bx - tbx) + Math.abs(this.#by - tby) + Math.abs(this.#bvx) * 0.02 + Math.abs(this.#bvy) * 0.02;
    for (let i = 0; i < N; i++) energy += Math.abs(u[i]! - t[i]!) + Math.abs(v[i]!) * 0.02;
    if (energy < 0.05 * N && !this.#pull) {
      u.set(t);
      v.fill(0);
      this.#bx = tbx;
      this.#by = tby;
      this.#bvx = 0;
      this.#bvy = 0;
      return Boolean(this.#pull);
    }
    return true;
  }

  /** Whether the disc is at rest in its round shape. */
  #round(): boolean {
    if (Math.abs(this.#bx) > 0.05 || Math.abs(this.#by) > 0.05) return false;
    for (let i = 0; i < N; i++) if (Math.abs(this.#u[i]!) > 0.05) return false;
    return true;
  }

  draw(): void {
    const tex = this.texture;
    const R = this.#R;
    const g = this.canvas.getContext('2d');
    if (!g || !R) return;
    const round = this.#round();
    // A round disc at the same turn with the same picture is already on the canvas.
    if (round && tex === this.#drawnTexture && this.rotation === this.#drawnRotation) return;
    this.#drawnTexture = tex;
    this.#drawnRotation = round ? this.rotation : NaN;

    const k = this.#dpr;
    const side = this.canvas.width;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, side, side);
    if (!tex) return;
    const size = 'width' in tex ? Number(tex.width) : 0;
    if (!size) return;
    const o = side / 2;
    const cx = o + this.#bx * k;
    const cy = o + this.#by * k;

    if (round) {
      g.save();
      g.beginPath();
      g.arc(cx, cy, R * k, 0, Math.PI * 2);
      g.clip();
      g.translate(cx, cy);
      g.rotate(this.rotation);
      g.drawImage(tex, -R * k, -R * k, R * 2 * k, R * 2 * k);
      g.restore();
    } else {
      // The fan: each wedge of the round texture mapped onto the same wedge of the stretched disc.
      const half = size / 2;
      const rim = (i: number): [number, number] => {
        const a = ((i % N) / N) * Math.PI * 2;
        const r = (R + this.#u[i % N]!) * k;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      };
      const src = (i: number): [number, number] => {
        const a = ((i % N) / N) * Math.PI * 2 - this.rotation;
        return [half + Math.cos(a) * half, half + Math.sin(a) * half];
      };
      for (let i = 0; i < N; i++) {
        const [x1, y1] = rim(i);
        const [x2, y2] = rim(i + 1);
        const [s1x, s1y] = src(i);
        const [s2x, s2y] = src(i + 1);
        // Grow each wedge a hair outward so neighbours overlap and no seam shows between them.
        const gx = (x1 + x2) / 2 - cx;
        const gy = (y1 + y2) / 2 - cy;
        const gl = Math.hypot(gx, gy) || 1;
        const ex = (gx / gl) * 1.2;
        const ey = (gy / gl) * 1.2;
        g.save();
        g.beginPath();
        g.moveTo(cx - ex * 0.5, cy - ey * 0.5);
        g.lineTo(x1 + ex + (x1 - x2) * 0.04, y1 + ey + (y1 - y2) * 0.04);
        g.lineTo(x2 + ex + (x2 - x1) * 0.04, y2 + ey + (y2 - y1) * 0.04);
        g.closePath();
        g.clip();
        mapTriangle(g, half, half, s1x, s1y, s2x, s2y, cx, cy, x1, y1, x2, y2);
        g.drawImage(tex, 0, 0);
        g.restore();
      }
    }

    // Gel: a darker rim and a soft highlight, following the shape so it reads as something with depth.
    g.save();
    g.globalCompositeOperation = 'source-atop';
    let mean = 0;
    for (let i = 0; i < N; i++) mean += this.#u[i]!;
    const r = (R + mean / N) * k;
    const edge = g.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.15);
    edge.addColorStop(0, 'rgb(0 0 0 / 0)');
    edge.addColorStop(1, 'rgb(0 0 0 / 0.42)');
    g.fillStyle = edge;
    g.fillRect(0, 0, side, side);
    const hx = cx - r * 0.34 - this.#bx * k * 0.4;
    const hy = cy - r * 0.42 - this.#by * k * 0.4;
    const shine = g.createRadialGradient(hx, hy, 0, hx, hy, r * 0.75);
    shine.addColorStop(0, 'rgb(255 255 255 / 0.2)');
    shine.addColorStop(0.45, 'rgb(255 255 255 / 0.05)');
    shine.addColorStop(1, 'rgb(255 255 255 / 0)');
    g.fillStyle = shine;
    g.fillRect(0, 0, side, side);
    g.restore();
  }
}

/** Set the canvas transform that maps the source triangle (a, b, c) onto the destination triangle (A, B, C). */
function mapTriangle(
  g: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  Ax: number,
  Ay: number,
  Bx: number,
  By: number,
  Cx: number,
  Cy: number
): void {
  const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (!d) return;
  const a = ((Bx - Ax) * (cy - ay) - (Cx - Ax) * (by - ay)) / d;
  const b = ((By - Ay) * (cy - ay) - (Cy - Ay) * (by - ay)) / d;
  const c = ((Cx - Ax) * (bx - ax) - (Bx - Ax) * (cx - ax)) / d;
  const e = ((Cy - Ay) * (bx - ax) - (By - Ay) * (cx - ax)) / d;
  g.setTransform(a, b, c, e, Ax - a * ax - c * ay, Ay - b * ax - e * ay);
}

/**
 * The fingerprint wrapped into a ring: each frame's slit becomes a wedge, the top of its picture at the rim, the way
 * Cinemetrics draws a film as a wheel. `hub` is the inner radius as a share of the outer; inside it stays clear.
 */
export function polarPrint(print: HTMLCanvasElement, size: number, hub: number): HTMLCanvasElement | null {
  const W = print.width;
  const H = print.height;
  let src: Uint8ClampedArray;
  try {
    src = print.getContext('2d')!.getImageData(0, 0, W, H).data;
  } catch {
    return null;
  }
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const g = out.getContext('2d')!;
  const img = g.createImageData(size, size);
  const o = img.data;
  const R = size / 2;
  const r0 = R * hub;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - R;
      const dy = y + 0.5 - R;
      const r = Math.hypot(dx, dy);
      if (r > R + 1 || r < r0 - 1) continue;
      let a = Math.atan2(dx, -dy);
      if (a < 0) a += Math.PI * 2;
      const sx = Math.min(W - 1, Math.floor((a / (Math.PI * 2)) * W));
      const sy = Math.min(H - 1, Math.max(0, Math.floor((1 - Math.min(1, Math.max(0, (r - r0) / (R - r0)))) * (H - 1))));
      const s = (sy * W + sx) * 4;
      const d = (y * size + x) * 4;
      o[d] = src[s]!;
      o[d + 1] = src[s + 1]!;
      o[d + 2] = src[s + 2]!;
      o[d + 3] = Math.round(255 * Math.min(1, Math.max(0, R - r + 0.5)) * Math.min(1, Math.max(0, r - r0 + 0.5)));
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}
