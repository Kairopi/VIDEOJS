/**
 * Tint's icon set: one 24 px grid, filled transport icons, 1.8 px rounded strokes for everything else.
 * The play triangle sits 0.75 px right of the geometric centre so it looks centred.
 */

const svg = (body: string, filled = false) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" ${
    filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
  } aria-hidden="true" focusable="false">${body}</svg>`;

const speaker = '<path fill="currentColor" stroke="none" d="M4.5 9.5h2.8l4.1-3.6a.6.6 0 0 1 1 .45v11.3a.6.6 0 0 1-1 .45L7.3 14.5H4.5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"/>';

export const tintIcons: Record<string, string> = {
  play: svg('<path d="M8.75 5.6v12.8a1 1 0 0 0 1.53.85l10.1-6.4a1 1 0 0 0 0-1.7l-10.1-6.4A1 1 0 0 0 8.75 5.6Z"/>', true),
  pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/>', true),
  restart: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.7h3.7"/>'),
  'volume-high': svg(`${speaker}<path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4"/>`),
  'volume-low': svg(`${speaker}<path d="M15.5 9.2a4 4 0 0 1 0 5.6"/>`),
  'volume-off': svg(`${speaker}<path d="m16 9.5 5 5m0-5-5 5"/>`),
  'fullscreen-enter': svg('<path d="M4.5 9V5.5a1 1 0 0 1 1-1H9M15 4.5h3.5a1 1 0 0 1 1 1V9M19.5 15v3.5a1 1 0 0 1-1 1H15M9 19.5H5.5a1 1 0 0 1-1-1V15"/>'),
  'fullscreen-exit': svg('<path d="M9 4.5V8a1 1 0 0 1-1 1H4.5M19.5 9H16a1 1 0 0 1-1-1V4.5M15 19.5V16a1 1 0 0 1 1-1h3.5M4.5 15H8a1 1 0 0 1 1 1v3.5"/>'),
  'pip-enter': svg('<path d="M20 11V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><rect x="13" y="13.5" width="7.5" height="5.5" rx="1.2"/>'),
  'pip-exit': svg('<path d="M20 11V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><path d="M14 14l5 5m0-4.2V19h-4.2"/>'),
  'captions-off': svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M10.5 10.3a2 2 0 1 0 0 3.4M16.5 10.3a2 2 0 1 0 0 3.4"/>'),
  'captions-on': svg(
    '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5" fill="currentColor"/><path style="stroke: var(--tint-knockout, #0b0c0e)" d="M10.5 10.3a2 2 0 1 0 0 3.4M16.5 10.3a2 2 0 1 0 0 3.4"/>'
  ),
  gear: svg(
    '<path d="M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z"/><path d="M19.2 13.4a7.6 7.6 0 0 0 0-2.8l1.8-1.4-1.9-3.2-2.1.8a7.3 7.3 0 0 0-2.4-1.4L14.2 3h-3.8l-.4 2.4a7.3 7.3 0 0 0-2.4 1.4l-2.1-.8-1.9 3.2 1.8 1.4a7.6 7.6 0 0 0 0 2.8L3.6 14.8l1.9 3.2 2.1-.8a7.3 7.3 0 0 0 2.4 1.4l.4 2.4h3.8l.4-2.4a7.3 7.3 0 0 0 2.4-1.4l2.1.8 1.9-3.2-1.8-1.4Z"/>'
  ),
  // Scenes: a small barcode, the shape of the timeline itself.
  scenes: svg(
    '<rect x="4" y="5" width="2.2" height="14" rx="1.1"/><rect x="8.2" y="5" width="4.6" height="14" rx="1.2"/><rect x="14.8" y="5" width="1.8" height="14" rx="0.9"/><rect x="18.4" y="5" width="2.2" height="14" rx="1.1"/>',
    true
  ),
  check: svg('<path d="m5.5 12.5 4 4 9-9"/>'),
  // Save: an arrow down into a tray.
  download: svg('<path d="M12 4.5v10M7.5 10.5l4.5 4.5 4.5-4.5"/><path d="M4.5 15.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/>'),
  chevron: svg('<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>'),
  seek: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v3.7h-3.7"/>'),
  // Ten seconds back and forward: the restart and seek arcs, opened a little wider, with the step written inside.
  'seek-back': svg(
    '<path d="M4.6 12.6a7.5 7.5 0 1 0 2.3-6.1"/><path d="M5.3 3.6v3.8h3.8"/><text x="12.6" y="15.4" fill="currentColor" stroke="none" font-size="7.6" font-weight="760" text-anchor="middle" font-family="inherit" letter-spacing="-0.3">10</text>'
  ),
  'seek-forward': svg(
    '<path d="M19.4 12.6a7.5 7.5 0 1 1-2.3-6.1"/><path d="M18.7 3.6v3.8h-3.8"/><text x="11.4" y="15.4" fill="currentColor" stroke="none" font-size="7.6" font-weight="760" text-anchor="middle" font-family="inherit" letter-spacing="-0.3">10</text>'
  ),
  speed: svg('<path d="M4.6 16.5a8 8 0 1 1 14.8 0"/><path d="m12 13 3.6-4.2"/>'),
  switches: svg('<path d="M5 8h9M18 8h1M5 16h1M10 16h9"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/>'),
  speech: svg('<path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-7l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5Z"/>'),
  spinner: svg('<path d="M12 4a8 8 0 1 1-8 8" style="animation: var(--media-spinner-animation, tint-spin 0.9s linear infinite); transform-origin: 12px 12px"/>'),
  'airplay-enter': svg('<path d="M7 17H5.5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H17"/><path d="m12 14.5 4 4.5H8l4-4.5Z" fill="currentColor"/>'),
  'airplay-exit': svg('<path d="M7 17H5.5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H17"/><path d="m12 14.5 4 4.5H8l4-4.5Z" fill="currentColor"/><path d="M9.5 9.5h5"/>'),
  'cast-enter': svg('<path d="M3.5 9V7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H14"/><path d="M3.5 12.5a6.5 6.5 0 0 1 6.5 6.5M3.5 16a3 3 0 0 1 3 3"/><circle cx="3.9" cy="19" r=".6" fill="currentColor"/>'),
  'cast-exit': svg('<path d="M3.5 9V7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H14"/><path d="M3.5 12.5a6.5 6.5 0 0 1 6.5 6.5M3.5 16a3 3 0 0 1 3 3"/><path d="M7 8.5h10v7h-3" fill="none"/>'),
};
