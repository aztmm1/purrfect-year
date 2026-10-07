#!/usr/bin/env node
// Render a standard set of review images for an edition into one directory,
// plus an index.md: full frames, crops around its place's anchors (the cat
// window, the entrance and sign, the stages where the cats stand, the bench,
// table, castle or fire pit), motion contact sheets (the cat window, each
// stage, fire, rain, fireworks, the story beats) and the light / albedo views.
//   node tools/review-kit.mjs [--edition ID | a,b | all] [--out review]
// With several editions each gets its own subdirectory.
import fs from 'node:fs';
import path from 'node:path';
import { openDiorama, parseArgs, pickEditions, readEditions, dataUrlToBuffer } from './lib.mjs';

const a = parseArgs();
const root = path.resolve(a.out && a.out !== true ? String(a.out) : 'review');
const FULL = [0, 37.3, 91.6, 150.2, 211.9];
const T = 91.6; // the moment the crops show

const clampCrop = (c) => {
  const x = Math.max(0, Math.min(479, Math.round(c.x)));
  const y = Math.max(0, Math.min(269, Math.round(c.y)));
  return { x, y, w: Math.max(4, Math.min(480 - x, Math.round(c.w))), h: Math.max(4, Math.min(270 - y, Math.round(c.h))) };
};
const kFor = (c) => Math.max(2, Math.min(8, Math.floor(Math.min(960 / c.w, 600 / c.h))));

/** crops and sheets for one edition, from its place's anchors */
function plan(ed, p, beats) {
  const crops = [];
  const sheets = [];
  const add = (name, c) => crops.push([name, clampCrop(c)]);
  if (p.catWindow) {
    const w = p.catWindow;
    add('cat-window', { x: w.x - 16, y: w.y - 14, w: w.w + 32, h: w.h + 26 });
    sheets.push(['cat-window', 30, 0.4, 16, 8, clampCrop({ x: w.x - 6, y: w.y - 6, w: w.w + 12, h: w.h + 12 })]);
  }
  if (p.balcony) add('balcony', { x: p.balcony.x0 - 8, y: p.balcony.above - 4, w: p.balcony.x1 - p.balcony.x0 + 16, h: p.balcony.slab - p.balcony.above + 12 });
  if (p.entrance) {
    const e = p.entrance;
    const s = p.sign || { x: e.x0, y: e.y0, w: 1, h: 1 };
    const x0 = Math.min(e.x0, s.x) - 16;
    const x1 = Math.max(e.x1, s.x + s.w) + 16;
    add('entrance-sign', { x: x0, y: Math.min(e.y0, s.y) - 16, w: x1 - x0, h: 270 - Math.min(e.y0, s.y) + 16 - 30 });
  }
  if (p.building) add('building', { x: p.building.x0 - 10, y: Math.max(0, p.building.top - 10), w: p.building.x1 - p.building.x0 + 20, h: 216 - p.building.top });
  for (const [k, s] of Object.entries(p.stages || {})) {
    const c = { x: s.x0 - 10, y: s.base - 40, w: s.x1 - s.x0 + 20, h: 48 };
    add('stage-' + k, c);
    sheets.push(['stage-' + k, 30, 1 / 8, 12, 4, clampCrop(c)]);
  }
  if (p.bench) add('bench', { x: p.bench.x0 - 12, y: p.bench.seat - 30, w: p.bench.x1 - p.bench.x0 + 24, h: 40 });
  if (p.table) add('table', { x: p.table.x - 40, y: p.table.base - 40, w: 80, h: 48 });
  if (p.castle) add('castle', { x: p.castle.x - 30, y: p.castle.base - 40, w: 60, h: 48 });
  if (p.porch) add('porch', { x: p.porch.x0 - 6, y: p.porch.roof - 8, w: p.porch.x1 - p.porch.x0 + 12, h: p.porch.floor - p.porch.roof + 20 });
  if (p.plaza) add('plaza', { x: p.plaza.x0 - 6, y: p.plaza.base - 60, w: p.plaza.x1 - p.plaza.x0 + 12, h: 70 });
  if (p.firepit && ed.fire === 'firepit') {
    const c = { x: p.firepit.x - 24, y: p.firepit.base - 36, w: 48, h: 42 };
    add('firepit', c);
    sheets.push(['fire-motion', 30, 1 / 12, 12, 4, clampCrop(c)]);
  }
  add('street', { x: 0, y: 200, w: 480, h: 70 });
  add('sky', { x: 0, y: 0, w: 480, h: 110 });
  if (ed.weather && ed.weather.rain > 0) sheets.push(['rain-motion', 30, 1 / 30, 8, 4, clampCrop({ x: 160, y: 150, w: 140, h: 90 })]);
  if (ed.weather && ed.weather.snow > 0) sheets.push(['snow-motion', 30, 1 / 15, 8, 4, clampCrop({ x: 160, y: 120, w: 140, h: 110 })]);
  if (ed.fireworks > 0) sheets.push(['fireworks-sky', 10, 0.5, 12, 4, { x: 0, y: 0, w: 480, h: 160 }]);
  // story beats: a sheet across each window that applies to this entry
  for (const [name, [t0, t1]] of Object.entries(beats)) {
    const n = 12;
    sheets.push([`beat-${name}`, Math.max(0, t0 - 0.5), (t1 - t0 + 1) / n, n, 4, { x: 0, y: 0, w: 480, h: 270 }]);
  }
  sheets.push(['whole-scene-over-loop', 0, 20, 12, 4, { x: 0, y: 0, w: 480, h: 270 }]);
  return { crops, sheets };
}

const first = await openDiorama({ loop: a.loop });
const all = await readEditions(first.page);
const current = await first.page.evaluate(() => window.HD.edition.id);
const eds = a.edition && a.edition !== true ? pickEditions(a.edition, all) : all.filter((e) => e.id === current);
await first.browser.close();
const many = eds.length > 1;
const errorsAll = [];

for (const ed of eds) {
  const out = many ? path.join(root, `${String(ed.index + 1).padStart(2, '0')}-${ed.id}`) : root;
  fs.mkdirSync(out, { recursive: true });
  const { browser, page, errors } = await openDiorama({ loop: a.loop, edition: ed.id });
  const p = await page.evaluate(() => JSON.parse(JSON.stringify(window.HD.place(), (k, v) => (k === 'skyline' ? undefined : v))));
  const beats = await page.evaluate(() => {
    const HD = window.HD;
    const S = HD.summer || {};
    const ed = HD.edition;
    const want = { gift: ed.cast.party === 'birthday', candlesOut: ed.cast.party === 'birthday', goal: ed.cast.party === 'match', heart: ed.cast.party === 'bench' };
    const res = {};
    for (const k of Object.keys(want)) {
      if (!want[k] || typeof S[k] !== 'function') continue;
      let t0 = -1;
      let t1 = -1;
      for (let i = 0; i < HD.LOOP * 10; i++) {
        const v = S[k](i / 10);
        if (v >= 0 && t0 < 0) t0 = i / 10;
        if (v >= 0) t1 = i / 10;
        else if (t0 >= 0) break;
      }
      if (t0 >= 0) res[k] = [t0, t1];
    }
    if (ed.cast.niece && S.niece) {
      for (let i = 0; i < HD.LOOP * 10; i++) {
        const v = S.niece(i / 10);
        if (v.here && v.phase === 'in') {
          res.niece = [i / 10, i / 10 + 4];
          break;
        }
      }
    }
    if (HD.brand && HD.brand.logoWindow && HD.tag('logo-firework')) res.logo = HD.brand.logoWindow;
    return res;
  });
  const { crops, sheets } = plan(ed, p, beats);
  const lines = [`# Review kit: ${ed.name} (${ed.id}, ${ed.place}, ${ed.light})`, ''];
  const save = (name, url) => {
    const f = path.join(out, name + '.png');
    fs.writeFileSync(f, dataUrlToBuffer(url));
    return f;
  };
  for (const t of FULL) {
    const u = await page.evaluate((t) => (window.HD.renderAt(t), window.HD.png(2)), t);
    lines.push(`- full frame t=${t}s (960x540): ${save('full-t' + t, u)}`);
  }
  {
    const u = await page.evaluate((t) => (window.HD.renderAt(t), window.HD.png(4)), T);
    lines.push(`- full frame at true 1080p (1920x1080), t=${T}: ${save('full-1080p-t' + T, u)}`);
  }
  for (const [name, crop] of crops) {
    const k = kFor(crop);
    const u = await page.evaluate(([c, k, t]) => (window.HD.renderAt(t), window.HD.png(k, c)), [crop, k, T]);
    lines.push(`- crop ${name} ${JSON.stringify(crop)} x${k} at t=${T}: ${save('crop-' + name, u)}`);
  }
  for (const [name, t0, dt, n, cols, c] of sheets) {
    const k = Math.max(1, Math.min(6, Math.floor(1920 / cols / c.w)));
    const u = await page.evaluate(
      ([t0, dt, n, cols, k, c]) => {
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
          o.drawImage(HD.buffers.main, c.x, c.y, c.w, c.h, (i % cols) * (tw + gap), Math.floor(i / cols) * (th + gap), tw, th);
        }
        return cv.toDataURL('image/png');
      },
      [t0, dt, n, cols, k, c],
    );
    lines.push(`- motion sheet ${name}: ${n} frames from t=${t0}s every ${dt.toFixed(3)}s, crop ${JSON.stringify(c)} x${k}, left-to-right then top-to-bottom: ${save('sheet-' + name, u)}`);
  }
  errorsAll.push(...errors.map((e) => `${ed.id}: ${e}`), ...(await page.evaluate(() => window.HD.errors)).map((e) => `${ed.id}: ${e}`));
  await browser.close();
  for (const v of ['light', 'albedo']) {
    const s = await openDiorama({ view: v, loop: a.loop, edition: ed.id });
    const u = await s.page.evaluate((t) => (window.HD.renderAt(t), window.HD.png(2)), T);
    lines.push(`- debug view "${v}" t=${T}: ${save('view-' + v, u)}`);
    await s.browser.close();
  }
  fs.writeFileSync(path.join(out, 'index.md'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
if (errorsAll.length) console.error(errorsAll.join('\n'));
