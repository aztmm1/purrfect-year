// Purrfect Year soundtrack: DSP core (plain Node ES module, no packages).
//
// Time model: one entry's soundtrack is a 240 s loop of N_LOOP samples. Any
// window of it is rendered on its own: everything is a pure function of the
// absolute loop sample index (counter-based noise, LFOs with a whole number of
// cycles per loop, event lists that wrap) and every stateful processor (IIR
// filters, reverb, compressor, limiter) runs over a pre-roll before the window
// so its state has converged. A window is therefore the same audio as the same
// stretch of a full-loop render, and the full loop is seamless.

export const SR = 48000;
export const LOOP = 240;
export const N_LOOP = SR * LOOP;
export const TAU = 2 * Math.PI;

// ---------------------------------------------------------------- hashing
export function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}
export function mix32(x) {
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}
/** hash of two integers (u32) */
export const h2 = (a, b) => mix32(Math.imul(a | 0, 0x9e3779b1) ^ mix32((b | 0) + 0x632be5ab));
/** hash of three integers (u32) */
export const h3 = (a, b, c) => h2(h2(a, b), c);
/** uniform [0,1) from a u32 */
export const u01 = (h) => h / 4294967296;
/** wrap an absolute sample index into the loop */
export const wrapN = (i) => ((i % N_LOOP) + N_LOOP) % N_LOOP;
/** wrap seconds into the loop */
export const wrapT = (t) => ((t % LOOP) + LOOP) % LOOP;

// ---------------------------------------------------------------- RNG
export class RNG {
  constructor(seed) {
    this.seedStr = String(seed);
    this.s = typeof seed === 'number' ? mix32(seed >>> 0) | 0 || 0x9e3779b9 : hashStr(this.seedStr) || 0x9e3779b9;
  }
  next() { // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uni(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  gauss() {
    let u = 0;
    while (u === 0) u = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * this.next());
  }
  exp(mean) { return -Math.log(1 - this.next()) * mean; }
  logn(sigma) { return Math.exp(sigma * this.gauss()); }
  /** weighted pick: items [[value, weight], ...] */
  wpick(items) {
    let tot = 0;
    for (const it of items) tot += it[1];
    let r = this.next() * tot;
    for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
    return items[items.length - 1][0];
  }
  /** independent sub-stream: adding a layer never changes another layer */
  fork(label) { return new RNG(this.seedStr + '/' + label); }
}

// ---------------------------------------------------------------- helpers
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const db = (x) => Math.pow(10, x / 20);
export const todb = (g) => 20 * Math.log10(Math.max(Math.abs(g), 1e-12));
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** raised-cosine ramp 0..1 for x in [0,1] */
export const rc = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * x));
export function panGains(p) {
  const a = (clamp(p, -1, 1) + 1) * Math.PI / 4;
  return [Math.cos(a), Math.sin(a)];
}
/** a frequency with a whole number of cycles per loop (exactly periodic) */
export const loopFreq = (f) => Math.max(1, Math.round(f * LOOP)) / LOOP;

// ---------------------------------------------------------------- sine table
const TS = 4096;
export const SIN = new Float64Array(TS + 1);
for (let i = 0; i <= TS; i++) SIN[i] = Math.sin((TAU * i) / TS);
/** sin(2*pi*p) for a phase p in cycles (any real) */
export function sinc1(p) {
  let x = p - Math.floor(p);
  x *= TS;
  const i = x | 0;
  return SIN[i] + (x - i) * (SIN[i + 1] - SIN[i]);
}

// ---------------------------------------------------------------- wavetables
/** one band-limited cycle (2048 + 1 guard) from harmonic amplitudes amps[h-1] (and phases) */
export function makeTable(amps, phases) {
  const L = 2048;
  const tab = new Float64Array(L + 1);
  for (let h = 1; h <= amps.length; h++) {
    const a = amps[h - 1];
    if (!a) continue;
    const ph = phases ? phases[h - 1] : 0;
    for (let i = 0; i < L; i++) tab[i] += a * sinc1((h * i) / L + ph);
  }
  tab[L] = tab[0];
  return tab;
}
export function tabRead(tab, p) {
  let x = p - Math.floor(p);
  x *= 2048;
  const i = x | 0;
  return tab[i] + (x - i) * (tab[i + 1] - tab[i]);
}

// ---------------------------------------------------------------- biquads
/** RBJ cookbook coefficients [b0, b1, b2, a1, a2] */
export function bq(type, f, q = Math.SQRT1_2, gainDb = 0) {
  const w0 = (TAU * Math.min(f, SR * 0.45)) / SR;
  const cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'peak': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
    }
    default: throw new Error('biquad type ' + type);
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
/** run a biquad (TDF-II) in place over buf[off, off+len) */
export function runBQ(buf, c, off = 0, len = buf.length - off, st = [0, 0]) {
  const b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4];
  let z1 = st[0], z2 = st[1];
  const end = off + len;
  for (let i = off; i < end; i++) {
    const x = buf[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    buf[i] = y;
  }
  st[0] = z1; st[1] = z2;
  return buf;
}
/** specs: [['lp', f, q], ['hp', f], ['peak', f, q, gainDb], ...] run in place, fresh state */
export function chain(buf, specs) {
  for (const s of specs) runBQ(buf, bq(s[0], s[1], s[2] == null ? Math.SQRT1_2 : s[2], s[3] || 0));
  return buf;
}
export function chainStereo(st, specs) { chain(st.L, specs); chain(st.R, specs); return st; }

/** Topology-preserving state variable filter (Zavalishin); safe to modulate. */
export class SVF {
  constructor(f = 1000, q = 0.707) { this.ic1 = 0; this.ic2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; this.set(f, q); }
  set(f, q) {
    const g = Math.tan((Math.PI * Math.min(f, SR * 0.45)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  process(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2;
    return v2;
  }
}
export class OnePole {
  constructor(fc) { this.y = 0; this.set(fc); }
  set(fc) { this.a = 1 - Math.exp((-TAU * fc) / SR); }
  process(x) { this.y += this.a * (x - this.y); return this.y; }
}

// ---------------------------------------------------------------- stereo buffers
export class Stereo {
  constructor(n) { this.n = n; this.L = new Float32Array(n); this.R = new Float32Array(n); }
  /** add a mono source whose sample 0 sits at buffer position `pos` (clipped to the buffer) */
  addMono(src, pos, gain = 1, pan = 0) {
    const [gl, gr] = panGains(pan);
    addInto(this.L, src, pos, gain * gl);
    addInto(this.R, src, pos, gain * gr);
  }
  addStereo(sL, sR, pos, gain = 1) { addInto(this.L, sL, pos, gain); addInto(this.R, sR, pos, gain); }
  mix(o, g = 1) {
    const n = this.n, L = this.L, R = this.R, oL = o.L, oR = o.R;
    for (let i = 0; i < n; i++) { L[i] += oL[i] * g; R[i] += oR[i] * g; }
    return this;
  }
  scale(g) { for (let i = 0; i < this.n; i++) { this.L[i] *= g; this.R[i] *= g; } return this; }
}
export function addInto(dst, src, pos, g) {
  const n = dst.length;
  let k0 = 0;
  if (pos < 0) k0 = -pos;
  const k1 = Math.min(src.length, n - pos);
  for (let k = k0; k < k1; k++) dst[pos + k] += src[k] * g;
}

// ---------------------------------------------------------------- noise (counter based)
/** white noise in [-1,1) at absolute sample index i (wrapped into the loop) */
export function whiteAt(seed, i) {
  return mix32(seed ^ Math.imul(wrapN(i), 0x9e3779b1)) / 2147483648 - 1;
}
/** fill out[k] = white(seed, i0 + k) */
export function whiteFill(out, seed, i0) {
  const n = out.length;
  let j = wrapN(i0);
  for (let k = 0; k < n; k++) {
    let x = seed ^ Math.imul(j, 0x9e3779b1);
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
    out[k] = (x >>> 0) / 2147483648 - 1;
    if (++j === N_LOOP) j = 0;
  }
  return out;
}
/** pink-ish noise (Paul Kellet's refined filter) over a range; warm with the pre-roll */
export function pinkFill(out, seed, i0) {
  whiteFill(out, seed, i0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let k = 0; k < out.length; k++) {
    const x = out[k];
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    out[k] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
  }
  return out;
}

// ---------------------------------------------------------------- control curves
/**
 * Smooth, exactly periodic random curve over the loop (zero mean, about unit
 * std): a sum of sines with a whole number of cycles per loop and a Gaussian
 * spectrum of width fc Hz. Evaluated lazily on a 100 Hz grid.
 */
export class Curve {
  constructor(seed, fc) {
    const r = new RNG('curve/' + seed);
    const K = Math.max(1, Math.ceil(fc * 2.5 * LOOP));
    this.w = new Float64Array(K); this.a = new Float64Array(K); this.p = new Float64Array(K);
    let var2 = 0;
    for (let k = 1; k <= K; k++) {
      const f = k / LOOP;
      const a = Math.exp(-0.5 * (f / fc) * (f / fc)) * r.gauss();
      this.w[k - 1] = k; this.a[k - 1] = a; this.p[k - 1] = r.uni(0, 1);
      var2 += a * a / 2;
    }
    const sd = Math.sqrt(var2) || 1;
    for (let k = 0; k < K; k++) this.a[k] /= sd;
    this.cache = new Map();
  }
  /** value at loop time t (seconds) */
  at(t) {
    const u = wrapT(t) / LOOP;
    let v = 0;
    const w = this.w, a = this.a, p = this.p;
    for (let k = 0; k < w.length; k++) v += a[k] * sinc1(w[k] * u + p[k]);
    return v;
  }
  grid(g) { // value at grid point g (100 Hz), cached
    const G = LOOP * 100;
    const j = ((g % G) + G) % G;
    let v = this.cache.get(j);
    if (v === undefined) { v = this.at(j / 100); this.cache.set(j, v); }
    return v;
  }
  /** fill out[k] with the curve at absolute sample i0 + k (linear interpolation of the grid) */
  fill(out, i0, map) {
    const n = out.length;
    const step = SR / 100;
    let g = Math.floor(i0 / step);
    let v0 = this.grid(g), v1 = this.grid(g + 1);
    let fr = (i0 - g * step) / step;
    const df = 1 / step;
    for (let k = 0; k < n; k++) {
      const v = v0 + (v1 - v0) * fr;
      out[k] = map ? map(v) : v;
      fr += df;
      if (fr >= 1) { fr -= 1; g++; v0 = v1; v1 = this.grid(g + 1); }
    }
    return out;
  }
}

// ---------------------------------------------------------------- reverb (streaming FDN)
export class FDN {
  constructor(o = {}) {
    const size = o.size || 1;
    this.rt60 = o.rt60 || 1.8;
    const base = [1031, 1327, 1523, 1801, 2063, 2297, 2539, 2803];
    this.lens = base.map((l) => Math.round(l * size));
    this.lines = this.lens.map((l) => new Float64Array(l));
    this.ptr = new Int32Array(8);
    this.g = this.lens.map((l) => Math.pow(10, (-3 * l) / (this.rt60 * SR)));
    this.dA = 1 - Math.exp((-TAU * (o.damp || 4000)) / SR);
    this.dS = new Float64Array(8);
    this.hp = bq('hp', o.hp || 180, 0.7);
    this.hpS = [[0, 0], [0, 0]];
    this.lp = bq('lp', o.lpIn || 9000, 0.7);
    this.lpS = [[0, 0], [0, 0]];
    const apL = [[142, 379, 607], [151, 397, 631]].map((a) => a.map((l) => Math.round(l * size)));
    this.ap = apL.map((a) => a.map((l) => ({ b: new Float64Array(l), p: 0 })));
    this.pre = Math.max(1, Math.round((o.predelay || 0.02) * SR));
    this.pb = [new Float64Array(this.pre), new Float64Array(this.pre)];
    this.pp = 0;
  }
  /** process stereo input arrays into output arrays (adds wet into outL/outR scaled by g) */
  process(inL, inR, outL, outR, g = 1) {
    const n = inL.length;
    const lines = this.lines, lens = this.lens, ptr = this.ptr, gg = this.g, dS = this.dS, dA = this.dA;
    const y = new Float64Array(8), v = new Float64Array(8);
    const sL = [1, -1, 1, 1, -1, 1, -1, -1], sR = [1, 1, -1, 1, 1, -1, -1, 1];
    const norm = 1 / Math.sqrt(8);
    const hp = this.hp, lp = this.lp;
    const apg = 0.62;
    const pbL = this.pb[0], pbR = this.pb[1];
    const one = (x, c, s) => { const yy = c[0] * x + s[0]; s[0] = c[1] * x - c[3] * yy + s[1]; s[1] = c[2] * x - c[4] * yy; return yy; };
    const runAP = (ch, x) => {
      for (const a of ch) {
        const d = a.b[a.p]; const w = x + apg * d; const o = d - apg * w; a.b[a.p] = w; if (++a.p === a.b.length) a.p = 0; x = o;
      }
      return x;
    };
    for (let i = 0; i < n; i++) {
      // pre-delay
      const dl = pbL[this.pp], dr = pbR[this.pp];
      pbL[this.pp] = inL[i]; pbR[this.pp] = inR[i];
      if (++this.pp === this.pre) this.pp = 0;
      const xl = runAP(this.ap[0], one(one(dl, hp, this.hpS[0]), lp, this.lpS[0]));
      const xr = runAP(this.ap[1], one(one(dr, hp, this.hpS[1]), lp, this.lpS[1]));
      for (let k = 0; k < 8; k++) {
        y[k] = lines[k][ptr[k]];
        dS[k] += dA * (y[k] - dS[k]);
        v[k] = dS[k] * gg[k];
      }
      for (let h = 1; h < 8; h <<= 1)
        for (let a = 0; a < 8; a += h << 1)
          for (let b = a; b < a + h; b++) { const p = v[b], q = v[b + h]; v[b] = p + q; v[b + h] = p - q; }
      for (let k = 0; k < 8; k++) {
        lines[k][ptr[k]] = v[k] * norm + ((k & 1) ? xr : xl) * 0.5;
        if (++ptr[k] === lens[k]) ptr[k] = 0;
      }
      let l = 0, r = 0;
      for (let k = 0; k < 8; k++) { l += y[k] * sL[k]; r += y[k] * sR[k]; }
      outL[i] += l * norm * g; outR[i] += r * norm * g;
    }
  }
}

// ---------------------------------------------------------------- dynamics
/** feed-forward stereo-linked soft-knee compressor with an absolute threshold (dBFS) */
export function compress(st, o) {
  const n = st.n, ratio = o.ratio || 2.5, knee = o.knee || 6, thr = o.thr;
  const aA = Math.exp(-1 / ((o.attack || 0.005) * SR)), aR = Math.exp(-1 / ((o.release || 0.2) * SR));
  const la = Math.round((o.lookahead == null ? 0.003 : o.lookahead) * SR);
  const gr = new Float32Array(n);
  let env = 0;
  const L = st.L, R = st.R;
  for (let i = 0; i < n; i++) {
    const j = Math.min(n - 1, i + la);
    const x = Math.max(Math.abs(L[j]), Math.abs(R[j]));
    env = x > env ? aA * env + (1 - aA) * x : aR * env + (1 - aR) * x;
    const over = todb(env) - thr;
    gr[i] = over <= -knee / 2 ? 0 : over >= knee / 2 ? over * (1 - 1 / ratio) : ((1 - 1 / ratio) * (over + knee / 2) ** 2) / (2 * knee);
  }
  // smooth the gain curve (no zipper)
  let y = 0;
  const a = 1 - Math.exp((-TAU * 120) / SR);
  for (let i = 0; i < n; i++) {
    y += a * (gr[i] - y);
    const k = Math.pow(10, -y / 20);
    L[i] *= k; R[i] *= k;
  }
}
/**
 * Lookahead peak limiter: never lets |x| exceed `ceil` (linear). Attenuation
 * is held over +-la samples and box-smoothed (smooth attack), then released
 * exponentially in dB. Deterministic and window-consistent (state converges).
 */
export function limit(st, ceilDb, o = {}) {
  const n = st.n, L = st.L, R = st.R;
  const la = Math.round((o.lookahead || 0.004) * SR);
  const relDbPerSample = (o.releaseDbPerSec || 12) / SR;
  const ceil = db(ceilDb);
  const att = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (x > ceil) { att[i] = todb(x / ceil) + 0.05; any = true; }
  }
  if (!any) return 0;
  // sliding max over [i-la, i+la] (monotonic deque)
  const W = 2 * la + 1;
  const hold = new Float32Array(n);
  const dq = new Int32Array(n);
  let h = 0, t = 0;
  for (let i = 0; i < n + la; i++) {
    if (i < n) {
      while (t > h && att[dq[t - 1]] <= att[i]) t--;
      dq[t++] = i;
    }
    const c = i - la;
    if (c >= 0) {
      while (dq[h] < c - la) h++;
      hold[c] = att[dq[h]];
    }
  }
  // box smoothing over W samples (centered)
  const sm = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n + la; i++) {
    if (i < n) acc += hold[i];
    if (i - W >= 0) acc -= hold[i - W];
    const c = i - la;
    if (c >= 0) sm[c] = acc / W;
  }
  let r = 0, maxA = 0;
  for (let i = 0; i < n; i++) {
    r = Math.max(sm[i], r - relDbPerSample);
    if (r > maxA) maxA = r;
    if (r > 0) { const k = Math.pow(10, -r / 20); L[i] *= k; R[i] *= k; }
  }
  return maxA;
}

// ---------------------------------------------------------------- loudness (ITU-R BS.1770-4, 48 kHz)
export const HOP = SR / 10; // 100 ms
/** K-weighted mean-square per 100 ms hop over buf positions [off, off + hops*HOP) (filters warmed from 0) */
export function kHops(L, R, off, hops) {
  const out = new Float64Array(hops);
  const c1 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const c2 = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];
  const end = off + hops * HOP;
  for (const x of [L, R]) {
    let z1 = 0, z2 = 0, w1 = 0, w2 = 0;
    for (let i = 0; i < end; i++) {
      const v = x[i];
      const y = c1[0] * v + z1; z1 = c1[1] * v - c1[3] * y + z2; z2 = c1[2] * v - c1[4] * y;
      const u = c2[0] * y + w1; w1 = c2[1] * y - c2[3] * u + w2; w2 = c2[2] * y - c2[4] * u;
      if (i >= off) out[((i - off) / HOP) | 0] += u * u;
    }
  }
  for (let k = 0; k < hops; k++) out[k] /= HOP;
  return out;
}
/** gated integrated loudness from 100 ms hop powers (circular: the loop wraps) */
export function lufsFromHops(hops, circular = true) {
  const n = hops.length;
  const blocks = [];
  const nb = circular ? n : n - 3;
  for (let k = 0; k < nb; k++) {
    const z = (hops[k] + hops[(k + 1) % n] + hops[(k + 2) % n] + hops[(k + 3) % n]) / 4;
    blocks.push(z);
  }
  const L = (z) => -0.691 + 10 * Math.log10(z + 1e-30);
  const g1 = blocks.filter((z) => L(z) > -70);
  if (!g1.length) return -Infinity;
  const m1 = g1.reduce((s, z) => s + z, 0) / g1.length;
  const gate = L(m1) - 10;
  const g2 = g1.filter((z) => L(z) > gate);
  return L(g2.reduce((s, z) => s + z, 0) / g2.length);
}
export function maxMomentaryFromHops(hops, circular = true) {
  const n = hops.length;
  let m = 0;
  const nb = circular ? n : n - 3;
  for (let k = 0; k < nb; k++) m = Math.max(m, (hops[k] + hops[(k + 1) % n] + hops[(k + 2) % n] + hops[(k + 3) % n]) / 4);
  return -0.691 + 10 * Math.log10(m + 1e-30);
}
/** plain (non-circular) integrated loudness of a stereo buffer */
export function lufs(L, R) {
  const hops = Math.floor(L.length / HOP);
  if (hops < 4) return -Infinity;
  return lufsFromHops(kHops(L, R, 0, hops), false);
}
/** 4x oversampled true-peak estimate in dBTP (windowed sinc) */
export function truePeak(L, R) {
  const taps = 12, phases = [0.25, 0.5, 0.75];
  const coefs = phases.map((p) => {
    const c = [];
    for (let k = -taps + 1; k <= taps; k++) {
      const t = k - p, x = Math.PI * t;
      const s = Math.abs(t) < 1e-9 ? 1 : Math.sin(x) / x;
      const w = 0.42 + 0.5 * Math.cos((Math.PI * t) / taps) + 0.08 * Math.cos((2 * Math.PI * t) / taps);
      c.push(s * w);
    }
    return Float64Array.from(c);
  });
  let pk = 0;
  for (const x of [L, R]) {
    const n = x.length;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(x[i]);
      if (a > pk) pk = a;
      if (a < pk * 0.5) continue; // cannot overshoot that far
      for (const c of coefs) {
        let v = 0;
        for (let k = 0; k < c.length; k++) { const j = i + k - taps + 1; if (j >= 0 && j < n) v += x[j] * c[k]; }
        if (Math.abs(v) > pk) pk = Math.abs(v);
      }
    }
  }
  return todb(pk);
}

// ---------------------------------------------------------------- resampling
/** windowed-sinc resampler: input at SR, output at `rate`; x has `pad` extra samples each side */
export function resample(x, rate, pad, outLen, t0Frac = 0) {
  const ratio = SR / rate;
  const out = new Float32Array(outLen);
  const half = 24;
  const fc = Math.min(1, rate / SR) * 0.94;
  const beta = 8.6;
  const i0 = (z) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (z / (2 * k)) ** 2; s += t; } return s; };
  const ib = i0(beta);
  const kern = (d) => {
    if (Math.abs(d) >= half) return 0;
    const s = d === 0 ? fc : Math.sin(Math.PI * fc * d) / (Math.PI * d);
    const r = d / half;
    return s * i0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / ib;
  };
  // tabulate the kernel at 1/256 steps
  const RES = 256, KL = half * RES;
  const tab = new Float64Array(2 * KL + 2);
  for (let k = -KL; k <= KL + 1; k++) tab[k + KL] = kern(k / RES);
  for (let m = 0; m < outLen; m++) {
    const pos = pad + t0Frac + m * ratio;
    const c = Math.floor(pos), fr = pos - c;
    let v = 0;
    for (let j = c - half + 1; j <= c + half; j++) {
      if (j < 0 || j >= x.length) continue;
      const d = (j - pos) * RES + KL;
      const di = Math.floor(d), df = d - di;
      v += x[j] * (tab[di] + df * (tab[di + 1] - tab[di]));
    }
    out[m] = v;
  }
  return out;
}

// ---------------------------------------------------------------- WAV
/** 16-bit PCM stereo WAV with deterministic TPDF dither keyed on the absolute loop index */
export function wav16(L, R, rate, ditherSeed = 0x5eed, idx0 = 0) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const j = idx0 + i;
    for (let c = 0; c < 2; c++) {
      const x = c ? R[i] : L[i];
      const d = (u01(h3(ditherSeed, j, c * 2)) - u01(h3(ditherSeed, j, c * 2 + 1))); // TPDF, +-1 LSB
      let q = Math.round(x * 32767 + d);
      if (q > 32767) q = 32767; else if (q < -32768) q = -32768;
      buf.writeInt16LE(q, o); o += 2;
    }
  }
  return buf;
}
export function readWav(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a wav');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    let sz = b.readUInt32LE(o + 4);
    if (id === 'data' && (sz === 0 || sz === 0xffffffff || o + 8 + sz > b.length)) sz = b.length - o - 8;
    if (id === 'fmt ') {
      let tag = b.readUInt16LE(o + 8);
      if (tag === 0xfffe) tag = b.readUInt16LE(o + 8 + 24);
      fmt = { tag, ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    } else if (id === 'data') data = { off: o + 8, len: sz };
    o += 8 + sz + (sz & 1);
  }
  const bps = fmt.bits / 8, frames = Math.floor(data.len / (bps * fmt.ch));
  const ch = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < fmt.ch; c++) {
      const p = data.off + (i * fmt.ch + c) * bps;
      let v;
      if (fmt.tag === 3) v = fmt.bits === 32 ? b.readFloatLE(p) : b.readDoubleLE(p);
      else if (fmt.bits === 16) v = b.readInt16LE(p) / 32768;
      else if (fmt.bits === 24) v = b.readIntLE(p, 3) / 8388608;
      else v = b.readInt32LE(p) / 2147483648;
      ch[c][i] = v;
    }
  return { sr: fmt.sr, L: ch[0], R: ch[1] || ch[0] };
}
