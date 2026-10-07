/*
 * Atmosphere (Purrfect Year v2): smoke, steam, mist and haze.
 *
 * This file holds the machinery; atmosphere-seasons.js holds the per-entry
 * recipes (which systems run, where, and in which colours). The recipe of
 * the current entry is built once per edition (HD.perEdition), so a live
 * switch only swaps recipes. Every system reads HD.edition / HD.place() at
 * draw time and is a pure function of t over HD.LOOP.
 *
 *   fx z 50  back haze: aerial haze, rain veil, marine haze, dusk banks.
 *            Drawn behind the scene: it only lands on pixels the scene layer
 *            left empty (sky and backdrop), so buildings, street and cats
 *            stay crisp while the far city recedes
 *   fx z 51  far heat shimmer (bg pixels only)
 *   fx z 52  low mist: ground mist, rain spray, sea mist (warm-lit near lamps)
 *   fx z 54  plumes: fire pit smoke, rooftop vent steam, manhole steam
 *   fx z 58  golden sun shafts and dust motes (additive), road shimmer
 *   fx z 62  near mist (foreground wisps)
 *   fx z 69  vignette (night and dusk only, a gentle tonal edge)
 *
 * fx is never relit, so every colour is picked per light mode by the recipe,
 * and smoke or mist near a placed light (fire pit, lamps) takes a warm-lit
 * variant chosen from the lightmap minus the daylight fill.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const T = HD.time;
  const W = HD.W;
  const H = HD.H;
  const TAU = Math.PI * 2;
  const hex = HD.color.hex;
  const css = HD.color.css;
  const sm = HD.smoothstep;
  const clamp = HD.clamp;

  // the top-left sky stays calm for a title
  const TITLE = (HD.layout && HD.layout.titleSafe) || { x0: 8, y0: 8, x1: 170, y1: 70 };
  const AMB = HD.AMBIENT || [0.34, 0.38, 0.52];

  // ---------------------------------------------------------------------
  // colour helpers
  // ---------------------------------------------------------------------
  /** opaque little-endian RGBA word for a hex colour */
  function rgba32(c) {
    const a = hex(c);
    return ((255 << 24) | (a[2] << 16) | (a[1] << 8) | a[0]) >>> 0;
  }
  /** a colour as it looks lit by a warm light of strength L (0..1) */
  function warmed(c, L, light) {
    const a = hex(c);
    const k = light || [1, 0.62, 0.3];
    return css(a[0] * (1 + (k[0] * L) / AMB[0]), a[1] * (1 + (k[1] * L) / AMB[1]), a[2] * (1 + (k[2] * L) / AMB[2]));
  }
  // light levels: unlit, faint, lit, bright (strength of the warm tint)
  const LIT = [0, 0.1, 0.2, 0.32];
  /** [unlit, faint, lit, bright] variants of a colour */
  const litSet = (c, levels, light) => (levels || LIT).map((L) => (L ? warmed(c, L, light) : c));

  // ---------------------------------------------------------------------
  // light sampling: placed lights only (the daylight fill is subtracted)
  // ---------------------------------------------------------------------
  let fillLum = 0;
  function frameLight() {
    const lt = HD.light ? HD.light() : null;
    const f = lt && lt.day > 0 ? lt.fill : null;
    fillLum = f ? 0.4 * f[0] + 0.45 * f[1] + 0.15 * f[2] : 0;
  }
  function level(x, y, boost) {
    let l = HD.lights.lum(x, y) - fillLum;
    if (boost) l *= boost;
    return l < 0.07 ? 0 : l < 0.2 ? 1 : l < 0.42 ? 2 : 3;
  }

  // ---------------------------------------------------------------------
  // the place skyline (building tops per column), re-read when it changes
  // ---------------------------------------------------------------------
  const skyCache = { place: null, src: undefined, arr: new Int16Array(W) };
  function skyline() {
    const pl = HD.place();
    if (skyCache.place !== pl || skyCache.src !== pl.skyline) {
      skyCache.place = pl;
      skyCache.src = pl.skyline;
      for (let x = 0; x < W; x++) skyCache.arr[x] = Math.min(999, HD.placeTop(x, pl));
    }
    return skyCache.arr;
  }

  // ---------------------------------------------------------------------
  // puff raster: plume puffs are written straight into a pixel buffer and
  // composited with one drawImage of the touched rectangle
  // ---------------------------------------------------------------------
  const SR = { cv: null, ctx: null, img: null, u32: null, x0: W, y0: H, x1: -1, y1: -1, clip: null };
  const c32Cache = new Map();
  function c32(c) {
    let v = c32Cache.get(c);
    if (v === undefined) {
      v = rgba32(c);
      c32Cache.set(c, v);
    }
    return v;
  }
  function srInit() {
    if (SR.cv) return;
    SR.cv = HD.canvas(W, H, true);
    SR.ctx = SR.cv.getContext('2d');
    SR.img = SR.ctx.createImageData(W, H);
    SR.u32 = new Uint32Array(SR.img.data.buffer);
  }
  /**
   * Dithered disc: a pixel is set where bayer < level, the level falling off
   * towards the rim by `soft`. (ox, oy) anchor the dither to the puff so the
   * pattern travels with it instead of crawling. SR.clip (an Int16Array of
   * per-column tops) hides pixels at or below the skyline.
   */
  function srDisc(cx, cy, rad, c, lv, soft, ox, oy) {
    if (lv <= 0 || rad <= 0) return;
    cx = Math.round(cx);
    cy = Math.round(cy);
    const sx = ox | 0;
    const sy = oy | 0;
    const sf = soft || 0;
    const col = c32(c);
    const u32 = SR.u32;
    const bayer = HD.bayer;
    const clip = SR.clip;
    const ir = Math.ceil(rad);
    const rr = rad * rad + rad * 0.6;
    const ya = Math.max(0, cy - ir);
    const yb = Math.min(H - 1, cy + ir);
    const xa = Math.max(0, cx - ir);
    const xb = Math.min(W - 1, cx + ir);
    if (ya > yb || xa > xb) return;
    let hit = false;
    for (let py = ya; py <= yb; py++) {
      const dy = py - cy;
      const row = py * W;
      for (let px = xa; px <= xb; px++) {
        if (clip && py >= clip[px]) continue;
        const dx = px - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > rr) continue;
        let l = lv;
        if (sf > 0) l *= 1 - sf * Math.sqrt(d2 / rr);
        if (bayer(px + sx, py + sy) < l) {
          u32[row + px] = col;
          hit = true;
        }
      }
    }
    if (!hit) return;
    if (xa < SR.x0) SR.x0 = xa;
    if (ya < SR.y0) SR.y0 = ya;
    if (xb > SR.x1) SR.x1 = xb;
    if (yb > SR.y1) SR.y1 = yb;
  }
  /** one pixel into the raster */
  function srPx(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (SR.clip && y >= SR.clip[x]) return;
    SR.u32[y * W + x] = c32(c);
    if (x < SR.x0) SR.x0 = x;
    if (y < SR.y0) SR.y0 = y;
    if (x > SR.x1) SR.x1 = x;
    if (y > SR.y1) SR.y1 = y;
  }
  // the touched rectangle goes through a small pooled canvas (drawing a
  // freshly written full-frame canvas would snapshot all of it)
  const flushPool = new Map();
  function flushCanvas(w, h) {
    const bw = (w + 31) & ~31;
    const bh = (h + 31) & ~31;
    const key = bw * 1024 + bh;
    let c = flushPool.get(key);
    if (!c) {
      const cv = HD.canvas(bw, bh, true);
      c = { cv, ctx: cv.getContext('2d') };
      flushPool.set(key, c);
    }
    return c;
  }
  function srFlush(g, alpha) {
    if (SR.x1 < SR.x0) return;
    const w = SR.x1 - SR.x0 + 1;
    const h = SR.y1 - SR.y0 + 1;
    const fc = flushCanvas(w, h);
    fc.ctx.putImageData(SR.img, -SR.x0, -SR.y0, SR.x0, SR.y0, w, h);
    const ga = g.ctx.globalAlpha;
    if (alpha !== undefined) g.ctx.globalAlpha = alpha;
    g.ctx.drawImage(fc.cv, 0, 0, w, h, SR.x0, SR.y0, w, h);
    g.ctx.globalAlpha = ga;
    for (let y = SR.y0; y <= SR.y1; y++) SR.u32.fill(0, y * W + SR.x0, y * W + SR.x1 + 1);
    SR.x0 = W;
    SR.y0 = H;
    SR.x1 = -1;
    SR.y1 = -1;
  }

  // ---------------------------------------------------------------------
  // plumes: stateless puff lives (loop-snapped), oldest drawn first so the
  // dense young smoke near the source sits in front
  // ---------------------------------------------------------------------
  function puffs(n, life, t, fn) {
    const nc = T.cyclesFor(life);
    const Pd = HD.LOOP / nc;
    const u0 = (t * nc) / HD.LOOP;
    const f0 = u0 - Math.floor(u0);
    const oldest = (Math.ceil(n * (1 - f0)) - 1 + n) % n;
    for (let k = 0; k < n; k++) {
      const i = (oldest - k + n) % n;
      const u = u0 + i / n;
      const fl = Math.floor(u);
      fn(i, u - fl, ((fl % nc) + nc) % nc, Pd);
    }
  }

  /** lv factor: 0 while a disc would reach into the title area, 1 once 8px clear */
  const keepTitle = (x, y, rad) => Math.max(sm(0, 8, y - rad - 1 - TITLE.y1), sm(0, 8, x - rad - 1 - TITLE.x1));
  /** lv factor: fade before the top edge of the frame */
  const keepTop = (x, y, rad) => sm(2, 12, y - rad);

  /**
   * One plume from emitter E = {x, y | roof, seed, k, w, size} in style S:
   *   life, n            puff life (s) and puffs in flight
   *   rise, riseR, riseP total rise (px), its random extra, ease-out power
   *   wind, driftP, gust drift (px/s, bends in as a^driftP), gust swing (px)
   *   curl, curlF, curlA sideways meander (px), turns per life, growth power
   *   rad0, radK, radP   radius at birth, growth, growth power
   *   lvK, fadeIn, fadeP density gain, fade-in fraction, fade-out power
   *   tones, toneAt      [{body, hi, lo}] lit sets by age, age thresholds
   *   hi, lo             {dx, dy, k, r, min} highlight / shadow discs
   *   clip               true: hidden at or below the skyline (rooftop vents)
   *   keep               extra lv factor (x, y, rad)
   */
  function plume(g, t, S, E) {
    const seed = E.seed | 0;
    const ek = E.k === undefined ? 1 : E.k;
    const lb = S.lb || 1;
    SR.clip = S.clip ? skyline() : null;
    const ey = E.roof ? skyline()[Math.round(E.x)] - (E.dy || 1) : E.y;
    if (!(ey > 0 && ey < H)) {
      SR.clip = null;
      return;
    }
    const soft = S.soft === undefined ? 0.9 : S.soft;
    puffs(S.n, S.life, t, (i, a, c, Pd) => {
      const r1 = HD.hash(seed, i, c, 1);
      const r2 = HD.hash(seed, i, c, 2);
      const r3 = HD.hash(seed, i, c, 3);
      const kx = (HD.hash(seed, i, c, 4) * 8) | 0;
      const ky = (HD.hash(seed, i, c, 5) * 8) | 0;
      const te = t - a * Pd; // emission time: puffs born in a gust keep its push
      const gust = (T.noise(te, S.gustP || 17, seed + 77) - 0.5) * S.gust;
      const pulse = S.pulse ? 1 - S.pulse * T.noise(te, S.pulseP || 7, seed + 31) : 1;
      const rise = (S.rise + S.riseR * r1) * (1 - Math.pow(1 - a, S.riseP || 1.6));
      const drift = (S.wind * Pd + gust) * Math.pow(a, S.driftP || 1.5);
      const curl = S.curl * Math.pow(a, S.curlA || 1) * Math.sin(TAU * (a * (S.curlF || 1.2) + r2 * (S.curlR === undefined ? 1 : S.curlR) + T.noise(te, S.curlP || 9, seed + 5) * 0.6));
      const x = E.x + (r3 - 0.5) * (E.w || 0) * (1 - a) + drift + curl;
      const y = ey - rise;
      const rad = (S.rad0 + S.radK * Math.pow(a, S.radP || 0.7) * (0.85 + 0.3 * r3)) * (E.size || 1);
      let lv = Math.min(1, a / (S.fadeIn || 0.04)) * Math.pow(1 - a, S.fadeP || 0.8) * ek * pulse;
      if (lv <= 0.02) return;
      lv *= keepTitle(x, y, rad) * keepTop(x, y, rad);
      if (S.keep) lv *= S.keep(x, y, rad);
      if (lv <= 0.02) return;
      const xi = Math.round(x);
      const yi = Math.round(y);
      const ox = kx - xi;
      const oy = ky - yi;
      const L = level(xi, yi + Math.round(rad * 0.5), lb);
      // tone by age (banded, jittered per puff)
      const aj = a + (r1 - 0.5) * (S.toneJ === undefined ? 0.12 : S.toneJ);
      const TA = S.toneAt;
      let ti = 0;
      while (ti < TA.length && aj >= TA[ti]) ti++;
      const tone = S.tones[ti];
      const lvk = lv * S.lvK;
      if (S.lo && rad >= (S.lo.min || 1.5)) srDisc(xi + Math.round(rad * S.lo.dx), yi + Math.round(rad * S.lo.dy), rad * (S.lo.r || 1), tone.lo[L], lvk * S.lo.k, soft, ox, oy);
      srDisc(xi, yi, rad, tone.body[L], lvk, soft, ox, oy);
      if (S.hi && rad >= (S.hi.min || 1.2)) {
        srDisc(xi + Math.round(rad * S.hi.dx), yi + Math.round(rad * S.hi.dy), rad * (S.hi.r || 0.55), tone.hi[L], lvk * S.hi.k, S.hi.soft || 0.95, ox, oy);
      }
    });
    SR.clip = null;
  }

  /** build a plume style's tones from colour triples [{body, hi, lo}] */
  function plumeTones(list, levels, light) {
    return list.map((tn) => ({
      body: litSet(tn.body, levels, light),
      hi: litSet(tn.hi || tn.body, levels, light),
      lo: litSet(tn.lo || tn.body, levels, light),
    }));
  }

  // ---------------------------------------------------------------------
  // field plumes: every puff splats a soft kernel into a density field
  // (plus its age), and the field is resolved into clean pixel shapes:
  // a threshold with a 1-2px dithered rim, tone bands by density, a lit
  // rim on the side facing the light and a shaded one away from it, older
  // smoke shifting towards the sky. Puffs merge like metaballs, so a plume
  // reads as one billowing body that erodes and breaks up as it thins.
  // ---------------------------------------------------------------------
  const FD = { F: new Float32Array(W * H), A: new Float32Array(W * H), L: new Float32Array(W * H), x0: W, y0: H, x1: -1, y1: -1 };
  /** add a soft kernel of radius R and weight w to the density field (dst = FD.L: the light field) */
  function splat(cx, cy, R, w, age, dst) {
    if (w <= 0 || R <= 0) return;
    const ir = Math.ceil(R);
    const xc = Math.round(cx);
    const yc = Math.round(cy);
    const fx = cx - xc;
    const fy = cy - yc;
    const ya = Math.max(0, yc - ir);
    const yb = Math.min(H - 1, yc + ir);
    const xa = Math.max(0, xc - ir);
    const xb = Math.min(W - 1, xc + ir);
    if (ya > yb || xa > xb) return;
    const inv = 1 / (R * R);
    const F = dst || FD.F;
    const A = FD.A;
    for (let y = ya; y <= yb; y++) {
      const dy = y - yc - fy;
      const row = y * W;
      for (let x = xa; x <= xb; x++) {
        const dx = x - xc - fx;
        const q = 1 - (dx * dx + dy * dy) * inv;
        if (q <= 0) continue;
        const k = q * q * w;
        F[row + x] += k;
        if (!dst) A[row + x] += k * age;
      }
    }
    if (xa < FD.x0) FD.x0 = xa;
    if (ya < FD.y0) FD.y0 = ya;
    if (xb > FD.x1) FD.x1 = xb;
    if (yb > FD.y1) FD.y1 = yb;
  }

  /** the puffs of one emitter, as (x, y, radius, weight, age) splats */
  function plumeSplats(t, S, E) {
    const seed = E.seed | 0;
    const ek = E.k === undefined ? 1 : E.k;
    const ey = E.roof ? skyline()[Math.round(E.x)] - (E.dy || 1) : E.y;
    if (!(ey > 0 && ey < H)) return;
    const sz = E.size || 1;
    puffs(S.n, S.life, t, (i, a, c, Pd) => {
      const r1 = HD.hash(seed, i, c, 1);
      const r2 = HD.hash(seed, i, c, 2);
      const r3 = HD.hash(seed, i, c, 3);
      const te = t - a * Pd; // emission time: puffs born in a gust keep its push
      const gust = (T.noise(te, S.gustP || 17, seed + 77) - 0.5) * S.gust;
      const pulse = S.pulse ? 1 - S.pulse * T.noise(te, S.pulseP || 7, seed + 31) : 1;
      const rise = (S.rise + S.riseR * r1) * sz * (1 - Math.pow(1 - a, S.riseP || 1.6));
      const drift = (S.wind * Pd + gust) * Math.pow(a, S.driftP || 1.5);
      const curl = S.curl * sz * Math.pow(a, S.curlA || 1) * Math.sin(TAU * (a * (S.curlF || 1.2) + r2 * (S.curlR === undefined ? 1 : S.curlR) + T.noise(te, S.curlP || 9, seed + 5) * 0.6));
      const r4 = HD.hash(seed, i, c, 4);
      const r5 = HD.hash(seed, i, c, 5);
      const jit = (S.jit || 0) * Math.sqrt(a) * sz;
      const x = E.x + (r3 - 0.5) * (E.w || 0) * (1 - a) + drift + curl + (r5 - 0.5) * jit;
      const y = ey - rise + (r4 - 0.5) * jit * 0.6;
      const rj = S.radJ === undefined ? 0.4 : S.radJ;
      const R = (S.rad0 + S.radK * Math.pow(a, S.radP || 0.7)) * (1 - rj / 2 + rj * r4) * sz;
      let w = Math.min(1, a / (S.fadeIn || 0.04)) * Math.pow(1 - a, S.fadeP || 0.8) * ek * pulse * (S.wK || 1) * (0.85 + 0.3 * r2);
      if (w <= 0.01) return;
      w *= keepTitle(x, y, R * 0.5) * keepTop(x, y, R * 0.5);
      if (S.keep) w *= S.keep(x, y, R);
      if (w <= 0.01) return;
      splat(x, y, R, w, a);
      // each puff's light-facing cap (a smaller kernel shifted to the light)
      if (S.cap) splat(x + S.cap.dx * R, y + S.cap.dy * R, R * S.cap.r, w, a, FD.L);
    });
  }

  /**
   * Resolve the field into the raster. Style fields:
   *   th          density threshold of the solid shape (1 = one puff centre)
   *   rim         dithered rim below th, as a fraction of th
   *   bands       density multiples of th that step the tone up (e.g. [1.7, 3])
   *   ages        mean-age thresholds that step the tone down (older = fainter)
   *   lx, ly      offset towards the light (px): the facing rim is lit
   *   rimK        rim test: F(p + light) < F(p) * rimK (shadeRim: also
   *               shade the far rim)
   *   cap         {dx, dy, r, hi, lo}: each puff also splats a smaller kernel
   *               shifted towards the light; where that cap field is above
   *               hi x the density the tone steps up, below lo it steps down,
   *               so every lobe gets its own lit top and shaded underside
   *   ramp        lit sets, dark -> light (index 0 is the faintest rim tone)
   *   lb          light boost for the warm-lit variants
   *   litAt       optional (x, y) -> light level that also sets S.rampNow
   *               (a ramp lit in that light's colour), instead of the lightmap
   */
  function resolveField(S) {
    if (FD.x1 < FD.x0) return;
    const F = FD.F;
    const A = FD.A;
    const LF = FD.L;
    const cap = S.cap;
    const x0 = FD.x0;
    const y0 = FD.y0;
    const x1 = FD.x1;
    const y1 = FD.y1;
    const th = S.th;
    const rimLo = th * (1 - (S.rim === undefined ? 0.35 : S.rim));
    const bands = S.bands;
    const ages = S.ages;
    const lx = S.lx | 0;
    const ly = S.ly | 0;
    const rimK = S.rimK || 0.72;
    const ramp = S.ramp;
    const rw = words(ramp);
    const top = ramp.length - 1;
    const bayer = HD.bayer;
    const u32 = SR.u32;
    const clip = SR.clip;
    const lb = S.lb || 1;
    // optional custom light: litAt(x, y) -> level, choosing S.rampNow
    const litAt = S.litAt || null;
    let lx4 = -9;
    let ly4 = -9;
    let lL = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * W;
      for (let x = x0; x <= x1; x++) {
        const p = row + x;
        const f = F[p];
        if (f <= rimLo) continue;
        if (clip && y >= clip[x]) continue;
        let idx;
        if (f < th) {
          // dithered rim, the faintest tone
          if (bayer(x, y) >= (f - rimLo) / (th - rimLo)) continue;
          idx = 0;
        } else {
          idx = 1;
          for (let k = 0; k < bands.length; k++) if (f >= th * bands[k]) idx++;
          const ag = A[p] / f;
          for (let k = 0; k < ages.length; k++) if (ag >= ages[k]) idx--;
          if (cap) {
            const cr = LF[p] / f;
            if (cr > cap.hi) idx++;
            else if (cr < cap.lo) idx--;
          }
          // lit rim towards the light, shade on the far side
          const xl = x + lx;
          const yl = y + ly;
          const fl = xl >= 0 && xl < W && yl >= 0 && yl < H ? F[yl * W + xl] : 0;
          if (fl < f * rimK) idx++;
          else if (S.shadeRim) {
            const xs = x - lx;
            const ys = y - ly;
            const fs = xs >= 0 && xs < W && ys >= 0 && ys < H ? F[ys * W + xs] : 0;
            if (fs < f * rimK) idx--;
          }
          if (idx < 1) idx = 1;
          if (idx > top) idx = top;
        }
        if (litAt) {
          const L = litAt(x, y);
          u32[p] = words(S.rampNow)[idx][L];
        } else {
          // the lightmap is banded: sample it on a 4px grid
          if ((x & ~3) !== lx4 || (y & ~3) !== ly4) {
            lx4 = x & ~3;
            ly4 = y & ~3;
            lL = level(lx4 + 2, ly4 + 2, lb);
          }
          u32[p] = rw[idx][lL];
        }
        if (x < SR.x0) SR.x0 = x;
        if (y < SR.y0) SR.y0 = y;
        if (x > SR.x1) SR.x1 = x;
        if (y > SR.y1) SR.y1 = y;
      }
      F.fill(0, row + x0, row + x1 + 1);
      A.fill(0, row + x0, row + x1 + 1);
      if (cap) LF.fill(0, row + x0, row + x1 + 1);
    }
    FD.x0 = W;
    FD.y0 = H;
    FD.x1 = -1;
    FD.y1 = -1;
  }

  /** a ramp of lit colour sets as RGBA words (cached per ramp) */
  const wordCache = new WeakMap();
  function words(ramp) {
    let w = wordCache.get(ramp);
    if (!w) {
      w = ramp.map((set) => set.map(c32));
      wordCache.set(ramp, w);
    }
    return w;
  }

  /** draw a field plume (each emitter resolved on its own, one composite) */
  function fieldPlume(g, t, S, emitters, alpha) {
    SR.clip = S.clip ? skyline() : null;
    for (const E of emitters) {
      plumeSplats(t, S, E);
      resolveField(S);
    }
    SR.clip = null;
    srFlush(g, alpha);
  }

  // ---------------------------------------------------------------------
  // tileable textures (mist bands), scrolled whole tile widths per loop
  // ---------------------------------------------------------------------
  /** periodic 1D noise over a tile: sum of integer-frequency sines (0..1) */
  function pnoise(tw, seed, terms) {
    const rng = HD.rng(seed);
    const comps = [];
    let norm = 0;
    for (const [f, amp] of terms) {
      comps.push([f, amp, rng()]);
      norm += amp;
    }
    const out = new Float32Array(tw);
    for (let x = 0; x < tw; x++) {
      let s = 0;
      for (const [f, amp, ph] of comps) s += amp * Math.sin(TAU * ((f * x) / tw + ph));
      out[x] = 0.5 + (0.5 * s) / norm;
    }
    return out;
  }

  /** bake a w x h canvas from a Uint32 pixel callback */
  function bakePixels(w, h, fill) {
    const c = HD.canvas(w, h, true);
    const cx = c.getContext('2d');
    const im = cx.createImageData(w, h);
    fill(new Uint32Array(im.data.buffer), im);
    cx.putImageData(im, 0, 0);
    return c;
  }

  /**
   * Bake one texture per light level (or a single unlit one).
   * dot screen (tonal false): colour cols[1] where bayer < (d - core) * 1.6,
   *   cols[0] where bayer < d.
   * tonal: every pixel takes the colour at an opacity of d in flat 1/16
   *   steps, dithered only between neighbouring steps (a soft veil); cols[1]
   *   past the core density.
   */
  function bakeTile(tw, h, dens, cols, lit, core, levels, tonal, light) {
    const sets = cols.map((c) => (lit ? litSet(c, levels, light) : [c]).map(rgba32));
    const nv = lit ? (levels || LIT).length : 1;
    const D = new Float32Array(tw * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < tw; x++) D[y * tw + x] = dens(x, y);
    const out = [];
    for (let v = 0; v < nv; v++) {
      const c0 = sets[0][v];
      const c1 = sets[1] ? sets[1][v] : c0;
      if (tonal) {
        out.push(
          bakePixels(tw, h, (u32) => {
            for (let y = 0; y < h; y++)
              for (let x = 0; x < tw; x++) {
                const p = y * tw + x;
                const d = Math.min(1, D[p]);
                if (d <= 0) continue;
                const b = HD.bayer(x, y);
                const f = d * 16;
                const lo = Math.floor(f);
                const lvl = lo + (b < f - lo ? 1 : 0);
                if (lvl <= 0) continue;
                const c = d > core + (b - 0.5) * 0.16 ? c1 : c0;
                u32[p] = ((c & 0xffffff) | (Math.round((255 * lvl) / 16) << 24)) >>> 0;
              }
          }),
        );
        continue;
      }
      out.push(
        bakePixels(tw, h, (u32) => {
          for (let y = 0; y < h; y++)
            for (let x = 0; x < tw; x++) {
              const p = y * tw + x;
              const d = D[p];
              if (d <= 0) continue;
              const b = HD.bayer(x, y);
              if (b < (d - core) * 1.6) u32[p] = c1;
              else if (b < d) u32[p] = c0;
            }
        }),
      );
    }
    return out;
  }

  /**
   * screen-space keep-out mask (opaque = erase), soft dithered rims. Holes
   * are ellipses {x, y, rx, ry, k} or boxes {box: [x0, y0, x1, y1], f}.
   */
  function bakeMask(y0, h, holes, mx0, mw) {
    const WHITE = 0xffffffff;
    const X0 = mx0 || 0;
    const MW = mw || W;
    return bakePixels(MW, h, (u32) => {
      for (let y = 0; y < h; y++)
        for (let x = X0; x < X0 + MW; x++) {
          let k = 0;
          for (const o of holes) {
            if (o.box) {
              const b = o.box;
              const dx = Math.max(b[0] - x, x - b[2], 0);
              const dy = Math.max(b[1] - (y + y0), y + y0 - b[3], 0);
              k = Math.max(k, (o.k || 1) * (1 - sm(0, (o.f || 2) + 1, Math.hypot(dx, dy))));
              continue;
            }
            const qx = (x - o.x) / o.rx;
            const qy = (y + y0 - o.y) / o.ry;
            k = Math.max(k, (o.k || 1) * (1 - sm(0.75, 1.35, Math.sqrt(qx * qx + qy * qy))));
          }
          if (k > 0 && HD.bayer(x, y) < k) u32[y * MW + x - X0] = WHITE;
        }
    });
  }

  /** scroll offset of a band at t (B.k whole tile widths per loop) */
  function bandOff(B, t) {
    const tw = B.tw;
    return ((Math.floor((t * B.k * tw) / HD.LOOP + B.sub) % tw) + tw) % tw;
  }

  function bandScratch(B) {
    if (!B.scr) {
      const cv = HD.canvas(B.w, B.h, true);
      const ctx = cv.getContext('2d');
      B.scr = { cv, ctx, g: HD.makeGfx(ctx), off: -1 };
    }
    return B.scr;
  }

  /** tile the band across columns [B.x0, B.x0 + B.w) at y = dy, picking lit variants per 8px chunk */
  function tileBand(dst, B, off, dy, sx) {
    const tw = B.tw;
    const lit = B.tex.length > 1;
    const CW = 8;
    const xa = B.x0;
    const xe = xa + B.w;
    let x = xa;
    let lv = lit ? level(x + 4, B.ly, B.lb) : 0;
    while (x < xe) {
      let x1 = x + CW;
      let nl = lv;
      while (x1 < xe) {
        nl = lit ? level(x1 + 4, B.ly, B.lb) : 0;
        if (nl !== lv) break;
        x1 += CW;
      }
      if (x1 > xe) x1 = xe;
      const img = B.tex[lv];
      let s = (((x - off) % tw) + tw) % tw;
      let w = x1 - x;
      let dx = x - sx;
      while (w > 0) {
        const part = Math.min(w, tw - s);
        dst.blit(img, s, 0, part, B.h, dx, dy);
        dx += part;
        w -= part;
        s = 0;
      }
      x = x1;
      lv = nl;
    }
  }

  /** the band with its keep-out mask applied, in its scratch canvas (cached while unlit and still) */
  function maskedBand(B, t) {
    const off = bandOff(B, t);
    const S = bandScratch(B);
    const unlit = B.tex.length === 1;
    if (unlit && S.off === off) return S.cv;
    S.ctx.clearRect(0, 0, B.w, B.h);
    tileBand(S.g, B, off, 0, B.x0);
    S.ctx.globalCompositeOperation = 'destination-out';
    S.ctx.drawImage(B.mask, 0, 0);
    S.ctx.globalCompositeOperation = 'source-over';
    S.off = unlit ? off : -1;
    return S.cv;
  }

  function drawBand(g, B, t) {
    const ga = g.ctx.globalAlpha;
    g.ctx.globalAlpha = B.alpha === undefined ? 1 : B.alpha;
    if (B.mask) g.blit(maskedBand(B, t), 0, 0, B.w, B.h, B.x0, B.y0);
    else tileBand(g, B, bandOff(B, t), B.y0, 0);
    g.ctx.globalAlpha = ga;
  }

  /**
   * Band builder: {tw, y0, h, dens(x, y), cols, alpha, lit, tonal, core,
   * levels, light, holes, x0, w, k, sub, ly, lb}
   */
  function band(o) {
    return {
      x0: o.x0 || 0,
      w: o.w || W,
      tw: o.tw,
      sub: o.sub === undefined ? 0.5 : o.sub,
      y0: o.y0,
      h: o.h,
      k: o.k === undefined ? 1 : o.k,
      ly: o.ly === undefined ? o.y0 + (o.h >> 1) : o.ly,
      lb: o.lb,
      tex: bakeTile(o.tw, o.h, o.dens, o.cols, !!o.lit, o.core === undefined ? 0.45 : o.core, o.levels, !!o.tonal, o.light),
      alpha: o.alpha,
      mask: o.holes && o.holes.length ? bakeMask(o.y0, o.h, o.holes, o.x0 || 0, o.w || W) : null,
    };
  }

  // ---------------------------------------------------------------------
  // behind the scene: composite onto the pixels the scene layer left empty
  // (sky, backdrop), so haze sits between the far city and the block
  // ---------------------------------------------------------------------
  const BK = { cv: null, ctx: null, g: null };
  function backScratch() {
    if (!BK.cv) {
      BK.cv = HD.canvas(W, H, true);
      BK.ctx = BK.cv.getContext('2d');
      BK.g = HD.makeGfx(BK.ctx);
    }
    return BK;
  }
  /**
   * Where the sky and the far city can show between rows y0 and y1: column
   * strips of the place skyline, each from y0 down to its lowest open row
   * (never below the street line). Cached per place skyline and band.
   */
  const rectCache = new Map();
  const STRIP = 24;
  function skyRects(y0, y1) {
    const sk = skyline();
    const key = y0 + '|' + y1;
    let e = rectCache.get(key);
    if (e && e.src === skyCache.src && e.place === skyCache.place) return e.rects;
    const rects = [];
    for (let x = 0; x < W; x += STRIP) {
      const w = Math.min(STRIP, W - x);
      let lo = 0;
      for (let k = x; k < x + w; k++) lo = Math.max(lo, Math.min(sk[k], 206, y1));
      if (lo <= y0) continue;
      const last = rects[rects.length - 1];
      // merge with the previous strip when it covers the same rows
      if (last && last[0] + last[2] === x && last[3] === lo) last[2] += w;
      else rects.push([x, y0, w, lo]);
    }
    rectCache.set(key, { src: skyCache.src, place: skyCache.place, rects });
    return rects;
  }

  /**
   * draw(gb) paints into the scratch (screen coordinates, clipped to the
   * open-sky rectangles); the scene's opaque pixels are then cut out and the
   * rest composited onto the frame with `alpha` and `op`.
   */
  function behind(g, y0, y1, draw, alpha, op) {
    const B = backScratch();
    const rects = skyRects(Math.max(0, y0), Math.min(H, y1));
    if (!rects.length) return;
    const c = B.ctx;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.save();
    c.beginPath();
    for (const r of rects) {
      c.clearRect(r[0], r[1], r[2], r[3] - r[1]);
      c.rect(r[0], r[1], r[2], r[3] - r[1]);
    }
    c.clip();
    B.g.reset();
    draw(B.g);
    c.restore();
    B.g.reset();
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'destination-out';
    const sc = HD.buffers.scene;
    for (const r of rects) c.drawImage(sc, r[0], r[1], r[2], r[3] - r[1], r[0], r[1], r[2], r[3] - r[1]);
    c.globalCompositeOperation = 'source-over';
    const ctx = g.ctx;
    const ga = ctx.globalAlpha;
    const go = ctx.globalCompositeOperation;
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    if (op) ctx.globalCompositeOperation = op;
    for (const r of rects) ctx.drawImage(B.cv, r[0], r[1], r[2], r[3] - r[1], r[0], r[1], r[2], r[3] - r[1]);
    ctx.globalAlpha = ga;
    ctx.globalCompositeOperation = go;
  }

  /**
   * Static tonal veil: alpha(x, y) in 1/16 steps (dithered between
   * neighbouring steps), colour col(x, y, a, bayer) -> rgba32 word.
   */
  function bakeVeil(x0, y0, w, h, alphaFn, colFn) {
    const cv = bakePixels(w, h, (u32) => {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const a = Math.min(1, alphaFn(x + x0, y + y0));
          if (!(a > 0.004)) continue;
          const b = HD.bayer(x + x0, y + y0);
          const f = a * 16;
          const lo = Math.floor(f);
          const lvl = lo + (b < f - lo ? 1 : 0);
          if (lvl <= 0) continue;
          const c = colFn(x + x0, y + y0, a, b);
          u32[y * w + x] = ((c & 0xffffff) | (Math.round((255 * lvl) / 16) << 24)) >>> 0;
        }
    });
    return { cv, x0, y0, w, h };
  }

  // ---------------------------------------------------------------------
  // golden sun shafts: rays fanning from the low sun, shadowed by the
  // buildings (2D occlusion against the skyline), baked per entry as two
  // ray sets that breathe in turn
  // ---------------------------------------------------------------------
  function bakeShafts(o) {
    const sun = o.sun;
    const sk = skyline();
    const base = o.ground || 206;
    const rng = HD.rng(o.seed || 7);
    const sets = [];
    for (let s = 0; s < 2; s++) {
      const rays = [];
      for (let k = 0; k < o.rays; k++) {
        const ang = o.a0 + (o.a1 - o.a0) * ((k + 0.2 + 0.6 * rng()) / o.rays);
        rays.push({ ang, w: o.w * (0.55 + 0.9 * rng()), a: 0.55 + 0.45 * rng() });
      }
      sets.push(rays);
    }
    const occl = (px, py) => {
      // march towards the sun; blocked inside a building (below the
      // skyline, above the street)
      const dx = sun.x - px;
      const dy = sun.y - py;
      const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 1.5);
      for (let i = 1; i < n; i++) {
        const x = Math.round(px + (dx * i) / n);
        const y = py + (dy * i) / n;
        if (x < 0 || x >= W) continue;
        if (y >= sk[x] && y < base) return 0;
      }
      return 1;
    };
    // visibility on a 2px grid, interpolated, so shadow edges band softly
    const yA = o.y0;
    const yB = o.y1;
    const vis = new Float32Array(W * H);
    for (let y = yA; y < yB; y += 2) for (let x = 0; x < W; x += 2) vis[y * W + x] = occl(x, y);
    for (let y = yA; y < yB; y++)
      for (let x = 0; x < W; x++) {
        if (!(y & 1) && !(x & 1)) continue;
        const x0 = x & ~1;
        const y0 = y & ~1;
        const x1 = Math.min(W - 2, x0 + 2);
        const y1 = Math.min(yB - 2, y0 + 2);
        vis[y * W + x] = 0.25 * (vis[y0 * W + x0] + vis[y0 * W + x1] + vis[y1 * W + x0] + vis[y1 * W + x1]);
      }
    const col = rgba32(o.col);
    const alphaAt = (rays) => (x, y) => {
      const v = vis[y * W + x];
      if (v <= 0) return 0;
      const dx = x - sun.x;
      const dy = y - sun.y;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      let r = 0;
      for (const ray of rays) {
        let da = ang - ray.ang;
        da -= TAU * Math.round(da / TAU);
        const q = da / ray.w;
        r += ray.a * Math.exp(-q * q);
      }
      r = Math.min(1, r);
      const fall = sm(o.near, o.near * 2.5, d) * Math.exp(-d / o.far);
      // stay out of the title area, and off the street (the rays hang in
      // the air; the ground's light and shadow belong to the street)
      const tf = 1 - (1 - sm(TITLE.x1, TITLE.x1 + 50, x)) * (1 - sm(TITLE.y1, TITLE.y1 + 40, y));
      const gf = 1 - sm(base - 14, base + 6, y);
      return o.alpha * v * r * fall * tf * gf;
    };
    const fns = sets.map(alphaAt);
    const layers = fns.map((fn) => bakeVeil(0, yA, W, yB - yA, fn, () => col));
    // shaft strength at a pixel (for the dust motes), on the first ray set
    const lit = (x, y) => (y >= yA && y < yB ? Math.max(fns[0](x, y), fns[1](x, y)) : 0);
    return { layers, lit };
  }

  /** dust motes drifting in the shafts: sparse warm specks, only where the air is lit */
  function drawMotes(g, t, M, shaftAlpha) {
    for (let i = 0; i < M.n; i++) {
      const c = T.cycle(t, i, M.life, M.seed);
      const a = c.age;
      const x0 = M.x0 + c.rnd(1) * (M.x1 - M.x0);
      const y0 = M.y0 + c.rnd(2) * (M.y1 - M.y0);
      const ph1 = c.rnd(3);
      const ph2 = c.rnd(4);
      const ph3 = c.rnd(5);
      const x = Math.round(x0 + M.drift * a * c.P + 3 * Math.sin(TAU * (a * 1.3 + ph1)));
      const y = Math.round(y0 - M.rise * a * c.P + 2 * Math.sin(TAU * (a * 2.1 + ph2)));
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const lit = shaftAlpha(x, y);
      if (lit < M.min) continue;
      const tw = Math.sin(Math.PI * a) * (0.6 + 0.4 * Math.sin(TAU * (a * 5 + ph3)));
      if (tw < 0.35) continue;
      g.px(x, y, tw > 0.75 && lit > M.min * 2 ? M.cols[1] : M.cols[0]);
    }
  }

  // ---------------------------------------------------------------------
  // heat shimmer: short row segments shift by a pixel in slow rising
  // ripples, inside patches of hot air that drift upwards (a baked tileable
  // patch texture scrolled a whole tile per period). onlyBack limits it to
  // the pixels the scene left empty (the far city).
  //   {y0, y1, period, waves, freq, seg, amp, env(y), keep(x, y), onlyBack,
  //    rise (s per texture tile), seed, lo, hi}
  // ---------------------------------------------------------------------
  const PH = 64;
  function shimmerTex(S) {
    if (S._tex) return S._tex;
    const PW = Math.ceil(W / S.seg);
    const rng = HD.rng(S.seed || 5);
    const comps = [];
    for (let k = 0; k < 7; k++) comps.push([1 + Math.floor(rng() * 9), 1 + Math.floor(rng() * 4), rng(), 0.5 + rng()]);
    const h = S.y1 - S.y0;
    const tex = new Float32Array(PH * PW);
    for (let y = 0; y < PH; y++)
      for (let i = 0; i < PW; i++) {
        let v = 0;
        let n = 0;
        for (const [fx, fy, ph, a] of comps) {
          v += a * Math.sin(TAU * ((fx * i) / PW + (fy * y) / PH + ph));
          n += a;
        }
        tex[y * PW + i] = sm(S.lo || 0.5, S.hi || 0.82, 0.5 + (0.5 * v) / n);
      }
    // static per-row envelope and keep-out, per segment
    const keep = new Float32Array(h * PW);
    for (let y = 0; y < h; y++)
      for (let i = 0; i < PW; i++) keep[y * PW + i] = S.env(y + S.y0) * (S.keep ? S.keep(i * S.seg + (S.seg >> 1), y + S.y0) : 1);
    S._tex = { tex, keep, PW };
    return S._tex;
  }
  function shimmer(g, t, S) {
    const { tex, keep, PW } = shimmerTex(S);
    const ph = T.phase(t, S.period);
    const scroll = Math.floor(T.phase(t, S.rise || 20) * PH);
    // behind the scene: only the open-sky rectangles; otherwise the band
    const rects = S.onlyBack ? skyRects(S.y0, S.y1) : [[0, S.y0, W, S.y1]];
    for (const r of rects) shimmerRect(g, S, r, tex, keep, PW, ph, scroll);
  }
  function shimmerRect(g, S, r, tex, keep, PW, ph, scroll) {
    const seg = S.seg;
    // whole segments only, so the patch grid matches the full band
    const xa0 = Math.floor(r[0] / seg) * seg;
    const xb0 = Math.min(W, Math.ceil((r[0] + r[2]) / seg) * seg);
    const ry0 = r[1];
    const w = xb0 - xa0;
    const h = r[3] - ry0;
    if (w <= 0 || h <= 0) return;
    const ctx = g.ctx;
    const img = ctx.getImageData(xa0, ry0, w, h);
    const d32 = new Uint32Array(img.data.buffer);
    const src = d32.slice();
    const sa = S.onlyBack ? HD.buffers.scene.getContext('2d').getImageData(xa0, ry0, w, h).data : null;
    let changed = false;
    for (let y = 0; y < h; y++) {
      const yy = y + ry0;
      const rip = S.amp * Math.sin(TAU * (ph * S.waves + yy * S.freq));
      if (Math.abs(rip) < 0.5) continue;
      const trow = ((yy - S.y0 + scroll) % PH) * PW;
      const krow = (yy - S.y0) * PW;
      for (let i = xa0 / seg; i < xb0 / seg; i++) {
        const e = keep[krow + i];
        if (e <= 0) continue;
        const off = Math.round(rip * e * tex[trow + i]);
        if (!off) continue;
        const xa = i * seg - xa0;
        const xe = Math.min(w, xa + seg);
        for (let xx = xa; xx < xe; xx++) {
          const p = y * w + xx;
          const sx = clamp(xx + off, 0, w - 1);
          if (sa && (sa[p * 4 + 3] !== 0 || sa[(y * w + sx) * 4 + 3] !== 0)) continue;
          d32[p] = src[y * w + sx];
        }
        changed = true;
      }
    }
    if (changed) ctx.putImageData(img, xa0, ry0);
  }

  // ---------------------------------------------------------------------
  // vignette: a gentle tonal darkening at the edges (night and dusk)
  // ---------------------------------------------------------------------
  function bakeVignette(col, strength) {
    const k = rgba32(col);
    return bakeVeil(
      0,
      0,
      W,
      H,
      (x, y) => {
        const nx = (x + 0.5 - W / 2) / (W / 2);
        const ny = (y + 0.5 - H / 2) / (H / 2);
        const ax = Math.abs(nx);
        const ay = Math.abs(ny);
        const v = Math.pow(Math.pow(ax, 4) + Math.pow(ay, 4), 0.25) * 0.55 + Math.sqrt(nx * nx + ny * ny) * 0.45;
        return strength * sm(0.82, 1.42, v);
      },
      () => k,
    );
  }

  // ---------------------------------------------------------------------
  // the recipe of the current entry (atmosphere-seasons.js builds it)
  // ---------------------------------------------------------------------
  const recipe = HD.perEdition((ed) => (HD.atmoSeasons ? HD.atmoSeasons.build(ed) || {} : {}));

  HD.atmo = {
    TITLE,
    LIT,
    rgba32,
    warmed,
    litSet,
    level,
    skyline,
    srDisc,
    srPx,
    srFlush,
    plume,
    plumeTones,
    fieldPlume,
    splat,
    resolveField,
    puffs,
    keepTitle,
    pnoise,
    bakePixels,
    bakeTile,
    bakeMask,
    band,
    drawBand,
    behind,
    bakeVeil,
    bakeShafts,
    bakeVignette,
  };

  function runPlumes(g, t, list) {
    if (!list) return;
    for (const P of list) {
      if (P.on && !P.on(t)) continue;
      if (P.style.ramp) {
        fieldPlume(g, t, P.style, P.emitters, P.alpha);
        continue;
      }
      for (const E of P.emitters) plume(g, t, P.style, E);
      srFlush(g, P.alpha);
    }
  }

  HD.module('atmosphere', {
    init() {
      srInit();
      backScratch();
    },
    passes: [
      {
        layer: 'fx',
        z: 50,
        id: 'back-haze',
        draw(g, t) {
          frameLight();
          const R = recipe();
          if (!R.back) return;
          // the plain layers share one cut-out and one composite; a layer with
          // its own blend (the lightning veil) goes on its own
          let y0 = H;
          let y1 = 0;
          for (const B of R.back) {
            if (B.op) continue;
            y0 = Math.min(y0, B.y0);
            y1 = Math.max(y1, B.y1);
          }
          const paint = (gb, B, al) => {
            gb.ctx.globalAlpha = al === undefined ? 1 : al;
            if (B.veil) gb.sprite(B.veil.cv, B.veil.x0, B.veil.y0);
            gb.ctx.globalAlpha = 1;
            if (B.bands) for (const b of B.bands) drawBand(gb, b, t);
            if (B.draw) B.draw(gb, t);
          };
          if (y1 > y0)
            behind(g, y0, y1, (gb) => {
              for (const B of R.back) {
                if (B.op) continue;
                const al = typeof B.alpha === 'function' ? B.alpha(t) : B.alpha;
                if (al !== undefined && al <= 0.004) continue;
                paint(gb, B, al);
              }
            });
          for (const B of R.back) {
            if (!B.op) continue;
            const al = typeof B.alpha === 'function' ? B.alpha(t) : B.alpha;
            if (al !== undefined && al <= 0.004) continue;
            behind(g, B.y0, B.y1, (gb) => paint(gb, B), al, B.op);
          }
        },
      },
      {
        layer: 'fx',
        z: 51,
        id: 'far-shimmer',
        draw(g, t) {
          const R = recipe();
          if (R.shimmerFar) shimmer(g, t, R.shimmerFar);
        },
      },
      {
        layer: 'fx',
        z: 52,
        id: 'low-mist',
        draw(g, t) {
          const R = recipe();
          if (R.low) for (const B of R.low) drawBand(g, B, t);
          if (R.lowDraw) R.lowDraw(g, t);
        },
      },
      {
        layer: 'fx',
        z: 54,
        id: 'plumes',
        draw(g, t) {
          runPlumes(g, t, recipe().plumes);
        },
      },
      {
        layer: 'fx',
        z: 58,
        id: 'sun-shafts',
        draw(g, t) {
          const R = recipe();
          if (R.shimmerRoad) shimmer(g, t, R.shimmerRoad);
          const S = R.shafts;
          if (!S) return;
          const ctx = g.ctx;
          ctx.globalCompositeOperation = 'lighter';
          for (let k = 0; k < S.layers.length; k++) {
            const v = S.layers[k];
            const br = 0.5 + 0.5 * T.wave(t, S.period, k * 0.5);
            const fl = 0.85 + 0.15 * T.noise(t, 9, 61 + k);
            ctx.globalAlpha = clamp((S.base + S.swing * br) * fl, 0, 1);
            ctx.drawImage(v.cv, v.x0, v.y0);
          }
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          if (S.motes) drawMotes(g, t, S.motes, S.lit);
        },
      },
      {
        layer: 'fx',
        z: 62,
        id: 'near-mist',
        draw(g, t) {
          const R = recipe();
          if (R.front) for (const B of R.front) drawBand(g, B, t);
          if (R.frontDraw) R.frontDraw(g, t);
        },
      },
      {
        layer: 'fx',
        z: 69,
        id: 'vignette',
        draw(g) {
          const R = recipe();
          if (R.vignette) g.sprite(R.vignette.cv, 0, 0);
        },
      },
    ],
  });
})();
