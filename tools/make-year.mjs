#!/usr/bin/env node
// Purrfect Year: every entry (edition) back to back, each fading through
// black into the next, in calendar order (Lunar New Year ... New Year's Eve).
//   node tools/make-year.mjs [--minutes 3] [--scale 4] [--crf 18] [--out out/purrfect-year-3min.mp4]
//   node tools/make-year.mjs --whatsapp      35 s vertical montage, < 16 MB, for chats and Status
//   [--resume] reuses finished segments; [--crf N] overrides 18 (YouTube) / 23 (WhatsApp)
// Segments are rendered frame-exactly with tools/render-video.mjs and joined
// without re-encoding.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs } from './lib.mjs';

const a = parseArgs();
const ORDER = ['lunar', 'spring', 'summer', 'match', 'nyc', 'la', 'sandiego', 'dc', 'home', 'harvest', 'halloween', 'lights', 'winter', 'newyear'];
// the moment each segment starts at (seconds into that edition's loop): the
// goal cheer, the candles, the anniversary heart, the AZTMM logo firework...
const HIGHLIGHT = { lunar: 62, spring: 40, summer: 20, match: 146, nyc: 57, la: 47.5, sandiego: 30, dc: 94, home: 30, harvest: 60, halloween: 145, lights: 50, winter: 25, newyear: 115 };
// WhatsApp segments are only 2.5 s, so each starts right on its beat (goal at
// 150, candles blown at 98-100, heart at 60, the niece's wave in San Diego...)
const HIGHLIGHT_WA = { lunar: 135.6, spring: 40, summer: 20, match: 150.4, nyc: 61, la: 54.5, sandiego: 30.9, dc: 98.8, home: 30, harvest: 60, halloween: 145, lights: 50, winter: 25, newyear: 53.9 };
// left edge of the 154 px vertical crop per edition, so the family and the
// moment are inside it (the Summer Story mostly happens left of the house)
const CROP_WA = { lunar: 152, spring: 152, summer: 62, match: 152, nyc: 80, la: 112, sandiego: 140, dc: 66, home: 152, harvest: 152, halloween: 152, lights: 152, winter: 152, newyear: 152 };

const wa = !!a.whatsapp;
const minutes = Number(a.minutes ?? 3);
// whole frames per segment at 30 fps so every segment cuts cleanly
const seg = Math.floor((wa ? Number(a.segment ?? 2.5) : (minutes * 60) / ORDER.length) * 30) / 30;
const out = path.resolve(ROOT, a.out || (wa ? 'out/purrfect-year-whatsapp.mp4' : `out/purrfect-year-${minutes}min.mp4`));
const work = path.resolve(ROOT, 'out', wa ? 'year-wa-parts' : 'year-parts');
fs.mkdirSync(work, { recursive: true });

const parts = [];
for (const [i, ed] of ORDER.entries()) {
  const start = (wa ? HIGHLIGHT_WA : HIGHLIGHT)[ed];
  const crf = String(a.crf ?? (wa ? 23 : 18));
  // the name carries every parameter so --resume never reuses a stale segment
  const file = path.join(work, `${String(i + 1).padStart(2, '0')}-${ed}-s${start}${wa ? '-x' + CROP_WA[ed] : ''}-c${crf}.mp4`);
  const args = ['tools/render-video.mjs', '--edition', ed, '--seconds', String(seg), '--start', String(start), '--fade', wa ? '0.12' : '0.8', '--out', file];
  if (wa) args.push('--crop', `${CROP_WA[ed]},0,154,270`, '--scale', '7', '--pad', '1080x1920', '--crf', crf, '--preset', 'slow');
  else args.push('--scale', String(a.scale ?? 4), '--crf', crf, '--preset', a.preset || 'medium');
  if (!(a.resume && fs.existsSync(file))) {
    console.log(`[${i + 1}/${ORDER.length}] ${ed}: ${seg}s`);
    const r = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  parts.push(file);
}
const list = path.join(work, 'parts.txt');
fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n') + '\n');
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`wrote ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MiB)`);
