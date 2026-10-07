#!/usr/bin/env node
// The original procedural soundtrack of every entry: a music bed in the
// entry's style (melodic house, sunny chill house or warm lofi) under the
// ambience of its scene, following the picture's story beats (fireworks,
// lightning, the goal, the candles). Deterministic and seamless over the
// 240 s loop; any window of it renders the same samples.
//
//   node tools/soundtrack.mjs --edition ID --start S --seconds N --out FILE.wav [--rate 48000]
//   node tools/soundtrack.mjs --edition ID --loop --out FILE.wav
//   node tools/soundtrack.mjs --calibrate ID|all [--jobs N]   measure the stem and bus gains
//   node tools/soundtrack.mjs --info ID                      key, tempo, arrangement, drop time
// Options: --no-sync never reads fireworks/lightning timings from the page
// (uses tools/sound/events.json even when older than the picture code);
// --stats prints loudness and true peak of what was written.
// Output: 48 kHz 16-bit stereo WAV, about -16 LUFS over the loop, true peak
// below -1 dBTP. Gains come from tools/sound/calibration.json; an entry whose
// calibration is missing or older than the code is calibrated first (about a
// minute, once).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SR, LOOP, N_LOOP, wav16, lufs, truePeak, HOP } from './sound/dsp.mjs';
import { buildScore, renderWindow, gainsFor, stemGains, busGains, mergeStats, readCalibration, writeCalibration, codeHash, editionHash } from './sound/engine.mjs';
import { pictureEvents, editions } from './sound/picture.mjs';

const SELF = fileURLToPath(import.meta.url);
const log = (...m) => process.stderr.write(m.join(' ') + '\n');

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const nx = argv[i + 1];
    if (nx === undefined || nx.startsWith('--')) a[k.slice(2)] = true;
    else { a[k.slice(2)] = nx; i++; }
  }
  return a;
}

const BLOCK = 30 * SR; // render in 30 s blocks (a multiple of the 100 ms loudness hop)

/** render [w0, w0 + n) of the loop in blocks */
function renderRange(score, w0, n, gains, opts = {}) {
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let o = 0; o < n; o += BLOCK) {
    const k = Math.min(BLOCK, n - o);
    const w = renderWindow(score, (((w0 + o) % N_LOOP) + N_LOOP) % N_LOOP, k, gains, opts);
    L.set(w.L, o); R.set(w.R, o);
  }
  return { L, R };
}

/** measure the whole loop: stem levels at unity, then the buses with those stem gains */
function calibrate(id, score) {
  const t0 = Date.now();
  const parts = [];
  for (let o = 0; o < N_LOOP; o += BLOCK) parts.push(renderWindow(score, o, BLOCK, null, { measure: 'stems', stemsOnly: true }).stats);
  const sg = stemGains(score, mergeStats(parts));
  const g1 = { stems: sg.stems, music: 0, amb: 0, master: 0 };
  const bparts = [];
  for (let o = 0; o < N_LOOP; o += BLOCK) bparts.push(renderWindow(score, o, BLOCK, g1, { measure: 'buses' }).stats);
  const bs = mergeStats(bparts);
  const bg = busGains(score, bs);
  const lim = Math.max(...bparts.map((p) => p.limiterMaxDb || 0));
  return {
    code: codeHash(), ed: editionHash(score.ed), stems: sg.stems, measured: sg.measured,
    music: bg.music, amb: bg.amb, master: bg.master, musicLUFS: bg.musicLUFS, ambLUFS: bg.ambLUFS,
    unlimitedLimiterDb: +lim.toFixed(2), seconds: Math.round((Date.now() - t0) / 1000),
  };
}
function storeCalibration(id, g) {
  const cal = readCalibration(); // re-read just before writing: other processes may have added entries
  cal.editions = cal.editions || {};
  cal.editions[id] = g;
  writeCalibration(cal);
}

async function loadScore(id, a) {
  const pic = await pictureEvents(id, { live: !a['no-sync'] }, (m) => log('note: ' + m));
  return buildScore(id, pic);
}
async function gainsOrCalibrate(id, score) {
  const g = gainsFor(id);
  if (g.state === 'ok') return g.gains;
  log(`calibrating ${id} (${g.state}); this happens once per code change...`);
  const c = calibrate(id, score);
  storeCalibration(id, c);
  log(`calibrated ${id} in ${c.seconds} s (music ${c.musicLUFS} LUFS, ambience ${c.ambLUFS} LUFS before gains)`);
  return c;
}

function writeOut(file, L, R, rate, idx0) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const buf = wav16(L, R, SR, 0x5eed, idx0);
  if (rate === SR) { fs.writeFileSync(file, buf); return; }
  const tmp = file + '.48k.wav';
  fs.writeFileSync(tmp, buf);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-ar', String(rate), '-c:a', 'pcm_s16le', file]);
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) throw new Error('resampling failed: ' + r.stderr);
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a.calibrate) {
    const ids = a.calibrate === 'all' || a.calibrate === true ? editions().map((e) => e.id) : String(a.calibrate).split(',');
    if (ids.length === 1) {
      const score = await loadScore(ids[0], a);
      const c = calibrate(ids[0], score);
      storeCalibration(ids[0], c);
      log(`${ids[0]}: ${JSON.stringify({ music: c.music, amb: c.amb, master: c.master, s: c.seconds })}`);
      return;
    }
    const jobs = +(a.jobs || Math.max(1, Math.min(os.cpus().length, 4)));
    let next = 0, fails = 0;
    const one = () => new Promise((res) => {
      if (next >= ids.length) return res();
      const id = ids[next++];
      const p = spawn(process.execPath, [SELF, '--calibrate', id, '--no-sync'], { stdio: ['ignore', 'inherit', 'inherit'] });
      p.on('close', (code) => { if (code) { fails++; log(`calibration of ${id} failed (${code})`); } one().then(res); });
    });
    // read the picture events once (refreshes the snapshot), then calibrate in parallel
    if (!a['no-sync']) await pictureEvents(ids[0], { live: true }, (m) => log('note: ' + m));
    await Promise.all(Array.from({ length: jobs }, one));
    process.exitCode = fails ? 1 : 0;
    return;
  }
  const id = a.edition;
  if (!id || id === true) throw new Error('usage: --edition ID (--start S --seconds N | --loop) --out FILE.wav');
  if (a.info) {
    const score = await loadScore(id, a);
    console.log(JSON.stringify({ id, ...score.music.meta, picture: score.pic.source, calibration: gainsFor(id).state }, null, 1));
    return;
  }
  if (!a.out || a.out === true) throw new Error('--out FILE.wav is required');
  const rate = +(a.rate || SR);
  let w0, n;
  if (a.loop) { w0 = 0; n = N_LOOP; }
  else {
    const S = +(a.start || 0), N = +a.seconds;
    if (!(N > 0)) throw new Error('--seconds N (> 0) is required (or --loop)');
    w0 = ((Math.round(S * SR) % N_LOOP) + N_LOOP) % N_LOOP;
    n = Math.round(N * SR);
  }
  const t0 = Date.now();
  const score = await loadScore(id, a);
  const gains = await gainsOrCalibrate(id, score);
  const { L, R } = renderRange(score, w0, n, gains);
  writeOut(a.out, L, R, rate, w0);
  if (a.stats) {
    const lu = n >= 4 * HOP ? lufs(L, R) : NaN;
    log(`${id} [${(w0 / SR).toFixed(2)}, +${(n / SR).toFixed(2)}) s: ${lu.toFixed(2)} LUFS, true peak ${truePeak(L, R).toFixed(2)} dBTP, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}

main().catch((e) => { log('soundtrack: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
void LOOP;
