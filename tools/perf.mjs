#!/usr/bin/env node
// Per-pass frame-time profile (headless Chromium, software canvas — real
// browsers with a GPU are faster, so treat these as upper bounds).
//   node tools/perf.mjs [--edition ID | a,b | all] [--frames 300] [--only ...] [--skip ...]
// Prints each pass, each module's total (its passes summed; its lights are
// inside engine:lights+lightmap) and the frame total. With several editions
// they are profiled one after another in one browser, and a summary table
// follows: frame times and the three costliest modules per edition.
import { openDiorama, parseArgs, pickEditions, readEditions } from './lib.mjs';

const a = parseArgs();
const n = Number(a.frames ?? 300);
const { browser, page } = await openDiorama({ prof: 1, only: a.only, skip: a.skip }, { viewport: { width: 1920, height: 1080 } });
const all = await readEditions(page);
const current = await page.evaluate(() => window.HD.edition.id);
const eds = a.edition && a.edition !== true ? pickEditions(a.edition, all) : all.filter((e) => e.id === current);
const many = eds.length > 1;
const summary = [];
for (const ed of eds) {
  const r = await page.evaluate(
    ([id, n]) => {
      const HD = window.HD;
      HD.setEdition(id);
      for (let i = 0; i < 30; i++) HD.renderAt(i / 30);
      for (const k in HD.prof) delete HD.prof[k];
      const ts = [];
      for (let i = 0; i < n; i++) {
        const a0 = performance.now();
        HD.renderAt(11 + i * 0.7919);
        ts.push(performance.now() - a0);
      }
      ts.sort((p, q) => p - q);
      const rows = Object.entries(HD.prof).map(([k, v]) => [k, v.ms / v.n]);
      rows.sort((p, q) => q[1] - p[1]);
      return { rows, p50: ts[n >> 1], p95: ts[Math.floor(n * 0.95)], avg: ts.reduce((s, v) => s + v, 0) / n };
    },
    [ed.id, n],
  );
  const mods = {};
  for (const [k, ms] of r.rows) {
    const m = k.split(':')[0];
    mods[m] = (mods[m] || 0) + ms;
  }
  const modRows = Object.entries(mods).sort((p, q) => q[1] - p[1]);
  if (many) console.log(`\n== ${ed.id} (${ed.place}, ${ed.light})`);
  for (const [k, ms] of r.rows) console.log(ms.toFixed(3).padStart(8) + ' ms  ' + k);
  console.log('per module:');
  for (const [m, ms] of modRows) console.log(ms.toFixed(3).padStart(8) + ' ms  ' + m + (ms > 1 && !m.startsWith('engine') ? '   (over the ~1 ms budget)' : ''));
  console.log(`frame total (incl. 1080p present): avg ${r.avg.toFixed(2)} ms, p50 ${r.p50.toFixed(2)}, p95 ${r.p95.toFixed(2)}`);
  summary.push({ id: ed.id, ...r, top: modRows.filter(([m]) => !m.startsWith('engine')).slice(0, 3) });
}
if (many) {
  console.log('\nedition        avg     p50     p95   costliest modules');
  for (const s of summary)
    console.log(`${s.id.padEnd(12)} ${s.avg.toFixed(2).padStart(6)}  ${s.p50.toFixed(2).padStart(6)}  ${s.p95.toFixed(2).padStart(6)}   ${s.top.map(([m, ms]) => `${m} ${ms.toFixed(2)}`).join(', ')}`);
}
await browser.close();
