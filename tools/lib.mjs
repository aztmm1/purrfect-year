// Shared helpers for the CLI tools: launch headless Chromium on index.html,
// list the editions, run jobs in parallel, render the soundtrack, read and
// write WAV files.
import { createRequire } from 'node:module';
import { execSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Playwright from the repo (npm install) first, then a global install
 * (npm root -g), which is how this container provides it.
 */
export function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') throw e;
  }
  let groot = '';
  try {
    groot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {}
  try {
    if (groot) return req(path.join(groot, 'playwright'));
  } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') throw e;
  }
  throw new Error('Playwright not found: run `npm install` and `npx playwright install chromium` in the repo (or install playwright globally)');
}

/** Parse --key value / --flag CLI arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) out[k] = true;
    else {
      out[k] = nxt;
      i++;
    }
  }
  return out;
}

/**
 * Open the diorama in export mode. `query` is merged into the URL
 * (e.g. {only:'house,bg'}, {view:'light'}, {loop:240}).
 */
export async function openDiorama(query = {}, { html = 'index.html', viewport = { width: 960, height: 540 }, args = [] } = {}) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  // every tool accepts --edition <id> (see src/editions.js); 'all' and lists
  // are handled by the tools that loop over editions
  const cli = parseArgs();
  if (cli.edition && cli.edition !== true && !/^all$|,/.test(cli.edition) && query.edition === undefined) query = { ...query, edition: cli.edition };
  // --nightout 1 previews the night-out family group before its edition tags ship
  if (cli.nightout && query.nightout === undefined) query = { ...query, nightout: cli.nightout };
  // never touch the network (the page only links an optional web font)
  await page.route(/^https?:\/\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const q = new URLSearchParams({ export: '1', ...Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')) });
  const url = pathToFileURL(path.isAbsolute(html) ? html : path.join(ROOT, html)).href + '?' + q.toString();
  await page.goto(url);
  await page.waitForFunction(() => window.HD && window.HD.isReady === true, null, { timeout: 30000 });
  return { browser, page, errors };
}

/** the editions as the page defines them, in story order */
export async function readEditions(page) {
  return page.evaluate(() =>
    window.HD.EDITIONS.map((e, i) => ({
      index: i,
      id: e.id,
      name: e.name,
      festival: e.festival,
      when: e.when,
      year: e.year,
      place: e.place,
      light: e.light,
      fire: e.fire,
      fireworks: e.fireworks,
      weather: e.weather,
      cast: e.cast,
      tags: e.tags,
    })),
  );
}

/**
 * Resolve an --edition argument against the page's list: 'all' (or true) ->
 * every edition, 'a,b' -> those, 'a' -> [a]; unknown ids throw.
 */
export function pickEditions(arg, list, fallback = 'all') {
  const v = arg === undefined || arg === true ? fallback : String(arg);
  if (v === 'all') return list.slice();
  const ids = v.split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const id of ids) {
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error(`unknown edition '${id}' (known: ${list.map((x) => x.id).join(', ')})`);
    out.push(e);
  }
  return out;
}

export function parseCrop(s) {
  if (!s || s === true) return null;
  const [x, y, w, h] = String(s).split(',').map(Number);
  return { x, y, w, h };
}

export function dataUrlToBuffer(u) {
  return Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
}

/** short stable hash of strings / buffers / JSON values */
export function shortHash(...parts) {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(typeof p === 'string' || Buffer.isBuffer(p) ? p : JSON.stringify(p));
  return h.digest('hex').slice(0, 8);
}

/** the scripts index.html loads, in order (paths relative to the repo) */
export function loadedScripts() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
}

/** hash of the page's code: index.html and every script it loads */
export function artHash() {
  const parts = [fs.readFileSync(path.join(ROOT, 'index.html'))];
  for (const s of loadedScripts()) {
    const f = path.join(ROOT, s);
    parts.push(s, fs.existsSync(f) ? fs.readFileSync(f) : 'missing');
  }
  return shortHash(...parts);
}

/** run async fn over items with at most n in flight; results in input order */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

/** spawn a command, echoing its output lines with a prefix; resolves {code, out} */
export function run(cmd, args, { cwd = ROOT, prefix = '', quiet = false } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const pipe = (stream, dest) => {
      let buf = '';
      stream.on('data', (d) => {
        out += d;
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          if (!quiet) dest.write(prefix + buf.slice(0, i) + '\n');
          buf = buf.slice(i + 1);
        }
      });
      stream.on('end', () => {
        if (buf && !quiet) dest.write(prefix + buf + '\n');
      });
    };
    pipe(p.stdout, process.stdout);
    pipe(p.stderr, process.stderr);
    p.on('error', (e) => resolve({ code: -1, out: out + String(e) }));
    p.on('close', (code) => resolve({ code, out }));
  });
}

export function ffprobe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Soundtrack (tools/soundtrack.mjs, a shared contract):
//   node tools/soundtrack.mjs --edition ID --start S --seconds N --out FILE.wav [--rate 48000]
//   node tools/soundtrack.mjs --edition ID --loop --out FILE.wav
// 48 kHz 16-bit stereo, deterministic, loop time [S, S+N) of the 240 s loop.
// ---------------------------------------------------------------------------
export const SOUNDTRACK = path.join(ROOT, 'tools', 'soundtrack.mjs');
export const AUDIO_RATE = 48000;

/** hash of the soundtrack code (the script and tools/sound/), so cached audio is never stale */
export function soundtrackHash(script = SOUNDTRACK) {
  if (!fs.existsSync(script)) return 'none';
  const parts = [fs.readFileSync(script)];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else parts.push(f, fs.readFileSync(p));
    }
  };
  walk(path.join(path.dirname(script), 'sound'));
  return shortHash(...parts);
}

/**
 * Render one stretch of an edition's soundtrack to a WAV. Never throws:
 * resolves {ok: true, warn} or {ok: false, why} so callers can fall back to
 * silence.
 */
export async function renderSoundtrack({ edition, start = 0, seconds, loop = false, out, rate = AUDIO_RATE, script = SOUNDTRACK }) {
  if (!fs.existsSync(script)) return { ok: false, why: `${path.relative(ROOT, script) || script} not found` };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out.replace(/\.wav$/i, '') + '.part.wav';
  const args = [script, '--edition', edition, '--out', tmp, '--rate', String(rate)];
  if (loop) args.push('--loop');
  else args.push('--start', String(+start.toFixed(6)), '--seconds', String(+seconds.toFixed(6)));
  const r = await run('node', args, { quiet: true });
  if (r.code !== 0 || !fs.existsSync(tmp)) {
    let why = `exit ${r.code}: ${r.out.trim().split('\n').slice(-3).join(' | ')}`;
    if (/require is not defined in ES module scope|ERR_REQUIRE_ESM/.test(r.out))
      why += ' (package.json says "type": "module": CommonJS helpers must be named .cjs, or tools/sound/ needs a package.json with "type": "commonjs")';
    fs.rmSync(tmp, { force: true });
    return { ok: false, why };
  }
  const p = ffprobe(tmp);
  const a = p && p.streams && p.streams.find((s) => s.codec_type === 'audio');
  if (!a) {
    fs.rmSync(tmp, { force: true });
    return { ok: false, why: 'the output is not a readable audio file' };
  }
  fs.renameSync(tmp, out);
  const warn = [];
  if (+a.sample_rate !== rate) warn.push(`sample rate ${a.sample_rate} (asked for ${rate}; resampled)`);
  if (+a.channels !== 2) warn.push(`${a.channels} channel(s) (expected stereo)`);
  return { ok: true, warn: warn.join(', '), duration: +(a.duration || (p.format && p.format.duration) || 0) };
}

/** decode any audio file to interleaved stereo s16 at `rate` (Int16Array) */
export function readPcm(file, rate = AUDIO_RATE) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '2', '-ar', String(rate), '-'], {
    maxBuffer: 1 << 30,
  });
  if (r.status !== 0) throw new Error(`could not decode ${file}: ${r.stderr}`);
  const b = r.stdout;
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.byteLength & ~1)));
}

/** write interleaved s16 samples as a 16-bit PCM WAV */
export function writeWav(file, samples, rate = AUDIO_RATE, channels = 2) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

/** save a raw RGBA buffer as a PNG, nearest-neighbour scaled by k */
export function rgbaToPng(rgba, w, h, file, k = 1) {
  const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-', '-vf', `scale=${w * k}:${h * k}:flags=neighbor`, '-frames:v', '1', file], { input: buf });
  if (r.status !== 0) throw new Error(`could not write ${file}: ${r.stderr}`);
  return file;
}
