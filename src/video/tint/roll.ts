/**
 * Rolling numbers: each digit is a little drum of 0 to 9 that turns to its new value, so time ticking on reads as
 * movement, and a jump rolls every digit that changed. Going on from 9 to 0 the drum carries on round instead of
 * spinning back. Everything else (the colon, a minus) stays still.
 *
 * The element keeps the plain text in an aria-label-free visually hidden span for anyone who copies it; the drums are
 * aria-hidden.
 */
export class Roller {
  readonly el: HTMLElement;
  #text = '';
  #cells: HTMLElement[] = [];
  #plain = document.createElement('span');
  #drums = document.createElement('span');

  constructor(el: HTMLElement) {
    this.el = el;
    el.classList.add('tint-roll');
    this.#plain.className = 'tint-roll-plain';
    this.#drums.className = 'tint-roll-drums';
    this.#drums.setAttribute('aria-hidden', 'true');
    el.replaceChildren(this.#plain, this.#drums);
  }

  get text(): string {
    return this.#text;
  }

  /** Show `text`. `forward` says time moved on, so a 9 going to 0 rolls on round. */
  set(text: string, forward = true): void {
    if (text === this.#text) return;
    const before = this.#text;
    this.#text = text;
    this.#plain.textContent = text;
    // A different shape (03:59 to 1:04:00) builds fresh drums, without rolling.
    const sameShape = before.length === text.length && [...before].every((c, i) => isDigit(c) === isDigit(text[i]!));
    if (!sameShape) {
      this.#cells = [...text].map((c) => cell(c));
      this.#drums.replaceChildren(...this.#cells);
      for (let i = 0; i < text.length; i++) if (isDigit(text[i]!)) place(this.#cells[i]!, Number(text[i]), false);
      return;
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (!isDigit(c) || c === before[i]) continue;
      const from = Number(before[i]);
      const to = Number(c);
      const drum = this.#cells[i]!;
      if (forward && from === 9 && to === 0) {
        // Roll on to the spare 0 under the 9, then quietly reset to the top one.
        place(drum, 10, true);
        const reset = () => place(drum, 0, false);
        drum.firstElementChild?.addEventListener('transitionend', reset, { once: true });
        window.setTimeout(reset, 450);
      } else {
        place(drum, to, true);
      }
    }
  }
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

function cell(c: string): HTMLElement {
  const box = document.createElement('span');
  if (!isDigit(c)) {
    box.className = 'tint-roll-sep';
    box.textContent = c;
    return box;
  }
  box.className = 'tint-roll-digit';
  const strip = document.createElement('span');
  strip.className = 'tint-roll-strip';
  // 0–9 and a spare 0, so 9 can roll on into 0.
  strip.textContent = '0123456789'.split('').concat('0').join('\n');
  box.append(strip);
  return box;
}

function place(drum: HTMLElement, index: number, animate: boolean): void {
  const strip = drum.firstElementChild as HTMLElement | null;
  if (!strip) return;
  strip.style.transition = animate ? '' : 'none';
  strip.style.setProperty('--tint-roll', String(index));
  if (!animate) void strip.offsetHeight;
}
