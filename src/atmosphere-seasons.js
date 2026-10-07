/*
 * Atmosphere recipes (Purrfect Year v2): which smoke, steam, mist and haze
 * each entry gets, where, and in which colours. atmosphere.js asks
 * HD.atmoSeasons.build(edition) once per edition and draws the result:
 *
 *   back    [{y0, y1, veil, bands, alpha}]  haze behind the scene (fx z 50)
 *   low     [band]                          ground mist, rain spray (fx z 52)
 *   plumes  [{style, emitters}]             fire pit smoke, vent steam,
 *                                           manhole steam (fx z 54)
 *   shafts  {layers, lit, motes, ...}       golden sun shafts (fx z 58)
 *   shimmerFar / shimmerRoad                heat shimmer (bhills)
 *   front   [band]                          near mist (fx z 62)
 *   vignette                                night and dusk edge (fx z 69)
 *
 * By light mode: night gets a faint cool horizon haze that sets the far city
 * back, cold winter nights add rooftop vent steam, rain nights a rain veil
 * and street spray, dusk a cool low mist, golden hour a warm dusty haze with
 * sun shafts, day a pale aerial haze (a warm smoggy one with heat shimmer in
 * bhills, a marine haze and sea mist at the marina).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const T = HD.time;
  const W = HD.W;
  const sm = HD.smoothstep;
  const mix = HD.color.mix;
  const A = () => HD.atmo;

  // ---------------------------------------------------------------------
  // haze behind the scene
  // ---------------------------------------------------------------------
  /**
   * The sky's own colour behind (x, y) (sky.js bakes it per entry), sampled
   * on a coarse grid and interpolated across x: aerial haze takes the colour
   * of the sky it sits in, so the far city fades into it. Fallback: a flat
   * colour when the sky module is missing.
   */
  function skySampler(y0, y1, fallback) {
    const hexc = HD.color.hex;
    const xs = [0, 60, 120, 180, 240, 300, 360, 420, 479];
    const h = y1 - y0;
    const grid = new Float32Array(h * xs.length * 3);
    const fb = hexc(fallback || '#203050');
    for (let y = 0; y < h; y++)
      for (let k = 0; k < xs.length; k++) {
        const c = HD.sky && HD.sky.at ? hexc(HD.sky.at(xs[k], y + y0)) : fb;
        const q = (y * xs.length + k) * 3;
        grid[q] = c[0];
        grid[q + 1] = c[1];
        grid[q + 2] = c[2];
      }
    const out = [0, 0, 0];
    return (x, y) => {
      const yy = Math.max(0, Math.min(h - 1, y - y0));
      const u = Math.max(0, Math.min(xs.length - 1.001, x / 60));
      const k = Math.floor(u);
      const f = u - k;
      const q0 = (yy * xs.length + k) * 3;
      const q1 = q0 + 3;
      out[0] = grid[q0] + (grid[q1] - grid[q0]) * f;
      out[1] = grid[q0 + 1] + (grid[q1 + 1] - grid[q0 + 1]) * f;
      out[2] = grid[q0 + 2] + (grid[q1 + 2] - grid[q0 + 2]) * f;
      return out;
    };
  }
  const word = (r, g, b) => ((255 << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;

  /**
   * Static horizon veil between y0 and y1: alpha rises from 0 at `top` to
   * `amax` at `peak` (and holds to y1), broken up along x by a soft periodic
   * modulation. Its colour is the sky's own colour there, mixed towards
   * `tint` by `tintK` (a cool mist, a warm dust). An optional `glow`
   * {x, y, r, ry, k, col} brightens it around a point (the low sun).
   */
  function horizon(o) {
    const at = A();
    const mod = at.pnoise(W, o.seed || 11, [[1, 1], [2, 0.7], [5, 0.4], [9, 0.2]]);
    const sky = skySampler(o.y0, o.y1, o.tint);
    const tint = HD.color.hex(o.tint || '#808080');
    const tk = o.tintK || 0;
    const G = o.glow;
    const gc = G ? HD.color.hex(G.col) : null;
    const md = o.mod === undefined ? 0.35 : o.mod;
    const gd = (x, y) => Math.hypot((x - G.x) / G.r, (y - G.y) / (G.ry || G.r));
    const veil = at.bakeVeil(
      0,
      o.y0,
      W,
      o.y1 - o.y0,
      (x, y) => {
        let a = o.amax * sm(o.top, o.peak, y) * (1 - md + md * mod[x]);
        if (G) {
          const d = gd(x, y);
          a += G.k * Math.exp(-d * d * 1.6);
        }
        return a;
      },
      (x, y, a, b) => {
        const c = sky(x, y);
        let r = c[0] + (tint[0] - c[0]) * tk;
        let g = c[1] + (tint[1] - c[1]) * tk;
        let bl = c[2] + (tint[2] - c[2]) * tk;
        if (G) {
          // the glow mixes towards its colour in two dithered steps
          const d = gd(x, y);
          const k = d < 0.55 + (b - 0.5) * 0.25 ? 0.7 : d < 1 + (b - 0.5) * 0.3 ? 0.35 : 0;
          r += (gc[0] - r) * k;
          g += (gc[1] - g) * k;
          bl += (gc[2] - bl) * k;
        }
        return word(r, g, bl);
      },
    );
    return { y0: o.y0, y1: o.y1, veil, alpha: 1 };
  }

  /** drifting banks of haze along a horizon line (tonal, scrolled) */
  function banks(o) {
    const at = A();
    const tw = o.tw || 240;
    const yc = at.pnoise(tw, o.seed, [[1, 1], [3, 0.6], [5, 0.3]]);
    const th = at.pnoise(tw, o.seed + 1, [[2, 1], [4, 0.6], [7, 0.3]]);
    const am = at.pnoise(tw, o.seed + 2, [[1, 0.7], [2, 1], [5, 0.5], [9, 0.25]]);
    return at.band({
      tw,
      y0: o.y0,
      h: o.h,
      k: o.k || 1,
      sub: o.sub,
      tonal: true,
      cols: o.cols,
      core: o.core === undefined ? 0.55 : o.core,
      alpha: o.alpha,
      dens: (x, y) => {
        const c = o.c + (yc[x] - 0.5) * (o.wob || 6);
        const s = (y < c ? o.up : o.down) + th[x] * (o.thick || 3);
        const q = (y - c) / s;
        return o.gain * Math.exp(-q * q) * (o.floor + (1 - o.floor) * sm(0.2, 0.85, am[x]));
      },
    });
  }

  /**
   * rain or snow curtains: slanted streaky density drifting downwind over
   * the far city (tonal, a whole tile per loop)
   */
  function curtains(o) {
    const at = A();
    const tw = 480;
    const n1 = at.pnoise(tw, o.seed, [[3, 1], [7, 0.7], [13, 0.5], [23, 0.3]]);
    const n2 = at.pnoise(tw, o.seed + 3, [[2, 1], [5, 0.6]]);
    return at.band({
      tw,
      y0: o.y0,
      h: o.h,
      k: o.k || 2,
      tonal: true,
      cols: o.cols,
      core: 0.6,
      alpha: o.alpha,
      dens: (x, y) => {
        // slanted with the wind: the pattern shifts right as it falls
        const xs = (((x - Math.round((y - o.y0) * o.slant)) % tw) + tw) % tw;
        const v = sm(0.35, 0.9, n1[xs]) * (0.5 + 0.5 * n2[xs]);
        return o.gain * v * sm(0, o.h * 0.5, y - o.y0 + 4) * (1 - sm(o.h * 0.75, o.h, y - o.y0));
      },
    });
  }

  // ---------------------------------------------------------------------
  // firework smoke: every burst of the fire module's show (HD._fireworks)
  // leaves a soft cloud where it went off. It forms as the stars fade,
  // swells, drifts downwind and thins out within ~10 s, so the sky carries a
  // faint drifting haze after a flurry and clears in the lulls. A burst
  // flashing nearby lights the lingering smoke in its own colour.
  // ---------------------------------------------------------------------
  const FW_SMOKE = ['#151934', '#1b203e', '#232948', '#2c3254', '#363c60'];
  function burstSmoke(o) {
    const at = A();
    const LF = HD.LIGHT.firework;
    const LV = [0, 0.3, 0.6, 1];
    const cols = o.cols || FW_SMOKE;
    const ramps = new Map();
    const rampFor = (col) => {
      let r = ramps.get(col);
      if (!r) {
        const c = LF[col] || LF.white;
        r = cols.map((h) => at.litSet(h, LV, c));
        ramps.set(col, r);
      }
      return r;
    };
    const base = rampFor('white');
    // the underside catches the city glow: lit rim below
    const style = { th: 0.5, rim: 0.45, bands: [2.2], ages: [0.6], lx: 0, ly: 1, rimK: 0.75, ramp: base, rampNow: base };
    const flashes = []; // x, y, r^2, strength, ramp per flashing burst
    style.litAt = (x, y) => {
      let best = 0;
      let br = base;
      for (let k = 0; k < flashes.length; k += 5) {
        const dx = x - flashes[k];
        const dy = y - flashes[k + 1];
        const q = 1 - (dx * dx + dy * dy) / flashes[k + 2];
        if (q <= 0) continue;
        const v = q * flashes[k + 3];
        if (v > best) {
          best = v;
          br = flashes[k + 4];
        }
      }
      style.rampNow = br;
      return best < 0.1 ? 0 : best < 0.3 ? 1 : best < 0.6 ? 2 : 3;
    };
    const LIFE = o.life || 10;
    const WIND = o.wind || 1.3;
    const SINK = o.sink || 0.35;
    const TAU2 = Math.PI * 2;
    return {
      y0: 0,
      y1: 206,
      alpha: o.alpha === undefined ? 1 : o.alpha,
      draw(gb, t) {
        const fw = HD._fireworks;
        const s = fw && fw.show ? fw.show() : null;
        if (!s || !s.list || !s.list.length) return;
        const L = HD.LOOP;
        flashes.length = 0;
        for (let i = 0; i < s.list.length; i++) {
          const sh = s.list[i];
          // seconds since this shell burst (wrapped, so the show loops)
          let d = t - (sh.t0 + sh.rise);
          d -= L * Math.floor(d / L);
          const far = !!sh.far;
          if (d < 2.4) {
            const f = (d < 0.1 ? d / 0.1 : Math.exp(-(d - 0.1) / 0.7)) * (far ? 0.5 : 1);
            if (f > 0.05) flashes.push(sh.bx, sh.by, sh.R * sh.R * 6.5, f, rampFor(sh.col));
          }
          const life = far ? LIFE * 0.7 : LIFE;
          const a = d / life;
          if (a >= 1) continue;
          const K = far ? 3 : 5;
          const wk = (far ? 0.6 : 0.95) * sm(0, 0.16, a) * Math.pow(1 - a, 1.4);
          if (wk <= 0.02) continue;
          for (let k = 0; k < K; k++) {
            const h1 = HD.hash(sh.seed, k, 71);
            const h2 = HD.hash(sh.seed, k, 72);
            const h3 = HD.hash(sh.seed, k, 73);
            const ang = TAU2 * (k / K + 0.3 * h1);
            const dist = sh.R * (0.22 + 0.3 * h2);
            const px = sh.bx + Math.cos(ang) * dist + WIND * d;
            const py = sh.by + Math.sin(ang) * dist * 0.7 + SINK * d + sh.R * 0.12;
            const R = sh.R * (0.42 + 0.38 * Math.sqrt(a)) * (0.8 + 0.4 * h3);
            const w = wk * at.keepTitle(px, py, R * 0.5);
            if (w > 0.02) at.splat(px, py, R, w, a);
          }
        }
        at.resolveField(style);
        at.srFlush(gb);
      },
    };
  }

  // ---------------------------------------------------------------------
  // low mist bands (fx z 52), warm-lit near lamps
  // ---------------------------------------------------------------------
  function ground(o) {
    const at = A();
    const tw = o.tw || 480;
    const yc = at.pnoise(tw, o.seed, [[2, 1], [5, 0.6], [11, 0.3]]);
    const am = at.pnoise(tw, o.seed + 2, [[1, 0.6], [3, 1], [7, 0.6], [13, 0.3]]);
    const lo = o.lo === undefined ? 0.25 : o.lo;
    const hi = o.hi === undefined ? 0.85 : o.hi;
    return at.band({
      tw,
      y0: o.y0,
      h: o.h,
      k: o.k || 1,
      sub: o.sub === undefined ? 0.71 : o.sub,
      ly: o.ly,
      lb: o.lb,
      lit: o.lit !== false,
      tonal: o.tonal !== false,
      levels: o.levels,
      cols: o.cols,
      core: o.core === undefined ? 0.45 : o.core,
      alpha: o.alpha,
      holes: o.holes,
      dens: (x, y) => {
        // o.c is the screen y of the mist's densest line
        const c = o.c - o.y0 + (yc[x] - 0.5) * (o.wob === undefined ? 4 : o.wob);
        const q = (y - c) / (y < c ? o.up : o.down);
        return o.gain * Math.exp(-q * q) * ((o.floor || 0) + (1 - (o.floor || 0)) * sm(lo, hi, am[x]));
      },
    });
  }

  // ---------------------------------------------------------------------
  // plume styles
  // ---------------------------------------------------------------------
  /** fire pit smoke: a thin wavering thread from the flame tips that widens, curls and thins out */
  function pitSmoke(cols, o) {
    return Object.assign(
      {
        n: 46,
        life: 10,
        rise: 66,
        riseR: 12,
        riseP: 1.2,
        wind: 2.4,
        driftP: 1.7,
        gust: 12,
        gustP: 13,
        curl: 3,
        curlF: 1.3,
        curlA: 0.7,
        curlR: 0.25,
        jit: 3,
        rad0: 1.5,
        radK: 7,
        radP: 0.9,
        radJ: 0.5,
        fadeIn: 0.02,
        fadeP: 1.4,
        th: 0.5,
        rim: 0.45,
        bands: [2.4],
        ages: [0.5, 0.75],
        lx: 1,
        ly: -1,
        rimK: 0.7,
        cap: { dx: 0.35, dy: -0.3, r: 0.6, hi: 0.34, lo: 0.06 },
        ramp: rampOf(cols),
        lb: 1,
      },
      o,
    );
  }

  /** lit sets of a dark -> light ramp (field plumes) */
  const rampOf = (cols, levels, light) => cols.map((c) => A().litSet(c, levels, light));

  /** rooftop vent steam: dense billows that bend downwind and break up fast */
  function ventSteam(cols, o) {
    return Object.assign(
      {
        n: 18,
        life: 8,
        rise: 40,
        riseR: 10,
        riseP: 1.8,
        wind: 3.8,
        driftP: 1.9,
        gust: 9,
        gustP: 11,
        curl: 1.6,
        curlF: 1.1,
        jit: 8,
        rad0: 3,
        radK: 9.5,
        radP: 0.6,
        radJ: 0.75,
        fadeIn: 0.06,
        fadeP: 1.1,
        pulse: 0.2,
        pulseP: 6,
        wK: 1,
        th: 0.55,
        rim: 0.4,
        bands: [2.2],
        ages: [0.45, 0.7],
        lx: -1,
        ly: -1,
        rimK: 0.7,
        cap: { dx: -0.3, dy: -0.4, r: 0.6, hi: 0.34, lo: 0.06 },
        ramp: rampOf(cols),
        clip: true,
      },
      o,
    );
  }

  /** manhole steam: a soft column breathing out of the cover, drifting off */
  function manholeSteam(cols, o) {
    return Object.assign(
      {
        n: 22,
        life: 7,
        rise: 44,
        riseR: 10,
        riseP: 1.35,
        wind: 1.6,
        driftP: 1.7,
        gust: 8,
        gustP: 9,
        curl: 2.4,
        curlF: 1.4,
        curlA: 0.8,
        jit: 5,
        rad0: 3,
        radK: 7,
        radP: 0.75,
        radJ: 0.6,
        fadeIn: 0.08,
        fadeP: 1.3,
        pulse: 0.5,
        pulseP: 5,
        th: 0.5,
        rim: 0.45,
        bands: [2.2],
        ages: [0.42, 0.7],
        lx: 0,
        ly: -1,
        rimK: 0.7,
        cap: { dx: -0.1, dy: -0.4, r: 0.6, hi: 0.34, lo: 0.06 },
        ramp: rampOf(cols),
        lb: 1.4,
      },
      o,
    );
  }

  // ---------------------------------------------------------------------
  // colours
  // ---------------------------------------------------------------------
  // steam on a cold night: moonlit tops, a slate body, a dusky underside,
  // fading towards the sky as it thins
  const STEAM_NIGHT = ['#343c5c', '#4a5474', '#646e8c', '#828ca8', '#a2abc2', '#bec5d6'];
  // under a snowy overcast (a light lilac sky): steam reads lighter than the sky
  const STEAM_SNOW = ['#7a789c', '#8a88aa', '#9c9cbc', '#b2b2cc', '#c8c8da', '#dcdce8'];
  // manhole steam on a warm summer night (a touch warmer, lit by the shops)
  const STEAM_SOHO = ['#3a405e', '#545a7a', '#767c98', '#9ca0ba', '#c2c4d6'];
  // fire pit smoke at golden hour: mauve-grey, sunlit cream on the sun side
  const SMOKE_GOLDEN = ['#76687a', '#8a7c88', '#a29298', '#bea9a6', '#e6c6a4'];
  // fire pit smoke at dusk: lilac-grey with a rose highlight
  const SMOKE_DUSK = ['#4a4664', '#5a5476', '#706a8a', '#887e9e', '#ac9cb6'];

  // ---------------------------------------------------------------------
  // building blocks per place
  // ---------------------------------------------------------------------
  /** rooftop vents per place: x on the roof (y read from the skyline), size, strength */
  const VENTS = {
    apt1: [
      { x: 190, size: 1, k: 1, seed: 501 },
      { x: 236, size: 0.85, k: 0.9, seed: 507 },
      { x: 312, size: 0.8, k: 0.85, seed: 513 },
      { x: 54, size: 0.7, k: 0.75, seed: 519 },
    ],
    apt2: [
      { x: 196, size: 1, k: 1, seed: 501 },
      { x: 268, size: 0.85, k: 0.9, seed: 507 },
      { x: 322, size: 0.8, k: 0.85, seed: 513 },
    ],
  };

  /** where the fire pit flames end (the fire module draws the pit itself) */
  function pitEmitter(pl, seed) {
    const fp = pl.firepit;
    // the fire module publishes its nominal flame tip (HD.firepitTop)
    const top = (HD.firepitTop && HD.firepitTop()) || fp.base - 19;
    return { x: fp.x, y: top - 1, seed: seed || 433, w: 2 };
  }

  /** the soho manhole (street draws the cover; the brief puts the steam at x 318-332) */
  const MANHOLE = { x: 325, y: 251 };

  function nightVignette(k) {
    return A().bakeVignette('#04050b', k);
  }

  // ---------------------------------------------------------------------
  // recipes by light mode and weather
  // ---------------------------------------------------------------------
  /** the far city fades into the night sky's horizon glow */
  function nightHaze(o) {
    return horizon(Object.assign({ y0: 96, y1: 210, top: 110, peak: 204, amax: 0.34, seed: 21, tint: '#2a3060', tintK: 0.15 }, o));
  }

  /** lightning: the rain-hazed far city lights up with the sky's flash */
  function flashVeil() {
    const at = A();
    const col = at.rgba32('#a8a6d8');
    const veil = at.bakeVeil(0, 40, W, 170, (x, y) => 0.5 * sm(50, 190, y), () => col);
    return {
      y0: 40,
      y1: 210,
      veil,
      op: 'lighter',
      alpha: (t) => (HD.sky && HD.sky.flash ? 0.6 * HD.sky.flash(t) : 0),
    };
  }

  function rainRecipe(ed, pl) {
    const R = {};
    R.back = [
      // rain hides the far city: a veil of the overcast's own colour, deeper
      // towards the horizon, and slanted curtains drifting downwind
      horizon({ y0: 40, y1: 210, top: 50, peak: 196, amax: 0.5, seed: 31, mod: 0.25, tint: '#3a4466', tintK: 0.25 }),
      { y0: 70, y1: 206, bands: [curtains({ y0: 70, h: 136, seed: 37, gain: 0.55, slant: 0.22, cols: ['#3e4668', '#4a5276'], alpha: 0.5, k: 3 })] },
    ];
    if (ed.weather.lightning > 0) R.back.push(flashVeil());
    // spray where the rain hits the sidewalk and the street
    R.low = [
      ground({ y0: 206, h: 22, c: 219, up: 2.5, down: 3.5, seed: 41, gain: 0.75, cols: ['#3a4560', '#48546e'], alpha: 0.42, ly: 214, k: 2 }),
      ground({ y0: 226, h: 30, c: 238, up: 3, down: 6, seed: 47, gain: 0.8, cols: ['#2e3852', '#3a4662'], alpha: 0.45, ly: 236, k: 3, sub: 0.2 }),
    ];
    R.front = [ground({ y0: 248, h: 22, c: 262, up: 3.5, down: 7, seed: 53, gain: 0.7, cols: ['#2a3450', '#36425e'], alpha: 0.32, ly: 258, k: 4, sub: 0.4, lo: 0.4 })];
    R.vignette = nightVignette(0.5);
    return R;
  }

  function winterNight(ed, pl) {
    const R = {};
    const heavy = ed.weather.snow >= 0.6;
    R.back = [
      heavy
        ? // falling snow: the far city fades into the lit overcast
          horizon({ y0: 30, y1: 210, top: 40, peak: 196, amax: 0.52, seed: 61, mod: 0.25, tint: '#6a6890', tintK: 0.2 })
        : nightHaze({ seed: 61 }),
    ];
    if (heavy) R.back.push({ y0: 60, y1: 206, bands: [curtains({ y0: 60, h: 146, seed: 67, gain: 0.45, slant: 0.12, cols: ['#6c6a8e', '#7c7a9c'], alpha: 0.4, k: 2 })] });
    const vents = VENTS[pl.id];
    if (vents) R.plumes = [{ style: ventSteam(heavy ? STEAM_SNOW : STEAM_NIGHT), emitters: vents.map((v) => Object.assign({ roof: true }, v)) }];
    if (ed.fireworks > 0) R.back.push(burstSmoke({}));
    R.vignette = nightVignette(heavy ? 0.4 : 0.5);
    return R;
  }

  function clearNight(ed, pl) {
    const R = {};
    R.back = [nightHaze({ seed: ed.season === 'summer' ? 71 : 73 })];
    // a thin cool mist on the street, warmed under the lamps
    R.low = [ground({ y0: 224, h: 26, c: 236, up: 3, down: 6, seed: 77, gain: 0.6, cols: ['#222a48', '#2c3656'], alpha: 0.32, ly: 232, lo: 0.45, k: 1 })];
    if (pl.id === 'soho') R.plumes = [{ style: manholeSteam(STEAM_SOHO), emitters: [{ x: MANHOLE.x, y: MANHOLE.y, w: 9, seed: 611 }] }];
    if (ed.fireworks > 0 || ed.tagSet.has('goal-fireworks')) R.back.push(burstSmoke({}));
    R.vignette = nightVignette(0.5);
    return R;
  }

  function dusk(ed, pl) {
    const R = {};
    R.back = [
      // the far city melts into the glowing horizon...
      horizon({ y0: 110, y1: 210, top: 126, peak: 200, amax: 0.34, seed: 81, mod: 0.3 }),
      // ...while a cool mist settles low along its foot
      { y0: 170, y1: 210, bands: [banks({ y0: 172, h: 36, c: 26, up: 4, down: 4, seed: 83, gain: 0.7, floor: 0.2, cols: ['#7a6e9c', '#8a7eaa'], alpha: 0.5 })] },
    ];
    if (pl.id === 'herndon') {
      // mist on the lawn, kept off the birthday party; and over the street
      R.low = [
        ground({ y0: 204, h: 32, c: 222, up: 3.5, down: 5, seed: 87, gain: 0.85, cols: ['#4e4a74', '#5e5884'], alpha: 0.42, ly: 220, holes: [{ x: 112, y: 214, rx: 46, ry: 22 }] }),
        ground({ y0: 246, h: 24, c: 258, up: 3, down: 6, seed: 89, gain: 0.7, cols: ['#3e3c62', '#4a4870'], alpha: 0.34, ly: 256, lo: 0.4 }),
      ];
    } else {
      const holes = [];
      if (ed.fire === 'firepit' && pl.firepit) holes.push({ x: pl.firepit.x, y: pl.firepit.base - 6, rx: 22, ry: 14 });
      R.low = [
        ground({ y0: 206, h: 24, c: 220, up: 3, down: 4, seed: 91, gain: 0.7, cols: ['#4a4670', '#5a547e'], alpha: 0.36, ly: 216, holes }),
        ground({ y0: 228, h: 30, c: 242, up: 4, down: 7, seed: 93, gain: 0.75, cols: ['#3a3860', '#46446c'], alpha: 0.36, ly: 240, lo: 0.35 }),
      ];
    }
    if (ed.fire === 'firepit' && pl.firepit) R.plumes = [{ style: pitSmoke(SMOKE_DUSK, { lx: -1, cap: { dx: -0.35, dy: -0.3, r: 0.6, hi: 0.34, lo: 0.06 } }), emitters: [pitEmitter(pl)] }];
    R.vignette = nightVignette(0.3);
    return R;
  }

  function golden(ed, pl) {
    const R = {};
    const sun = (HD.sky && HD.sky.sun && HD.sky.sun()) || HD.LIGHTING.golden.sun;
    R.back = [
      // warm dusty haze: the far city glows into the gold, brightest round the sun
      horizon({
        y0: 60,
        y1: 210,
        top: 84,
        peak: 200,
        amax: 0.4,
        seed: 101,
        mod: 0.25,
        tint: '#f0b070',
        tintK: 0.2,
        glow: { x: sun.x, y: sun.y, r: 66, ry: 44, k: 0.3, col: '#ffe0a8' },
      }),
    ];
    // warm dust hanging over the street
    R.low = [ground({ y0: 196, h: 40, c: 214, up: 6, down: 8, seed: 107, gain: 0.55, lit: false, cols: ['#f4c48a', '#f8d4a0'], alpha: 0.22, lo: 0.3 })];
    const sh = A().bakeShafts({ sun, seed: 113, rays: 5, a0: Math.PI * 0.6, a1: Math.PI * 1.04, w: 0.06, near: 30, far: 210, alpha: 0.26, y0: 60, y1: 230, col: '#ffc47a' });
    R.shafts = {
      layers: sh.layers,
      lit: sh.lit,
      period: 48,
      base: 0.35,
      swing: 0.5,
      motes: { n: 34, life: 16, seed: 117, x0: 300, x1: 470, y0: 120, y1: 215, drift: -0.6, rise: 0.25, min: 0.05, cols: ['#ffd9a0', '#fff0c8'] },
    };
    if (ed.fire === 'firepit' && pl.firepit) R.plumes = [{ style: pitSmoke(SMOKE_GOLDEN), emitters: [pitEmitter(pl)] }];
    return R;
  }

  function day(ed, pl) {
    const R = {};
    if (pl.id === 'bhills') {
      // a warm smoggy haze over the hills and towers, and heat shimmer
      R.back = [horizon({ y0: 70, y1: 210, top: 90, peak: 196, amax: 0.4, seed: 121, mod: 0.3, tint: '#eadcc0', tintK: 0.35 })];
      // the far towers and hills seen above the shopfronts wobble in the heat
      R.shimmerFar = {
        y0: 126,
        y1: 178,
        onlyBack: true,
        period: 3.2,
        waves: 1,
        freq: 0.19,
        seg: 6,
        amp: 1.2,
        rise: 24,
        seed: 901,
        env: (y) => sm(126, 156, y),
      };
      const fam = pl.stages && pl.stages.family;
      // and the far lane of the hot road
      R.shimmerRoad = {
        y0: 229,
        y1: 247,
        period: 2.6,
        waves: 1,
        freq: 0.23,
        seg: 5,
        amp: 1.2,
        rise: 18,
        seed: 941,
        env: (y) => 1 - sm(236, 247, y),
        // never over the family (stages.family) or its shadow
        keep: (x, y) => (fam && x > fam.x0 - 10 && x < fam.x1 + 10 && y < fam.base + 3 ? 0 : 1),
      };
      return R;
    }
    if (pl.id === 'marina') {
      // marine haze: the far bay, the bridge and the hills sit in a pale sea veil
      R.back = [
        horizon({ y0: 60, y1: 210, top: 76, peak: 190, amax: 0.45, seed: 131, mod: 0.2, tint: '#eef4f8', tintK: 0.3 }),
        { y0: 160, y1: 210, bands: [banks({ y0: 162, h: 44, c: 30, up: 6, down: 5, seed: 137, gain: 0.75, floor: 0.3, cols: ['#e4ecf2', '#f2f6f8'], alpha: 0.45, k: 1 })] },
      ];
      // low sea mist drifting over the marina water
      R.low = [
        ground({ y0: 230, h: 22, c: 240, up: 3, down: 4, seed: 141, gain: 0.7, lit: false, cols: ['#e8f0f6', '#f6f9fb'], alpha: 0.32, k: 2, lo: 0.35 }),
        ground({ y0: 250, h: 20, c: 262, up: 3, down: 5, seed: 147, gain: 0.6, lit: false, cols: ['#e0eaf2', '#f0f5f8'], alpha: 0.22, k: 3, lo: 0.45, sub: 0.3 }),
      ];
      return R;
    }
    // a pale aerial haze: the far city recedes, the block stands out
    R.back = [horizon({ y0: 70, y1: 210, top: 96, peak: 200, amax: 0.3, seed: 151, mod: 0.3, tint: '#dce8f4', tintK: 0.2 })];
    return R;
  }

  HD.atmoSeasons = {
    build(ed) {
      const pl = HD.PLACES[ed.place] || HD.place();
      const w = ed.weather || {};
      switch (ed.light) {
        case 'day':
          return day(ed, pl);
        case 'golden':
          return golden(ed, pl);
        case 'dusk':
          return dusk(ed, pl);
        default:
          if (w.rain > 0) return rainRecipe(ed, pl);
          if (ed.season === 'winter') return winterNight(ed, pl);
          return clearNight(ed, pl);
      }
    },
  };
})();
