/**
 * The glass: a marble rolled over the colour columns. Its heart shows the frame a column was squeezed from,
 * magnified; its rim bends the columns behind it round the curve, split slightly into colour, the way a glass ball
 * does. Lit from the top left, with a crescent of window light and light passing through the far edge.
 *
 * One WebGL quad, two textures: the frame, and the patch of columns under and around the ball.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uBg;
uniform sampler2D uFrame;
uniform float uAspect;
uniform float uAA;
uniform float uCap;
uniform vec3 uTint;
uniform vec2 uSlide;

vec3 bgAt(vec2 p) { return texture2D(uBg, clamp(0.5 + p / (2.0 * uCap), 0.0, 1.0)).rgb; }

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float alpha = 1.0 - smoothstep(1.0 - uAA, 1.0, r);
  if (alpha <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float rr = min(r, 0.9999);
  float z = sqrt(1.0 - rr * rr);
  vec3 n = vec3(p, z);
  vec2 dir = p / max(r, 1e-4);

  // The frame, magnified at the heart and bending towards the edge.
  vec2 q = p * (0.9 + 0.55 * (1.0 - z)) + uSlide;
  vec2 fuv = vec2(0.5 + q.x * 0.5 / uAspect, 0.5 + q.y * 0.5);
  vec3 fr = texture2D(uFrame, clamp(fuv, 0.0, 1.0)).rgb;

  // The rim: the columns behind, pulled round the curve and split into colour.
  vec2 bp = p * (1.0 + 1.3 * (1.0 - z));
  vec3 bg = vec3(bgAt(bp * 1.02).r, bgAt(bp).g, bgAt(bp * 0.98).b);
  vec3 col = mix(fr, bg, smoothstep(0.8, 0.97, r));

  // Body light from the top left; the lower right turns into the glass.
  vec3 L = normalize(vec3(-0.5, -0.62, 0.6));
  col *= 0.84 + 0.26 * dot(n, L);

  // Light passing through and gathering at the far edge, in the frame's colour.
  float through = smoothstep(0.84, 1.0, r) * max(0.0, dot(dir, vec2(0.62, 0.78)));
  col += uTint * through * 0.6;

  // A hairline of shade defines the edge.
  col *= 1.0 - 0.5 * smoothstep(0.955, 1.0, r);

  // Gloss: a broad soft sheen, a crescent of window light, one sharp highlight.
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), 360.0);
  float sheen = smoothstep(0.5, 0.96, dot(n, normalize(vec3(-0.52, -0.66, 0.54))));
  float band = smoothstep(0.8, 0.9, r) * (1.0 - smoothstep(0.92, 0.975, r));
  float cres = band * smoothstep(0.15, 0.85, dot(dir, vec2(-0.6, -0.8)));
  col += vec3(1.0) * (spec * 1.1 + sheen * 0.06 + cres * 0.4);
  col = mix(col, vec3(1.0), pow(1.0 - z, 4.0) * 0.1);

  gl_FragColor = vec4(col * alpha, alpha);
}`;

/** How much of the columns, in ball diameters, the rim can bend into view. */
const CAPTURE = 1.6;

export class Glass {
  private gl: WebGLRenderingContext;
  private bgTex: WebGLTexture;
  private frameTex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private scratch = document.createElement('canvas');
  private sg = this.scratch.getContext('2d')!;
  private aspect = 16 / 9;
  private tint: [number, number, number] = [1, 1, 1];
  private hasFrame = false;

  static create(canvas: HTMLCanvasElement): Glass | null {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return null;
    try {
      return new Glass(canvas, gl);
    } catch {
      return null;
    }
  }

  private constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext
  ) {
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    for (const name of ['uBg', 'uFrame', 'uAspect', 'uAA', 'uCap', 'uTint', 'uSlide']) this.u[name] = gl.getUniformLocation(prog, name);
    const tex = (unit: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return t;
    };
    this.bgTex = tex(0);
    this.frameTex = tex(1);
    gl.uniform1i(this.u.uBg!, 0);
    gl.uniform1i(this.u.uFrame!, 1);
    gl.uniform1f(this.u.uCap!, CAPTURE);
  }

  /** The frame to show in the ball: a whole image, or one tile of a storyboard sheet. */
  setFrame(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): void {
    const gl = this.gl;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw));
    c.height = Math.max(1, Math.round(sh));
    const g = c.getContext('2d')!;
    g.filter = 'saturate(1.15) contrast(1.04)';
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    this.aspect = sw / sh;
    // The frame's own colour, brightened, for the light gathered at the far edge.
    const dot = document.createElement('canvas');
    dot.width = dot.height = 1;
    const dg = dot.getContext('2d')!;
    dg.drawImage(c, 0, 0, 1, 1);
    const [r, gr, b] = dg.getImageData(0, 0, 1, 1).data;
    const peak = Math.max(r!, gr!, b!, 1);
    this.tint = [r! / peak, gr! / peak, b! / peak];
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    this.hasFrame = true;
  }

  /**
   * Draw the ball, centred at (cx, cy) in the columns canvas's CSS pixels, D CSS pixels across.
   * `slide` nudges the frame inside as the ball rolls.
   */
  draw(columns: HTMLCanvasElement, cx: number, cy: number, D: number, k: number, slide = 0): void {
    if (!this.hasFrame) return;
    const gl = this.gl;
    const size = Math.max(2, Math.round(D * k));
    if (this.canvas.width !== size || this.canvas.height !== size) {
      this.canvas.width = this.canvas.height = size;
    }
    // The patch of columns under the ball and around it.
    const C = D * CAPTURE;
    const cap = Math.min(640, Math.round(C * k));
    if (this.scratch.width !== cap) this.scratch.width = this.scratch.height = cap;
    this.sg.fillStyle = '#000';
    this.sg.fillRect(0, 0, cap, cap);
    if (columns.width) this.sg.drawImage(columns, (cx - C / 2) * k, (cy - C / 2) * k, C * k, C * k, 0, 0, cap, cap);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.scratch);

    gl.viewport(0, 0, size, size);
    gl.uniform1f(this.u.uAspect!, this.aspect);
    gl.uniform1f(this.u.uAA!, 3 / size);
    gl.uniform3f(this.u.uTint!, ...this.tint);
    gl.uniform2f(this.u.uSlide!, Math.max(-0.14, Math.min(0.14, slide)), 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
