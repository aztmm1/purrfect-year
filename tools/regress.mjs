#!/usr/bin/env node
// Pixel-exact regression guard, per edition.
//   node tools/regress.mjs --save [--edition halloween]   record frame hashes in tools/regress-<id>.json
//   node tools/regress.mjs [--edition halloween]          compare against them
//   --edition a,b | all     several editions in one browser (with --save: record each;
//                           without: compare those that have a reference)
//   --out DIR               on a difference, write the current frame as DIR/<id>-t<T>.png
// Exit 0 identical, 1 changed, 2 no reference to compare with.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, openDiorama, parseArgs, pickEditions, readEditions, dataUrlToBuffer } from './lib.mjs';

const a = parseArgs();
const TIMES = [0, 3.3, 17.25, 46.3, 91.6, 132.4, 148.9, 199.95, 239.9];
const refFile = (id) => path.join(ROOT, 'tools', `regress-${id}.json`);
const { browser, page } = await openDiorama({});
const eds = pickEditions(a.edition && a.edition !== true ? a.edition : 'halloween', await readEditions(page));
const many = eds.length > 1;
let bad = 0;
let missing = 0;
let compared = 0;
const hashAt = (id, ts) =>
  page.evaluate(
    ([id, ts]) => {
      const HD = window.HD;
      HD.setEdition(id);
      const ctx = HD.buffers.main.getContext('2d');
      return ts.map((t) => {
        HD.renderAt(t);
        const D = ctx.getImageData(0, 0, HD.W, HD.H).data;
        let h = 2166136261 >>> 0;
        for (let i = 0; i < D.length; i++) h = Math.imul(h ^ D[i], 16777619) >>> 0;
        return h.toString(16);
      });
    },
    [id, ts],
  );
for (const ed of eds) {
  const file = refFile(ed.id);
  if (a.save) {
    const hashes = await hashAt(ed.id, TIMES);
    fs.writeFileSync(file, JSON.stringify({ edition: ed.id, times: TIMES, hashes }, null, 2) + '\n');
    console.log('saved', path.relative(ROOT, file));
    continue;
  }
  if (!fs.existsSync(file)) {
    missing++;
    if (!many) console.log(`no reference for ${ed.id}: record one with  node tools/regress.mjs --save --edition ${ed.id}`);
    continue;
  }
  const ref = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (ref.edition && ref.edition !== ed.id) console.log(`WARN ${path.basename(file)} records edition ${ref.edition}`);
  const hashes = await hashAt(ed.id, ref.times);
  compared++;
  let diff = 0;
  for (let i = 0; i < ref.times.length; i++) {
    const t = ref.times[i];
    const same = ref.hashes[i] === hashes[i];
    if (!same) diff++;
    console.log((same ? 'SAME ' : 'DIFF ') + `${ed.id} t=${t}`);
    if (!same && a.out && a.out !== true) {
      fs.mkdirSync(String(a.out), { recursive: true });
      const u = await page.evaluate((t) => (window.HD.renderAt(t), window.HD.png(2)), t);
      fs.writeFileSync(path.join(String(a.out), `${ed.id}-t${t}.png`), dataUrlToBuffer(u));
    }
  }
  bad += diff;
  console.log(diff ? `${ed.id}: ${diff} frame(s) changed` : `${ed.id} is pixel-identical to the reference`);
}
await browser.close();
if (a.save) process.exit(0);
if (many && missing) console.log(`${missing} edition(s) have no reference (record with --save)`);
if (!compared) process.exit(2);
process.exit(bad ? 1 : 0);
