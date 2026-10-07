/*
 * street (Purrfect Year v2): the street-level stage at every place.
 *
 * Everything in front of the facades and below them: sidewalks and plazas,
 * the curb, the road (or the marina water, or the Virginia lawn), street
 * lamps, street trees by season, benches, hydrants, bollards, bike racks,
 * the picket fence, snow cover, fallen leaves, the wet sheen of rain,
 * daylight cast shadows (L.shade) and a generic car passing now and then.
 *
 * Colour model: every surface is painted by its daylight colour (albedo)
 * and converted to its night colour (albedo x ambient). The engine's
 * daylight fill reveals the albedo by day, and lamps reveal it warm at night.
 * Only things that give light (lamp glass, headlights, sun glitter on the
 * water, snow crystals catching a lamp) are emissive.
 *
 * Passes (scene unless noted):
 *   z 15     ground: baked per edition (sidewalk, curb, road / water / lawn)
 *            plus small animated bits (snow glints, a skittering leaf)
 *   z 23     the passing car
 *   z 34.9   street furniture that stands in front of the facades (trees,
 *            lamps, benches, hydrants, the fence): it must cover the
 *            buildings (z 25..34), so it runs right after them
 *   z 34.95  marina only: the water mirrors the podium and towers, then
 *            waves and sun glitter (before the moored boats at z 35+)
 *   fx 21    rain only: broken warm reflections of the lit shopfronts,
 *            lamps and headlights on the wet road
 *
 * Registered for other modules: HD.street = { lampsLit(), lamps(), car(t) }
 * and place.manhole for soho (where a steam vent belongs).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const CO = HD.color;
  const AMB = HD.AMBIENT;
  const W = HD.W;
  const H = HD.H;
  const R = Math.round;
  const hash = HD.hash;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------
  // colour helpers
  // ------------------------------------------------------------------
  /** albedo -> night colour, with an exposure lift for the light mode */
  function makePaint(lift) {
    const cache = new Map();
    return function (hex, k) {
      const kk = k === undefined ? 1 : k;
      const key = hex + '|' + kk;
      let v = cache.get(key);
      if (v === undefined) {
        const c = CO.hex(hex);
        const m = lift * kk;
        v = CO.css(c[0] * AMB[0] * m, c[1] * AMB[1] * m, c[2] * AMB[2] * m);
        cache.set(key, v);
      }
      return v;
    };
  }
  const mixA = CO.mix;
  function seedOf(s) {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h;
  }

  /** fast per-frame pseudo-random lookup in [0,1) (a fixed table, seeded once) */
  const RT = new Float32Array(4096);
  {
    const rng = HD.rng(90210);
    for (let i = 0; i < RT.length; i++) RT[i] = rng();
  }
  const fh = (a, b, c) => RT[(Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & 4095];

  /** smooth 2D value noise in [0,1] (bake time only) */
  function vnoise(x, y, sx, sy, seed) {
    const gx = x / sx;
    const gy = y / sy;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const u = gx - x0;
    const v = gy - y0;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = hash(seed, x0, y0, 0);
    const b = hash(seed, x0 + 1, y0, 0);
    const c = hash(seed, x0, y0 + 1, 0);
    const d = hash(seed, x0 + 1, y0 + 1, 0);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  }

  // emissive lamp glass and car lights (not relit: drawn as they glow)
  const GLOW = {
    lamp: ['#7a4a1c', '#e8a650', '#ffd28a', '#fff1cc'],
    head: '#fff6dc',
    headDim: '#e8d8a8',
    tail: '#ff4a3a',
    tailDim: '#b0281e',
  };
  const LAMP_LIGHT = [1.0, 0.7, 0.36];
  const LAMP_LIGHT_SOFT = [1.0, 0.78, 0.48];
  const HEAD_LIGHT = [1.0, 0.92, 0.72];

  // shared albedo palettes
  const A = {
    iron: ['#1c1d22', '#2a2c33', '#3c4049', '#585e6a'],
    bronze: ['#22201e', '#36322c', '#4c463c', '#686052'],
    green: ['#18241e', '#24362c', '#34503e', '#4a6c56'],
    pale: ['#7a7e84', '#9a9ea6', '#bcc0c6', '#dadde2'],
    steel: ['#5a5e66', '#7c828c', '#a4aab4', '#cfd4dc'],
    bark: ['#2a221e', '#41352e', '#5c4c42', '#7a685a'],
    wood: ['#4a3022', '#6a4630', '#8a6040', '#a87c56'],
    leafSummer: ['#1b361c', '#2a5226', '#3c7030', '#56903c', '#7aae4c'],
    leafDeep: ['#14281a', '#1f3e22', '#2d5a2c', '#427838', '#5e9446'],
    leafFicus: ['#122416', '#1c381e', '#294e28', '#3a6834', '#548440'],
    autumnOrange: ['#5e2412', '#9a3e1a', '#c8601e', '#e4922c', '#f4c04c'],
    autumnGold: ['#6a4612', '#a4701a', '#d09c26', '#e8c044', '#f8dc72'],
    autumnRed: ['#4e1612', '#86261a', '#b43c1e', '#d8622a', '#ee9440'],
    blossom: ['#7a3e58', '#b46a8a', '#dc98b2', '#f2c4d4', '#fde6ee'],
    blossomWhite: ['#8a7a86', '#c0b0bc', '#e2d6de', '#f4ecf0', '#ffffff'],
    palmFrond: ['#24401f', '#365c2a', '#4e7a36', '#6c9a44', '#90b858'],
    palmDry: ['#5a4630', '#7a6040', '#9a7c50'],
    palmTrunk: ['#5e5040', '#7c6c56', '#9a8a70', '#b4a68a'],
  };
  // snow at night uses the art lead's snow ramp directly (bright, cold)
  const SNOW_N = [P.snow[4], P.snow[5], P.snow[6], P.snow[7]];

  // ------------------------------------------------------------------
  // per-place layout of the street furniture (art space, base = feet y)
  // ------------------------------------------------------------------
  const CFG = {
    apt1: {
      lamps: [
        { x: 140, base: 224, kind: 'lantern' },
        { x: 310, base: 224, kind: 'lantern' },
        { x: 466, base: 224, kind: 'lantern' },
      ],
      trees: [
        { x: 338, base: 216, kind: 'street', seed: 11 },
        { x: 420, base: 216, kind: 'street', seed: 23 },
      ],
      benches: [{ x0: 368, x1: 386, seat: 214, base: 219, kind: 'plaza' }],
      hydrants: [{ x: 58, base: 223, kind: 'boston' }],
      racks: [{ x: 262, base: 222, n: 3 }],
      bollards: [{ x: 326, base: 224 }, { x: 446, base: 224 }],
      bins: [],
      cars: { n: 5, shift: 0 },
    },
    apt2: {
      lamps: [
        { x: 128, base: 224, kind: 'arm' },
        { x: 244, base: 224, kind: 'arm' },
        { x: 352, base: 224, kind: 'arm' },
      ],
      trees: [
        { x: 26, base: 209, kind: 'street', seed: 31 },
        { x: 452, base: 216, kind: 'street', seed: 37 },
      ],
      benches: [{ x0: 46, x1: 64, seat: 214, base: 219, kind: 'plaza' }],
      hydrants: [{ x: 376, base: 223, kind: 'boston' }],
      racks: [{ x: 406, base: 222, n: 3 }],
      bollards: [{ x: 132, base: 224 }],
      bins: [],
      cars: { n: 5, shift: 23 },
    },
    soho: {
      lamps: [
        { x: 148, base: 224, kind: 'crook', dir: -1 },
        { x: 288, base: 224, kind: 'crook', dir: -1 },
      ],
      trees: [{ x: 462, base: 216, kind: 'locust', seed: 41 }],
      benches: [{ x0: 244, x1: 274, seat: 214, base: 219, kind: 'park' }],
      hydrants: [{ x: 314, base: 223, kind: 'nyc' }],
      racks: [],
      bollards: [],
      bins: [{ x: 186, base: 223 }],
      cars: { n: 5, shift: 47, taxi: true },
    },
    bhills: {
      lamps: [
        { x: 104, base: 224, kind: 'la' },
        { x: 432, base: 224, kind: 'la' },
      ],
      trees: [
        { x: 76, base: 220, kind: 'ficus', seed: 51 },
        { x: 388, base: 220, kind: 'ficus', seed: 53 },
        { x: 16, base: 221, kind: 'palm', seed: 61, h: 152, lean: 3 },
        { x: 138, base: 221, kind: 'palm', seed: 62, h: 140, lean: -2 },
        { x: 334, base: 221, kind: 'palm', seed: 63, h: 146, lean: 2 },
        { x: 410, base: 221, kind: 'palm', seed: 64, h: 134, lean: -3 },
        { x: 470, base: 221, kind: 'palm', seed: 65, h: 156, lean: 2 },
      ],
      benches: [],
      hydrants: [{ x: 352, base: 223, kind: 'la' }],
      racks: [],
      bollards: [],
      bins: [],
      cars: { n: 7, shift: 11 },
    },
    marina: {
      lamps: [
        { x: 108, base: 223, kind: 'harbor', banner: true },
        { x: 368, base: 223, kind: 'harbor' },
      ],
      trees: [
        { x: 30, base: 219, kind: 'palm', seed: 71, h: 118, lean: 3 },
        { x: 452, base: 219, kind: 'palm', seed: 72, h: 128, lean: -2 },
      ],
      benches: [],
      hydrants: [],
      racks: [],
      bollards: [],
      moor: [16, 60, 98, 138, 330, 376, 420, 462],
      bins: [],
      cars: null,
    },
    herndon: {
      lamps: [{ x: 451, base: 246, kind: 'post' }],
      trees: [
        { x: 412, base: 228, kind: 'oak', seed: 81 },
        { x: 28, base: 228, kind: 'dogwood', seed: 83 },
      ],
      benches: [],
      hydrants: [],
      racks: [],
      bollards: [],
      bins: [],
      cars: { n: 1, shift: 0, rare: true },
    },
  };

  // ------------------------------------------------------------------
  // edition context
  // ------------------------------------------------------------------
  function contextOf(ed) {
    const pl = HD.PLACES[ed.place] || HD.PLACES.apt1;
    const lt = HD.LIGHTING[ed.light] || HD.LIGHTING.night;
    const w = ed.weather || {};
    const mode = lt.mode;
    const lift = mode === 'night' ? 1.22 : mode === 'dusk' ? 1.08 : 1.0;
    return {
      ed,
      pl,
      cfg: CFG[pl.id],
      lt,
      mode,
      lit: mode === 'night' || mode === 'dusk',
      season: ed.season || 'autumn',
      snow: w.snow || 0,
      leaves: w.leaves || 0,
      rain: w.rain || 0,
      wet: (w.rain || 0) > 0,
      halloween: !!(ed.tagSet && ed.tagSet.has('trick-or-treat')),
      lift,
      c: makePaint(lift),
      seed: seedOf(pl.id),
    };
  }

  // ------------------------------------------------------------------
  // generic ground painters (draw into a bake with night colours)
  // ------------------------------------------------------------------
  /**
   * A band of pavers in rows that grow towards the viewer (a little
   * perspective). o: {x0, x1, y0, rows:[h], w0, w1, tones:[albedo], joint,
   * bond, stagger, seed, hi, lo, wetK}
   */
  function paverBand(g, c, o) {
    const n = o.rows.length;
    const k = o.wetK || 1;
    // the receding joints fan out a little towards the viewer (one-point
    // perspective around the middle of the frame) so the band reads as a floor
    const cx = o.cx === undefined ? 240 : o.cx;
    const persp = o.persp === undefined ? 0.006 : o.persp;
    const hiK = o.hiK || 1.1;
    let y = o.y0;
    for (let r = 0; r < n; r++) {
      const rh = o.rows[r];
      const pw = o.w0 + (o.w1 - o.w0) * (n === 1 ? 0 : r / (n - 1));
      const s = 1 + persp * (y + rh * 0.5 - o.y0);
      const off = o.stagger ? hash(o.seed, r, 9, 1) * pw : (r % 2) * pw * (o.bond === undefined ? 0.5 : o.bond);
      if (!o.noRowJoint) g.rect(o.x0, y, o.x1 - o.x0 + 1, 1, c(o.joint, k));
      const ya = o.noRowJoint ? y : y + 1;
      const hh = y + rh - ya;
      let runStart = o.x0;
      let cell = Math.floor((cx + (o.x0 - cx) / s + off) / pw);
      const flush = (xa, xb, ci) => {
        if (xb < xa || hh < 1) return;
        const tone = o.tones[(hash(o.seed, r, ci, 3) * o.tones.length) | 0];
        const rk = k * (o.rowK ? o.rowK[r] : 1);
        g.rect(xa, ya, xb - xa + 1, hh, c(tone, rk * (o.toneK ? 1 + (hash(o.seed, r, ci, 4) - 0.5) * o.toneK : 1)));
        if ((o.hi || o.hiK) && hh >= 2) g.rect(xa, ya, xb - xa + 1, 1, c(tone, rk * hiK));
        if (o.lo && hh >= 3) g.rect(xa, y + rh - 1, xb - xa + 1, 1, c(tone, k * 0.92));
      };
      for (let x = o.x0 + 1; x <= o.x1 + 1; x++) {
        const ci = x > o.x1 ? cell + 1 : Math.floor((cx + (x - cx) / s + off) / pw);
        if (ci === cell) continue;
        flush(runStart, x - 1, cell);
        if (x <= o.x1) g.rect(x, ya, 1, hh, c(o.vjoint || o.joint, k));
        runStart = x + 1;
        cell = ci;
      }
      y += rh;
    }
    return y;
  }

  /** ordered speckle of one colour over a rect (texture) */
  function speckle(g, c, x0, y0, w, h, hex, density, seed, k) {
    if (density <= 0) return;
    const col = c(hex, k);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (hash(seed, x, y, 77) < density) g.px(x, y, col);
  }

  /** a road of asphalt with aggregate speckle, wheel-worn bands, cracks and patches */
  function asphalt(g, c, X, o) {
    const k = X.wet ? 0.62 : 1;
    const y0 = o.y0;
    const y1 = o.y1;
    g.rect(0, y0, W, y1 - y0 + 1, c(o.base, k));
    const rng = HD.rng(X.seed + 501);
    for (let i = 0; i < (o.patches || 0); i++) {
      const px = R(rng() * 440);
      const py = R(y0 + 3 + rng() * (y1 - y0 - 8));
      const pw = 14 + R(rng() * 26);
      const ph = 3 + R(rng() * 4);
      g.rect(px, py, pw, ph, c(o.patch, k));
      g.hline(px, px + pw - 1, py, c(o.base, k * 0.8));
    }
    // worn wheel paths: a touch darker and smoother
    for (const wy of o.wear || []) g.rect(0, wy, W, 2, c(o.base, k * 0.92));
    // aggregate: bigger, sparser towards the viewer
    for (let y = y0; y <= y1; y++) {
      const f = (y - y0) / (y1 - y0 + 1);
      const worn = (o.wear || []).some((wy) => y >= wy && y < wy + 2);
      for (let x = 0; x < W; x++) {
        const h = hash(X.seed, x, y, 13);
        if (h < (worn ? 0.02 : 0.05 + 0.03 * f)) g.px(x, y, c(o.lite, k));
        else if (h > 0.94 - 0.02 * f) g.px(x, y, c(o.dark, k));
      }
    }
    for (let i = 0; i < (o.cracks || 0); i++) {
      let x = R(rng() * W);
      let y = R(y0 + 2 + rng() * (y1 - y0 - 4));
      const len = 8 + R(rng() * 18);
      const dir = rng() < 0.5 ? -1 : 1;
      for (let s = 0; s < len; s++) {
        g.px(x, y, c(o.dark, k * 0.8));
        x += dir;
        if (rng() < 0.3) y += rng() < 0.5 ? -1 : 1;
        if (y < y0 + 1 || y > y1 - 1) break;
      }
    }
  }

  /** painted line with wear */
  function paint(g, c, X, x0, x1, y, h, hex, wear, seed) {
    const k = X.wet ? 0.7 : 1;
    const col = c(hex, k);
    const dim = c(hex, k * 0.72);
    for (let yy = y; yy < y + h; yy++)
      for (let x = x0; x <= x1; x++) {
        const v = hash(seed, x, yy, 5);
        if (v < wear) continue;
        g.px(x, yy, v < wear + 0.12 ? dim : col);
      }
  }

  function dashes(g, c, X, y, h, len, gap, off, hex, wear, seed) {
    for (let x = off; x < W; x += len + gap) paint(g, c, X, Math.max(0, x), Math.min(W - 1, x + len - 1), y, h, hex, wear, seed + x);
  }

  /** granite curb: 1 lit top row, 2 face rows */
  function curb(g, c, X, y, x0, x1, top, face, joints) {
    const k = X.wet ? 0.7 : 1;
    g.rect(x0, y, x1 - x0 + 1, 1, c(top, k));
    g.rect(x0, y + 1, x1 - x0 + 1, 2, c(face, k));
    g.rect(x0, y + 2, x1 - x0 + 1, 1, c(face, k * 0.82));
    if (joints)
      for (let x = x0 + (joints >> 1); x <= x1; x += joints) {
        g.px(x, y, c(face, k));
        g.vline(x, y + 1, y + 2, c(face, k * 0.7));
      }
  }

  function manhole(g, c, X, x, y) {
    const k = X.wet ? 0.7 : 1;
    g.ellipse(x, y, 6, 1.6, c('#2e2e32', k));
    g.ellipse(x, y, 5, 1.1, c('#4a4a50', k));
    for (let i = -4; i <= 4; i += 2) g.px(x + i, y, c('#2e2e32', k));
    g.px(x - 1, y - 1, c('#626268', k));
    g.px(x + 2, y - 1, c('#626268', k));
  }

  function drain(g, c, X, x, y) {
    // a storm drain grate in the gutter by the curb
    const k = X.wet ? 0.7 : 1;
    g.rect(x, y, 9, 2, c('#1e1e22', k));
    for (let i = 1; i < 9; i += 2) g.px(x + i, y, c('#56565c', k));
  }

  // ------------------------------------------------------------------
  // seasonal ground cover: snow, leaves, puddle beds
  // ------------------------------------------------------------------
  /**
   * Snow over a rect. amount 0..1: light snow lies in drifts along the
   * edges and leaves the walked middle bare; a full cover (>= 0.95) is a
   * soft white field with hollows, crests and a trodden path.
   */
  function snowCover(g, X, x0, x1, y0, y1, amount, seed, opt) {
    if (amount <= 0) return;
    const o = opt || {};
    const s = SNOW_N;
    for (let y = y0; y <= y1; y++) {
      const fy = (y - y0) / Math.max(1, y1 - y0);
      for (let x = x0; x <= x1; x++) {
        const big = vnoise(x, y, 14, 5, seed);
        const fine = vnoise(x, y, 4, 2, seed + 1);
        const path = o.path !== undefined ? Math.exp(-Math.pow((fy - o.path) / 0.16, 2)) : 0;
        const edge = o.edgeBoost ? Math.max(0, 1 - fy * 2.6) * 0.45 + Math.max(0, fy * 2.6 - 1.6) * 0.45 : 0;
        const fk = o.smooth ? 0.08 : 0.25;
        const cover = amount * 1.15 + edge - path * (amount >= 0.95 ? 0.22 : 0.5) + (big - 0.5) * 0.7 + (fine - 0.5) * fk - 0.18;
        const th = 0.5 + (HD.bayer(x, y) - 0.5) * 0.22;
        if (cover < th) continue;
        // shading: crests catch the light, hollows and the path stay blue
        const v = o.smooth ? 0.38 + big * 0.35 + (HD.bayer(x + 3, y) - 0.5) * 0.08 : big * 0.7 + fine * 0.3 - path * 0.35 + (cover - th) * 0.4 + (HD.bayer(x + 3, y) - 0.5) * 0.12;
        const ti = v < 0.3 ? 0 : v < 0.52 ? 1 : v < 0.8 ? 2 : 3;
        g.px(x, y, ti - (o.dim || 0) < 0 ? X.c('#8a96b4') : s[ti - (o.dim || 0)]);
      }
    }
  }

  /** footprints along a trodden snow path */
  function footprints(g, X, x0, x1, y0, y1, seed) {
    const rng = HD.rng(seed);
    for (let x = x0; x < x1; x += 3 + R(rng() * 4)) {
      const y = R(y0 + rng() * (y1 - y0));
      g.px(x, y, SNOW_N[0]);
      if (rng() < 0.6) g.px(x + 1, y, SNOW_N[0]);
    }
  }

  /** a ridge of ploughed snow along the curb (heavy snow) */
  function snowBank(g, X, x0, x1, ytop, ybot, seed) {
    const s = SNOW_N;
    for (let x = x0; x <= x1; x++) {
      const h = R(3 + vnoise(x, 0, 9, 1, seed) * 5 + vnoise(x, 0, 3, 1, seed + 1) * 1.5);
      const top = Math.max(ytop, ybot - h);
      for (let y = top; y <= ybot; y++) {
        const f = (y - top) / Math.max(1, ybot - top);
        const lit = vnoise(x, y, 5, 3, seed + 2);
        g.px(x, y, s[y === top ? 3 : f < 0.35 ? (lit > 0.45 ? 3 : 2) : f < 0.75 ? (lit > 0.6 ? 2 : 1) : 0]);
      }
      // grit thrown up on the road side
      if (hash(seed, x, 9, 9) < 0.22) g.px(x, ybot - R(hash(seed, x, 3, 3) * 2), X.c('#5a5048'));
    }
  }

  const LEAF_COLS = ['#b4441a', '#d06a22', '#e0962c', '#c8a02a', '#8e3a1a', '#9a6a2a', '#e8b84a'];
  function leafPx(g, X, x, y, v, k) {
    const col = X.c(LEAF_COLS[(v * LEAF_COLS.length) | 0], k);
    const sh = (v * 97) % 1;
    g.px(x, y, col);
    if (sh < 0.4) g.px(x + 1, y, col);
    else if (sh < 0.7) g.px(x + 1, y - 1, col);
    else if (sh < 0.85) g.px(x, y + 1, col);
  }
  /** fallen leaves: under the trees, along the facade line and the gutter */
  function leafLitter(g, X, zones, seed) {
    const amt = X.leaves;
    if (amt <= 0 || X.season !== 'autumn') return;
    const k = X.wet ? 0.7 : 1;
    const rng = HD.rng(seed);
    for (const z of zones) {
      const n = R(z.n * amt);
      // most leaves gather in little drifts, a few lie alone
      const drifts = z.drifts || 0;
      const centres = [];
      for (let i = 0; i < drifts; i++) centres.push([z.x0 + rng() * (z.x1 - z.x0), z.y0 + rng() * (z.y1 - z.y0)]);
      for (let i = 0; i < n; i++) {
        let x;
        let y;
        if (z.cx !== undefined) {
          x = z.cx + (rng() + rng() + rng() - 1.5) * z.spread;
          y = z.y0 + Math.pow(rng(), z.pow || 1) * (z.y1 - z.y0);
        } else if (drifts && rng() < 0.75) {
          const ce = centres[(rng() * drifts) | 0];
          x = ce[0] + (rng() + rng() - 1) * 7;
          y = Math.max(z.y0, Math.min(z.y1, ce[1] + (rng() + rng() - 1) * 1.6));
        } else {
          x = z.x0 + rng() * (z.x1 - z.x0);
          y = z.y0 + Math.pow(rng(), z.pow || 1) * (z.y1 - z.y0);
        }
        leafPx(g, X, R(x), R(y), rng(), k);
      }
    }
  }

  /** dark smooth puddle beds under the engine's reflections (rain only) */
  function puddleBeds(g, X) {
    if (!X.wet || !X.pl.puddles) return;
    for (const p of X.pl.puddles) {
      g.ellipse(p.x, p.y, p.rx + 1, p.ry + 0.4, X.c('#3a3a40', 0.55));
      g.ellipse(p.x, p.y, p.rx, p.ry, X.c('#2c2e36', 0.55));
    }
  }

  // ------------------------------------------------------------------
  // the six ground looks
  // ------------------------------------------------------------------
  /** where a building stands (for the contact shadow at its foot) */
  function builtAt(x) {
    return HD.placeTop(x) < 200;
  }

  function footShadow(g, X, x0, x1, y) {
    for (let x = x0; x <= x1; x++) {
      if (!builtAt(x)) continue;
      g.px(x, y, 'rgba(0,0,0,0.30)');
      if ((x + y) & 1) g.px(x, y + 1, 'rgba(0,0,0,0.16)');
    }
  }

  const GROUND = {};

  // Boston, apartment 1: warm clay pavers, a granite plaza, a bike lane,
  // a double yellow centre line and a crosswalk on the right
  GROUND.apt1 = function (g, X) {
    const c = X.c;
    const wk = X.wet ? 0.66 : 1;
    const rows = [2, 2, 3, 3, 3, 3, 4];
    const clay = ['#9a6250', '#a86e58', '#8e5a4a', '#b07862', '#9e6854'];
    paverBand(g, c, { x0: 0, x1: 329, y0: 206, rows, w0: 6, w1: 9, tones: clay, joint: '#6a4638', seed: X.seed + 1, hi: true, wetK: wk });
    // the plaza: big pale granite slabs with a dark border
    paverBand(g, c, { x0: 331, x1: 440, y0: 206, rows: [4, 7, 9], w0: 15, w1: 19, tones: ['#a8a296', '#b0aa9e', '#a29c90'], joint: '#86817a', seed: X.seed + 2, bond: 0.5, hiK: 1.05, toneK: 0.06, rowK: [0.86, 0.95, 1], wetK: wk });
    g.rect(330, 206, 1, 20, c('#5a564e', wk));
    g.rect(441, 206, 1, 20, c('#5a564e', wk));
    paverBand(g, c, { x0: 442, x1: 479, y0: 206, rows, w0: 6, w1: 9, tones: clay, joint: '#6a4638', seed: X.seed + 3, hi: true, wetK: wk });
    for (const t of X.cfg.trees) treeGrate(g, X, t.x, t.base);
    plazaBed(g, X, 333, 438, 203);
    footShadow(g, X, 0, W - 1, 206);
    curb(g, c, X, 226, 0, W - 1, '#b8b4ac', '#7a7672', 26);
    g.rect(0, 229, W, 2, c('#8a8680', wk));
    g.hline(0, W - 1, 229, c('#6a6660', wk));
    asphalt(g, c, X, { y0: 231, y1: 269, base: '#4c4c52', lite: '#64646a', dark: '#38383e', patch: '#46464c', wear: [244, 262], patches: 3, cracks: 7 });
    paint(g, c, X, 0, W - 1, 239, 1, '#dcd8cc', 0.12, 41);
    paint(g, c, X, 0, W - 1, 253, 1, '#d8a630', 0.1, 42);
    paint(g, c, X, 0, W - 1, 255, 1, '#d8a630', 0.1, 43);
    crosswalk(g, c, X, 440, 474, 231, 269, 44);
    manhole(g, c, X, 208, 247);
    manhole(g, c, X, 92, 262);
    drain(g, c, X, 286, 229);
    drain(g, c, X, 36, 229);
    groundWeather(g, X, { curbY: 226, road: [231, 269], wheel: [[243, 246], [260, 263]] });
  };

  // Boston, apartment 2: big grey concrete pavers, a red-brick band along the
  // curb, a charcoal corner plaza, a parking lane with stall ticks
  GROUND.apt2 = function (g, X) {
    const c = X.c;
    const wk = X.wet ? 0.66 : 1;
    // corner plaza: charcoal large-format pavers banded with pale granite
    paverBand(g, c, { x0: 0, x1: 136, y0: 206, rows: [3, 2, 5, 2, 4], w0: 9, w1: 12, tones: ['#6e7074', '#76787c', '#686a6e'], joint: '#55575b', seed: X.seed + 1, bond: 0.5, hiK: 1.06, wetK: wk });
    for (const yy of [209, 216]) g.rect(0, yy, 137, 2, c('#aeaca4', wk));
    for (const yy of [209, 216]) g.rect(0, yy + 1, 137, 1, c('#96948c', wk));
    g.rect(137, 206, 1, 16, c('#4a4c50', wk));
    // main sidewalk: big grey concrete squares, sawn joints
    paverBand(g, c, { x0: 138, x1: 479, y0: 206, rows: [7, 9], w0: 15, w1: 18, tones: ['#9c9ea0', '#a4a6a6', '#96989a'], joint: '#7c7e80', seed: X.seed + 2, bond: 0, hiK: 1.05, toneK: 0.05, wetK: wk });
    speckle(g, c, 138, 207, W - 138, 15, '#8a8c8e', 0.03, X.seed + 9, wk);
    // red-brick band along the curb
    paverBand(g, c, { x0: 0, x1: 479, y0: 222, rows: [2, 2], w0: 4, w1: 4.4, tones: ['#8c4a3a', '#9a5442', '#7e4234', '#a05a46'], joint: '#5e3a2e', seed: X.seed + 3, wetK: wk });
    treeGrate(g, X, 452, 216);
    plazaBed(g, X, 70, 126, 203);
    footShadow(g, X, 0, W - 1, 206);
    curb(g, c, X, 226, 0, W - 1, '#b4b2ac', '#787674', 30);
    g.rect(0, 229, W, 2, c('#86847e', wk));
    g.hline(0, W - 1, 229, c('#66645e', wk));
    asphalt(g, c, X, { y0: 231, y1: 269, base: '#48484e', lite: '#5e5e64', dark: '#36363c', patch: '#424248', wear: [248, 263], patches: 4, cracks: 6 });
    for (let x = 18; x < W; x += 46) paint(g, c, X, x, x, 232, 7, '#d8d4c8', 0.15, 50 + x);
    paint(g, c, X, 0, W - 1, 240, 1, '#d8d4c8', 0.2, 51);
    paint(g, c, X, 0, W - 1, 256, 1, '#d4a22e', 0.1, 52);
    paint(g, c, X, 0, W - 1, 258, 1, '#d4a22e', 0.1, 53);
    manhole(g, c, X, 300, 250);
    drain(g, c, X, 146, 229);
    drain(g, c, X, 392, 229);
    groundWeather(g, X, { curbY: 226, road: [231, 269], wheel: [[245, 248], [262, 265]] });
  };

  // SoHo: concrete slabs with vault-light strips, a steel-nosed granite curb
  // and a cobbled street of granite setts
  GROUND.soho = function (g, X) {
    const c = X.c;
    const wk = X.wet ? 0.66 : 1;
    paverBand(g, c, { x0: 0, x1: 479, y0: 206, rows: [4, 7, 9], w0: 16, w1: 21, tones: ['#a29e96', '#aaa69c', '#9a968e', '#a8a49a'], joint: '#77736b', seed: X.seed + 1, stagger: true, hiK: 1.06, toneK: 0.06, wetK: wk });
    speckle(g, c, 0, 207, W, 18, '#6a665e', 0.012, X.seed + 7, wk);
    vaultLights(g, X, 22, 70, 209);
    vaultLights(g, X, 300, 352, 209);
    vaultLights(g, X, 404, 440, 209);
    treeGrate(g, X, 462, 216);
    footShadow(g, X, 0, W - 1, 206);
    curb(g, c, X, 226, 0, W - 1, '#a6aab0', '#6e6c68', 22);
    g.hline(0, W - 1, 226, c('#b8bcc4', wk));
    cobbles(g, X, 229, 269);
    manhole(g, c, X, 325, 249);
    groundWeather(g, X, { curbY: 226, road: [229, 269], wheel: [] });
  };

  // Beverly Hills: pale scored concrete, a tan paver drive under the hotel
  // canopy with a curb cut, red-painted curbs either side of it
  GROUND.bhills = function (g, X) {
    const c = X.c;
    const DX0 = 184;
    const DX1 = 277;
    // pale concrete in large scored squares
    paverBand(g, c, { x0: 0, x1: 479, y0: 206, rows: [6, 6, 8], w0: 22, w1: 27, tones: ['#d6d0c4', '#dad4c8', '#d2ccc0'], joint: '#bcb6aa', seed: X.seed + 1, bond: 0, hiK: 1.03, toneK: 0.03 });
    speckle(g, c, 0, 207, W, 19, '#c6c0b4', 0.035, X.seed + 3);
    speckle(g, c, 0, 207, W, 19, '#e6e0d4', 0.03, X.seed + 4);
    // the drive: tan pavers in a running bond, framed by a darker soldier course
    paverBand(g, c, { x0: DX0, x1: DX1, y0: 206, rows: [2, 2, 2, 3, 3, 3, 3, 3, 3], w0: 5, w1: 6.5, tones: ['#c8a882', '#bea078', '#d2b28c', '#c4a47c'], joint: '#a4865e', seed: X.seed + 6, hiK: 1.06 });
    g.rect(DX0 - 1, 206, 2, 24, c('#9a7e5e'));
    g.rect(DX1, 206, 2, 24, c('#9a7e5e'));
    for (const t of X.cfg.trees) treeWell(g, X, t.x, t.base);
    footShadow(g, X, 0, W - 1, 206);
    curb(g, c, X, 226, 0, DX0 - 2, '#d4d0c6', '#a6a298', 34);
    curb(g, c, X, 226, DX1 + 2, W - 1, '#d4d0c6', '#a6a298', 34);
    curb(g, c, X, 226, 140, DX0 - 2, '#d05a44', '#b0402e', 0);
    curb(g, c, X, 226, DX1 + 2, 330, '#d05a44', '#b0402e', 0);
    g.rect(DX0 - 1, 228, DX1 - DX0 + 3, 2, c('#c0b6a4'));
    g.rect(0, 229, W, 2, c('#bcb6aa'));
    asphalt(g, c, X, { y0: 231, y1: 269, base: '#5c5c60', lite: '#747478', dark: '#48484c', patch: '#545458', wear: [244, 259], patches: 2, cracks: 4 });
    dashes(g, c, X, 251, 1, 14, 16, 4, '#e8e6e0', 0.08, 61);
    paint(g, c, X, 0, W - 1, 265, 1, '#e0b434', 0.06, 62);
    paint(g, c, X, 0, W - 1, 267, 1, '#e0b434', 0.06, 63);
    manhole(g, c, X, 150, 257);
  };

  // San Diego: a sand-coloured promenade, a pale seawall and the marina
  // water with floating docks
  GROUND.marina = function (g, X) {
    const c = X.c;
    paverBand(g, c, { x0: 0, x1: 479, y0: 206, rows: [3, 4, 4, 5], w0: 12, w1: 16, tones: ['#d8c49a', '#d0bc92', '#dcc8a0', '#d4c096'], joint: '#bca880', seed: X.seed + 1, hiK: 1.05, toneK: 0.04 });
    paverBand(g, c, { x0: 0, x1: 479, y0: 222, rows: [3, 3], w0: 7, w1: 7.5, tones: ['#b8a47c', '#b29e76', '#bea982'], joint: '#9e8a64', seed: X.seed + 2 });
    footShadow(g, X, 0, W - 1, 206);
    g.rect(0, 228, W, 1, c('#f0e8d8'));
    g.rect(0, 229, W, 1, c('#d8d0c0'));
    g.rect(0, 230, W, 4, c('#a8a090'));
    for (let x = 12; x < W; x += 24) g.vline(x, 230, 233, c('#8a8274'));
    g.rect(0, 232, W, 2, c('#7a8070'));
    speckle(g, c, 0, 232, W, 2, '#56604e', 0.35, X.seed + 5);
    for (const mx of X.cfg.moor) {
      g.rect(mx - 1, 225, 3, 3, c('#3a3c40'));
      g.hline(mx - 1, mx + 1, 225, c('#5a5e66'));
      g.px(mx, 228, c('#2a2c30'));
    }
    water(g, X);
    docks(g, X);
  };

  // Herndon: a front lawn, the front walk, a concrete sidewalk and a quiet
  // unmarked street (the fence stands with the furniture)
  GROUND.herndon = function (g, X) {
    const c = X.c;
    lawn(g, X, 206, 235);
    const wx0 = 251;
    const wx1 = 268;
    for (let y = 206; y <= 235; y++) {
      g.hline(wx0, wx1, y, c('#b4b0a6'));
      if ((y - 206) % 6 === 5) g.hline(wx0, wx1, y, c('#8e8a80'));
    }
    g.vline(wx0 - 1, 206, 235, c('#6e6a60'));
    g.vline(wx1 + 1, 206, 235, c('#ccc8be'));
    paverBand(g, c, { x0: 0, x1: 479, y0: 236, rows: [5, 7], w0: 20, w1: 23, tones: ['#aaa69e', '#b0aca2', '#a4a098'], joint: '#86827a', seed: X.seed + 1, bond: 0, hiK: 1.05, toneK: 0.05 });
    speckle(g, c, 0, 237, W, 11, '#8e8a82', 0.03, X.seed + 2);
    curb(g, c, X, 248, 0, W - 1, '#b8b4aa', '#8a867e', 0);
    asphalt(g, c, X, { y0: 251, y1: 269, base: '#4e4e54', lite: '#646468', dark: '#3c3c42', patch: '#48484e', wear: [259], patches: 2, cracks: 5 });
  };

  /** snow, leaves and puddles on a street place */
  function groundWeather(g, X, o) {
    const c = X.c;
    const zones = [
      { x0: 0, x1: W - 1, y0: 207, y1: 210, n: 110, pow: 1.4, drifts: 14 },
      { x0: 0, x1: W - 1, y0: 211, y1: 225, n: 50, drifts: 6 },
      { x0: 0, x1: W - 1, y0: o.road[0] - 1, y1: o.road[0] + 1, n: 150, pow: 0.7, drifts: 16 },
      { x0: 0, x1: W - 1, y0: o.road[0] + 3, y1: o.road[1], n: 10 },
    ];
    for (const t of X.cfg.trees) zones.push({ cx: t.x, spread: 18, y0: t.base - 5, y1: t.base + 7, n: 80 });
    leafLitter(g, X, zones, X.seed + 900);
    if (X.snow > 0) {
      if (X.snow >= 0.6) {
        snowCover(g, X, 0, W - 1, 206, 225, 1.0, X.seed + 31, { path: 0.5 });
        footprints(g, X, 0, W, 213, 217, X.seed + 39);
        g.hline(0, W - 1, 206, SNOW_N[0]);
        snowBank(g, X, 0, W - 1, 219, 230, X.seed + 32);
        // the road: packed snow with slushy wheel tracks
        snowCover(g, X, 0, W - 1, o.road[0] + 1, o.road[1], 1.0, X.seed + 33, { dim: 1, smooth: true });
        for (const wtr of o.wheel)
          for (let x = 0; x < W; x++) {
            const a0 = wtr[0] + R(vnoise(x, 0, 11, 1, X.seed + wtr[0]) * 1.6 - 0.8);
            for (let y = a0; y <= a0 + (wtr[1] - wtr[0]); y++) g.px(x, y, c(hash(X.seed, x >> 1, y, 34) < 0.2 ? '#56565e' : '#3a3a44', 0.85));
            if (hash(X.seed, x, a0, 35) < 0.5) g.px(x, a0 - 1, SNOW_N[1]);
          }
      } else {
        snowCover(g, X, 0, W - 1, 206, 225, X.snow * 0.85, X.seed + 35, { edgeBoost: true, path: 0.5 });
        // the curb top and the gutter keep a white line, the road a dusting
        snowCover(g, X, 0, W - 1, o.curbY, o.curbY, 1, X.seed + 36);
        snowCover(g, X, 0, W - 1, o.road[0], o.road[0] + 3, 0.62, X.seed + 37, { edgeBoost: true });
        snowCover(g, X, 0, W - 1, o.road[0] + 4, o.road[1], X.snow * 0.35, X.seed + 38);
      }
    }
    puddleBeds(g, X);
  }

  function crosswalk(g, c, X, x0, x1, y0, y1, seed) {
    // continental bars run along the traffic; they stack across the road
    let y = y0 + 2;
    let i = 0;
    while (y < y1 - 1) {
      const f = (y - y0) / (y1 - y0);
      const bh = f < 0.4 ? 2 : 3;
      // the bars widen a touch towards the viewer
      const grow = R(f * 3);
      paint(g, c, X, x0 - grow, x1 + grow, y, Math.min(bh, y1 - y), '#e2dfd6', 0.03, seed + i);
      y += bh + (f < 0.4 ? 2 : 3);
      i++;
    }
  }

  function treeGrate(g, X, x, base) {
    const c = X.c;
    const k = X.wet ? 0.7 : 1;
    g.rect(x - 6, base - 2, 13, 4, c('#2a2622', k));
    for (let i = -5; i <= 5; i += 2) g.vline(x + i, base - 2, base + 1, c('#4a4844', k));
    g.hline(x - 6, x + 6, base - 2, c('#56544e', k));
    g.hline(x - 6, x + 6, base + 1, c('#3a3834', k));
  }

  function treeWell(g, X, x, base) {
    const c = X.c;
    g.rect(x - 5, base - 2, 11, 4, c('#5e4e3a'));
    speckle(g, c, x - 5, base - 2, 11, 4, '#7a6648', 0.3, x);
    g.hline(x - 5, x + 5, base - 3, c('#b8b2a6'));
  }

  /** a low granite wall with a planting bed at the back of a plaza */
  function plazaBed(g, X, x0, x1, y) {
    const c = X.c;
    const k = X.wet ? 0.7 : 1;
    const sea = X.season;
    for (let x = x0 + 1; x < x1; x++) {
      const h = 2 + R(hash(x0, x, 1, 1) * 2 + T.noise(x * 0.5, 9, x0) * 2);
      for (let yy = y - h; yy < y + 1; yy++) {
        let col;
        if (sea === 'winter') col = hash(x, yy, 2, 2) < 0.5 ? '#4a3c30' : '#5e4e3c';
        else if (sea === 'autumn') col = ['#7a4a1e', '#a0661e', '#6a5a2a', '#8a3a1c'][(hash(x, yy, 3, 3) * 4) | 0];
        else if (sea === 'spring') col = hash(x, yy, 4, 4) < 0.18 ? ['#e8c040', '#f0f0e8', '#d07090'][(hash(x, yy, 5, 5) * 3) | 0] : ['#3c7030', '#4e8838'][(hash(x, yy, 6, 6) * 2) | 0];
        else col = hash(x, yy, 7, 7) < 0.1 ? '#c86080' : ['#2e5a26', '#3e7030', '#4c8236'][(hash(x, yy, 8, 8) * 3) | 0];
        g.px(x, yy, c(col, k));
      }
    }
    g.rect(x0, y + 1, x1 - x0 + 1, 1, c('#bcb8ae', k));
    g.rect(x0, y + 2, x1 - x0 + 1, 2, c('#86827a', k));
    g.hline(x0, x1, y + 3, c('#5e5a54', k));
    if (X.snow > 0) snowCover(g, X, x0, x1, y - 3, y + 1, Math.min(1, X.snow * 1.6), x0 + 5);
  }

  function vaultLights(g, X, x0, x1, y) {
    const c = X.c;
    const k = X.wet ? 0.7 : 1;
    g.rect(x0, y, x1 - x0 + 1, 7, c('#4e4e52', k));
    g.hline(x0, x1, y, c('#6e6e72', k));
    for (let yy = y + 1; yy < y + 7; yy += 2)
      for (let x = x0 + 1 + ((yy >> 1) & 1); x < x1; x += 2) g.px(x, yy, c(hash(x, yy, 3, 1) < 0.2 ? '#6a6a88' : '#8a90a8', k));
  }

  /** Belgian-block setts: rows of worn granite stones, fanning out in perspective */
  function cobbles(g, X, y0, y1) {
    const c = X.c;
    const k = X.wet ? 0.6 : 1;
    const tones = ['#76726a', '#827c72', '#6c6862', '#8c867c', '#7a7268', '#867a6e'];
    const joint = c('#2e2c2a', k);
    let y = y0;
    let r = 0;
    while (y <= y1) {
      const f = (y - y0) / (y1 - y0);
      const rh = Math.min(y1 - y + 1, f < 0.2 ? 2 : f < 0.55 ? 3 : 4);
      const sw = f < 0.2 ? 5 : f < 0.55 ? 6 : 7;
      const sc = 1 + 0.006 * (y - y0 + rh * 0.5);
      g.rect(0, y, W, 1, joint);
      // stone boundaries in ground space
      let edge = -hash(X.seed, r, 1, 1) * sw;
      let i = 0;
      let next = edge + sw - 1 + hash(X.seed, r, 0, 2) * 2.4;
      let start = 0;
      const stone = (xa, xb, si) => {
        if (xb < xa || rh < 2) return;
        const tone = tones[(hash(X.seed, r, si, 3) * tones.length) | 0];
        g.rect(xa, y + 1, xb - xa + 1, rh - 1, c(tone, k));
        // a worn, rounded crown: lit top-left, darker foot
        g.hline(xa, Math.min(xb, xa + Math.max(1, (xb - xa) >> 1)), y + 1, c(tone, k * 1.22));
        if (rh > 2) g.hline(xa + 1, xb, y + rh - 1, c(tone, k * 0.8));
      };
      for (let x = 0; x <= W; x++) {
        const u = 240 + (x - 240) / sc;
        if (u < next && x < W) continue;
        stone(start, x - 1, i);
        if (x < W) g.vline(x, y + 1, y + rh - 1, joint);
        start = x + 1;
        i++;
        next += sw - 1 + hash(X.seed, r, i, 2) * 2.4;
      }
      void edge;
      y += rh;
      r++;
    }
  }

  function lawn(g, X, y0, y1) {
    const c = X.c;
    const tones = ['#4a7a30', '#56883a', '#3e6a2a'];
    for (let y = y0; y <= y1; y++) {
      const f = (y - y0) / (y1 - y0);
      for (let x = 0; x < W; x++) {
        // mowing stripes
        const band = (x >> 5) & 1;
        let t = band ? 0 : 1;
        const n = hash(X.seed, x, y, 21);
        if (n < 0.16) t = 2;
        else if (n > 0.9) t = band ? 1 : 0;
        let col = tones[t];
        if (hash(X.seed, x, y, 22) < 0.06 + f * 0.05) col = mixA(col, '#a0c060', 0.35);
        g.px(x, y, c(col));
      }
    }
    const rng = HD.rng(X.seed + 23);
    for (let i = 0; i < 40; i++) {
      const x = R(rng() * W);
      const y = R(y0 + 3 + rng() * (y1 - y0 - 4));
      g.px(x, y, c(rng() < 0.7 ? '#e8e4d0' : '#e0c040'));
    }
    g.hline(0, W - 1, y1, c('#2e4a20'));
  }

  // ------------------------------------------------------------------
  // marina water and docks
  // ------------------------------------------------------------------
  const WATER = ['#1e5a88', '#2a6c9c', '#3a82b2', '#5098c4', '#6eb0d4', '#9ccce6', '#d0ecf8'];
  function water(g, X) {
    const c = X.c;
    const y0 = 234;
    const y1 = 269;
    for (let y = y0; y <= y1; y++) {
      // far water (just below the wall) reflects the bright sky; the near
      // water is deeper and bluer
      const f = (y - y0) / (y1 - y0);
      for (let x = 0; x < W; x++) {
        const v = 4.2 - f * 3.6 + (HD.bayer(x, y) - 0.5) * 0.9 + (T.noise(x * 0.11 + y * 0.6, 5, 7) - 0.5) * 0.6;
        const i = Math.max(0, Math.min(WATER.length - 2, Math.floor(v)));
        g.px(x, y, c(WATER[i]));
      }
    }
    g.rect(0, 234, W, 1, c('#1e4a6a'));
    for (let x = 0; x < W; x++) if (HD.bayer(x, 235) < 0.5) g.px(x, 235, c('#2a5a7c'));
  }

  const DOCKS = [
    [0, 150],
    [324, 479],
  ];
  /** dock planks and pilings (kept out of the water's reflections and waves) */
  function isDock(x, y) {
    if (y < 249 || y > 263) return false;
    for (const [x0, x1] of DOCKS) if (x >= x0 && x <= x1) return y >= 256 || (x - x0 - 9) % 29 < 3;
    return false;
  }
  function docks(g, X) {
    const c = X.c;
    for (const [x0, x1] of DOCKS) {
      // the deck seen from above: weathered planks across the walkway
      for (let y = 256; y <= 259; y++)
        for (let x = x0; x <= x1; x++) {
          const plank = Math.floor((x - x0 + (y > 257 ? 1 : 0)) / 3);
          const seam = (x - x0 + (y > 257 ? 1 : 0)) % 3 === 0;
          const tone = ['#c4b494', '#b8a888', '#ccbc9c', '#b0a080'][(hash(x0, plank, 1, 1) * 4) | 0];
          g.px(x, y, c(seam ? '#8e7e62' : y === 256 ? mixA(tone, '#ffffff', 0.15) : tone));
        }
      // the fascia with a white rubbing strip, then the shadow on the water
      g.rect(x0, 260, x1 - x0 + 1, 2, c('#6a5c48'));
      for (let x = x0 + 1; x <= x1; x += 4) g.hline(x, x + 2, 260, c('#dcdcd4'));
      g.hline(x0, x1, 262, c('#1a4064'));
      for (let x = x0; x <= x1; x++) if (HD.bayer(x, 263) < 0.5) g.px(x, 263, c('#24507a'));
      // pilings rise from the water at the back edge of the deck
      for (let x = x0 + 9; x <= x1 - 3; x += 29) {
        g.rect(x, 250, 3, 6, c('#7a6a54'));
        g.px(x, 250, c('#5e5040'));
        g.vline(x + 2, 251, 255, c('#9a8a70'));
        g.hline(x, x + 2, 249, c('#d8d4c8'));
        g.px(x + 1, 255, c('#4a3e30'));
        // mooring cleat on the deck
        g.hline(x + 6, x + 8, 257, c('#4a4c50'));
      }
    }
  }

  // ------------------------------------------------------------------
  // trees
  // ------------------------------------------------------------------
  /**
   * Leafy canopy built from shaded clumps (light from the upper right).
   * Returns {img, ax, ay}: (ax, ay) is where the trunk base sits in img.
   */
  function bakeLeafy(spec, sway, X) {
    const c = X.c;
    const k = X.wet ? 0.85 : 1;
    const rx = spec.rx;
    const ry = spec.ry;
    const lean = spec.lean || 0;
    const bw = (rx + spec.cr1 + 3) * 2 + Math.abs(lean) * 2;
    const bh = spec.h + spec.cr1 + 4;
    const ax = (bw >> 1) - (lean >> 1);
    const ay = bh - 2;
    const ccx = ax + lean;
    const ccy = ay - spec.h + ry;
    const pal = spec.pal;
    const alt = spec.pal2;
    const img = HD.bake(bw, bh, (g) => {
      const rng = HD.rng(spec.seed);
      const occ = new Uint8Array(bw * bh);
      const put = (x, y, col) => {
        x = R(x);
        y = R(y);
        if (x < 0 || y < 0 || x >= bw || y >= bh) return;
        occ[y * bw + x] = 1;
        g.px(x, y, col);
      };
      // trunk
      const tTop = ccy + R(ry * 0.3);
      for (let y = ay; y >= tTop; y--) {
        const f = (ay - y) / Math.max(1, ay - tTop);
        const x = ax + R((ccx - ax) * f);
        const tw = spec.tw > 4 ? R(spec.tw * (1 - 0.35 * f)) : Math.max(1, spec.tw - (f > 0.75 && spec.tw > 2 ? 1 : 0));
        const x0 = x - (tw >> 1);
        g.hline(x0, x0 + tw - 1, y, c(A.bark[2], k));
        g.px(x0, y, c(A.bark[1], k));
        if (tw > 2) g.px(x0 + tw - 1, y, c(A.bark[3], k));
        if (tw > 4) g.px(x0 + 1, y, c(A.bark[1], k));
      }
      if (spec.tw > 3) {
        // root flare
        g.px(ax - (spec.tw >> 1) - 1, ay, c(A.bark[1], k));
        g.px(ax - (spec.tw >> 1) + spec.tw, ay, c(A.bark[2], k));
      }
      // limbs into the crown (seen through the gaps)
      const limbs = spec.limbs || 3;
      for (let i = 0; i < limbs; i++) {
        const a = Math.PI / 2 + (i - (limbs - 1) / 2) * (1.6 / limbs) + (rng() - 0.5) * 0.3;
        const len = ry * (0.55 + rng() * 0.25);
        const x2 = ccx + Math.cos(a) * len * (rx / ry);
        const y2 = tTop - Math.sin(a) * len;
        const lw = spec.tw > 4 ? Math.max(2, R(spec.tw * 0.45)) : spec.tw > 3 ? 2 : 1;
        for (let j = 0; j < lw; j++) g.line(ccx - (lw >> 1) + j, tTop, x2 - (lw >> 1) + j + (j > 0 ? 0 : 0), y2 + j * 0.5, c(j === 0 ? A.bark[1] : j === lw - 1 ? A.bark[3] : A.bark[2], k));
        const a2 = a + (rng() < 0.5 ? 0.5 : -0.5);
        g.line(x2, y2, x2 + Math.cos(a2) * len * 0.3, y2 - Math.sin(a2) * len * 0.3, c(A.bark[3], k));
      }
      // clumps on rings: a full crown with a bumpy outline
      const clumps = [];
      const rings = spec.rings || [
        [0, 1],
        [0.45, 5],
        [0.82, 9],
      ];
      for (const [rf, cnt] of rings)
        for (let i = 0; i < cnt; i++) {
          if (rf > 0.3 && spec.gaps && rng() < spec.gaps) continue;
          const a = (i / cnt) * TAU + rng() * 0.5 + rf * 2.1;
          const d = rf * (1 - (spec.jit || 0.12) + rng() * (spec.jit || 0.12) * 2);
          let x = ccx + Math.cos(a) * d * (rx - spec.cr0 * 0.7);
          const y = ccy + Math.sin(a) * d * (ry - spec.cr0 * 0.7);
          const r = (spec.cr0 + rng() * (spec.cr1 - spec.cr0)) * (1 - (spec.shrink === undefined ? 0.2 : spec.shrink) * rf);
          const fy = (ccy + ry - y) / (2 * ry);
          if (fy > 0.4) x += sway * (fy > 0.72 ? 1 : 0.5);
          clumps.push({ x, y, r, p: !alt || rng() < 0.55 ? pal : alt });
        }
      clumps.sort((p, q) => q.y - p.y + (p.x - q.x) * 0.35);
      const holes = spec.holes || 0;
      const isHole = (x, y) => holes > 0 && hash(spec.seed, (x + (y & 1)) >> 1, y >> 1, 2) < holes;
      // 1) the shadowed mass
      for (const cl of clumps) {
        const rr = cl.r + 0.6;
        for (let y = Math.floor(cl.y - rr); y <= Math.ceil(cl.y + rr); y++)
          for (let x = Math.floor(cl.x - rr); x <= Math.ceil(cl.x + rr); x++) {
            const dx = x - cl.x;
            const dy = y - cl.y;
            const jag = (hash(spec.seed, x, y, 1) - 0.5) * 1.3;
            if (dx * dx + dy * dy > (rr + jag) * (rr + jag) || isHole(x, y)) continue;
            put(x, y, c(cl.p[0], k));
          }
      }
      // 2) each clump's lit side, in small leafy clusters
      for (const cl of clumps) {
        const rr = cl.r;
        for (let y = Math.floor(cl.y - rr); y <= Math.ceil(cl.y + rr); y++)
          for (let x = Math.floor(cl.x - rr); x <= Math.ceil(cl.x + rr); x++) {
            const dx = x - cl.x;
            const dy = y - cl.y;
            const jag = (hash(spec.seed, x, y, 3) - 0.5) * 1.2;
            if (dx * dx + dy * dy > (rr - 0.5 + jag) * (rr - 0.5 + jag) || isHole(x, y)) continue;
            let v = (dx * 0.45 - dy * 0.9) / rr;
            v -= ((y - ccy) / ry) * 0.5;
            v += (hash(spec.seed, (x + (y & 1)) >> 1, y >> 1, 7) - 0.5) * 0.4;
            const ti = v < -0.5 ? 0 : v < -0.05 ? 1 : v < 0.4 ? 2 : v < 0.82 ? 3 : 4;
            if (ti === 0) continue;
            put(x, y, c(cl.p[ti], k));
          }
      }
      // 3) a leafy fringe attached to the outline
      for (let y = 1; y < bh - 1; y++)
        for (let x = 1; x < bw - 1; x++) {
          if (occ[y * bw + x] || y > ccy + ry * 0.9) continue;
          const nb = occ[y * bw + x - 1] + occ[y * bw + x + 1] + occ[(y + 1) * bw + x];
          if (nb === 1 && hash(spec.seed, x, y, 11) < 0.22) g.px(x, y, c(pal[y < ccy ? 2 : 1], k));
        }
      if (spec.dots)
        for (let i = 0; i < spec.dots.n; i++) {
          const a = rng() * TAU;
          const d = Math.sqrt(rng());
          const x = R(ccx + Math.cos(a) * d * rx * 0.85);
          const y = R(ccy + Math.sin(a) * d * ry * 0.8);
          if (occ[y * bw + x]) g.px(x, y, c(spec.dots.col, k));
        }
    });
    return { img, ax, ay };
  }

  /** a bare winter tree: a vase of forking limbs, snow along their tops */
  function bakeBare(spec, sway, X) {
    const c = X.c;
    const bw = spec.rx * 2 + 12;
    const bh = spec.h + 4;
    const ax = bw >> 1;
    const ay = bh - 2;
    const snowAmt = X.snow;
    // crown envelope: twigs stop at a rounded outline
    const ccx = ax;
    const ccy = ay - spec.h * 0.62;
    const erx = spec.rx;
    const ery = spec.h * 0.36;
    const img = HD.bake(bw, bh, (g) => {
      const rng = HD.rng(spec.seed + 5);
      const occ = new Uint8Array(bw * bh);
      const flat = new Uint8Array(bw * bh);
      const put = (x, y, col, f) => {
        x = R(x);
        y = R(y);
        if (x < 0 || y < 0 || x >= bw || y >= bh) return;
        occ[y * bw + x] = 1;
        if (f) flat[y * bw + x] = 1;
        g.px(x, y, col);
      };
      const tone = (d) => c(d < 2 ? A.bark[2] : d < 4 ? A.bark[3] : mixA(A.bark[3], '#a0948a', 0.35));
      const branch = (x, y, ang, len, depth) => {
        // clip the length to the crown envelope
        let L = len;
        for (let i = 0; i < 6; i++) {
          const ex = (x + Math.cos(ang) * L - ccx) / erx;
          const ey = (y - Math.sin(ang) * L - ccy) / ery;
          if (ex * ex + ey * ey <= 1) break;
          L *= 0.82;
        }
        // a slight bend half way
        const bend = (rng() - 0.5) * 0.3;
        const mx = x + Math.cos(ang) * L * 0.5;
        const my = y - Math.sin(ang) * L * 0.5;
        const a2 = ang + bend;
        const swayK = depth >= 3 ? sway * 0.5 * (depth - 2) : 0;
        const x2 = mx + Math.cos(a2) * L * 0.5 + swayK;
        const y2 = my - Math.sin(a2) * L * 0.5;
        const flatish = Math.abs(Math.sin(ang)) < 0.9;
        for (const [p0x, p0y, p1x, p1y] of [
          [x, y, mx, my],
          [mx, my, x2, y2],
        ]) {
          const n = Math.max(1, Math.ceil(Math.max(Math.abs(p1x - p0x), Math.abs(p1y - p0y))));
          for (let i = 0; i <= n; i++) {
            const px = p0x + ((p1x - p0x) * i) / n;
            const py = p0y + ((p1y - p0y) * i) / n;
            put(px, py, tone(depth), flatish);
            if (depth <= 1) put(px + 1, py, c(A.bark[1]), flatish);
          }
        }
        if (depth >= spec.depth || L < 3) return;
        const kids = depth < 2 ? 3 : rng() < 0.6 ? 2 : 3;
        for (let i = 0; i < kids; i++) {
          const spread = (0.35 + rng() * 0.3) * (kids === 3 ? 1.1 : 1);
          let na = a2 + (i - (kids - 1) / 2) * spread + (rng() - 0.5) * 0.3;
          na += (Math.PI / 2 - na) * 0.12; // keep reaching up
          branch(x2, y2, na, L * (0.62 + rng() * 0.16), depth + 1);
        }
      };
      const fork = ay - R(spec.h * 0.34);
      for (let y = ay; y >= fork; y--) {
        g.px(ax, y, c(A.bark[1]));
        g.px(ax + 1, y, c(A.bark[3]));
        occ[y * bw + ax] = 1;
        occ[y * bw + ax + 1] = 1;
      }
      const limbs = [
        [Math.PI / 2 + 0.7, 0.3],
        [Math.PI / 2 + 0.22, 0.34],
        [Math.PI / 2 - 0.25, 0.33],
        [Math.PI / 2 - 0.72, 0.28],
      ];
      for (const [a, l] of limbs) branch(ax + (a < Math.PI / 2 ? 1 : 0), fork, a + (rng() - 0.5) * 0.15, spec.h * l, 1);
      if (snowAmt > 0)
        for (let y = 2; y < bh; y++)
          for (let x = 0; x < bw; x++) {
            const i = y * bw + x;
            if (!occ[i] || occ[i - bw] || !flat[i]) continue;
            if (hash(spec.seed, x, y, 8) < Math.min(0.92, snowAmt * 0.8 + 0.3)) {
              g.px(x, y - 1, SNOW_N[snowAmt > 0.6 ? 3 : 2]);
              if (snowAmt > 0.6 && hash(spec.seed, x, y, 9) < 0.3 && !occ[i - 2 * bw]) g.px(x, y - 2, SNOW_N[2]);
            }
          }
    });
    return { img, ax, ay };
  }

  /** fan palm: a tall slim trunk with a round crown of fan leaves and a dry skirt */
  function bakePalm(spec, sway, X) {
    const c = X.c;
    const fl = spec.fl || 12;
    const bw = fl * 2 + 14 + Math.abs(spec.lean) * 2;
    const bh = spec.h + fl + 8;
    const ax = (bw >> 1) - spec.lean;
    const ay = bh - 2;
    const img = HD.bake(bw, bh, (g) => {
      const rng = HD.rng(spec.seed);
      const tx = ax + spec.lean;
      const ty = ay - spec.h;
      // trunk: 2 px, lit on the right, faint growth rings
      for (let y = ay; y >= ty; y--) {
        const f = (ay - y) / spec.h;
        const x = R(ax + spec.lean * f * f);
        const ring = (y + spec.seed) % 4 === 0;
        g.px(x, y, c(A.palmTrunk[ring ? 0 : 1]));
        g.px(x + 1, y, c(A.palmTrunk[ring ? 2 : 3]));
        if (f < 0.05) g.px(x - 1, y, c(A.palmTrunk[0]));
      }
      // the dry skirt hanging under the crown
      for (let i = -2; i <= 2; i++) {
        const len = 2 + R(rng() * 2) + (i === 0 ? 2 : 0);
        const col = c(A.palmDry[i & 1 ? 0 : 1]);
        for (let j = 0; j < len; j++) g.px(tx + i + (j > 1 && i ? Math.sign(i) : 0), ty + j, col);
      }
      // fronds: a back layer (darker) and a front layer
      for (let layer = 0; layer < 2; layer++) {
        const n = layer ? 11 : 9;
        for (let i = 0; i < n; i++) {
          const a = -0.25 + (i / (n - 1)) * (Math.PI + 0.5) + (layer ? 0.12 : -0.05) + (rng() - 0.5) * 0.14;
          const len = fl * (0.72 + rng() * 0.3) * (layer ? 1 : 0.9);
          const sideK = 1 - Math.abs(Math.sin(a));
          for (let s = 0; s <= len; s++) {
            const u = s / len;
            const droop = u * u * len * (0.25 + sideK * 0.55);
            const sw = sway * u * (Math.sin(a) > 0.3 ? 1 : 0.5);
            const x = tx + Math.cos(a) * s * 1.05 + sw;
            const y = ty - 1 - Math.sin(a) * s * 0.8 + droop;
            const ci = Math.min(4, (u < 0.35 ? 1 : u < 0.75 ? 2 : u < 0.92 ? 3 : 4) + layer - 1 + (layer ? 0 : 0));
            g.px(x, y, c(A.palmFrond[Math.max(0, ci)]));
            if (u > 0.35 && u < 0.92) g.px(x, y + 1, c(A.palmFrond[Math.max(0, ci - 1)]));
          }
        }
      }
      g.rect(tx - 1, ty - 2, 3, 2, c(A.palmFrond[0]));
      g.px(tx, ty - 1, c(A.palmTrunk[0]));
    });
    return { img, ax, ay };
  }

  const rngPick = (seed) => hash(seed, 1, 2, 3) < 0.3;
  function treeSpec(t, X) {
    const s = X.season;
    const base = { seed: t.seed };
    const R3 = [
      [0, 1],
      [0.45, 6],
      [0.82, 10],
    ];
    if (t.kind === 'palm') return Object.assign(base, { type: 'palm', h: t.h, lean: t.lean, fl: 12 });
    if (t.kind === 'ficus') return Object.assign(base, { type: 'leafy', h: 34, rx: 13, ry: 11, tw: 2, cr0: 4, cr1: 6, pal: A.leafFicus, limbs: 2, rings: [[0, 1], [0.5, 4], [0.85, 7]] });
    if (t.kind === 'oak')
      return Object.assign(base, { type: 'leafy', h: 204, rx: 54, ry: 66, tw: 12, cr0: 9, cr1: 15, pal: A.leafDeep, pal2: A.leafSummer, limbs: 5, lean: 4, gaps: 0.04, jit: 0.16, shrink: 0.08, rings: [[0, 1], [0.28, 6], [0.55, 11], [0.78, 17], [0.94, 19]] });
    if (t.kind === 'dogwood') return Object.assign(base, { type: 'leafy', h: 50, rx: 18, ry: 14, tw: 2, cr0: 4, cr1: 7, pal: A.leafSummer, limbs: 3, rings: R3 });
    if (t.kind === 'locust') return Object.assign(base, { type: 'leafy', h: 66, rx: 18, ry: 17, tw: 2, cr0: 3, cr1: 5, pal: A.leafSummer, holes: 0.08, limbs: 4, rings: [[0, 1], [0.35, 5], [0.62, 9], [0.88, 13]] });
    // Boston street tree by season
    if (s === 'winter') return Object.assign(base, { type: 'bare', h: 60, rx: 19, depth: 5 });
    if (s === 'spring') return Object.assign(base, { type: 'leafy', h: 60, rx: 18, ry: 18, tw: 2, cr0: 4, cr1: 6, pal: A.blossom, pal2: rngPick(t.seed) ? A.blossomWhite : A.blossom, holes: 0.03, limbs: 4, rings: [[0, 1], [0.4, 6], [0.8, 11]], dots: { n: 26, col: '#7cae4c' } });
    if (s === 'autumn') return Object.assign(base, { type: 'leafy', h: 60, rx: 18, ry: 18, tw: 2, cr0: 4, cr1: 7, pal: A.autumnOrange, pal2: X.mode === 'night' ? A.autumnRed : A.autumnGold, gaps: 0.12 + X.leaves * 0.15, limbs: 4, rings: R3 });
    return Object.assign(base, { type: 'leafy', h: 60, rx: 18, ry: 18, tw: 2, cr0: 5, cr1: 7, pal: A.leafSummer, limbs: 3, rings: R3 });
  }

  function bakeTree(t, X) {
    const spec = treeSpec(t, X);
    const fn = spec.type === 'palm' ? bakePalm : spec.type === 'bare' ? bakeBare : bakeLeafy;
    const frames = [-1, 0, 1].map((s) => fn(spec, s, X));
    return { x: t.x, base: t.base, frames, spec, kind: t.kind, seed: t.seed };
  }

  // ------------------------------------------------------------------
  // lamps, benches, hydrants and the rest (static furniture)
  // ------------------------------------------------------------------
  /**
   * Draws a lamp's iron (non-emissive) and returns its head: the glass
   * pixels [x, y, tone] and where its light sits.
   */
  function drawLamp(g, X, L) {
    const c = X.c;
    const x = L.x;
    const b = L.base;
    const iron = L.kind === 'harbor' ? A.green : L.kind === 'arm' ? A.bronze : L.kind === 'la' ? A.pale : A.iron;
    const glass = [];
    let hx = x;
    let hy = b - 40;
    const shaft = (top) => {
      for (let y = top; y <= b; y++) {
        g.px(x, y, c(iron[1]));
        g.px(x + 1, y, c(iron[2]));
      }
    };
    const snowCap = (x0, x1, y) => {
      if (X.snow > 0) for (let xx = x0; xx <= x1; xx++) g.px(xx, y, SNOW_N[X.snow > 0.6 ? 3 : 2]);
    };
    if (L.kind === 'lantern' || L.kind === 'post') {
      // Boston A: a post with a collar and a four-pane lantern under a
      // peaked cap (Herndon: the same lantern on a short post)
      const post = L.kind === 'post';
      const top = b - (post ? 22 : 37);
      shaft(top);
      g.rect(x - 2, b - 4, 6, 5, c(iron[1]));
      g.hline(x - 2, x + 3, b - 4, c(iron[3]));
      if (!post) g.rect(x - 1, b - 10, 4, 2, c(iron[2]));
      g.rect(x - 1, top + 2, 4, 2, c(iron[2]));
      const ly = top - 7;
      g.rect(x - 2, ly + 6, 6, 1, c(iron[0]));
      g.rect(x - 1, ly + 7, 4, 1, c(iron[1]));
      for (let yy = ly + 1; yy <= ly + 5; yy++) {
        g.px(x - 2, yy, c(iron[0]));
        g.px(x + 3, yy, c(iron[1]));
        for (let xx = x - 1; xx <= x + 2; xx++) glass.push([xx, yy, yy === ly + 1 ? 0 : xx === x || xx === x + 1 ? 2 : 1]);
      }
      g.rect(x - 3, ly, 8, 1, c(iron[1]));
      g.hline(x - 2, x + 3, ly - 1, c(iron[1]));
      g.hline(x - 1, x + 2, ly - 2, c(iron[2]));
      g.px(x, ly - 3, c(iron[2]));
      g.px(x + 1, ly - 3, c(iron[1]));
      snowCap(x - 3, x + 4, ly - 1);
      snowCap(x - 1, x + 2, ly - 3);
      hx = x + 0.5;
      hy = ly + 3;
    } else if (L.kind === 'arm') {
      // Boston B: a slim modern pole, an arched arm and a hanging globe
      const top = b - 40;
      shaft(top);
      g.rect(x - 1, b - 3, 4, 4, c(iron[1]));
      g.hline(x - 1, x + 2, b - 3, c(iron[3]));
      for (const [dx, dy] of [[0, 0], [1, -1], [2, -2], [3, -2], [4, -2], [5, -2], [6, -1], [7, 0]]) g.px(x + 1 + dx, top + dy, c(iron[2]));
      g.px(x + 8, top + 1, c(iron[1]));
      const gx = x + 8;
      const gy = top + 3;
      g.hline(gx - 1, gx + 1, gy - 1, c(iron[1]));
      for (const [dx, dy, t] of [[-1, 0, 1], [0, 0, 2], [1, 0, 1], [-2, 1, 1], [-1, 1, 2], [0, 1, 2], [1, 1, 2], [2, 1, 1], [-2, 2, 1], [-1, 2, 2], [0, 2, 2], [1, 2, 1], [2, 2, 0], [-1, 3, 1], [0, 3, 1], [1, 3, 0]]) glass.push([gx + dx, gy + dy, t]);
      snowCap(x + 1, x + 7, top - 3);
      hx = gx;
      hy = gy + 2;
    } else if (L.kind === 'crook') {
      // SoHo: a cast-iron bishop's crook with a fluted base and an acorn lantern
      const top = b - 42;
      shaft(top);
      g.rect(x - 2, b - 7, 6, 8, c(iron[1]));
      for (let yy = b - 6; yy <= b; yy += 2) g.hline(x - 2, x + 3, yy, c(iron[0]));
      g.hline(x - 2, x + 3, b - 7, c(iron[2]));
      g.rect(x - 1, b - 12, 4, 2, c(iron[2]));
      const d = L.dir || -1;
      const x0 = x + (d < 0 ? 0 : 1);
      for (const [dx, dy] of [[0, 0], [0, -1], [1, -2], [2, -3], [3, -3], [4, -3], [5, -2], [6, -1], [6, 0]]) g.px(x0 + dx * d, top + dy, c(iron[2]));
      g.px(x0 + 2 * d, top - 1, c(iron[1]));
      g.px(x0 + 1 * d, top - 1, c(iron[1]));
      const gx = x0 + 6 * d;
      const gy = top + 1;
      g.hline(gx - 2, gx + 2, gy, c(iron[1]));
      g.hline(gx - 1, gx + 1, gy - 1, c(iron[2]));
      for (let yy = gy + 1; yy <= gy + 4; yy++) for (let xx = gx - 2; xx <= gx + 2; xx++) if (!(yy === gy + 4 && Math.abs(xx - gx) === 2)) glass.push([xx, yy, Math.abs(xx - gx) < 1 ? 2 : 1]);
      g.px(gx, gy + 5, c(iron[1]));
      snowCap(gx - 2, gx + 2, gy - 1);
      hx = gx;
      hy = gy + 3;
    } else if (L.kind === 'la') {
      // LA: a tall slim pale pole with a short arm and a teardrop luminaire
      const top = b - 52;
      shaft(top);
      g.rect(x - 1, b - 5, 4, 6, c(iron[1]));
      g.hline(x - 1, x + 2, b - 5, c(iron[3]));
      for (let i = 0; i < 5; i++) g.px(x - 1 - i, top + (i < 2 ? 0 : -1), c(iron[2]));
      const gx = x - 6;
      const gy = top;
      g.hline(gx - 1, gx + 1, gy, c(iron[1]));
      for (const [dx, dy, t] of [[-1, 1, 1], [0, 1, 2], [1, 1, 1], [0, 2, 2]]) glass.push([gx + dx, gy + dy, t]);
      hx = gx;
      hy = gy + 2;
    } else if (L.kind === 'harbor') {
      // marina: a dark green post with a lantern top (and a plain banner)
      const top = b - 36;
      shaft(top);
      g.rect(x - 1, b - 4, 4, 5, c(iron[1]));
      g.hline(x - 1, x + 2, b - 4, c(iron[3]));
      const ly = top - 6;
      g.rect(x - 2, ly + 5, 6, 1, c(iron[0]));
      for (let yy = ly + 1; yy <= ly + 4; yy++) {
        g.px(x - 2, yy, c(iron[0]));
        g.px(x + 3, yy, c(iron[1]));
        for (let xx = x - 1; xx <= x + 2; xx++) glass.push([xx, yy, xx === x || xx === x + 1 ? 2 : 1]);
      }
      g.hline(x - 2, x + 3, ly, c(iron[1]));
      g.hline(x - 1, x + 2, ly - 1, c(iron[2]));
      if (L.banner) {
        g.hline(x + 2, x + 9, top + 8, c(iron[2]));
        g.hline(x + 2, x + 9, top + 22, c(iron[2]));
        g.rect(x + 3, top + 9, 7, 13, c('#24386a'));
        g.vline(x + 9, top + 9, top + 21, c('#1a2a52'));
        g.vline(x + 3, top + 9, top + 21, c('#34508a'));
        g.hline(x + 3, x + 9, top + 19, c('#c8b070'));
      }
      hx = x + 0.5;
      hy = ly + 2;
    }
    return { x: L.x, base: b, hx, hy, glass, kind: L.kind, h: b - hy };
  }

  function drawLampGlass(g, X, head, lit) {
    if (lit) {
      for (const [x, y, t] of head.glass) g.px(x, y, GLOW.lamp[t + 1]);
    } else {
      // unlit glass: pale, catching the sky
      for (const [x, y, t] of head.glass) g.px(x, y, X.c(t === 2 ? '#d8e4ec' : t === 0 ? '#7c8a96' : '#a8b8c6'));
    }
  }

  function drawBench(g, X, b) {
    const c = X.c;
    const k = X.wet ? 0.75 : 1;
    const x0 = b.x0;
    const x1 = b.x1;
    const s = b.seat;
    const iron = A.iron;
    if (b.kind === 'park') {
      // a classic park bench: three back slats, the seat, cast-iron ends
      for (let i = 0; i < 3; i++) g.hline(x0 + 1, x1 - 1, s - 8 + i * 2, c(A.wood[2 + (i & 1)], k));
      for (let i = 0; i < 3; i++) g.hline(x0 + 1, x1 - 1, s - 7 + i * 2, c(A.wood[0], k));
      g.hline(x0, x1, s - 1, c(A.wood[3], k));
      g.hline(x0, x1, s, c(A.wood[1], k));
      const mid = R((x0 + x1) / 2);
      for (const ex of [x0, x1, mid]) {
        g.vline(ex, s - 9, b.base, c(iron[1], k));
        if (ex !== mid) g.px(ex + (ex === x0 ? 1 : -1), s - 3, c(iron[2], k));
      }
      g.hline(x0 + 1, x1 - 1, s + 1, c(iron[0], k));
    } else {
      // plaza bench: slatted seat and back on dark steel frames
      for (let i = 0; i < 2; i++) g.hline(x0 + 1, x1 - 1, s - 6 + i * 2, c(A.wood[3 - i], k));
      g.hline(x0 + 1, x1 - 1, s - 5, c(A.wood[0], k));
      g.hline(x0, x1, s - 1, c(A.wood[3], k));
      g.hline(x0, x1, s, c(A.wood[1], k));
      for (const ex of [x0 + 1, x1 - 1]) {
        g.vline(ex, s - 7, b.base, c(iron[1], k));
        g.px(ex, s + 1, c(iron[2], k));
      }
    }
    for (let x = x0 + 1; x < x1; x++) if ((x & 1) === 0) g.px(x, b.base, 'rgba(0,0,0,0.35)');
    if (X.snow > 0)
      for (let x = x0; x <= x1; x++) {
        if (hash(x, s, 1, 2) < 0.4 + X.snow * 0.6) g.px(x, s - 2, SNOW_N[3]);
        if (X.snow > 0.6) g.px(x, s - 1, SNOW_N[2]);
      }
  }

  function drawHydrant(g, X, h) {
    const c = X.c;
    const x = h.x;
    const b = h.base;
    const body = h.kind === 'la' ? ['#7a5a10', '#c89a1c', '#eac03a'] : h.kind === 'nyc' ? ['#5a5e64', '#8a9098', '#b8bec6'] : ['#6a1a14', '#a8281e', '#d24a34'];
    const cap = h.kind === 'nyc' ? ['#6a1a14', '#b02a20'] : h.kind === 'la' ? ['#7a5a10', '#d8aa2a'] : ['#7a7e86', '#b4b8c0'];
    g.rect(x - 2, b - 1, 6, 2, c(body[0]));
    g.rect(x - 1, b - 7, 4, 6, c(body[1]));
    g.vline(x + 2, b - 7, b - 2, c(body[0]));
    g.vline(x - 1, b - 6, b - 2, c(body[2]));
    g.rect(x - 2, b - 5, 6, 2, c(body[1]));
    g.px(x - 2, b - 5, c(cap[1]));
    g.px(x + 3, b - 5, c(cap[0]));
    g.rect(x - 1, b - 9, 4, 2, c(cap[1]));
    g.px(x, b - 10, c(cap[1]));
    g.px(x + 1, b - 10, c(cap[0]));
    if (X.snow > 0) {
      g.hline(x - 1, x + 2, b - 10, SNOW_N[3]);
      g.px(x - 2, b - 6, SNOW_N[2]);
    }
  }

  function drawRack(g, X, r) {
    const c = X.c;
    for (let i = 0; i < r.n; i++) {
      const x = r.x + i * 8;
      g.vline(x, r.base - 5, r.base, c(A.steel[1]));
      g.vline(x + 4, r.base - 5, r.base, c(A.steel[0]));
      g.hline(x + 1, x + 3, r.base - 6, c(A.steel[2]));
      if (X.snow > 0) g.hline(x, x + 4, r.base - 7, SNOW_N[2]);
    }
  }

  function drawBollard(g, X, b) {
    const c = X.c;
    g.rect(b.x - 1, b.base - 6, 3, 7, c(A.iron[1]));
    g.vline(b.x + 1, b.base - 6, b.base, c(A.iron[2]));
    g.hline(b.x - 1, b.x + 1, b.base - 6, c(A.iron[3]));
    g.hline(b.x - 1, b.x + 1, b.base - 4, c('#c8a84a'));
    if (X.snow > 0) g.hline(b.x - 1, b.x + 1, b.base - 7, SNOW_N[3]);
  }

  function drawBin(g, X, b) {
    // a wire-mesh corner basket
    const c = X.c;
    const x = b.x;
    const y = b.base;
    g.rect(x - 3, y - 8, 7, 9, c('#2a2e2c'));
    for (let yy = y - 7; yy <= y; yy += 2) g.hline(x - 3, x + 3, yy, c('#4a5250'));
    for (let xx = x - 2; xx <= x + 2; xx += 2) g.vline(xx, y - 8, y, c('#3a4240'));
    g.hline(x - 3, x + 3, y - 8, c('#6a7270'));
  }

  function drawPlanter(g, X) {
    // apt2's corner tree stands in a raised granite planter
    const c = X.c;
    const x = 26;
    g.rect(x - 12, 208, 25, 8, c('#8a8680'));
    g.hline(x - 12, x + 12, 208, c('#c0bcb4'));
    g.hline(x - 12, x + 12, 215, c('#5c5852'));
    for (let xx = x - 11; xx <= x + 11; xx++) g.px(xx, 207, c(X.season === 'winter' ? '#4a3c30' : '#3e5a2a'));
    if (X.snow > 0) snowCover(g, X, x - 12, x + 12, 206, 208, Math.min(1, X.snow * 1.8), 77);
  }

  function drawFence(g, X) {
    // white pickets with two rails; open in the middle for the party
    const c = X.c;
    const b = 234;
    const fence = X.pl.ground.fence;
    for (const [x0, x1] of fence.runs) {
      g.hline(x0, x1, b - 7, c('#d8d6ce'));
      g.hline(x0, x1, b - 3, c('#d8d6ce'));
      for (let x = x0; x <= x1; x += 3) {
        g.vline(x, b - 10, b, c('#ecebe4'));
        g.vline(x + 1, b - 9, b, c('#c4c2ba'));
        g.px(x, b - 11, c('#f4f2ec'));
      }
      for (let x = x0; x <= x1; x++) g.px(x, b + 1, c('#26401a'));
    }
    for (const gx of fence.gates) {
      g.rect(gx - 1, b - 14, 3, 15, c('#e4e2da'));
      g.vline(gx + 1, b - 14, b, c('#b8b6ae'));
      g.rect(gx - 1, b - 16, 3, 2, c('#f4f2ec'));
      g.px(gx, b - 17, c('#f4f2ec'));
    }
  }

  // ------------------------------------------------------------------
  // cars (generic shapes, no badges)
  // ------------------------------------------------------------------
  const CAR_COLS = ['#a83a32', '#2f4a7a', '#a8adb4', '#dcdcd6', '#2f7f80', '#c8963a', '#30323a', '#5e7a4a', '#7a3a5a'];
  const CAR_TYPES = {
    sedan: { L: 34, Hb: 5, cab: [9, 25], roof: [12, 21], ch: 4, wheels: [6, 27] },
    hatch: { L: 29, Hb: 5, cab: [5, 21], roof: [6, 17], ch: 4, wheels: [5, 23] },
    wagon: { L: 36, Hb: 6, cab: [4, 27], roof: [5, 23], ch: 4, wheels: [7, 29] },
    van: { L: 37, Hb: 6, cab: [2, 29], roof: [2, 26], ch: 5, wheels: [7, 30] },
  };
  /** a car facing right: {img, L, H, head:[x,y], tail:[x,y], bot} (bot: tyre contact row) */
  function bakeCar(type, body, X, taxi, wheelFrame) {
    const S = CAR_TYPES[type];
    const c = X.c;
    const L = S.L;
    const yRoof = 1;
    const yBelt = yRoof + S.ch + 1;
    const yBot = yBelt + S.Hb - 1;
    const Hc = yBot + 4;
    const b = [mixA(body, '#000000', 0.45), mixA(body, '#000000', 0.2), body, mixA(body, '#ffffff', 0.35)];
    const img = HD.bake(L, Hc, (g) => {
      for (let y = yRoof + 1; y < yBelt; y++) {
        const f = (y - yRoof - 1) / Math.max(1, S.ch - 1);
        const x0 = R(S.roof[0] + (S.cab[0] - S.roof[0]) * f);
        const x1 = R(S.roof[1] + (S.cab[1] - S.roof[1]) * f);
        g.hline(x0, x1, y, c(b[1]));
        g.hline(x0 + 1, x1 - 1, y, c('#3a4a5a'));
        const bp = R((S.cab[0] + S.cab[1]) / 2 + (type === 'van' ? 4 : 0));
        g.px(bp, y, c(b[1]));
      }
      g.hline(S.roof[0], S.roof[1], yRoof, c(b[3]));
      g.px(S.roof[1] - 2, yRoof + 2, c('#a4b8cc'));
      g.px(S.roof[1] - 3, yRoof + 3, c('#a4b8cc'));
      g.px(S.roof[0] + 3, yRoof + 2, c('#6a8098'));
      for (let y = yBelt; y <= yBot; y++) {
        const r = y === yBelt || y === yBot ? 1 : 0;
        g.hline(r, L - 1 - r, y, c(y === yBelt ? b[3] : y === yBot ? b[0] : y === yBelt + 1 ? b[2] : b[1]));
      }
      g.hline(2, L - 3, yBelt + 2, c(b[2]));
      const bp = R((S.cab[0] + S.cab[1]) / 2);
      g.vline(bp, yBelt + 1, yBot - 1, c(b[0]));
      g.vline(S.cab[0] + 1, yBelt + 1, yBot - 1, c(b[1]));
      g.px(bp - 3, yBelt + 1, c(b[3]));
      g.px(bp + 3, yBelt + 1, c(b[3]));
      for (const wx of S.wheels) {
        g.hline(wx - 2, wx + 2, yBot - 1, c('#141418'));
        g.hline(wx - 3, wx + 3, yBot, c('#141418'));
        g.rect(wx - 2, yBot + 1, 5, 2, c('#1a1a1e'));
        g.hline(wx - 1, wx + 1, yBot + 3, c('#1a1a1e'));
        g.px(wx, yBot + 1, c('#9a9ea6'));
        g.px(wheelFrame ? wx - 1 : wx + 1, yBot + 1, c('#5a5e66'));
        g.px(wx, yBot + 2, c(wheelFrame ? '#6a6e76' : '#3a3e46'));
      }
      g.hline(S.wheels[0] + 3, S.wheels[1] - 3, yBot + 1, c('#101014'));
      g.px(L - 1, yBelt + 1, c('#e8e4d0'));
      g.px(0, yBelt + 1, c('#a8281e'));
      g.px(0, yBelt + 2, c('#7a1e16'));
      g.px(L - 1, yBot - 1, c('#5a5e66'));
      g.px(0, yBot - 1, c('#5a5e66'));
      if (taxi) {
        const mx = R((S.roof[0] + S.roof[1]) / 2);
        g.hline(mx - 1, mx + 2, yRoof - 1, c('#f0e8c8'));
        for (let x = 3; x < L - 3; x += 2) g.px(x, yBelt + 3, c('#202020'));
      }
      if (X.snow > 0) {
        g.hline(S.roof[0], S.roof[1], yRoof, SNOW_N[3]);
        if (X.snow > 0.6) {
          g.hline(S.roof[0] + 1, S.roof[1] - 1, yRoof - 1, SNOW_N[2]);
          g.hline(S.cab[1] + 2, L - 3, yBelt, SNOW_N[2]);
          g.hline(2, S.cab[0] - 2, yBelt, SNOW_N[2]);
        }
      }
    });
    return { img, L, H: Hc, head: [L - 1, yBelt + 1], tail: [0, yBelt + 1], bot: yBot + 3 };
  }

  /** the passing-car schedule of an edition: [{t0, dur, dir, far, type, col, taxi}] */
  function carSchedule(X) {
    const cc = X.cfg.cars;
    if (!cc) return [];
    const rng = HD.rng(X.seed + 3001 + cc.shift);
    const out = [];
    const n = cc.n;
    const span = HD.LOOP - 20;
    const types = ['sedan', 'hatch', 'wagon', 'sedan', 'van'];
    for (let i = 0; i < n; i++) {
      const slot = span / n;
      const t0 = cc.rare ? 168 : 8 + i * slot + rng() * (slot - 14);
      const dur = cc.rare ? 11 : 7.5 + rng() * 3;
      const far = X.wet || X.pl.id === 'herndon' ? true : rng() < 0.6;
      const type = types[(rng() * types.length) | 0];
      let col = CAR_COLS[(rng() * CAR_COLS.length) | 0];
      const taxi = !!cc.taxi && i % 2 === 0;
      if (taxi) col = '#e8b424';
      out.push({ t0, dur, dir: far ? -1 : 1, far, type: taxi ? 'sedan' : type, col, taxi });
    }
    return out;
  }

  /** the lane of a car: its tyre contact row */
  function laneY(X, far) {
    const id = X.pl.id;
    if (id === 'herndon') return 263;
    if (id === 'soho') return far ? 246 : 263;
    if (id === 'apt2') return far ? 250 : 266;
    if (id === 'bhills') return far ? 248 : 262;
    return far ? 248 : 265;
  }

  // ------------------------------------------------------------------
  // cast shadows: the sun stands behind the scene on the right, so shadows
  // fall towards the viewer and to the left (away from HD.light().sun)
  // ------------------------------------------------------------------
  function sunVec(X) {
    if (X.mode === 'day') return { vx: -0.34, vy: 0.15, k: 0.46 };
    if (X.mode === 'golden') return { vx: -1.15, vy: 0.15, k: 0.58 };
    return null;
  }

  function ellipsePoly(cx, cy, rx, ry, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return pts;
  }

  function buildShades(X, out) {
    const sv = sunVec(X);
    if (!sv) return [];
    const S = [];
    const { vx, vy, k } = sv;
    // a vertical stick of height h standing at (x, base), w px wide
    const stick = (x, base, h, w, kk) => {
      S.push({ poly: [[x, base], [x + w, base], [x + w + vx * h, base + vy * h], [x + vx * h, base + vy * h]], k: kk || k });
    };
    // buildings: where the skyline steps down to the left, the taller block
    // throws a triangle of shade over the sidewalk in front of its lower
    // neighbour (its own frontage keeps the light, so the cats there do too)
    const pl = X.pl;
    if (pl.id !== 'herndon') {
      const top = (x) => (x < 0 || x >= W ? 999 : HD.placeTop(x));
      for (let x = 1; x < W; x++) {
        const hR = Math.max(0, 206 - top(x));
        const hL = Math.max(0, 206 - top(x - 1));
        if (hR < 12 || hL > hR * 0.7) continue;
        let h = hR;
        if (pl.id === 'marina' && top(x) < 150) h = Math.min(hR, 60); // set-back towers
        S.push({ poly: [[x, 206], [x + vx * h, 206 + vy * h], [x, 206 + vy * h]], k });
      }
    }
    for (const L of out.lamps) {
      stick(L.x, L.base, L.h, 2);
      S.push({ poly: ellipsePoly(L.hx + vx * L.h, L.base + vy * L.h, 3, 1.5, 8), k });
    }
    for (const t of out.trees) {
      const sp = t.spec;
      if (sp.type === 'palm') {
        stick(t.x, t.base, sp.h, 2);
        // the crown's shadow: a flattened star of fronds
        const cx = t.x + sp.lean + vx * sp.h;
        const cy = t.base + vy * sp.h;
        const star = [];
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * TAU + 0.2;
          const rr = i & 1 ? 0.42 : 1;
          star.push([cx + Math.cos(a) * rr * (11 + Math.abs(vx) * 3), cy + Math.sin(a) * rr * (2.6 + vy * 8)]);
        }
        S.push({ poly: star, k });
      } else {
        const hc = sp.type === 'bare' ? sp.h * 0.65 : sp.h - sp.ry;
        stick(t.x, t.base, hc * 0.6, sp.tw || 2);
        const rx = (sp.rx || 14) + Math.abs(vx) * (sp.ry || 12) * 0.5;
        const ry = Math.max(2, (sp.rx || 14) * 0.25 + vy * (sp.ry || 12));
        S.push({ poly: ellipsePoly(t.x + vx * hc, t.base + vy * hc + 1, rx, ry, 14), k: sp.type === 'bare' ? k * 0.45 : k });
      }
    }
    for (const b of X.cfg.benches) S.push({ poly: [[b.x0, b.base - 1], [b.x1, b.base - 1], [b.x1 + vx * 5, b.base + vy * 5 + 1], [b.x0 + vx * 5, b.base + vy * 5 + 1]], k });
    for (const h of X.cfg.hydrants) stick(h.x - 1, h.base, 9, 4);
    for (const b of X.cfg.bollards) stick(b.x - 1, b.base, 6, 3);
    for (const r of X.cfg.racks) for (let i = 0; i < r.n; i++) stick(r.x + i * 8, r.base, 6, 5, k * 0.5);
    return S;
  }

  // ------------------------------------------------------------------
  // per-edition bake
  // ------------------------------------------------------------------
  const art = HD.perEdition(function (ed) {
    const X = contextOf(ed);
    const cfg = X.cfg;
    const out = { X, lamps: [], trees: [], shades: [], cars: [], glints: [], frontEm: null };
    out.ground = HD.bake(W, H, (g) => GROUND[X.pl.id](g, X));
    for (const t of cfg.trees) out.trees.push(bakeTree(t, X));
    out.trees.sort((p, q) => p.base - q.base);
    const heads = [];
    out.front = HD.bake(W, H, (g) => {
      if (X.pl.id === 'apt2') drawPlanter(g, X);
      for (const b of cfg.bollards) drawBollard(g, X, b);
      for (const r of cfg.racks) drawRack(g, X, r);
      for (const b of cfg.benches) drawBench(g, X, b);
      for (const h of cfg.hydrants) drawHydrant(g, X, h);
      for (const b of cfg.bins) drawBin(g, X, b);
      if (X.pl.id === 'herndon') drawFence(g, X);
      for (const L of cfg.lamps) heads.push(drawLamp(g, X, L));
      if (!X.lit) for (const hd of heads) drawLampGlass(g, X, hd, false);
    });
    // lit lamp glass is emissive: its own sprite, drawn through g.em
    if (X.lit) out.frontEm = HD.bake(W, H, (g) => heads.forEach((hd) => drawLampGlass(g, X, hd, true)));
    out.lamps = heads;
    out.cars = carSchedule(X);
    for (const car of out.cars) {
      car.frames = [0, 1].map((wf) => bakeCar(car.type, car.col, X, car.taxi, wf));
      car.y = laneY(X, car.far);
    }
    out.shades = buildShades(X, out);
    if (X.snow > 0) {
      const rng = HD.rng(X.seed + 71);
      for (let i = 0; i < 26; i++) out.glints.push({ x: R(rng() * W), y: R(207 + rng() * 22), s: rng() });
    }
    out.water = X.pl.id === 'marina';
    if (out.water) {
      out.dockMask = new Uint8Array(W * 34);
      for (let y = 236; y <= 269; y++) for (let x = 0; x < W; x++) out.dockMask[(y - 236) * W + x] = isDock(x, y) ? 1 : 0;
    }
    return out;
  });

  // ------------------------------------------------------------------
  // the passing car at time t
  // ------------------------------------------------------------------
  const CAR = { on: false, x: 0, y: 0, dir: 1, spr: null, car: null };
  function carAt(A0, t) {
    CAR.on = false;
    const s = ((t % HD.LOOP) + HD.LOOP) % HD.LOOP;
    for (const car of A0.cars) {
      if (s < car.t0 || s >= car.t0 + car.dur) continue;
      const u = (s - car.t0) / car.dur;
      const L = car.frames[0].L;
      const span = W + L + 20;
      const travelled = u * span;
      CAR.on = true;
      CAR.x = R(car.dir > 0 ? -L - 10 + travelled : W + 10 - travelled);
      CAR.dir = car.dir;
      CAR.car = car;
      CAR.spr = car.frames[Math.floor(travelled / 3) & 1];
      CAR.y = car.y - CAR.spr.bot;
      return CAR;
    }
    return CAR;
  }

  // ------------------------------------------------------------------
  // passes
  // ------------------------------------------------------------------
  function drawGround(g, t) {
    const A0 = art();
    const X = A0.X;
    g.sprite(A0.ground, 0, 0);
    // snow crystals twinkle where a lamp catches them
    if (A0.glints.length) {
      for (let i = 0; i < A0.glints.length; i++) {
        const gl = A0.glints[i];
        const cy = T.cycle(t, i, 3.7 + gl.s * 3, 4401);
        if (cy.age < 0.86) continue;
        if (X.mode === 'night' && HD.lights.lum(gl.x, gl.y) < 0.08) continue;
        g.em.px(gl.x, gl.y, cy.age > 0.93 ? '#ffffff' : '#dfe8ff');
      }
    }
    // a leaf skittering along the sidewalk now and then
    if (X.leaves > 0 && X.season === 'autumn' && X.pl.id !== 'marina') {
      for (let i = 0; i < 3; i++) {
        const cy = T.cycle(t, i, 26, 4501);
        const u = cy.age * 3;
        if (u >= 1) continue;
        const dir = cy.rnd(1) < 0.7 ? -1 : 1;
        const y0 = 208 + R(cy.rnd(2) * 16);
        const x = R(dir < 0 ? W + 4 - u * (W + 8) : -4 + u * (W + 8));
        const hop = Math.abs(Math.sin(u * TAU * 7 + cy.rnd(3) * 6)) * 2.2;
        const y = R(y0 - hop);
        const col = X.c(LEAF_COLS[(cy.rnd(4) * LEAF_COLS.length) | 0]);
        const flip = Math.floor(t * 8 + 1e-6) & 1;
        g.px(x, y, col);
        g.px(x + flip, y - 1 + flip, col);
      }
    }
  }

  function drawCar(g, t) {
    const A0 = art();
    if (!A0.cars.length) return;
    const C0 = carAt(A0, t);
    if (!C0.on) return;
    const s = C0.spr;
    g.sprite(s.img, C0.x, C0.y, C0.dir < 0);
    if (A0.X.lit) {
      const e = g.em;
      const hx = C0.dir > 0 ? C0.x + s.head[0] : C0.x + (s.L - 1 - s.head[0]);
      const tx = C0.dir > 0 ? C0.x + s.tail[0] : C0.x + (s.L - 1 - s.tail[0]);
      e.px(hx, C0.y + s.head[1], GLOW.head);
      e.px(hx, C0.y + s.head[1] + 1, GLOW.headDim);
      e.px(tx, C0.y + s.tail[1], GLOW.tail);
      e.px(tx, C0.y + s.tail[1] + 1, GLOW.tailDim);
    }
  }

  /** a rare short buzz-out of one lamp at Halloween */
  function lampOff(t, i) {
    const cy = T.cycle(t, i, 37, 4701);
    const a = cy.age * cy.P;
    return a > 20 && a < 21.4 && T.flicker(t, 4702, 3) > 0.45;
  }

  function drawFront(g, t) {
    const A0 = art();
    const X = A0.X;
    for (let i = 0; i < A0.trees.length; i++) {
      const tr = A0.trees[i];
      const n = T.noise(t, 3.2 + i * 0.7, 4600 + tr.seed) - 0.5;
      const f = tr.frames[n > 0.16 ? 2 : n < -0.16 ? 0 : 1];
      g.sprite(f.img, tr.x - f.ax, tr.base - f.ay);
    }
    g.sprite(A0.front, 0, 0);
    if (A0.frontEm) {
      g.em.sprite(A0.frontEm, 0, 0);
      if (X.halloween) {
        const li = A0.lamps.length - 1;
        if (lampOff(t, li)) for (const [x, y] of A0.lamps[li].glass) g.px(x, y, X.c('#8a7a60'));
      }
    }
  }

  // ------------------------------------------------------------------
  // marina: the water mirrors what stands above it, then waves and glitter
  // ------------------------------------------------------------------
  function drawMarinaWater(g, t) {
    const A0 = art();
    if (!A0.water) return;
    const X = A0.X;
    const ctx = g.ctx;
    const yW0 = 236;
    const yW1 = 269;
    const ym = 214; // mirror line: the podium foot seen across the promenade
    const sTop = 2 * ym - yW1 - 1;
    const sBot = 2 * ym - yW0 - 1;
    const src = ctx.getImageData(0, sTop, W, sBot - sTop + 1).data;
    const img = ctx.getImageData(0, yW0, W, yW1 - yW0 + 1);
    const d = img.data;
    const ph = T.phase(t, 6, 0.2);
    const tq = (T.step(t, 4) * 4) | 0;
    const mask = A0.dockMask;
    for (let y = yW0; y <= yW1; y++) {
      const f = (y - yW0) / (yW1 - yW0);
      const kk = 0.42 - f * 0.22;
      const k1 = 1 - kk;
      const wob = R(Math.sin(TAU * (ph + y * 0.21)) * (0.6 + f * 1.4));
      const sy = 2 * ym - y - 1 - sTop;
      const mrow = (y - yW0) * W;
      for (let x = 0; x < W; x++) {
        if (mask[mrow + x]) continue;
        // ripples break the mirror into short runs
        if ((x & 7) === 0 && fh(x >> 3, y, tq) < 0.18) {
          x += 7;
          continue;
        }
        const sx = x + wob < 0 ? 0 : x + wob >= W ? W - 1 : x + wob;
        const si = (sy * W + sx) * 4;
        if (src[si + 3] === 0) continue;
        const di = (mrow + x) * 4;
        d[di] = d[di] * k1 + src[si] * 0.8 * kk;
        d[di + 1] = d[di + 1] * k1 + src[si + 1] * 0.9 * kk;
        d[di + 2] = d[di + 2] * k1 + src[si + 2] * kk;
      }
    }
    ctx.putImageData(img, 0, yW0);
    // wave highlights drifting slowly
    const lite = X.c(WATER[5]);
    const mid = X.c(WATER[4]);
    for (let i = 0; i < 46; i++) {
      const cy = T.cycle(t, i, 4.5, 4801);
      const y = R(237 + cy.rnd(1) * 32);
      const x = R(cy.rnd(2) * W + cy.age * 6 * (cy.rnd(3) < 0.5 ? -1 : 1));
      const len = R(2 + cy.rnd(4) * 4 * (1 - Math.abs(cy.age - 0.5) * 1.6));
      if (len < 1 || isDock(x, y) || isDock(x + len, y)) continue;
      g.hline(x, x + len, y, cy.age > 0.3 && cy.age < 0.7 ? lite : mid);
    }
    // sun glitter: emissive sparkles, densest under the sun
    if (X.mode === 'day' || X.mode === 'golden') {
      const sun = X.lt.sun || { x: 400 };
      const e = g.em;
      for (let i = 0; i < 40; i++) {
        const cy = T.cycle(t, i, 1.3 + (i % 5) * 0.37, 4901);
        if (cy.age > 0.5) continue;
        const near = i < 26;
        const x = R(near ? sun.x + (cy.rnd(1) + cy.rnd(2) - 1) * 46 : cy.rnd(1) * W);
        const y = R(237 + cy.rnd(3) * 32);
        if (isDock(x, y) || isDock(x - 1, y) || isDock(x + 1, y)) continue;
        e.px(x, y, cy.age < 0.25 ? '#ffffff' : '#fff2c8');
        if (cy.rnd(4) < 0.25 && cy.age > 0.15 && cy.age < 0.35) {
          e.px(x - 1, y, '#e8f4ff');
          e.px(x + 1, y, '#e8f4ff');
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // rain: broken warm reflections on the wet road (fx, after relight)
  // ------------------------------------------------------------------
  const COLR = new Float32Array(W);
  const COLG = new Float32Array(W);
  const COLB = new Float32Array(W);
  function drawWet(g, t) {
    const A0 = art();
    const X = A0.X;
    if (!X.wet || !X.cfg.cars || X.pl.id === 'herndon') return;
    const ctx = g.ctx;
    const sy0 = 168;
    const sy1 = 205;
    const sh = sy1 - sy0 + 1;
    const src = ctx.getImageData(0, sy0, W, sh).data;
    // the brightest warm light per column (lit shop windows, lamps)
    for (let x = 0; x < W; x++) {
      let best = 0;
      let br = 0;
      let bg = 0;
      let bb = 0;
      for (let y = 0; y < sh; y++) {
        const i = (y * W + x) * 4;
        const lum = src[i] * 0.5 + src[i + 1] * 0.4 + src[i + 2] * 0.1;
        if (lum > best) {
          best = lum;
          br = src[i];
          bg = src[i + 1];
          bb = src[i + 2];
        }
      }
      const k = best > 110 ? Math.min(1, (best - 110) / 110) : 0;
      COLR[x] = br * k;
      COLG[x] = bg * k;
      COLB[x] = bb * k;
    }
    const ry0 = X.pl.id === 'soho' ? 230 : 232;
    const ry1 = 268;
    const img = ctx.getImageData(0, ry0, W, ry1 - ry0 + 1);
    const d = img.data;
    const C0 = carAt(A0, t);
    const cx0 = C0.on ? C0.x - 1 : -99;
    const cx1 = C0.on ? C0.x + C0.spr.L : -99;
    const cy0 = C0.on ? C0.y - 1 : 999;
    const cy1 = C0.on ? C0.y + C0.spr.H : -1;
    const sh2 = (T.step(t, 6) * 6) | 0;
    const ph = T.phase(t, 2.3);
    for (let y = ry0; y <= ry1; y++) {
      const f = (y - ry0) / (ry1 - ry0);
      const fall = 0.42 * (1 - f) * (1 - f) + 0.08;
      // ripple lines: every few rows the mirror breaks up
      const rip = (y + ((T.step(t, 3) * 3) | 0)) % 4 === 0;
      const wob = R(Math.sin(TAU * (ph + y * 0.37)) * (0.6 + f * 1.2));
      const carRow = y >= cy0 && y <= cy1;
      const cut = rip ? 0.85 : 0.28 + 0.3 * f;
      const yo = y * 3;
      for (let x = 0; x < W; x++) {
        if (carRow && x >= cx0 && x <= cx1) continue;
        const sx = x + wob < 0 ? 0 : x + wob >= W ? W - 1 : x + wob;
        const r = COLR[sx];
        if (r === 0) continue;
        const hv = fh((x + yo) >> 2, y, sh2 + (y & 3));
        if (hv < cut) continue;
        const kk = fall * (0.55 + 0.45 * hv);
        const i = ((y - ry0) * W + x) * 4;
        d[i] = Math.min(255, d[i] + r * kk);
        d[i + 1] = Math.min(255, d[i + 1] + COLG[sx] * kk * 0.92);
        d[i + 2] = Math.min(255, d[i + 2] + COLB[sx] * kk * 0.8);
      }
    }
    ctx.putImageData(img, 0, ry0);
    if (C0.on && X.lit) {
      const s = C0.spr;
      const hx = C0.dir > 0 ? C0.x + s.head[0] : C0.x + (s.L - 1 - s.head[0]);
      const tx = C0.dir > 0 ? C0.x + s.tail[0] : C0.x + (s.L - 1 - s.tail[0]);
      for (let y = C0.y + s.bot + 1; y < Math.min(H, C0.y + s.bot + 11); y++) {
        const a = 0.42 * (1 - (y - C0.y - s.bot) / 11);
        const w = R(Math.sin(TAU * (ph + y * 0.37)) * 0.8);
        if (hash(hx, y, sh2, 5) > 0.3) g.px(hx + w, y, 'rgba(255,236,190,' + a.toFixed(2) + ')');
        if (hash(tx, y, sh2, 6) > 0.4) g.px(tx + w, y, 'rgba(255,70,50,' + (a * 0.9).toFixed(2) + ')');
      }
    }
  }

  // ------------------------------------------------------------------
  // lights and shadows
  // ------------------------------------------------------------------
  function lights(t, L) {
    const A0 = art();
    const X = A0.X;
    if (X.lit) {
      for (let i = 0; i < A0.lamps.length; i++) {
        const hd = A0.lamps[i];
        if (X.halloween && i === A0.lamps.length - 1 && lampOff(t, i)) continue;
        const hum = 0.96 + 0.04 * T.noise(t, 1.3, 4400 + i);
        const short = hd.kind === 'post';
        L.add({ x: R(hd.hx), y: R(hd.hy), r: short ? 22 : 30, ry: short ? 18 : 26, color: LAMP_LIGHT, i: 0.75 * hum, bands: 5, pow: 1.5, halo: { r: short ? 7 : 9, a: 0.32 } });
        L.add({ x: R(hd.hx), y: hd.base + 1, r: short ? 20 : 30, ry: short ? 8 : 10, color: LAMP_LIGHT_SOFT, i: 0.6 * hum, bands: 4, pow: 1.3, clip: { x0: 0, y0: hd.base - 8, x1: W - 1, y1: H - 1 } });
      }
      const C0 = carAt(A0, t);
      if (C0.on) {
        const s = C0.spr;
        const hx = C0.dir > 0 ? C0.x + s.L : C0.x - 1;
        const tx = C0.dir > 0 ? C0.x - 1 : C0.x + s.L;
        const roadY = C0.y + s.bot;
        L.add({ x: hx + C0.dir * 16, y: roadY - 2, r: 20, ry: 5, color: HEAD_LIGHT, i: 0.7, bands: 4, pow: 1.2, clip: { x0: 0, y0: roadY - 9, x1: W - 1, y1: H - 1 } });
        L.add({ x: tx, y: roadY - 4, r: 6, ry: 4, color: [1, 0.25, 0.18], i: 0.5, bands: 3 });
      }
    }
    if (A0.shades.length) {
      for (const sh of A0.shades) L.shade(sh);
      const sv = sunVec(X);
      const C0 = carAt(A0, t);
      if (C0.on && sv) {
        const s = C0.spr;
        const yb = C0.y + s.bot;
        const hh = 9;
        L.shade({ poly: [[C0.x + 1, yb - 1], [C0.x + s.L - 1, yb - 1], [C0.x + s.L - 1 + sv.vx * hh, yb + sv.vy * hh + 1], [C0.x + 1 + sv.vx * hh, yb + sv.vy * hh + 1]], k: sv.k });
      }
    }
  }

  // ------------------------------------------------------------------
  // registration
  // ------------------------------------------------------------------
  HD.PLACES.soho.manhole = { x: 325, y: 249 };
  HD.street = {
    /** are the street lamps lit in the current edition */
    lampsLit: () => art().X.lit,
    /** lamp heads of the current place [{x, base, hx, hy}] */
    lamps: () => art().lamps,
    /** the passing car at time t, or null: {x, y, w, h, dir} */
    car(t) {
      const C0 = carAt(art(), t);
      return C0.on ? { x: C0.x, y: C0.y, w: C0.spr.L, h: C0.spr.H, dir: C0.dir } : null;
    },
  };

  HD.module('street', {
    lights,
    passes: [
      { layer: 'scene', z: 15, id: 'ground', draw: drawGround },
      { layer: 'scene', z: 23, id: 'car', draw: drawCar },
      { layer: 'scene', z: 34.9, id: 'front', draw: drawFront },
      { layer: 'scene', z: 34.95, id: 'water', draw: drawMarinaWater },
      { layer: 'fx', z: 21, id: 'wet', draw: drawWet },
    ],
  });
})();
