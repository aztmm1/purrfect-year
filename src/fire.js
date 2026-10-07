/*
 * fire.js — the courtyard fire pit (Purrfect Year v2).
 *
 * When HD.edition.fire is 'firepit', a round fire bowl stands at the current
 * place's firepit anchor (HD.place().firepit = {x, base}: x is its centre,
 * base the ground line it stands on): a wide, shallow weathered-steel bowl on
 * a short stone plinth, a bed of glowing coals, procedural flames, sparks and
 * the warm light that pools on the plaza and on the cats around it. Smoke
 * belongs to atmosphere (HD._fire.pit(t) gives it the column to rise from).
 * With fire 'none' nothing is drawn. Everything is read at draw time, so live
 * edition switching works.
 *
 *   scene z 38   contact shadow, the bowl's back rim and inner wall, coal bed
 *   scene z 39   flames (emissive, 12 fps)
 *   scene z 40   the bowl's front: lip, body, plinth
 *   fx    z 35   sparks and the odd ember pop
 *
 * Flames: a field of stateless "puffs" (HD.time.cycle blobs at 12 fps)
 * streams up from a hot root over the coals, converging and leaning with the
 * breeze; a tileable value-noise texture baked in init() scrolls upward (a
 * whole number of tile heights per loop) and erodes the field so tongues
 * split and detach. The field is banded into HD.PAL.fire colours, then lone
 * pixels and pinholes are cleaned up so the shapes stay clustered.
 *
 * Light by time of day: at night and dusk the bowl's outside is painted
 * emissive (the fire inside cannot light the face turned towards us: it
 * stays a dark silhouette with a hot lip); at golden hour and by day it is
 * plain scene paint, so the daylight fill shows its true rust colour. Lamps
 * are dimmed by day, so the fire light is boosted a little at golden hour to
 * stay a warm pocket among the long shadows.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const R = Math.round;

  const FIRE = P.fire.map((c) => HD.color.hex(c));
  // flame bands: dark red edge -> pale gold core
  const BAND_COL = [3, 5, 6, 7, 8, 9];
  const BAND_TH = [0.1, 0.26, 0.46, 0.7, 1.0, 1.4];

  // ---- helpers -----------------------------------------------------------
  /** loop-wrapped integer tick at `fps` (per-tick hashes repeat every loop) */
  function tick(t, fps) {
    const n = Math.round(HD.LOOP * fps);
    const k = Math.floor(t * fps + 1e-6) % n;
    return k < 0 ? k + n : k;
  }

  function bakeNoise(rnd, NW, NH) {
    // two-octave tileable value noise, elongated vertically (flame tongues)
    const out = new Float32Array(NW * NH);
    const oct = [
      { cx: 6, cy: 3, a: 0.7 },
      { cx: 12, cy: 6, a: 0.3 },
    ];
    for (const o of oct) {
      const lat = new Float32Array(o.cx * o.cy);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < NH; y++) {
        const gy = (y / NH) * o.cy;
        const iy = Math.floor(gy);
        let fy = gy - iy;
        fy = fy * fy * (3 - 2 * fy);
        const y0 = iy % o.cy;
        const y1 = (iy + 1) % o.cy;
        for (let x = 0; x < NW; x++) {
          const gx = (x / NW) * o.cx;
          const ix = Math.floor(gx);
          let fx = gx - ix;
          fx = fx * fx * (3 - 2 * fx);
          const x0 = ix % o.cx;
          const x1 = (ix + 1) % o.cx;
          const a = lat[y0 * o.cx + x0];
          const b = lat[y0 * o.cx + x1];
          const c = lat[y1 * o.cx + x0];
          const d = lat[y1 * o.cx + x1];
          out[y * NW + x] += ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) * o.a;
        }
      }
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < out.length; i++) {
      if (out[i] < lo) lo = out[i];
      if (out[i] > hi) hi = out[i];
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
    return out;
  }

  /** spark colour by temperature 0..1 (1 = white hot) */
  function sparkCol(k) {
    return k > 0.86 ? P.fire[10] : k > 0.72 ? P.fire[9] : k > 0.58 ? P.fire[8] : k > 0.44 ? P.fire[7] : k > 0.3 ? P.fire[6] : k > 0.18 ? P.fire[5] : k > 0.08 ? P.fire[4] : P.fire[3];
  }

  /** is the current time of day lit by the sun (bowl painted as plain scene paint)? */
  function sunlit() {
    const lt = HD.light ? HD.light() : null;
    return !!lt && lt.day >= 0.5;
  }

  // ---- the bowl --------------------------------------------------------------
  // Hand-placed rows, relative to the centre x and the ground line `base`
  // (dy < 0 is up). The rim is an ellipse seen slightly from above:
  //   dy -9      back rim (its top edge)
  //   dy -8..-7  the opening: inner back wall and the coal bed
  //   dy -6      the front lip (its top surface catches the flames)
  //   dy -5..-2  the bowl's outer face, narrowing to the stem
  //   dy -1      the stone plinth on the ground
  const HW = 10; // half width of the lip
  const RIM_Y = -8; // centre row of the rim ellipse (the coal bed)
  // opening half-widths per row (inner back wall + coals live here)
  const OPEN = { '-9': 5, '-8': 8 };
  // the back rim: its top edge and the two shoulders
  const BACK = [
    [-10, -5, 5],
    [-9, -8, -6],
    [-9, 6, 8],
    [-8, -10, -9],
    [-8, 9, 10],
  ];
  // outer face rows [dy, half width] (the first is the lip)
  const BODY = [
    [-7, 10],
    [-6, 10],
    [-5, 9],
    [-4, 7],
    [-3, 5],
  ];
  // stone pedestal [dy, half width]
  const PLINTH = [
    [-2, 3],
    [-1, 4],
  ];

  // Colours, as final screen colours: the bowl is painted emissive at every
  // time of day. The fire inside cannot light the face turned towards us,
  // and the daylight fill would relight the rust into a glowing plate, so
  // each light mode gets its own hand-picked ramp. NIGHT (also dusk): a dark
  // steel silhouette with a hot lip and a faint cold rim on the left. SUN
  // (golden hour and day): weathered corten in low warm sunlight from the
  // right, a pale concrete pedestal.
  const NIGHT = {
    rimHot: [P.fire[6], P.fire[5], P.fire[4]], // lip top by flicker level
    rimBack: [P.fire[4], P.fire[3], P.fire[2]], // far rim, lit from inside
    wall: [P.fire[3], P.fire[2], P.fire[1]], // inner back wall above the coals
    face: [P.wood[4], P.wood[2], P.wood[1], P.wood[0]], // lip face, mid, lower, bottom
    edge: [P.wood[1], P.wood[0], P.wood[0]], // row ends (round silhouette)
    sheen: P.night[5], // cold rim light on the left
    sheenX: -1,
    stone: [P.stone[4], P.stone[3], P.stone[2]], // pedestal top, face, shade
    shadow: P.stone[0],
  };
  const SUN = {
    rimHot: [P.fire[7], P.fire[6], P.fire[5]],
    rimBack: ['#c4683a', '#a8552e', '#8a4426'],
    wall: [P.fire[4], P.fire[3], P.fire[3]],
    face: ['#7a4630', '#5e3424', '#46261c', '#2e1912'],
    edge: ['#4a2a1e', '#36201a', '#26150f'],
    sheen: '#9a5a38', // the sunlit side (right)
    sheenX: 1,
    stone: ['#b4a08a', '#8c7c6c', '#6a5c52'],
    shadow: P.stone[1],
  };

  // ---- flames ------------------------------------------------------------------
  const FH = 12; // nominal flame height above the coal bed
  const HALFW = 7.5; // half width of the flame root
  const GW = 26;
  const GH = 26;
  const NW = 24;
  const NH = 36;
  const N_BLOB = 14;
  const N_SPARK = 20;

  let NOISE = null;
  let flameCv = null;
  let flameCtx = null;
  let flameImg = null;
  let LV = null;
  let LV2 = null;
  let FLD = null;
  let COALS = null; // [{dx, dy, base, cl, per}] coal pixels relative to (cx, base)
  let coalCv = null;
  let coalCtx = null;
  let coalImg = null;
  const KW = 2 * HW + 1;
  const KH = 1;

  /** the fire pit of the current edition, or null */
  function pitAnchor() {
    const ed = HD.edition;
    if (!ed || ed.fire !== 'firepit') return null;
    const pl = HD.place ? HD.place() : null;
    return pl && pl.firepit ? pl.firepit : null;
  }

  // flame "breath": height multiplier shared by the flames, light and sparks
  function flameHeight(t) {
    const f = T.flicker(t, 3, 1.2);
    const fl = T.noise(t, 9, 77);
    const flare = HD.smoothstep(0.64, 0.92, fl);
    return { f, flare, h: FH * (0.88 + 0.28 * f + 0.26 * flare) };
  }

  function splat(fld, gx0, gy0, bx, by, rx, ry, s) {
    const x0 = Math.max(0, Math.floor(bx - rx - gx0));
    const x1 = Math.min(GW - 1, Math.ceil(bx + rx - gx0));
    const y0 = Math.max(0, Math.floor(by - ry - gy0));
    const y1 = Math.min(GH - 1, Math.ceil(by + ry - gy0));
    const irx = 1 / (rx * rx);
    const iry = 1 / (ry * ry);
    for (let gy = y0; gy <= y1; gy++) {
      const dy = gy0 + gy + 0.5 - by;
      const ky = 1 - dy * dy * iry;
      if (ky <= 0) continue;
      const row = gy * GW;
      for (let gx = x0; gx <= x1; gx++) {
        const dx = gx0 + gx + 0.5 - bx;
        const k = ky - dx * dx * irx;
        if (k > 0) fld[row + gx] += s * k;
      }
    }
  }

  function drawFlames(g, t, cx, base) {
    const ts = T.step(t, 12);
    const st = flameHeight(ts);
    const Hc = st.h;
    const root = base + RIM_Y - 0.5; // flame root (y), at the coal bed
    const gx0 = cx - (GW >> 1);
    const gy0 = R(root) - GH + 3;
    const sA = Math.floor(T.phase(ts, 1.35) * NH);
    const sB = Math.floor(T.phase(ts, 2.2) * NH);
    const breeze = HD.summer ? HD.summer.breeze(ts) : 0;
    const lean = 0.06 + 0.07 * breeze;
    const sway = (T.noise(ts, 1.3, 52) - 0.5) * 1.6;
    const fld = FLD;
    fld.fill(0);
    const cxf = cx + 0.5;
    // hot root over the coals
    splat(fld, gx0, gy0, cxf, root, HALFW * (0.94 + 0.06 * st.f), 2.4 + 0.8 * st.f, 0.8);
    splat(fld, gx0, gy0, cxf, root - 2.5, HALFW * 0.5, 3.4 + 1 * st.f, 0.34);
    for (let i = 0; i < N_BLOB; i++) {
      const c = T.cycle(ts, i, 0.62 + HD.hash(i, 1, 23) * 0.34, 321);
      const a = c.age;
      const side = c.rnd(0) * 2 - 1;
      const cen = 1 - Math.abs(side);
      const top = Hc * (0.42 + 0.52 * cen + 0.2 * c.rnd(1));
      const h = 1 + top * Math.pow(a, 0.85);
      const xs = cxf + side * HALFW * 0.82;
      const conv = 0.6 * Math.min(1, a * 1.4);
      const hn = h / Hc;
      const wob = Math.sin(6.2832 * (c.rnd(2) + a * (1 + c.rnd(3)))) * 0.8 * hn;
      const bx = xs + (cxf - xs) * conv + lean * h + sway * hn * hn + wob;
      const by = root - h;
      const r = (1.3 + 1.7 * c.rnd(4)) * Math.pow(1 - a, 0.8) + 0.45;
      splat(fld, gx0, gy0, bx, by, r, r * (1.5 + 1.4 * a), 0.66 * (1 - a * 0.5));
    }
    const lv = LV;
    for (let gy = 0; gy < GH; gy++) {
      const y = gy0 + gy;
      const h = root - y + 0.5;
      const row = gy * GW;
      const hc = Math.min(1.2, Math.max(0, h / Hc));
      const nRowA = ((gy + sA) % NH) * NW;
      const nRowB = ((gy + sB + 13) % NH) * NW;
      const kN = 0.3 + 0.45 * hc;
      for (let gx = 0; gx < GW; gx++) {
        const f0 = fld[row + gx];
        if (f0 <= 0.02) {
          lv[row + gx] = 0;
          continue;
        }
        const n = 0.62 * NOISE[nRowA + (gx % NW)] + 0.38 * NOISE[nRowB + ((gx + 7) % NW)];
        const F = f0 - (n - 0.35) * kN;
        let L = 0;
        while (L < 6 && F > BAND_TH[L]) L++;
        lv[row + gx] = L;
      }
    }
    // cleanup: no lone pixels, no isolated bright dots, fill pinholes
    const l2 = LV2;
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const p = gy * GW + gx;
        const v = lv[p];
        const a = gx > 0 ? lv[p - 1] : 0;
        const b = gx < GW - 1 ? lv[p + 1] : 0;
        const c = gy > 0 ? lv[p - GW] : 0;
        const e = gy < GH - 1 ? lv[p + GW] : 0;
        let mx = a > b ? a : b;
        if (c > mx) mx = c;
        if (e > mx) mx = e;
        let ov = v;
        if (v > 0) {
          if (mx === 0) ov = 0;
          else if (v > mx) ov = mx;
        } else {
          const cnt = (a > 0) + (b > 0) + (c > 0) + (e > 0);
          if (cnt >= 3) {
            let mn = 9;
            if (a > 0 && a < mn) mn = a;
            if (b > 0 && b < mn) mn = b;
            if (c > 0 && c < mn) mn = c;
            if (e > 0 && e < mn) mn = e;
            ov = mn;
          }
        }
        l2[p] = ov;
      }
    }
    const d = flameImg.data;
    d.fill(0);
    for (let p = 0, q = 0; p < GW * GH; p++, q += 4) {
      const v = l2[p];
      if (v === 0) continue;
      const col = FIRE[BAND_COL[v - 1]];
      d[q] = col[0];
      d[q + 1] = col[1];
      d[q + 2] = col[2];
      d[q + 3] = 255;
    }
    flameCtx.putImageData(flameImg, 0, 0);
    g.em.sprite(flameCv, gx0, gy0);
  }

  // ---- bowl: back half, coals, front half ---------------------------------------
  function flickLevel(t, seed) {
    const f = T.flicker(T.step(t, 12), seed, 1.1);
    return f > 0.62 ? 0 : f > 0.3 ? 1 : 2;
  }

  function drawBack(g, t, cx, base) {
    const C = sunlit() ? SUN : NIGHT;
    const e = g.em;
    // a dark contact shadow on the pavers (scene paint: by day the cast
    // shadow is an L.shade in lights(); at night the fire's pool warms it)
    g.hline(cx - 8, cx + 8, base, C.shadow);
    g.hline(cx - 5, cx + 5, base + 1, C.shadow);
    const lvB = flickLevel(t, 5);
    e.sprite(baked('back', C, lvB, 3, paintBack), cx - HW, base - 10);
    drawCoals(g, t, cx, base);
  }

  function paintBack(e, cx, base, C, lvB) {
    // rows dy -10..-8 of the bowl, with base = 10 in sprite space
    base = 10;
    // back rim (lit from the inside)
    for (const [dy, a, b] of BACK) e.hline(cx + a, cx + b, base + dy, C.rimBack[Math.min(2, lvB + (Math.abs(a) > 8 ? 1 : 0))]);
    // inner back wall: glows above the coals, brighter in the middle
    const w = OPEN['-9'];
    for (let x = -w; x <= w; x++) e.px(cx + x, base - 9, C.wall[Math.min(2, lvB + (Math.abs(x) > 3 ? 1 : 0))]);
  }

  function drawCoals(g, t, cx, base) {
    const ts = T.step(t, 12);
    const d = coalImg.data;
    d.fill(0);
    const glow = T.flicker(t, 3, 0.6);
    const tk = tick(t, 12);
    for (const k of COALS) {
      const pulse = T.noise(ts, k.per, k.cl);
      let v = k.base + (pulse - 0.5) * 0.5 + (glow - 0.5) * 0.2;
      if (k.base > 0.55 && HD.hash(k.cl, tk, 5) > 0.985) v += 0.3;
      const ci = v < 0.14 ? 2 : v < 0.3 ? 3 : v < 0.45 ? 4 : v < 0.58 ? 5 : v < 0.7 ? 6 : v < 0.82 ? 7 : v < 0.93 ? 8 : 9;
      const col = FIRE[ci];
      const q = (k.dx + HW) * 4;
      d[q] = col[0];
      d[q + 1] = col[1];
      d[q + 2] = col[2];
      d[q + 3] = 255;
    }
    coalCtx.putImageData(coalImg, 0, 0);
    g.em.sprite(coalCv, cx - HW, base + RIM_Y);
  }

  // the bowl's front and back are baked per palette and flicker level
  // (3 levels x 2 palettes) and blitted as emissive sprites
  const BAKED = new Map();
  function baked(kind, C, lv, h, paint) {
    const key = kind + (C === SUN ? 'S' : 'N') + lv;
    let spr = BAKED.get(key);
    if (!spr) BAKED.set(key, (spr = HD.bake(2 * HW + 1, h, (gg) => paint(gg, HW, h, C, lv))));
    return spr;
  }

  function drawFront(g, t, cx, base) {
    const C = sunlit() ? SUN : NIGHT;
    g.em.sprite(baked('front', C, flickLevel(t, 5), 7, paintFront), cx - HW, base - 7);
  }

  function paintFront(e, cx, base, C, lv) {
    // the lip's top surface: hot in the middle where the flames lean over it,
    // cooler towards the ends
    const lipY = base + BODY[0][0];
    for (let x = -HW; x <= HW; x++) {
      const k = Math.abs(x) / HW;
      e.px(cx + x, lipY, C.rimHot[Math.min(2, lv + (k > 0.5 ? 1 : 0) + (k > 0.85 ? 1 : 0))]);
    }
    // outer face: the rolled lip, then darker towards the stem, the ends of
    // each row a shade darker so the bowl reads round
    for (let i = 1; i < BODY.length; i++) {
      const [dy, hw] = BODY[i];
      e.hline(cx - hw, cx + hw, base + dy, C.face[i - 1]);
      if (i < BODY.length - 1) {
        e.px(cx - hw, base + dy, C.edge[i - 1]);
        e.px(cx + hw, base + dy, C.edge[i - 1]);
      }
    }
    // rim light on one side of the face (cold moonlit edge at night, the
    // low sun at golden hour)
    const sx = C.sheenX;
    const [d1, w1] = BODY[1];
    const [d2, w2] = BODY[2];
    e.hline(cx + sx * (w1 - 1), cx + sx * (w1 - 3), base + d1, C.sheen);
    e.px(cx + sx * (w2 - 1), base + d2, C.sheen);
    // stone pedestal: a lit top edge, a shaded side away from the light
    const [p0, q0] = PLINTH[0];
    const [p1, q1] = PLINTH[1];
    e.hline(cx - q0, cx + q0, base + p0, C.stone[0]);
    e.hline(cx - q1, cx + q1, base + p1, C.stone[1]);
    e.px(cx - sx * q1, base + p1, C.stone[2]);
    e.px(cx - sx * q0, base + p0, C.stone[1]);
  }

  // ---- sparks --------------------------------------------------------------------
  const POP_P = 9;
  function popState(t) {
    const c = T.cycle(t, 0, POP_P, 4243);
    const at = c.rnd(1) * 3;
    return { tau: c.age * c.P - at, c: c.c, x: c.rnd(2), n: 3 + Math.floor(c.rnd(3) * 2) };
  }

  function drawSparks(g, t, cx, base) {
    const day = sunlit();
    const root = base + RIM_Y - 2;
    const nS = day ? N_SPARK >> 1 : N_SPARK;
    for (let i = 0; i < nS; i++) {
      const per = 2.4 + HD.hash(i, 3, 17) * 2.4;
      const c = T.cycle(t, i, per, 919);
      const life = 0.9 + c.rnd(0) * 1.6;
      const tau = c.age * c.P;
      if (tau > life) continue;
      if (c.rnd(9) < 0.3) continue;
      const a = tau / life;
      const x0 = cx + (c.rnd(1) - 0.45) * 9;
      const y0 = root - 3 - c.rnd(2) * 6;
      const v0 = 18 + c.rnd(3) * 22;
      const k = 1 + c.rnd(4) * 1;
      const rise = v0 * k * (1 - Math.exp(-tau / k));
      const drift = (2.5 + c.rnd(5) * 5) * Math.pow(tau, 1.3);
      const wa = 0.6 + c.rnd(6) * 1.4;
      const wob = wa * Math.sin(tau * (3 + c.rnd(7) * 4) + c.rnd(8) * 6.283) * Math.min(1, tau * 1.5);
      const x = R(x0 + drift + wob);
      const y = R(y0 - rise);
      const tw = HD.hash(i, tick(t, 14), c.c, 2) < 0.12 ? -0.12 : 0;
      const temp = (1 - a) * (0.7 + 0.3 * c.rnd(10)) + tw;
      if (temp < 0.05) continue;
      g.px(x, y, sparkCol(temp));
      const sp = v0 * Math.exp(-tau / k);
      if (sp > 24 && temp > 0.45) g.px(x, y + 1, sparkCol(temp - 0.3));
    }
    // ember pop: a small fan of sparks now and then
    const pp = popState(t);
    if (pp.tau >= 0 && pp.tau < 1.2) {
      const px0 = cx - 3 + pp.x * 6;
      const py0 = root - 2;
      for (let j = 0; j < pp.n; j++) {
        const r0 = HD.hash(pp.c, j, 31, 1);
        const r1 = HD.hash(pp.c, j, 31, 2);
        const r2 = HD.hash(pp.c, j, 31, 3);
        const life = 0.45 + r2 * 0.6;
        const tau = pp.tau;
        if (tau > life) continue;
        const ang = -Math.PI / 2 + (r0 - 0.5) * 2;
        const v = 26 + r1 * 22;
        const vx = Math.cos(ang) * v;
        const vy = Math.sin(ang) * v;
        const x = R(px0 + vx * tau);
        const y = R(py0 + vy * tau + 0.5 * 60 * tau * tau);
        const temp = 1 - tau / life;
        g.px(x, y, sparkCol(temp));
        if (tau < 0.2) g.px(x - Math.sign(vx), y + 1, sparkCol(temp - 0.35));
      }
    }
  }

  // ---- lights ------------------------------------------------------------------
  function lights(t, Lt, cx, base) {
    const st = flameHeight(t);
    const f = st.f;
    const pp = popState(t);
    const pop = pp.tau >= 0 && pp.tau < 0.4 ? 0.1 * (pp.tau < 0.1 ? pp.tau / 0.1 : 1 - (pp.tau - 0.1) / 0.3) : 0;
    const lt = HD.light ? HD.light() : null;
    const mode = lt ? lt.mode : 'night';
    // lamps are dimmed by day (engine): the fire keeps a little more of its
    // warmth at golden hour; by full day it is a small pocket
    const boost = mode === 'golden' ? 1.15 : mode === 'day' ? 1.25 : 1;
    const ts = T.step(t, 12);
    const jx = R((T.noise(ts, 0.5, 61) - 0.5) * 1.6);
    const jy = R((T.noise(ts, 0.6, 62) - 0.5) * 1.2);
    const cy = base + RIM_Y - R(st.h * 0.45);
    // by day the bowl casts a short shadow away from the sun
    if (lt && lt.day > 0 && lt.sun) {
      const dir = lt.sun.x > cx ? -1 : 1;
      const len = lt.mode === 'day' ? 6 : 15;
      Lt.shade({
        poly: [
          [cx - 9, base - 1],
          [cx + 9, base - 1],
          [cx + 9 + dir * len, base + 2],
          [cx - 9 + dir * len, base + 2],
        ],
        k: 0.45,
      });
    }
    Lt.add({
      x: cx + jx,
      y: cy + jy,
      r: 70,
      ry: 56,
      color: HD.LIGHT.fire,
      i: (0.34 + 0.16 * f + 0.06 * st.flare + pop) * boost,
      halo: { r: 18, a: 0.16, y: cy + 1 },
    });
    // a hotter, tighter pool on the pavers and the cats right at the pit
    Lt.add({
      x: cx + jx,
      y: base - 3,
      r: 34,
      ry: 14,
      color: HD.LIGHT.fire,
      i: (0.1 + 0.07 * f + pop * 0.3) * boost,
      bands: 4,
      pow: 2,
      clip: { x0: 0, y0: base - 16, x1: HD.W - 1, y1: HD.H - 1 },
    });
  }

  // ---- init ----------------------------------------------------------------------
  function init() {
    NOISE = bakeNoise(HD.rng(4711), NW, NH);
    flameCv = HD.canvas(GW, GH, true);
    flameCtx = flameCv.getContext('2d');
    flameImg = flameCtx.createImageData(GW, GH);
    LV = new Uint8Array(GW * GH);
    LV2 = new Uint8Array(GW * GH);
    FLD = new Float32Array(GW * GH);
    // coal bed in the opening's front row, hottest at the centre
    const r = HD.rng(1313);
    COALS = [];
    for (const dy of [RIM_Y]) {
      const w = OPEN[String(dy)];
      for (let dx = -w; dx <= w; dx++) {
        const cxi = Math.floor((dx + w + (dy & 1)) / 3);
        const cl = 100 + (dy + 8) * 31 + cxi;
        const seam = (dx + w + (dy & 1)) % 3 === 0 && HD.hash(cl, 1, 2) < 0.6;
        const hot = 1 - Math.abs(dx) / (w + 1);
        let b = 0.2 + hot * 0.6 + (HD.hash(cl, 9, 9) - 0.5) * 0.35 + (r() - 0.5) * 0.08;
        if (seam) b -= 0.28;
        COALS.push({ dx, dy, base: b, cl, per: 2 + HD.hash(cl, 4, 4) * 2.6 });
      }
    }
    coalCv = HD.canvas(KW, KH, true);
    coalCtx = coalCv.getContext('2d');
    coalImg = coalCtx.createImageData(KW, KH);
  }

  /**
   * For other modules (atmosphere's smoke): the live fire pit's smoke column,
   * or null when there is none: {x, y (flame tip), base, h (flame height), f
   * (flicker 0..1)}.
   */
  function pit(t) {
    const a = pitAnchor();
    if (!a) return null;
    const st = flameHeight(T.step(t, 12));
    return { x: a.x, y: R(a.base + RIM_Y - st.h), base: a.base, h: st.h, f: st.f };
  }

  HD._fire = { tick, sparkCol, FIRE, pit };
  /** nominal flame-tip y of the current place's fire pit (atmosphere's smoke emitter), or null */
  HD.firepitTop = function () {
    const a = pitAnchor();
    return a ? R(a.base) + RIM_Y - FH + 1 : null;
  };

  // ---- module --------------------------------------------------------------------
  HD.module('fire', {
    init,
    lights(t, Lt) {
      const a = pitAnchor();
      if (a) lights(t, Lt, R(a.x), R(a.base));
    },
    passes: [
      {
        layer: 'scene',
        z: 38,
        id: 'pit-back',
        draw(g, t) {
          const a = pitAnchor();
          if (a) drawBack(g, t, R(a.x), R(a.base));
        },
      },
      {
        layer: 'scene',
        z: 39,
        id: 'flames',
        draw(g, t) {
          const a = pitAnchor();
          if (a) drawFlames(g, t, R(a.x), R(a.base));
        },
      },
      {
        layer: 'scene',
        z: 40,
        id: 'pit-front',
        draw(g, t) {
          const a = pitAnchor();
          if (a) drawFront(g, t, R(a.x), R(a.base));
        },
      },
      {
        layer: 'fx',
        z: 35,
        id: 'sparks',
        draw(g, t) {
          const a = pitAnchor();
          if (a) drawSparks(g, t, R(a.x), R(a.base));
        },
      },
    ],
  });
})();
