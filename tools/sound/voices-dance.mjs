// Synthesised instruments of the dance styles (melodic house, future-bass-lite,
// chill / tropical house). Same contract as voices.mjs: one note or hit per
// call, mono Float32Array or {L, R}, band-limited (wavetables whose partials
// stop well below Nyquist, filtered noise), raised-cosine attacks, exact-zero
// ends, randomness only from the event's own RNG. p.need (samples) lets the
// engine stop rendering a long note once it has passed the window it needs.
import { SR, mtof, rc, clamp, makeTable, tabRead, SVF, OnePole, bq, runBQ, sinc1 } from './dsp.mjs';

const TABS = new Map();
const lenOf = (sec, p) => Math.max(64, Math.min(Math.ceil(sec * SR), p && p.need ? p.need : Infinity));

/** band-limited sawtooth cycle for a note: 1/h partials, softly tapered from `soft` Hz to `top` Hz */
function sawTable(midi, soft = 4200, top = 8500) {
  const key = 'saw:' + midi + ':' + soft + ':' + top;
  let t = TABS.get(key);
  if (t) return t;
  const f = mtof(midi);
  const amps = [];
  for (let h = 1; h * f < top; h++) {
    const fh = h * f;
    amps.push((1 / h) * (fh < soft ? 1 : 1 - rc((fh - soft) / (top - soft))));
  }
  t = makeTable(amps);
  let pk = 0;
  for (let i = 0; i < t.length; i++) pk = Math.max(pk, Math.abs(t[i]));
  for (let i = 0; i < t.length; i++) t[i] /= pk;
  TABS.set(key, t);
  return t;
}
/** soft square-ish cycle (odd partials) for plucks that should sound rounder */
function squareTable(midi, top = 7000) {
  const key = 'sq:' + midi + ':' + top;
  let t = TABS.get(key);
  if (t) return t;
  const f = mtof(midi);
  const amps = [];
  for (let h = 1; h * f < top; h++) amps.push(h % 2 ? (1 / h) * (h * f > top * 0.5 ? 1 - rc((h * f - top * 0.5) / (top * 0.5)) : 1) : 0.08 / h);
  t = makeTable(amps);
  let pk = 0;
  for (let i = 0; i < t.length; i++) pk = Math.max(pk, Math.abs(t[i]));
  for (let i = 0; i < t.length; i++) t[i] /= pk;
  TABS.set(key, t);
  return t;
}

// ---------------------------------------------------------------- chords
/**
 * Supersaw-style chord (stereo): per note five detuned band-limited saws
 * spread across the field, a slow attack and a raised-cosine release. A gentle
 * per-note lowpass keeps the top silky. p: {notes, vel, hold, att, rel, det, lp}
 */
export function saw(p, r) {
  const notes = p.notes, hold = p.hold, att = p.att || 0.02, rel = p.rel || 0.3;
  const len = lenOf(hold + rel, p);
  const L = new Float32Array(len), R = new Float32Array(len);
  const env = new Float32Array(len);
  const aN = Math.max(1, att * SR), n0 = Math.round(hold * SR), nr = Math.max(1, Math.round(rel * SR));
  for (let n = 0; n < len; n++) env[n] = (n < aN ? rc(n / aN) : 1) * (n > n0 ? 1 - rc((n - n0) / nr) : 1);
  const spread = p.det || 12; // cents
  const voices = [[-1, 0.8, -0.85], [-0.45, 0.95, 0.6], [0, 1, 0], [0.45, 0.95, -0.6], [1, 0.8, 0.85]];
  notes.forEach((m, j) => {
    const tab = sawTable(m, p.soft || 3800, p.top || 8000);
    const f = mtof(m);
    const g = (p.vel / Math.sqrt(notes.length)) * (1 - 0.05 * j) / 3.2;
    for (const [dc, a, pan] of voices) {
      const inc = (f * Math.pow(2, (dc * spread * (0.85 + 0.3 * r.next())) / 1200)) / SR;
      const gl = g * a * Math.cos(((pan + 1) * Math.PI) / 4) * 1.41, gr = g * a * Math.sin(((pan + 1) * Math.PI) / 4) * 1.41;
      let ph = r.next();
      for (let n = 0; n < len; n++) {
        const y = tabRead(tab, ph) * env[n];
        L[n] += gl * y; R[n] += gr * y;
        ph += inc; if (ph >= 1) ph -= 1;
      }
    }
  });
  const lp = p.lp || 7000;
  runBQ(L, bq('lp', lp, 0.6)); runBQ(R, bq('lp', lp, 0.6));
  return { L, R };
}

// ---------------------------------------------------------------- plucks
/**
 * Plucky synth (lead and arp): two detuned band-limited oscillators through a
 * state-variable lowpass whose cutoff falls from `cut` to a floor; a short
 * percussive body with a small sustain. p: {midi, vel, hold, cut, decay, q, wave, sus}
 */
export function pluckSynth(p, r) {
  const f = mtof(p.midi), vel = p.vel, hold = Math.max(0.03, p.hold);
  const rel = p.rel || 0.12;
  const len = lenOf(hold + rel, p);
  const out = new Float32Array(len);
  const tab = p.wave === 'square' ? squareTable(p.midi) : sawTable(p.midi, 3200, 7600);
  const d1 = f * Math.pow(2, 6 / 1200) / SR, d2 = f * Math.pow(2, -6 / 1200) / SR;
  let p1 = r.next(), p2 = r.next(), ps = r.next();
  const sv = new SVF(2000, p.q || 0.85);
  const cut = (p.cut || 3600) * (0.7 + 0.3 * vel), floor = Math.min(cut, Math.max(380, f * 1.6)), dec = p.decay || 0.16;
  const sus = p.sus == null ? 0.22 : p.sus;
  const aN = 0.0025 * SR, n0 = Math.round(hold * SR), nr = Math.max(1, Math.round(rel * SR));
  const kA = Math.exp(-1 / ((p.ampDecay || 0.32) * SR));
  let eA = 1;
  for (let n = 0; n < len; n++) {
    if ((n & 15) === 0) sv.set(floor + (cut - floor) * Math.exp(-n / SR / dec), p.q || 0.85);
    const x = 0.5 * (tabRead(tab, p1) + tabRead(tab, p2)) + 0.35 * sinc1(ps);
    let e = (n < aN ? rc(n / aN) : 1) * (sus + (1 - sus) * eA);
    if (n > n0) e *= 1 - rc((n - n0) / nr);
    out[n] = vel * e * sv.process(x);
    p1 += d1; p2 += d2; ps += f / SR;
    if (p1 >= 1) p1 -= 1; if (p2 >= 1) p2 -= 1; if (ps >= 1) ps -= 1;
    eA *= kA;
  }
  return out;
}

/** round house bass: sine + soft upper harmonics, a gentle filter "pluck" on the onset */
export function houseBass(p, r) {
  const f = mtof(p.midi), vel = p.vel, hold = Math.max(0.05, p.hold);
  const rel = 0.05;
  const len = lenOf(hold + rel, p);
  const out = new Float32Array(len);
  const tab = sawTable(p.midi, 600, 1400);
  let ph = r.uni(0, 0.02), pt = ph;
  const sv = new SVF(800, 0.9);
  const aN = 0.006 * SR, n0 = Math.round(hold * SR), nr = Math.round(rel * SR);
  const growl = p.growl == null ? 0.35 : p.growl;
  for (let n = 0; n < len; n++) {
    if ((n & 31) === 0) sv.set(260 + 900 * Math.exp(-n / SR / 0.07), 0.9);
    let e = n < aN ? rc(n / aN) : 1;
    if (n > n0) e *= 1 - rc((n - n0) / nr);
    const y = sinc1(ph) + growl * sv.process(tabRead(tab, pt));
    out[n] = vel * e * Math.tanh(1.2 * y) / Math.tanh(1.2);
    ph += f / SR; pt += f / SR;
    if (ph >= 1) ph -= 1; if (pt >= 1) pt -= 1;
  }
  return out;
}

// ---------------------------------------------------------------- drums
/** house kick: a falling sine with a soft click; `soft` for chill house */
export function kick4(p, r) {
  const soft = !!p.soft, vel = p.vel;
  const dur = soft ? 0.38 : 0.46;
  const len = Math.round(dur * SR);
  const out = new Float32Array(len);
  const hi = (soft ? 118 : 150) * (1 + 0.01 * r.gauss()), lo = soft ? 52 : 48, tauF = soft ? 0.028 : 0.032;
  const dA = soft ? 0.17 : 0.22;
  const click = new OnePole(soft ? 1500 : 2600);
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    ph += (lo + (hi - lo) * Math.exp(-t / tauF)) / SR;
    const env = rc(t / 0.0018) * (0.25 * Math.exp(-t / 0.06) + 0.75 * Math.exp(-t / dA)) * (1 - rc((t - (dur - 0.08)) / 0.08));
    const cl = click.process(r.next() * 2 - 1) * Math.exp(-t / 0.003) * (soft ? 0.08 : 0.18) * rc(t / 0.0008);
    out[n] = (vel * Math.tanh(1.6 * (sinc1(ph) * env + cl))) / Math.tanh(1.6);
  }
  return out;
}
/** hand clap: three quick band-passed noise bursts and a short room tail */
export function clap(p, r) {
  const vel = p.vel;
  const len = Math.round(0.42 * SR);
  const out = new Float32Array(len);
  const bp = new SVF(1150 * (1 + 0.04 * r.gauss()), 1.1), lp = new OnePole(6500);
  const offs = [0, 0.0095 + 0.002 * r.next(), 0.02 + 0.003 * r.next()];
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    let e = 0;
    for (let k = 0; k < offs.length; k++) { const u = t - offs[k]; if (u >= 0) e = Math.max(e, rc(u / 0.0012) * Math.exp(-u / (k === offs.length - 1 ? 0.11 : 0.006))); }
    bp.process(r.next() * 2 - 1);
    out[n] = vel * 2.2 * lp.process(bp.bp) * e * (1 - rc((t - 0.36) / 0.06));
  }
  runBQ(out, bq('hp', 380, 0.7));
  return out;
}
/** soft snare for build rolls: a short tone and band-passed noise */
export function snr(p, r) {
  const vel = p.vel;
  const len = Math.round(0.26 * SR);
  const out = new Float32Array(len);
  const bp = new SVF(1900, 0.7), lp = new OnePole(6000);
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    bp.process(r.next() * 2 - 1);
    ph += 196 / SR;
    const e = rc(t / 0.0015) * (1 - rc((t - 0.2) / 0.06));
    out[n] = vel * e * (0.55 * sinc1(ph) * Math.exp(-t / 0.05) + 1.3 * lp.process(bp.bp) * Math.exp(-t / 0.075));
  }
  return out;
}
/** hi-hat from filtered noise: `open` rings longer; tops kept below 10 kHz */
export function hh(p, r) {
  const vel = p.vel, open = !!p.open;
  const dur = open ? 0.34 : 0.09;
  const len = Math.round(dur * SR);
  const out = new Float32Array(len);
  const hp = new SVF(open ? 6200 : 7000, 0.7), lp = new SVF(9500, 0.6);
  const tau = open ? p.tau || 0.085 : 0.018;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    hp.process(r.next() * 2 - 1); lp.process(hp.hp);
    out[n] = vel * lp.lp * rc(t / (open ? 0.004 : 0.0015)) * Math.exp(-t / tau) * (1 - rc((t - (dur - 0.03)) / 0.03));
  }
  return out;
}

// ---------------------------------------------------------------- transitions
/**
 * Riser: stereo noise through a band-pass that sweeps up (exponentially),
 * a soft swell, never above `top` Hz; ends with a short fade. p: {dur, vel, f0, f1}
 */
export function riser(p, r) {
  const dur = p.dur;
  const len = lenOf(dur, p), total = Math.round(dur * SR);
  const L = new Float32Array(len), R = new Float32Array(len);
  const f0 = p.f0 || 350, f1 = p.f1 || 3200;
  const sl = new SVF(f0, 1.2), sr = new SVF(f0, 1.2);
  const ol = new OnePole(5200), or = new OnePole(5200);
  const fade = Math.round(0.05 * SR);
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const u = n / total;
    if ((n & 31) === 0) { const f = f0 * Math.pow(f1 / f0, u * u); sl.set(f, 1.2); sr.set(f * 1.03, 1.2); }
    sl.process(r.next() * 2 - 1); sr.process(r.next() * 2 - 1);
    // a faint rising tone an octave below the noise centre
    const ft = 0.5 * f0 * Math.pow(f1 / f0, u * u);
    ph += Math.min(ft, 1800) / SR;
    const e = Math.pow(u, 1.6) * (n > total - fade ? 1 - rc((n - (total - fade)) / fade) : 1) * rc(n / (0.2 * SR));
    const tone = 0.12 * sinc1(ph);
    L[n] = p.vel * e * (ol.process(sl.bp) * 1.6 + tone);
    R[n] = p.vel * e * (or.process(sr.bp) * 1.6 + tone);
  }
  return { L, R };
}
/** impact on a drop: a low boom and a soft, darkened crash */
export function impact(p, r) {
  const len = lenOf(2.6, p), total = Math.round(2.6 * SR);
  const L = new Float32Array(len), R = new Float32Array(len);
  const cl = new SVF(5200, 0.6), cr = new SVF(5400, 0.6), hl = new SVF(1800, 0.7), hr = new SVF(1800, 0.7);
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    ph += (38 + 34 * Math.exp(-t / 0.12)) / SR;
    const boom = sinc1(ph) * rc(t / 0.004) * Math.exp(-t / 0.55);
    hl.process(r.next() * 2 - 1); hr.process(r.next() * 2 - 1);
    cl.process(hl.hp); cr.process(hr.hp);
    const ce = rc(t / 0.006) * (0.4 * Math.exp(-t / 0.15) + 0.6 * Math.exp(-t / 0.9));
    const end = 1 - rc((n - (total - 0.3 * SR)) / (0.3 * SR));
    L[n] = p.vel * end * (0.9 * boom + (p.crash == null ? 0.45 : p.crash) * ce * cl.lp);
    R[n] = p.vel * end * (0.9 * boom + (p.crash == null ? 0.45 : p.crash) * ce * cr.lp);
  }
  return { L, R };
}
/** a short soft noise swell (chill house lift, reverse-cymbal feel) */
export function swell(p, r) {
  const dur = p.dur;
  const len = lenOf(dur, p), total = Math.round(dur * SR);
  const L = new Float32Array(len), R = new Float32Array(len);
  const sl = new SVF(3000, 0.7), sr = new SVF(3200, 0.7);
  for (let n = 0; n < len; n++) {
    const u = n / total;
    sl.process(r.next() * 2 - 1); sr.process(r.next() * 2 - 1);
    const e = Math.pow(u, 2.2) * (1 - rc((u - 0.94) / 0.06));
    L[n] = p.vel * e * sl.bp; R[n] = p.vel * e * sr.bp;
  }
  runBQ(L, bq('lp', 6500, 0.6)); runBQ(R, bq('lp', 6500, 0.6));
  return { L, R };
}

export const DANCE_VOICES = { saw, pluckSynth, houseBass, kick4, clap, snr, hh, riser, impact, swell };
export { clamp };
