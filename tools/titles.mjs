// Title overlays for the video tools, drawn in art pixels with the original
// pixel font (tools/pixfont.mjs) and composited onto each rendered frame in
// Node, so they are integer-scaled with the picture.
//
// An overlay spec is plain JSON (render-video --overlay FILE.json):
//   {
//     "canvas": {"w": 540, "h": 300, "x": 30, "y": 15, "bg": "#04050b"},  // optional: put the
//                    // rendered crop at (x, y) on a larger canvas (bands around the picture)
//     "layers": [
//       {"alpha": "always" | "dip" | {"from": 6, "to": 54, "step": 3, "n": 4},
//        "items": [{"rect": [x, y, w, h], "color": "#04050b", "alpha": 0.72},
//                  {"text": "...", "x": 12, "y": 240, "color": "#ffb54d", "scale": 1, "track": 1, "align": "left"}]}
//     ]
//   }
// alpha "dip" follows the picture's fade through black; a stepped alpha
// fades in from frame `from` and is gone at frame `to`, in `n` whole steps
// of `step` frames each.
import { newImage, drawText, fillRect, hexToRgb, textWidth, CAP } from './pixfont.mjs';

// the page's own colours (index.html :root)
export const INK = {
  void: '#04050b',
  ink: '#a3b8d8',
  dim: '#5670a3',
  ember: '#ffb54d',
};

/** stepped alpha 0..1 at frame f */
export function stepAlpha(s, f) {
  if (!s || s === 'always') return 1;
  const { from, to, step = 3, n = 4 } = s;
  if (f < from || f >= to) return 0;
  const a = Math.min(n, Math.floor((f - from) / step) + 1);
  const b = Math.min(n, Math.ceil((to - f) / step));
  return Math.min(a, b) / n;
}

/** dip factor of the picture at frame f of F (0.5-frame offsets: no frame is fully black) */
export function dipFactor(f, F, fadeIn, fadeOut) {
  let k = 1;
  if (fadeIn > 0) k = Math.min(k, (f + 0.5) / fadeIn);
  if (fadeOut > 0) k = Math.min(k, (F - f - 0.5) / fadeOut);
  return Math.max(0, Math.min(1, k));
}

/** compile a spec for a picture of size w x h into blendable layers */
export function compileOverlay(spec, w, h) {
  const canvas = spec && spec.canvas ? { ...spec.canvas, rgb: hexToRgb(spec.canvas.bg || '#000000') } : null;
  const W = canvas ? canvas.w : w;
  const H = canvas ? canvas.h : h;
  if (canvas && (canvas.x < 0 || canvas.y < 0 || canvas.x + w > W || canvas.y + h > H)) throw new Error(`overlay canvas ${W}x${H} cannot hold the ${w}x${h} picture at ${canvas.x},${canvas.y}`);
  const layers = [];
  for (const L of (spec && spec.layers) || []) {
    const img = newImage(W, H);
    for (const it of L.items || []) {
      if (it.rect) fillRect(img, it.rect[0], it.rect[1], it.rect[2], it.rect[3], it.color || '#000000', it.alpha ?? 1);
      else if (it.text !== undefined) drawText(img, it.text, it.x, it.y, { color: it.color, alpha: it.alpha ?? 1, scale: it.scale || 1, track: it.track ?? 1, align: it.align || 'left' });
    }
    const idx = [];
    for (let i = 0; i < W * H; i++) if (img.data[i * 4 + 3]) idx.push(i);
    const px = new Uint8Array(idx.length * 4);
    idx.forEach((p, j) => px.set(img.data.subarray(p * 4, p * 4 + 4), j * 4));
    layers.push({ alpha: L.alpha || 'always', idx: Uint32Array.from(idx), px });
  }
  let base = null;
  if (canvas) {
    base = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) base.set([canvas.rgb[0], canvas.rgb[1], canvas.rgb[2], 255], i * 4);
  }
  return { W, H, w, h, canvas, layers, base };
}

/**
 * Compose frame f (of F) from the rendered RGBA picture `pic` (w x h):
 * the picture dips through black over fadeIn / fadeOut frames, the bands
 * stay, the layers blend on top. Returns an RGBA Buffer of W x H.
 */
export function composeFrame(ov, pic, f, F, fadeIn = 0, fadeOut = 0) {
  const k = dipFactor(f, F, fadeIn, fadeOut);
  let out;
  if (ov.canvas) {
    out = Buffer.from(ov.base);
    const { x, y } = ov.canvas;
    for (let r = 0; r < ov.h; r++) out.set(pic.subarray(r * ov.w * 4, (r + 1) * ov.w * 4), ((y + r) * ov.W + x) * 4);
    if (k < 1)
      for (let r = 0; r < ov.h; r++) {
        let i = ((y + r) * ov.W + x) * 4;
        for (let c = 0; c < ov.w; c++, i += 4) {
          out[i] = Math.round(out[i] * k);
          out[i + 1] = Math.round(out[i + 1] * k);
          out[i + 2] = Math.round(out[i + 2] * k);
        }
      }
  } else {
    out = Buffer.from(pic.buffer, pic.byteOffset, pic.byteLength);
    if (k < 1)
      for (let i = 0; i < out.length; i += 4) {
        out[i] = Math.round(out[i] * k);
        out[i + 1] = Math.round(out[i + 1] * k);
        out[i + 2] = Math.round(out[i + 2] * k);
      }
  }
  for (const L of ov.layers) {
    // stepped titles also dip with the picture if they are still up at a cut
    const la = L.alpha === 'dip' ? k : L.alpha === 'always' ? 1 : stepAlpha(L.alpha, f) * k;
    if (la <= 0) continue;
    const { idx, px } = L;
    for (let j = 0; j < idx.length; j++) {
      const a = (px[j * 4 + 3] / 255) * la;
      const o = idx[j] * 4;
      out[o] = Math.round(out[o] + (px[j * 4] - out[o]) * a);
      out[o + 1] = Math.round(out[o + 1] + (px[j * 4 + 1] - out[o + 1]) * a);
      out[o + 2] = Math.round(out[o + 2] + (px[j * 4 + 2] - out[o + 2]) * a);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

/**
 * The story video's lower-third (480x270 art px): the entry name in ember over
 * its date in ink, on a soft veil with an ember edge, in the bottom-left (or
 * bottom-right) corner. Visible from frame `from` to `to` in stepped fades.
 */
export function lowerThird({ name, date }, { W = 480, H = 270, side = 'left', from = 6, to = 54, step = 3, n = 4 } = {}) {
  const padX = 5;
  const padY = 4;
  const gap = 4;
  const w = Math.max(textWidth(name), textWidth(date)) + padX * 2 + 1;
  const h = padY + CAP + gap + CAP + 1 + padY;
  const margin = 10;
  const x = side === 'right' ? W - margin - w : margin;
  const y = H - margin - h;
  return {
    layers: [
      {
        alpha: { from, to, step, n },
        items: [
          { rect: [x, y, w, h], color: INK.void, alpha: 0.72 },
          { rect: [x, y, 1, h], color: INK.ember, alpha: 0.9 },
          { text: name, x: x + 1 + padX, y: y + padY, color: INK.ember },
          { text: date, x: x + 1 + padX, y: y + padY + CAP + gap, color: INK.ink },
        ],
      },
    ],
  };
}
