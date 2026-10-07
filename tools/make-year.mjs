#!/usr/bin/env node
// Purrfect Year: the sixteen diary entries back to back, in the order the page
// defines them (src/editions.js), each dipping through black into the next.
//
//   node tools/make-year.mjs                 the 90 s YouTube cut: 1920x1080, exactly 2700 frames
//                                            at 30 fps, out/purrfect-year-90s.mp4
//   node tools/make-year.mjs --whatsapp      the 35 s vertical cut: 1080x1920, exactly 1050 frames,
//                                            under 16 MB, out/purrfect-year-whatsapp.mp4
//   node tools/make-year.mjs --probe         print candidate moments per entry, read from the
//                                            running page, to tune the TABLE below
//       [--activity [--step 1]]              ... plus a motion scan of each entry's loop (slower)
//
// Options:
//   --resume              reuse finished segments (video and audio) whose every parameter matches;
//                         the parameters, a hash of the page's code and of the soundtrack's code
//                         are in each segment's file name
//   --jobs N              segments rendered at once (default: half the CPU cores, at most 4)
//   --no-titles           90 s cut without the lower-thirds
//   --city                90 s cut: the lower-third reads "date · city"
//   --no-audio            no audio track at all
//   --soundtrack FILE     another soundtrack script with the same interface (default tools/soundtrack.mjs)
//   --crf N --preset P    final encode (default 16 / slow for YouTube, 20 / slow for WhatsApp)
//   --max-mb 15.5         WhatsApp size limit (decimal MB); re-encoded in two passes if over
//   --fade S              dip through black between entries (default 0.3 s; 0.13 s vertical)
//   --entries a,b,...     only these entries (in page order), for tests
//   --seconds S           total length (default 90, or 35 vertical), for tests
//   --out FILE --work DIR --dry-run
//
// How it is made: every entry is rendered frame-exactly by tools/render-video.mjs
// into a lossless art-resolution segment (titles composited in art pixels, the
// dips through black frame-exact); the segments are joined frame-exactly and
// encoded once, with the soundtrack, at the final size. So CRF and size retries
// never re-render a frame, and the picture goes through one lossy encode only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT, AUDIO_RATE, SOUNDTRACK, artHash, ffprobe, openDiorama, parseArgs, pool, readEditions, readPcm, renderSoundtrack, rgbaToPng, run, shortHash,
  soundtrackHash, writeWav,
} from './lib.mjs';
import { lowerThird, verticalBands } from './titles.mjs';

const a = parseArgs();
const FPS = 30;
const wa = !!a.whatsapp;

// ---------------------------------------------------------------------------
// The table: where each entry's segment starts (seconds into its 240 s loop)
// and, for the vertical cut, the left edge x of its 216 px wide crop.
//   start  the 90 s cut (segments of 5.6 s)
//   wa     the vertical cut (segments of 2.2 s), when it differs from start
//   x      vertical crop: x .. x+216 of the 480 px frame
//   side   where the 90 s lower-third sits ('left' default, or 'right')
// Story beats (src/summer.js): the niece walks in at 20-24 and 140-144,
// the gift 40-46, blowing 98-100, candles out 100-112, the goal 150-158,
// the heart 60-66 and 180-186. Run --probe to see fireworks, the logo
// firework and other moments read from the page.
// Vertical crops (src/places.js anchors):
//   apt1, together: the window (x 203-239) and the whole building around it.
//   apt1 holidays, he alone in the window and she with her friends in the
//     plaza: the window (x 203-239) and the plaza group (x 330-432) span 230
//     px, more than the 216 px crop, so we favour x 200..416: the whole
//     window, the fire pit (x 400) and most of the group.
//   match: his balcony (x 198-244) and the plaza.
//   nyc: centred on the bench (x 244-274) with the hotel tower beside it.
//   trips: centred on stages.family (bhills x 198-262, marina x 150-226);
//     herndon has no family stage: centred on the party (x 80-150) and the
//     birthday table (x 112), with the house gable and window (x 208-219).
//   apt2: his window (x 205-220) with the walkers' path; Harvest keeps the
//     fire pit (x 103) in, Halloween the lobby door (x 315-322).
// ---------------------------------------------------------------------------
const TABLE = {
  // the two of them in the window; the busiest stretch of the Diwali fireworks
  diwali: { start: 147.5, wa: 75.5, x: 120 },
  halloween25: { start: 145, x: 120 },
  thanksgiving: { start: 60, x: 200 },
  christmas: { start: 25, x: 200 },
  // the logo firework rises at 118, bursts at about 119.5 and holds to 122.5
  newyear: { start: 117.5, wa: 119.3, x: 200 },
  // a busy stretch of the Lunar New Year fireworks
  lunar: { start: 145, wa: 79, x: 200 },
  easter: { start: 40, x: 200 },
  midsummer: { start: 30, x: 200 },
  // the goal at 150: a breath before, the cheer and the little fireworks
  match: { start: 148.5, wa: 149.6, x: 196 },
  // the second heart (180-186) and the tricolour triple bursting at 187.7 and
  // 188.3; the vertical cut catches the heart as it appears
  nyc: { start: 183.2, wa: 180.4, x: 151 },
  la: { start: 30, x: 122 },
  sandiego: { start: 30, x: 80 },
  // dad leans in (98), blows (98-100), the candles go out (100) and the cheer
  dc: { start: 97, wa: 98.2, x: 8, side: 'right' },
  // the niece walks in from the entrance (20-24)
  home: { start: 19.6, wa: 20.8, x: 120 },
  harvest: { start: 60, x: 96, side: 'right' },
  halloween: { start: 145, x: 112, side: 'right' },
};
// city labels per place (the titles; never addresses)
const CITY = { apt1: 'Boston', apt2: 'Boston', soho: 'New York', bhills: 'Los Angeles', marina: 'San Diego', herndon: 'Herndon, Virginia' };

const CW = 216; // vertical crop width in art px (x 5 = 1080)
const WA_SCALE = 5;
const WA_W = 216;
const WA_H = 384; // 1920 / 5: a 57 px band above and below the 270 px picture

// ---------------------------------------------------------------------------
// read the entries from the page
// ---------------------------------------------------------------------------
const pg = await openDiorama({}, { viewport: { width: 480, height: 270 } });
const LOOP = await pg.page.evaluate(() => window.HD.LOOP);
const EDS = await readEditions(pg.page);
const PLACES = await pg.page.evaluate(() => JSON.parse(JSON.stringify(window.HD.PLACES, (k, v) => (k === 'skyline' ? undefined : v))));
if (a.probe) {
  await probe(pg.page);
  await pg.browser.close();
  process.exit(0);
}
await pg.browser.close();

for (const id of Object.keys(TABLE)) if (!EDS.find((e) => e.id === id)) console.warn(`WARN table entry '${id}' is not an edition on the page`);
const pick = a.entries && a.entries !== true ? String(a.entries).split(',') : null;
if (pick) for (const id of pick) if (!EDS.find((e) => e.id === id)) throw new Error(`unknown entry '${id}' (known: ${EDS.map((e) => e.id).join(', ')})`);
const entries = EDS.filter((e) => !pick || pick.includes(e.id));

/** sensible default crop for an entry missing from the table */
function defaultX(e) {
  const p = PLACES[e.place] || {};
  const s = p.stages || {};
  const span = s.family || (p.bench && { x0: p.bench.x0, x1: p.bench.x1 }) || (p.catWindow && { x0: p.catWindow.x, x1: p.catWindow.x + p.catWindow.w }) || { x0: 132, x1: 348 };
  return Math.round((span.x0 + span.x1) / 2 - CW / 2);
}
function row(e) {
  let t = TABLE[e.id];
  if (!t) {
    console.warn(`WARN no table entry for '${e.id}': starting at 30 s, crop centred on its place`);
    t = { start: 30, x: defaultX(e) };
  }
  const x = Math.max(0, Math.min(480 - CW, Math.round(t.x ?? defaultX(e))));
  return { start: wa ? (t.wa ?? t.start) : t.start, x, side: t.side || 'left' };
}

// ---------------------------------------------------------------------------
// the plan: whole frames per segment, the total exact
// ---------------------------------------------------------------------------
const seconds = Number(a.seconds ?? (wa ? 35 : 90));
const TOTAL = Math.round(seconds * FPS);
const N = entries.length;
if (TOTAL < N) throw new Error(`${TOTAL} frames cannot be split across ${N} entries`);
const fade = Math.max(0, Math.round(Number(a.fade ?? (wa ? 0.13 : 0.3)) * FPS));
const endIn = wa ? fade : Math.max(fade, 15); // the film fades in a little slower...
const endOut = wa ? Math.max(fade, 8) : Math.max(fade, 24); // ...and out slower still
const titles = wa || !a['no-titles'];
const scale = wa ? WA_SCALE : Number(a.scale ?? 4);
const outW = wa ? WA_W * WA_SCALE : 480 * scale;
const outH = wa ? WA_H * WA_SCALE : 270 * scale;
const out = path.resolve(ROOT, a.out || (wa ? 'out/purrfect-year-whatsapp.mp4' : 'out/purrfect-year-90s.mp4'));
const work = path.resolve(ROOT, a.work || path.join('out', 'year', wa ? 'wa' : '90s'));
fs.mkdirSync(work, { recursive: true });
const jobs = Math.max(1, Number(a.jobs ?? Math.min(4, Math.max(1, os.cpus().length >> 1))));
const art = artHash();
const D = 0.15; // audio crossfade between entries, seconds
const SPF = AUDIO_RATE / FPS; // audio samples per frame (1600)
const XF = Math.round(D * AUDIO_RATE); // crossfade length in samples (7200)
const script = path.resolve(ROOT, a.soundtrack && a.soundtrack !== true ? String(a.soundtrack) : SOUNDTRACK);

let acc = 0;
const segs = entries.map((e, i) => {
  const n = Math.floor(((i + 1) * TOTAL) / N) - Math.floor((i * TOTAL) / N);
  const r = row(e);
  const fin = i === 0 ? endIn : fade;
  const fout = i === N - 1 ? endOut : fade;
  const date = e.when + (a.city && !wa ? ' · ' + (CITY[e.place] || '') : '');
  let overlay = null;
  if (wa) overlay = verticalBands({ name: e.name, date: e.when, city: CITY[e.place] || e.place }, { cw: CW, ch: 270, W: WA_W, H: WA_H });
  else if (titles) overlay = lowerThird({ name: e.name, date }, { side: r.side, from: Math.max(3, fin), to: Math.max(3, fin) + 45 });
  const crop = wa ? `${r.x},0,${CW},270` : '0,0,480,270';
  const key = `${String(i + 1).padStart(2, '0')}-${e.id}-s${r.start}-n${n}-c${crop.replace(/,/g, '.')}-f${fin}.${fout}-o${overlay ? shortHash(overlay) : 'none'}-L${LOOP}-a${art}`;
  const s = { i, e, n, f0: acc, start: r.start, x: r.x, crop, fin, fout, overlay, file: path.join(work, key + '.mkv') };
  acc += n;
  return s;
});

console.log(
  `${wa ? 'WhatsApp vertical' : 'YouTube'} cut: ${N} entries, ${TOTAL} frames (${(TOTAL / FPS).toFixed(3)} s) at ${outW}x${outH}, ` +
    `segments of ${Math.min(...segs.map((s) => s.n))}-${Math.max(...segs.map((s) => s.n))} frames, dips of ${fade} frames, ${jobs} job(s)`,
);
for (const s of segs) {
  const t1 = s.start + s.n / FPS;
  console.log(
    `  ${String(s.i + 1).padStart(2)} ${s.e.id.padEnd(12)} ${String(s.n).padStart(3)} frames  t ${s.start.toFixed(2)}-${t1.toFixed(2)}` +
      (wa ? `  crop x ${s.x}-${s.x + CW}` : '') +
      `  "${s.e.name}" · ${s.e.when}`,
  );
}
if (a['dry-run']) process.exit(0);

// ---------------------------------------------------------------------------
// video segments: lossless, art resolution, in parallel
// ---------------------------------------------------------------------------
const t0 = Date.now();
const countFrames = (f) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  return parseInt(r.stdout, 10);
};
await pool(segs, jobs, async (s) => {
  const tag = `[${String(s.i + 1).padStart(2, '0')} ${s.e.id}] `;
  if (a.resume && fs.existsSync(s.file) && countFrames(s.file) === s.n) {
    console.log(tag + 'reusing ' + path.basename(s.file));
    return;
  }
  const part = s.file.replace(/\.mkv$/, '.part.mkv');
  const args = ['tools/render-video.mjs', '--edition', s.e.id, '--start', String(s.start), '--seconds', String(s.n / FPS), '--crop', s.crop, '--scale', '1', '--codec', 'lossless'];
  args.push('--fade-in-frames', String(s.fin), '--fade-out-frames', String(s.fout), '--out', part);
  if (s.overlay) {
    const ovf = s.file.replace(/\.mkv$/, '.overlay.json');
    fs.writeFileSync(ovf, JSON.stringify(s.overlay, null, 1));
    args.push('--overlay', ovf);
  }
  const r = await run('node', args, { prefix: tag });
  if (r.code !== 0) throw new Error(`${tag}render-video failed (exit ${r.code})`);
  const got = countFrames(part);
  if (got !== s.n) throw new Error(`${tag}segment has ${got} frames, expected ${s.n}`);
  fs.renameSync(part, s.file);
});
console.log(`video segments ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// a contact sheet: every segment at about 1 s in, for a quick look
{
  const pics = segs.map((s) => {
    const k = Math.min(s.n - 1, FPS);
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', s.file, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
    return r.stdout;
  });
  const cw = wa ? WA_W : 480;
  const ch = wa ? WA_H : 270;
  const cols = wa ? Math.min(8, N) : Math.min(4, N);
  const rows = Math.ceil(N / cols);
  const gap = 2;
  const W = cols * cw + (cols - 1) * gap;
  const H = rows * ch + (rows - 1) * gap;
  const img = new Uint8Array(W * H * 4).fill(255);
  pics.forEach((p, i) => {
    if (!p || p.length !== cw * ch * 4) return;
    const ox = (i % cols) * (cw + gap);
    const oy = Math.floor(i / cols) * (ch + gap);
    for (let y = 0; y < ch; y++) img.set(p.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * W + ox) * 4);
  });
  const cs = path.join(work, 'contact.png');
  rgbaToPng(img, W, H, cs, 1);
  console.log(`contact sheet (each entry about 1 s in): ${cs}`);
}

// ---------------------------------------------------------------------------
// audio: the soundtrack per segment, joined with 0.15 s equal-power crossfades
// centred on the cuts. Segment i plays loop time [start - 0.075, start + n/30
// + 0.075), so after the crossfades every sound sits on its own frame.
// ---------------------------------------------------------------------------
let audioWav = null;
if (!a['no-audio']) {
  const ta = Date.now();
  const total = TOTAL * SPF;
  const h = Math.min(XF >> 1, Math.floor((Math.min(...segs.map((s) => s.n)) * SPF) / 2));
  const sh = soundtrackHash(script);
  const failed = [];
  const bufs = await pool(segs, jobs, async (s) => {
    const len = s.n * SPF + 2 * h;
    const aStart = (((s.start - h / AUDIO_RATE) % LOOP) + LOOP) % LOOP;
    const f = path.join(work, `${String(s.i + 1).padStart(2, '0')}-${s.e.id}-a${aStart.toFixed(4)}-l${len}-${sh}.wav`);
    if (!(a.resume && fs.existsSync(f))) {
      const r = await renderSoundtrack({ edition: s.e.id, start: aStart, seconds: len / AUDIO_RATE, out: f, script });
      if (!r.ok) {
        failed.push(`${s.e.id}: ${r.why}`);
        return new Int16Array(len * 2);
      }
      if (r.warn) console.warn(`WARN soundtrack ${s.e.id}: ${r.warn}`);
    }
    const pcm = readPcm(f);
    const buf = new Int16Array(len * 2);
    buf.set(pcm.subarray(0, Math.min(pcm.length, len * 2)));
    if (pcm.length < len * 2 - 2 * 48) console.warn(`WARN soundtrack ${s.e.id}: ${pcm.length / 2} samples, expected ${len} (padded with silence)`);
    return buf;
  });
  if (failed.length) {
    console.warn(`WARN the soundtrack failed for ${failed.length} of ${N} entries; they are silent:`);
    for (const m of failed) console.warn('  ' + m);
  }
  const mix = new Float32Array(total * 2);
  segs.forEach((s, i) => {
    const T0 = s.f0 * SPF;
    const T1 = (s.f0 + s.n) * SPF;
    const b = bufs[i];
    const lo = Math.max(0, T0 - h);
    const hi = Math.min(total, T1 + h);
    for (let p = lo; p < hi; p++) {
      let g = 1;
      if (i > 0 && p < T0 + h) g *= Math.sin((Math.PI / 2) * ((p - (T0 - h) + 0.5) / (2 * h)));
      if (i < N - 1 && p >= T1 - h) g *= Math.cos((Math.PI / 2) * ((p - (T1 - h) + 0.5) / (2 * h)));
      const q = (p - (T0 - h)) * 2;
      mix[p * 2] += g * b[q];
      mix[p * 2 + 1] += g * b[q + 1];
    }
  });
  // the film fades in and out with the picture
  const fIn = Math.round(endIn / FPS * AUDIO_RATE * 0.6);
  const fOut = Math.round((endOut / FPS) * AUDIO_RATE);
  const pcm = new Int16Array(total * 2);
  let clip = 0;
  for (let p = 0; p < total; p++) {
    let g = 1;
    if (p < fIn) g = Math.sin((Math.PI / 2) * ((p + 0.5) / fIn));
    if (p >= total - fOut) g = Math.min(g, Math.sin((Math.PI / 2) * ((total - p - 0.5) / fOut)));
    for (let c = 0; c < 2; c++) {
      let v = Math.round(mix[p * 2 + c] * g);
      if (v > 32767 || v < -32768) {
        clip++;
        v = v > 0 ? 32767 : -32768;
      }
      pcm[p * 2 + c] = v;
    }
  }
  if (clip) console.warn(`WARN ${clip} audio samples clipped in the crossfades`);
  audioWav = path.join(work, 'soundtrack.wav');
  writeWav(audioWav, pcm);
  const lufs = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', audioWav, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/I:\s+(-?[\d.]+|-inf) LUFS\s*\n\s*Threshold[\s\S]*$/);
  console.log(`audio ready in ${((Date.now() - ta) / 1000).toFixed(0)} s: ${total} samples (${(total / AUDIO_RATE).toFixed(3)} s)${lufs ? `, integrated ${lufs[1]} LUFS` : ''}${failed.length === N ? ' (silent)' : ''}`);
}

// ---------------------------------------------------------------------------
// join frame-exactly and encode once at the final size
// ---------------------------------------------------------------------------
const list = path.join(work, 'parts.txt');
fs.writeFileSync(list, segs.map((s) => `file '${s.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
// exact timestamps (frame n at n/30 s), so frames pass through untouched
const vf = `settb=1/${FPS},setpts=N,scale=${outW}:${outH}:flags=neighbor:out_color_matrix=bt709:out_range=tv,format=yuv420p`;
const color709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const crf = Number(a.crf ?? (wa ? 20 : 16));
const preset = String(a.preset || 'slow');
const profile = wa ? ['-profile:v', 'high', '-level:v', '4.0'] : ['-profile:v', 'high'];
const inputs = ['-f', 'concat', '-safe', '0', '-i', list, ...(audioWav ? ['-i', audioWav] : [])];
const maps = ['-map', '0:v:0', ...(audioWav ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-ar', String(AUDIO_RATE), '-ac', '2'] : [])];
const common = ['-fps_mode', 'passthrough', '-vf', vf, '-c:v', 'libx264', '-preset', preset, ...profile, '-tune', 'animation', '-g', String(FPS * 2), ...color709];
const ffmpeg = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }).status;
fs.mkdirSync(path.dirname(out), { recursive: true });
const te = Date.now();
if (ffmpeg([...inputs, ...maps, ...common, '-crf', String(crf), '-frames:v', String(TOTAL), '-movflags', '+faststart', out]) !== 0) process.exit(1);
let size = fs.statSync(out).size;
const maxBytes = Number(a['max-mb'] ?? 15.5) * 1e6;
if (wa && size > maxBytes) {
  // two passes at the bitrate that fits, leaving 3% for the container
  const audioBits = audioWav ? 192000 * seconds : 0;
  const kbps = Math.floor((maxBytes * 8 * 0.97 - audioBits) / seconds / 1000);
  console.log(`${(size / 1e6).toFixed(2)} MB at CRF ${crf} is over ${maxBytes / 1e6} MB: two-pass encode at ${kbps} kbps`);
  const plog = path.join(work, 'x264-2pass');
  const vb = ['-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.5) + 'k', '-bufsize', kbps * 2 + 'k', '-passlogfile', plog];
  if (ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', ...common, ...vb, '-pass', '1', '-frames:v', String(TOTAL), '-an', '-f', 'null', '-']) !== 0) process.exit(1);
  if (ffmpeg([...inputs, ...maps, ...common, ...vb, '-pass', '2', '-frames:v', String(TOTAL), '-movflags', '+faststart', out]) !== 0) process.exit(1);
  size = fs.statSync(out).size;
}
console.log(`encoded in ${((Date.now() - te) / 1000).toFixed(0)} s`);

// ---------------------------------------------------------------------------
// check the result
// ---------------------------------------------------------------------------
const info = ffprobe(out);
const v = info.streams.find((s) => s.codec_type === 'video');
const au = info.streams.find((s) => s.codec_type === 'audio');
const frames = countFrames(out);
const problems = [];
if (frames !== TOTAL) problems.push(`${frames} frames, expected ${TOTAL}`);
if (v.width !== outW || v.height !== outH) problems.push(`${v.width}x${v.height}, expected ${outW}x${outH}`);
if (audioWav && (!au || Math.abs(+au.duration - TOTAL / FPS) > 0.03)) problems.push(`audio ${au ? au.duration + ' s' : 'missing'}, expected ${TOTAL / FPS} s`);
if (wa && size >= maxBytes) problems.push(`${(size / 1e6).toFixed(2)} MB is over the ${maxBytes / 1e6} MB limit`);
console.log(
  `wrote ${out}: ${v.width}x${v.height}, ${frames} frames (${(+info.format.duration).toFixed(3)} s), ` +
    `${au ? `AAC ${Math.round(au.bit_rate / 1000)} kbps ${(+au.duration).toFixed(3)} s` : 'no audio'}, ${(size / 1e6).toFixed(2)} MB, total ${((Date.now() - t0) / 1000).toFixed(0)} s`,
);
if (problems.length) {
  for (const p of problems) console.error('FAIL ' + p);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// --probe: candidate moments per entry, read from the running page
// ---------------------------------------------------------------------------
async function probe(page) {
  const step = Number(a.step ?? 1);
  const seg90 = 90 / EDS.length;
  const segWa = 35 / EDS.length;
  const only = a.entries && a.entries !== true ? String(a.entries).split(',') : null;
  const fmt = (w) => `${w[0].toFixed(1)}-${w[1].toFixed(1)}`;
  const json = [];
  for (const e of EDS) {
    if (only && !only.includes(e.id)) continue;
    const t = TABLE[e.id] || {};
    const p = PLACES[e.place] || {};
    const r = await page.evaluate(
      ([id, seg90, segWa, wantActivity, step, cropX, CW]) => {
        const HD = window.HD;
        HD.setEdition(id);
        const L = HD.LOOP;
        const ed = HD.edition;
        const res = { beats: {}, fireworks: null, logo: null, activity: null };
        // story windows from HD.summer, sampled every 0.05 s
        const S = HD.summer || {};
        const relevant = {
          niece: ed.cast.niece,
          gift: ed.cast.party === 'birthday',
          blowing: ed.cast.party === 'birthday',
          candlesOut: ed.cast.party === 'birthday',
          goal: ed.cast.party === 'match' || HD.tag('goal-fireworks'),
          heart: ed.cast.party === 'bench',
        };
        for (const k of Object.keys(S)) {
          if (typeof S[k] !== 'function' || ['sec', 'win', 'breeze', 'giftOpened'].includes(k)) continue;
          if (k in relevant && !relevant[k]) continue;
          const wins = [];
          let cur = null;
          for (let i = 0; i <= L * 20; i++) {
            const tt = i / 20;
            let v;
            try {
              v = S[k](tt);
            } catch (err) {
              v = -1;
            }
            const on = v && typeof v === 'object' ? !!v.here && v.phase !== 'stay' : typeof v === 'number' ? v >= 0 : !!v;
            const label = v && typeof v === 'object' ? v.phase : '';
            if (on && (!cur || cur.label !== label)) {
              if (cur) wins.push(cur);
              cur = { a: tt, b: tt, label };
            } else if (on) cur.b = tt;
            else if (cur) {
              wins.push(cur);
              cur = null;
            }
          }
          if (cur) wins.push(cur);
          if (wins.length && !(wins.length === 1 && wins[0].a === 0 && wins[0].b >= L - 0.05)) res.beats[k] = wins.map((w) => [w.a, w.b + 0.05, w.label]);
          else if (wins.length) res.beats[k] = 'all loop';
        }
        // lightning: the sky's flash level (HD.sky.flash, 0..1), above 0.2
        if (HD.sky && typeof HD.sky.flash === 'function' && ed.weather.lightning > 0) {
          const wins = [];
          let cur = null;
          for (let i = 0; i <= L * 20; i++) {
            const tt = i / 20;
            const on = HD.sky.flash(tt) > 0.2;
            if (on && !cur) cur = [tt, tt];
            else if (on) cur[1] = tt;
            else if (cur) {
              wins.push([cur[0], cur[1] + 0.05]);
              cur = null;
            }
          }
          if (cur) wins.push([cur[0], cur[1] + 0.05]);
          res.beats.lightning = wins.map((w) => [w[0], w[1], '']);
        }
        // fireworks: when shells burst, and the busiest stretches
        if (HD._fireworks && ed.fireworks > 0) {
          const s = HD._fireworks.show();
          const inCrop = (sh) => Number.isFinite(sh.bx) && sh.bx !== 0 && sh.bx >= cropX && sh.bx < cropX + CW;
          const bursts = s.list.map((sh) => ({ t: (sh.t0 + sh.rise) % L, story: !!(sh.fixed || sh.story), col: sh.col, type: sh.type, crop: inCrop(sh) }));
          const best = (len) => {
            const out = [];
            for (let st = 0; st < L; st += 0.5) {
              const n = bursts.filter((b) => {
                const d = (((b.t - st) % L) + L) % L;
                return d >= 0.3 && d < len - 0.6;
              }).length;
              out.push([st, n]);
            }
            out.sort((p, q) => q[1] - p[1]);
            const pickd = [];
            for (const o of out) if (pickd.length < 3 && pickd.every((q) => Math.abs(q[0] - o[0]) >= len)) pickd.push(o);
            return pickd;
          };
          res.fireworks = {
            shells: bursts.length,
            inCrop: bursts.filter((b) => b.crop).length,
            story: bursts.filter((b) => b.story).map((b) => +b.t.toFixed(2)),
            best90: best(seg90),
            bestWa: best(segWa),
          };
        }
        if (HD.brand && HD.brand.logoWindow && HD.tag('logo-firework')) {
          res.logo = HD.brand.logoWindow;
          try {
            res.logoBox = HD.brand.logoBox ? HD.brand.logoBox() : null;
          } catch (err) {
            res.logoBox = null;
          }
        }
        if (wantActivity) {
          // how much moves at each moment: pixels that change over 0.1 s, in the
          // vertical crop and in the whole frame
          const ctx = HD.buffers.main.getContext('2d');
          const grab = (tt) => (HD.renderAt(tt), ctx.getImageData(0, 0, HD.W, HD.H).data.slice());
          const act = [];
          for (let tt = 0; tt < L; tt += step) {
            const A = grab(tt);
            const B = grab(tt + 0.1);
            let crop = 0;
            let all = 0;
            for (let i = 0; i < A.length; i += 4) {
              const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
              if (d > 24) {
                all++;
                const x = (i >> 2) % HD.W;
                if (x >= cropX && x < cropX + CW) crop++;
              }
            }
            act.push([+tt.toFixed(2), crop, all]);
          }
          res.activity = act;
        }
        return res;
      },
      [e.id, seg90, segWa, !!a.activity, step, t.x ?? 132, CW],
    );
    // report
    const start = t.start;
    const waStart = t.wa ?? t.start;
    const x = t.x;
    console.log(`\n${String(e.index + 1).padStart(2, '0')} ${e.id}  (${e.place}, ${e.light}${e.fireworks ? ', fireworks ' + e.fireworks : ''}; cast ${JSON.stringify(e.cast)})`);
    console.log(
      `   table: 90 s ${start ?? '-'}..${start !== undefined ? (start + seg90).toFixed(1) : '-'}   vertical ${waStart ?? '-'}..${waStart !== undefined ? (waStart + segWa).toFixed(1) : '-'}   crop x ${x ?? '-'}..${x !== undefined ? x + CW : '-'}`,
    );
    for (const [k, w] of Object.entries(r.beats)) console.log(`   ${k.padEnd(11)} ${w === 'all loop' ? 'all loop' : w.map((q) => fmt(q) + (q[2] ? ' ' + q[2] : '')).join(', ')}`);
    if (r.logo) {
      const b = r.logoBox;
      const where = b && x !== undefined ? ` at x ${b.x0}-${b.x1}, ${b.x0 >= x && b.x1 <= x + CW ? 'inside' : 'NOT inside'} the vertical crop` : '';
      console.log(`   logo fw     ${fmt(r.logo)}${where}`);
    }
    if (r.fireworks) {
      const f = r.fireworks;
      console.log(`   fireworks   ${f.shells} shells, ${f.inCrop} burst inside the vertical crop${f.story.length ? `; story shells burst at ${f.story.join(', ')}` : ''}`);
      console.log(`               busiest 90 s windows: ${f.best90.map(([s, n]) => `${s}+ (${n} bursts)`).join(', ')}`);
      console.log(`               busiest vertical windows: ${f.bestWa.map(([s, n]) => `${s}+ (${n})`).join(', ')}`);
    }
    // what the vertical crop holds
    if (x !== undefined) {
      const spans = [];
      const add = (name, x0, x1) => spans.push([name, x0, x1]);
      if (p.catWindow) add('catWindow', p.catWindow.x, p.catWindow.x + p.catWindow.w);
      if (p.balcony) add('balcony', p.balcony.x0, p.balcony.x1);
      if (p.entrance) add('entrance', p.entrance.x0, p.entrance.x1);
      for (const [k, s] of Object.entries(p.stages || {})) add('stage.' + k, s.x0, s.x1);
      if (p.bench) add('bench', p.bench.x0, p.bench.x1);
      if (p.table) add('table', p.table.x - 10, p.table.x + 10);
      if (p.castle) add('castle', p.castle.x - 8, p.castle.x + 8);
      if (p.firepit && e.fire === 'firepit') add('firepit', p.firepit.x - 6, p.firepit.x + 6);
      const verdict = spans.map(([n, x0, x1]) => {
        const inside = Math.max(0, Math.min(x1, x + CW) - Math.max(x0, x));
        const k = inside / Math.max(1, x1 - x0);
        return `${n} ${x0}-${x1} ${k >= 0.999 ? 'in' : k <= 0 ? 'OUT' : Math.round(k * 100) + '%'}`;
      });
      console.log(`   crop holds  ${verdict.join('; ')}`);
    }
    if (r.activity) {
      const act = r.activity;
      const bins = 60;
      const per = act.length / bins;
      const vals = Array.from({ length: bins }, (_, b) => {
        const sl = act.slice(Math.floor(b * per), Math.floor((b + 1) * per));
        return sl.length ? Math.max(...sl.map((q) => q[2])) : 0;
      });
      // scaled to the 95th percentile, so one lightning flash does not flatten the rest
      const sorted = [...vals].sort((p, q) => p - q);
      const mx = Math.max(1, sorted[Math.floor(sorted.length * 0.95)]);
      const ramp = ' .:-=+*#%@';
      console.log(`   motion      |${vals.map((v) => ramp[Math.min(9, Math.round((v / mx) * 8))]).join('')}| 0..${LOOP} s in ${(LOOP / bins).toFixed(0)} s bins, whole frame`);
      const top = [...act].sort((p, q) => q[1] - p[1]);
      const pickd = [];
      for (const o of top) if (pickd.length < 5 && pickd.every((q) => Math.abs(q[0] - o[0]) >= 4)) pickd.push(o);
      console.log(`   most motion in the crop at: ${pickd.map((q) => `${q[0]}s (${q[1]} px)`).join(', ')}`);
    }
    json.push({ id: e.id, table: t, ...r });
  }
  if (a.json) {
    const f = path.resolve(String(a.json === true ? path.join(ROOT, 'out', 'probe.json') : a.json));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(json, null, 1));
    console.log('\nwrote ' + f);
  }
}
