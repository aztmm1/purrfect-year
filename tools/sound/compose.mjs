// Procedural lofi composition for one diary entry: its music colour comes from
// a seed (key, tempo, progressions, melody motif, arrangement), the instrument
// palette from the entry's season and story. Output: a list of note events
// over the 240 s loop (loop time in seconds; events near the end wrap).
import { RNG, LOOP, clamp } from './dsp.mjs';

export const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const QUAL = {
  maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], 'maj7#11': [0, 4, 7, 11, 18], '6/9': [0, 4, 7, 9, 14], add9: [0, 4, 7, 14],
  m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14], m11: [0, 3, 7, 10, 14, 17], m6: [0, 3, 7, 9], m7b5: [0, 3, 6, 10], madd9: [0, 3, 7, 14],
  7: [0, 4, 7, 10], 9: [0, 4, 7, 10, 14], 13: [0, 4, 7, 10, 14, 21], '7alt': [0, 4, 10, 13, 20], '7b13': [0, 4, 7, 10, 20],
  '9sus4': [0, 5, 7, 10, 14], '13sus4': [0, 5, 10, 14, 21], sus2: [0, 2, 7, 14], '6sus2': [0, 2, 7, 9],
};
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], penta: [0, 2, 4, 7, 9], mpenta: [0, 3, 5, 7, 10],
};

// 8-bar progressions: [semitones above the tonic, quality, bars]
const LIB = {
  major: [
    [[0, 'maj9', 2], [9, 'm9', 2], [5, 'maj9', 2], [7, '13sus4', 1], [7, '13', 1]],
    [[0, 'maj7', 1], [4, 'm7', 1], [9, 'm9', 2], [2, 'm9', 2], [7, '9sus4', 2]],
    [[5, 'maj9', 2], [4, 'm7', 2], [2, 'm9', 2], [0, 'maj9', 2]],
    [[0, 'maj9', 2], [2, 'm9', 1], [7, '13', 1], [4, 'm7', 1], [9, 'm9', 1], [2, 'm9', 1], [7, '9sus4', 1]],
    [[0, 'maj9', 2], [5, 'maj7#11', 2], [4, 'm7', 1], [9, 'm9', 1], [2, 'm9', 1], [7, '13sus4', 1]],
    [[9, 'm9', 2], [5, 'maj9', 2], [0, 'maj9', 2], [7, '9sus4', 2]],
    [[5, 'maj9', 1], [7, '9sus4', 1], [4, 'm7', 1], [9, 'm9', 1], [2, 'm9', 2], [7, '13sus4', 1], [7, '13', 1]],
    [[0, '6/9', 2], [4, 'm7', 2], [5, 'maj9', 2], [2, 'm9', 1], [7, '9sus4', 1]],
  ],
  minor: [
    [[0, 'm9', 2], [8, 'maj7', 2], [5, 'm9', 2], [7, '7alt', 2]],
    [[0, 'm9', 2], [5, 'm9', 2], [10, '13', 2], [3, 'maj9', 1], [7, '7alt', 1]],
    [[0, 'm11', 2], [8, 'maj9', 2], [3, 'maj7', 2], [10, '9sus4', 2]],
    [[0, 'm9', 2], [8, 'maj7#11', 2], [2, 'm7b5', 1], [7, '7b13', 1], [0, 'm9', 1], [7, '7alt', 1]],
    [[5, 'm9', 2], [10, '13', 2], [3, 'maj9', 2], [8, 'maj7', 1], [7, '7alt', 1]],
  ],
  dorian: [
    [[0, 'm9', 2], [5, '9', 2], [0, 'm11', 2], [10, 'maj7', 2]],
    [[0, 'm9', 2], [3, 'maj7', 2], [5, '13', 2], [7, 'm7', 1], [10, '6/9', 1]],
    [[8, 'maj7', 2], [10, '6/9', 2], [0, 'm9', 2], [5, '9sus4', 2]],
  ],
  penta: [ // chords that sit under a major pentatonic tune
    [[0, '6/9', 2], [9, 'm7', 2], [5, 'add9', 2], [7, '6sus2', 2]],
    [[0, 'add9', 2], [2, 'm7', 2], [9, 'm7', 2], [7, 'sus2', 2]],
    [[5, 'add9', 2], [0, '6/9', 2], [9, 'm7', 1], [4, 'm7', 1], [7, '6sus2', 2]],
  ],
  modal: [ // over a tonic drone (every chord holds the tonic or the fifth)
    [[0, '6/9', 4], [5, 'maj9', 2], [7, '9sus4', 2]],
    [[0, 'maj9', 2], [2, 'm9', 2], [5, 'maj9', 2], [0, '6/9', 2]],
    [[0, '6/9', 2], [10, 'maj7', 2], [5, 'add9', 2], [7, '9sus4', 2]],
  ],
};

// ---------------------------------------------------------------- the palette of each entry
// keys: candidate tonics; bpms: candidate tempos (bars per loop = bpm, so a
// multiple of 4 keeps whole phrases); lib: progression family; sparse: how
// lonely the arrangement is (0 full .. 1 sparse)
const BRUSH = { kit: 'brush', top: 'none', swirl: 0.6 };
const STYLES = {
  diwali: { lib: 'modal', scale: 'penta', keys: ['D', 'E', 'C#'], bpms: [72, 76], keysV: null, pad: 'warm', lead: { v: 'bell', lo: 67, hi: 84, density: 0.55, vel: 0.5 }, color: { v: 'zither', pat: 'sparse', lo: 62, hi: 79, vel: 0.36 }, drone: true, drums: { kit: 'tabla', top: 'none' }, sparse: 0.2, swing: [0.56, 0.6] },
  halloween25: { lib: 'minor', scale: 'minor', keys: ['D', 'E', 'A'], bpms: [72, 76], keysV: 'epiano', pad: 'warm', lead: { v: 'epiano', lo: 65, hi: 79, density: 0.55, vel: 0.42 }, color: null, drums: BRUSH, sparse: 0.15, swing: [0.6, 0.63] },
  thanksgiving: { lib: 'major', scale: 'major', keys: ['F', 'Bb', 'Eb'], bpms: [76, 80], keysV: 'epiano', pad: 'warm', lead: { v: 'epiano', lo: 65, hi: 81, density: 0.6, vel: 0.42 }, color: { v: 'pluck', pat: 'arp', lo: 57, hi: 76, vel: 0.5 }, drums: { kit: 'brush', top: 'shaker', swirl: 0.3 }, sparse: 0, swing: [0.58, 0.62] },
  christmas: { lib: 'major', scale: 'major', keys: ['Eb', 'D', 'G'], bpms: [72, 76], keysV: 'epiano', keysSoft: true, pad: 'warm', lead: { v: 'celesta', lo: 72, hi: 88, density: 0.6, vel: 0.5 }, color: { v: 'bell', pat: 'bells', lo: 67, hi: 84, vel: 0.42 }, drums: { kit: 'brush', top: 'jingle', swirl: 0.4 }, sparse: 0.05, swing: [0.57, 0.6] },
  newyear: { lib: 'major', scale: 'major', keys: ['A', 'Bb', 'C'], bpms: [76, 80], keysV: 'epiano', pad: 'glass', lead: { v: 'bell', lo: 69, hi: 86, density: 0.55, vel: 0.45, short: true }, color: { v: 'celesta', pat: 'arp', lo: 72, hi: 91, vel: 0.36 }, drums: { kit: 'rim', top: 'hat' }, sparse: 0, swing: [0.56, 0.59] },
  lunar: { lib: 'penta', scale: 'penta', keys: ['F', 'G', 'D'], bpms: [72, 76], keysV: null, pad: 'warm', lead: { v: 'zither', lo: 65, hi: 84, density: 0.65, vel: 0.55, bend: true }, color: { v: 'zither', pat: 'sparse', lo: 55, hi: 74, vel: 0.36 }, drums: { kit: 'wood', top: 'shaker' }, sparse: 0.1, swing: [0.55, 0.58] },
  easter: { lib: 'major', scale: 'major', keys: ['G', 'D', 'A'], bpms: [80, 84], keysV: 'epiano', bright: true, pad: 'oo', lead: { v: 'airy', lo: 67, hi: 84, density: 0.6, vel: 0.45 }, color: { v: 'pluck', pat: 'arp', lo: 59, hi: 79, vel: 0.52 }, drums: { kit: 'rim', top: 'hat' }, sparse: 0, swing: [0.55, 0.58] },
  midsummer: { lib: 'major', scale: 'lydian', keys: ['E', 'D', 'F#'], bpms: [76, 80], keysV: 'epiano', bright: true, pad: 'ah', lead: { v: 'airy', lo: 66, hi: 83, density: 0.55, vel: 0.44 }, color: { v: 'vibes', pat: 'arp', lo: 62, hi: 81, vel: 0.4 }, drums: { kit: 'brush', top: 'shaker', swirl: 0.2 }, sparse: 0.05, swing: [0.57, 0.6] },
  match: { lib: 'major', scale: 'major', keys: ['C', 'Bb', 'A'], bpms: [80, 84], keysV: 'epiano', bright: true, pad: 'oo', lead: { v: 'airy', lo: 67, hi: 84, density: 0.6, vel: 0.45 }, color: { v: 'marimba', pat: 'arp', lo: 60, hi: 79, vel: 0.45 }, drums: { kit: 'rim', top: 'hat' }, sparse: 0, swing: [0.55, 0.58] },
  nyc: { lib: 'major', scale: 'major', keys: ['Db', 'Eb', 'Ab'], bpms: [72, 76], keysV: 'epiano', pad: 'oo', lead: { v: 'airy', lo: 65, hi: 82, density: 0.55, vel: 0.44 }, color: { v: 'vibes', pat: 'broken', lo: 63, hi: 82, vel: 0.38 }, drums: { kit: 'brush', top: 'none', swirl: 0.4 }, sparse: 0, swing: [0.6, 0.63] },
  la: { lib: 'major', scale: 'major', keys: ['A', 'E', 'G'], bpms: [80, 84], keysV: 'epiano', bright: true, pad: 'ah', lead: { v: 'airy', lo: 66, hi: 83, density: 0.55, vel: 0.44 }, color: { v: 'pluck', pat: 'arp', lo: 59, hi: 79, vel: 0.5 }, drums: { kit: 'rim', top: 'shaker' }, sparse: 0, swing: [0.55, 0.58] },
  sandiego: { lib: 'major', scale: 'major', keys: ['A', 'F', 'D'], bpms: [76, 80], keysV: 'epiano', bright: true, pad: 'oo', lead: { v: 'airy', lo: 66, hi: 83, density: 0.55, vel: 0.44 }, color: { v: 'marimba', pat: 'broken', lo: 60, hi: 79, vel: 0.45 }, drums: { kit: 'brush', top: 'shaker' }, sparse: 0, swing: [0.57, 0.6] },
  dc: { lib: 'major', scale: 'major', keys: ['F', 'Bb', 'G'], bpms: [76, 80], keysV: 'epiano', pad: 'oo', lead: { v: 'airy', lo: 65, hi: 82, density: 0.55, vel: 0.44 }, color: { v: 'vibes', pat: 'arp', lo: 62, hi: 81, vel: 0.4 }, drums: { kit: 'brush', top: 'shaker', swirl: 0.2 }, sparse: 0, swing: [0.57, 0.6] },
  home: { lib: 'major', scale: 'major', keys: ['E', 'Ab', 'Db'], bpms: [72, 76], keysV: 'epiano', pad: 'ah', lead: { v: 'airy', lo: 64, hi: 81, density: 0.45, vel: 0.42 }, color: { v: 'pluck', pat: 'broken', lo: 57, hi: 76, vel: 0.48 }, drums: { kit: 'brush', top: 'none', swirl: 0.3 }, sparse: 0.2, swing: [0.58, 0.61] },
  harvest: { lib: 'dorian', scale: 'dorian', keys: ['B', 'A', 'F#'], bpms: [72], keysV: 'epiano', pad: 'warm', lead: { v: 'epiano', lo: 64, hi: 79, density: 0.35, vel: 0.4 }, color: { v: 'pluck', pat: 'sparse', lo: 57, hi: 74, vel: 0.42 }, drums: { kit: 'rim', top: 'none' }, sparse: 0.75, swing: [0.58, 0.61] },
  halloween: { lib: 'minor', scale: 'minor', keys: ['C', 'B', 'F'], bpms: [72], keysV: 'epiano', pad: 'warm', lead: { v: 'epiano', lo: 63, hi: 78, density: 0.3, vel: 0.4 }, color: null, drums: { kit: 'brush', top: 'none', swirl: 0.5 }, sparse: 0.85, swing: [0.6, 0.63] },
};

// e-piano and lofi bus colour
function colourFor(id, st, r) {
  const jit = (x, p) => x * (1 + p * (r.next() * 2 - 1));
  const warm = !st.bright;
  return {
    epIndex: jit(st.keysSoft ? 1.3 : st.bright ? 1.75 : 1.55, 0.1), idxDecay: jit(0.42, 0.15), tine: jit(st.bright ? 0.3 : 0.2, 0.25), tineRatio: 4.5, modRatio: 1, bark: 0.14,
    epDecay: jit(2.5, 0.1), epRelease: 0.4,
    tremRate: jit(warm ? 3.6 : 4.4, 0.12), tremDepth: jit(0.25, 0.2),
    lp: jit(st.bright ? 7200 : 5800, 0.08), shelf: -1.5, drive: 1.2, wowCents: jit(3, 0.2), flutterCents: 0.7,
    bassDecay: 2.3, bassH2: 0.25, bassH3: 0.08, kickHi: 98, kickLo: 54, kickDecay: 0.17,
    brushFc: jit(2500, 0.1), hatFc: 6200, hatLP: 8200, hatDecay: 0.02, shakerFc: 4500,
    pluckBright: 2500, pluckT60: 2.2, pluckLP: 3400,
  };
}

// arrangement: how present each part is in each kind of section
const SECTION = {
  intro: { keys: 0.8, pad: 1, bass: 0, drums: 0, lead: 0, color: 0.6 },
  verse: { keys: 1, pad: 0.6, bass: 1, drums: 0.6, lead: 0, color: 0.8 },
  theme: { keys: 1, pad: 0.5, bass: 1, drums: 1, lead: 1, color: 0.35 },
  bridge: { keys: 1, pad: 0.8, bass: 1, drums: 0.85, lead: 0.5, color: 1 },
  break: { keys: 0.9, pad: 1, bass: 0.4, drums: 0, lead: 0.45, color: 0.8 },
  interlude: { keys: 0.9, pad: 1, bass: 0.6, drums: 0.3, lead: 0, color: 1 },
  outro: { keys: 0.85, pad: 1, bass: 0.6, drums: 0.3, lead: 0, color: 0.5 },
};

function sectionPlan(bars, r) {
  const core = r.chance(0.5)
    ? [['verse', 8, 'A'], ['theme', 8, 'A'], ['bridge', 8, 'B'], ['theme', 8, 'A'], ['break', 8, 'A'], ['bridge', 8, 'B'], ['theme', 8, 'A'], ['verse', 8, 'A']]
    : [['verse', 8, 'A'], ['theme', 8, 'A'], ['theme', 8, 'A'], ['bridge', 8, 'B'], ['break', 8, 'B'], ['theme', 8, 'A'], ['bridge', 8, 'B'], ['theme', 8, 'A']];
  const plan = [['intro', 4, 'A'], ...core];
  let left = bars - 4 - 64 - 4;
  // longer loops (faster tempos) get more sections, inserted before the end
  const extra = [['interlude', 4, 'B'], ['verse', 8, 'A'], ['bridge', 8, 'B'], ['theme', 8, 'A']];
  let k = 0;
  while (left >= 4) {
    const e = extra[k++ % extra.length];
    const len = Math.min(e[1], left >= 8 ? e[1] : 4);
    plan.splice(plan.length - 1, 0, [e[0], len, e[2]]);
    left -= len;
  }
  plan.push(['outro', 4, 'A']);
  if (left > 0) plan[plan.length - 1][1] += left;
  return plan.map(([type, b, prog]) => ({ type, bars: b, prog }));
}

function parse(tonic, deg, q) { return { root: (tonic + deg) % 12, ivs: QUAL[q], q }; }

// ---------------------------------------------------------------- voicing
function priority(iv) {
  const m = iv % 12;
  if (iv < 12 && (m === 3 || m === 4)) return 0;
  if (iv < 12 && (m === 10 || m === 11)) return 1;
  if (iv < 12 && (m === 5 || m === 2)) return 1.5;
  if (iv < 12 && m === 9) return 2;
  if (iv >= 12) return 2.5;
  return 4;
}
function voiceChord(ch, prev, r, o) {
  const lo = o.lo, hi = o.hi, maxN = o.maxNotes || 4;
  const tones = ch.ivs.filter((iv) => iv % 12 !== 0).sort((a, b) => priority(a) - priority(b)).slice(0, maxN);
  const pcs = tones.map((iv) => (ch.root + iv) % 12);
  const opts = pcs.map((pc) => { const res = []; for (let m = lo + (((pc - lo) % 12) + 12) % 12; m <= hi; m += 12) res.push(m); return res; });
  let best = null, bestCost = Infinity;
  const rec = (k, cur) => {
    if (k === opts.length) {
      const v = cur.slice().sort((a, b) => a - b);
      for (let i = 1; i < v.length; i++) if (v[i] === v[i - 1]) return;
      if (v[v.length - 1] - v[0] > 16) return;
      let cost = 0;
      if (v[1] - v[0] < 3 && v[0] < 60) cost += 4;
      for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] === 1) cost += i === v.length - 1 ? 3 : 1.2;
      const center = v.reduce((s, x) => s + x, 0) / v.length;
      cost += 0.25 * Math.abs(center - o.center);
      if (prev) {
        const a = prev.slice().sort((x, y) => x - y);
        for (const x of v) cost += 0.5 * Math.min(...a.map((y) => Math.abs(x - y)));
        cost += 0.15 * Math.abs(v[v.length - 1] - a[a.length - 1]);
      }
      cost += r.uni(0, 0.4);
      if (cost < bestCost) { bestCost = cost; best = v; }
      return;
    }
    for (const m of opts[k]) { cur.push(m); rec(k + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return best || pcs.map((pc) => lo + (((pc - lo) % 12) + 12) % 12);
}
const bassNote = (pc, lo = 33) => lo + (((pc - lo) % 12) + 12) % 12;

// ---------------------------------------------------------------- melody
const MOTIFS = [ // [onset in 8ths from the phrase start, length in 8ths] over 2 bars
  [[1, 2], [3, 3], [6, 6]],
  [[0, 3], [4, 2], [6, 8]],
  [[3, 3], [7, 5], [12, 4]],
  [[2, 2], [4, 4], [10, 5]],
  [[0, 2], [2, 2], [4, 6], [12, 3]],
  [[1, 1], [2, 3], [6, 2], [8, 6]],
  [[0, 4], [5, 1], [6, 6], [13, 3]],
];
const CONTOURS = [[0, 1, 2, -1], [0, -1, -2, 1], [0, 2, 1, 0], [0, 1, -1, -2], [0, -2, -1, 1], [0, 3, 2, 1]];

function makeMelody(ctx, sec, r, density) {
  const { scalePcs, chordAt, t8, M } = ctx;
  const out = [];
  const motif = ctx.motif, contour = ctx.contour;
  let last = ctx.melLast || Math.round((M.lo + M.hi) / 2);
  const nearestScale = (m, dir) => { let x = m; for (let k = 0; k < 12; k++) { if (scalePcs.includes(((x % 12) + 12) % 12)) return x; x += dir || 1; } return m; };
  const stepScale = (m, steps) => {
    let x = m;
    const d = steps > 0 ? 1 : -1;
    for (let s = 0; s < Math.abs(steps); s++) { x += d; while (!scalePcs.includes(((x % 12) + 12) % 12)) x += d; }
    return x;
  };
  for (let ph = 0; ph < sec.bars; ph += 2) {
    const which = (ph / 2) % 4;
    if (!r.chance(density * (which === 3 ? 0.9 : 1))) continue;
    let rh = motif;
    if (which === 2 && r.chance(0.5)) rh = r.pick(MOTIFS);
    if (which === 3) rh = r.chance(0.5) ? motif.slice(0, 2).concat([[motif[1][0] + 2, 8]]) : [[0, 3], [4, 10]];
    const shift = which === 1 ? r.pick([1, 2, -1]) : 0;
    rh.forEach(([on, du], k) => {
      const bar = sec.bar + ph + Math.floor(on / 8);
      if (bar >= sec.bar + sec.bars) return;
      const ch = chordAt(bar);
      const cps = ch.ivs.map((iv) => (ch.root + iv) % 12);
      const strong = on % 4 === 0;
      let m = k === 0 ? last + (shift ? stepScale(last, shift) - last : 0) : stepScale(last, contour[k % contour.length] - contour[(k - 1) % contour.length] || r.pick([1, -1]));
      m = nearestScale(m, 1);
      if (strong || k === 0 || du >= 6) { // land on a chord tone
        let best = m, bd = 99;
        for (let x = m - 4; x <= m + 4; x++) if (cps.includes(((x % 12) + 12) % 12) && Math.abs(x - m) < bd) { bd = Math.abs(x - m); best = x; }
        m = best;
      } else if (cps.includes((((m - 1) % 12) + 12) % 12) && !cps.includes(((m % 12) + 12) % 12)) m = stepScale(m, -1); // avoid notes a half step above a chord tone
      while (m > M.hi) m -= 12;
      while (m < M.lo) m += 12;
      last = m;
      const t = t8(sec.bar + ph, on) + r.gauss() * 0.006;
      out.push({ t, midi: m, vel: M.vel * (strong ? 1 : 0.85) * (1 + 0.08 * r.gauss()), hold: (du * ctx.beat) / 2 * 0.95 });
    });
  }
  ctx.melLast = last;
  return out;
}

// ---------------------------------------------------------------- the score
/**
 * Compose an entry. pic: picture events (for musical accents at story beats).
 * Returns { meta, events: [{stem, t, voice, p, gain, pan, dur, seed}], chords, bpm }
 */
export function compose(ed, pic = {}) {
  const st = STYLES[ed.id] || STYLES.home;
  const seed = 'purrfect-year/v2/' + ed.id;
  const R = new RNG(seed);
  const rs = R.fork('style');
  const keyName = rs.pick(st.keys);
  const tonic = PC[keyName];
  const bpm = rs.pick(st.bpms);
  const bars = bpm; // 4/4 over 240 s: one bar per BPM
  const beat = 60 / bpm, barDur = 4 * beat;
  const swing = rs.uni(st.swing[0], st.swing[1]);
  const C = colourFor(ed.id, st, rs.fork('colour'));
  const lib = LIB[st.lib];
  const ia = rs.int(0, lib.length - 1);
  let ib = rs.int(0, lib.length - 2); if (ib >= ia) ib++;
  const progA = lib[ia], progB = lib[ib];
  const scalePcs = SCALES[st.scale].map((s) => (tonic + s) % 12);
  const plan = sectionPlan(bars, rs.fork('plan'));
  const sparse = st.sparse || 0;

  // chord timeline
  const chords = [];
  let bar = 0;
  plan.forEach((sec) => {
    sec.bar = bar;
    const prog = sec.prog === 'A' ? progA : progB;
    // 4-bar sections take the first half (intro, interlude) or the second half (outro, which leads back to the intro)
    let items = prog.map((c) => c.slice());
    if (sec.bars === 4) {
      const half = [];
      let b = 0;
      for (const c of items) { const s = b, e = b + c[2]; b = e; const a0 = sec.type === 'outro' ? 4 : 0; const lo = Math.max(s, a0), hi = Math.min(e, a0 + 4); if (hi > lo) half.push([c[0], c[1], hi - lo]); }
      items = half;
    }
    let len = items.reduce((s, c) => s + c[2], 0);
    while (len < sec.bars) { items = items.concat(items.map((c) => c.slice())); len *= 2; }
    let b = 0;
    for (const [deg, q, n] of items) {
      if (b >= sec.bars) break;
      const nb = Math.min(n, sec.bars - b);
      chords.push({ ...parse(tonic, deg, q), bar: bar + b, bars: nb, sec });
      b += nb;
    }
    bar += sec.bars;
  });
  if (bar !== bars) throw new Error(`arrangement has ${bar} bars, loop has ${bars}`);
  const chordAt = (b) => { const w = ((b % bars) + bars) % bars; return chords.find((c) => w >= c.bar && w < c.bar + c.bars) || chords[chords.length - 1]; };
  const secAt = (b) => { const w = ((b % bars) + bars) % bars; return plan.find((s) => w >= s.bar && w < s.bar + s.bars); };
  const t8 = (b, e) => b * barDur + Math.floor(e / 2) * beat + (e % 2 ? swing * beat : 0);
  const sw16 = 0.04;
  const t16 = (b, s) => b * barDur + Math.floor(s / 4) * beat + [0, 0.25 + sw16 * 0.5, 0.5, 0.75 + sw16 * 0.5][s % 4] * beat;
  const lvl = (sec, part) => SECTION[sec.type][part] * (part === 'drums' ? 1 - 0.55 * sparse : part === 'lead' ? 1 - 0.3 * sparse : part === 'color' ? 1 - 0.4 * sparse : 1);

  const ev = [];
  let eid = 0;
  const push = (stem, t, voice, p, gain = 1, pan = 0, dur = 1) => ev.push({ stem, t, voice, p, gain, pan, dur, seed: `${seed}/${stem}/${eid++}` });
  const ra = R.fork('arr');

  // voicings with voice leading (twice, so the first chord leads from the last)
  const vo = { lo: 52 + ((tonic + 3) % 12 > 7 ? 1 : 0), hi: 76, center: 63, maxNotes: 4 };
  let prev = null;
  for (let pass = 0; pass < 2; pass++) for (const c of chords) { c.voicing = voiceChord(c, prev, ra.fork('v' + pass + c.bar), vo); prev = c.voicing; }

  // ---- keys: e-piano comping (each strike rings until the next)
  if (st.keysV) {
    const strikes = [];
    const rk = ra.fork('keys');
    chords.forEach((c) => {
      const k = lvl(c.sec, 'keys');
      if (k <= 0) return;
      const push8 = rk.chance(0.4) ? (1 - swing) * beat : 0;
      strikes.push({ t: c.bar * barDur - push8, v: 0.58 * k, c });
      for (let j = 1; j < c.bars; j++) if (rk.chance(0.55 * (1 - 0.5 * sparse))) strikes.push({ t: (c.bar + j) * barDur + (rk.chance(0.5) ? 0 : 2 * beat), v: 0.42 * k, c });
      for (let j = 0; j < c.bars; j++) if (rk.chance(0.15 * (1 - sparse) * (c.sec.type === 'theme' ? 0.5 : 1))) strikes.push({ t: t8(c.bar + j, 5), v: 0.3 * k, c, short: true });
    });
    strikes.sort((a, b) => a.t - b.t);
    strikes.forEach((s, i) => {
      const nx = i + 1 < strikes.length ? strikes[i + 1].t : strikes[0].t + LOOP;
      const hold = s.short ? Math.min(beat * 0.9, nx - s.t - 0.03) : Math.max(0.2, Math.min(nx - s.t - 0.03, 6));
      const notes = s.short ? s.c.voicing.slice(-3) : s.c.voicing;
      let off = 0;
      notes.forEach((m, k) => {
        push('keys', s.t + off + rk.gauss() * 0.003, 'epiano', { midi: m, vel: clamp(s.v * (1 - 0.05 * k) * (1 + 0.08 * rk.gauss()), 0.1, 1), hold: Math.max(0.15, hold - off), c: C }, 1, clamp((m - 64) / 40, -0.3, 0.3), hold + 0.6);
        off += 0.02 * (0.7 + 0.6 * rk.next());
      });
    });
  }

  // ---- pad: one sustained chord per chord change where the section wants it
  if (st.pad) {
    const rp = ra.fork('pad');
    chords.forEach((c, ci) => {
      const k = lvl(c.sec, 'pad');
      if (k <= 0.05) return;
      const notes = c.voicing.map((m) => m + (st.pad === 'glass' ? 12 : 0)).filter((m) => m >= 50);
      if (st.pad !== 'warm') notes.push(c.voicing[c.voicing.length - 1] + 12);
      const hold = c.bars * barDur;
      push('pad', c.bar * barDur - 0.25, 'pad', { notes, vel: 0.3 * k, hold: hold + 0.2, att: 1.2, rel: 1.6, timbre: st.pad, detune: 5 + 3 * rp.next(), breath: st.pad === 'warm' || st.pad === 'glass' ? 0 : 0.25 }, 1, 0, hold + 2);
      void ci;
    });
  }

  // ---- drone (Diwali): tanpura cycle Pa Sa Sa Sa(low), continuous
  if (st.drone) {
    const rd = ra.fork('drone');
    const sa = 48 + ((tonic - 48) % 12 + 12) % 12; // tonic in octave 3
    const cyc = [sa - 5, sa, sa, sa - 12];
    const gap = barDur / 3.2;
    let t = 0, i = 0;
    while (t < LOOP) {
      const m = cyc[i % 4];
      push('drone', t + rd.gauss() * 0.01, 'drone', { midi: m, vel: (i % 4 === 3 ? 0.9 : 0.7) * (1 + 0.05 * rd.gauss()), dur: 6.5, sweep: 3.4, tau: 3.2 }, 1, [-0.3, 0.1, 0.25, -0.1][i % 4], 6.5);
      t += gap * (1 + 0.03 * rd.gauss()) * (i % 4 === 3 ? 1.35 : 1);
      i++;
    }
  }

  // ---- bass
  {
    const rb = ra.fork('bass');
    const busy = 0.45 * (1 - 0.7 * sparse);
    chords.forEach((c, ci) => {
      const next = chords[(ci + 1) % chords.length];
      const root = bassNote(c.root, 33);
      for (let j = 0; j < c.bars; j++) {
        const b = c.bar + j;
        const k = lvl(c.sec, 'bass');
        if (k <= 0 || (k < 1 && !rb.chance(k))) continue;
        const notes = [{ e: 0, m: root, v: 0.9 }];
        if (rb.chance(busy)) notes.push({ e: rb.pick([3, 4, 5]), m: rb.chance(0.6) ? root : root + (rb.chance(0.5) ? 7 : 12) - (root + 12 > 47 ? 12 : 0), v: 0.7 });
        if (j === c.bars - 1 && rb.chance(0.45 * (1 - sparse))) notes.push({ e: 7, m: bassNote(next.root, 33) + (rb.chance(0.5) ? 1 : -1), v: 0.6 });
        notes.forEach((n, i) => {
          const t = t8(b, n.e) + rb.gauss() * 0.005;
          const tn = i + 1 < notes.length ? t8(b, notes[i + 1].e) : (b + 1) * barDur;
          const hold = Math.max(0.15, tn - t - 0.06);
          push('bass', t, 'bass', { midi: n.m, vel: n.v * (1 + 0.06 * rb.gauss()), hold, c: C }, 1, 0, hold + 0.2);
        });
      }
    });
  }

  // ---- lead melody (a motif that comes back in every theme)
  if (st.lead) {
    const rm = ra.fork('lead');
    const ctx = { scalePcs, chordAt, t8, beat, M: st.lead, motif: rm.pick(MOTIFS), contour: rm.pick(CONTOURS) };
    plan.forEach((sec, si) => {
      const k = lvl(sec, 'lead');
      if (k <= 0) return;
      const notes = makeMelody(ctx, sec, rm.fork('s' + si), st.lead.density * k);
      for (const n of notes) {
        const v = st.lead.v;
        const p = { midi: n.midi, vel: n.vel, hold: n.hold, c: C };
        let dur = n.hold + 0.6;
        if (v === 'bell') { p.hold = st.lead.short ? Math.min(2.5, n.hold + 1.2) : Math.min(4.5, n.hold + 2.5); dur = 20; }
        else if (v === 'celesta') { p.hold = Math.min(2.2, n.hold + 0.8); dur = 10; }
        else if (v === 'zither') { p.hold = Math.min(3.5, n.hold + 1); p.bend = st.lead.bend && rm.chance(0.3) ? rm.pick([1, 2]) : 0; p.vib = n.hold > 0.6; dur = 15; }
        else if (v === 'vibes') { p.hold = n.hold + 0.4; dur = 16; }
        else if (v === 'airy') { p.att = 0.08; p.rel = 0.3; dur = n.hold + 0.5; }
        push('lead', n.t, v, p, 1, 0.15, dur);
      }
    });
  }

  // ---- colour: arpeggios, broken chords, bell tones
  if (st.color) {
    const rc_ = ra.fork('color');
    const P = st.color;
    chords.forEach((c) => {
      const k = lvl(c.sec, 'color');
      if (k <= 0) return;
      const tones = voiceChord(c, null, rc_.fork('cv' + c.bar), { lo: P.lo, hi: P.hi, center: (P.lo + P.hi) / 2, maxNotes: 4 });
      const vd = (m, p) => {
        const q = { midi: m, vel: P.vel * p * (1 + 0.08 * rc_.gauss()), hold: 1.2, c: C };
        let dur = 2;
        if (P.v === 'bell') { q.hold = 3.5; dur = 20; }
        else if (P.v === 'celesta') { q.hold = 1.1; dur = 10; }
        else if (P.v === 'vibes') { q.hold = 1.4; dur = 16; }
        else if (P.v === 'marimba') dur = 4;
        else if (P.v === 'zither') { q.hold = 1.6; dur = 15; }
        else if (P.v === 'pluck') { q.hold = 1.0; dur = 1.4; }
        return [q, dur];
      };
      const pan = P.v === 'pluck' ? -0.28 : -0.2;
      for (let j = 0; j < c.bars; j++) {
        const b = c.bar + j;
        if (P.pat === 'bells') {
          if (j === 0 && rc_.chance(0.85 * k)) { const [q, d] = vd(tones[tones.length - 1], 1); push('color', t8(b, 0) + 0.01, P.v, q, 1, 0.3, d); }
          if (rc_.chance(0.35 * k)) { const [q, d] = vd(rc_.pick(tones), 0.7); push('color', t8(b, rc_.pick([4, 6, 3])), P.v, q, 1, -0.3, d); }
          continue;
        }
        const pattern = P.pat === 'arp' ? [0, 1, 2, 3, 4, 5, 6, 7] : P.pat === 'broken' ? [0, 3, 4, 6] : [0, 5];
        const seq = P.pat === 'arp' ? [0, 1, 2, 3, 2, 1, 2, 3] : [0, 2, 1, 3];
        const skip = P.pat === 'arp' ? 0.45 : 0.15;
        pattern.forEach((e, i) => {
          if (!rc_.chance(k) || rc_.chance(skip + 0.25 * sparse)) return;
          const m = tones[seq[(i + j * 2) % seq.length] % tones.length];
          const [q, d] = vd(m, i === 0 ? 1 : 0.8);
          if (P.pat === 'arp') q.hold = Math.min(q.hold, beat * 1.2);
          push('color', t8(b, e) + rc_.gauss() * 0.005, P.v, q, 1, pan, d);
        });
      }
    });
  }

  // ---- drums
  {
    const D = st.drums;
    const rd = ra.fork('drums');
    for (let b = 0; b < bars; b++) {
      const sec = secAt(b);
      const k = lvl(sec, 'drums');
      if (k <= 0.05) continue;
      const lastBar = b === sec.bar + sec.bars - 1;
      const full = k > 0.7;
      const KD = (t, v) => push('drums', t, 'kick', { vel: v, c: C }, 1, 0, 0.7);
      if (D.kit === 'tabla') {
        const sa = 60 + ((tonic - 60) % 12 + 12) % 12;
        const geAt = [[0, 1], [3, 0.6], [5, 0.7]];
        geAt.forEach(([e, p]) => { if (rd.chance(p * k)) push('perc', t8(b, e) + rd.gauss() * 0.004, 'tabla', { stroke: 'ge', f: 88, vel: 0.8 * (1 + 0.08 * rd.gauss()) }, 1, -0.1, 4); });
        for (let e = 0; e < 8; e++) {
          const p = e === 2 || e === 6 ? 0.95 : e % 2 ? 0.5 : 0.35;
          if (rd.chance(p * k)) push('perc', t8(b, e) + rd.gauss() * 0.004, 'tabla', { stroke: e === 2 || e === 6 ? 'na' : 'tin', midi: sa, vel: (e === 2 || e === 6 ? 0.7 : 0.4) * (1 + 0.1 * rd.gauss()) }, 1, 0.15, 4);
        }
        if (full) KD(t8(b, 0), 0.45);
        continue;
      }
      // kick
      const kp = [[0, 1, 0.8], [3, 0.3, 0.5], [4, 0.2, 0.45], [5, 0.6, 0.6]];
      kp.forEach(([e, p, v]) => { if (rd.chance(p * (e ? k : 1))) KD(t8(b, e) + rd.gauss() * 0.004, v * (0.75 + 0.25 * k) * (1 + 0.06 * rd.gauss())); });
      // backbeat
      [2, 6].forEach((e) => {
        if (k < 0.5 && e === 2 && rd.chance(0.5)) return;
        const t = t8(b, e) + 0.012 + rd.gauss() * 0.005;
        if (D.kit === 'brush') push('drums', t, 'brushSnare', { vel: 0.55 * (0.7 + 0.3 * k) * (1 + 0.07 * rd.gauss()), c: C }, 1, 0.08, 0.6);
        else if (D.kit === 'wood') push('drums', t, 'wood', { f: 1050, vel: 0.5 * (0.7 + 0.3 * k) * (1 + 0.07 * rd.gauss()) }, 1, 0.2, 0.5);
        else push('drums', t, 'rim', { vel: 0.5 * (0.7 + 0.3 * k) * (1 + 0.07 * rd.gauss()), c: C }, 1, 0.08, 0.3);
      });
      // ghosts (more on the last bar of a section: a soft fill)
      for (let e = 0; e < 8; e++) {
        if (e === 2 || e === 6) continue;
        const p = (lastBar && e >= 5 ? 0.3 : 0.08) * k;
        if (!rd.chance(p)) continue;
        const t = t8(b, e) + rd.gauss() * 0.006;
        if (D.kit === 'brush') push('drums', t, 'brushSnare', { vel: 0.22 * (0.7 + 0.5 * rd.next()), ghost: true, c: C }, 1, 0.12, 0.3);
        else if (D.kit === 'wood') push('drums', t, 'wood', { f: 1400, vel: 0.22 * (0.7 + 0.5 * rd.next()) }, 1, -0.2, 0.5);
        else push('drums', t, 'rim', { vel: 0.2 * (0.7 + 0.5 * rd.next()), c: C }, 1, 0.12, 0.3);
      }
      // brush swirl: one soft sweep per beat
      if (D.kit === 'brush' && D.swirl) for (let q = 0; q < 4; q++) push('drums', b * barDur + q * beat - 0.15 * beat, 'swirl', { vel: D.swirl * k, len: beat }, 1, 0.05, beat * 1.35);
      // top: hats / shaker / jingle
      if (full && D.top === 'hat') for (let e = 0; e < 8; e++) { if (rd.chance(0.08)) continue; push('drums', t8(b, e) + rd.gauss() * 0.004, 'hat', { vel: 0.3 * [1, 0.55, 0.8, 0.5][e % 4] * (1 + 0.1 * rd.gauss()), c: C }, 1, -0.25, 0.12); }
      if (full && D.top === 'shaker') for (let s = 0; s < 16; s++) push('drums', t16(b, s) + rd.gauss() * 0.003, 'shaker', { vel: 0.28 * [1, 0.45, 0.75, 0.45][s % 4] * (1 + 0.12 * rd.gauss()), c: C }, 1, 0.3, 0.17);
      if (full && D.top === 'jingle') [2, 6].forEach((e) => { if (rd.chance(0.8)) push('drums', t8(b, e) + 0.02, 'jingle', { vel: 0.5 }, 1, 0.35, 0.4); });
    }
  }

  // ---- story accents: a few soft chord-tone sparkles on the picture's beats
  const acc = (pic.accents || []);
  const rA = ra.fork('accent');
  const accV = st.color && ['celesta', 'bell', 'vibes'].includes(st.color.v) ? st.color.v : st.lead && ['celesta', 'bell'].includes(st.lead.v) ? st.lead.v : 'celesta';
  acc.forEach((ta, ai) => {
    const b = Math.floor(ta / barDur);
    const c = chordAt(b);
    const tones = voiceChord(c, null, rA.fork('a' + ai), { lo: 72, hi: 91, center: 80, maxNotes: 4 }).sort((x, y) => x - y);
    const e0 = Math.round((ta - b * barDur) / (beat / 2));
    tones.forEach((m, i) => push('color', t8(b, e0 + i) , accV, { midi: m, vel: 0.32 * (1 - 0.08 * i), hold: 1.6, c: C }, 1, 0.2 - 0.15 * i, accV === 'bell' ? 20 : accV === 'vibes' ? 16 : 10));
  });

  const meta = {
    key: keyName + ' ' + st.scale, bpm, bars, swing: +swing.toFixed(3),
    progA: progA.map((c) => c[1] + '@' + c[0] + 'x' + c[2]).join(' '), progB: progB.map((c) => c[1] + '@' + c[0] + 'x' + c[2]).join(' '),
    plan: plan.map((s) => s.type + ':' + s.bars).join(' '),
    voices: { keys: st.keysV, pad: st.pad, lead: st.lead && st.lead.v, color: st.color && st.color.v, drums: st.drums.kit + '/' + st.drums.top, drone: !!st.drone },
    sparse,
  };
  return { meta, events: ev, colour: C, style: st, bpm, beat, barDur, chords, plan, tonic, scalePcs };
}

export { STYLES };
