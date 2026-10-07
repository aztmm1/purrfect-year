// What the picture does, by loop time, so the soundtrack can follow it:
//  - the 16 entries and their fields (src/editions.js, evaluated in a sandbox)
//  - the shared story windows (src/summer.js: goal, candles, heart, niece...)
//  - fireworks bursts (HD._fireworks.show()), lightning strikes (HD.sky.flash /
//    bolt) and the New Year logo firework (HD.brand.logoWindow), read from the
//    live page in headless Chromium.
// The page-derived part is kept in tools/sound/events.json together with a
// hash of src/ and index.html. When the picture code has changed since, the
// events are read again from the page (about a second) and the snapshot is
// refreshed; if that is impossible a seeded schedule stands in.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RNG, LOOP } from './dsp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const SNAP = path.join(HERE, 'events.json');

function sandbox(files, pre) {
  const window = {};
  const ctx = { window, console, location: { search: '', hash: '' }, URLSearchParams, Math, Date: undefined };
  ctx.self = window;
  vm.createContext(ctx);
  if (pre) pre(window);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return window.HD;
}

let EDS = null;
export function editions() {
  if (!EDS) {
    const HD = sandbox(['src/editions.js']);
    EDS = HD.EDITIONS.map((e) => JSON.parse(JSON.stringify({ ...e, tagSet: undefined })));
  }
  return EDS;
}
export function edition(id) {
  const e = editions().find((x) => x.id === id);
  if (!e) throw new Error(`unknown edition '${id}' (known: ${editions().map((x) => x.id).join(', ')})`);
  return e;
}

/** story windows from src/summer.js, sampled at 10 ms, as [[a, b], ...] in loop seconds */
export function storyWindows(id) {
  let HD;
  try {
    HD = sandbox(['src/editions.js', 'src/summer.js'], (w) => {
      w.HD = { LOOP, time: { wave: () => 0, noise: () => 0.5, phase: (t, p) => (((t / p) % 1) + 1) % 1 } };
    });
  } catch (e) {
    return { error: String(e.message || e) };
  }
  if (!HD || !HD.summer) return {};
  HD.edition = HD.editionById(id) || HD.EDITIONS[0];
  const S = HD.summer;
  const out = {};
  const scan = (name, fn) => {
    const wins = [];
    let on = null;
    for (let k = 0; k <= LOOP * 100; k++) {
      const t = k / 100;
      let v;
      try { v = fn(t); } catch { return; }
      const hit = typeof v === 'object' ? !!(v && v.here) : typeof v === 'boolean' ? v : v >= 0;
      if (hit && on === null) on = t;
      if ((!hit || k === LOOP * 100) && on !== null) { wins.push([on, t]); on = null; }
    }
    out[name] = wins;
  };
  for (const k of ['goal', 'candlesOut', 'blowing', 'heart', 'gift', 'niece']) if (typeof S[k] === 'function') scan(k, S[k].bind(S));
  return out;
}

// ---------------------------------------------------------------- page events
export function pictureHash() {
  const h = crypto.createHash('sha1');
  const files = ['index.html', ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).sort().map((f) => 'src/' + f)];
  for (const f of files) { h.update(f); h.update(fs.readFileSync(path.join(ROOT, f))); }
  return h.digest('hex').slice(0, 16);
}

/** read fireworks, lightning and the logo firework of every entry from the live page */
export async function extractFromPage() {
  const { openDiorama } = await import(path.join(ROOT, 'tools', 'lib.mjs'));
  const { browser, page, errors } = await openDiorama({ edition: 'diwali' });
  try {
    const data = await page.evaluate((LOOPS) => {
      const HD = window.HD;
      const res = {};
      for (const ed of HD.EDITIONS) {
        HD.setEdition(ed.id);
        const r = { fireworks: null, lightning: null, logo: null };
        try {
          if (HD._fireworks && typeof HD._fireworks.show === 'function') {
            const s = HD._fireworks.show();
            if (s && Array.isArray(s.list)) r.fireworks = s.list.map((x) => ({ t0: +x.t0, rise: +x.rise, life: +x.life, type: String(x.type), depth: +x.depth || 0.5, far: !!x.far, R: +x.R || 20, bx: +x.bx || 240, by: +x.by || 60 }));
          }
        } catch (e) { r.fwError = String(e); }
        try {
          if (HD.sky && typeof HD.sky.flash === 'function') {
            const strikes = [];
            let prev = 0;
            for (let k = 0; k < LOOPS * 50; k++) {
              const t = k / 50;
              const v = HD.sky.flash(t) || 0;
              if (v > 0.25 && prev <= 0.25) {
                let x = null;
                try { const b = HD.sky.bolt && HD.sky.bolt(t + 0.01); if (b) x = b.x; } catch (e) {}
                if (!strikes.length || t - strikes[strikes.length - 1].t > 1.5) strikes.push({ t, x });
              }
              prev = v;
            }
            r.lightning = strikes;
          }
        } catch (e) { r.ltError = String(e); }
        try {
          if (HD.brand && HD.brand.logoWindow && HD.tag('logo-firework')) r.logo = HD.brand.logoWindow.slice();
        } catch (e) {}
        res[ed.id] = r;
      }
      return res;
    }, LOOP);
    return { data, errors };
  } finally {
    await browser.close();
  }
}

function readSnap() { try { return JSON.parse(fs.readFileSync(SNAP, 'utf8')); } catch { return null; } }
export function writeSnap(obj) {
  const tmp = SNAP + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 0).replace(/\},\{/g, '},\n{') + '\n');
  fs.renameSync(tmp, SNAP);
}

/** refresh the snapshot from the page; returns the snapshot */
export async function sync(log = () => {}) {
  const hash = pictureHash();
  const { data, errors } = await extractFromPage();
  if (errors && errors.length) log('page errors while reading events: ' + errors.slice(0, 3).join(' | '));
  const snap = { hash, at: 'src+index.html sha1', editions: data };
  writeSnap(snap);
  return snap;
}

/**
 * Everything the soundtrack needs to know about the picture of one entry.
 * opts.live: false never launches the browser; opts.write: false never
 * touches the snapshot file.
 */
export async function pictureEvents(id, opts = {}, log = () => {}) {
  const ed = edition(id);
  const hash = pictureHash();
  let snap = readSnap();
  let src = 'snapshot';
  if (!snap || snap.hash !== hash || !snap.editions || !snap.editions[id]) {
    if (opts.live !== false) {
      try {
        const { data, errors } = await extractFromPage();
        if (errors && errors.length) log('page errors while reading events: ' + errors.slice(0, 2).join(' | '));
        snap = { hash, at: 'src+index.html sha1', editions: data };
        src = 'live';
        if (opts.write !== false) { try { writeSnap(snap); } catch (e) { log('could not refresh events.json: ' + e.message); } }
      } catch (e) {
        log('could not read events from the page (' + String(e.message || e).split('\n')[0] + ')' + (snap ? '; using the older snapshot' : '; using a seeded schedule'));
        src = snap ? 'stale-snapshot' : 'seeded';
      }
    } else src = snap ? 'stale-snapshot' : 'seeded';
  }
  const raw = (snap && snap.editions && snap.editions[id]) || {};
  return finishPicture(ed, raw, src, storyWindows(id));
}

/** normalise raw page data, filling gaps with seeded schedules */
export function finishPicture(ed, raw, src, story) {
  const r = new RNG('picture/' + ed.id);
  const pic = { source: src, story: story || {}, fireworks: [], lightning: [], salvos: [], logo: null, accents: [] };
  // fireworks
  const wantFw = ed.fireworks > 0 || (ed.tags || []).includes('goal-fireworks');
  if (raw.fireworks && raw.fireworks.length) {
    pic.fireworks = raw.fireworks.map((s) => ({ t: (s.t0 + s.rise) % LOOP, launch: s.t0 % LOOP, type: s.type, depth: s.depth, far: s.far, R: s.R, x: s.bx, life: s.life }));
  } else if (wantFw && src !== 'snapshot' && src !== 'live') {
    // seeded: flurries and lulls, like the picture's own choreography
    const f = ed.fireworks || 0.3;
    const goal = (story && story.goal && story.goal[0]) || null;
    if (!(ed.fireworks > 0) && goal) {
      for (let k = 0; k < 3; k++) pic.fireworks.push({ t: goal[0] + 1.2 + k * 1.6, type: 'peony', depth: 0.6, far: false, R: 20, x: 300 + 40 * k, life: 2.5 });
    } else {
      let t = r.uni(0, 6);
      while (t < LOOP) {
        const flurry = r.uni(14, 34);
        const end = t + flurry;
        while (t < end && t < LOOP) {
          pic.fireworks.push({ t, type: r.pick(['peony', 'chrys', 'ring', 'willow', 'crackle']), depth: r.next(), far: r.chance(0.25), R: r.uni(16, 34), x: r.uni(180, 460), life: 3 });
          t += r.exp(60 / (12 + 38 * f));
        }
        t += r.uni(8, 14);
      }
    }
  }
  pic.fireworks.sort((a, b) => a.t - b.t);
  // salvos: >= 3 bursts within 2.5 s that stand apart
  if (ed.fireworks >= 0.9) {
    const fw = pic.fireworks;
    for (let i = 0; i < fw.length; i++) {
      let n = 1;
      while (i + n < fw.length && fw[i + n].t - fw[i].t < 2.6) n++;
      if (n >= 4) { pic.salvos.push(fw[i].t); i += n - 1; }
    }
  }
  // lightning
  if (ed.weather && ed.weather.lightning > 0) {
    if (raw.lightning && raw.lightning.length) pic.lightning = raw.lightning.map((s) => ({ t: s.t, x: s.x == null ? 240 : s.x }));
    else {
      let t = r.uni(10, 40);
      while (t < LOOP - 20) { pic.lightning.push({ t, x: r.uni(40, 440) }); t += r.uni(40, 80); }
    }
  }
  if (raw.logo) pic.logo = raw.logo;
  else if ((ed.tags || []).includes('logo-firework')) pic.logo = [118, 123.5];
  // musical accents on story beats
  const S = pic.story;
  const first = (w) => (w && w.length ? w.map((x) => x[0]) : []);
  if (ed.id === 'nyc') pic.accents.push(...first(S.heart).map((t) => t + 0.5));
  if (ed.id === 'dc') pic.accents.push(...first(S.gift).map((t) => t + 1), ...first(S.candlesOut).map((t) => t + 0.3));
  if (ed.id === 'match') pic.accents.push(...first(S.goal).map((t) => t + 0.4));
  if (ed.id === 'newyear' && pic.logo) pic.accents.push(pic.logo[0] + 1.2);
  return pic;
}
