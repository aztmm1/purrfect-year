// Render any window of an entry's 240 s soundtrack (music bed + scene
// ambience), mastered with calibrated gains, deterministic and loop-safe.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  SR, LOOP, N_LOOP, TAU, RNG, Stereo, Curve, FDN, compress, limit, chain, kHops, HOP, lufsFromHops, maxMomentaryFromHops,
  db, todb, h2, loopFreq, sinc1, panGains, wrapT, whiteFill,
} from './dsp.mjs';
import { VOICES as LOFI_VOICES } from './voices.mjs';
import { DANCE_VOICES } from './voices-dance.mjs';
import { compose } from './compose.mjs';
import { composeDance, DANCE_IDS } from './compose-dance.mjs';
import { scene } from './scenes.mjs';
import { edition } from './picture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PREROLL = 4.5; // seconds of history so every filter and the reverbs have converged
export const TARGET_LUFS = -16;
export const CEIL_DB = -1.6; // limiter ceiling (sample peak); keeps true peak under -1 dBTP
const MUSIC_LUFS = -18;

// music stems: level in the bed (integrated LUFS), reverb send, filters, dynamics
const STEMS = {
  keys: { target: -20.5, send: 0.32, filters: [['hp', 140, 0.6], ['peak', 280, 1.0, -2]], comp: { above: 8, ratio: 3, attack: 0.004, release: 0.18 }, trem: 1 },
  pad: { target: -26.5, send: 0.45, filters: [['hp', 120, 0.6], ['peak', 300, 1.0, -2], ['lp', 5200, 0.6]] },
  lead: { target: -23, send: 0.45, filters: [['hp', 150, 0.6]], comp: { above: 9, ratio: 2.5, attack: 0.004, release: 0.15 }, trem: 0.5 },
  color: { target: -25, send: 0.38, filters: [['hp', 150, 0.6]], comp: { above: 8, ratio: 2.5, attack: 0.002, release: 0.12 } },
  bass: { target: -24, send: 0, filters: [['lp', 420, 0.6], ['hp', 32, 0.7]] },
  drums: { target: -25, send: 0.1, filters: [['lp', 7200, 0.6], ['hp', 35, 0.7]] },
  perc: { target: -26.5, send: 0.22, filters: [['lp', 6500, 0.6], ['hp', 60, 0.7]] },
  drone: { target: -25.5, send: 0.4, filters: [['hp', 60, 0.6], ['lp', 4200, 0.6]] },
  hiss: { target: -52, send: 0 },
};
const VOICES = { ...LOFI_VOICES, ...DANCE_VOICES };
// dance stems: level, reverb send, filters, sidechain pump depth
const DSTEMS = {
  kick: { target: -21.5, send: 0, filters: [['hp', 30, 0.7], ['lp', 9000, 0.6]] },
  clap: { target: -28, send: 0.22, filters: [['hp', 300, 0.7], ['lp', 8500, 0.6]] },
  hats: { target: -30.5, send: 0.08, filters: [['hp', 3000, 0.7], ['lp', 9500, 0.6]] },
  bass: { target: -23, send: 0, filters: [['lp', 480, 0.6], ['hp', 32, 0.7]], pump: 0.45 },
  chords: { target: -23.5, send: 0.28, filters: [['hp', 170, 0.6], ['peak', 320, 1, -2]], pump: 0.6 },
  pad: { target: -30, send: 0.5, filters: [['hp', 220, 0.6], ['lp', 6500, 0.6]], pump: 0.7 },
  arp: { target: -28.5, send: 0.3, filters: [['hp', 250, 0.6]], pump: 0.4 },
  lead: { target: -23.5, send: 0.3, filters: [['hp', 200, 0.6]], comp: { above: 9, ratio: 2.5, attack: 0.003, release: 0.12 }, pump: 0.2 },
  fx: { target: -25, send: 0.35, filters: [['hp', 40, 0.7]], lvMode: 'max' },
};
const CHILL_TWEAK = { kick: -1.5, clap: -1, bass: -0.5, chords: -2, pad: 2, arp: 3, lead: 0, fx: -2, hats: 0 };

// ---------------------------------------------------------------- the score
/** everything needed to render an entry (deterministic, cheap to build) */
export function buildScore(id, pic) {
  const ed = edition(id);
  const dance = DANCE_IDS.includes(id);
  const music = dance ? composeDance(ed, pic) : compose(ed, pic);
  const sc = scene(ed, pic, music);
  const stems = {};
  for (const e of music.events) (stems[e.stem] = stems[e.stem] || []).push(e);
  const chill = music.style.dance === 'chill';
  const mLayers = Object.entries(stems).map(([stem, list]) => {
    const cfg = dance ? DSTEMS[stem] : STEMS[stem];
    if (dance) {
      const target = cfg.target + (chill ? CHILL_TWEAK[stem] || 0 : 0);
      return {
        name: 'mus-' + stem, stem, kind: 'events', lv: { mode: cfg.lvMode || 'int', target }, send: cfg.send, filters: cfg.filters, comp: cfg.comp, pump: cfg.pump ? cfg.pump * (chill ? 0.6 : 1) : 0,
        events: list.map((e) => ({ t: wrapT(e.t), dur: e.dur, gain: e.gain, pan: e.pan, seed: e.seed, gen: (r) => VOICES[e.voice](e.p, r) })),
      };
    }
    let target = cfg.target;
    if (stem === 'drums' && music.style.sparse) target -= 2.5 * music.style.sparse;
    if (stem === 'lead' && ['bell', 'celesta', 'zither'].includes(music.meta.voices.lead)) target += 0.5;
    return {
      name: 'mus-' + stem, stem, kind: 'events', lv: { mode: 'int', target }, send: cfg.send, filters: cfg.filters, comp: cfg.comp, trem: cfg.trem,
      events: list.map((e) => ({ t: wrapT(e.t), dur: e.dur, gain: e.gain, pan: e.pan, seed: e.seed, gen: (r) => VOICES[e.voice](e.p, r) })),
    };
  });
  if (dance) {
    const verbM = chill ? { rt60: 1.5, damp: 4200, size: 1.3, ret: 0.42 } : { rt60: 1.7, damp: 4800, size: 1.4, ret: 0.36 };
    return { id, ed, pic, music, dance, layers: mLayers.concat(sc.layers), verbM, verbA: sc.verb, ambTarget: sc.busTarget - (chill ? 1 : 1.5) };
  }
  // tape hiss: part of the lofi bed
  mLayers.push({
    name: 'mus-hiss', stem: 'hiss', kind: 'bed', lv: { mode: 'int', target: STEMS.hiss.target }, send: 0,
    render: (a, n) => {
      const st = new Stereo(n);
      whiteFill(st.L, 0x41551, a); whiteFill(st.R, 0x41552, a);
      chain(st.L, [['hp', 400, 0.6], ['lp', 6000, 0.6]]); chain(st.R, [['hp', 400, 0.6], ['lp', 6000, 0.6]]);
      return st;
    },
  });
  const verbM = { rt60: music.style.sparse > 0.5 ? 2.6 : 2.1, damp: 3400, size: 1.2, ret: music.style.sparse > 0.5 ? 0.62 : 0.52 };
  return { id, ed, pic, music, dance, layers: mLayers.concat(sc.layers), verbM, verbA: sc.verb, ambTarget: sc.busTarget };
}

// ---------------------------------------------------------------- layers
function synth(e) {
  const out = e.gen(new RNG(e.seed));
  const max = Math.ceil(e.dur * SR);
  if (out instanceof Float32Array) return out.length > max ? out.subarray(0, max) : out;
  if (out.L.length > max) return { L: out.L.subarray(0, max), R: out.R.subarray(0, max) };
  return out;
}
function renderEvents(layer, a, len) {
  const st = new Stereo(len);
  for (const e of layer.events) {
    const s0 = Math.round(e.t * SR), d = Math.ceil(e.dur * SR);
    let buf = null;
    for (let m = -1; m <= 2; m++) {
      const s = s0 + m * N_LOOP;
      if (s + d <= a || s >= a + len) continue;
      if (!buf) buf = synth(e);
      if (buf instanceof Float32Array) st.addMono(buf, s - a, e.gain, e.pan);
      else if (e.pan) { const [gl, gr] = panGains(e.pan); addPanned(st, buf, s - a, e.gain * gl * 1.41, e.gain * gr * 1.41); }
      else st.addStereo(buf.L, buf.R, s - a, e.gain);
    }
  }
  return st;
}
function addPanned(st, buf, pos, gl, gr) {
  const n = st.n;
  for (let k = Math.max(0, -pos); k < buf.L.length && pos + k < n; k++) { st.L[pos + k] += buf.L[k] * gl; st.R[pos + k] += buf.R[k] * gr; }
}
function renderSlots(layer, a, len) {
  const st = new Stereo(len);
  for (const p of layer.procs) {
    const sl = N_LOOP / p.nSlots;
    const md = Math.ceil(p.maxDur * SR);
    const k0 = Math.floor((a - md) / sl) - 1, k1 = Math.ceil((a + len) / sl);
    for (let k = k0; k <= k1; k++) {
      const km = ((k % p.nSlots) + p.nSlots) % p.nSlots;
      const r = new RNG(h2(p.seed, km));
      const e = p.gen(r, (km * sl) / SR);
      if (!e) continue;
      const pos = Math.round(k * sl + e.dt * sl) - a;
      if (pos >= len || pos + md <= 0) continue;
      if (e.buf instanceof Float32Array) st.addMono(e.buf.length > md ? e.buf.subarray(0, md) : e.buf, pos, e.g, e.pan || 0);
      else st.addStereo(e.buf.L, e.buf.R, pos, e.g);
    }
  }
  return st;
}
function renderLayer(layer, a, len) {
  const st = layer.kind === 'bed' ? layer.render(a, len) : layer.kind === 'events' ? renderEvents(layer, a, len) : renderSlots(layer, a, len);
  if (layer.filters) { chain(st.L, layer.filters); chain(st.R, layer.filters); }
  return st;
}

// ---------------------------------------------------------------- buses
function tremolo(st, a, rate, depth) {
  const f = loopFreq(rate);
  for (let i = 0; i < st.n; i++) {
    const m = sinc1(f * ((a + i) / SR));
    st.L[i] *= 1 - depth * (0.5 + 0.5 * m);
    st.R[i] *= 1 - depth * (0.5 - 0.5 * m);
  }
}
/** sidechain gain curve from the kick times: a quick duck and a smooth recovery over ~0.6 beat */
function pumpCurve(score, a, len) {
  const P = score._pumpCache || (score._pumpCache = new Map());
  const key = a + ':' + len;
  if (P.has(key)) return P.get(key);
  const env = new Float32Array(len);
  const beat = score.music.beat, att = Math.round(0.012 * SR), relN = Math.round(0.62 * beat * SR);
  for (const [t, d] of score.music.pump || []) {
    if (!d) continue;
    for (let m = -1; m <= 1; m++) {
      const s = Math.round(t * SR) + m * N_LOOP - a;
      if (s + att + relN <= 0 || s >= len) continue;
      for (let k = Math.max(0, -s); k < att + relN && s + k < len; k++) {
        const e = d * (k < att ? 0.5 - 0.5 * Math.cos((Math.PI * k) / att) : 0.5 + 0.5 * Math.cos((Math.PI * (k - att)) / relN));
        if (e > env[s + k]) env[s + k] = e;
      }
    }
  }
  P.clear(); P.set(key, env);
  return env;
}
const WOW = new Map();
function tapeWobble(st, a, id, wowCents, flCents) {
  let w = WOW.get(id);
  if (!w) {
    const r = new RNG('wow/' + id);
    w = { fw: loopFreq(0.45), ff: loopFreq(5.5), pw: r.next(), pf: r.next(), noise: new Curve('wow/' + id, 0.25) };
    WOW.set(id, w);
  }
  const rw = Math.pow(2, wowCents / 1200) - 1, rf = Math.pow(2, flCents / 1200) - 1;
  const Aw = (rw / (TAU * w.fw)) * SR, Af = (rf / (TAU * w.ff)) * SR;
  const base = Aw + Af + 8;
  const n = st.n;
  const nz = new Float32Array(n);
  w.noise.fill(nz, a);
  const out = new Stereo(n);
  for (let i = 0; i < n; i++) {
    const t = (a + i) / SR;
    const d = base + Aw * (0.75 * sinc1(w.fw * t + w.pw) + 0.125 * nz[i]) + Af * sinc1(w.ff * t + w.pf);
    let pos = i - d;
    if (pos < 1) pos = 1;
    const k = Math.floor(pos), f = pos - k;
    const k2 = Math.min(n - 1, k + 2), k1 = Math.min(n - 1, k + 1);
    for (let c = 0; c < 2; c++) {
      const x = c ? st.R : st.L;
      const y0 = x[k - 1], y1 = x[k], y2 = x[k1], y3 = x[k2];
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      (c ? out.R : out.L)[i] = ((c3 * f + c2) * f + c1) * f + y1;
    }
  }
  return out;
}

/**
 * Render absolute loop samples [w0, w0 + n). gains: calibration (dB) or null.
 * opts.measure: 'stems' (per-layer statistics at unity gain) | 'buses' | null
 */
export function renderWindow(score, w0, n, gains, opts = {}) {
  const P = Math.round(PREROLL * SR);
  const a = w0 - P, len = n + P;
  const stats = {};
  const meas = opts.measure;
  const hops = meas ? Math.floor(n / HOP) : 0;
  const measure = (st) => {
    let pk = 0;
    for (let i = P; i < len; i++) pk = Math.max(pk, Math.abs(st.L[i]), Math.abs(st.R[i]));
    return { hops: Array.from(kHops(st.L, st.R, P, hops)), peak: pk };
  };
  const G = (name) => (gains && gains.stems && gains.stems[name] != null ? db(gains.stems[name]) : 1);
  const mDry = new Stereo(len), mSend = new Stereo(len), aDry = new Stereo(len), aSend = new Stereo(len);
  const C = score.music.colour;
  for (const layer of score.layers) {
    const isMusic = layer.name.startsWith('mus-');
    const st = renderLayer(layer, a, len);
    if (meas === 'stems') stats[layer.name] = measure(st);
    const g = G(layer.name);
    if (g !== 1) st.scale(g);
    if (layer.comp) compress(st, { thr: layer.lv.target + layer.comp.above, ratio: layer.comp.ratio, attack: layer.comp.attack, release: layer.comp.release });
    if (layer.trem) tremolo(st, a, C.tremRate, C.tremDepth * layer.trem);
    if (layer.pump) {
      const env = pumpCurve(score, a, len), d = layer.pump;
      for (let i = 0; i < len; i++) { const k = 1 - d * env[i]; st.L[i] *= k; st.R[i] *= k; }
    }
    if (opts.stemsOnly) continue;
    (isMusic ? mDry : aDry).mix(st);
    if (layer.send) (isMusic ? mSend : aSend).mix(st, layer.send);
  }
  if (opts.stemsOnly) return { stats };
  // music bus: reverb, gentle saturation, glue, warmth, tape wobble
  const vm = score.verbM;
  new FDN({ rt60: vm.rt60, damp: vm.damp, size: vm.size, predelay: 0.02, hp: 200 }).process(mSend.L, mSend.R, mDry.L, mDry.R, vm.ret);
  const drive = C.drive || 1.2;
  for (let i = 0; i < len; i++) { mDry.L[i] = Math.tanh(drive * mDry.L[i]) / drive; mDry.R[i] = Math.tanh(drive * mDry.R[i]) / drive; }
  compress(mDry, { thr: MUSIC_LUFS + 7, ratio: 2, attack: 0.012, release: 0.3 });
  chain(mDry.L, [['lp', C.lp, 0.65], ['highshelf', C.shelfF || 3000, 0.7, C.shelf], ['hp', 38, 0.7]]);
  chain(mDry.R, [['lp', C.lp, 0.65], ['highshelf', C.shelfF || 3000, 0.7, C.shelf], ['hp', 38, 0.7]]);
  const music = C.wowCents ? tapeWobble(mDry, a, score.id, C.wowCents, C.flutterCents) : mDry;
  // ambience bus: its space, then a gentle top and bottom
  const va = score.verbA;
  new FDN({ rt60: va.rt60, damp: va.damp, size: va.size, predelay: 0.03, hp: 250 }).process(aSend.L, aSend.R, aDry.L, aDry.R, va.ret);
  chain(aDry.L, [['hp', 35, 0.7], ['lp', 9000, 0.6]]);
  chain(aDry.R, [['hp', 35, 0.7], ['lp', 9000, 0.6]]);
  const amb = aDry;
  if (meas === 'buses') { stats.music = measure(music); stats.amb = measure(amb); }
  // master
  const gm = gains ? db(gains.music || 0) : 1, ga = gains ? db(gains.amb || 0) : 1, gM = gains ? db(gains.master || 0) : 1;
  const out = new Stereo(len);
  for (let i = 0; i < len; i++) {
    out.L[i] = (music.L[i] * gm + amb.L[i] * ga) * gM;
    out.R[i] = (music.R[i] * gm + amb.R[i] * ga) * gM;
  }
  if (meas === 'buses') stats.preLimiter = measure(out);
  const lim = limit(out, CEIL_DB, { lookahead: 0.004, releaseDbPerSec: 10 });
  stats.limiterMaxDb = lim;
  return { L: out.L.slice(P), R: out.R.slice(P), stats };
}

// ---------------------------------------------------------------- calibration
const CAL = path.join(HERE, 'calibration.json');
export function codeHash() {
  const h = crypto.createHash('sha1');
  for (const f of fs.readdirSync(HERE).filter((x) => x.endsWith('.mjs')).sort()) { h.update(f); h.update(fs.readFileSync(path.join(HERE, f))); }
  return h.digest('hex').slice(0, 16);
}
export function editionHash(ed) {
  const keep = { id: ed.id, place: ed.place, light: ed.light, season: ed.season, weather: ed.weather, fire: ed.fire, fireworks: ed.fireworks, cast: ed.cast, tags: ed.tags };
  return crypto.createHash('sha1').update(JSON.stringify(keep)).digest('hex').slice(0, 12);
}
export function readCalibration() { try { return JSON.parse(fs.readFileSync(CAL, 'utf8')); } catch { return { editions: {} }; } }
export function writeCalibration(obj) {
  const tmp = CAL + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n');
  fs.renameSync(tmp, CAL);
}
/** gains of one entry: {gains, state: 'ok' | 'stale' | 'missing'} */
export function gainsFor(id) {
  const cal = readCalibration();
  const g = cal.editions && cal.editions[id];
  if (!g) return { gains: null, state: 'missing' };
  const fresh = g.code === codeHash() && g.ed === editionHash(edition(id));
  return { gains: g, state: fresh ? 'ok' : 'stale' };
}
/** stem gains from per-layer statistics over the whole loop */
export function stemGains(score, stats) {
  const out = {}, measured = {};
  for (const layer of score.layers) {
    const s = stats[layer.name];
    if (!s) continue;
    const m = layer.lv.mode === 'max' ? maxMomentaryFromHops(s.hops) : layer.lv.mode === 'peak' ? todb(s.peak) : lufsFromHops(s.hops);
    measured[layer.name] = +m.toFixed(2);
    out[layer.name] = isFinite(m) ? +(layer.lv.target - m).toFixed(3) : 0;
  }
  return { stems: out, measured };
}
/** bus gains from the music and ambience bus statistics */
export function busGains(score, stats) {
  const lm = lufsFromHops(stats.music.hops), la = lufsFromHops(stats.amb.hops);
  const music = MUSIC_LUFS - lm, amb = score.ambTarget - la;
  const hm = stats.music.hops, ha = stats.amb.hops;
  const gm = db(music) ** 2, ga = db(amb) ** 2;
  const mix = hm.map((v, i) => v * gm + ha[i] * ga);
  const master = TARGET_LUFS - lufsFromHops(mix);
  return { music: +music.toFixed(3), amb: +amb.toFixed(3), master: +master.toFixed(3), musicLUFS: +lm.toFixed(2), ambLUFS: +la.toFixed(2) };
}
/** merge per-block statistics (in loop order) */
export function mergeStats(parts) {
  const out = {};
  for (const p of parts)
    for (const [k, v] of Object.entries(p)) {
      if (!v || !v.hops) continue;
      const o = (out[k] = out[k] || { hops: [], peak: 0 });
      o.hops.push(...v.hops);
      o.peak = Math.max(o.peak, v.peak);
    }
  return out;
}
