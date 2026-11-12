/**
 * The slit-scan picture, in WebGL 2, written by hand.
 *
 * Every column of the picture shows the same column of a different moment. The moment changes smoothly across the
 * picture: each column blends the two storyboard frames either side of its time, so the smear flows like a long
 * exposure instead of breaking into bands. The frames live in one atlas texture that starts as the storyboard tiles
 * and sharpens tile by tile as Mux's sharp stills arrive.
 *
 * Returns null where WebGL 2 is missing, or when the storyboard's frames are not evenly spaced in time; the caller
 * then draws with the 2D canvas instead.
 */

import type { TintModel } from './model';

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D atlas;
uniform vec4 box;        // the picture inside the canvas, in device pixels: x, y (from the bottom), w, h
uniform vec2 grid;       // atlas columns, frame count
uniform vec2 cell;       // one tile's size in atlas uv
uniform vec4 timing;     // now (s), trail length (s), direction (+1 or -1), seconds per frame
out vec4 colour;

vec3 tile(float i, vec2 uv) {
  vec2 at = vec2(mod(i, grid.x), floor(i / grid.x));
  // Half a texel in from the tile's edge, so neighbours never bleed in.
  vec2 inset = vec2(0.5) / vec2(textureSize(atlas, 0));
  return texture(atlas, (at + clamp(uv, inset / cell, 1.0 - inset / cell)) * cell).rgb;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - box.xy) / box.zw;
  uv.y = 1.0 - uv.y;
  float q = uv.x;
  // Now at the leading edge, the past trailing behind; slices widest near now, thinning into the past.
  float trail = timing.z > 0.0 ? 1.0 - q : q;
  float t = timing.x - timing.z * timing.y * pow(trail, 1.4);
  float fi = clamp(t / timing.w, 0.0, grid.y - 1.0);
  float i0 = floor(fi);
  float i1 = min(i0 + 1.0, grid.y - 1.0);
  // Each frame holds for a while, then hands over to the next: a soft cut, not a smear of everything.
  float k = smoothstep(0.2, 0.8, fi - i0);
  vec3 c = mix(tile(i0, uv), tile(i1, uv), k);
  // The past falls into shadow, and fine slits show in it, the way the photograph is made.
  float slit = 1.0 - 0.06 * step(0.5, fract(gl_FragCoord.x / 3.0)) * smoothstep(0.15, 0.6, trail);
  float shade = mix(1.0, 0.62, pow(trail, 1.3));
  colour = vec4(c * shade * slit, 1.0);
}`;

export class SlitScanGL {
  readonly canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram;
  #texture: WebGLTexture;
  #model: TintModel;
  #cols: number;
  #tw: number;
  #th: number;
  #interval: number;
  #tileCanvas = document.createElement('canvas');
  #sharpDone = new Set<number>();
  #sharpWidth: number;
  #lost = false;
  #u: Record<string, WebGLUniformLocation | null> = {};

  static create(model: TintModel, pictureWidth: number): SlitScanGL | null {
    const frames = model.frames;
    const n = frames.length;
    if (n < 2) return null;
    // Evenly spaced frames let the shader find any moment by arithmetic.
    const interval = frames[1]!.start - frames[0]!.start;
    if (!(interval > 0) || frames.some((f, i) => Math.abs(f.start - i * interval) > interval * 0.25)) return null;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    try {
      return new SlitScanGL(canvas, gl, model, interval, pictureWidth);
    } catch {
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, model: TintModel, interval: number, pictureWidth: number) {
    this.canvas = canvas;
    this.#gl = gl;
    this.#model = model;
    this.#interval = interval;
    const f0 = model.frames[0]!;
    const aspect = f0.w / f0.h || 16 / 9;
    // Tiles about half the picture's width: slices of them are what fills the screen.
    this.#tw = pictureWidth > 900 ? 480 : 320;
    this.#th = Math.round(this.#tw / aspect);
    this.#sharpWidth = this.#tw > 320 ? 640 : 320;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.#cols = Math.max(1, Math.min(model.frames.length, Math.floor(Math.min(max, 4096) / this.#tw)));
    const rows = Math.ceil(model.frames.length / this.#cols);
    if (rows * this.#th > max) throw new Error('atlas too large');

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
    this.#program = program;
    gl.useProgram(program);
    for (const name of ['atlas', 'box', 'grid', 'cell', 'timing']) this.#u[name] = gl.getUniformLocation(program, name);

    // One triangle covers the viewport.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // The atlas: storyboard tiles now, sharp stills as they come.
    const atlas = document.createElement('canvas');
    atlas.width = this.#cols * this.#tw;
    atlas.height = rows * this.#th;
    const ag = atlas.getContext('2d')!;
    ag.imageSmoothingQuality = 'high';
    model.frames.forEach((f, i) => {
      const img = model.image(f.url);
      if (img) ag.drawImage(img, f.x, f.y, f.w, f.h, (i % this.#cols) * this.#tw, Math.floor(i / this.#cols) * this.#th, this.#tw, this.#th);
    });
    this.#texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    this.#tileCanvas.width = this.#tw;
    this.#tileCanvas.height = this.#th;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.#lost = true;
    });
  }

  get lost(): boolean {
    return this.#lost;
  }

  /** Ask for every frame's sharp still; each one replaces its tile when it arrives. */
  sharpen(): void {
    this.#model.frames.forEach((_, i) => this.#model.sharp(i, this.#sharpWidth));
  }

  #upload(): void {
    const gl = this.#gl;
    const tg = this.#tileCanvas.getContext('2d')!;
    for (let i = 0; i < this.#model.frames.length; i++) {
      if (this.#sharpDone.has(i)) continue;
      const img = this.#model.sharp(i, this.#sharpWidth);
      if (!img) continue;
      this.#sharpDone.add(i);
      tg.drawImage(img, 0, 0, this.#tw, this.#th);
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, (i % this.#cols) * this.#tw, Math.floor(i / this.#cols) * this.#th, gl.RGBA, gl.UNSIGNED_BYTE, this.#tileCanvas);
    }
  }

  /** Draw the picture box (CSS pixels) at time `now`, trailing `length` seconds behind in `direction`. */
  draw(W: number, H: number, k: number, box: { x: number; y: number; w: number; h: number }, now: number, length: number, direction: number): void {
    if (this.#lost) return;
    const gl = this.#gl;
    const cw = Math.round(W * k);
    const ch = Math.round(H * k);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.#upload();
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const bx = Math.round(box.x * k);
    const bw = Math.round(box.w * k);
    const bh = Math.round(box.h * k);
    const by = ch - Math.round(box.y * k) - bh;
    gl.viewport(bx, by, bw, bh);
    gl.useProgram(this.#program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.uniform1i(this.#u.atlas!, 0);
    gl.uniform4f(this.#u.box!, bx, by, bw, bh);
    gl.uniform2f(this.#u.grid!, this.#cols, this.#model.frames.length);
    const rows = Math.ceil(this.#model.frames.length / this.#cols);
    gl.uniform2f(this.#u.cell!, 1 / this.#cols, 1 / rows);
    gl.uniform4f(this.#u.timing!, now, length, direction, this.#interval);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
