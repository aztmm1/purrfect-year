// Scene ambience of every entry, built from small synthesis models: filtered
// noise beds with smooth periodic modulation, dense stateless "slot"
// processes (rain drops, crackles, leaves, crickets) and scheduled events
// (drips, birds, thunder, fireworks, voices, cheers) placed by loop time so
// they agree with the picture.
//
// Layer kinds understood by the engine:
//   { kind: 'bed', render(a, n) -> Stereo }            a: absolute loop sample
//   { kind: 'events', events: [{t, dur, gen(r), gain, pan, seed}] }
//   { kind: 'slots', procs: [{nSlots, maxDur, seed, gen(r, t) -> {dt, buf, g, pan} | null}] }
// Every layer carries lv: {mode: 'int' | 'max' | 'peak', target} (its level
// in the scene) and send (its reverb send).
import {
  SR, LOOP, TAU, RNG, Stereo, Curve, rc, clamp, db, sinc1, mtof, makeTable, tabRead, SVF, OnePole, bq, runBQ, chain,
  whiteFill, pinkFill, loopFreq, panGains,
} from './dsp.mjs';

// ---------------------------------------------------------------- small helpers
const bedLayer = (name, render, lv, o = {}) => ({ name, kind: 'bed', render, lv, send: o.send || 0, filters: o.filters });
const evLayer = (name, events, lv, o = {}) => ({ name, kind: 'events', events, lv, send: o.send || 0, filters: o.filters });
const slotLayer = (name, procs, lv, o = {}) => ({ name, kind: 'slots', procs, lv, send: o.send || 0, filters: o.filters });
const proc = (seed, rate, maxDur, gen) => ({ seed: typeof seed === 'number' ? seed : hashSeed(seed), nSlots: Math.max(1, Math.round(rate * LOOP)), maxDur, gen });
function hashSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const wrapT = (t) => ((t % LOOP) + LOOP) % LOOP;

/** filtered stereo noise bed with an optional smooth level curve */
function noiseBed(seed, color, specs, mod, o = {}) {
  const sL = hashSeed(seed + '/L'), sR = hashSeed(seed + '/R');
  const corr = o.corr || 0;
  return (a, n) => {
    const st = new Stereo(n);
    (color === 'pink' ? pinkFill : whiteFill)(st.L, sL, a);
    (color === 'pink' ? pinkFill : whiteFill)(st.R, sR, a);
    if (corr) for (let i = 0; i < n; i++) { const m = 0.5 * (st.L[i] + st.R[i]); st.L[i] += corr * (m - st.L[i]); st.R[i] += corr * (m - st.R[i]); }
    chain(st.L, specs); chain(st.R, specs);
    if (mod) {
      const m = new Float32Array(n);
      mod(m, a);
      for (let i = 0; i < n; i++) { st.L[i] *= m[i]; st.R[i] *= m[i]; }
    }
    if (o.pan != null) { const [gl, gr] = panGains(o.pan); for (let i = 0; i < n; i++) { st.L[i] *= gl * 1.41; st.R[i] *= gr * 1.41; } }
    return st;
  };
}
/** gust-like level 0..1 from a curve */
const level = (curve, mean, depth, lo = 0.05, hi = 1, pow = 1) => (m, a) => curve.fill(m, a, (v) => Math.pow(clamp(mean + depth * v, lo, hi), pow));

function fadeEnds(buf, a = 0.002, b = 0.01) {
  const n = buf.length, na = Math.min(n >> 1, Math.round(a * SR)), nb = Math.min(n >> 1, Math.round(b * SR));
  for (let i = 0; i < na; i++) buf[i] *= rc(i / na);
  for (let i = 0; i < nb; i++) buf[n - 1 - i] *= rc(i / nb);
  return buf;
}
/** a tonal chirp: contour(u) -> Hz over `dur`; harmonics [a1, a2, ...] */
function tone(contour, dur, harm, att, rel, shape) {
  const len = Math.max(8, Math.round(dur * SR));
  const out = new Float32Array(len);
  const attN = Math.max(1, att * SR), relN = Math.max(1, rel * SR);
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const u = n / len;
    ph += contour(u) / SR;
    let y = 0;
    for (let h = 0; h < harm.length; h++) if (harm[h] && contour(u) * (h + 1) < 9000) y += harm[h] * sinc1((h + 1) * ph);
    out[n] = y * rc(n / attN) * (1 - rc((n - (len - relN)) / relN)) * (shape ? shape(u) : 1);
  }
  return out;
}
function concatAt(parts, total) {
  const len = Math.ceil(total * SR);
  const out = new Float32Array(len);
  for (const p of parts) { const s = Math.round(p.t * SR); const g = p.g == null ? 1 : p.g; for (let i = 0; i < p.buf.length && s + i < len; i++) out[s + i] += p.buf[i] * g; }
  return out;
}
function lowpass(buf, f, q = 0.6) { return runBQ(buf, bq('lp', f, q)); }
function noiseBurst(r, len, fc, q, tau, att = 0.0004) {
  const b = new Float32Array(len);
  const sv = new SVF(fc, q);
  const k = Math.exp(-1 / (tau * SR));
  let e = 1;
  for (let n = 0; n < len; n++) { sv.process(r.next() * 2 - 1); b[n] = sv.bp * rc(n / (att * SR)) * e; e *= k; }
  return fadeEnds(b, 0, 0.001);
}
/** jittered periodic schedule over the loop */
function periodic(r, every, jitter, phase = r.next()) {
  const k = Math.max(1, Math.round(LOOP / every));
  const out = [];
  for (let j = 0; j < k; j++) out.push(wrapT(((j + phase) * LOOP) / k + r.gauss() * jitter));
  return out.sort((a, b) => a - b);
}
function poisson(r, rate, t0 = 0, t1 = LOOP) {
  const out = [];
  let t = t0 + r.exp(1 / rate);
  while (t < t1) { out.push(t); t += r.exp(1 / rate); }
  return out;
}
let EVN = 0;
const ev = (t, dur, gen, gain = 1, pan = 0, tag = '') => ({ t, dur, gen, gain, pan, seed: 'ev/' + tag + '/' + EVN++ });

// ---------------------------------------------------------------- voices (wordless)
const VOW = { a: [730, 1090, 2440], e: [530, 1840, 2480], i: [310, 2200, 2950], o: [570, 840, 2410], u: [340, 870, 2240], ae: [660, 1700, 2400], uh: [520, 1190, 2390], m: [270, 1000, 2300] };
const SPEECH_V = ['a', 'e', 'i', 'o', 'u', 'ae', 'uh', 'uh', 'a', 'e'];
let TAB_LO = null, TAB_HI = null;
function srcTabs() {
  if (!TAB_LO) {
    const mk = (H) => { const amps = []; for (let h = 1; h <= H; h++) amps.push(1 / Math.pow(h, 1.1)); const t = makeTable(amps); let p = 0; for (const x of t) p = Math.max(p, Math.abs(x)); return t.map((x) => x / p); };
    TAB_LO = mk(36); TAB_HI = mk(16);
  }
}
/**
 * Formant voice: segments [{d, f0: [a, b], v, amp: [a, b] | a, br, c, vib, att, rel}]
 * o: {f0base, scale, breath, peak}
 */
function vocal(segs, o, r) {
  srcTabs();
  const total = segs.reduce((s, g) => s + g.d, 0) + 0.1;
  const len = Math.ceil(total * SR);
  const tab = (o.f0base || 200) < 170 ? TAB_LO : TAB_HI;
  const f0 = new Float32Array(len), amp = new Float32Array(len), br = new Float32Array(len), vib = new Float32Array(len);
  const B = 32, nb = Math.ceil(len / B) + 1;
  const F = [new Float32Array(nb), new Float32Array(nb), new Float32Array(nb)];
  const cons = [];
  let pos = 0;
  for (const g of segs) {
    const n = Math.round(g.d * SR);
    const aN = Math.max(1, Math.min(n / 2, (g.att || 0.03) * SR)), rN = Math.max(1, Math.min(n / 2, (g.rel || 0.05) * SR));
    const A0 = Array.isArray(g.amp) ? g.amp[0] : g.amp, A1 = Array.isArray(g.amp) ? g.amp[1] : g.amp;
    const fa = g.f0[0], fb = g.f0[1], fm = g.f0[2];
    for (let k = 0; k < n && pos + k < len; k++) {
      const u = k / n;
      f0[pos + k] = fm ? (u < 0.5 ? fa + (fm - fa) * rc(u * 2) : fm + (fb - fm) * rc(u * 2 - 1)) : fa + (fb - fa) * u;
      amp[pos + k] = (A0 + (A1 - A0) * u) * rc(k / aN) * (1 - rc((k - (n - rN)) / rN));
      br[pos + k] = g.br == null ? o.breath || 0.06 : g.br;
      vib[pos + k] = g.vib ? g.vib * rc((k / SR - 0.18) / 0.3) : 0;
    }
    const fv = VOW[g.v || 'uh'];
    for (let b = Math.floor(pos / B); b <= Math.min(nb - 1, Math.floor((pos + n) / B)); b++) { F[0][b] = fv[0]; F[1][b] = fv[1]; F[2][b] = fv[2]; }
    if (g.c) cons.push({ pos, kind: g.c });
    pos += n;
  }
  for (let b = 1; b < nb; b++) for (let k = 0; k < 3; k++) if (!F[k][b]) F[k][b] = F[k][b - 1];
  for (let k = 0; k < 3; k++) if (!F[k][0]) F[k][0] = F[k][1] || VOW.uh[k];
  const sc = o.scale || 1;
  const BW = [110, 140, 210];
  const GA = [1, 0.55, 0.3];
  const svf = [new SVF(500, 4), new SVF(1500, 6), new SVF(2500, 8)];
  const cur = [F[0][0], F[1][0], F[2][0]];
  const aspF = new SVF(2600, 0.8);
  const out = new Float32Array(len);
  let ph = r.next();
  const jit = new OnePole(12);
  const vr = 5 + r.next();
  for (let n = 0; n < len; n++) {
    if (n % B === 0) {
      const b = n / B;
      for (let k = 0; k < 3; k++) { cur[k] += 0.22 * (F[k][b] - cur[k]); const f = cur[k] * sc; svf[k].set(f, f / (BW[k] * (1 + 0.15 * k))); }
    }
    const a = amp[n];
    if (a <= 0 && n % B !== 0) { out[n] = 0; ph += f0[n] / SR; continue; }
    const j = jit.process(r.next() * 2 - 1) * 0.04;
    const ff = f0[n] * (1 + j + vib[n] * sinc1(vr * (n / SR)));
    const s = tabRead(tab, ph);
    ph += ff / SR; if (ph > 1) ph -= 1;
    const w = r.next() * 2 - 1;
    aspF.process(w);
    const x = (s * (1 - br[n]) + w * br[n] * 0.9) * a;
    let y = 0;
    for (let k = 0; k < 3; k++) { svf[k].process(x); y += GA[k] * svf[k].k * svf[k].bp; }
    out[n] = y + aspF.bp * br[n] * a * 0.15;
  }
  for (const c of cons) { // consonant onsets: short soft noise
    const fc = c.kind === 's' ? 4200 : c.kind === 'h' ? 1800 : c.kind === 't' ? 3200 : 2400;
    const l = Math.round((c.kind === 's' ? 0.06 : c.kind === 'h' ? 0.05 : 0.02) * SR);
    const b = noiseBurst(r, l, fc, c.kind === 'h' ? 0.6 : 1.2, c.kind === 's' ? 0.03 : 0.012, 0.004);
    const g = c.kind === 's' ? 0.1 : c.kind === 'h' ? 0.12 : 0.18;
    for (let i = 0; i < l && c.pos + i < len; i++) out[c.pos + i] += b[i] * g;
  }
  let pk = 1e-9;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(out[i]));
  const k = (o.peak || 0.5) / pk;
  for (let i = 0; i < len; i++) out[i] *= k;
  return fadeEnds(out, 0.003, 0.03);
}
const PEOPLE = {
  man: () => ({ f0: 118, scale: 1, breath: 0.06 }),
  woman: () => ({ f0: 205, scale: 1.13, breath: 0.08 }),
  child: () => ({ f0: 280, scale: 1.25, breath: 0.08 }),
};
function person(r, kind) { const p = PEOPLE[kind](); p.f0 *= r.uni(0.9, 1.12); p.scale *= r.uni(0.97, 1.03); return p; }
/** a wordless spoken phrase */
function speech(r, who, o = {}) {
  const ex = o.excite || 0;
  const n = r.int(o.min || 4, o.max || 11);
  const segs = [];
  const base = who.f0 * (1 + 0.45 * ex);
  for (let s = 0; s < n; s++) {
    const u = s / n;
    if (s > 1 && r.chance(0.1)) segs.push({ d: r.uni(0.05, 0.12), f0: [base, base], amp: 0 });
    const d = r.uni(0.11, 0.21) * (1 - 0.2 * ex);
    const acc = r.chance(0.22) ? 1.13 : 1;
    const fa = base * (1.08 - 0.16 * u) * acc * (1 + 0.025 * r.gauss());
    const fb = fa * (s === n - 1 ? (o.question ? 1.18 : 0.86) : 0.97 + 0.03 * r.gauss());
    segs.push({ d, f0: [fa, fb], v: r.pick(SPEECH_V), amp: [(0.55 + 0.45 * r.next()) * (s === n - 1 ? 0.75 : 1), 0.6 + 0.3 * r.next()], c: r.chance(0.6) ? r.pick(['t', 'k', 's', 'h', 't']) : null, att: 0.025, rel: 0.045 });
  }
  return vocal(segs, { f0base: base, scale: who.scale, breath: who.breath, peak: o.peak || 0.5 }, r);
}
function laugh(r, who) {
  const n = r.int(4, 7), segs = [];
  for (let k = 0; k < n; k++) {
    const f = who.f0 * (1.45 - 0.05 * k) * (1 + 0.03 * r.gauss());
    segs.push({ d: r.uni(0.1, 0.13), f0: [f, f * 0.93], v: r.pick(['a', 'ae']), amp: 1 - 0.09 * k, br: 0.32, c: 'h', att: 0.012, rel: 0.05 });
  }
  return vocal(segs, { f0base: who.f0 * 1.4, scale: who.scale, breath: 0.3, peak: 0.45 }, r);
}
function cheerCall(r, who) {
  const b = who.f0;
  const kind = r.pick(['yay', 'woo', 'hey', 'yay']);
  let segs;
  if (kind === 'woo') { const d = r.uni(0.5, 0.9); segs = [{ d, f0: [b * 1.45, b * 1.35, b * 2.0], v: 'u', amp: [0.6, 0.9], br: 0.14, att: 0.06, rel: 0.2 }]; }
  else if (kind === 'hey') segs = [{ d: r.uni(0.28, 0.4), f0: [b * 1.55, b * 1.35], v: 'e', amp: 1, br: 0.12, c: 'h', att: 0.02, rel: 0.12 }];
  else segs = [{ d: 0.07, f0: [b * 1.4, b * 1.5], v: 'i', amp: [0.4, 0.8], br: 0.1, att: 0.02, rel: 0.01 }, { d: r.uni(0.35, 0.6), f0: [b * 1.55, b * 1.45, b * 1.8], v: 'e', amp: [1, 0.8], br: 0.12, att: 0.01, rel: 0.18 }];
  return vocal(segs, { f0base: b * 1.6, scale: who.scale, breath: 0.12, peak: 0.6 }, r);
}
/** hummed tune: notes [{midi, d}] legato on 'm'/'u' */
function hum(notes, who, r, vowel = 'm') {
  const segs = [];
  let prev = null;
  for (const nt of notes) {
    const f = mtof(nt.midi);
    segs.push({ d: nt.d, f0: [prev ? prev + (f - prev) * 0.75 : f, f], v: nt.v || vowel, amp: nt.a == null ? 0.85 : nt.a, br: 0.05, vib: 0.006, att: prev ? 0.04 : 0.12, rel: nt.rest ? 0.15 : 0.03 });
    prev = nt.rest ? null : f;
  }
  return vocal(segs, { f0base: who.f0, scale: who.scale, breath: 0.05, peak: 0.5 }, r);
}
/** a group of clappers: stereo, `dur` seconds */
function claps(r, dur, n, o = {}) {
  const len = Math.ceil(dur * SR);
  const L = new Float32Array(len), R = new Float32Array(len);
  for (let c = 0; c < n; c++) {
    const rate = r.uni(3.6, 5), pan = r.uni(-0.7, 0.7), [gl, gr] = panGains(pan);
    const fc = r.uni(900, 1900), a0 = r.uni(0.6, 1);
    let t = r.uni(0.1, 0.6);
    const end = dur - r.uni(0.3, 1.5);
    while (t < end) {
      const env = rc(t / 0.4) * (1 - rc((t - (end - 1.4)) / 1.4));
      const b = noiseBurst(r, Math.round(0.022 * SR), fc * r.uni(0.92, 1.08), 2.2, 0.0045, 0.0005);
      const s = Math.round(t * SR), g = a0 * env * r.uni(0.7, 1);
      for (let i = 0; i < b.length && s + i < len; i++) { L[s + i] += b[i] * g * gl; R[s + i] += b[i] * g * gr; }
      t += (1 / rate) * (1 + 0.08 * r.gauss());
    }
  }
  if (o.lp) { lowpass(L, o.lp); lowpass(R, o.lp); }
  return { L, R };
}
/** a group cheer (stereo): calls from `who`, claps, an optional crowd swell */
function cheer(r, dur, people, o = {}) {
  const len = Math.ceil(dur * SR);
  const L = new Float32Array(len), R = new Float32Array(len);
  people.forEach((who, i) => {
    const pan = o.spread ? r.uni(-o.spread, o.spread) : 0;
    const [gl, gr] = panGains(pan);
    let t = r.uni(0.05, 0.6) + (o.stagger || 0) * i;
    const calls = r.int(o.calls ? o.calls[0] : 1, o.calls ? o.calls[1] : 3);
    for (let k = 0; k < calls && t < dur - 1; k++) {
      const b = cheerCall(r, who);
      const s = Math.round(t * SR), g = r.uni(0.7, 1) * (1 - 0.15 * k);
      for (let j = 0; j < b.length && s + j < len; j++) { L[s + j] += b[j] * g * gl; R[s + j] += b[j] * g * gr; }
      t += b.length / SR + r.uni(0.2, 1.2);
    }
  });
  if (o.claps) {
    const c = claps(r, Math.min(dur, o.clapDur || dur), o.claps, { lp: o.lp });
    const s = Math.round((o.clapAt || 0.4) * SR);
    for (let j = 0; j < c.L.length && s + j < len; j++) { L[s + j] += c.L[j] * (o.clapGain || 0.6); R[s + j] += c.R[j] * (o.clapGain || 0.6); }
  }
  if (o.swell) { // many far voices: a band-limited roar that swells and fades
    const a = new Float32Array(len), b = new Float32Array(len);
    for (let i = 0; i < len; i++) { a[i] = r.next() * 2 - 1; b[i] = r.next() * 2 - 1; }
    for (const x of [a, b]) { chain(x, [['bp', 700, 0.5], ['lp', 2600, 0.6], ['peak', 1100, 1.2, 4]]); }
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const e = o.swell * rc(t / (o.rise || 0.8)) * (1 - rc((t - (dur - 3.5)) / 3.4)) * (0.85 + 0.15 * Math.sin(TAU * 2.7 * t));
      L[i] += a[i] * e; R[i] += b[i] * e;
    }
  }
  if (o.lp) { lowpass(L, o.lp); lowpass(R, o.lp); }
  fadeEnds(L, 0.01, 0.5); fadeEnds(R, 0.01, 0.5);
  return { L, R };
}

// ---------------------------------------------------------------- weather and nature
function rain(seed, lv, o = {}) {
  const inten = new Curve(seed + '/int', 0.07);
  const layers = [];
  layers.push(bedLayer('rain-wash', noiseBed(seed + '/wash', 'pink', [['hp', 240, 0.6], ['lp', 5200, 0.55], ['peak', 1500, 0.7, 2], ['highshelf', 3800, 0.7, -3]], level(inten, 1, 0.12, 0.5, 1.5)), { mode: 'int', target: lv.wash }));
  // granular droplets: ticks and plinks, about 420 a second
  const dropGen = (r, t) => {
    const f = Math.exp(r.uni(Math.log(1300), Math.log(5500)));
    const tau = r.uni(0.0012, 0.0035);
    const len = Math.ceil(tau * 6 * SR);
    const g = new Float32Array(len);
    const tick = r.chance(0.5);
    const sv = new SVF(f, 2.5);
    let ph = r.next();
    const k = Math.exp(-1 / (tau * SR));
    let e = 1;
    for (let n = 0; n < len; n++) {
      const env = rc(n / (0.0005 * SR)) * e * (1 - rc((n - 0.75 * len) / (0.25 * len)));
      if (tick) { sv.process(r.next() * 2 - 1); g[n] = sv.bp * 1.5 * env; } else { ph += f / SR; g[n] = sinc1(ph) * env; }
      e *= k;
    }
    return { dt: r.next(), buf: g, g: 0.2 * clamp(r.logn(0.6), 0.25, 2.2) * (1 + 0.15 * inten.grid(Math.round(t * 100))), pan: r.uni(-0.9, 0.9) };
  };
  const heavyGen = (r) => {
    const f0 = r.uni(700, 2200), tau = r.uni(0.008, 0.02);
    return { dt: r.next(), buf: tone((u) => f0 * (1 + 0.35 * u), tau * 5, [1, 0.15], 0.0008, tau, (u) => Math.exp(-u * 5)), g: 0.22 * clamp(r.logn(0.4), 0.4, 1.8), pan: r.uni(-0.7, 0.7) };
  };
  layers.push(slotLayer('rain-drops', [proc(seed + '/drops', 420, 0.03, dropGen), proc(seed + '/heavy', 6, 0.15, heavyGen)], { mode: 'int', target: lv.drops }, { filters: [['lp', 6000, 0.6], ['hp', 500, 0.6]] }));
  layers.push(bedLayer('rain-rumble', noiseBed(seed + '/rum', 'white', [['lp', 320, 0.6], ['lp', 320, 0.6], ['hp', 80, 0.6]]), { mode: 'int', target: lv.rumble }));
  // drips on rails and ledges: metal bar modes, quasi-periodic
  const rd = new RNG(seed + '/drips');
  const drips = [];
  for (const p of o.dripPoints || [{ every: 1.45, jit: 0.12, f: 1180, pan: -0.35, g: 1 }, { every: 2.6, jit: 0.3, f: 1560, pan: 0.4, g: 0.7 }, { every: 4.1, jit: 0.6, f: 980, pan: 0.1, g: 0.45 }]) {
    for (const t of periodic(rd, p.every, p.jit)) {
      if (rd.chance(0.08)) continue;
      const f = p.f * (1 + 0.012 * rd.gauss());
      drips.push(ev(t, 0.46, (r) => {
        const len = Math.round(0.45 * SR), b = new Float32Array(len);
        const modes = [[1, 1, 0.16], [2.756, 0.32, 0.06], [5.404, 0.08, 0.025]];
        for (const [ra, a, tau] of modes) { const inc = (f * ra) / SR; const k = Math.exp(-1 / (tau * SR)); let e = a, ph = 0; for (let n = 0; n < len; n++) { b[n] += e * sinc1(ph); ph += inc; e *= k; } }
        for (let n = 0; n < len; n++) b[n] *= rc(n / (0.0006 * SR)) * (1 - rc((n / SR - 0.38) / 0.07));
        return lowpass(b, 5500);
      }, p.g * (0.8 + 0.4 * rd.next()), p.pan + 0.05 * rd.gauss(), 'drip'));
    }
  }
  layers.push(evLayer('rain-drips', drips, { mode: 'max', target: lv.drips }, { send: 0.5 }));
  return layers;
}

/** distant thunder: rolling low rumble starting a little after each lightning flash */
function thunder(seed, strikes, lv) {
  const list = strikes.map((s, i) => {
    const delay = 1.6 + 1.6 * new RNG(seed + '/d' + i).next();
    const pan = clamp((s.x - 240) / 260, -0.8, 0.8);
    return ev(s.t + delay, 10, (r) => {
      const tl = 9, len = Math.round(tl * SR);
      const rolls = [[0, 1, 0.6, 1.6], [0.9, 0.75, 0.5, 1.2], [2.0, 0.55, 0.6, 2.2], [3.4, 0.3, 0.8, 1.8]].map((x) => [x[0] * r.uni(0.8, 1.2), x[1] * r.uni(0.8, 1.1), x[2], x[3]]);
      const env = new Float32Array(len);
      const wob = new OnePole(3), wob2 = new OnePole(3);
      for (let n = 0; n < len; n++) {
        const t = n / SR;
        let e = 0;
        for (const [s0, a, at, dc] of rolls) if (t > s0) e += a * rc((t - s0) / at) * Math.exp(-Math.max(0, t - s0 - at) / dc);
        const w = wob2.process(wob.process(r.next() * 2 - 1));
        env[n] = e * (0.8 + 4 * w) * (1 - rc((t - (tl - 1.5)) / 1.5));
      }
      const L = new Float32Array(len), R = new Float32Array(len);
      for (let n = 0; n < len; n++) { const c = r.next() * 2 - 1; L[n] = (0.8 * c + 0.45 * (r.next() * 2 - 1)) * env[n]; R[n] = (0.8 * c + 0.45 * (r.next() * 2 - 1)) * env[n]; }
      for (const x of [L, R]) {
        const crack = Float32Array.from(x);
        chain(x, [['lp', 200, 0.7], ['lp', 260, 0.6], ['hp', 38, 0.7], ['peak', 90, 1, 2]]);
        chain(crack, [['bp', 520, 1.2], ['lp', 900, 0.7]]);
        for (let n = 0; n < len; n++) x[n] += 0.08 * crack[n] * Math.exp(-n / SR / 1.2);
        fadeEnds(x, 0.05, 0.3);
      }
      const [gl, gr] = panGains(pan);
      for (let n = 0; n < len; n++) { L[n] *= 0.6 + 0.8 * gl; R[n] *= 0.6 + 0.8 * gr; }
      return { L, R };
    }, 1, 0, 'thunder');
  });
  return evLayer('thunder', list, { mode: 'max', target: lv }, { send: 0.3 });
}

function wind(seed, lv, o = {}) {
  const gust = new Curve(seed + '/gust', o.gustFc || 0.12);
  const g = (v) => clamp((o.mean || 0.55) + (o.depth || 0.28) * v, 0.1, 1);
  const layers = [];
  layers.push(bedLayer('wind', noiseBed(seed + '/body', 'pink', [['hp', o.lo || 220, 0.6], ['lp', o.hi || 1300, 0.6]], (m, a) => gust.fill(m, a, (v) => Math.pow(g(v), 1.5))), { mode: 'int', target: lv.body }));
  if (lv.leaves != null) {
    const leafGen = (r, t) => {
      const gi = g(gust.grid(Math.round(t * 100)));
      if (!r.chance(Math.pow(gi, 3))) return null;
      const len = Math.round(r.uni(0.004, 0.014) * SR);
      return { dt: r.next(), buf: noiseBurst(r, len, r.uni(1800, 4600), 1.1, r.uni(0.002, 0.005), 0.001), g: r.logn(0.5), pan: r.uni(-0.9, 0.9) };
    };
    layers.push(slotLayer('leaves', [proc(seed + '/leaves', o.leafRate || 160, 0.02, leafGen)], { mode: 'int', target: lv.leaves }));
    layers.push(bedLayer('leaf-hiss', noiseBed(seed + '/hiss', 'white', [['bp', 3000, 0.7], ['lp', 6000, 0.6]], (m, a) => gust.fill(m, a, (v) => Math.pow(g(v), 2.2))), { mode: 'int', target: lv.leaves - 2 }));
  }
  return { layers, gust, g };
}

/** leaves skittering along the pavement at the gusts */
function skitter(seed, lv) {
  const r0 = new RNG(seed);
  const list = [];
  for (const t of periodic(r0, 9, 3)) {
    list.push(ev(t, 2.6, (r) => {
      const dur = r.uni(0.8, 2.2), len = Math.round(dur * SR);
      const L = new Float32Array(len), R = new Float32Array(len);
      const p0 = r.uni(-0.9, 0.2), p1 = clamp(p0 + r.uni(0.4, 1.2), -0.9, 0.9);
      let tt = 0;
      while (tt < dur - 0.05) {
        const u = tt / dur;
        const env = Math.sin(Math.PI * u);
        const b = noiseBurst(r, Math.round(r.uni(0.006, 0.02) * SR), r.uni(1500, 4200), r.uni(0.8, 1.6), r.uni(0.003, 0.008), 0.001);
        const [gl, gr] = panGains(p0 + (p1 - p0) * u);
        const s = Math.round(tt * SR), gg = env * r.uni(0.4, 1);
        for (let i = 0; i < b.length && s + i < len; i++) { L[s + i] += b[i] * gg * gl; R[s + i] += b[i] * gg * gr; }
        tt += r.exp(0.035) + 0.008;
      }
      lowpass(L, 5500); lowpass(R, 5500);
      return { L, R };
    }, 1, 0, 'skitter'));
  }
  return evLayer('skitter', list, { mode: 'int', target: lv });
}

/** dry palm fronds clattering in a gust */
function palms(seed, lv) {
  const r0 = new RNG(seed);
  const list = [];
  for (const t of periodic(r0, 14, 4)) {
    list.push(ev(t, 3.6, (r) => {
      const dur = r.uni(1.6, 3.2), len = Math.round(dur * SR);
      const L = new Float32Array(len), R = new Float32Array(len);
      const pan = r.uni(-0.7, 0.7);
      let tt = 0;
      while (tt < dur) {
        const u = tt / dur, env = Math.pow(Math.sin(Math.PI * u), 1.5);
        const b = noiseBurst(r, Math.round(r.uni(0.004, 0.012) * SR), r.uni(1400, 3800), r.uni(1, 2), r.uni(0.002, 0.005), 0.0008);
        const [gl, gr] = panGains(pan + 0.25 * r.gauss());
        const s = Math.round(tt * SR), gg = env * r.uni(0.3, 1);
        for (let i = 0; i < b.length && s + i < len; i++) { L[s + i] += b[i] * gg * gl; R[s + i] += b[i] * gg * gr; }
        tt += r.exp(0.012) + 0.002;
      }
      for (const x of [L, R]) { lowpass(x, 5000); fadeEnds(x, 0.01, 0.2); }
      return { L, R };
    }, 1, 0, 'palm'));
  }
  return evLayer('palms', list, { mode: 'int', target: lv }, { send: 0.2 });
}

const BIRDS = {
  robin(r) {
    const n = r.int(2, 4), parts = []; let t = 0;
    const f0 = r.uni(2050, 2400), f1 = f0 * r.uni(1.25, 1.42);
    for (let k = 0; k < n; k++) {
      const dur = r.uni(0.15, 0.24), kind = r.pick(['up', 'down', 'arch', 'arch']);
      const wr = r.uni(28, 45), wd = r.uni(30, 70);
      const c = kind === 'up' ? (u) => f0 + (f1 - f0) * u : kind === 'down' ? (u) => f1 - (f1 - f0) * u : (u) => f0 + (f1 - f0) * Math.sin(Math.PI * Math.pow(u, 0.8));
      parts.push({ t, buf: tone((u) => c(u) + wd * Math.sin(TAU * wr * u * dur), dur, [1, 0.12], 0.018, 0.035), g: r.uni(0.75, 1) });
      t += dur + r.uni(0.07, 0.15);
    }
    return concatAt(parts, t + 0.05);
  },
  chickadee(r) {
    const s = r.uni(0.97, 1.03);
    const fee = tone((u) => s * (4000 - 120 * u), 0.33, [1, 0.05], 0.03, 0.05);
    const bee = tone((u) => s * (3380 - 60 * u), 0.4, [1, 0.05], 0.03, 0.08);
    return concatAt([{ t: 0, buf: fee }, { t: 0.42, buf: bee, g: 0.85 }], 0.9);
  },
  cardinal(r) {
    const n = r.int(4, 6), parts = []; let t = 0;
    const hi = r.uni(3400, 3800), lo = r.uni(1800, 2100);
    for (let k = 0; k < n; k++) {
      const dur = r.uni(0.16, 0.2);
      parts.push({ t, buf: tone((u) => hi * Math.pow(lo / hi, Math.pow(u, 0.8)), dur, [1, 0.1], 0.012, 0.04), g: 1 - 0.06 * k });
      t += dur + r.uni(0.08, 0.11);
    }
    return concatAt(parts, t + 0.05);
  },
  sparrow(r) {
    const parts = []; let t = 0;
    const f = r.uni(2600, 2900);
    for (let k = 0; k < 3; k++) { parts.push({ t, buf: tone((u) => f * (1 + 0.04 * u), 0.1, [1, 0.08], 0.01, 0.03), g: 0.9 }); t += 0.22; }
    for (let k = 0; k < 6; k++) { parts.push({ t, buf: tone((u) => 4400 - 900 * u, 0.045, [1, 0.05], 0.006, 0.015), g: 0.5 }); t += 0.085; }
    parts.push({ t: t + 0.05, buf: tone((u) => 2400 - 350 * u, 0.22, [1, 0.1], 0.02, 0.06), g: 0.8 });
    return concatAt(parts, t + 0.35);
  },
  dove(r) {
    const f = r.uni(480, 520), parts = [];
    parts.push({ t: 0, buf: tone((u) => f * (0.9 + 0.22 * Math.sin(Math.PI * u * 0.5)), 0.32, [1, 0.12, 0.04], 0.06, 0.06) });
    parts.push({ t: 0.32, buf: tone((u) => f * (1.12 - 0.08 * u), 0.5, [1, 0.12, 0.04], 0.05, 0.12) });
    let t = 1.2;
    for (let k = 0; k < 3; k++) { parts.push({ t, buf: tone((u) => f * (1.0 - 0.06 * u), 0.5, [1, 0.12, 0.04], 0.08, 0.15), g: 0.85 }); t += 0.75; }
    return concatAt(parts, t + 0.2);
  },
  finch(r) { // a light warbling twitter
    const parts = []; let t = 0;
    const n = r.int(6, 10);
    for (let k = 0; k < n; k++) {
      const f = r.uni(2600, 3600), d = r.uni(0.05, 0.09);
      parts.push({ t, buf: tone((u) => f * (1 + 0.15 * Math.sin(TAU * u)), d, [1, 0.06], 0.006, 0.02), g: r.uni(0.5, 0.9) });
      t += d + r.uni(0.02, 0.06);
    }
    return concatAt(parts, t + 0.05);
  },
};
function birds(seed, plan, lv) {
  // plan: [[species, count, pan, distance 0..1, level offset dB]]
  const layers = [];
  for (const [sp, count, pan, dist, off] of plan) {
    const r = new RNG(seed + '/' + sp);
    const offs = r.uni(0, LOOP);
    const list = [];
    for (let k = 0; k < count; k++) {
      const t = wrapT(offs + (k * LOOP) / count + r.gauss() * Math.min(6, LOOP / count / 4));
      const p = clamp(pan + 0.12 * r.gauss(), -0.95, 0.95);
      const lp = 7500 - 3500 * dist;
      list.push(ev(t, 5, (rr) => lowpass(fadeEnds(BIRDS[sp](rr), 0.002, 0.01), lp), r.uni(0.8, 1), p, sp));
    }
    layers.push(evLayer('bird-' + sp, list, { mode: 'max', target: lv + (off || 0) }, { send: 0.25 + 0.6 * dist }));
  }
  return layers;
}

/** field crickets (chirps) and tree crickets (continuous trills) */
function crickets(seed, lv, o = {}) {
  const r0 = new RNG(seed);
  const procs = [];
  const n = o.n || 7;
  for (let i = 0; i < n; i++) {
    const per = r0.uni(0.42, 0.85), f = r0.uni(3600, 4600), pulses = r0.int(3, 4), pp = r0.uni(0.028, 0.036);
    const dist = r0.uni(0.2, 1), pan = r0.uni(-0.85, 0.85), g = 0.25 + 0.75 * (1 - dist);
    const act = new Curve(seed + '/act' + i, 0.03);
    procs.push(proc(seed + '/c' + i, 1 / per, 0.2, (r, t) => {
      if (act.grid(Math.round(t * 100)) < -0.6) return null; // a pause now and then
      const len = Math.round((pulses * pp + 0.03) * SR);
      const b = new Float32Array(len);
      const pl = Math.round(pp * 0.62 * SR);
      for (let k = 0; k < pulses; k++) {
        const s = Math.round(k * pp * SR), a = k === pulses - 1 ? 0.8 : 1;
        let ph = r.next();
        for (let j = 0; j < pl; j++) { const u = j / pl; b[s + j] += a * Math.sin(Math.PI * u) ** 2 * sinc1(ph); ph += (f * (1 - 0.02 * u)) / SR; }
      }
      return { dt: 0.5 + 0.06 * r.gauss(), buf: b, g: g * r.uni(0.85, 1), pan };
    }));
  }
  const layers = [slotLayer('crickets', procs, { mode: 'int', target: lv.chirps }, { filters: [['lp', 5200, 0.6]], send: 0.25 })];
  if (lv.trill != null) {
    const trills = (o.trills || [[2750, 48, -0.5], [3050, 52, 0.45]]).map(([f, pr, pan], i) => ({ f: loopFreq(f), pr: loopFreq(pr), pan, cv: new Curve(seed + '/tr' + i, 0.05) }));
    layers.push(bedLayer('tree-crickets', (a, nn) => {
      const st = new Stereo(nn);
      const m = new Float32Array(nn);
      for (const tr of trills) {
        tr.cv.fill(m, a, (v) => clamp(0.6 + 0.35 * v, 0, 1));
        const [gl, gr] = panGains(tr.pan);
        for (let i = 0; i < nn; i++) {
          const t = (a + i) / SR;
          const u = (tr.pr * t) % 1;
          const am = u < 0.55 ? Math.sin((Math.PI * u) / 0.55) ** 2 : 0;
          const y = am * m[i] * sinc1(tr.f * t);
          st.L[i] += y * gl; st.R[i] += y * gr;
        }
      }
      return st;
    }, { mode: 'int', target: lv.trill }, { send: 0.3 }));
  }
  return layers;
}

function fire(seed, lv, pan = 0.4) {
  const layers = [];
  const crackGen = (r) => {
    const n = r.int(1, 6);
    const len = Math.round(0.4 * SR);
    const b = new Float32Array(len);
    let t = 0;
    for (let k = 0; k < n && t < 0.35; k++) {
      const l = Math.round(r.uni(0.002, 0.006) * SR);
      const p = noiseBurst(r, l, r.uni(1100, 3200), 1.3, r.uni(0.0006, 0.002), 0.0003);
      const s = Math.round(t * SR), g = clamp(r.logn(0.5), 0.3, 2);
      for (let i = 0; i < l && s + i < len; i++) b[s + i] += p[i] * g;
      t += r.exp(0.05);
    }
    return { dt: r.next(), buf: lowpass(b, 3500), g: 1, pan: pan + 0.1 * r.gauss() };
  };
  layers.push(slotLayer('fire-crackle', [proc(seed + '/crk', 2.6, 0.45, crackGen)], { mode: 'peak', target: lv.crackle }, { send: 0.6 }));
  const rm = new Curve(seed + '/roar', 0.8);
  layers.push(bedLayer('fire-roar', noiseBed(seed + '/roar', 'white', [['lp', 450, 0.6], ['hp', 120, 0.6]], level(rm, 1, 0.4, 0.2, 2), { pan }), { mode: 'int', target: lv.roar }));
  return layers;
}

function harbour(seed, lv) {
  const layers = [];
  const rl = new RNG(seed + '/laps');
  const laps = periodic(rl, 2.7, 0.45).map((t) => ev(t, 2.6, (r) => {
    const dur = r.uni(1.6, 2.5), len = Math.round(dur * SR);
    const att = r.uni(0.25, 0.5), dec = r.uni(0.35, 0.6), pan = r.uni(-0.6, 0.6);
    const L = new Float32Array(len), R = new Float32Array(len);
    const sl = new SVF(400, 0.9), sr = new SVF(400, 0.9), slap = new SVF(r.uni(600, 1000), 0.9);
    const tp = att * r.uni(0.85, 1.05);
    for (let n = 0; n < len; n++) {
      const tt = n / SR;
      const e = rc(tt / att) * Math.exp(-Math.max(0, tt - att) / dec) * (1 - rc((tt - (dur - 0.2)) / 0.2));
      if (n % 16 === 0) { const fc = 160 + 1250 * Math.pow(e, 1.3); sl.set(fc, 0.9); sr.set(fc * 1.05, 0.9); }
      const wn = r.next() * 2 - 1;
      sl.process(0.7 * wn + 0.3 * (r.next() * 2 - 1)); sr.process(0.7 * wn + 0.3 * (r.next() * 2 - 1));
      slap.process(r.next() * 2 - 1);
      const s = tt > tp ? 0.5 * slap.bp * Math.exp(-(tt - tp) / 0.035) * rc((tt - tp) / 0.004) : 0;
      L[n] = sl.lp * e + s; R[n] = sr.lp * e + s;
    }
    const nb = r.int(3, 9);
    for (let k = 0; k < nb; k++) {
      const tb = r.uni(att * 0.6, att + 0.9), f0 = r.uni(260, 820), xi = r.uni(3, 10), tau = r.uni(0.012, 0.03);
      const b = tone((u) => f0 * (1 + xi * u * tau * 5), tau * 5, [1], 0.0015, tau, (u) => Math.exp(-u * 5));
      const s0 = Math.round(tb * SR), a = 0.25 * r.logn(0.5), bp = r.uni(-0.4, 0.4);
      for (let i = 0; i < b.length && s0 + i < len; i++) { L[s0 + i] += b[i] * a * (1 - bp); R[s0 + i] += b[i] * a * (1 + bp); }
    }
    const [gl, gr] = panGains(pan), gg = r.uni(0.6, 1) * 1.41;
    for (let n = 0; n < len; n++) { L[n] *= gl * gg; R[n] *= gr * gg; }
    return { L, R };
  }, 1, 0, 'lap'));
  layers.push(evLayer('laps', laps, { mode: 'int', target: lv.laps }, { filters: [['hp', 90, 0.6], ['lp', 3500, 0.6]] }));
  const sw = loopFreq(0.1), sn = new Curve(seed + '/swn', 0.08);
  layers.push(bedLayer('harbour-wash', noiseBed(seed + '/hw', 'pink', [['hp', 110, 0.6], ['lp', 750, 0.6]], (m, a) => { sn.fill(m, a); for (let i = 0; i < m.length; i++) m[i] = clamp(1 + 0.3 * Math.sin(TAU * sw * ((a + i) / SR)) + 0.15 * m[i], 0.3, 2); }), { mode: 'int', target: lv.wash }));
  // gulls: sparse bouts
  const rg = new RNG(seed + '/gulls');
  const gulls = [];
  [LOOP * rg.uni(0.05, 0.15), LOOP * rg.uni(0.38, 0.48), LOOP * rg.uni(0.68, 0.8)].forEach((tb, bi) => {
    const pan = bi % 2 ? rg.uni(0.3, 0.7) : rg.uni(-0.7, -0.3);
    let t = tb;
    const n = rg.int(3, 5);
    for (let k = 0; k < n; k++) {
      const long = k === 0;
      gulls.push(ev(t, 0.7, (r) => {
        const dur = long ? r.uni(0.42, 0.55) : r.uni(0.24, 0.34);
        const f0 = r.uni(650, 780), fp = f0 * r.uni(1.45, 1.65), fe = f0 * r.uni(1.05, 1.2);
        const harm = [1, 0.8, 0.55, 0.38, 0.22, 0.12, 0.06].map((a) => a * r.uni(0.8, 1.2));
        const ras = r.uni(48, 70);
        const c = (u) => (u < 0.22 ? f0 + (fp - f0) * rc(u / 0.22) : fp + (fe - fp) * rc((u - 0.22) / 0.78));
        return lowpass(tone(c, dur, harm, 0.03, 0.08, (u) => 0.75 + 0.25 * Math.sin(TAU * ras * u * dur)), 3200);
      }, (long ? 1 : 0.8) * rg.uni(0.8, 1), pan, 'gull'));
      t += rg.uni(0.38, 0.6);
    }
  });
  layers.push(evLayer('gulls', gulls, { mode: 'max', target: lv.gulls }, { send: 0.9 }));
  // rigging: halyards tapping aluminium masts
  const rr = new RNG(seed + '/rig');
  const masts = [{ f: 1180, pan: -0.5, g: 1 }, { f: 1490, pan: 0.35, g: 0.75 }, { f: 930, pan: 0.7, g: 0.6 }];
  const rig = [];
  for (const t of poisson(rr, 0.32)) {
    const m = rr.pick(masts);
    const hits = rr.chance(0.4) ? 2 : 1;
    for (let h = 0; h < hits; h++) {
      const f = m.f * (1 + 0.006 * rr.gauss());
      rig.push(ev(t + h * rr.uni(0.07, 0.13), 1.45, (r) => {
        const len = Math.round(1.4 * SR), b = new Float32Array(len);
        for (const [ra, a, tau] of [[1, 1, 0.55], [1.004, 0.5, 0.5], [2.756, 0.35, 0.18], [5.404, 0.1, 0.06]]) {
          const inc = (f * ra) / SR, k = Math.exp(-1 / (tau * SR)); let e = a, ph = 0;
          for (let n = 0; n < len; n++) { b[n] += e * sinc1(ph); ph += inc; e *= k; }
        }
        const ck = new OnePole(2200);
        for (let n = 0; n < len; n++) { const tt = n / SR; b[n] = (b[n] + 0.6 * ck.process(r.next() * 2 - 1) * Math.exp(-tt / 0.0015)) * rc(tt / 0.0006) * (1 - rc((tt - 1.2) / 0.2)); }
        return lowpass(b, 5500);
      }, m.g * (h ? 0.45 : 1) * rr.logn(0.25), m.pan, 'rig'));
    }
  }
  layers.push(evLayer('rigging', rig, { mode: 'max', target: lv.rigging }, { send: 0.5 }));
  return layers;
}

// ---------------------------------------------------------------- city
function city(seed, lv, o = {}) {
  const layers = [];
  const sw = new Curve(seed + '/hum', 0.05);
  layers.push(bedLayer('city-hum', noiseBed(seed + '/hum', 'pink', [['lp', o.humLp || 260, 0.6], ['hp', 32, 0.7]], level(sw, 1, 0.15, 0.6, 1.4), { corr: 0.5 }), { mode: 'int', target: lv.hum }));
  if (lv.wash != null) layers.push(bedLayer('city-wash', noiseBed(seed + '/wash', 'pink', [['hp', 250, 0.6], ['lp', o.washLp || 1400, 0.6]], level(new Curve(seed + '/wsh', 0.08), 1, 0.25, 0.4, 1.6)), { mode: 'int', target: lv.wash }));
  if (lv.traffic != null) {
    const r0 = new RNG(seed + '/cars');
    const cars = [];
    let t = r0.uni(0, 8);
    while (t < LOOP) {
      const dur = r0.uni(4, 8), dir = r0.chance(0.5) ? 1 : -1, g = r0.uni(0.4, 1), bright = r0.uni(700, 1300);
      cars.push(ev(t, dur + 0.1, (r) => {
        const len = Math.round(dur * SR);
        const L = new Float32Array(len), R = new Float32Array(len);
        const sa = new SVF(bright, 0.6), sb = new SVF(bright, 0.6), hiss = new SVF(2200, 0.7);
        let hp = r.next();
        const hum = r.uni(48, 70);
        for (let n = 0; n < len; n++) {
          const u = n / len;
          const e = Math.pow(Math.sin(Math.PI * u), 2.2);
          const w = r.next() * 2 - 1;
          sa.process(w); sb.process(0.6 * w + 0.4 * (r.next() * 2 - 1)); hiss.process(w);
          const pan = dir * (-0.85 + 1.7 * u);
          const [gl, gr] = panGains(pan);
          hp += hum * (1 + 0.04 * (0.5 - u) * dir) / SR;
          const y = e * (sa.lp + 0.12 * hiss.bp + 0.2 * sinc1(hp));
          const y2 = e * (sb.lp + 0.12 * hiss.bp + 0.2 * sinc1(hp));
          L[n] = y * gl; R[n] = y2 * gr;
        }
        return { L, R };
      }, g, 0, 'car'));
      t += r0.uni(o.carEvery ? o.carEvery[0] : 5, o.carEvery ? o.carEvery[1] : 16);
    }
    layers.push(evLayer('traffic', cars, { mode: 'int', target: lv.traffic }, { filters: [['hp', 40, 0.7], ['lp', o.carLp || 2400, 0.6]], send: 0.25 }));
  }
  return layers;
}

// ---------------------------------------------------------------- fireworks
function boomGen(sh, o) {
  return (r) => {
    const near = clamp(sh.depth == null ? 0.5 : sh.depth, 0, 1);
    const size = clamp((sh.R || 22) / 30, 0.5, 1.4);
    const len = Math.round(4 * SR);
    const L = new Float32Array(len), R = new Float32Array(len);
    const crackLp = (o.far ? 900 : 1500) + 900 * near;
    // the report: a band-limited burst
    const crack = new Float32Array(len), body = new Float32Array(len);
    const tc = r.uni(0.025, 0.05) * (0.8 + 0.4 * size);
    for (let n = 0; n < Math.round(0.4 * SR); n++) { const t = n / SR; crack[n] = (r.next() * 2 - 1) * rc(t / 0.0015) * Math.exp(-t / tc); }
    chain(crack, [['lp', crackLp, 0.7], ['hp', 120, 0.7], ['peak', 400, 0.8, 3]]);
    // the thump: a falling low sine
    let ph = 0;
    for (let n = 0; n < Math.round(0.9 * SR); n++) { const t = n / SR; const f = 42 + 40 * Math.exp(-t / 0.05); ph += f / SR; body[n] = sinc1(ph) * rc(t / 0.004) * Math.exp(-t / (0.16 + 0.1 * size)) * (1 - rc((t - 0.75) / 0.15)); }
    // rolling echo off the buildings
    const tail = new Float32Array(len);
    const dec = r.uni(0.7, 1.4) * (0.8 + 0.4 * size);
    for (let n = 0; n < len; n++) { const t = n / SR; tail[n] = (r.next() * 2 - 1) * rc(t / 0.06) * Math.exp(-t / dec) * (1 - rc((t - 3.4) / 0.6)); }
    chain(tail, [['lp', 380, 0.6], ['lp', 500, 0.6], ['hp', 45, 0.7]]);
    const echoes = [[r.uni(0.18, 0.35), 0.35], [r.uni(0.5, 0.9), 0.2]];
    for (let n = 0; n < len; n++) {
      let y = crack[n] * 1.0 + body[n] * 0.55 * size + tail[n] * 0.9;
      for (const [d, g] of echoes) { const j = n - Math.round(d * SR); if (j >= 0) y += crack[j] * g; }
      L[n] = y; R[n] = y;
    }
    // crackle shells: a patter of small pops after the break
    if (sh.type === 'crackle' || sh.type === 'willow') {
      const willow = sh.type === 'willow';
      const t0 = r.uni(0.4, 0.7), dur = willow ? 2.4 : r.uni(1.2, 1.9);
      let t = t0;
      while (t < t0 + dur && t < 3.8) {
        const u = (t - t0) / dur;
        const p = noiseBurst(r, Math.round(0.004 * SR), r.uni(1500, 3600), 1.4, willow ? 0.0012 : 0.0009, 0.0003);
        const g = (willow ? 0.06 : 0.16) * (1 - u) * r.uni(0.5, 1), pan = 0.6 * r.gauss() * 0.5;
        const [gl, gr] = panGains(pan);
        const s = Math.round(t * SR);
        for (let i = 0; i < p.length && s + i < len; i++) { L[s + i] += p[i] * g * gl * 1.4; R[s + i] += p[i] * g * gr * 1.4; }
        t += r.exp(willow ? 0.012 : 0.02 + 0.03 * u);
      }
    }
    for (const x of [L, R]) { lowpass(x, o.far ? 2600 : 4200); fadeEnds(x, 0.001, 0.2); }
    return { L, R };
  };
}
function fireworks(seed, shells, lv, o = {}) {
  const list = shells.map((sh, i) => {
    const delay = (o.delay || 0.18) + (o.far ? 0.25 : 0.35) * (1 - (sh.depth == null ? 0.5 : sh.depth));
    const g = (0.55 + 0.45 * (sh.depth == null ? 0.5 : sh.depth)) * clamp((sh.R || 22) / 26, 0.6, 1.3) * (sh.far ? 0.6 : 1);
    const pan = clamp(((sh.x == null ? 300 : sh.x) - 240) / 300, -0.75, 0.75);
    return ev(sh.t + delay, 4.1, (r) => { const b = boomGen(sh, o)(r); const [gl, gr] = panGains(pan); for (let n = 0; n < b.L.length; n++) { b.L[n] *= gl * 1.41; b.R[n] *= gr * 1.41; } return b; }, g, 0, 'boom' + i);
  });
  return evLayer('fireworks', list, { mode: 'max', target: lv }, { send: o.send == null ? 0.7 : o.send });
}
function firecrackers(seed, lv) {
  const r0 = new RNG(seed);
  const list = [];
  for (const t of periodic(r0, 38, 9)) {
    list.push(ev(t, 6, (r) => {
      const dur = r.uni(2, 4.5), len = Math.round((dur + 0.5) * SR);
      const L = new Float32Array(len), R = new Float32Array(len);
      const pan = r.uni(-0.6, 0.6);
      let tt = 0.02;
      while (tt < dur) {
        const p = noiseBurst(r, Math.round(0.006 * SR), r.uni(900, 2600), 0.8, r.uni(0.0008, 0.0016), 0.0003);
        const [gl, gr] = panGains(pan + 0.15 * r.gauss());
        const s = Math.round(tt * SR), g = r.uni(0.4, 1) * (tt > dur - 0.6 ? (dur - tt) / 0.6 : 1);
        for (let i = 0; i < p.length; i++) { L[s + i] += p[i] * g * gl; R[s + i] += p[i] * g * gr; }
        tt += r.chance(0.12) ? r.uni(0.15, 0.4) : r.exp(0.05) + 0.012;
      }
      for (const x of [L, R]) { chain(x, [['lp', 2600, 0.6], ['hp', 200, 0.7]]); fadeEnds(x, 0.001, 0.1); }
      return { L, R };
    }, r0.uni(0.6, 1), 0, 'cracker'));
  }
  return evLayer('firecrackers', list, { mode: 'max', target: lv }, { send: 0.8 });
}
function sparklers(seed, lv, pan = 0.3) {
  const on = new Curve(seed + '/on', 0.02);
  const gen = (r, t) => {
    const a = on.grid(Math.round(t * 100));
    if (a < -0.3 || !r.chance(clamp(0.5 + 0.6 * a, 0, 1))) return null;
    const len = Math.round(r.uni(0.003, 0.007) * SR);
    return { dt: r.next(), buf: noiseBurst(r, len, r.uni(2400, 5200), 1.8, r.uni(0.0008, 0.002), 0.0003), g: r.logn(0.5), pan: pan + 0.3 * r.gauss() };
  };
  return slotLayer('sparklers', [proc(seed + '/spk', 70, 0.01, gen)], { mode: 'int', target: lv }, { filters: [['lp', 6000, 0.6], ['hp', 1200, 0.6]], send: 0.3 });
}

// ---------------------------------------------------------------- people
/** far crowd: a babble bed with drifting vowel colour */
function crowdBed(seed, lv, o = {}) {
  const sw = new Curve(seed + '/cs', 0.06);
  const f1 = new Curve(seed + '/f1', 0.5), f2 = new Curve(seed + '/f2', 0.6);
  return bedLayer('crowd', (a, n) => {
    const st = noiseBed(seed + '/cb', 'pink', [['hp', 220, 0.6], ['lp', o.lp || 1800, 0.6]], level(sw, 1, 0.2, 0.5, 1.6))(a, n);
    // a little vowel movement (two slow formant bumps)
    for (const x of [st.L, st.R]) {
      const s1 = new SVF(600, 2), s2 = new SVF(1200, 2.5);
      for (let i = 0; i < n; i++) {
        if (i % 64 === 0) { const t = (a + i) / SR; s1.set(520 + 140 * f1.grid(Math.round(t * 100)), 2); s2.set(1150 + 250 * f2.grid(Math.round(t * 100)), 2.5); }
        s1.process(x[i]); s2.process(x[i]);
        x[i] = 0.6 * x[i] + 0.5 * s1.bp + 0.35 * s2.bp;
      }
    }
    return st;
  }, { mode: 'int', target: lv }, { send: 0.5 });
}
/** people talking now and then (wordless), with laughs; `people` kinds; returns an events layer */
function chatter(seed, lv, o = {}) {
  const r0 = new RNG(seed);
  const who = (o.people || ['woman', 'woman', 'man', 'woman']).map((k) => ({ ...person(r0, k), pan: r0.uni(-0.5, 0.5) + (o.pan || 0) }));
  const list = [];
  let t = r0.uni(0, 3);
  let cur = 0;
  while (t < LOOP - 1) {
    if (o.skip && o.skip(t)) { t += 2; continue; }
    if (r0.chance(o.laugh || 0.12)) {
      const n = r0.int(1, Math.min(3, who.length));
      for (let k = 0; k < n; k++) { const w = who[(cur + k) % who.length]; list.push(ev(t + k * r0.uni(0.1, 0.4), 1.6, (r) => laugh(r, w), r0.uni(0.7, 1), w.pan, 'laugh')); }
      t += r0.uni(1.5, 3);
      continue;
    }
    cur = r0.chance(0.6) ? (cur + 1 + r0.int(0, who.length - 2)) % who.length : cur;
    const w = who[cur];
    const nPh = r0.int(1, 3);
    for (let k = 0; k < nPh; k++) {
      const q = r0.chance(0.15);
      const dur = 4.5;
      list.push(ev(t, dur, (r) => speech(r, w, { min: 3, max: 10, question: q }), r0.uni(0.7, 1), w.pan, 'talk'));
      t += r0.uni(1.0, 2.4);
    }
    t += r0.uni(o.gap ? o.gap[0] : 0.3, o.gap ? o.gap[1] : 2.5);
  }
  return evLayer(o.name || 'chatter', list, { mode: 'int', target: lv }, { filters: [['hp', 140, 0.7], ['lp', o.lp || 2600, 0.6]], send: o.send == null ? 0.5 : o.send });
}

// ---------------------------------------------------------------- scenes
const firstWin = (S, k, def) => (S && S[k] && S[k][0]) || def;

/**
 * The scene of an entry: layers and the reverb of its space.
 * music: the composed score (key, chords) for in-key elements (carol hum).
 */
export function scene(ed, pic, music) {
  EVN = 0;
  const seed = 'purrfect-year/v2/amb/' + ed.id;
  const S = pic.story || {};
  const L = [];
  let verb = { rt60: 1.4, damp: 3500, size: 1.2, ret: 0.5 };
  let busTarget = -23.5;
  const fwShells = pic.fireworks || [];
  switch (ed.id) {
    case 'diwali': {
      L.push(...city(seed + '/city', { hum: -33, wash: -37, traffic: -38 }, { carEvery: [10, 24] }));
      L.push(sparklers(seed + '/spark', -36, 0.35));
      if (fwShells.length) L.push(fireworks(seed + '/fw', fwShells, -27, { far: true }));
      L.push(...wind(seed + '/w', { body: -40, leaves: -42 }, { mean: 0.4 }).layers);
      verb = { rt60: 1.6, damp: 3200, size: 1.3, ret: 0.55 };
      busTarget = -24.5;
      break;
    }
    case 'halloween25':
    case 'halloween': {
      const alone = ed.id === 'halloween';
      L.push(...rain(seed + '/rain', { wash: -25, drops: -30, rumble: -33, drips: -26.5 }, alone ? { dripPoints: [{ every: 1.9, jit: 0.15, f: 1320, pan: 0.3, g: 1 }, { every: 3.3, jit: 0.4, f: 1040, pan: -0.45, g: 0.6 }] } : {}));
      if (pic.lightning && pic.lightning.length) L.push(thunder(seed + '/th', pic.lightning, -23));
      L.push(...wind(seed + '/w', { body: -38 }, { mean: 0.45, depth: 0.3 }).layers);
      verb = { rt60: 1.6, damp: 3000, size: 1.1, ret: 0.55 };
      busTarget = -21;
      break;
    }
    case 'thanksgiving': {
      const w = wind(seed + '/w', { body: -31, leaves: -33 }, { mean: 0.55, depth: 0.3 });
      L.push(...w.layers);
      L.push(...fire(seed + '/fire', { crackle: -29, roar: -40 }, 0.45));
      L.push(chatter(seed + '/talk', -34, { people: ['woman', 'woman', 'man', 'woman'], pan: 0.35, laugh: 0.14, lp: 2400 }));
      verb = { rt60: 1.2, damp: 3500, size: 1.3, ret: 0.45 };
      busTarget = -23;
      break;
    }
    case 'christmas': {
      const hush = new Curve(seed + '/hush', 0.04);
      L.push(bedLayer('snow-hush', noiseBed(seed + '/hush', 'pink', [['lp', 650, 0.6], ['hp', 60, 0.7]], level(hush, 1, 0.2, 0.5, 1.5), { corr: 0.2 }), { mode: 'int', target: -32 }));
      L.push(...city(seed + '/city', { hum: -36 }, { humLp: 200 }));
      L.push(carolHum(seed + '/carol', -29, music));
      verb = { rt60: 1.5, damp: 2800, size: 1.4, ret: 0.6 };
      busTarget = -24.5;
      break;
    }
    case 'newyear': {
      L.push(crowdBed(seed + '/crowd', -31, { lp: 1600 }));
      L.push(...city(seed + '/city', { hum: -35 }));
      if (fwShells.length) L.push(fireworks(seed + '/fw', fwShells, -23.5, {}));
      L.push(sparklers(seed + '/spark', -40, -0.3));
      const cheers = [];
      const salvos = pic.salvos && pic.salvos.length ? pic.salvos : [60, 180];
      salvos.forEach((ts, i) => {
        const big = i === salvos.length - 1; // the midnight salvo: the big one
        const r0 = new RNG(seed + '/ch' + i);
        const people = Array.from({ length: big ? 10 : 6 }, (_, k) => person(r0, k % 3 === 2 ? 'man' : 'woman'));
        cheers.push(ev(ts + 0.9, 12.2, (r) => cheer(r, 12, people, { spread: 0.8, calls: [1, 3], claps: big ? 9 : 5, clapAt: 0.8, clapDur: 7, swell: big ? 0.5 : 0.28, rise: 0.7, lp: 2400, stagger: 0.12 }), big ? 1 : 0.6, 0, 'cheer'));
      });
      if (pic.logo) {
        const r0 = new RNG(seed + '/logo');
        const people = Array.from({ length: 6 }, (_, k) => person(r0, k % 2 ? 'man' : 'woman'));
        cheers.push(ev(pic.logo[0] + 1.4, 8.2, (r) => cheer(r, 8, people, { spread: 0.7, calls: [1, 2], claps: 6, clapAt: 1, clapDur: 5, swell: 0.25, lp: 2300 }), 0.55, 0, 'logo-cheer'));
      }
      L.push(evLayer('cheers', cheers, { mode: 'max', target: -25 }, { send: 0.7 }));
      verb = { rt60: 1.8, damp: 3000, size: 1.5, ret: 0.6 };
      busTarget = -22.5;
      break;
    }
    case 'lunar': {
      L.push(...wind(seed + '/w', { body: -33 }, { mean: 0.45, depth: 0.25, lo: 180, hi: 1100 }).layers);
      L.push(firecrackers(seed + '/fc', -29));
      if (fwShells.length) L.push(fireworks(seed + '/fw', fwShells, -27, { far: true }));
      L.push(...city(seed + '/city', { hum: -37 }));
      verb = { rt60: 1.7, damp: 3000, size: 1.4, ret: 0.6 };
      busTarget = -24;
      break;
    }
    case 'easter': {
      L.push(...birds(seed + '/birds', [['robin', 9, -0.45, 0.25, 0], ['chickadee', 3, 0.55, 0.45, -2], ['cardinal', 2, 0.2, 0.55, -1], ['sparrow', 3, -0.15, 0.6, -3], ['dove', 2, 0.65, 0.85, -6], ['finch', 4, 0.1, 0.5, -4]], -25));
      L.push(...wind(seed + '/w', { body: -31, leaves: -33 }, { mean: 0.55, depth: 0.28, lo: 260, hi: 1400 }).layers);
      L.push(...city(seed + '/city', { hum: -39 }));
      verb = { rt60: 1.1, damp: 4500, size: 1.4, ret: 0.5 };
      busTarget = -23.5;
      break;
    }
    case 'midsummer': {
      L.push(...crickets(seed + '/cr', { chirps: -31, trill: -35 }, { n: 7 }));
      L.push(...fire(seed + '/fire', { crackle: -29, roar: -40 }, 0.4));
      L.push(...wind(seed + '/w', { body: -39 }, { mean: 0.4 }).layers);
      L.push(chatter(seed + '/talk', -38, { people: ['woman', 'woman', 'man', 'woman'], pan: 0.3, laugh: 0.12, lp: 2200, gap: [1.5, 6] }));
      verb = { rt60: 1.3, damp: 3800, size: 1.3, ret: 0.5 };
      busTarget = -24;
      break;
    }
    case 'match': {
      const [g0, g1] = firstWin(S, 'goal', [150, 158]);
      L.push(...crickets(seed + '/cr', { chirps: -34, trill: -38 }, { n: 5 }));
      L.push(...tvMatch(seed + '/tv', -30, g0, g1));
      L.push(chatter(seed + '/plaza', -38, { people: ['woman', 'woman', 'man', 'woman'], pan: 0.35, laugh: 0.1, lp: 2200, gap: [2, 7], name: 'plaza-talk', skip: (t) => t > g0 - 1 && t < g1 + 4 }));
      const r0 = new RNG(seed + '/goal');
      const people = Array.from({ length: 5 }, (_, k) => person(r0, k === 2 ? 'man' : k === 4 ? 'child' : 'woman'));
      L.push(evLayer('goal-cheer', [ev(g0 + 0.5, 9.2, (r) => cheer(r, 9, people, { spread: 0.6, calls: [2, 3], claps: 5, clapAt: 1.2, clapDur: 6, lp: 3000, stagger: 0.15 }), 1, 0.3, 'goal')], { mode: 'max', target: -25 }, { send: 0.5 }));
      if (fwShells.length) L.push(fireworks(seed + '/fw', fwShells, -27, {}));
      verb = { rt60: 1.2, damp: 3800, size: 1.3, ret: 0.5 };
      busTarget = -23;
      break;
    }
    case 'nyc': {
      L.push(...city(seed + '/city', { hum: -29, wash: -31, traffic: -30 }, { carEvery: [3, 9], washLp: 1600 }));
      if (fwShells.length) L.push(fireworks(seed + '/fw', fwShells, -24, {}));
      verb = { rt60: 1.6, damp: 3200, size: 1.6, ret: 0.55 };
      busTarget = -22.5;
      break;
    }
    case 'la': {
      L.push(...wind(seed + '/w', { body: -32, leaves: -36 }, { mean: 0.5, depth: 0.3, lo: 200, hi: 1200 }).layers);
      L.push(palms(seed + '/palms', -33));
      L.push(...city(seed + '/city', { hum: -35, traffic: -33 }, { carEvery: [6, 15], carLp: 1800 }));
      L.push(...birds(seed + '/birds', [['dove', 3, 0.6, 0.8, -4], ['finch', 4, -0.4, 0.55, -3]], -28));
      verb = { rt60: 0.9, damp: 4500, size: 1.2, ret: 0.4 };
      busTarget = -24;
      break;
    }
    case 'sandiego': {
      L.push(...harbour(seed + '/hb', { laps: -26.5, wash: -29, gulls: -28, rigging: -28 }));
      L.push(...wind(seed + '/w', { body: -32 }, { mean: 0.6, depth: 0.3, lo: 200, hi: 900 }).layers);
      verb = { rt60: 0.9, damp: 4000, size: 1.5, ret: 0.45 };
      busTarget = -22.5;
      break;
    }
    case 'dc': {
      const [c0] = firstWin(S, 'candlesOut', [100, 112]);
      L.push(...crickets(seed + '/cr', { chirps: -31, trill: -34 }, { n: 8 }));
      L.push(...birds(seed + '/birds', [['robin', 3, -0.5, 0.6, -2], ['cardinal', 1, 0.5, 0.7, -3]], -30));
      L.push(...city(seed + '/city', { hum: -40, traffic: -40 }, { carEvery: [15, 35] }));
      const r0 = new RNG(seed + '/party');
      const fam = ['man', 'woman', 'man', 'woman', 'child', 'man'].map((k) => person(r0, k));
      L.push(evLayer('family-cheer', [ev(c0 + 0.15, 10.2, (r) => cheer(r, 10, fam, { spread: 0.55, calls: [1, 3], claps: 6, clapAt: 0.6, clapDur: 8, lp: 3200, stagger: 0.1 }), 1, -0.25, 'candles')], { mode: 'max', target: -24 }, { send: 0.35 }));
      L.push(chatter(seed + '/talk', -37, { people: ['man', 'woman', 'man', 'woman'], pan: -0.25, laugh: 0.15, lp: 2600, gap: [1.5, 5], skip: (t) => t > c0 - 3 && t < c0 + 12 }));
      verb = { rt60: 1.0, damp: 4200, size: 1.2, ret: 0.4 };
      busTarget = -23;
      break;
    }
    case 'home': {
      L.push(...crickets(seed + '/cr', { chirps: -32, trill: -35 }, { n: 6 }));
      L.push(...birds(seed + '/birds', [['robin', 4, 0.4, 0.6, 0], ['dove', 1, -0.6, 0.85, -5]], -30));
      L.push(...city(seed + '/city', { hum: -35, traffic: -39 }, { carEvery: [12, 30] }));
      verb = { rt60: 1.2, damp: 3800, size: 1.3, ret: 0.5 };
      busTarget = -24;
      break;
    }
    case 'harvest': {
      L.push(...wind(seed + '/w', { body: -29, leaves: -32 }, { mean: 0.55, depth: 0.32, lo: 180, hi: 1200, leafRate: 140 }).layers);
      L.push(skitter(seed + '/sk', -31));
      L.push(...fire(seed + '/fire', { crackle: -36, roar: -46 }, -0.55));
      L.push(...city(seed + '/city', { hum: -38 }));
      verb = { rt60: 1.4, damp: 3500, size: 1.4, ret: 0.5 };
      busTarget = -23.5;
      break;
    }
    default:
      L.push(...city(seed + '/city', { hum: -34 }));
  }
  // a faint air tone under every scene (never digital silence)
  L.push(bedLayer('air', noiseBed(seed + '/air', 'pink', [['hp', 80, 0.7], ['lp', 1800, 0.6]], null, { corr: 0.3 }), { mode: 'int', target: -46 }));
  return { layers: L, verb, busTarget };
}

/** carolers in the plaza, far off: an original hymn-like tune hummed in the music's key, twice a loop */
function carolHum(seed, lv, music) {
  const r0 = new RNG(seed);
  const { barDur, chords, scalePcs, plan } = music;
  const beat = barDur / 4;
  // the passes: the first two 'theme' sections (or any two 8-bar sections)
  const secs = plan.filter((s) => s.type === 'theme').slice(0, 2);
  const voices = [person(r0, 'woman'), person(r0, 'man'), person(r0, 'woman')];
  const list = [];
  const chordAt = (b) => chords.find((c) => b >= c.bar && b < c.bar + c.bars) || chords[0];
  const near = (m, pcs) => { let best = m, bd = 99; for (let x = m - 6; x <= m + 6; x++) if (pcs.includes(((x % 12) + 12) % 12) && Math.abs(x - m) < bd) { bd = Math.abs(x - m); best = x; } return best; };
  // one tune for the whole loop: 8 bars of half and quarter notes, stepwise, ending on the tonic
  const rhythm = [[2, 1, 1], [2, 2], [1, 1, 2], [4], [2, 1, 1], [2, 2], [1, 1, 1, 1], [4]];
  for (const sec of secs) {
    const tune = [];
    let m = 67 + ((scalePcs[0] - 67) % 12 + 12) % 12 + (scalePcs[0] > 7 ? -12 : 0);
    let deg = 0;
    rhythm.forEach((bar, bi) => {
      const b = sec.bar + bi;
      const ch = chordAt(b);
      const cps = ch.ivs.map((iv) => (ch.root + iv) % 12);
      bar.forEach((q, k) => {
        if (bi === 7) { tune.push({ midi: near(m, [scalePcs[0]]), d: q * beat }); return; }
        const step = r0.pick([1, 1, -1, -1, 2, -2, 0]);
        deg += step;
        let x = m;
        const dir = step >= 0 ? 1 : -1;
        for (let s = 0; s < Math.abs(step); s++) { x += dir; while (!scalePcs.includes(((x % 12) + 12) % 12)) x += dir; }
        if (k === 0) x = near(x, cps);
        if (x > 74) x -= 12; if (x < 60) x += 12;
        m = x;
        tune.push({ midi: x, d: q * beat });
      });
    });
    const t0 = sec.bar * barDur;
    // melody, a third below (in the scale), a low hum on the chord roots
    const third = tune.map((n) => { let x = n.midi - 3; while (!scalePcs.includes(((x % 12) + 12) % 12)) x--; return { midi: x, d: n.d }; });
    const roots = rhythm.map((_, bi) => ({ midi: 48 + ((chordAt(sec.bar + bi).root - 48) % 12 + 12) % 12, d: barDur }));
    const parts = [[tune, voices[0], 0.25, 1], [third, voices[2], -0.15, 0.7], [roots, voices[1], 0.05, 0.6]];
    for (const [notes, who, pan, g] of parts) {
      const dur = notes.reduce((s, n) => s + n.d, 0);
      list.push(ev(t0 + 0.02, dur + 0.3, (r) => hum(notes, who, r, 'm'), g, pan, 'carol'));
    }
  }
  return evLayer('carol', list, { mode: 'int', target: lv }, { filters: [['hp', 150, 0.7], ['lp', 1900, 0.6]], send: 0.9 });
}

/** the match on TV through the open balcony door: a wordless commentator and a stadium bed; the goal lifts both */
function tvMatch(seed, lv, g0, g1) {
  const r0 = new RNG(seed);
  const caster = { ...person(r0, 'man'), pan: 0.15 };
  const list = [];
  let t = 0.5;
  while (t < LOOP - 2) {
    const goal = t >= g0 - 0.5 && t < g1 + 2;
    const ex = goal ? 1 : r0.chance(0.12) ? 0.35 : 0;
    const dur = goal ? 7 : 4.5;
    list.push(ev(t, dur, (r) => speech(r, caster, { min: goal ? 10 : 3, max: goal ? 18 : 10, excite: ex, peak: goal ? 0.6 : 0.45 }), goal ? 1.4 : 1, caster.pan, 'cast'));
    t += goal ? r0.uni(3, 4.5) : r0.uni(1.6, 4.2);
    if (r0.chance(0.25)) t += r0.uni(2, 5);
  }
  // stadium: a soft roar with a swell at the goal
  const stadium = (gen) => ev(g0 - 0.2, 12.5, gen, 1, 0.1, 'stadium');
  list.push(stadium((r) => {
    const len = Math.round(12 * SR), L = new Float32Array(len), R = new Float32Array(len);
    for (let i = 0; i < len; i++) { L[i] = r.next() * 2 - 1; R[i] = r.next() * 2 - 1; }
    for (const x of [L, R]) chain(x, [['bp', 900, 0.5], ['peak', 1300, 1, 4]]);
    for (let i = 0; i < len; i++) { const tt = i / SR; const e = 0.9 * rc(tt / 0.9) * (1 - rc((tt - 6) / 5.5)) * (0.9 + 0.1 * Math.sin(TAU * 3 * tt)); L[i] *= e; R[i] *= e; }
    return { L, R };
  }));
  const L = evLayer('tv', list, { mode: 'int', target: lv }, { filters: [['hp', 320, 0.7], ['lp', 3400, 0.7], ['peak', 1500, 1, 2]], send: 0.35 });
  // the steady crowd under the commentary
  const swell = new Curve(seed + '/sw', 0.05);
  const bed = bedLayer('tv-crowd', noiseBed(seed + '/crowd', 'pink', [['hp', 380, 0.7], ['lp', 2600, 0.7], ['peak', 1100, 1, 3]], level(swell, 1, 0.25, 0.5, 1.5), { corr: 0.85, pan: 0.15 }), { mode: 'int', target: lv - 7 });
  return [L, bed];
}
