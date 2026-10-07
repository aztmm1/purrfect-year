// A small original pixel bitmap font (5x7 capitals, variable width, one
// descender row) and the drawing helpers the video tools use for titles.
// No font files, no canvas text: every glyph is drawn pixel by pixel into an
// RGBA buffer in art pixels, so it is integer-scaled with the picture.
//
//   import { textWidth, drawText, fillRect, newImage, wrapLines } from './pixfont.mjs';
//   const img = newImage(480, 270);               // {w, h, data: Uint8ClampedArray RGBA}
//   drawText(img, 'Match Night', 12, 240, { color: '#ffb54d' });
//
// Lowercase letters are drawn as capitals. Unknown characters draw as a gap.

const G = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '.#', '.#', '#.'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '’': ['#', '#', '.', '.', '.', '.', '.'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  '–': ['....', '....', '....', '####', '....', '....', '....'],
  '·': ['.', '.', '.', '#', '.', '.', '.'],
  ':': ['.', '.', '#', '.', '.', '#', '.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '(': ['.#', '#.', '#.', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '.#', '.#', '#.'],
};
const SPACE = 3;
export const CAP = 7; // cap height in font pixels
export const DESC = 1; // descender rows below the baseline (the comma)

// pre-parse into {w, rows: [[x, y], ...]}
const GLYPH = {};
for (const [k, rows] of Object.entries(G)) {
  const w = rows[0].length;
  const px = [];
  rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`pixfont: glyph ${k} row ${y} has width ${r.length}, expected ${w}`);
    for (let x = 0; x < w; x++) if (r[x] === '#') px.push([x, y]);
  });
  GLYPH[k] = { w, px };
}

const norm = (s) => String(s).toUpperCase().replace(/—/g, '–');

export function hexToRgb(c) {
  if (Array.isArray(c)) return c;
  const h = String(c).replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** width in art pixels of `s` drawn at integer `scale` with `track` px between glyphs (before scaling) */
export function textWidth(s, { scale = 1, track = 1 } = {}) {
  let w = 0;
  let n = 0;
  for (const ch of norm(s)) {
    w += ch === ' ' ? SPACE : (GLYPH[ch] || { w: SPACE }).w;
    n++;
  }
  return n ? (w + (n - 1) * track) * scale : 0;
}

/** split `s` into lines no wider than maxW (greedy, on spaces) */
export function wrapLines(s, maxW, opt = {}) {
  const words = String(s).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && textWidth(next, opt) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** {w, h, data} RGBA image, fully transparent */
export function newImage(w, h) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

function put(img, x, y, rgb, a) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  const d = img.data;
  const sa = a / 255;
  const da = d[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  for (let c = 0; c < 3; c++) d[i + c] = Math.round((rgb[c] * sa + d[i + c] * da * (1 - sa)) / oa);
  d[i + 3] = Math.round(oa * 255);
}

/** fill a rectangle (alpha 0..1) */
export function fillRect(img, x, y, w, h, color, alpha = 1) {
  const rgb = hexToRgb(color);
  const a = Math.round(alpha * 255);
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(img, xx, yy, rgb, a);
}

/**
 * Draw `s` with its top-left at (x, y) (or its centre / right edge at x with
 * align 'center' / 'right'). Returns the drawn width.
 */
export function drawText(img, s, x, y, { color = '#ffffff', alpha = 1, scale = 1, track = 1, align = 'left' } = {}) {
  const rgb = hexToRgb(color);
  const a = Math.round(alpha * 255);
  const w = textWidth(s, { scale, track });
  let cx = align === 'center' ? x - Math.floor(w / 2) : align === 'right' ? x - w : x;
  for (const ch of norm(s)) {
    if (ch === ' ') {
      cx += (SPACE + track) * scale;
      continue;
    }
    const g = GLYPH[ch];
    if (!g) {
      cx += (SPACE + track) * scale;
      continue;
    }
    for (const [gx, gy] of g.px)
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(img, cx + gx * scale + sx, y + gy * scale + sy, rgb, a);
    cx += (g.w + track) * scale;
  }
  return w;
}

/** characters this font can draw (for tests) */
export const GLYPHS = Object.keys(G).join('') + ' ';
