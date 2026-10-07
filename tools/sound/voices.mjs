// Synthesised instruments. Each voice renders one note or hit as a mono
// Float32Array (or {L, R} for stereo voices). Every voice is band-limited
// (sines, table oscillators or filtered noise, partials kept well below
// Nyquist), starts with a raised-cosine attack and ends at exactly zero.
// Randomness comes only from the event's own RNG, so rendering any subset of
// events gives identical audio.
import { SR, mtof, rc, clamp, sinc1, makeTable, tabRead, SVF, OnePole, bq, runBQ } from './dsp.mjs';

const MAXF = 11000; // no partial above this (soft highs, far from Nyquist)

/** release envelope helper: 1 until n0, then a raised-cosine fade over nr samples */
function relEnv(n, n0, nr) { return n < n0 ? 1 : 1 - rc((n - n0) / nr); }

// ---------------------------------------------------------------- keys
/** soft FM electric piano (Rhodes-like): 1:1 FM body, bark, short tine */
export function epiano(p, r) {
  const c = p.c;
  const f = mtof(p.midi), vel = p.vel, hold = p.hold;
  const rel = (c.epRelease || 0.35) * (0.9 + 0.2 * r.next());
  const len = Math.ceil((hold + rel) * SR);
  const out = new Float32Array(len);
  const attN = Math.max(1, (0.004 + 0.004 * (1 - vel)) * SR);
  const reg = clamp((p.midi - 60) / 24, -0.6, 1);
  const tauSlow = (c.epDecay || 2.4) * (1.15 - 0.55 * reg);
  const I0 = (c.epIndex || 1.6) * (0.35 + 0.75 * vel) * (1 - 0.45 * Math.max(0, reg)) / (2 * Math.PI);
  const tf = f * (c.tineRatio || 4.5);
  const tine = (c.tine || 0.25) * vel * clamp(1 - (tf - 2500) / 3000, 0, 1);
  const bark = (c.bark || 0.14) * (1 - 0.5 * Math.max(0, reg)) ;
  const dC = f / SR, dM = (f * (c.modRatio || 1)) / SR, dT = tf / SR;
  const kF = Math.exp(-1 / (0.25 * SR)), kS = Math.exp(-1 / (tauSlow * SR)), kI = Math.exp(-1 / ((c.idxDecay || 0.45) * SR));
  const kB = Math.exp(-1 / (0.6 * SR)), kT = Math.exp(-1 / (0.05 * SR));
  let eF = 0.22, eS = 0.78, eI = 1, eB = 1, eT = 1;
  let pC = 0, pM = 0, pT = 0;
  const amp = Math.pow(vel, 1.3);
  const n0 = Math.round(hold * SR), nr = Math.max(1, Math.round(rel * SR));
  for (let n = 0; n < len; n++) {
    let env = (eF + eS) * (n < attN ? rc(n / attN) : 1);
    if (n > n0) env *= 1 - rc((n - n0) / nr);
    const I = I0 * (0.32 + 0.68 * eI);
    const m = sinc1(pM);
    let y = sinc1(pC + I * m);
    y += bark * eB * sinc1(2 * pC + 0.6 * I * m);
    y += tine * eT * sinc1(pT);
    out[n] = amp * env * y;
    pC += dC; pM += dM; pT += dT;
    if (pC > 1) pC -= 1; if (pM > 1) pM -= 1; if (pT > 1) pT -= 1;
    eF *= kF; eS *= kS; eI *= kI; eB *= kB; eT *= kT;
  }
  return out;
}

/** warm round bass: sine + soft 2nd/3rd harmonic, gentle saturation */
export function bass(p, r) {
  const c = p.c;
  const f = mtof(p.midi), vel = p.vel, hold = p.hold;
  const rel = 0.12;
  const len = Math.ceil((hold + rel) * SR);
  const out = new Float32Array(len);
  const attN = 0.014 * SR;
  let ph = r.uni(0, 0.05);
  const d = f / SR;
  const drive = c.bassDrive || 1.3, nd = Math.tanh(drive);
  const kA = Math.exp(-1 / (0.2 * SR)), kD = Math.exp(-1 / ((c.bassDecay || 2.4) * SR)), k7 = Math.exp(-1 / (0.07 * SR));
  let eA = 1, eD = 1, e7 = 1;
  const H2 = c.bassH2 || 0.24, H3 = c.bassH3 || 0.08;
  const n0 = Math.round(hold * SR), nr = Math.round(rel * SR);
  for (let n = 0; n < len; n++) {
    let env = (n < attN ? rc(n / attN) : 1) * (0.7 + 0.3 * eA) * eD;
    if (n > n0) env *= 1 - rc((n - n0) / nr);
    const y = sinc1(ph) + (H2 + 0.15 * e7) * sinc1(2 * ph) + H3 * sinc1(3 * ph);
    out[n] = (vel * env * Math.tanh(drive * 0.8 * y)) / nd;
    ph += d; if (ph > 1) ph -= 1;
    eA *= kA; eD *= kD; e7 *= k7;
  }
  return out;
}

/** Karplus-Strong plucked string (soft nylon) with a smooth onset */
export function pluck(p, r) {
  const c = p.c;
  const f = mtof(p.midi), P = SR / f, vel = p.vel, hold = p.hold;
  const rel = 0.2;
  const len = Math.ceil((hold + rel) * SR);
  const y = new Float64Array(len + 2);
  const exLen = Math.round(P);
  const exc = new Float64Array(exLen);
  const lp = new OnePole((c.pluckBright || 2600) * (0.6 + 0.4 * vel));
  let mean = 0;
  for (let k = 0; k < exLen; k++) { exc[k] = lp.process(r.next() * 2 - 1); mean += exc[k]; }
  mean /= exLen;
  const pos = Math.max(1, Math.round(0.2 * exLen));
  const e2 = new Float64Array(exLen);
  for (let k = 0; k < exLen; k++) e2[k] = exc[k] - mean - 0.5 * (k >= pos ? exc[k - pos] - mean : 0);
  const rho = Math.pow(10, -3 / ((c.pluckT60 || 2.5) * f));
  const d0 = P - 0.5, d1 = P + 0.5;
  for (let n = 0; n < len; n++) {
    let fb = 0;
    if (n - d1 >= 0) {
      const x0 = n - d0, x1 = n - d1;
      const i0 = Math.floor(x0), f0 = x0 - i0, i1 = Math.floor(x1), f1 = x1 - i1;
      fb = rho * 0.5 * (y[i0] * (1 - f0) + y[i0 + 1] * f0 + y[i1] * (1 - f1) + y[i1 + 1] * f1);
    }
    y[n] = (n < exLen ? e2[n] : 0) + fb;
  }
  const out = new Float32Array(len);
  for (let n = 0; n < len; n++) out[n] = y[n];
  runBQ(out, bq('peak', 230, 1.2, 3));
  runBQ(out, bq('lp', c.pluckLP || 3200, 0.6));
  runBQ(out, bq('hp', 90, 0.7));
  const n0 = Math.round(hold * SR), nr = Math.round(rel * SR), aN = 0.003 * SR;
  for (let n = 0; n < len; n++) out[n] *= vel * 1.6 * (n < aN ? rc(n / aN) : 1) * (n > n0 ? 1 - rc((n - n0) / nr) : 1);
  return out;
}

// ---------------------------------------------------------------- modal (additive) voices
/**
 * Generic modal voice: partials [[ratio, amp, tau]] above f, an envelope with
 * raised-cosine attack, optional pitch bend (semitones over time), vibrato,
 * tremolo and a soft filtered-noise "strike".
 */
function modal(f, partials, o, r) {
  const hold = o.hold == null ? 99 : o.hold;
  const rel = o.rel || 0.25;
  let maxTau = 0;
  const parts = [];
  for (const [ratio, amp, tau] of partials) {
    const fr = f * ratio;
    if (fr > (o.maxF || MAXF) || amp === 0) continue;
    // soften the very top partials
    const soft = fr > 6000 ? clamp(1 - (fr - 6000) / 5000, 0, 1) : 1;
    parts.push({ inc: fr / SR, amp: amp * soft, k: Math.exp(-1 / (tau * SR)), ph: o.randPhase ? r.next() : 0 });
    maxTau = Math.max(maxTau, tau);
  }
  const natural = maxTau * 7; // -60 dB
  const dur = Math.min(natural, hold + rel);
  const len = Math.max(64, Math.ceil(dur * SR));
  const out = new Float32Array(len);
  const aN = Math.max(1, (o.att || 0.002) * SR);
  const n0 = Math.round(Math.min(hold, dur - rel) * SR), nr = Math.max(1, Math.round(rel * SR));
  const K = parts.length;
  const inc = new Float64Array(K), amp = new Float64Array(K), kk = new Float64Array(K), ph = new Float64Array(K), env = new Float64Array(K);
  parts.forEach((q, i) => { inc[i] = q.inc; amp[i] = q.amp; kk[i] = q.k; ph[i] = q.ph; env[i] = 1; });
  const bend = o.bend, vib = o.vib, trem = o.trem;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    let fm = 1;
    if (bend) fm *= Math.pow(2, bend(t) / 12);
    if (vib) fm *= 1 + vib.depth * rc((t - vib.delay) / 0.4) * sinc1(vib.rate * t);
    let y = 0;
    for (let k = 0; k < K; k++) {
      y += amp[k] * env[k] * sinc1(ph[k]);
      ph[k] += inc[k] * fm;
      env[k] *= kk[k];
    }
    let e = n < aN ? rc(n / aN) : 1;
    if (n > n0) e *= 1 - rc((n - n0) / nr);
    if (trem) e *= 1 - trem.depth * (0.5 + 0.5 * sinc1(trem.rate * t + trem.ph));
    out[n] = y * e;
  }
  if (o.strike) { // soft mallet / pick noise
    const s = o.strike;
    const sv = new SVF(s.fc, s.q || 1);
    const sl = Math.min(len, Math.round(s.tau * 8 * SR));
    const ka = Math.exp(-1 / (s.tau * SR));
    let e = 1;
    for (let n = 0; n < sl; n++) {
      sv.process(r.next() * 2 - 1);
      out[n] += s.amp * sv.bp * e * rc(n / (0.0008 * SR)) * (1 - rc((n - 0.8 * sl) / (0.2 * sl)));
      e *= ka;
    }
  }
  return out;
}

/** soft bell (glass / temple bell): strong fundamental, quick upper partials, slow beating */
export function bell(p, r) {
  const f = mtof(p.midi), v = p.vel;
  const T = (p.c && p.c.bellDecay) || 3.2;
  const parts = [
    [1, 1, T], [1.0016, 0.45, T * 0.9], [2.0, 0.22, T * 0.45], [2.76, 0.28, T * 0.22],
    [4.07, 0.12, T * 0.1], [5.4, 0.06, T * 0.06], [0.5, 0.18, T * 0.6],
  ];
  const out = modal(f, parts, { att: 0.0025, hold: p.hold == null ? 99 : p.hold, rel: 0.6, strike: { fc: Math.min(5000, f * 3), q: 1.5, tau: 0.004, amp: 0.25 } }, r);
  for (let i = 0; i < out.length; i++) out[i] *= v * 0.55;
  return out;
}
/** celesta / music-box: nearly sine, bright short ping, moderate decay */
export function celesta(p, r) {
  const f = mtof(p.midi), v = p.vel;
  const reg = clamp((p.midi - 72) / 24, 0, 1);
  const T = 1.6 * (1 - 0.45 * reg);
  const parts = [[1, 1, T], [2, 0.07, T * 0.5], [3.93, 0.22 * (1 - 0.5 * reg), 0.12], [9.6, 0.04, 0.03]];
  const out = modal(f, parts, { att: 0.0015, hold: p.hold == null ? 99 : p.hold, rel: 0.4, strike: { fc: 3200, q: 1.2, tau: 0.002, amp: 0.08 } }, r);
  for (let i = 0; i < out.length; i++) out[i] *= v * 0.7;
  return out;
}
/** vibraphone: bar modes 1 : 4 : 10 with motor tremolo */
export function vibes(p, r) {
  const f = mtof(p.midi), v = p.vel;
  const parts = [[1, 1, 2.8], [3.99, 0.22, 0.35], [9.9, 0.05, 0.08]];
  const out = modal(f, parts, { att: 0.002, hold: p.hold, rel: 0.5, trem: { rate: 4.6, depth: 0.28, ph: r.next() }, strike: { fc: 2500, q: 1, tau: 0.002, amp: 0.1 } }, r);
  for (let i = 0; i < out.length; i++) out[i] *= v * 0.6;
  return out;
}
/** soft marimba */
export function marimba(p, r) {
  const f = mtof(p.midi), v = p.vel;
  const parts = [[1, 1, 0.55], [3.93, 0.3, 0.09], [9.2, 0.06, 0.025]];
  const out = modal(f, parts, { att: 0.0025, hold: 99, rel: 0.1, strike: { fc: 1800, q: 0.9, tau: 0.003, amp: 0.15 } }, r);
  for (let i = 0; i < out.length; i++) out[i] *= v * 0.8;
  return out;
}
/**
 * soft plucked zither (guzheng-like): slightly stretched partials shaped by the
 * pluck position, upper partials decaying fast; a gentle press-bend or vibrato
 */
export function zither(p, r) {
  const f = mtof(p.midi), v = p.vel;
  const parts = [];
  const pos = 0.17;
  for (let k = 1; k <= 12; k++) {
    const a = Math.abs(Math.sin(Math.PI * k * pos)) / Math.pow(k, 1.05);
    parts.push([k * (1 + 0.0004 * k * k), a, 2.6 / (1 + 0.55 * (k - 1))]);
  }
  const o = { att: 0.0018, hold: p.hold == null ? 99 : p.hold, rel: 0.35, strike: { fc: 2600, q: 0.8, tau: 0.0025, amp: 0.12 } };
  if (p.bend) { const b = p.bend; o.bend = (t) => (t < 0.18 ? -b * (1 - rc(t / 0.18)) : 0); }
  if (p.vib) o.vib = { rate: 5.2, depth: 0.006, delay: 0.35 };
  const out = modal(f, parts, o, r);
  for (let i = 0; i < out.length; i++) out[i] *= v * 0.75;
  return out;
}

// ---------------------------------------------------------------- airy voices
/** breathy flute-like voice: soft harmonics, pitch-tracking breath noise, delayed vibrato */
export function airy(p, r) {
  const f = mtof(p.midi), v = p.vel, hold = p.hold;
  const att = p.att || 0.09, rel = p.rel || 0.28;
  const len = Math.ceil((hold + rel) * SR);
  const out = new Float32Array(len);
  const H = [1, 0.2, 0.085, 0.035, 0.014].map((a, i) => (f * (i + 1) < 7000 ? a : 0));
  const sv = new SVF(f, 3.2), air = new SVF(2400, 0.7);
  const vr = 4.9 + 0.6 * r.next(), vd = 0.0055 + 0.003 * r.next();
  const aN = att * SR, n0 = Math.round(hold * SR), nr = Math.max(1, Math.round(rel * SR));
  const swell = 0.12 * r.next();
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    const vib = 1 + vd * rc((t - 0.3) / 0.5) * sinc1(vr * t);
    let e = n < aN ? rc(n / aN) : 1;
    e *= 1 + swell * Math.sin(Math.PI * Math.min(1, t / Math.max(0.3, hold)));
    if (n > n0) e *= 1 - rc((n - n0) / nr);
    let y = 0;
    for (let h = 0; h < 5; h++) if (H[h]) y += H[h] * sinc1((h + 1) * ph);
    const w = r.next() * 2 - 1;
    sv.process(w); air.process(w);
    const breath = 0.16 * sv.bp + 0.025 * air.bp * (n < aN * 1.5 ? 1.8 : 1);
    out[n] = v * e * (y + breath);
    ph += (f * vib) / SR; if (ph > 1) ph -= 1;
  }
  return out;
}

// pad wavetables are cached by timbre and note
const TABS = new Map();
function vowelAmps(f, vowel, bright) {
  const F = vowel === 'ah' ? [[700, 110, 1], [1150, 120, 0.5], [2700, 200, 0.12]] : vowel === 'oo' ? [[350, 90, 1], [800, 110, 0.35], [2400, 200, 0.06]] : [[480, 100, 1], [1000, 120, 0.4], [2500, 200, 0.09]];
  const amps = [];
  for (let h = 1; h * f < 6500; h++) {
    const fh = h * f;
    let g = 0.04 * bright;
    for (const [fc, bw, a] of F) g += a / (1 + ((fh - fc) / bw) ** 2);
    amps.push(g / Math.pow(h, 0.6));
  }
  return amps;
}
function padTable(midi, timbre) {
  const key = timbre + ':' + midi;
  let t = TABS.get(key);
  if (t) return t;
  const f = mtof(midi);
  let amps = [];
  if (timbre === 'warm') for (let h = 1; h * f < 4200; h++) amps.push((1 / Math.pow(h, 1.35)) * (h * f > 2500 ? 1 - (h * f - 2500) / 1700 : 1));
  else if (timbre === 'glass') for (let h = 1; h * f < 5000; h++) amps.push(h % 2 ? 1 / Math.pow(h, 1.1) : 0.25 / Math.pow(h, 1.4));
  else amps = vowelAmps(f, timbre, 1);
  t = makeTable(amps);
  let pk = 0;
  for (let i = 0; i < t.length; i++) pk = Math.max(pk, Math.abs(t[i]));
  for (let i = 0; i < t.length; i++) t[i] /= pk;
  TABS.set(key, t);
  return t;
}
/** sustained pad chord (stereo): two detuned table oscillators per note, slow envelope */
export function pad(p, r) {
  const notes = p.notes, hold = p.hold, att = p.att || 1.2, rel = p.rel || 1.6;
  const len = Math.ceil((hold + rel) * SR);
  const L = new Float32Array(len), R = new Float32Array(len);
  const timbre = p.timbre || 'warm';
  const det = (p.detune || 5) / 1200;
  const aN = att * SR, n0 = Math.round(hold * SR), nr = Math.round(rel * SR);
  const env = new Float32Array(len);
  for (let n = 0; n < len; n++) env[n] = (n < aN ? rc(n / aN) : 1) * (n > n0 ? 1 - rc((n - n0) / nr) : 1);
  const breath = p.breath || 0;
  notes.forEach((m, j) => {
    const tab = padTable(m, timbre);
    const f = mtof(m) / SR;
    const g = p.vel / Math.sqrt(notes.length) * (1 - 0.06 * j);
    const fa = f * (1 - det), fb = f * (1 + det), fc = f * (1 + det * 0.35), fd = f * (1 - det * 0.4);
    let pa = r.next(), pb = r.next(), pc = r.next(), pd = r.next();
    for (let n = 0; n < len; n++) {
      const e = env[n] * g;
      L[n] += e * (0.6 * tabRead(tab, pa) + 0.4 * tabRead(tab, pc));
      R[n] += e * (0.6 * tabRead(tab, pb) + 0.4 * tabRead(tab, pd));
      pa += fa; pb += fb; pc += fc; pd += fd;
      if (pa > 1) pa -= 1; if (pb > 1) pb -= 1; if (pc > 1) pc -= 1; if (pd > 1) pd -= 1;
    }
  });
  if (breath) { // a little air on vowel pads
    const sl = new SVF(1800, 0.6), sr = new SVF(1900, 0.6);
    for (let n = 0; n < len; n++) {
      sl.process(r.next() * 2 - 1); sr.process(r.next() * 2 - 1);
      L[n] += breath * p.vel * env[n] * sl.bp; R[n] += breath * p.vel * env[n] * sr.bp;
    }
  }
  return { L, R };
}

/**
 * tanpura-like drone pluck: rich harmonics whose bright band sweeps down over
 * the note (the "jawari" shimmer), made from crossfaded band-limited tables
 */
export function drone(p, r) {
  const f = mtof(p.midi), v = p.vel;
  const key = 'drone:' + p.midi;
  let tabs = TABS.get(key);
  if (!tabs) {
    tabs = [14, 10, 7.5, 5.5, 4, 3, 2.2].map((cn) => {
      const amps = [];
      for (let h = 1; h * f < 5000; h++) amps.push((1 / Math.pow(h, 0.75)) * (0.3 + Math.exp(-(((h - cn) / (0.35 * cn + 1.5)) ** 2))) * (h * f > 3500 ? 1 - (h * f - 3500) / 1500 : 1));
      const t = makeTable(amps);
      let pk = 0;
      for (let i = 0; i < t.length; i++) pk = Math.max(pk, Math.abs(t[i]));
      for (let i = 0; i < t.length; i++) t[i] /= pk;
      return t;
    });
    TABS.set(key, tabs);
  }
  const dur = p.dur || 6;
  const len = Math.ceil(dur * SR);
  const out = new Float32Array(len);
  const sweep = p.sweep || 3.2;
  const aN = 0.012 * SR, nr = 0.8 * SR, n0 = len - nr;
  const k = Math.exp(-1 / ((p.tau || 3) * SR));
  let e = 1, ph = r.next();
  const inc = f / SR;
  const last = tabs.length - 1;
  for (let n = 0; n < len; n++) {
    const s = Math.min(last - 1e-6, ((n / SR) / sweep) * last);
    const i = s | 0, fr = s - i;
    const y = tabRead(tabs[i], ph) * (1 - fr) + tabRead(tabs[i + 1], ph) * fr;
    let en = e * (n < aN ? rc(n / aN) : 1);
    if (n > n0) en *= 1 - rc((n - n0) / nr);
    out[n] = v * en * y;
    ph += inc; if (ph > 1) ph -= 1;
    e *= k;
  }
  return out;
}

// ---------------------------------------------------------------- hand drums
/** tabla-like strokes: 'na' / 'tin' (treble, tuned) and 'ge' (bass with a rising glide) */
export function tabla(p, r) {
  const v = p.vel;
  if (p.stroke === 'ge') {
    const f = p.f || 92;
    const parts = [[1, 1, 0.42], [1.52, 0.25, 0.12], [2.03, 0.1, 0.06]];
    const out = modal(f, parts, { att: 0.003, hold: 99, rel: 0.15, bend: (t) => 2.6 * rc(t / 0.32), strike: { fc: 500, q: 0.8, tau: 0.004, amp: 0.2 } }, r);
    for (let i = 0; i < out.length; i++) out[i] *= v;
    return out;
  }
  const f = mtof(p.midi);
  const tin = p.stroke === 'tin';
  const parts = [[1, 1, tin ? 0.5 : 0.32], [2, tin ? 0.3 : 0.45, 0.2], [3, 0.22, 0.12], [4.02, 0.12, 0.07], [5.05, 0.06, 0.04]];
  const out = modal(f, parts, { att: 0.0012, hold: 99, rel: 0.08, bend: (t) => -0.3 * rc(t / 0.04), strike: { fc: 2200, q: 1, tau: 0.0015, amp: 0.2 } }, r);
  for (let i = 0; i < out.length; i++) out[i] *= v * 0.8;
  return out;
}

// ---------------------------------------------------------------- drums
export function kick(p, r) {
  const c = p.c, vel = p.vel;
  const len = Math.round(0.6 * SR);
  const out = new Float32Array(len);
  const f1 = (c.kickHi || 100) * (1 + 0.03 * r.gauss()), f0 = c.kickLo || 52;
  const dec = c.kickDecay || 0.2;
  let ph = 0;
  const click = new OnePole(1200);
  const kd = Math.exp(-1 / (dec * SR));
  let e = 1;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    const f = f0 + (f1 - f0) * Math.exp(-t / 0.035);
    ph += f / SR;
    const env = rc(t / 0.003) * e * (1 - rc((t - 0.48) / 0.12));
    const cl = click.process(r.next() * 2 - 1) * Math.exp(-t / 0.004) * 0.22 * rc(t / 0.001);
    out[n] = (vel * Math.tanh(1.4 * (sinc1(ph) * env + cl))) / Math.tanh(1.4);
    e *= kd;
  }
  return out;
}
export function brushSnare(p, r) {
  const c = p.c, vel = p.vel, ghost = !!p.ghost;
  const dur = ghost ? 0.25 : 0.55;
  const len = Math.round(dur * SR);
  const out = new Float32Array(len);
  const bp = new SVF((c.brushFc || 2600) * (1 + 0.08 * r.gauss()), 0.55);
  const lp = new OnePole(5200);
  const att = ghost ? 0.012 : 0.006 + 0.008 * r.next();
  const d1 = ghost ? 0.05 : 0.09, d2 = ghost ? 0.1 : 0.3;
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    bp.process(r.next() * 2 - 1);
    const nz = lp.process(bp.bp);
    const env = rc(t / att) * (0.72 * Math.exp(-t / d1) + 0.28 * Math.exp(-t / d2)) * (1 - rc((t - (dur - 0.08)) / 0.08));
    ph += 190 / SR;
    const body = ghost ? 0 : 0.5 * sinc1(ph) * Math.exp(-t / 0.045) * rc(t / 0.002);
    out[n] = vel * (1.6 * nz * env + body);
  }
  return out;
}
export function rim(p, r) {
  const vel = p.vel;
  const len = Math.round(0.22 * SR);
  const out = new Float32Array(len);
  const bp = new SVF(2100, 2.0);
  const fr = [1550 * (1 + 0.01 * r.gauss()), 800, 420];
  const am = [0.4, 0.35, 0.42], de = [0.009, 0.016, 0.03];
  const ph = [0, 0, 0];
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    let s = 0;
    for (let k = 0; k < 3; k++) { ph[k] += fr[k] / SR; s += am[k] * sinc1(ph[k]) * Math.exp(-t / de[k]); }
    bp.process(r.next() * 2 - 1);
    s += 0.45 * bp.bp * Math.exp(-t / 0.006);
    out[n] = vel * s * rc(t / 0.0012) * (1 - rc((t - 0.17) / 0.05));
  }
  return out;
}
export function hat(p, r) {
  const c = p.c, vel = p.vel;
  const len = Math.round(0.1 * SR);
  const out = new Float32Array(len);
  const hp = new SVF(c.hatFc || 6000, 0.7), lp = new SVF(c.hatLP || 8500, 0.6);
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    hp.process(r.next() * 2 - 1); lp.process(hp.hp);
    out[n] = vel * lp.lp * rc(t / 0.0015) * Math.exp(-t / (c.hatDecay || 0.022)) * (1 - rc((t - 0.08) / 0.02));
  }
  return out;
}
export function shaker(p, r) {
  const c = p.c, vel = p.vel;
  const len = Math.round(0.15 * SR);
  const out = new Float32Array(len);
  const bp = new SVF((c.shakerFc || 4600) * (1 + 0.05 * r.gauss()), 0.9), lp = new OnePole(7000);
  const att = 0.012 + 0.006 * r.next();
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    bp.process(r.next() * 2 - 1);
    out[n] = vel * 1.5 * lp.process(bp.bp) * rc(t / att) * Math.exp(-Math.max(0, t - att) / 0.04) * (1 - rc((t - 0.12) / 0.03));
  }
  return out;
}
/** soft wood block / clave (lunar) */
export function wood(p, r) {
  const f = p.f || 1100;
  const out = modal(f, [[1, 1, 0.045], [2.3, 0.3, 0.02], [3.9, 0.1, 0.01]], { att: 0.001, hold: 99, rel: 0.05, strike: { fc: 1800, q: 1, tau: 0.0015, amp: 0.2 } }, r);
  for (let i = 0; i < out.length; i++) out[i] *= p.vel * 0.8;
  return out;
}
/** tiny sleigh-bell jingle (Christmas): a soft cluster of small bell pings */
export function jingle(p, r) {
  const len = Math.round(0.35 * SR);
  const out = new Float32Array(len);
  const n = 7 + r.int(0, 4);
  for (let k = 0; k < n; k++) {
    const f = r.uni(2900, 4600);
    const t0 = Math.round(Math.abs(r.gauss()) * 0.03 * SR);
    const tau = r.uni(0.03, 0.07);
    const a = r.uni(0.4, 1);
    const ratio2 = 2.4 + 0.3 * r.next();
    let ph = r.next(), ph2 = r.next();
    for (let i = t0; i < len; i++) {
      const t = (i - t0) / SR;
      const e = rc(t / 0.0015) * Math.exp(-t / tau);
      if (e < 1e-4) break;
      out[i] += a * e * (sinc1(ph) + 0.2 * sinc1(ph2));
      ph += f / SR; ph2 += (f * ratio2 > 9000 ? 0 : (f * ratio2) / SR);
    }
  }
  const fl = new OnePole(6000);
  for (let i = 0; i < len; i++) out[i] = fl.process(out[i]) * p.vel * 0.25 * (1 - rc((i - 0.85 * len) / (0.15 * len)));
  return out;
}

export const VOICES = { epiano, bass, pluck, bell, celesta, vibes, marimba, zither, airy, pad, drone, tabla, kick, brushSnare, rim, hat, shaker, wood, jingle };
