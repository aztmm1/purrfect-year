#!/usr/bin/env node
// Contact sheet of consecutive frames — review motion as a still image.
//   node tools/sheet.mjs --t0 10 --dt 0.0333 --n 12 --cols 4 --crop 60,180,80,60 --scale 3 --out /tmp/fire.png
//   [--edition ID] [--only ...] [--skip ...] [--view ...]
// Year sheet: several editions side by side at the same moment, each cell
// labelled with its entry number and id (pixel font):
//   node tools/sheet.mjs --edition all --t0 60 [--cols 4] [--crop ...] [--scale 1] --out /tmp/year.png
//   (--edition a,b,c for a few; --n frames per edition every --dt, one row each)
import fs from 'node:fs';
import path from 'node:path';
import { openDiorama, parseArgs, parseCrop, dataUrlToBuffer, pickEditions, readEditions, rgbaToPng } from './lib.mjs';
import { drawText, fillRect, newImage } from './pixfont.mjs';

const a = parseArgs();
const t0 = Number(a.t0 ?? 0);
const dt = Number(a.dt ?? 1 / 30);
const scale = Number(a.scale ?? 2);
const crop = parseCrop(a.crop) || { x: 0, y: 0, w: 480, h: 270 };
const out = a.out || 'out/sheet.png';
const { browser, page, errors } = await openDiorama({ only: a.only, skip: a.skip, view: a.view, loop: a.loop });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const year = a.edition && a.edition !== true && /^all$|,/.test(String(a.edition));

if (year) {
  const eds = pickEditions(a.edition, await readEditions(page));
  const per = Number(a.n ?? 1);
  const cols = per > 1 ? per : Number(a.cols ?? 4);
  const label = 11;
  const gap = 2;
  const cells = [];
  for (const e of eds)
    for (let k = 0; k < per; k++) {
      const b64 = await page.evaluate(
        ([id, t, c]) => {
          const HD = window.HD;
          HD.setEdition(id);
          HD.renderAt(t);
          const d = HD.buffers.main.getContext('2d').getImageData(c.x, c.y, c.w, c.h).data;
          let s = '';
          for (let j = 0; j < d.length; j += 0x8000) s += String.fromCharCode.apply(null, d.subarray(j, j + 0x8000));
          return btoa(s);
        },
        [e.id, t0 + k * dt, crop],
      );
      cells.push({ e, t: t0 + k * dt, px: Buffer.from(b64, 'base64') });
    }
  const rows = Math.ceil(cells.length / cols);
  const cw = crop.w;
  const ch = crop.h + label;
  const W = cols * cw + (cols - 1) * gap;
  const H = rows * ch + (rows - 1) * gap;
  const img = newImage(W, H);
  fillRect(img, 0, 0, W, H, '#ff00ff');
  cells.forEach((c, i) => {
    const ox = (i % cols) * (cw + gap);
    const oy = Math.floor(i / cols) * (ch + gap);
    for (let y = 0; y < crop.h; y++) img.data.set(c.px.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * W + ox) * 4);
    fillRect(img, ox, oy + crop.h, cw, label, '#04050b');
    drawText(img, `${String(c.e.index + 1).padStart(2, '0')} ${c.e.id}${per > 1 ? ' t' + c.t.toFixed(2) : ''}`, ox + 3, oy + crop.h + 2, { color: '#a3b8d8' });
  });
  rgbaToPng(img.data, W, H, out, scale);
} else {
  const n = Number(a.n ?? 12);
  const cols = Number(a.cols ?? 4);
  const url = await page.evaluate(([t0, dt, n, cols, k, c]) => {
    const HD = window.HD;
    const rows = Math.ceil(n / cols);
    const gap = 2;
    const tw = c.w * k;
    const th = c.h * k;
    const cv = document.createElement('canvas');
    cv.width = cols * tw + (cols - 1) * gap;
    cv.height = rows * th + (rows - 1) * gap;
    const o = cv.getContext('2d');
    o.fillStyle = '#ff00ff';
    o.fillRect(0, 0, cv.width, cv.height);
    o.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      HD.renderAt(t0 + i * dt);
      const x = (i % cols) * (tw + gap);
      const y = Math.floor(i / cols) * (th + gap);
      o.drawImage(HD.buffers.main, c.x, c.y, c.w, c.h, x, y, tw, th);
    }
    return cv.toDataURL('image/png');
  }, [t0, dt, n, cols, scale, crop]);
  fs.writeFileSync(out, dataUrlToBuffer(url));
}
console.log(out);
const hdErr = await page.evaluate(() => window.HD.errors);
for (const e of [...errors, ...hdErr]) console.error('ERROR', e);
await browser.close();
process.exit(errors.length || hdErr.length ? 2 : 0);
