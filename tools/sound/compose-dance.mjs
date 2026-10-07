// Procedural dance composition for the bright entries: melodic house /
// future-bass-lite (118-124 BPM: four-on-the-floor, offbeat hats, claps,
// sidechain pump, band-limited supersaw chords, plucky leads, a riser and a
// drop on the entry's big moment) and sunny chill house (100-110 BPM: soft
// kick, marimba plucks, airy pads). Same output contract as compose.mjs: note
// events over the 240 s loop (bars per loop = BPM, so the loop is exact), plus
// `pump` (kick times for the sidechain) and `master` (bus colour).
import { RNG, LOOP, clamp } from './dsp.mjs';
import { PC } from './compose.mjs';

const Q = {
  maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], add9: [0, 4, 7, 14], '6/9': [0, 4, 7, 9, 14],
  m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14], madd9: [0, 3, 7, 14], sus2: [0, 2, 7, 14], '9sus4': [0, 5, 7, 10, 14],
};
const SC = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], penta: [0, 2, 4, 7, 9] };
// 8-bar progressions: [semitones above the tonic, quality, bars]
const PROGS = [
  [[9, 'm7', 2], [5, 'maj7', 2], [0, 'add9', 2], [7, 'sus2', 1], [7, 'add9', 1]],
  [[5, 'maj9', 2], [7, '9sus4', 1], [7, 'add9', 1], [4, 'm7', 2], [9, 'm9', 2]],
  [[0, 'maj9', 2], [4, 'm7', 2], [5, 'maj7', 2], [7, '9sus4', 2]],
  [[5, 'maj7', 2], [0, 'add9', 2], [7, 'add9', 2], [9, 'm7', 2]],
  [[9, 'm9', 2], [7, 'add9', 2], [5, 'maj9', 2], [5, 'maj7', 1], [7, 'sus2', 1]],
  [[0, 'add9', 2], [7, 'add9', 2], [9, 'm7', 2], [5, 'maj9', 2]],
];

// kind: house | chill; moment: what the drop lands on
const STYLES = {
  diwali: { kind: 'house', keys: ['D', 'E'], bpms: [120], mel: 'penta', moment: 'fireworks', progs: [0, 3, 5], lead: { wave: 'saw', cut: 3400 } },
  newyear: { kind: 'house', keys: ['A', 'Bb', 'C'], bpms: [124], mel: 'major', moment: 'logo', progs: [0, 1, 4], lead: { wave: 'saw', cut: 3800 } },
  lunar: { kind: 'house', keys: ['F', 'G'], bpms: [118, 120], mel: 'penta', moment: 'fireworks', progs: [2, 3, 5], lead: { wave: 'square', cut: 3200 } },
  match: { kind: 'house', keys: ['C', 'D'], bpms: [124], mel: 'major', moment: 'goal', progs: [0, 3, 4], lead: { wave: 'saw', cut: 3800 } },
  nyc: { kind: 'house', keys: ['Db', 'Eb'], bpms: [120, 122], mel: 'major', moment: 'fireworks', progs: [1, 2, 4], lead: { wave: 'square', cut: 3400 } },
  dc: { kind: 'house', keys: ['F', 'G'], bpms: [118, 120], mel: 'major', moment: 'candles', progs: [2, 3, 5], lead: { wave: 'square', cut: 3000 } },
  midsummer: { kind: 'house', keys: ['E', 'D'], bpms: [120, 122], mel: 'penta', moment: 'mid', progs: [0, 4, 5], lead: { wave: 'saw', cut: 3400 } },
  la: { kind: 'chill', keys: ['A', 'G'], bpms: [104, 106], mel: 'penta', progs: [0, 2, 3] },
  sandiego: { kind: 'chill', keys: ['F', 'D'], bpms: [100, 104], mel: 'penta', progs: [1, 3, 5] },
  easter: { kind: 'chill', keys: ['G', 'A'], bpms: [108, 110], mel: 'major', progs: [2, 4, 5] },
};
export const DANCE_IDS = Object.keys(STYLES);

// what plays in each kind of section
const HOUSE = {
  drop: { kick: 1, clap: 1, hatO: 1, hatC: 1, bass: 'drop', chords: 'stab', lead: 1, arp: 0.7, pad: 0.4 },
  groove: { kick: 1, clap: 1, hatO: 1, hatC: 0.5, bass: 'off', chords: 'pump', lead: 0, arp: 1, pad: 0.3 },
  groove2: { kick: 1, clap: 1, hatO: 1, hatC: 0.8, bass: 'off', chords: 'pump', lead: 0.85, arp: 0.6, pad: 0.3 },
  verse: { kick: 1, clap: 0.8, hatO: 1, hatC: 0, bass: 'off', chords: 'low', lead: 0, arp: 0.8, pad: 0.5 },
  lift: { kick: 1, clap: 1, hatO: 1, hatC: 1, bass: 'drop', chords: 'stab', lead: 0.6, arp: 1, pad: 0.3, swell: true },
  break: { kick: 0, clap: 0, hatO: 0, hatC: 0.4, bass: 'long', chords: 'sus', lead: 0.55, arp: 0.5, pad: 1, swell: true },
  low: { kick: 1, clap: 0.5, hatO: 0.6, hatC: 0, bass: 'long', chords: 'low', lead: 0, arp: 0.5, pad: 0.8 },
  turn: { kick: 1, clap: 1, hatO: 1, hatC: 0.5, bass: 'off', chords: 'pump', lead: 0, arp: 0.8, pad: 0.3, fill: true },
  breakdown: { kick: 0, clap: 0, hatO: 0, hatC: 0, bass: 0, chords: 'sus', lead: 0.7, arp: 0.6, pad: 1 },
  build: { kick: 'build', clap: 0, hatO: 0.6, hatC: 0.8, bass: 'off', chords: 'build', lead: 0, arp: 1, pad: 0.6, riser: true, roll: true },
};
const CHILL = {
  intro: { kick: 0.5, clap: 0, hatO: 0.6, shaker: 0.5, bass: 'long', chords: 'sus', lead: 0, mar: 1, pad: 1 },
  groove: { kick: 1, clap: 1, hatO: 1, shaker: 1, bass: 'trop', chords: 'pump', lead: 0, mar: 1, pad: 0.6 },
  groove2: { kick: 1, clap: 1, hatO: 1, shaker: 1, bass: 'trop', chords: 'pump', lead: 0.85, mar: 0.7, pad: 0.6 },
  lift: { kick: 1, clap: 1, hatO: 1, shaker: 1, bass: 'trop', chords: 'stab', lead: 0.7, mar: 1, pad: 0.5, swell: true },
  break: { kick: 0, clap: 0, hatO: 0.4, shaker: 0.6, bass: 'long', chords: 'sus', lead: 0.5, mar: 1, pad: 1, swell: true },
  verse: { kick: 1, clap: 0.7, hatO: 1, shaker: 0.6, bass: 'trop', chords: 'low', lead: 0, mar: 1, pad: 0.8 },
  outro: { kick: 0.5, clap: 0.5, hatO: 0.6, shaker: 0.5, bass: 'long', chords: 'sus', lead: 0, mar: 1, pad: 1 },
};

// lead rhythms: 2 bars of 16th steps [onset, length]
const HOOKS = [
  [[0, 2], [3, 2], [6, 3], [10, 2], [12, 3], [16, 2], [19, 2], [22, 2], [24, 6]],
  [[0, 2], [2, 2], [4, 3], [7, 3], [10, 4], [16, 2], [18, 2], [20, 3], [23, 3], [26, 5]],
  [[2, 2], [4, 2], [6, 3], [9, 3], [12, 3], [18, 2], [20, 2], [22, 3], [25, 6]],
  [[0, 3], [3, 3], [6, 2], [8, 2], [11, 3], [14, 2], [16, 3], [19, 3], [22, 7]],
];
const ANSWERS = [[[0, 2], [3, 2], [6, 3], [10, 6]], [[0, 3], [4, 2], [6, 2], [8, 8]], [[2, 2], [4, 2], [7, 3], [10, 6]]];
const CONTOURS = [[0, 1, 2, 1, -1, 0, 2, 1, 0, -1], [0, -1, 1, 2, 3, 2, 0, 1, -1, 0], [0, 2, 1, 0, -1, 1, 0, 2, 3, 1], [0, 1, 0, -1, -2, 0, 1, 2, 1, 0]];
// chord stab rhythms (16th steps in one bar)
const STABS = [[0, 3, 6, 10, 12], [0, 3, 6, 8, 11, 14], [0, 2, 6, 10, 13]];
// marimba (chill) rhythms: [step, chord-tone index]
const MARIMBA = [[[0, 0], [3, 2], [6, 1], [8, 3], [10, 2], [12, 1], [14, 2]], [[0, 1], [3, 3], [6, 2], [10, 0], [11, 2], [14, 3]], [[0, 0], [2, 2], [3, 3], [6, 1], [8, 2], [11, 3], [14, 1]]];

function voiceChord(root, ivs, prev, lo, hi, maxN) {
  const tones = ivs.filter((iv) => iv % 12 !== 0 || ivs.length < 4).slice(0, maxN).map((iv) => (root + iv) % 12);
  const opts = tones.map((pc) => { const r = []; for (let m = lo + (((pc - lo) % 12) + 12) % 12; m <= hi; m += 12) r.push(m); return r; });
  let best = null, bc = Infinity;
  const rec = (k, cur) => {
    if (k === opts.length) {
      const v = cur.slice().sort((a, b) => a - b);
      for (let i = 1; i < v.length; i++) if (v[i] === v[i - 1]) return;
      if (v[v.length - 1] - v[0] > 14) return;
      let c = 0;
      for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] === 1) c += 2;
      const ctr = v.reduce((s, x) => s + x, 0) / v.length;
      c += 0.3 * Math.abs(ctr - (lo + hi) / 2);
      if (prev) for (const x of v) c += 0.4 * Math.min(...prev.map((y) => Math.abs(x - y)));
      if (c < bc) { bc = c; best = v; }
      return;
    }
    for (const m of opts[k]) { cur.push(m); rec(k + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return best || tones.map((pc) => lo + (((pc - lo) % 12) + 12) % 12).sort((a, b) => a - b);
}

/** the loop time of the entry's big moment (or null for chill) */
function bigMoment(st, ed, pic) {
  const S = pic.story || {};
  const first = (k, d) => (S[k] && S[k].length ? S[k][0][0] : d);
  if (st.moment === 'goal') return first('goal', 150) + 0.2;
  if (st.moment === 'candles') return first('candlesOut', 100);
  if (st.moment === 'logo') return pic.logo ? pic.logo[0] + 1.2 : 120;
  if (st.moment === 'fireworks' && pic.fireworks && pic.fireworks.length) {
    // the densest 8 s of bursts (near ones count more)
    const fw = pic.fireworks;
    let best = null, bs = -1;
    for (const f of fw) {
      let s = 0;
      for (const g of fw) { const d = (((g.t - f.t) % LOOP) + LOOP) % LOOP; if (d < 8) s += g.far ? 0.5 : 1; }
      if (s > bs) { bs = s; best = f.t; }
    }
    return best;
  }
  return 120;
}

export function composeDance(ed, pic = {}) {
  const st = STYLES[ed.id];
  const house = st.kind === 'house';
  const seed = 'purrfect-year/v2/dance/' + ed.id;
  const R = new RNG(seed);
  const rs = R.fork('style');
  const keyName = rs.pick(st.keys);
  const tonic = PC[keyName];
  const bpm = rs.pick(st.bpms);
  const bars = bpm;
  const beat = 60 / bpm, barDur = 4 * beat, s16 = beat / 4;
  const swing = house ? 0 : 0.06; // chill house: a light 16th shuffle
  const t16 = (b, s) => b * barDur + s * s16 + (s % 2 ? swing * s16 : 0);
  const pi = st.progs;
  const progA = PROGS[pi[rs.int(0, pi.length - 1)]];
  let progB = PROGS[pi[rs.int(0, pi.length - 1)]];
  if (progB === progA) progB = PROGS[pi[(pi.indexOf(PROGS.indexOf(progA)) + 1) % pi.length]];
  const melPcs = SC[st.mel].map((s) => (tonic + s) % 12);

  // ---- arrangement (cyclic): house is laid out from the drop bar
  const plan = [];
  let dropT = null, phi = 0; // phi: the whole grid shifts so the drop lands exactly on the moment
  if (house) {
    dropT = bigMoment(st, ed, pic);
    const D = ((Math.round(dropT / barDur) % bars) + bars) % bars;
    phi = dropT - Math.round(dropT / barDur) * barDur;
    const mid = ['groove', 'groove2', 'verse', 'break', 'groove', 'groove2', 'lift', 'verse', 'low', 'groove', 'groove2', 'verse'];
    const seq = [['drop', 16, 'A']];
    let left = bars - 32, k = 0;
    while (left >= 8) { seq.push([mid[k], 8, k % 3 === 2 ? 'B' : 'A']); k++; left -= 8; }
    if (left > 0) seq.push(['turn', left, 'A']);
    seq.push(['breakdown', 8, 'B'], ['build', 8, 'A']);
    let b = D;
    for (const [type, n, prog] of seq) { plan.push({ type, bar: b % bars, bars: n, prog }); b += n; }
  } else {
    const mid = ['groove', 'groove2', 'lift', 'groove2', 'break', 'groove', 'groove2', 'verse', 'lift', 'groove2', 'break', 'groove', 'groove2'];
    const seq = [['intro', 8, 'A']];
    let left = bars - 8, k = 0;
    while (left >= 8) { seq.push([mid[k], 8, k % 4 === 3 ? 'B' : 'A']); k++; left -= 8; }
    if (left > 0) seq.push(['outro', left, 'A']);
    let b = 0;
    for (const [type, n, prog] of seq) { plan.push({ type, bar: b, bars: n, prog }); b += n; }
  }
  const PART = house ? HOUSE : CHILL;
  const wrapB = (b) => ((b % bars) + bars) % bars;
  const secAt = (b) => { const w = wrapB(b); return plan.find((s) => wrapB(w - s.bar) < s.bars); };

  // ---- chords per bar (each section restarts its progression)
  const chords = [];
  plan.forEach((sec) => {
    const prog = sec.prog === 'A' ? progA : progB;
    let b = 0, i = 0;
    while (b < sec.bars) {
      const [deg, q, n] = prog[i % prog.length];
      const nb = Math.min(n, sec.bars - b);
      chords.push({ root: (tonic + deg) % 12, ivs: Q[q], q, bar: wrapB(sec.bar + b), bars: nb, sec });
      b += nb; i++;
    }
  });
  chords.sort((a, b) => a.bar - b.bar);
  const chordAt = (b) => { const w = wrapB(b); return chords.find((c) => wrapB(w - c.bar) < c.bars) || chords[0]; };
  let prev = null;
  for (let pass = 0; pass < 2; pass++) for (const c of chords) { c.voicing = voiceChord(c.root, c.ivs, prev, house ? 57 : 55, house ? 77 : 74, 4); prev = c.voicing; }

  const ev = [];
  let eid = 0;
  const push = (stem, t, voice, p, pan = 0, dur = 1) => ev.push({ stem, t: (((t + phi) % LOOP) + LOOP) % LOOP, voice, p, gain: 1, pan, dur, seed: `${seed}/${stem}/${eid++}` });
  const pump = [];
  const ra = R.fork('arr');
  const lead = st.lead || { wave: 'square', cut: 2600 };

  // ---- drums
  for (let b = 0; b < bars; b++) {
    const sec = secAt(b), P = PART[sec.type];
    const j = wrapB(b - sec.bar), last = j === sec.bars - 1;
    const rd = ra.fork('d' + b);
    // kick
    if (P.kick === 'build') {
      for (let q = 0; q < 4; q++) {
        if (j === sec.bars - 1 && q === 3) continue; // a beat of air before the drop
        const v = 0.9 * (0.7 + 0.3 * (j / sec.bars));
        push('kick', b * barDur + q * beat, 'kick4', { vel: v }, 0, 0.5);
        pump.push([b * barDur + q * beat, 0.8]);
      }
    } else if (P.kick) {
      for (let q = 0; q < 4; q++) {
        if (P.kick < 1 && q % 2) continue;
        push('kick', b * barDur + q * beat, 'kick4', { vel: (house ? 0.95 : 0.85) * (q % 2 ? 0.94 : 1), soft: !house }, 0, 0.5);
        pump.push([b * barDur + q * beat, 1]);
      }
    }
    // clap / snare on 2 and 4
    if (P.clap) [4, 12].forEach((s) => { if (P.clap >= 1 || rd.chance(P.clap)) push('clap', t16(b, s) + 0.004, 'clap', { vel: (house ? 0.8 : 0.5) * (1 + 0.05 * rd.gauss()) }, house ? 0.05 : 0.12, 0.45); });
    if (P.fill && last) [13, 14, 15].forEach((s, i) => push('clap', t16(b, s), 'snr', { vel: 0.3 + 0.12 * i }, 0.1, 0.3));
    else if (house && last && P.kick && sec.type !== 'build' && rd.chance(0.5)) [14, 15].forEach((s) => push('clap', t16(b, s), 'snr', { vel: 0.28 }, -0.1, 0.3));
    // hats: open on the offbeats, closed 16ths
    for (let s = 0; s < 16; s++) {
      if (s % 4 === 2 && P.hatO) { if (P.hatO >= 1 || rd.chance(P.hatO)) push('hats', t16(b, s), 'hh', { vel: (house ? 0.55 : 0.4) * (1 + 0.06 * rd.gauss()), open: true, tau: house ? 0.07 : 0.05 }, house ? 0.18 : -0.2, 0.36); }
      else if (P.hatC && s % 4 !== 2 && house && rd.chance(P.hatC * (s % 2 ? 0.9 : 0.6))) push('hats', t16(b, s), 'hh', { vel: (s % 2 ? 0.3 : 0.2) * (1 + 0.1 * rd.gauss()) }, -0.22, 0.1);
    }
    if (P.shaker) for (let s = 0; s < 16; s++) if (P.shaker >= 1 || rd.chance(P.shaker)) push('hats', t16(b, s), 'shaker', { vel: 0.26 * [1, 0.45, 0.75, 0.45][s % 4] * (1 + 0.1 * rd.gauss()), c: COLOUR }, 0.3, 0.17);
    // snare roll in the build: 8ths, then 16ths, swelling
    if (P.roll && j >= 4) {
      const per = j < 6 ? 2 : 1;
      for (let s = 0; s < 16; s += per) {
        if (j === sec.bars - 1 && s >= 12) break;
        const u = (j - 4 + s / 16) / 4;
        push('clap', t16(b, s), 'snr', { vel: 0.18 + 0.5 * u * u }, 0.05 * (s % 2 ? 1 : -1), 0.3);
      }
    }
    // a crash-like impact on the drop, a riser over the build, a swell into the next section
    if (sec.type === 'drop' && j === 0) push('fx', b * barDur, 'impact', { vel: 0.9, crash: 0.4 }, 0, 2.6);
    if (P.riser && j === 0) push('fx', b * barDur, 'riser', { dur: sec.bars * barDur - beat * 0.5, vel: 0.75, f0: 320, f1: 4200 }, 0, sec.bars * barDur);
    if (P.swell && j === sec.bars - 2) push('fx', b * barDur, 'swell', { dur: 2 * barDur, vel: house ? 0.5 : 0.4 }, 0, 2 * barDur);
  }

  // ---- bass (root under the chord; house: offbeats, chill: a tropical 3-3-2)
  for (let b = 0; b < bars; b++) {
    const sec = secAt(b), P = PART[sec.type];
    if (!P.bass) continue;
    const c = chordAt(b), j = wrapB(b - sec.bar);
    const root = 33 + (((c.root - 33) % 12) + 12) % 12;
    const rb = ra.fork('b' + b);
    let pat;
    if (P.bass === 'off') pat = [[2, 0, 1.6], [6, 0, 1.6], [10, 0, 1.6], [14, rb.chance(0.3) ? 12 : 0, 1.6]];
    else if (P.bass === 'drop') pat = [[2, 0, 1.5], [6, 0, 1.5], [8, 12, 1], [10, 0, 1.5], [13, 7, 1], [14, 0, 1.6]];
    else if (P.bass === 'trop') pat = [[0, 0, 2.5], [3, 0, 2], [6, 7, 1.6], [8, 12, 1.5], [11, 0, 2], [14, 7, 1.5]];
    else pat = [[0, 0, j % 2 ? 7 : 15]];
    if (sec.type === 'build' && j === sec.bars - 1) pat = pat.filter((x) => x[0] < 12);
    for (const [s, iv, len] of pat) {
      let m = root + iv;
      if (m > 47) m -= 12;
      push('bass', t16(b, s), 'houseBass', { midi: m, vel: P.bass === 'long' ? 0.7 : 0.85, hold: len * s16 * 0.95, growl: house ? 0.4 : 0.18 }, 0, len * s16 + 0.1);
    }
  }

  // ---- chords
  chords.forEach((c) => {
    const P = PART[c.sec.type];
    const mode = P.chords;
    if (!mode) return;
    const v = c.voicing;
    const notes = house && !v.includes(v[0] + 12) ? v.concat([v[0] + 12]) : v;
    const j0 = wrapB(c.bar - c.sec.bar);
    const t0 = c.bar * barDur;
    const rc_ = ra.fork('c' + c.bar);
    if (mode === 'pump' || mode === 'low' || mode === 'sus') {
      const hold = c.bars * barDur - 0.04;
      const p = { notes, vel: mode === 'pump' ? 0.8 : 0.65, hold, att: mode === 'sus' ? 0.35 : 0.012, rel: mode === 'sus' ? 0.6 : 0.12, det: house ? 13 : 9, lp: mode === 'pump' ? (house ? 5200 : 3600) : mode === 'low' ? 2400 : 2800, soft: house ? 3800 : 2600, top: house ? 8000 : 6000 };
      push('chords', t0, 'saw', p, 0, hold + p.rel + 0.02);
    } else if (mode === 'stab') {
      for (let k = 0; k < c.bars; k++) {
        const steps = STABS[(j0 + k) % 2 ? 1 : rc_.pick([0, 2])];
        steps.forEach((s, i) => {
          const nx = i + 1 < steps.length ? steps[i + 1] : 16;
          const hold = Math.min(nx - s, 2.5) * s16 * 0.9;
          push('chords', t16(c.bar + k, s), 'saw', { notes, vel: 0.85 * (i === 0 ? 1 : 0.9), hold, att: 0.004, rel: 0.09, det: house ? 14 : 9, lp: house ? 6200 : 4200, soft: house ? 4000 : 2800, top: house ? 8200 : 6500 }, 0, hold + 0.12);
        });
      }
    } else if (mode === 'build') {
      for (let k = 0; k < c.bars; k++) {
        const jj = j0 + k;
        for (let s = 0; s < 16; s += 2) {
          if (jj === c.sec.bars - 1 && s >= 12) break;
          const u = (jj + s / 16) / c.sec.bars;
          push('chords', t16(c.bar + k, s), 'saw', { notes, vel: 0.55 + 0.35 * u, hold: s16 * 1.4, att: 0.004, rel: 0.07, det: 14, lp: 900 * Math.pow(6500 / 900, u), soft: 4000, top: 8200 }, 0, s16 * 1.4 + 0.1);
        }
      }
    }
    // airy pad an octave up, sidechained hard
    if (P.pad) {
      const hold = c.bars * barDur;
      push('pad', t0 - 0.02, 'pad', { notes: v.map((m) => m + 12).filter((m) => m <= 88), vel: 0.32 * P.pad, hold: hold + 0.1, att: 0.5, rel: 0.9, timbre: house ? 'glass' : 'ah', detune: 7, breath: house ? 0 : 0.25 }, 0, hold + 1.1);
    }
  });

  // ---- arpeggio (house: 16th plucks ping-ponging) / marimba (chill)
  for (let b = 0; b < bars; b++) {
    const sec = secAt(b), P = PART[sec.type];
    const c = chordAt(b);
    const rr = ra.fork('a' + b);
    if (house && P.arp) {
      const tones = voiceChord(c.root, c.ivs, null, 64, 84, 4);
      const order = [0, 1, 2, 3, 2, 1, 3, 2];
      const every = sec.type === 'verse' || sec.type === 'low' ? 2 : 1;
      for (let s = 0; s < 16; s += every) {
        if (P.arp < 1 && !rr.chance(P.arp)) continue;
        if (sec.type === 'build' && wrapB(b - sec.bar) === sec.bars - 1 && s >= 12) break;
        const m = tones[order[s % 8] % tones.length];
        push('arp', t16(b, s), 'pluckSynth', { midi: m, vel: (s % 4 === 0 ? 0.7 : 0.5) * (1 + 0.06 * rr.gauss()), hold: s16 * 0.6, rel: 0.06, cut: 2600, decay: 0.07, sus: 0.05, ampDecay: 0.09, wave: 'square' }, s % 2 ? 0.35 : -0.35, s16 * 0.6 + 0.08);
      }
    }
    if (!house && P.mar) {
      const tones = voiceChord(c.root, c.ivs, null, 67, 86, 4);
      const pat = MARIMBA[(b + (sec.type === 'groove2' ? 1 : 0)) % 2 ? 1 : (sec.type === 'lift' ? 2 : 0)];
      for (const [s, k] of pat) {
        if (P.mar < 1 && !rr.chance(P.mar)) continue;
        push('arp', t16(b, s), 'marimba', { midi: tones[k % tones.length], vel: (s % 4 === 0 ? 0.62 : 0.48) * (1 + 0.07 * rr.gauss()) }, s % 3 ? 0.3 : -0.3, 1.4);
      }
    }
  }

  // ---- lead hook: a 2-bar motif stated, varied, answered over each 8 bars
  {
    const rm = ra.fork('lead');
    const hook = rm.pick(HOOKS), answer = rm.pick(ANSWERS), contour = rm.pick(CONTOURS);
    const lo = house ? 69 : 67, hi = house ? 86 : 84;
    const inMel = (m) => melPcs.includes(((m % 12) + 12) % 12);
    const stepMel = (m, k) => { let x = m; const d = k > 0 ? 1 : -1; for (let i = 0; i < Math.abs(k); i++) { x += d; while (!inMel(x)) x += d; } return x; };
    const home = 74 + (((tonic + 4 - 74) % 12) + 12) % 12; // around the third of the key, mid range
    plan.forEach((sec) => {
      const P = PART[sec.type];
      if (!P.lead) return;
      for (let ph = 0; ph + 2 <= sec.bars; ph += 2) {
        const which = (ph / 2) % 4;
        if (P.lead < 1 && !rm.chance(P.lead + 0.15)) continue;
        const rh = which === 3 ? answer : hook;
        const shift = which === 1 ? 1 : which === 2 ? 0 : -1;
        let m = stepMel(home, shift);
        rh.forEach(([on, du], k) => {
          const b = sec.bar + ph + Math.floor(on / 16);
          const ch = chordAt(b);
          const cps = ch.ivs.map((iv) => (ch.root + iv) % 12);
          if (k) m = stepMel(m, (contour[k % contour.length] - contour[(k - 1) % contour.length]) || 1);
          if (on % 4 === 0 || du >= 4) { // land on a chord tone
            let best = m, bd = 99;
            for (let x = m - 3; x <= m + 3; x++) if (cps.includes(((x % 12) + 12) % 12) && Math.abs(x - m) < bd) { bd = Math.abs(x - m); best = x; }
            m = best;
          }
          while (m > hi) m -= 12;
          while (m < lo) m += 12;
          const hold = du * s16 * 0.85;
          const t = t16(sec.bar + ph, on);
          const vel = (on % 4 === 0 ? 0.75 : 0.62) * (1 + 0.05 * rm.gauss());
          if (house) push('lead', t, 'pluckSynth', { midi: m, vel, hold, rel: 0.12, cut: lead.cut, decay: 0.16, sus: 0.25, ampDecay: 0.3, wave: lead.wave }, 0.08, hold + 0.15);
          else push('lead', t, 'pluckSynth', { midi: m, vel, hold, rel: 0.15, cut: 2300, decay: 0.12, sus: 0.12, ampDecay: 0.22, wave: 'square' }, 0.12, hold + 0.18);
        });
      }
    });
  }

  // ---- story accents: a short high pluck arpeggio on the picture's beats
  (pic.accents || []).forEach((ta, ai) => {
    const b = Math.floor(ta / barDur), c = chordAt(b);
    const tones = voiceChord(c.root, c.ivs, null, 76, 91, 4);
    const s0 = Math.round((ta - b * barDur) / s16);
    tones.forEach((m, i) => push('arp', t16(b, s0 + 2 * i), 'pluckSynth', { midi: m, vel: 0.5, hold: 0.25, rel: 0.2, cut: 3000, decay: 0.2, sus: 0.1, ampDecay: 0.4, wave: 'square' }, 0.25 - 0.15 * i, 0.5));
    void ai;
  });

  const colour = { ...COLOUR, drive: house ? 1.15 : 1.1, lp: house ? 11500 : 10000, shelf: house ? -1 : -1.5, shelfF: 6000, wowCents: 0, flutterCents: 0, tremRate: 4, tremDepth: 0 };
  const meta = {
    key: keyName + ' ' + st.mel, bpm, bars, kind: st.kind, drop: dropT == null ? null : +dropT.toFixed(2),
    progA: progA.map((c) => c[1] + '@' + c[0] + 'x' + c[2]).join(' '), progB: progB.map((c) => c[1] + '@' + c[0] + 'x' + c[2]).join(' '),
    plan: plan.map((s) => s.type + ':' + s.bar + '+' + s.bars).join(' '),
    voices: { lead: 'pluckSynth/' + lead.wave },
  };
  return { meta, events: ev, colour, style: { sparse: 0, dance: st.kind }, bpm, beat, barDur, chords, plan, tonic, scalePcs: melPcs, pump: pump.map(([t, d]) => [(((t + phi) % LOOP) + LOOP) % LOOP, d]), phi };
}

// colour fields some shared voices read (shaker)
const COLOUR = { shakerFc: 4500, hatFc: 6200, hatLP: 8200, hatDecay: 0.02 };
export { STYLES as DANCE_STYLES, clamp };
