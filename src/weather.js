/*
 * weather: rain (the two Halloweens) and the shared plumbing for the seasonal
 * weather in weather-seasons.js.
 *
 *   bg  z22   far rain: short dim 1px streaks behind the buildings
 *   fx  z26   ripple rings in the place's puddles (place.puddles)
 *   fx  z27   splashes: mid drops landing on the sidewalk and the street, and
 *             pops along the building ledges (place.surfaces)
 *   fx  z42   mid rain + fat drips from canopies and cornices (place.drips)
 *   fx  z66   near rain: sparse, long, fast; crosses the whole frame
 *
 * Anchors: the building modules register place.surfaces ([x0, y0, x1, y1]
 * ledges) and place.drips ([{x, y}]) at init. Without them the top edge of
 * the place's silhouette (or its registered skyline) and the entrance canopy
 * stand in. They are read at draw time and cached per place, so live
 * switching and late registration both work.
 *
 * Every drop is a stateless HD.time.cycle life with per-life random x, so the
 * frame is a pure function of t and loops at HD.LOOP. fx is not relit, so
 * each drop samples the placed lights where it is (the daylight fill taken
 * out) and picks a precomputed tone: cold blue-grey in the dark, warming
 * through PAL.warmrain by lit windows, shopfronts and street lamps.
 *
 * Snow, leaves, petals, fireflies and gulls live in weather-seasons.js and
 * plug in through the HD.weatherSeasons hooks (far / mid / near / lights).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const LY = HD.layout;
  const T = HD.time;
  const S = LY.wind.slant;
  const W = HD.W;
  const H = HD.H;
  const mix = HD.color.mix;
  const hash = HD.hash;
  const rgbAt = HD.lights.rgb;
  const SEA = (HD.weatherSeasons = HD.weatherSeasons || {});

  const BASE = 206; // every place: the building base and the back of the ground
  const GB = 268; // nearest ground row a mid drop lands on (the front of the street)
  const TS = LY.titleSafe;
  const inTitle = (x, y) => x >= TS.x0 - 4 && x <= TS.x1 + 4 && y >= TS.y0 - 4 && y <= TS.y1 + 4;

  // ------------------------------------------------------------------
  // light: fx is never relit, so a drop reads the placed lights at its
  // pixel with the daylight fill taken out (at night the fill is zero)
  // ------------------------------------------------------------------
  let F0 = 0;
  let F1 = 0;
  let F2 = 0;
  let MODE = 'night';
  function syncLight() {
    const lt = HD.light();
    MODE = lt.mode;
    const f = lt.day > 0 ? lt.fill : null;
    F0 = f ? f[0] : 0;
    F1 = f ? f[1] : 0;
    F2 = f ? f[2] : 0;
  }
  function lum(x, y) {
    const c = rgbAt(x, y);
    const v = 0.4 * Math.max(0, c[0] - F0) + 0.45 * Math.max(0, c[1] - F1) + 0.15 * Math.max(0, c[2] - F2);
    return v;
  }

  // ------------------------------------------------------------------
  // colour tables: [tone][lightLevel] -> css string (all precomputed), one
  // set per light mode (rain by day is a paler grey against a bright scene)
  // ------------------------------------------------------------------
  const LVT = [0.035, 0.08, 0.15, 0.25, 0.38, 0.56];
  function lvOf(l) {
    let k = 0;
    while (k < 6 && l >= LVT[k]) k++;
    return k;
  }
  /** cold colour -> 7 light levels warming through PAL.warmrain */
  function warmRamp(cold, maxW, wk) {
    const out = [cold];
    for (let k = 1; k <= 6; k++) {
      const wi = Math.min(maxW, Math.ceil((k * maxW) / 6));
      out.push(mix(cold, P.warmrain[wi], Math.min(0.9, (0.26 + 0.12 * k) * wk)));
    }
    return out;
  }
  const R = P.rain;
  function rainSet(pale) {
    const c = (v) => (pale ? mix(v, P.night[11], pale) : v);
    return {
      FAR: [warmRamp(c(P.night[5]), 1, 0.5), warmRamp(c(mix(P.night[5], R[0], 0.8)), 1, 0.55), warmRamp(c(mix(R[0], R[1], 0.4)), 2, 0.6)],
      MID: [warmRamp(c(mix(R[0], R[1], 0.6)), 3, 0.9), warmRamp(c(mix(R[1], R[2], 0.3)), 4, 1), warmRamp(c(mix(R[1], R[2], 0.7)), 4, 1)],
      NEAR: [warmRamp(c(R[1]), 3, 1), warmRamp(c(mix(R[1], R[2], 0.7)), 3, 1), warmRamp(c(mix(R[2], R[3], 0.45)), 4, 1)],
      SPL: [warmRamp(c(mix(R[0], R[1], 0.6)), 2, 0.9), warmRamp(c(R[2]), 3, 1), warmRamp(c(mix(R[2], R[3], 0.6)), 4, 1)],
      DRP: [warmRamp(c(R[1]), 3, 1), warmRamp(c(R[2]), 3, 1), warmRamp(c(R[3]), 4, 1)],
      RIP: [warmRamp(c(mix(R[0], R[1], 0.7)), 2, 0.7), warmRamp(c(mix(R[1], R[2], 0.45)), 3, 0.8), warmRamp(c(mix(R[2], R[3], 0.3)), 3, 0.85)],
    };
  }
  const RAIN_SETS = { night: rainSet(0), dusk: rainSet(0.18), golden: rainSet(0.4), day: rainSet(0.5) };
  // a lightning flash (HD.sky.flash) lights every drop up blue-white for a moment
  const RAIN_FLASH = [rainSet(0.32), rainSet(0.62)];
  let C = RAIN_SETS.night;

  // ------------------------------------------------------------------
  // density breathes slowly between ~80% and 100%; decided per life
  // (at the life's start time) so a drop never pops in or out mid-fall
  // ------------------------------------------------------------------
  // (the slow curve is tabulated once over the loop, 20 samples a second,
  // and read with linear interpolation: ~1000 drops a frame ask for it)
  const DN = Math.ceil(HD.LOOP * 20);
  const DTAB = new Float32Array(DN + 1);
  for (let i = 0; i <= DN; i++) DTAB[i] = 0.8 + 0.2 * T.noise((i * HD.LOOP) / DN, 47, 6119);
  function dens(ts) {
    let u = (ts / HD.LOOP) * DN;
    u -= Math.floor(u / DN) * DN;
    const i = u | 0;
    return DTAB[i] + (DTAB[i + 1] - DTAB[i]) * (u - i);
  }

  // rain = 1 is the full Halloween downpour; rain < 1 is sparser, softer and slower
  let RK = 1;
  let SOFT = 0;
  function rainOn(t) {
    const r = HD.edition.weather.rain || 0;
    if (!(r > 0)) return false;
    RK = r >= 1 ? 1 : 0.3 + 0.7 * r;
    SOFT = r >= 1 ? 0 : 1;
    syncLight();
    C = RAIN_SETS[MODE] || RAIN_SETS.night;
    const fl = HD.sky && HD.sky.flash && HD.edition.weather.lightning > 0 ? HD.sky.flash(t) : 0;
    if (fl > 0.22) C = RAIN_FLASH[fl > 0.6 ? 1 : 0];
    return true;
  }

  // ------------------------------------------------------------------
  // drawing helpers
  // ------------------------------------------------------------------
  /** 1px slanted streak along x = ax + S*y, from row y0 to y1 (inclusive), as clean vertical runs */
  function streak(g, ax, y0, y1, c) {
    if (y0 < 0) y0 = 0;
    if (y1 >= H) y1 = H - 1;
    if (y1 < y0) return;
    let rs = y0;
    let rx = Math.round(ax + S * y0);
    for (let y = y0 + 1; y <= y1; y++) {
      const x = Math.round(ax + S * y);
      if (x !== rx) {
        g.rect(rx, rs, 1, y - rs, c);
        rs = y;
        rx = x;
      }
    }
    g.rect(rx, rs, 1, y1 - rs + 1, c);
  }

  // crown splashes: per size, per frame, [dx, dy, tone]
  const CROWN = [
    // tiny (ledges, far sidewalk)
    [
      [[0, 0, 2], [-1, -1, 1], [1, -1, 1]],
      [[-1, -2, 0], [1, -2, 0]],
    ],
    // small
    [
      [[0, 0, 2], [-1, -1, 1], [1, -1, 1]],
      [[-2, -2, 1], [2, -2, 1], [0, -1, 0]],
      [[-2, -1, 0], [2, -1, 0]],
    ],
    // big (the near street)
    [
      [[-1, 0, 1], [0, 0, 2], [1, 0, 1], [-1, -1, 2], [1, -1, 2]],
      [[-2, -2, 2], [2, -2, 2], [-1, -1, 0], [1, -1, 0], [0, -3, 1]],
      [[-3, -1, 0], [3, -1, 0], [0, -2, 0]],
    ],
  ];
  const SPL_F = 0.042; // seconds per splash frame
  function crown(g, x, y, size, f, tab, lv) {
    const fr = CROWN[size][f];
    if (!fr) return;
    for (let k = 0; k < fr.length; k++) {
      const p = fr[k];
      g.rect(x + p[0], y + p[1], 1, 1, tab[p[2]][lv]);
    }
  }

  // ------------------------------------------------------------------
  // place anchors, built on first use per place and rebuilt whenever a
  // module (re)registers place.surfaces, place.drips or place.skyline
  // ------------------------------------------------------------------
  /** puddle rows: the same footprint as the engine's reflection */
  function puddleGeo(p) {
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    const rx = Math.round(p.rx);
    const ry = Math.round(p.ry);
    const hw = [];
    for (let y = -ry; y <= ry; y++) {
      const dy = y / (ry + 0.5);
      hw.push(Math.floor((rx + 0.4) * Math.sqrt(Math.max(0, 1 - dy * dy))));
    }
    return { cx, cy, rx, ry, hw, n: Math.max(2, Math.round(rx / 6)), rmax: Math.max(3, Math.min(5, Math.round(rx / 4) + 1)) };
  }
  function inPud(pd, x, y) {
    const dy = y - pd.cy;
    if (dy < -pd.ry || dy > pd.ry) return false;
    const dx = x - pd.cx;
    const h = pd.hw[dy + pd.ry];
    return dx >= -h && dx <= h;
  }
  /** flat 1px elliptical ring (ry ~ rx/3), clipped to a puddle */
  function ering(g, pd, cx, cy, r, c) {
    const ry = r / 3;
    for (let dx = -r; dx <= r; dx++) {
      const h = Math.round(ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (r * r))));
      const x = cx + dx;
      if (inPud(pd, x, cy - h)) g.rect(x, cy - h, 1, 1, c);
      if (h > 0 && inPud(pd, x, cy + h)) g.rect(x, cy + h, 1, 1, c);
    }
  }

  /** ledges: registered surfaces, else runs of the silhouette's top edge plus the entrance canopy */
  function ledgesOf(pl) {
    if (pl.surfaces && pl.surfaces.length) return pl.surfaces.map((s) => [s[0], s[1], s[2], s[3]]);
    const segs = [];
    let x0 = -1;
    let y0 = 0;
    for (let x = 0; x <= W; x++) {
      const top = x < W ? HD.placeTop(x, pl) : 999;
      if (x0 >= 0 && top === y0) continue;
      if (x0 >= 0) segs.push([x0, y0, x - 1, y0]);
      x0 = top < BASE ? x : -1;
      y0 = top;
    }
    const cn = pl.entrance && pl.entrance.canopy;
    if (cn) segs.push([cn.x0, cn.y, cn.x1, cn.y]);
    return segs;
  }
  /** y of a ledge at column x (or -1 when the ledge does not cover x) */
  function ledgeY(s, x) {
    const a = Math.min(s[0], s[2]);
    const b = Math.max(s[0], s[2]);
    if (x < a || x > b) return -1;
    if (s[2] === s[0]) return Math.min(s[1], s[3]);
    return Math.round(s[1] + ((x - s[0]) * (s[3] - s[1])) / (s[2] - s[0]));
  }
  /** drips: registered, else the canopy's front edge and the roof corners where a wall drops away */
  function dripSrc(pl) {
    if (pl.drips && pl.drips.length) return pl.drips;
    const out = [];
    const cn = pl.entrance && pl.entrance.canopy;
    if (cn) {
      const yb = cn.y + (cn.h ? cn.h : 1);
      const n = Math.max(1, Math.round((cn.x1 - cn.x0) / 18));
      for (let k = 0; k <= n; k++) out.push({ x: Math.round(cn.x0 + ((cn.x1 - cn.x0) * k) / n), y: yb });
    }
    let corners = 0;
    for (let x = 1; x < W - 1 && corners < 6; x++) {
      const t0 = HD.placeTop(x, pl);
      if (t0 >= BASE - 20) continue;
      if (HD.placeTop(x - 1, pl) - t0 >= 10) {
        out.push({ x: x - 1, y: t0 + 1 });
        corners++;
      }
      if (HD.placeTop(x + 1, pl) - t0 >= 10) {
        out.push({ x: x + 1, y: t0 + 1 });
        corners++;
      }
    }
    return out;
  }

  const GRAV = 420; // px/s^2
  const ANCH = new Map();
  function anchors() {
    const pl = HD.place();
    let a = ANCH.get(pl.id);
    if (a && a.s === pl.surfaces && a.d === pl.drips && a.k === pl.skyline && a.p === pl.puddles) return a;
    a = buildAnchors(pl);
    ANCH.set(pl.id, a);
    return a;
  }
  function buildAnchors(pl) {
    const segs = ledgesOf(pl);
    // splash points every other pixel along the ledges (none in the title-safe sky)
    const sx = [];
    const sy = [];
    for (const s of segs) {
      const n = Math.max(1, Math.round(Math.max(Math.abs(s[2] - s[0]), Math.abs(s[3] - s[1])) / 2));
      for (let k = 0; k <= n; k++) {
        const x = Math.round(s[0] + ((s[2] - s[0]) * k) / n);
        const y = Math.round(s[1] + ((s[3] - s[1]) * k) / n);
        if (x < 1 || x > W - 2 || y < 2 || inTitle(x, y)) continue;
        sx.push(x);
        sy.push(y);
      }
    }
    const pud = (pl.puddles || []).map(puddleGeo);
    const pudAt = (x, y) => {
      for (const p of pud) if (inPud(p, x, y)) return p;
      return null;
    };
    // a drip lands on the nearest ledge or roof below it, else on the
    // sidewalk just in front of the wall (further out under a canopy)
    const drips = dripSrc(pl).map((d, j) => {
      const x = Math.round(d.x);
      const y0 = Math.round(d.y);
      let land = y0 >= 150 ? 216 : 210;
      let size = 1;
      for (const s of segs) {
        const ly = ledgeY(s, x);
        if (ly > y0 + 3 && ly < land) {
          land = ly;
          size = 0;
        }
      }
      const top = HD.placeTop(x, pl);
      if (top > y0 + 3 && top < land) {
        land = top;
        size = 0;
      }
      return { x, y0, land, size, pud: size ? pudAt(x, land) : null, per: 2.5 + 2 * hash(j, 17, 801), td: Math.sqrt((2 * (land - y0 - 1)) / GRAV) };
    });
    const curb = pl.ground && pl.ground.curb;
    return {
      s: pl.surfaces,
      d: pl.drips,
      k: pl.skyline,
      p: pl.puddles,
      SX: Int16Array.from(sx),
      SY: Int16Array.from(sy),
      SURF_N: Math.max(14, Math.min(64, Math.round(sx.length / 9))),
      drips,
      soft: drips.map((D) => ({ x: D.x, y0: D.y0, land: D.land, size: D.size, pud: D.pud, per: D.per * 1.7, td: D.td })),
      pud,
      pudAt,
      curb,
    };
  }
  SEA.anchors = anchors; // for inspection from the tools

  // per-slot periods (snapped by HD.time.cycle)
  const per = (n, a, b, seed) => Array.from({ length: n }, (_, i) => a + (b - a) * hash(i, seed, 3));
  const FAR_N = 360;
  const MID_N = 300;
  const NEAR_N = 22;
  const SURF_MAX = 64;
  const FAR_P = per(FAR_N, 1.05, 1.35, 11);
  const MID_P = per(MID_N, 0.5, 0.66, 12);
  const NEAR_P = per(NEAR_N, 0.34, 0.42, 13);
  const SURF_P = per(SURF_MAX, 0.8, 1.1, 14);
  const FAR_PS = FAR_P.map((v) => v * 1.25);
  const MID_PS = MID_P.map((v) => v * 1.3);
  const NEAR_PS = NEAR_P.map((v) => v * 1.3);
  const FARP = () => (SOFT ? FAR_PS : FAR_P);
  const MIDP = () => (SOFT ? MID_PS : MID_P);
  const NEARP = () => (SOFT ? NEAR_PS : NEAR_P);

  /** where mid drop i of life c lands: depth d 0..1 maps the back of the sidewalk to the front of the street */
  function landY(d, A) {
    let y = BASE + Math.round(d * (GB - BASE));
    const cb = A.curb;
    if (cb && y > cb[0] && y < cb[1]) y = cb[1]; // never on the curb's face
    return y;
  }

  // ------------------------------------------------------------------
  // passes
  // ------------------------------------------------------------------
  const placeTop = (x) => HD.placeTop(x);
  function drawFar(g, t) {
    const F = C.FAR;
    const PP = FARP();
    for (let i = 0; i < FAR_N; i++) {
      const c = T.cycle(t, i, PP[i], 3301);
      const age = c.age;
      if (c.rnd(7) > dens(t - age * c.P) * RK) continue;
      const yEnd = 200 + c.rnd(1) * 6;
      const xEnd = c.rnd(0) * (W + 24) - 12;
      const r3 = c.rnd(3);
      const len = c.rnd(2) < 0.55 ? 2 : 3;
      const ax = xEnd - S * yEnd;
      const yh = Math.round(-4 + (yEnd + 4) * age);
      const xh = ax + S * yh;
      if (yh - len > placeTop(xh)) continue; // behind a building: the scene covers it
      let b = r3 < 0.3 ? 0 : r3 < 0.88 ? 1 : 2;
      if (b > 0 && ((SOFT && r3 > 0.7) || inTitle(xh, yh))) b--;
      streak(g, ax, yh - len + 1, yh, F[b][lvOf(lum(xh, yh) * 0.6)]);
    }
  }

  function drawMid(g, t, A) {
    const M = C.MID;
    const PP = MIDP();
    for (let i = 0; i < MID_N; i++) {
      const c = T.cycle(t, i, PP[i], 4409);
      const age = c.age;
      if (c.rnd(7) > dens(t - age * c.P) * RK) continue;
      const d = c.rnd(1);
      const yl = landY(d, A);
      const xl = c.rnd(0) * (W + 30) - 15;
      const len = 3 + Math.round(d * 2.6 + c.rnd(2) * 1.2) - SOFT;
      const r3 = c.rnd(3);
      const ax = xl - S * yl;
      const yh = Math.round(-8 + (yl + 8) * age);
      const xh = ax + S * yh;
      let b = d > 0.6 ? (r3 < 0.6 ? 2 : 1) : r3 < 0.25 ? 0 : r3 < 0.85 ? 1 : 2;
      if (b > 0 && (inTitle(xh, yh) || (SOFT && r3 < 0.4))) b--;
      streak(g, ax, yh - len + 1, yh, M[b][lvOf(lum(xh, yh))]);
    }
  }

  function drawGroundSplashes(g, t, A) {
    const SPL_T = SPL_F * 3;
    const PP = MIDP();
    for (let i = 0; i < MID_N; i++) {
      const c = T.cycle(t, i, PP[i], 4409);
      const ts = c.age * c.P;
      if (ts >= SPL_T) continue;
      const pc = c.prev;
      if (c.rnd(7, pc) > dens(t - ts - c.P) * RK) continue;
      const d = c.rnd(1, pc);
      const yl = landY(d, A);
      const xl = Math.round(c.rnd(0, pc) * (W + 30) - 15);
      if (xl < 1 || xl > W - 2) continue;
      const lv = lvOf(lum(xl, yl));
      const pd = A.pudAt(xl, yl);
      const f = Math.floor(ts / SPL_F);
      if (pd) {
        // a drop into a puddle makes a tiny ring instead of a crown
        if (f === 0) g.rect(xl, yl, 1, 1, C.RIP[2][lv]);
        else ering(g, pd, xl, yl, f + 1, C.RIP[f === 1 ? 1 : 0][lv]);
        continue;
      }
      const size = d < 0.22 ? 0 : d < 0.62 || SOFT ? 1 : 2;
      crown(g, xl, yl, size, f, C.SPL, lv);
    }
  }

  function drawSurfaceSplashes(g, t, A) {
    const NS = A.SX.length;
    if (!NS) return;
    const n = A.SURF_N;
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, SURF_P[i], 5501);
      const ts = c.age * c.P;
      if (ts >= SPL_F * 2) continue;
      if (c.rnd(7) > dens(t - ts) * RK) continue;
      const k = Math.floor(c.rnd(0) * NS);
      const x = A.SX[k];
      const y = A.SY[k];
      crown(g, x, y, 0, Math.floor(ts / SPL_F), C.SPL, lvOf(lum(x, y - 1)));
    }
  }

  function drawRipples(g, t, A) {
    const PUD = A.pud;
    for (let k = 0; k < PUD.length; k++) {
      const pd = PUD[k];
      for (let s = 0; s < pd.n; s++) {
        const c = T.cycle(t, k * 16 + s, 0.85 + 0.4 * hash(k, s, 77), 7707);
        const age = c.age;
        if (age > 0.7) continue;
        if (c.rnd(7) > dens(t - age * c.P) * RK) continue;
        const rmax = pd.rmax - (c.rnd(3) < 0.4 ? 1 : 0);
        const a = age / 0.7;
        const r = 1 + Math.floor(rmax * a * (1.6 - 0.6 * a));
        if (r > rmax) continue;
        const cx = Math.round(pd.cx + (c.rnd(0) * 2 - 1) * Math.max(0, pd.rx - rmax - 1));
        const cy = pd.cy + Math.round((c.rnd(1) * 2 - 1) * Math.max(0, pd.ry - 1.6));
        const tone = a < 0.3 ? 2 : a < 0.65 ? 1 : 0;
        ering(g, pd, cx, cy, r, C.RIP[tone][lvOf(lum(cx, cy))]);
      }
    }
  }

  function drawDrips(g, t, A) {
    const DR = SOFT ? A.soft : A.drips;
    const D1 = C.DRP;
    for (let j = 0; j < DR.length; j++) {
      const D = DR[j];
      const c = T.cycle(t, j, D.per, 8801);
      const Pd = c.P;
      const ts = c.age * Pd;
      const tr = Pd * 0.62; // let go
      const x = D.x;
      const y0 = D.y0;
      if (ts < tr) {
        // the bead swells: 1px, then 2px, then stretches just before letting go
        const k = ts / tr;
        if (k < 0.18) continue;
        const lv = lvOf(lum(x, y0));
        if (k < 0.55) g.rect(x, y0, 1, 1, D1[k < 0.35 ? 0 : 1][lv]);
        else if (k < 0.92) {
          g.rect(x, y0, 1, 1, D1[1][lv]);
          g.rect(x, y0 + 1, 1, 1, D1[2][lv]);
        } else {
          g.rect(x, y0, 1, 1, D1[0][lv]);
          g.rect(x, y0 + 1, 1, 1, D1[1][lv]);
          g.rect(x, y0 + 2, 1, 1, D1[2][lv]);
        }
        continue;
      }
      const tf = ts - tr;
      if (tf < D.td) {
        const yh = Math.round(y0 + 1 + 0.5 * GRAV * tf * tf);
        const len = 2 + Math.min(2, Math.floor((GRAV * tf) / 110));
        const lvf = lvOf(lum(x, yh));
        g.rect(x, yh - len + 1, 1, len - 1, D1[1][lvf]);
        g.rect(x, yh, 1, 1, D1[2][lvf]);
        continue;
      }
      const f = Math.floor((tf - D.td) / SPL_F);
      if (f >= 3) continue;
      const lv = lvOf(lum(x, D.land));
      if (D.pud) {
        if (f === 0) g.rect(x, D.land, 1, 1, C.RIP[2][lv]);
        else ering(g, D.pud, x, D.land, f + 1, C.RIP[f === 1 ? 1 : 0][lv]);
      } else crown(g, x, D.land, D.size, f, C.SPL, lv);
    }
  }

  function drawNear(g, t) {
    const N = C.NEAR;
    const PP = NEARP();
    for (let i = 0; i < NEAR_N; i++) {
      const c = T.cycle(t, i, PP[i], 6607);
      const age = c.age;
      if (c.rnd(7) > dens(t - age * c.P) * RK) continue;
      const len = SOFT ? 5 + Math.floor(c.rnd(2) * 5) : 8 + Math.floor(c.rnd(2) * 7);
      const ax = c.rnd(0) * (W + 80) - 70;
      const r3 = c.rnd(3);
      const yh = Math.round(-18 + (H + 34) * age);
      const ym = yh - (len >> 1);
      const xm = ax + S * ym;
      const lv = lvOf(lum(xm, ym));
      let b = i < 4 ? 2 - SOFT : r3 < 0.4 ? 0 : 1;
      if (b > 0 && inTitle(xm, ym)) b--;
      streak(g, ax, yh - len + 1, yh, N[b][lv]);
      if (i < 4 && !SOFT) streak(g, ax + 1, yh - len + 3, yh - 1, N[0][lv]);
    }
  }

  // ------------------------------------------------------------------
  // colour batching: every particle takes its own colour from the light
  // where it is, so drawn one by one nearly every pixel would switch the
  // fill colour (a CSS parse each time). Particles queue their pixels per
  // colour and each colour is flushed once, as the same integer g.rect calls
  // (deterministic: colours flush in first-use order).
  // ------------------------------------------------------------------
  const QK = [];
  const QM = new Map();
  const Q = {
    rect(x, y, w, h, c) {
      let a = QM.get(c);
      if (!a) {
        a = [];
        QM.set(c, a);
      }
      if (!a.length) QK.push(c);
      a.push(x, y, w, h);
    },
  };
  function flushQ(g) {
    for (let k = 0; k < QK.length; k++) {
      const c = QK[k];
      const a = QM.get(c);
      for (let i = 0; i < a.length; i += 4) g.rect(a[i], a[i + 1], a[i + 2], a[i + 3], c);
      a.length = 0;
    }
    QK.length = 0;
  }
  SEA.Q = Q;
  SEA.flushQ = flushQ;

  // seasonal layers (weather-seasons.js fills these hooks; read at draw time)
  const hook = (k) => (g, t) => {
    const f = SEA[k];
    if (f) f(g, t);
  };

  HD.module('weather', {
    lights(t, L) {
      if (SEA.lights) SEA.lights(t, L);
    },
    passes: [
      {
        layer: 'bg',
        z: 22,
        id: 'far-rain',
        draw(g, t) {
          if (!rainOn(t)) return;
          drawFar(Q, t);
          flushQ(g);
        },
      },
      { layer: 'bg', z: 23, id: 'far-season', draw: hook('far') },
      {
        layer: 'fx',
        z: 26,
        id: 'ripples',
        draw(g, t) {
          if (!rainOn(t)) return;
          drawRipples(Q, t, anchors());
          flushQ(g);
        },
      },
      {
        layer: 'fx',
        z: 27,
        id: 'splashes',
        draw(g, t) {
          if (!rainOn(t)) return;
          const A = anchors();
          drawGroundSplashes(Q, t, A);
          drawSurfaceSplashes(Q, t, A);
          flushQ(g);
        },
      },
      {
        layer: 'fx',
        z: 42,
        id: 'mid-rain',
        draw(g, t) {
          if (!rainOn(t)) return;
          const A = anchors();
          drawMid(Q, t, A);
          drawDrips(Q, t, A);
          flushQ(g);
        },
      },
      { layer: 'fx', z: 43, id: 'mid-season', draw: hook('mid') },
      {
        layer: 'fx',
        z: 66,
        id: 'near-rain',
        draw(g, t) {
          if (!rainOn(t)) return;
          drawNear(Q, t);
          flushQ(g);
        },
      },
      { layer: 'fx', z: 67, id: 'near-season', draw: hook('near') },
    ],
  });
})();
