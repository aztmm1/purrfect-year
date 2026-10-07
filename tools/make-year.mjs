#!/usr/bin/env node
// Purrfect Year: the two-minute story of the year. The sixteen diary entries
// back to back, in the order the page defines them (HD.EDITIONS), 7.5 s each,
// every entry on its own story beat, dipping through black into the next.
//
//   node tools/make-year.mjs                 exactly 3600 frames at 30 fps (225 per entry), with
//                                            the soundtrack:
//                                              out/purrfect-year-2min-4k.mp4     3840x2160
//                                              out/purrfect-year-2min-1080p.mp4  1920x1080 share copy
//   node tools/make-year.mjs --probe         print the story beats per entry, read from the
//                                            running page, to tune the TABLE below
//       [--activity [--step 1]]              ... plus a motion scan of each entry's loop (slower)
//       [--json [FILE]]                      ... and save it as JSON
//
// Options:
//   --resume              reuse finished segments (video and audio) whose every parameter matches;
//                         the parameters, a hash of the page's code and of the soundtrack's code
//                         are in each segment's file name
//   --jobs N              segments rendered at once (default: half the CPU cores, at most 4)
//   --no-titles           no lower-thirds (entry name and date over the first 1.8 s of each entry)
//   --no-audio            no audio track at all
//   --soundtrack FILE     another soundtrack script with the same interface (default tools/soundtrack.mjs)
//   --crf N --preset P    final encode (default 16 / medium: flat pixel art gains next to
//                         nothing from slower presets); x264 High, yuv420p, bt709, faststart
//   --scale K             main output scale of the 480x270 art (default 8 = 3840x2160)
//   --no-share            skip the half-size share copy
//   --fade S              dip through black between entries (default 0.3 s)
//   --entries a,b,...     only these entries (in page order), for tests
//   --per N               frames per entry (default 225 = 7.5 s), for tests
//   --out FILE --out-share FILE --work DIR --dry-run
//
// How it is made: every entry is rendered frame-exactly by tools/render-video.mjs
// into a lossless art-resolution segment (titles composited in art pixels, the
// dips through black frame-exact); the segments are joined frame-exactly and
// encoded once, with the soundtrack, in a single ffmpeg pass: the picture is
// scaled up with nearest-neighbour to the 4K size, and the share copy is that
// same 4K picture scaled down by exactly 2 with nearest-neighbour (so it is
// pixel-identical to the 4K picture, without a second lossy generation).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, AUDIO_RATE, SOUNDTRACK, artHash, ffprobe, openDiorama, parseArgs, pool, readEditions, readPcm, renderSoundtrack, rgbaToPng, run, shortHash, soundtrackHash, writeWav } from './lib.mjs';
import { lowerThird } from './titles.mjs';
import { GLYPHS } from './pixfont.mjs';

const a = parseArgs();
const FPS = 30;
const PER_DEFAULT = 225; // 7.5 s per entry: 16 entries = 3600 frames = 2:00.000

// ---------------------------------------------------------------------------
// The table: where each entry's 7.5 s segment starts (seconds into its 240 s
// loop), where its lower-third sits, and the left edge x of a 216 px wide
// (9:16 at full height) crop that holds the cat window and the people, for
// stills and thumbnails (--probe checks what each crop holds).
// Story beats (src/summer.js, src/family.js; run --probe for the rest):
//   the niece walks in from the entrance at 20-24 and 140-144, the gift
//   40-46, dad blows 98-100 and the candles are out 100-112, the goal
//   150-158, the heart 60-66 and 180-186; the walkers stroll past the apt2
//   window rightwards from 18 and leftwards from 138 (about 11 px/s); the
//   trick-or-treat kittens reach the apt1 lobby door at about 118 and wait
//   there 6 s; lightning at 64.8 and 170.4 at the Halloweens.
// Crops (src/places.js anchors):
//   apt1, together: the window (x 203-239) with the building around it.
//   apt1 holidays, he alone in the window, she with her friends in the
//     plaza (x 330-432): the two span 230 px, more than 216, so x 200..416
//     keeps the whole window, the fire pit (x 400) and most of the group.
//   match: his balcony (x 198-244) and the plaza. nyc: the bench (x 244-274)
//   with the hotel tower. Trips: stages.family. herndon: the party (x 80-150)
//   and the table (x 112) with the house window (x 208-219). apt2: his window
//   (x 205-220) over the walkers' path.
// ---------------------------------------------------------------------------
const TABLE = {
  // the two of them in the window; a busy stretch of the Diwali fireworks
  diwali: { start: 147.5, x: 120 },
  // the trick-or-treat kittens walk up to the lobby door and wait there
  halloween25: { start: 115, x: 120 },
  // she and her friends round the fire pit, warm mugs; he at the window
  thanksgiving: { start: 60, x: 200 },
  christmas: { start: 25, x: 200 },
  // the logo firework rises at 118, bursts at about 119.5 and holds to 123.5
  newyear: { start: 117, x: 200 },
  // a busy stretch of the Lunar New Year fireworks
  lunar: { start: 200, x: 200 },
  easter: { start: 40, x: 200 },
  midsummer: { start: 30, x: 200 },
  // the goal at 150: a breath before, the cheer and the little fireworks
  match: { start: 149, x: 196 },
  // the second heart (180-186), then the tricolour triple bursting at 187.7
  // and 188.3
  nyc: { start: 181.3, x: 151 },
  la: { start: 30, x: 122 },
  sandiego: { start: 30, x: 80 },
  // dad leans in (98), blows (98-100), the candles go out (100) and the cheer
  dc: { start: 96, x: 8, side: 'right' },
  // the niece walks out of the entrance (20-24)
  home: { start: 19, x: 120 },
  // she and her friends stroll past under his window, left to right
  harvest: { start: 35, x: 96, side: 'right' },
  // the costumed walkers pass his window right to left, then the lightning
  // (170.4)
  halloween: { start: 164, x: 112, side: 'right' },
};

const CW = 216; // crop width in art px

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
  return { start: t.start, x, side: t.side || 'left' };
}

// ---------------------------------------------------------------------------
// the plan: whole frames per segment, the total exact
// ---------------------------------------------------------------------------
const PER = Math.round(Number(a.per ?? PER_DEFAULT));
const N = entries.length;
const TOTAL = PER * N;
if (PER < 30) throw new Error(`--per ${PER}: at least 30 frames per entry`);
const fade = Math.max(0, Math.round(Number(a.fade ?? 0.3) * FPS));
const endIn = Math.max(fade, 15); // the film fades in a little slower...
const endOut = Math.max(fade, 24); // ...and out slower still
const titles = !a['no-titles'];
const TITLE_TO = 54; // the lower-third is gone 1.8 s into each entry
const scale = Math.round(Number(a.scale ?? 8));
const outW = 480 * scale;
const outH = 270 * scale;
const share = !a['no-share'] && scale % 2 === 0;
if (!a['no-share'] && !share) console.warn(`WARN --scale ${scale} is odd: no exact half-size share copy`);
const shareW = outW / 2;
const shareH = outH / 2;
const out = path.resolve(ROOT, a.out && a.out !== true ? String(a.out) : 'out/purrfect-year-2min-4k.mp4');
const outShare = path.resolve(
  ROOT,
  a['out-share'] && a['out-share'] !== true ? String(a['out-share']) : a.out && a.out !== true ? out.replace(/(-4k)?\.mp4$/i, '') + `-${shareH}p.mp4` : 'out/purrfect-year-2min-1080p.mp4',
);
const work = path.resolve(ROOT, a.work && a.work !== true ? String(a.work) : path.join('out', 'year', '2min'));
fs.mkdirSync(work, { recursive: true });
const jobs = Math.max(1, Number(a.jobs ?? Math.min(4, Math.max(1, os.cpus().length >> 1))));
const art = artHash();
const D = 0.15; // audio crossfade between entries, seconds
const SPF = AUDIO_RATE / FPS; // audio samples per frame (1600)
const XF = Math.round(D * AUDIO_RATE); // crossfade length in samples (7200)
const script = path.resolve(ROOT, a.soundtrack && a.soundtrack !== true ? String(a.soundtrack) : SOUNDTRACK);
const known = new Set(GLYPHS);

let acc = 0;
const segs = entries.map((e, i) => {
  const n = PER;
  const r = row(e);
  const fin = i === 0 ? endIn : fade;
  const fout = i === N - 1 ? endOut : fade;
  let overlay = null;
  if (titles) {
    const missing = [...new Set([...(e.name + e.when)].filter((ch) => !known.has(ch) && !known.has(ch.toUpperCase())))];
    if (missing.length) console.warn(`WARN ${e.id}: the pixel font has no glyph for ${missing.map((m) => JSON.stringify(m)).join(' ')}`);
    overlay = lowerThird({ name: e.name, date: e.when }, { side: r.side, from: Math.min(4, fin), to: Math.min(TITLE_TO, n - fout) });
  }
  const key = `${String(i + 1).padStart(2, '0')}-${e.id}-s${r.start}-n${n}-f${fin}.${fout}-o${overlay ? shortHash(overlay) : 'none'}-L${LOOP}-a${art}`;
  const s = { i, e, n, f0: acc, start: r.start, x: r.x, fin, fout, overlay, file: path.join(work, key + '.mkv') };
  acc += n;
  return s;
});

console.log(
  `Two-minute story: ${N} entries, ${TOTAL} frames (${(TOTAL / FPS).toFixed(3)} s) at ${outW}x${outH}${share ? ` + ${shareW}x${shareH} share copy` : ''}, ` +
    `${PER} frames per entry, dips of ${fade} frames, ${titles ? 'lower-thirds' : 'no titles'}, ${jobs} job(s)`,
);
for (const s of segs) {
  const t1 = s.start + s.n / FPS;
  console.log(`  ${String(s.i + 1).padStart(2)} ${s.e.id.padEnd(12)} t ${s.start.toFixed(2)}-${t1.toFixed(2)}  crop x ${String(s.x).padStart(3)}-${s.x + CW}  "${s.e.name}" · ${s.e.when}`);
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
async function videoStage() {
  await pool(segs, jobs, async (s) => {
    const tag = `[${String(s.i + 1).padStart(2, '0')} ${s.e.id}] `;
    if (a.resume && fs.existsSync(s.file) && countFrames(s.file) === s.n) {
      console.log(tag + 'reusing ' + path.basename(s.file));
      return;
    }
    const part = s.file.replace(/\.mkv$/, '.part.mkv');
    const args = ['tools/render-video.mjs', '--edition', s.e.id, '--start', String(s.start), '--seconds', String(s.n / FPS), '--scale', '1', '--codec', 'lossless'];
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

  // a contact sheet: every segment at about 1 s in (titles up), for a quick look
  {
    const pics = segs.map((s) => {
      const k = Math.min(s.n - 1, FPS);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', s.file, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
        maxBuffer: 1 << 26,
      });
      return r.stdout;
    });
    const cw = 480;
    const ch = 270;
    const cols = Math.min(4, N);
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
}

// ---------------------------------------------------------------------------
// audio: the soundtrack per segment (same edition, start and length), joined
// with 0.15 s equal-power crossfades centred on the cuts. Segment i plays loop
// time [start - 0.075, start + n/30 + 0.075), so after the crossfades every
// sound sits on its own frame. A segment whose soundtrack fails is silent.
// ---------------------------------------------------------------------------
async function audioStage() {
  if (a['no-audio']) return null;
  const ta = Date.now();
  const total = TOTAL * SPF;
  const h = Math.min(XF >> 1, Math.floor((PER * SPF) / 2));
  const sh = soundtrackHash(script);
  const failed = [];
  const bufs = await pool(segs, jobs, async (s) => {
    const len = s.n * SPF + 2 * h;
    const aStart = (((s.start - h / AUDIO_RATE) % LOOP) + LOOP) % LOOP;
    // the soundtrack follows the picture's events, so the page's code hash is part of the key
    const f = path.join(work, `${String(s.i + 1).padStart(2, '0')}-${s.e.id}-a${aStart.toFixed(4)}-l${len}-L${LOOP}-${sh}-${art}.wav`);
    if (!(a.resume && fs.existsSync(f))) {
      const r = await renderSoundtrack({ edition: s.e.id, start: aStart, seconds: len / AUDIO_RATE, out: f, script });
      if (!r.ok) {
        failed.push(`${s.e.id}: ${r.why}`);
        return new Int16Array(len * 2);
      }
      if (r.warn) console.warn(`WARN soundtrack ${s.e.id}: ${r.warn}`);
    } else console.log(`[${String(s.i + 1).padStart(2, '0')} ${s.e.id}] reusing ${path.basename(f)}`);
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
  const fIn = Math.round((endIn / FPS) * AUDIO_RATE * 0.6);
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
  const audioWav = path.join(work, 'soundtrack.wav');
  writeWav(audioWav, pcm);
  const lufs = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', audioWav, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(
    /I:\s+(-?[\d.]+|-inf) LUFS\s*\n\s*Threshold[\s\S]*$/,
  );
  console.log(
    `audio ready in ${((Date.now() - ta) / 1000).toFixed(0)} s: ${total} samples (${(total / AUDIO_RATE).toFixed(3)} s)${lufs ? `, integrated ${lufs[1]} LUFS` : ''}${failed.length === N ? ' (silent)' : ''}`,
  );
  return audioWav;
}

// the sound is made alongside the picture and its encode (the soundtrack
// calibrates an entry the first time it meets new sound code, which takes a
// while), and muxed in at the end without touching the picture
const audioP = audioStage();
await videoStage();

// ---------------------------------------------------------------------------
// join frame-exactly and encode once: the 4K file and the share copy in one pass
// ---------------------------------------------------------------------------
const list = path.join(work, 'parts.txt');
fs.writeFileSync(list, segs.map((s) => `file '${s.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
// exact timestamps (frame n at n/30 s), so frames pass through untouched; the
// upscale and the 2x downscale are both nearest-neighbour in RGB, then each
// output is converted to bt709 limited-range 4:2:0 once
const yuv = (w, h) => `scale=${w}:${h}:flags=neighbor:out_color_matrix=bt709:out_range=tv,format=yuv420p`;
let graph = `[0:v]settb=1/${FPS},setpts=N,scale=${outW}:${outH}:flags=neighbor`;
graph += share ? `,split=2[big][sm];[big]${yuv(outW, outH)}[v0];[sm]scale=${shareW}:${shareH}:flags=neighbor,${yuv(shareW, shareH)}[v1]` : `,${yuv(outW, outH)}[v0]`;
const color709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const crf = Number(a.crf ?? 16);
const preset = String(a.preset && a.preset !== true ? a.preset : 'medium');
const enc = ['-c:v', 'libx264', '-preset', preset, '-profile:v', 'high', '-tune', 'animation', '-crf', String(crf), '-g', String(FPS * 2), ...color709, '-fps_mode', 'passthrough'];
const outputs = [out, ...(share ? [outShare] : [])];
const silent = outputs.map((f, k) => path.join(work, `picture-${k}.mp4`));
const args = ['-f', 'concat', '-safe', '0', '-i', list, '-filter_complex', graph];
silent.forEach((f, k) => args.push('-map', `[v${k}]`, '-an', ...enc, '-frames:v', String(TOTAL), f));
const te = Date.now();
console.log(`encoding ${outputs.map((f) => path.basename(f)).join(' and ')} (x264 ${preset}, CRF ${crf})`);
const ffmpeg = async (args) => (await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { prefix: '[ffmpeg] ' })).code === 0;
if (!(await ffmpeg(args))) process.exit(1);
console.log(`encoded in ${((Date.now() - te) / 1000).toFixed(0)} s`);
const audioWav = await audioP;
for (let k = 0; k < outputs.length; k++) {
  fs.mkdirSync(path.dirname(outputs[k]), { recursive: true });
  const aenc = audioWav ? ['-i', audioWav, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-ar', String(AUDIO_RATE), '-ac', '2'] : ['-map', '0:v:0'];
  if (!(await ffmpeg(['-i', silent[k], ...aenc, '-c:v', 'copy', '-movflags', '+faststart', outputs[k]]))) process.exit(1);
  fs.rmSync(silent[k], { force: true });
}

// ---------------------------------------------------------------------------
// check the results
// ---------------------------------------------------------------------------
const problems = [];
for (const [f, W, H] of [[out, outW, outH], ...(share ? [[outShare, shareW, shareH]] : [])]) {
  const info = ffprobe(f);
  const v = info && info.streams.find((s) => s.codec_type === 'video');
  const au = info && info.streams.find((s) => s.codec_type === 'audio');
  if (!v) {
    problems.push(`${f}: no video stream`);
    continue;
  }
  const frames = countFrames(f);
  const name = path.basename(f);
  if (frames !== TOTAL) problems.push(`${name}: ${frames} frames, expected ${TOTAL}`);
  if (v.width !== W || v.height !== H) problems.push(`${name}: ${v.width}x${v.height}, expected ${W}x${H}`);
  if (v.profile !== 'High' || v.pix_fmt !== 'yuv420p' || v.color_space !== 'bt709') problems.push(`${name}: ${v.profile} ${v.pix_fmt} ${v.color_space}, expected High yuv420p bt709`);
  if (audioWav && (!au || Math.abs(+au.duration - TOTAL / FPS) > 0.03)) problems.push(`${name}: audio ${au ? au.duration + ' s' : 'missing'}, expected ${TOTAL / FPS} s`);
  const size = fs.statSync(f).size;
  console.log(
    `wrote ${f}: ${v.width}x${v.height} H.264 ${v.profile} ${v.pix_fmt} ${v.color_space}, ${frames} frames (${(+info.format.duration).toFixed(3)} s), ` +
      `${au ? `AAC ${Math.round(au.bit_rate / 1000)} kbps ${(+au.duration).toFixed(3)} s` : 'no audio'}, ${(size / 1e6).toFixed(2)} MB`,
  );
}
console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (problems.length) {
  for (const p of problems) console.error('FAIL ' + p);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// --probe: candidate moments per entry, read from the running page
// ---------------------------------------------------------------------------
async function probe(page) {
  const step = Number(a.step ?? 1);
  const seg = Number(a.per ?? PER_DEFAULT) / FPS;
  const only = a.entries && a.entries !== true ? String(a.entries).split(',') : null;
  const fmt = (w) => `${w[0].toFixed(1)}-${w[1].toFixed(1)}`;
  const json = [];
  for (const e of EDS) {
    if (only && !only.includes(e.id)) continue;
    const t = TABLE[e.id] || {};
    const p = PLACES[e.place] || {};
    const r = await page.evaluate(
      ([id, seg, wantActivity, step, cropX, CW]) => {
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
            best: best(seg),
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
          // 216 px crop and in the whole frame
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
      [e.id, seg, !!a.activity, step, t.x ?? 132, CW],
    );
    // report
    const start = t.start;
    const x = t.x;
    console.log(`\n${String(e.index + 1).padStart(2, '0')} ${e.id}  (${e.place}, ${e.light}${e.fireworks ? ', fireworks ' + e.fireworks : ''}; cast ${JSON.stringify(e.cast)})`);
    console.log(`   table: t ${start ?? '-'}..${start !== undefined ? (start + seg).toFixed(1) : '-'}   crop x ${x ?? '-'}..${x !== undefined ? x + CW : '-'}`);
    for (const [k, w] of Object.entries(r.beats)) console.log(`   ${k.padEnd(11)} ${w === 'all loop' ? 'all loop' : w.map((q) => fmt(q) + (q[2] ? ' ' + q[2] : '')).join(', ')}`);
    if (r.logo) {
      const b = r.logoBox;
      const where = b && x !== undefined ? ` at x ${b.x0}-${b.x1}, ${b.x0 >= x && b.x1 <= x + CW ? 'inside' : 'NOT inside'} the 216 px crop` : '';
      console.log(`   logo fw     ${fmt(r.logo)}${where}`);
    }
    if (r.fireworks) {
      const f = r.fireworks;
      console.log(`   fireworks   ${f.shells} shells, ${f.inCrop} burst inside the 216 px crop${f.story.length ? `; story shells burst at ${f.story.join(', ')}` : ''}`);
      console.log(`               busiest ${seg.toFixed(1)} s windows: ${f.best.map(([s, n]) => `${s}+ (${n} bursts)`).join(', ')}`);
    }
    // what the 216 px crop holds
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
