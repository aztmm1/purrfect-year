/*
 * backdrops (Purrfect Year v2): the far city behind each building, between
 * the sky and the street (bg layer, z 10..19). The bg layer is never relit,
 * so every colour here is chosen per light mode.
 *
 * One bake per edition (HD.perEdition). The place's geometry is painted far
 * to near through a small light model:
 *   - materials carry their daylight colour (albedo)
 *   - faces are lit by the mode: by day and at golden hour the sun stands on
 *     the right (right faces lit, left faces in blue shade; golden is warm and
 *     low), at dusk the afterglow is on the left, at night a cool moon rim
 *     on the right
 *   - atmospheric perspective: every depth mixes toward the mode's horizon
 *     haze, plus a banded ground haze (narrow dithered seams) at the feet of
 *     far layers
 *   - windows: sky reflections by day, the sun sliding across the glass at
 *     golden hour, warm lights (a few cool ones) at dusk and night
 * Buildings left of the frame centre show their right side, buildings right
 * of it their left side, so the city keeps one vanishing point.
 *
 * Per frame: one blit of the bake, then a few dozen animated pixels (windows
 * that come and go, aviation beacons, glints, cars on the bay bridge, a
 * sailboat) and, in Boston, the orange-and-silver trains.
 */
(function () {
  'use strict';
  const HD = window.HD;
  if (!HD || !HD.module) return;
  const P = HD.PAL;
  const T = HD.time;
  const W = HD.W;
  const BH = 210; // bake rows: y 0..209 (the street covers everything below 206)
  const hash = HD.hash;
  const bayer = HD.bayer;

  // ------------------------------------------------------------------
  // colour maths (bake time only): colours are [r, g, b]
  // ------------------------------------------------------------------
  const hx = (h) => {
    const v = HD.color.hex(h);
    return [v[0], v[1], v[2]];
  };
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const css = (c) => HD.color.css(c[0], c[1], c[2]);
  const idSeed = (s) => {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  };
  /** v in 0..1 -> band 0..n, flat bands with a narrow ordered-dither seam */
  function band(v, n, x, y, seam) {
    const q = v * n;
    const b = Math.floor(q);
    const th = 0.5 + (bayer(x, y) - 0.5) * (seam === undefined ? 0.5 : seam);
    return Math.max(0, Math.min(n, b + (q - b > th ? 1 : 0)));
  }

  // materials: daylight albedo
  const M = {};
  const MATS = {
    concrete: '#bbb4a8',
    pale: '#d4cec2',
    stone: '#c9b08a',
    brick: '#a4624c',
    brickD: '#7e4a3c',
    brown: '#8a6250',
    slate: '#68707f',
    steel: '#8f97a3',
    silver: '#c9cfd7',
    white: '#ebe8e1',
    cream: '#e8dbc0',
    glass: '#7397ba',
    glassD: '#4b6787',
    glassT: '#6e9fa8',
    dark: '#434b5b',
    roof: '#5a5f6a',
    tree: '#4d7b3f',
    treeD: '#36602f',
    hill: '#93a070',
    hillD: '#6f7d52',
    mtn: '#a89078',
    mtn2: '#98836c',
    chap: '#6b6a48',
    bridge: '#3f71b4',
    orange: '#e67c2c',
    water: '#4f88bb',
    pole: '#6f5b49',
    bark: '#5a4636',
    clap1: '#9fb0bc',
    clap2: '#c4ad8e',
    trim: '#ebe7dd',
    shingle: '#5c5762',
    curtain: '#e9dcc4',
  };
  for (const k in MATS) M[k] = hx(MATS[k]);

  // faces
  const FF = 0; // front, facing the viewer
  const FL = 1; // a left side face
  const FR = 2; // a right side face
  const FT = 3; // roof edges, ledges, tops

  // face light per mode (multipliers) plus a small ambient add
  const LIGHT = {
    day: { k: [[0.92, 0.93, 0.95], [0.66, 0.71, 0.84], [1.05, 1.03, 1.0], [1.1, 1.09, 1.07]], add: [0, 3, 10] },
    golden: { k: [[0.74, 0.58, 0.5], [0.4, 0.39, 0.55], [1.2, 0.86, 0.58], [1.06, 0.8, 0.57]], add: [4, 2, 12] },
    dusk: { k: [[0.26, 0.25, 0.38], [0.44, 0.33, 0.43], [0.22, 0.22, 0.35], [0.34, 0.29, 0.42]], add: [8, 7, 18] },
    night: { k: [[0.13, 0.15, 0.25], [0.11, 0.13, 0.22], [0.18, 0.21, 0.33], [0.17, 0.19, 0.3]], add: [7, 9, 20] },
  };

  // warm window lights (weighted toward amber) and a few cool ones (TV, office)
  const WARM = [hx(P.amber[5]), hx(P.amber[6]), hx(P.amber[5]), hx(P.amber[4]), hx(P.amber[6]), hx(P.amber[7]), hx(P.amber[5]), hx(P.amber[4])];
  const COOL = [hx('#8fb0d8'), hx('#c4d4e6')];
  const OFFICE = hx('#f4e8c8');

  /** the colour script of one edition */
  function lookOf(ed) {
    const mode = ed.light || 'night';
    const wx = ed.weather || {};
    const over = ed.sky === 'overcast';
    const L = LIGHT[mode] || LIGHT.night;
    let fog;
    let glow;
    let A;
    let H;
    let refl;
    let glint = hx('#fff0c0');
    let lit = 0;
    let rim = null;
    if (mode === 'day') {
      fog = hx(ed.place === 'bhills' ? '#d4dadf' : '#c9dcec');
      glow = hx(ed.place === 'bhills' ? '#e8e0d0' : '#e2ecf3');
      A = 0.6;
      H = 0.42;
      refl = hx('#b8d4ee');
    } else if (mode === 'golden') {
      fog = hx('#d6a684');
      glow = hx('#f2c48c');
      A = 0.55;
      H = 0.45;
      refl = hx('#f0b878');
      glint = hx('#ffeab0');
      rim = hx('#ffcf8a');
    } else if (mode === 'dusk') {
      const pink = ed.sky === 'dusk';
      fog = hx(pink ? '#94688c' : '#6c5c8c');
      glow = hx(pink ? '#d08c86' : '#a87a8e');
      A = 0.5;
      H = 0.42;
      refl = hx(pink ? '#d89090' : '#a07ca0');
      rim = hx(pink ? '#e09a8c' : '#c08a9a');
      lit = 0.6;
    } else {
      fog = hx(over ? (wx.snow > 0 ? '#36385a' : '#2a2b4a') : '#232b56');
      glow = hx(over ? '#4a3a56' : '#44365e');
      A = 0.5;
      H = 0.5;
      refl = hx('#2c3866');
      rim = hx('#5a6a9a');
      lit = 1;
    }
    if (over) A += 0.05;
    A += 0.14 * (wx.rain || 0) + 0.22 * (wx.snow || 0);
    return {
      mode,
      k: L.k,
      add: L.add,
      fog,
      glow,
      A,
      H,
      refl,
      glint,
      rim,
      lit,
      snow: ed.season === 'winter',
      hz: 202,
      span: 36,
      sun: mode === 'dusk' ? FL : FR, // the face toward the light
      // where the light comes from, for round things (trees)
      L: mode === 'dusk' ? [-0.8, -0.6] : mode === 'golden' ? [0.92, -0.4] : [0.55, -0.83],
    };
  }

  // ------------------------------------------------------------------
  // the bake: an RGBA buffer painted far to near
  // ------------------------------------------------------------------
  function Bake(ed) {
    this.ed = ed;
    this.lk = lookOf(ed);
    this.d = new Uint8ClampedArray(W * BH * 4);
    this.front = null; // overlay in front of the trains (Boston)
    this.gs = idSeed(ed.place); // geometry randomness: the same city in every entry
    this.ls = idSeed(ed.id + ':lights'); // which windows are lit: per entry
    this.ids = 0;
    this.tw = []; // windows that come and go
    this.beacons = [];
    this.glints = [];
    this.top = new Int16Array(W).fill(999);
  }
  const BK = Bake.prototype;
  BK.set = function (x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= W || y < 0 || y >= BH) return;
    const i = (y * W + x) * 4;
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    this.d[i + 3] = 255;
    if (y < this.top[x]) this.top[x] = y;
  };
  BK.get = function (x, y) {
    const i = (y * W + x) * 4;
    return this.d[i + 3] ? [this.d[i], this.d[i + 1], this.d[i + 2]] : null;
  };
  /** paint into the front overlay (drawn after the trains) */
  BK.fset = function (x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= W || y < 0 || y >= BH) return;
    const F = this.front || (this.front = new Uint8ClampedArray(W * BH * 4));
    const i = (y * W + x) * 4;
    F[i] = c[0];
    F[i + 1] = c[1];
    F[i + 2] = c[2];
    F[i + 3] = 255;
  };
  /** the lit, hazed colour of material `mat` on face `face` at depth dep (0 near .. 1 far) */
  BK.c = function (mat, face, dep, x, y) {
    const lk = this.lk;
    const f = lk.k[face];
    return this.haze([mat[0] * f[0] + lk.add[0], mat[1] * f[1] + lk.add[1], mat[2] * f[2] + lk.add[2]], dep, x, y);
  };
  /** atmospheric perspective: depth fog plus banded ground haze near the horizon */
  BK.haze = function (c, dep, x, y) {
    const lk = this.lk;
    let out = mix(c, lk.fog, Math.min(0.92, lk.A * Math.pow(dep, 1.15)));
    const top = lk.hz - lk.span;
    if (y > top && dep > 0.15) {
      const b = band((y - top) / lk.span, 3, x, y);
      if (b > 0) out = mix(out, lk.glow, (b / 3) * lk.H * Math.pow(dep, 1.6));
    }
    return out;
  };
  BK.rect = function (x0, y0, x1, y1, mat, face, dep) {
    for (let y = Math.round(y0); y <= y1; y++) for (let x = Math.round(x0); x <= x1; x++) this.set(x, y, this.c(mat, face, dep, x, y));
  };
  /** a solid colour (already final) rectangle */
  BK.fillc = function (x0, y0, x1, y1, c) {
    for (let y = Math.round(y0); y <= y1; y++) for (let x = Math.round(x0); x <= x1; x++) this.set(x, y, c);
  };

  /** one window w x h at (x, y) on face `face` of building b (floor fl, column col) */
  BK.win = function (b, x, y, w, h, face, fl, col) {
    const lk = this.lk;
    const dep = b.d;
    const unit = b.pair ? col >> 1 : col; // neighbouring windows of one flat share their light
    const r = (k) => hash(b.id * 977 + fl * 61 + unit, k, this.ls, 0x51);
    const rw = (k) => hash(b.id * 977 + fl * 61 + col, k, this.ls, 0x53);
    const glass = this.c(b.glassM || M.glassD, face, dep, x, y);
    if (lk.lit > 0) {
      const fr = hash(b.id, fl, this.ls, 7); // some floors are quiet, some busy
      const p = b.p * lk.lit * (fr < 0.25 ? 0.15 : fr > 0.8 ? 1.7 : 1);
      const dark = mix(glass, [6, 8, 18], 0.35);
      if (r(1) < p) {
        const pal = r(2) < b.cool ? COOL : WARM;
        let c = pal[Math.floor(r(3) * pal.length)];
        c = mix(c, lk.fog, Math.min(0.72, lk.A * dep * 0.8));
        if (lk.mode === 'dusk') c = mix(c, glass, 0.15);
        const shade = mix(c, dark, 0.5);
        if (dep < 0.75 && rw(4) < 0.06) {
          // this one comes and goes during the loop
          this.fillc(x, y, x + w - 1, y + h - 1, dark);
          this.tw.push({ x, y, w, h, c: css(c), per: 24 + rw(5) * 40, seed: (rw(6) * 1e6) | 0, th: 0.45 });
          return;
        }
        this.fillc(x, y, x + w - 1, y + h - 1, c);
        if (w * h >= 4 && dep < 0.6) {
          // a curtain edge or a sill shadow: rooms, not stamped rectangles
          const k = rw(7);
          if (k < 0.35) for (let yy = y; yy < y + h; yy++) this.set(x + (rw(8) < 0.5 ? 0 : w - 1), yy, shade);
          else if (k < 0.6) for (let xx = x; xx < x + w; xx++) this.set(xx, y + h - 1, shade);
        }
        return;
      }
      this.fillc(x, y, x + w - 1, y + h - 1, dark);
      if (lk.mode === 'dusk' && h >= 2) for (let xx = x; xx < x + w; xx++) this.set(xx, y, mix(dark, lk.refl, face === lk.sun ? 0.35 : 0.18));
      return;
    }
    if (lk.mode === 'golden') {
      // warm dark glass; the low sun slides across the facade in a diagonal streak
      const g0 = mix(glass, lk.refl, 0.12);
      this.fillc(x, y, x + w - 1, y + h - 1, g0);
      const k = (((col - fl * 0.6 + (b.id % 7) * 3) % 8) + 8) % 8;
      if (face === lk.sun || (face === FF && k < 1.6)) {
        const g = mix(g0, lk.glint, face === FF ? 0.78 : 0.55);
        this.fillc(x, y, x + w - 1, y + h - 1, mix(g0, g, 0.6));
        for (let xx = x; xx < x + w; xx++) this.set(xx, y, g);
        if (dep < 0.6 && rw(3) < 0.08) this.glints.push({ x: x + w - 1, y, c: css(mix(g, [255, 252, 236], 0.6)), per: 3 + rw(4) * 5, seed: (rw(5) * 1e6) | 0, th: 0.7 });
      } else if (face === FF && k < 3) for (let xx = x; xx < x + w; xx++) this.set(xx, y, mix(g0, lk.glint, 0.35));
      return;
    }
    // day: glass shows the sky, brightest along its top edge; a few curtains
    this.fillc(x, y, x + w - 1, y + h - 1, glass);
    if (h >= 2) {
      const sk = mix(glass, lk.refl, face === FL ? 0.2 : 0.36);
      for (let xx = x; xx < x + w; xx++) this.set(xx, y, sk);
    }
    if (w >= 2 && h >= 3 && dep < 0.5 && rw(8) < 0.2) {
      const cu = this.c(M.curtain, face, dep, x, y);
      for (let yy = y + 1; yy < y + h; yy++) this.set(rw(9) < 0.5 ? x : x + w - 1, yy, cu);
    }
  };

  /**
   * a window grid on a face: g = {px, py, w, h, mx, my, mb, ox}
   * px/py pitch, w/h window size, mx side margin, my top margin, mb bottom margin
   */
  BK.grid = function (b, g, x0, x1, top, base, face) {
    const mx = g.mx === undefined ? 1 : g.mx;
    const y0 = top + (g.my === undefined ? 2 : g.my);
    const y1 = base - (g.mb === undefined ? 1 : g.mb);
    let fl = 0;
    for (let y = y0; y + g.h - 1 <= y1; y += g.py, fl++) {
      let col = 0;
      for (let x = x0 + mx + (g.ox || 0); x + g.w - 1 <= x1 - mx; x += g.px, col++) this.win(b, x, y, g.w, g.h, face, fl, col);
    }
  };

  /**
   * a building: o = {x0, x1, top, base, mat, d, side: {w, at: 'L'|'R'}, win, sideWin,
   *                  p (share of lit windows), cool, cap, glassM, pair, roof: [[x0, x1, h], ...]}
   */
  BK.tower = function (o) {
    const b = { id: ++this.ids, d: o.d, p: o.p === undefined ? 0.3 : o.p, cool: o.cool === undefined ? 0.05 : o.cool, glassM: o.glassM, pair: o.pair };
    const base = o.base === undefined ? this.lk.hz : o.base;
    const mat = o.mat;
    this.rect(o.x0, o.top, o.x1, base, mat, FF, o.d);
    let sx0 = 0;
    let sx1 = -1;
    let sf = FF;
    if (o.side) {
      sf = o.side.at === 'R' ? FR : FL;
      sx0 = o.side.at === 'R' ? o.x1 + 1 : o.x0 - o.side.w;
      sx1 = sx0 + o.side.w - 1;
      this.rect(sx0, o.top + (o.side.drop || 0), sx1, base, mat, sf, o.d);
    }
    if (o.cap !== false) for (let x = o.x0; x <= o.x1; x++) this.set(x, o.top, this.c(mat, FT, o.d, x, o.top));
    if (o.win) this.grid(b, o.win, o.x0, o.x1, o.top, base, FF);
    if (o.side && o.sideWin) this.grid(b, o.sideWin, sx0, sx1, o.top, base, sf);
    if (o.roof)
      for (const r of o.roof) {
        const rm = r[3] || M.roof;
        this.rect(r[0], o.top - r[2], r[1], o.top - 1, rm, FF, o.d);
        for (let x = r[0]; x <= r[1]; x++) this.set(x, o.top - r[2], this.c(rm, FT, o.d, x, o.top - r[2]));
      }
    if (this.lk.snow && o.d < 0.95) this.snowCap(o.side && o.side.at === 'L' ? sx0 : o.x0, o.side && o.side.at === 'R' ? sx1 : o.x1, o.top, o.d);
    b.x0 = o.x0;
    b.x1 = o.x1;
    b.top = o.top;
    return b;
  };
  /** a thin cap of snow along a roof edge (winter) */
  BK.snowCap = function (x0, x1, y, dep) {
    const sn = this.c(hx('#f4f6fa'), FT, dep, x0, y);
    for (let x = x0; x <= x1; x++) {
      this.set(x, y - 1, sn);
      if (x > x0 && x < x1 && hash(x, y, 3, this.gs) < 0.25) this.set(x, y - 2, sn);
    }
  };
  /** a red aviation light (blinks at dusk and night) */
  BK.beacon = function (x, y, per, off) {
    this.set(x, y, this.c(hx('#7a3030'), FF, 0.4, x, y));
    if (this.lk.lit > 0) this.beacons.push({ x, y, per: per || 3, off: off || 0 });
  };
  /** a thin mast */
  BK.mast = function (x, y0, y1, mat, dep) {
    for (let y = y0; y <= y1; y++) this.set(x, y, this.c(mat, FT, dep, x, y));
  };
  /**
   * a row of procedural blocks between x0 and x1 (tops around `top` +- jit):
   * o = {d, mats, wmin, wmax, salt, win, p}
   */
  BK.row = function (x0, x1, top, jit, o) {
    let x = x0;
    let i = 0;
    while (x <= x1) {
      const r = (k) => hash(i, k, o.salt || 1, this.gs);
      const w = Math.round(o.wmin + r(1) * (o.wmax - o.wmin));
      const tp = Math.round(top + (r(2) - 0.5) * 2 * jit);
      const mat = o.mats[Math.floor(r(3) * o.mats.length)];
      const xe = Math.min(x1, x + w - 1);
      const rx = x + 1 + Math.floor(r(6) * Math.max(1, w - 5));
      const roof = r(4) < 0.3 && w > 5 ? [[rx, rx + 2, 1 + Math.floor(r(7) * 2)]] : null;
      const win = o.win ? Object.assign({}, o.win, { ox: Math.floor(r(8) * o.win.px) }) : null;
      this.tower({ x0: x, x1: xe, top: tp, d: o.d, mat, win, p: o.p, roof, cap: true });
      x = xe + 1 + (r(5) < 0.2 ? 1 : 0);
      i++;
    }
  };

  /**
   * a glass curtain wall on [x0..x1] x [y0..y1]: mullions every `mul` px,
   * floors every `fl` px; the sky reflected in flat bands; office floors lit at night
   */
  BK.glassWall = function (b, x0, x1, y0, y1, face, o) {
    const lk = this.lk;
    const dep = b.d;
    const gm = o.mat || M.glass;
    const mul = o.mul || 3;
    const fl = o.fl || 3;
    const span = Math.max(1, y1 - y0);
    const amt = lk.mode === 'day' ? [0.06, 0.18, 0.3, 0.4] : lk.mode === 'golden' ? [0.06, 0.18, 0.32, 0.46] : lk.mode === 'dusk' ? [0.06, 0.12, 0.2, 0.26] : null;
    const kf = face === lk.sun ? 1.25 : face === FF ? 1 : 0.55;
    for (let y = y0; y <= y1; y++) {
      const v = (y - y0) / span; // 0 top .. 1 bottom
      const floor = Math.floor((y - y0) / fl);
      const isFloor = (y - y0) % fl === fl - 1;
      const on = lk.lit > 0 && hash(b.id, floor, this.ls, 21) < b.p * lk.lit;
      const office = hash(b.id, floor, 23, this.ls) < b.cool ? COOL[1] : OFFICE;
      for (let x = x0; x <= x1; x++) {
        let c = this.c(gm, face, dep, x, y);
        if (amt) c = mix(c, lk.refl, Math.min(0.8, amt[band(v, 3, x, y, 0.4)] * kf));
        else c = mix(c, [8, 10, 22], 0.15);
        const isMul = (x - x0) % mul === mul - 1;
        if (isMul) c = mix(c, [10, 12, 22], lk.mode === 'night' ? 0.25 : 0.12);
        if (isFloor) c = mix(c, [10, 12, 22], lk.mode === 'night' ? 0.2 : 0.1);
        if (on && !isFloor && !isMul && hash(x >> 2, floor, b.id, this.ls) < 0.8) c = mix(mix(office, lk.fog, Math.min(0.7, lk.A * dep * 0.8)), c, lk.mode === 'dusk' ? 0.5 : 0.35);
        this.set(x, y, c);
      }
    }
  };

  // ------------------------------------------------------------------
  // plants and land
  // ------------------------------------------------------------------
  /** is (ux, uy) inside a leafy blob of radius R (ragged per angular sector, small bumps) */
  function leafy(ux, uy, R, seed, px, py) {
    const d = Math.sqrt(ux * ux + uy * uy);
    if (d > R * 1.12 + 1) return false;
    const a = Math.atan2(uy, ux);
    const sec = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 14);
    const f = 1 + (hash(sec, seed, 11, 5) - 0.5) * 0.24;
    if (d > R * f) return false;
    if (d > R * f - 1.3 && hash(px >> 1, py >> 1, seed, 12) < 0.4) return false;
    return true;
  }
  /** foliage tones for this mode: [deep, dark, mid, light, rim] */
  BK.leafTones = function (mat, dep, x, y) {
    const lk = this.lk;
    const mid = this.c(mat, FF, dep, x, y);
    const dark = mix(this.c(mat, lk.sun === FL ? FR : FL, dep, x, y), [8, 12, 20], 0.2);
    const deep = mix(dark, [6, 8, 16], 0.3);
    let light = this.c(mix(mat, hx('#d8e090'), 0.22), lk.sun, dep, x, y);
    if (lk.mode === 'dusk') light = mix(mid, lk.rim, 0.16);
    else if (lk.mode === 'night') light = mix(mid, lk.rim, 0.12);
    const rim = lk.rim && lk.mode !== 'day' ? mix(mid, lk.rim, lk.mode === 'golden' ? 0.55 : 0.4) : light;
    return [deep, dark, mid, light, rim];
  };
  /**
   * a clumpy tree canopy: clumps = [[dx, dy, r], ...] around (x, y), later
   * clumps in front. Each pixel takes the shading of the front-most clump
   * that covers it: banded toward the light, leafy 2 px clusters along the
   * band edges, a shadow just under every clump that overlaps another, and a
   * rim of sky light on the edges that face the light (dusk, golden, night)
   */
  BK.canopy = function (x, y, clumps, mat, dep, o) {
    const lk = this.lk;
    o = o || {};
    const seed = o.seed || 0;
    const [lx, ly] = lk.L;
    const tones = this.leafTones(mat, dep, x, y);
    let bx0 = 1e9;
    let by0 = 1e9;
    let bx1 = -1e9;
    let by1 = -1e9;
    for (const [dx, dy, r] of clumps) {
      bx0 = Math.min(bx0, Math.floor(x + dx - r * 1.2 - 2));
      bx1 = Math.max(bx1, Math.ceil(x + dx + r * 1.2 + 2));
      by0 = Math.min(by0, Math.floor(y + dy - r * 1.2 - 2));
      by1 = Math.max(by1, Math.ceil(y + dy + r * 1.2 + 2));
    }
    const bw = bx1 - bx0 + 1;
    const bh = by1 - by0 + 1;
    const top = new Int8Array(bw * bh).fill(-1);
    for (let yy = by0; yy <= by1; yy++)
      for (let xx = bx0; xx <= bx1; xx++)
        for (let ci = clumps.length - 1; ci >= 0; ci--) {
          const [dx, dy, r] = clumps[ci];
          if (leafy(xx - x - dx, yy - y - dy, r, seed + ci * 7 + 3, xx, yy)) {
            top[(yy - by0) * bw + (xx - bx0)] = ci;
            break;
          }
        }
    const at = (xx, yy) => (xx < bx0 || xx > bx1 || yy < by0 || yy > by1 ? -1 : top[(yy - by0) * bw + (xx - bx0)]);
    const sx = lx > 0.3 ? 1 : lx < -0.3 ? -1 : 0;
    for (let yy = by0; yy <= by1; yy++)
      for (let xx = bx0; xx <= bx1; xx++) {
        const ci = at(xx, yy);
        if (ci < 0) continue;
        const [dx, dy, r] = clumps[ci];
        const ux = (xx - x - dx) / r;
        const uy = (yy - y - dy) / r;
        let s = ux * lx + uy * ly - uy * 0.2;
        s += (hash(xx >> 1, yy >> 1, 5, seed) - 0.5) * 0.4;
        let ti = s > 0.5 ? 3 : s > -0.1 ? 2 : s > -0.55 ? 1 : 0;
        // the shadow cast just under a clump that sits in front
        if ((at(xx, yy - 1) > ci || at(xx, yy - 2) > ci) && ti > 0) ti--;
        let c = tones[ti];
        // sky light on the edges that face the light
        if (lk.mode !== 'day' && (at(xx + sx, yy - 1) < 0 || at(xx + sx, yy) < 0) && s > -0.2) c = tones[4];
        this.set(xx, yy, c);
      }
  };
  /**
   * a mountain range from a ridge line top(x) down to `base`: lit and shaded
   * slopes, spurs and gullies running down from the crests, flat bands
   */
  BK.mountain = function (x0, x1, topFn, base, mat, dep, o) {
    o = o || {};
    const lk = this.lk;
    const per = o.per || 9;
    for (let x = x0; x <= x1; x++) {
      const t = Math.round(topFn(x));
      const s = topFn(x + 3) - topFn(x - 3); // > 0: the ground falls away to the right
      const dir = s > 0.4 ? 1 : s < -0.4 ? -1 : 0;
      for (let y = t; y <= base; y++) {
        const dd = y - t;
        // spurs: diagonal lines that run down the slope
        const u = x - dir * dd * 1.1 + Math.sin((x + dd) / 17) * 3;
        const sp = (((u / per) % 1) + 1) % 1;
        let face = dir > 0 ? FR : dir < 0 ? FL : FF;
        if (sp < 0.28) face = face === FR ? FF : face === FL ? FF : lk.sun; // the lit side of a spur
        else if (sp > 0.72) face = face === FR ? FL : FL; // its shaded gully
        if (dd === 0) face = FT;
        let c = this.c(mat, face, dep, x, y);
        if (o.tex && dd > 1 && hash(x >> 1, y >> 1, 9, this.gs) < o.tex) c = mix(c, this.c(o.texMat || mat, FL, dep, x, y), 0.45);
        this.set(x, y, c);
      }
    }
  };
  /** a fill from a ridge line top(x) down to `base` (soft hills, tree lines) */
  BK.ridge = function (x0, x1, topFn, base, mat, dep, o) {
    o = o || {};
    for (let x = x0; x <= x1; x++) {
      const t = Math.round(topFn(x));
      for (let y = t; y <= base; y++) this.set(x, y, this.c(mat, y === t && o.rim ? FT : FF, dep, x, y));
    }
  };

  // fan-palm heads: fronds as [end dx, end dy, ctrl dx, ctrl dy] at scale 1
  const PALM_FRONDS = {
    7: [[-6, 2, -3, -3], [6, 2, 3, -3], [-5, -2, -2, -4], [5, -2, 2, -4], [-4, 4, -3, 0], [4, 4, 3, 0], [1, -4, 0, -4]],
    5: [[-6, 2, -3, -3], [6, 2, 3, -3], [-4, -3, -2, -5], [4, -3, 2, -5], [0, -4, 0, -3]],
  };
  /** pixel-perfect quadratic curve, de-duplicated, corner pixels dropped */
  function curvePx(x0, y0, cx, cy, x1, y1) {
    const n = Math.max(4, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const c = u * u;
      const x = Math.round(a * x0 + b * cx + c * x1);
      const y = Math.round(a * y0 + b * cy + c * y1);
      const l = pts[pts.length - 1];
      if (!l || l[0] !== x || l[1] !== y) pts.push([x, y]);
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = out[out.length - 1];
      const b = pts[i + 1];
      if (a && b && Math.abs(a[0] - b[0]) === 1 && Math.abs(a[1] - b[1]) === 1) continue;
      out.push(p);
    }
    return out;
  }
  /** a slim far palm rising from (x, base): trunk bowing with `lean`, a fan of drooping fronds */
  BK.palm = function (x, base, h, lean, dep, o) {
    o = o || {};
    const trunk = this.c(hx('#8a7258'), FF, dep, x, base - h / 2);
    const frond = this.c(M.tree, FF, dep, x, base - h);
    const frondL = this.c(mix(M.tree, hx('#c8d880'), 0.25), this.lk.sun, dep, x, base - h);
    const sc = o.sc || Math.max(0.45, Math.min(1, h / 40));
    let tx = x;
    for (let i = 0; i <= h; i++) {
      const u = i / h;
      tx = Math.round(x + lean * u * u);
      this.set(tx, base - i, trunk);
    }
    const hy = base - h;
    const kx = tx + (lean < 0 ? -1 : 0);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, -1], [1, -1]]) this.set(kx + dx, hy + dy, frond);
    const ox = kx + 0.5;
    const oy = hy - 0.5;
    for (const f of PALM_FRONDS[o.n || 7]) {
      const pts = curvePx(ox, oy, ox + f[2] * sc, oy + f[3] * sc, ox + f[0] * sc, oy + f[1] * sc);
      const lit = (this.lk.sun === FR) === f[0] > 0;
      for (let i = 0; i < pts.length; i++) this.set(pts[i][0], pts[i][1], lit && i < pts.length - 1 ? frondL : frond);
    }
  };

  /** a classic rooftop water tank on legs (feet on y = base), 6 px wide */
  BK.waterTank = function (x, base, dep) {
    const wood = hx('#8a6448');
    const legs = this.c(M.dark, FF, dep, x, base);
    for (let y = base - 3; y <= base; y++) {
      this.set(x, y, legs);
      this.set(x + 5, y, legs);
    }
    for (let x2 = x; x2 <= x + 5; x2++) this.set(x2, base - 3, legs);
    for (let y = base - 9; y <= base - 4; y++)
      for (let x2 = x; x2 <= x + 5; x2++) {
        const face = x2 === x ? FL : x2 === x + 5 ? this.lk.sun : FF;
        let c = this.c(wood, face, dep, x2, y);
        if (y === base - 5 || y === base - 8) c = mix(c, this.c(M.dark, face, dep, x2, y), 0.5); // hoops
        this.set(x2, y, c);
      }
    for (let x2 = x + 1; x2 <= x + 4; x2++) this.set(x2, base - 10, this.c(M.dark, FT, dep, x2, base - 10));
    this.set(x + 2, base - 11, this.c(M.dark, FT, dep, x + 2, base - 11));
    this.set(x + 3, base - 11, this.c(M.dark, FT, dep, x + 3, base - 11));
  };

  // ==================================================================
  // Boston
  // ==================================================================
  const FAR = 1;
  const MID = 0.62;
  const NEAR = 0.34;

  /** the generic downtown landmarks seen far off: a crown tower, a mast tower, a glass slab */
  function bostonTowers(B, d, set) {
    const side = { w: 2, at: set.sideAt };
    if (set.crown !== undefined) {
      const x0 = set.crown;
      const tp = set.crownTop;
      B.tower({ x0, x1: x0 + 8, top: tp, d, mat: M.pale, side, win: { px: 2, py: 2, w: 1, h: 1, mx: 1 }, p: 0.24 });
      for (let y = tp - 6; y < tp; y++) {
        const hw = Math.round(Math.sqrt(Math.max(0, 1 - ((tp - y) / 7) ** 2)) * 4);
        for (let x = x0 + 4 - hw; x <= x0 + 4 + hw; x++) {
          let c = B.c(M.steel, x > x0 + 4 ? FR : FF, d, x, y);
          if (B.lk.lit > 0 && (y === tp - 3 || (x - x0) % 3 === 1)) c = mix(c, hx('#c8d8f0'), 0.3); // the softly lit lattice
          B.set(x, y, c);
        }
      }
      B.set(x0 + 4, tp - 7, B.c(M.steel, FT, d, x0 + 4, tp - 7));
    }
    if (set.mast !== undefined) {
      const x0 = set.mast;
      const tp = set.mastTop;
      B.tower({ x0, x1: x0 + 11, top: tp, d, mat: M.concrete, side, win: { px: 2, py: 2, w: 1, h: 1, mx: 1, my: 3 }, p: 0.26 });
      B.rect(x0 + 2, tp - 4, x0 + 9, tp - 1, M.concrete, FF, d);
      B.rect(x0 + 5, tp - 7, x0 + 6, tp - 5, M.steel, FF, d);
      B.mast(x0 + 5, tp - 22, tp - 8, M.steel, d);
      B.mast(x0 + 6, tp - 14, tp - 8, M.steel, d);
      if (B.lk.lit > 0) for (let x = x0 + 1; x <= x0 + 10; x++) B.set(x, tp + 1, mix(WARM[x % 2 ? 1 : 3], B.lk.fog, 0.35));
      B.beacon(x0 + 5, tp - 23, 3.2, 0.1);
    }
    if (set.slab !== undefined) {
      const x0 = set.slab;
      const tp = set.slabTop;
      const b = { id: ++B.ids, d, p: 0.24, cool: 0.2 };
      B.glassWall(b, x0, x0 + 10, tp, B.lk.hz, FF, { mat: M.glass, mul: 2, fl: 2 });
      const sx = set.sideAt === 'R' ? x0 + 11 : x0 - 2;
      B.glassWall(b, sx, sx + 1, tp + 1, B.lk.hz, set.sideAt === 'R' ? FR : FL, { mat: M.glass, mul: 2, fl: 2 });
      for (let y = tp + 2; y <= B.lk.hz; y++) B.set(x0 + 5, y, B.c(M.glassD, FL, d, x0 + 5, y)); // the face notch
      for (let x = x0; x <= x0 + 10; x++) B.set(x, tp, B.c(M.glass, FT, d, x, tp));
      if (B.lk.snow) B.snowCap(x0, x0 + 10, tp, d);
    }
  }

  /**
   * a residential tower of flats (neighbour tower): outer bays of paired
   * windows, a recessed centre stack of balconies, a dark crown band
   */
  function flats(B, o) {
    const d = o.d;
    const lk = B.lk;
    const base = lk.hz;
    const b = B.tower({ x0: o.x0, x1: o.x1, top: o.top, d, mat: o.mat, side: { w: o.sideW, at: o.sideAt }, p: 0.32, pair: true, cool: 0.06 });
    const sideX0 = o.sideAt === 'L' ? o.x0 - o.sideW : o.x1 + 1;
    const sf = o.sideAt === 'L' ? FL : FR;
    const fy0 = o.top + 8;
    const pitch = 6;
    // the crown: a darker metal band with a lit edge
    B.rect(o.x0, o.top + 1, o.x1, o.top + 4, M.slate, FF, d);
    B.rect(sideX0, o.top + 1, sideX0 + o.sideW - 1, o.top + 4, M.slate, sf, d);
    for (let x = o.x0; x <= o.x1; x++) B.set(x, o.top + 5, B.c(o.mat, FT, d, x, o.top + 5));
    // the balcony stack: recessed, a slab and a rail per floor
    const cx0 = o.cx0;
    const cx1 = o.cx1;
    B.rect(cx0, o.top + 5, cx1, base, mix(o.mat, M.dark, 0.35), FF, d);
    for (let x = cx0; x <= cx1; x++) B.set(x, o.top + 5, B.c(o.mat, FT, d, x, o.top + 5));
    let fl = 0;
    for (let y = fy0; y < base - 2; y += pitch, fl++) {
      // outer bays: pairs of 2x3 windows
      for (const [a0, a1] of [[o.x0 + 2, cx0 - 2], [cx1 + 2, o.x1 - 2]]) {
        let col = 0;
        for (let x = a0; x + 1 <= a1; x += 4, col++) B.win(b, x, y, 2, 3, FF, fl, col + (a0 > cx0 ? 10 : 0));
      }
      // centre: a wide balcony door behind a light slab and a dark rail
      B.win(b, cx0 + 2, y - 1, cx1 - cx0 - 3, 4, FF, fl, 20);
      for (let x = cx0; x <= cx1; x++) {
        B.set(x, y + 3, B.c(M.pale, FT, d, x, y + 3));
        B.set(x, y + 1, B.c(M.dark, FF, d * 0.8, x, y + 1));
      }
      for (let x = cx0; x <= cx1; x += 3) B.set(x, y + 2, B.c(M.dark, FF, d * 0.8, x, y + 2));
      // the side face: narrow windows
      for (let x = sideX0 + 1; x < sideX0 + o.sideW - 1; x += 2) B.win(b, x, y, 1, 3, sf, fl, 30 + x);
    }
    // the mechanical penthouse
    B.rect(o.cx0 - 2, o.top - 6, o.cx1 + 2, o.top - 1, M.slate, FF, d);
    for (let x = o.cx0 - 2; x <= o.cx1 + 2; x++) B.set(x, o.top - 6, B.c(M.slate, FT, d, x, o.top - 6));
    if (lk.snow) B.snowCap(o.cx0 - 2, o.cx1 + 2, o.top - 6, d);
    return b;
  }

  // apartment 1: the station and the residential tower on the right, the
  // downtown towers peeking over the cinema block on the left
  function apt1(B) {
    const far = { d: FAR, mats: [M.pale, M.concrete, M.stone, M.brick], wmin: 6, wmax: 12, win: { px: 2, py: 3, w: 1, h: 1, mx: 1, my: 2 }, p: 0.2 };
    B.row(0, W - 1, 172, 7, Object.assign({ salt: 11 }, far));
    // ---- left: downtown towers over the cinema block (top y 112)
    bostonTowers(B, 0.88, { crown: 14, crownTop: 100, mast: 34, mastTop: 98, slab: 56, slabTop: 90, sideAt: 'R' });
    B.tower({ x0: 72, x1: 80, top: 104, d: 0.88, mat: M.stone, side: { w: 2, at: 'R' }, win: { px: 2, py: 2, w: 1, h: 1 }, p: 0.24 });
    B.tower({ x0: 108, x1: 117, top: 105, d: 0.88, mat: M.pale, side: { w: 2, at: 'R' }, win: { px: 2, py: 3, w: 1, h: 1 }, p: 0.24 });
    B.tower({ x0: 122, x1: 133, top: 101, d: 0.88, mat: M.concrete, side: { w: 2, at: 'R' }, win: { px: 2, py: 2, w: 1, h: 1 }, p: 0.24, roof: [[125, 129, 2]] });
    B.beacon(127, 98, 3.6, 0.55);
    // ---- right: far towers, with a low gap at x 440..466 for the golden sun
    B.tower({ x0: 410, x1: 419, top: 124, d: 0.9, mat: M.pale, side: { w: 2, at: 'L' }, win: { px: 2, py: 2, w: 1, h: 1 }, p: 0.24 });
    B.tower({ x0: 424, x1: 436, top: 112, d: 0.9, mat: M.concrete, side: { w: 2, at: 'L' }, win: { px: 2, py: 3, w: 1, h: 1 }, p: 0.24, roof: [[428, 432, 3]] });
    B.beacon(430, 108, 3.4, 0.3);
    B.tower({ x0: 468, x1: W - 1, top: 116, d: 0.9, mat: M.stone, side: { w: 2, at: 'L' }, win: { px: 2, py: 2, w: 1, h: 1 }, p: 0.24 });
    // mid blocks either side of the neighbour tower
    const mid = { d: MID, mats: [M.brick, M.brickD, M.concrete, M.brown], wmin: 9, wmax: 15, win: { px: 3, py: 4, w: 2, h: 2, mx: 1, my: 3 }, p: 0.3 };
    B.row(326, 356, 146, 6, Object.assign({ salt: 12 }, mid));
    B.row(404, W - 1, 150, 8, Object.assign({ salt: 13 }, mid));
    // ---- the neighbour tower: twenty storeys of flats, its left side in view
    flats(B, { x0: 360, x1: 404, top: 78, d: NEAR, mat: M.concrete, sideW: 4, sideAt: 'L', cx0: 375, cx1: 389 });
    B.beacon(382, 71, 3.8, 0.7);
    // ---- the station on its embankment, the canopy over the platform
    station(B, { x0: 326, x1: W - 1, wall: 198, canopy: [362, W - 1], deck: 196 });
  }

  /** the elevated platform at apartment 1: wall, track bed, canopy; columns and railing in front of the train */
  function station(B, s) {
    const lk = B.lk;
    const d = 0.14;
    for (let y = s.wall; y <= BH - 1; y++)
      for (let x = s.x0; x <= s.x1; x++) {
        let c = B.c(M.concrete, FF, d, x, y);
        if (y === s.wall) c = B.c(M.pale, FT, d, x, y);
        else if ((x - s.x0) % 16 === 0) c = B.c(M.concrete, FL, d, x, y);
        B.set(x, y, c);
      }
    for (let x = s.x0; x <= s.x1; x++) {
      B.set(x, s.deck, B.c(M.dark, FF, d, x, s.deck));
      B.set(x, s.deck + 1, B.c(M.steel, FT, d, x, s.deck + 1));
    }
    const [c0, c1] = s.canopy;
    for (let x = c0; x <= c1; x++) {
      B.set(x, 171, B.c(M.slate, FT, 0.12, x, 171));
      B.set(x, 172, B.c(M.slate, FF, 0.12, x, 172));
      B.set(x, 173, B.c(M.steel, FT, 0.12, x, 173));
      B.set(x, 174, B.c(M.dark, FF, 0.12, x, 174));
    }
    if (lk.snow) B.snowCap(c0, c1, 171, 0.12);
    if (lk.lit > 0)
      for (let x = c0 + 4; x <= c1; x += 9) {
        B.set(x, 175, mix(WARM[5], lk.fog, 0.05));
        B.set(x + 1, 175, mix(WARM[1], lk.fog, 0.1));
      }
    for (let x = c0 + 6; x <= c1; x += 24) {
      for (let y = 175; y <= s.wall - 1; y++) {
        B.fset(x, y, B.c(M.steel, lk.sun === FL ? FL : FR, 0.1, x, y));
        B.fset(x + 1, y, B.c(M.slate, FF, 0.1, x + 1, y));
      }
      B.fset(x - 1, 175, B.c(M.slate, FF, 0.1, x - 1, 175));
      B.fset(x + 2, 175, B.c(M.slate, FF, 0.1, x + 2, 175));
    }
    for (let x = s.x0; x <= s.x1; x++) {
      B.fset(x, s.wall - 4, B.c(M.steel, FT, 0.1, x, s.wall - 4));
      if ((x - s.x0) % 4 === 0) for (let y = s.wall - 3; y <= s.wall - 1; y++) B.fset(x, y, B.c(M.slate, FF, 0.1, x, y));
    }
  }

  // apartment 2: the skyline across the river on the left, the office slab
  // on the right, the elevated track across both
  function apt2(B) {
    const far = { d: FAR, mats: [M.pale, M.concrete, M.stone], wmin: 6, wmax: 12, win: { px: 2, py: 3, w: 1, h: 1, mx: 1 }, p: 0.2 };
    B.row(0, W - 1, 166, 8, Object.assign({ salt: 21 }, far));
    bostonTowers(B, 0.9, { crown: 20, crownTop: 104, mast: 36, mastTop: 96, slab: 60, slabTop: 86, sideAt: 'R' });
    B.tower({ x0: 4, x1: 15, top: 120, d: 0.9, mat: M.stone, side: { w: 2, at: 'R' }, win: { px: 2, py: 2, w: 1, h: 1 }, p: 0.24 });
    B.tower({ x0: 78, x1: 87, top: 110, d: 0.9, mat: M.pale, side: { w: 2, at: 'R' }, win: { px: 2, py: 2, w: 1, h: 1 }, p: 0.24, roof: [[80, 84, 3]] });
    B.tower({ x0: 92, x1: 101, top: 100, d: 0.9, mat: M.concrete, side: { w: 2, at: 'R' }, win: { px: 2, py: 3, w: 1, h: 1 }, p: 0.24 });
    B.rect(94, 95, 99, 99, M.concrete, FF, 0.9);
    B.beacon(96, 94, 3.5, 0.6);
    B.tower({ x0: 106, x1: 115, top: 118, d: 0.9, mat: M.stone, side: { w: 2, at: 'R' }, win: { px: 2, py: 2, w: 1, h: 1 }, p: 0.24 });
    B.tower({ x0: 120, x1: 134, top: 128, d: 0.9, mat: M.pale, side: { w: 2, at: 'R' }, win: { px: 2, py: 3, w: 1, h: 1 }, p: 0.24 });
    // the hills of old three-deckers beyond the track, both sides
    houses(B, 0, 140, 162, 0.6, 31);
    houses(B, 336, W - 1, 158, 0.62, 32);
    // the lower office block and the glass office slab (right)
    B.tower({ x0: 346, x1: 394, top: 114, d: 0.42, mat: M.pale, side: { w: 3, at: 'L' }, p: 0.4, cool: 0.3, win: { px: 2, py: 5, w: 2, h: 2, mx: 1, my: 3 }, roof: [[352, 360, 3]] });
    const slab = { id: ++B.ids, d: 0.32, p: 0.36, cool: 0.3 };
    B.glassWall(slab, 400, 442, 68, B.lk.hz, FF, { mat: M.glassT, mul: 3, fl: 4 });
    B.glassWall(slab, 396, 399, 70, B.lk.hz, FL, { mat: M.glassT, mul: 2, fl: 4 });
    for (let x = 396; x <= 442; x++) B.set(x, 67, B.c(M.slate, FT, 0.32, x, 67));
    B.rect(410, 63, 430, 66, M.slate, FF, 0.32);
    if (B.lk.snow) B.snowCap(396, 442, 67, 0.32);
    B.beacon(420, 62, 3.6, 0.2);
    // low blocks under the sun gap and a mid-rise at the right edge
    B.tower({ x0: 444, x1: 466, top: 146, d: 0.5, mat: M.brick, side: { w: 2, at: 'L' }, win: { px: 3, py: 4, w: 2, h: 2, mx: 1, my: 3 }, p: 0.3 });
    B.tower({ x0: 470, x1: W - 1, top: 104, d: 0.46, mat: M.concrete, side: { w: 3, at: 'L' }, win: { px: 3, py: 4, w: 2, h: 2, mx: 1, my: 3 }, p: 0.3 });
    // low near sheds under the track on the left
    B.row(0, 136, 176, 4, { d: 0.36, mats: [M.brickD, M.brick, M.concrete], wmin: 12, wmax: 22, win: { px: 4, py: 5, w: 2, h: 2, mx: 2, my: 3 }, p: 0.3, salt: 24 });
    elevated(B, { y: 150, x0: 0, x1: W - 1, piers: [18, 72, 126, 352, 408, 462] });
  }

  /** a hill of old wooden three-deckers (gable and flat roofs) */
  function houses(B, x0, x1, top, d, salt) {
    let x = x0;
    let i = 0;
    const mats = [M.clap1, M.clap2, M.cream, M.brick, M.pale];
    while (x <= x1) {
      const r = (k) => hash(i, k, salt, B.gs);
      const w = 9 + Math.floor(r(1) * 5);
      const tp = Math.round(top + (r(2) - 0.5) * 8 + Math.sin((x + salt) / 30) * 4);
      const mat = mats[Math.floor(r(3) * mats.length)];
      const xe = Math.min(x1, x + w - 1);
      B.tower({ x0: x, x1: xe, top: tp, d, mat, cap: false, win: { px: 3, py: 5, w: 1, h: 2, mx: 2, my: 3 }, p: 0.4 });
      if (r(4) < 0.65) {
        const cx = x + (w - 1) / 2;
        for (let k = 1; k <= Math.floor(w / 2); k++)
          for (let xx = Math.ceil(cx - (w / 2 - k)); xx <= Math.floor(cx + (w / 2 - k)); xx++) B.set(xx, tp - k, B.c(M.shingle, xx > cx ? FR : FL, d, xx, tp - k));
      } else for (let xx = x; xx <= xe; xx++) B.set(xx, tp, B.c(M.shingle, FT, d, xx, tp));
      x = xe + 1 + (r(5) < 0.5 ? 1 : 2);
      i++;
    }
  }

  /** an elevated track deck at y (3 px) on piers; its parapet runs in front of the train */
  function elevated(B, e) {
    const d = 0.2;
    const lk = B.lk;
    for (const px of e.piers) {
      for (let y = e.y + 3; y <= BH - 1; y++)
        for (let x = px; x <= px + 3; x++) {
          const face = x === px ? (lk.sun === FL ? FL : FF) : x === px + 3 ? (lk.sun === FR ? FR : FL) : FF;
          B.set(x, y, B.c(M.concrete, face, d, x, y));
        }
      for (let x = px - 2; x <= px + 5; x++) B.set(x, e.y + 3, B.c(M.concrete, FT, d, x, e.y + 3));
    }
    for (let x = e.x0; x <= e.x1; x++) {
      B.set(x, e.y - 1, B.c(M.dark, FF, d, x, e.y - 1)); // rail
      B.set(x, e.y, B.c(M.pale, FT, d, x, e.y));
      B.set(x, e.y + 1, B.c(M.concrete, FF, d, x, e.y + 1));
      B.set(x, e.y + 2, B.c(M.concrete, FF, d, x, e.y + 2));
      B.fset(x, e.y - 2, B.c(M.concrete, FT, d, x, e.y - 2));
      B.fset(x, e.y - 1, B.c(M.concrete, FF, d, x, e.y - 1));
    }
    if (lk.snow) B.snowCap(e.x0, e.x1, e.y, d);
    if (lk.lit > 0) for (let x = e.x0 + 6; x <= e.x1; x += 18) B.set(x, e.y + 1, mix(WARM[1], lk.fog, 0.15));
  }

  // ==================================================================
  // New York: the Manhattan wall above the SoHo lofts
  // ==================================================================
  function nyc(B) {
    const lk = B.lk;
    const far = { d: FAR, mats: [M.pale, M.concrete, M.stone, M.brick], wmin: 5, wmax: 11, win: { px: 2, py: 3, w: 1, h: 1, mx: 1 }, p: 0.18 };
    B.row(0, W - 1, 114, 10, Object.assign({ salt: 41 }, far));
    // distant tall towers behind the wall
    for (const [x0, x1, tp] of [[40, 48, 82], [142, 151, 86], [298, 307, 80], [340, 347, 88], [470, W - 1, 90]]) {
      B.tower({ x0, x1, top: tp, d: 0.85, mat: M.pale, side: { w: 2, at: x0 < 236 ? 'R' : 'L' }, win: { px: 2, py: 3, w: 1, h: 1 }, p: 0.2 });
      B.beacon(Math.round((x0 + x1) / 2), tp - 1, 3 + (x0 % 5) * 0.3, (x0 % 7) / 7);
    }
    // the midtown wall: [x0, x1, top, kind]
    const mats = [M.brick, M.stone, M.concrete, M.brown, M.pale];
    const towers = [
      [0, 12, 104], [16, 30, 94, 'tank'], [34, 46, 108, 'pyr'], [52, 63, 88, 'glass'], [68, 82, 100, 'crown'], [86, 93, 110],
      [118, 130, 92, 'step'], [134, 148, 104, 'tank'], [152, 168, 98, 'crown'], [172, 192, 106, 'tank'],
      [280, 293, 96, 'step'], [296, 311, 88, 'glass'], [315, 330, 102, 'tank'], [334, 349, 92, 'pyr'], [352, 364, 108], [366, 380, 98, 'tank'],
      [383, 398, 100, 'crown'], [402, 420, 96, 'tank'], [424, 433, 106], [460, W - 1, 102, 'step'],
    ];
    towers.forEach(([x0, x1, tp, kind], i) => {
      const left = x0 < 236;
      const side = { w: 2, at: left ? 'R' : 'L' };
      if (kind === 'glass') {
        const b = { id: ++B.ids, d: MID, p: 0.3, cool: 0.3 };
        B.glassWall(b, x0, x1, tp, lk.hz, FF, { mat: M.glass, mul: 2, fl: 2 });
        B.glassWall(b, left ? x1 + 1 : x0 - 2, left ? x1 + 2 : x0 - 1, tp + 1, lk.hz, left ? FR : FL, { mat: M.glass, mul: 2, fl: 2 });
        B.beacon(Math.round((x0 + x1) / 2), tp - 1, 3.3, i * 0.13);
        return;
      }
      const mat = mats[(i * 7 + 3) % mats.length];
      const step = kind === 'step' ? 5 : 0;
      B.tower({ x0, x1, top: tp + step, d: MID, mat, side, win: { px: 2, py: 3, w: 1, h: 2, mx: 1, my: 2 }, p: 0.28, roof: i % 3 === 0 && !kind ? [[x0 + 2, x0 + 5, 2]] : null });
      const cx = (x0 + x1) / 2;
      const hw = (x1 - x0) / 2;
      if (kind === 'step') {
        B.rect(x0 + 2, tp + 1, x1 - 2, tp + 4, mat, FF, MID);
        B.rect(x0 + 4, tp - 3, x1 - 4, tp, mat, FF, MID);
        B.grid({ id: ++B.ids, d: MID, p: 0.3, cool: 0.05 }, { px: 2, py: 3, w: 1, h: 1, mx: 1, my: 1 }, x0 + 2, x1 - 2, tp, tp + 4, FF);
      }
      if (kind === 'pyr')
        for (let k = 1; k <= Math.ceil(hw); k++)
          for (let x = Math.ceil(cx - hw + k); x <= Math.floor(cx + hw - k); x++) B.set(x, tp - k, B.c(M.roof, x > cx ? lk.sun : FL, MID, x, tp - k));
      if (kind === 'crown') {
        // a floodlit crown band, warm at night
        for (let y = tp + 1; y <= tp + 3; y++)
          for (let x = x0; x <= x1; x++) {
            let c = B.c(M.stone, FT, MID, x, y);
            if (lk.lit > 0) c = mix(hx(P.amber[6]), c, 0.35 + (y - tp - 1) * 0.15);
            if ((x - x0) % 2 === 1) c = mix(c, B.c(M.dark, FF, MID, x, y), 0.4);
            B.set(x, y, c);
          }
      }
      if (kind === 'tank') B.waterTank(x0 + 3 + (i % 3) * 2, tp - 1, MID);
    });
    deco(B, 104, 96);
    glassSpire(B, 436, 458, 62);
  }

  /** a generic stepped art-deco tower with a needle, floodlit red, white and blue on the Fourth */
  function deco(B, cx, top) {
    const d = 0.55;
    const lk = B.lk;
    B.tower({ x0: cx - 9, x1: cx + 9, top, d, mat: M.stone, side: { w: 2, at: 'R' }, win: { px: 2, py: 2, w: 1, h: 1, mx: 1, my: 2 }, p: 0.3 });
    const tiers = [
      [7, top - 6, top - 1],
      [5, top - 12, top - 7],
      [3, top - 17, top - 13],
      [1, top - 21, top - 18],
    ];
    const july = B.ed.id === 'nyc' && lk.lit > 0;
    const flood = [hx('#4a6ad8'), hx('#f0f0f8'), hx('#e04040'), hx('#f0f0f8')];
    tiers.forEach(([hw, y0, y1], i) => {
      const h = y1 - y0 + 1;
      for (let y = y0; y <= y1; y++)
        for (let x = cx - hw; x <= cx + hw; x++) {
          const face = x >= cx + hw - 1 && hw > 1 ? lk.sun : FF;
          let c = B.c(M.stone, face, d, x, y);
          if (july) {
            // uplit from the setback below: brightest at the foot of each tier
            const up = (y - y0) / Math.max(1, h - 1);
            c = mix(c, flood[i], 0.35 + up * 0.4);
            if (x === cx - hw) c = mix(c, B.c(M.stone, FF, d, x, y), 0.5);
          }
          if ((x - cx) % 2 !== 0 && hw > 1) c = mix(c, B.c(M.dark, FF, d, x, y), 0.25); // the deco piers
          B.set(x, y, c);
        }
      // the ledge of each setback
      for (let x = cx - hw - 1; x <= cx + hw + 1; x++) B.set(x, y1 + 1, B.c(M.stone, FT, d, x, y1 + 1));
    });
    B.mast(cx, top - 32, top - 22, M.silver, d);
    B.beacon(cx, top - 33, 3, 0.3);
  }

  /** a generic tall glass tower with a mast */
  function glassSpire(B, x0, x1, top) {
    const d = 0.5;
    const b = { id: ++B.ids, d, p: 0.3, cool: 0.4 };
    B.glassWall(b, x0, x1, top + 14, B.lk.hz, FF, { mat: M.glass, mul: 3, fl: 3 });
    B.glassWall(b, x0 + 2, x1 - 2, top, top + 13, FF, { mat: M.glass, mul: 3, fl: 3 });
    // the lit corner on the right
    for (let y = top; y <= B.lk.hz; y++) {
      const xe = y < top + 14 ? x1 - 2 : x1;
      B.set(xe, y, B.c(M.glass, FR, d, xe, y));
      B.set(xe - 1, y, mix(B.c(M.glass, FR, d, xe - 1, y), B.c(M.glass, FF, d, xe - 1, y), 0.5));
    }
    for (let x = x0 + 2; x <= x1 - 2; x++) B.set(x, top, B.c(M.silver, FT, d, x, top));
    for (let x = x0; x <= x1; x++) B.set(x, top + 14, B.c(M.silver, FT, d, x, top + 14));
    const cx = Math.round((x0 + x1) / 2);
    B.rect(cx - 2, top - 3, cx + 2, top - 1, M.steel, FF, d);
    B.mast(cx, top - 36, top - 4, M.silver, d);
    B.mast(cx + 1, top - 20, top - 4, M.steel, d);
    if (B.lk.lit > 0) B.glints.push({ x: cx, y: top - 37, c: css(hx('#f4f6ff')), per: 2.2, seed: 9091, th: 0.3 });
    B.beacon(cx, top - 4, 3.1, 0.6);
  }

  // ==================================================================
  // Los Angeles: the twin silver towers and the hazy mountains
  // ==================================================================
  function la(B) {
    const lk = B.lk;
    // two ranges: the far one pale and lavender, the near one dry olive-brown
    B.mountain(0, W - 1, (x) => 130 + 7 * Math.sin(x / 41 + 0.7) + 4 * Math.sin(x / 13 + 1.9) - 10 * Math.exp(-(((x - 410) / 60) ** 2)), lk.hz, M.mtn, 1, { per: 13 });
    B.mountain(0, W - 1, (x) => 146 + 6 * Math.sin(x / 29 + 2.1) + 3 * Math.sin(x / 9 + 0.3) - 7 * Math.exp(-(((x - 350) / 40) ** 2)), lk.hz, M.mtn2, 0.8, { per: 9, tex: 0.16, texMat: M.chap });
    // downtown, small and hazy, far on the right; one sail-topped tower
    const dd = 0.72;
    for (const [x0, x1, tp] of [[392, 399, 150], [402, 409, 138], [421, 428, 144], [432, 440, 152], [443, 447, 158]])
      B.tower({ x0, x1, top: tp, d: dd, mat: M.pale, side: { w: 1, at: 'L' }, win: { px: 2, py: 3, w: 1, h: 2, mx: 1, my: 2 } });
    const sail = { id: ++B.ids, d: dd, p: 0.3, cool: 0.2 };
    B.glassWall(sail, 412, 419, 128, lk.hz, FF, { mat: M.glass, mul: 2, fl: 3 });
    for (let k = 0; k < 7; k++) for (let x = 412 + k; x <= 419; x++) B.set(x, 127 - k, B.c(M.glass, k === 6 || x === 412 + k ? FT : FF, dd, x, 127 - k));
    // the cluster on the left
    B.tower({ x0: 4, x1: 15, top: 128, d: 0.72, mat: M.pale, side: { w: 2, at: 'R' }, win: { px: 2, py: 3, w: 1, h: 2, mx: 1 } });
    B.tower({ x0: 19, x1: 29, top: 118, d: 0.7, mat: M.stone, side: { w: 2, at: 'R' }, win: { px: 2, py: 3, w: 1, h: 2, mx: 1 } });
    const dk = { id: ++B.ids, d: 0.66, p: 0.3, cool: 0.3 };
    B.glassWall(dk, 33, 43, 104, lk.hz, FF, { mat: M.dark, mul: 2, fl: 3 });
    B.glassWall(dk, 44, 45, 105, lk.hz, FR, { mat: M.dark, mul: 2, fl: 3 });
    twinSilver(B, 50, 86);
    twinSilver(B, 68, 88);
    stepped(B, 88, 101, 98);
    rounded(B, 106, 115, 92);
    rounded(B, 119, 128, 99);
    B.tower({ x0: 131, x1: 146, top: 122, d: 0.72, mat: M.pale, side: { w: 2, at: 'R' }, win: { px: 2, py: 3, w: 1, h: 2, mx: 1 } });
    // low sprawl peeking over the shop strips: flat roofs and street trees
    for (const [x0, x1, salt] of [[0, 160, 51], [312, W - 1, 52]]) {
      let x = x0;
      let i = 0;
      while (x <= x1) {
        const r = (k) => hash(i, k, salt, B.gs);
        const w = 7 + Math.floor(r(1) * 12);
        const tp = 166 + Math.floor(r(2) * 6);
        const mat = [M.cream, M.pale, M.stone, M.white][Math.floor(r(3) * 4)];
        B.tower({ x0: x, x1: Math.min(x1, x + w - 1), top: tp, d: 0.62, mat, cap: true, win: { px: 3, py: 6, w: 2, h: 1, mx: 1, my: 3 } });
        if (r(4) < 0.45) B.canopy(x + w - 2, tp - 1, [[0, 0, 3 + r(5) * 2], [3, 1, 2.6]], M.tree, 0.55, { seed: x });
        x += w + (r(6) < 0.3 ? 2 : 0);
        i++;
      }
    }
    // far hazed palms
    for (const [x, h, l] of [[36, 52, 1], [146, 47, -1], [372, 46, -1], [452, 52, 1], [470, 40, 1]]) B.palm(x, 178, h, l, 0.5, { sc: 0.7 });
  }
  /** one of the twin triangular silver towers: two faces meeting at an edge, thin dark lines */
  function twinSilver(B, x0, top) {
    const d = 0.62;
    const w = 13;
    const mid = x0 + 7;
    for (let y = top; y <= B.lk.hz; y++)
      for (let x = x0; x <= x0 + w; x++) {
        const face = x >= mid ? FR : FF;
        let c = B.c(M.silver, y === top ? FT : face, d, x, y);
        if ((x - x0) % 2 === 1 && y > top + 1) c = mix(c, B.c(M.dark, face, d, x, y), 0.5);
        B.set(x, y, c);
      }
    if (B.lk.lit > 0) B.grid({ id: ++B.ids, d, p: 0.3, cool: 0.4 }, { px: 2, py: 3, w: 1, h: 1, mx: 0, my: 3 }, x0, x0 + w, top, B.lk.hz, FF);
  }
  function stepped(B, x0, x1, top) {
    const d = 0.64;
    B.tower({ x0, x1, top: top + 8, d, mat: M.stone, side: { w: 2, at: 'R' }, win: { px: 2, py: 2, w: 1, h: 1, mx: 2, my: 2 }, p: 0.3 });
    B.rect(x0 + 2, top + 4, x1 - 2, top + 7, M.stone, FF, d);
    B.rect(x0 + 4, top, x1 - 4, top + 3, M.stone, FF, d);
    for (let y = top + 9; y <= B.lk.hz; y++) {
      B.set(x0, y, B.c(M.glass, FF, d, x0, y));
      B.set(x1, y, B.c(M.glass, FR, d, x1, y));
    }
  }
  /** a rounded glass tower: banded shading across the curve */
  function rounded(B, x0, x1, top) {
    const d = 0.64;
    const n = x1 - x0;
    for (let y = top; y <= B.lk.hz; y++)
      for (let x = x0; x <= x1; x++) {
        if (y === top && (x === x0 || x === x1)) continue; // rounded shoulders
        const u = (x - x0) / n;
        const face = u < 0.2 ? FL : u > 0.62 ? FR : FF;
        let c = B.c(M.glass, face, d, x, y);
        if ((y - top) % 3 === 2) c = mix(c, B.c(M.glassD, face, d, x, y), 0.4);
        if (y === top) c = B.c(M.silver, FT, d, x, y);
        B.set(x, y, c);
      }
  }

  // ==================================================================
  // San Diego: downtown on the left; hills, the bay, the bridge and the
  // sail-roofed hall on the right
  // ==================================================================
  const bridgeY = (x) => 186 - 26 * Math.sin(Math.PI * Math.min(1, Math.max(0, (x - 326) / 230)));
  function sandiego(B) {
    const lk = B.lk;
    // far hills across the bay (and a low line behind downtown)
    B.mountain(318, W - 1, (x) => 170 + 3 * Math.sin(x / 23) - 9 * Math.exp(-(((x - 452) / 36) ** 2)) - 4 * Math.exp(-(((x - 372) / 30) ** 2)), lk.hz, M.hill, 1, { per: 11 });
    B.ridge(0, 150, (x) => 176 + 3 * Math.sin(x / 19 + 1), lk.hz, M.hill, 1);
    water(B, 0, W - 1, 180, 205);
    // downtown: generic hazy towers (flat, stepped, pyramid-topped), in two depths
    const back = [
      [6, 15, 132, 'flat', M.pale], [30, 39, 120, 'pyr', M.cream], [56, 64, 126, 'flat', M.glass], [84, 93, 114, 'step', M.pale], [112, 121, 128, 'flat', M.pale],
    ];
    const front = [
      [0, 9, 152, 'flat', M.cream], [12, 22, 140, 'step', M.pale], [24, 31, 156, 'flat', M.glassT], [40, 50, 124, 'pyr', M.white], [52, 60, 146, 'flat', M.concrete],
      [66, 76, 132, 'flat', M.glass], [78, 86, 150, 'pyr', M.cream], [96, 106, 136, 'step', M.pale], [108, 116, 154, 'flat', M.glassT], [120, 131, 142, 'pyr', M.white],
    ];
    const tw = (list, d) => {
      for (const [x0, x1, tp, kind, mat] of list) {
        if (mat === M.glass || mat === M.glassT) {
          const b = { id: ++B.ids, d, p: 0.3, cool: 0.3 };
          B.glassWall(b, x0, x1, tp, 198, FF, { mat, mul: 2, fl: 3 });
          B.glassWall(b, x1 + 1, x1 + 2, tp + 1, 198, FR, { mat, mul: 2, fl: 3 });
          continue;
        }
        B.tower({ x0, x1, top: tp, base: 198, d, mat, side: { w: 2, at: 'R' }, win: { px: 2, py: 3, w: 1, h: 2, mx: 1, my: 3 } });
        const cx = (x0 + x1) / 2;
        const hw = (x1 - x0) / 2;
        if (kind === 'pyr') for (let k = 1; k <= Math.ceil(hw); k++) for (let x = Math.ceil(cx - hw + k); x <= Math.floor(cx + hw - k); x++) B.set(x, tp - k, B.c(mat, x > cx ? FR : FF, d, x, tp - k));
        if (kind === 'step') {
          B.rect(x0 + 2, tp - 4, x1 - 2, tp - 1, mat, FF, d);
          B.rect(x0 + 4, tp - 7, x1 - 4, tp - 5, mat, FF, d);
        }
      }
    };
    tw(back, 0.84);
    tw(front, 0.68);
    // the distant tower seen between the hotel towers
    B.tower({ x0: 230, x1: 239, top: 124, base: 198, d: 0.86, mat: M.pale, side: { w: 1, at: 'R' } });
    bridge(B);
    hall(B, 388, 476, 192);
    // green waterfront park strips with small palms
    for (let x = 0; x <= 140; x++) for (let y = 197; y <= BH - 1; y++) B.set(x, y, B.c(y === 197 ? M.tree : M.treeD, y === 197 ? FT : FF, 0.32, x, y));
    for (let x = 0; x <= 140; x += 7) B.canopy(x + Math.floor(hash(x, 1, 71, B.gs) * 4), 197, [[0, 0, 2.6 + hash(x, 2, 71, B.gs) * 1.5]], M.tree, 0.32, { seed: x });
    for (let x = 332; x <= W - 1; x++) for (let y = 202; y <= BH - 1; y++) B.set(x, y, B.c(y === 202 ? M.tree : M.treeD, y === 202 ? FT : FF, 0.3, x, y));
    for (const [x, h, l] of [[8, 16, 1], [22, 13, -1], [46, 18, 1], [64, 12, 1], [92, 15, -1], [118, 17, 1], [134, 12, -1], [344, 14, 1], [362, 11, -1], [474, 16, -1]]) B.palm(x, x < 200 ? 198 : 203, h, l, 0.4, { n: 5, sc: 0.5 });
  }
  /** calm bay water: the sky in it, long thin ripple lines, glints */
  function water(B, x0, x1, y0, y1) {
    const lk = B.lk;
    const d = 0.62;
    for (let y = y0; y <= y1; y++) {
      const v = (y - y0) / (y1 - y0);
      const base = B.c(mix(M.water, hx('#9cc4e0'), 0.4 - v * 0.35), FF, d * (1 - v * 0.4), 0, y);
      for (let x = x0; x <= x1; x++) B.set(x, y, base);
      let x = x0 + Math.floor(hash(y, 0, 40, B.gs) * 30);
      while (x < x1) {
        const len = 4 + Math.floor(hash(x, y, 41, B.gs) * 10);
        const c = hash(x, y, 42, B.gs) < 0.6 ? mix(base, lk.refl, 0.45) : mix(base, B.c(M.water, FL, d, x, y), 0.6);
        for (let k = 0; k < len; k++) B.set(x + k, y, c);
        x += len + 8 + Math.floor(hash(x, y, 43, B.gs) * 26);
      }
    }
    B.waterY = [y0, y1];
  }
  function bridge(B) {
    const d = 0.55;
    const lk = B.lk;
    // slim paired piers down into the bay
    for (let x = 340; x < W; x += 14) {
      const y0 = Math.round(bridgeY(x)) + 2;
      for (let y = y0; y <= 200; y++) {
        B.set(x, y, B.c(M.pale, lk.sun === FL ? FL : FF, d, x, y));
        B.set(x + 1, y, B.c(M.concrete, lk.sun === FR ? FR : FL, d, x + 1, y));
      }
    }
    for (let x = 326; x < W; x++) {
      const y = Math.round(bridgeY(x));
      B.set(x, y - 1, B.c(M.bridge, FT, d, x, y - 1));
      B.set(x, y, B.c(M.bridge, FF, d, x, y));
      B.set(x, y + 1, B.c(mix(M.bridge, M.dark, 0.45), FF, d, x, y + 1));
    }
  }
  /** a low white hall with a row of white tent-like sail peaks */
  function hall(B, x0, x1, top) {
    const d = 0.4;
    const lk = B.lk;
    B.rect(x0, top, x1, 202, M.white, FF, d);
    for (let x = x0; x <= x1; x++) {
      B.set(x, top, B.c(M.white, FT, d, x, top));
      for (let y = top + 3; y <= top + 5; y++) B.set(x, y, (x - x0) % 6 === 0 ? B.c(M.white, FF, d, x, y) : B.c(M.glass, FF, d, x, y));
    }
    for (let y = top + 7; y <= 202; y++) for (let x = x0 + 4; x <= x1; x += 8) B.set(x, y, B.c(M.pale, FL, d, x, y));
    for (let px = x0 + 7; px <= x1 - 5; px += 11)
      for (let k = 0; k <= 5; k++)
        for (let x = px - (5 - k); x <= px + (5 - k); x++) {
          const c = B.c(M.white, x > px ? lk.sun : x === px ? FT : lk.sun === FR ? FL : FR, d, x, top - 1 - k);
          B.set(x, top - 1 - k, c);
        }
  }

  // ==================================================================
  // Herndon: tree line, neighbour Victorians, poles and wires, the oak
  // ==================================================================
  function herndon(B) {
    const lk = B.lk;
    const tl = (x) => 168 + 4 * Math.sin(x / 11 + 0.4) + 3 * Math.sin(x / 5.3 + 1.2) + 4 * Math.sin(x / 31);
    B.ridge(0, W - 1, tl, lk.hz, M.treeD, 0.86);
    for (let x = 2; x < W; x += 11) B.canopy(x + Math.floor(hash(x, 1, 61, B.gs) * 5), Math.round(tl(x)) + 1, [[0, 0, 4 + hash(x, 2, 61, B.gs) * 3], [5, 2, 4]], M.treeD, 0.82, { seed: x });
    // utility poles and the sagging wires (behind the houses and the trees)
    pole(B, 126, 108);
    pole(B, 462, 104);
    wires(B, [[0, 124], [126, 113], [462, 109], [W - 1, 118]]);
    // the tall trees behind the house, both sides
    B.canopy(152, 130, [[-12, 14, 10], [2, 0, 12], [14, 10, 10], [-2, 20, 11], [12, 24, 9], [-8, -6, 8], [8, -10, 8], [-16, 26, 7]], M.tree, 0.42, { seed: 5 });
    B.canopy(330, 134, [[-6, 8, 11], [8, -2, 12], [16, 14, 9], [2, 22, 10], [-4, -8, 8], [14, -12, 7], [-10, 22, 7]], M.tree, 0.42, { seed: 9 });
    victorian(B, 14, 106, 'gable');
    victorian(B, 340, 406, 'hip');
    // a small dogwood at the far left
    trunk(B, 16, 150, 205, 0.2, 2);
    B.canopy(18, 140, [[-8, 2, 8], [6, -2, 9], [12, 8, 7], [-2, 10, 8]], mix(M.tree, hx('#6a8a4a'), 0.3), 0.2, { seed: 17 });
    // the big shade oak on the right: a stout trunk forking into two limbs
    trunk(B, 406, 112, 205, 0.12, 5);
    limb(B, 408, 120, 386, 80, 3, 0.12);
    limb(B, 410, 118, 440, 70, 3, 0.12);
    B.canopy(418, 84, [
      [-28, 30, 18], [22, 30, 18], [50, 20, 16], [-4, -14, 20], [30, -18, 18], [-30, 0, 16], [0, 20, 20], [56, -8, 14],
      [-44, 26, 11], [-38, 46, 10], [-14, 48, 12], [12, 50, 12], [38, 46, 12], [60, 36, 10],
      [-22, -28, 12], [8, -40, 13], [36, -36, 11], [54, -24, 10], [-12, 4, 12], [18, 4, 13], [44, 4, 11],
    ], M.tree, 0.12, { seed: 23 });
  }
  function trunk(B, x, y0, y1, d, w) {
    const lk = B.lk;
    for (let y = y0; y <= y1; y++) {
      const flare = y > y1 - 4 ? 1 : 0;
      for (let k = -flare; k < w + flare; k++) {
        const face = k <= 0 ? (lk.sun === FL ? FL : FF) : k >= w - 1 ? (lk.sun === FR ? FR : FL) : FF;
        let c = B.c(M.bark, face, d, x + k, y);
        if (k > 0 && k < w - 1 && hash(x + k, y >> 1, 7, B.gs) < 0.2) c = mix(c, [10, 10, 16], 0.25); // bark furrows
        B.set(x + k, y, c);
      }
    }
  }
  function limb(B, xa, ya, xb, yb, w, d) {
    const n = Math.max(Math.abs(xb - xa), Math.abs(yb - ya));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = Math.round(xa + (xb - xa) * u);
      const y = Math.round(ya + (yb - ya) * u);
      const ww = Math.max(1, Math.round(w * (1 - u * 0.6)));
      for (let k = 0; k < ww; k++) B.set(x + k, y, B.c(M.bark, k === 0 ? FL : FF, d, x + k, y));
    }
  }
  function victorian(B, x0, x1, kind) {
    const d = 0.46;
    const lk = B.lk;
    const eave = kind === 'gable' ? 140 : 150;
    const mat = kind === 'gable' ? M.clap1 : M.clap2;
    const b = { id: ++B.ids, d, p: 0.62, cool: 0.04 };
    // clapboard walls: faint siding lines
    for (let y = eave; y <= lk.hz; y++)
      for (let x = x0; x <= x1; x++) {
        let c = B.c(mat, FF, d, x, y);
        if ((y - eave) % 2 === 1) c = mix(c, B.c(mat, FL, d, x, y), 0.35);
        B.set(x, y, c);
      }
    // corner boards and the floor band
    for (let y = eave; y <= lk.hz; y++) {
      B.set(x0, y, B.c(M.trim, FF, d, x0, y));
      B.set(x1, y, B.c(M.trim, lk.sun === FR ? FR : FF, d, x1, y));
    }
    for (let x = x0; x <= x1; x++) B.set(x, eave + 24, B.c(M.trim, FT, d, x, eave + 24));
    // tall windows with trim and shutters, two floors
    const win = (x, y, fl, col) => {
      for (let yy = y - 1; yy <= y + 6; yy++) for (let xx = x - 1; xx <= x + 3; xx++) B.set(xx, yy, B.c(M.trim, FF, d, xx, yy));
      B.win(b, x, y, 3, 6, FF, fl, col);
      for (let yy = y; yy <= y + 5; yy++) {
        B.set(x - 2, yy, B.c(M.shingle, FF, d, x - 2, yy));
        B.set(x + 4, yy, B.c(M.shingle, FF, d, x + 4, yy));
      }
    };
    for (let x = x0 + 9, col = 0; x + 4 < x1 - 4; x += 16, col++) {
      win(x, eave + 9, 0, col);
      win(x, eave + 31, 1, col);
    }
    if (kind === 'gable') {
      // the steep front gable and a lower side roof with a chimney
      const cx = Math.round(x0 + (x1 - x0) * 0.4);
      const hw = 24;
      for (let x = cx + hw - 2; x <= x1 + 2; x++) for (let y = eave - 8; y < eave; y++) B.set(x, y, B.c(M.shingle, y === eave - 8 ? FT : FF, d, x, y));
      B.rect(x1 - 12, eave - 16, x1 - 9, eave - 9, M.brick, FF, d);
      for (let k = 0; k <= hw; k++) {
        const y = eave - Math.round(k * 1.25);
        const yb = eave - Math.round((k - 1) * 1.25);
        for (let x = cx - hw + k; x <= cx + hw - k; x++)
          for (let yy = y; yy < Math.max(y + 1, yb); yy++) {
            const edge = x <= cx - hw + k + 1 || x >= cx + hw - k - 1;
            let c = edge ? B.c(M.shingle, x < cx ? FL : FR, d, x, yy) : B.c(mat, FF, d, x, yy);
            if (!edge && (yy - eave) % 2 === 1) c = mix(c, B.c(mat, FL, d, x, yy), 0.35);
            B.set(x, yy, c);
          }
      }
      for (let x = cx - hw - 1; x <= cx + hw + 1; x++) B.set(x, eave, B.c(M.trim, FT, d, x, eave));
      win(cx - 1, eave - 17, 9, 9);
    } else {
      for (let k = 0; k <= 16; k++) {
        const y = eave - k;
        for (let x = x0 - 2 + k * 2; x <= x1 + 2 - k * 2; x++) {
          const face = x < x0 + 10 + k ? FL : x > x1 - 10 - k ? FR : FF;
          let c = B.c(M.shingle, face, d, x, y);
          if (k % 3 === 0) c = mix(c, [10, 10, 18], 0.15); // shingle courses
          B.set(x, y, c);
        }
      }
      for (let x = x0 - 2; x <= x1 + 2; x++) B.set(x, eave + 1, B.c(M.trim, FT, d, x, eave + 1));
    }
    // a porch at the front corner: roof, posts, rail and its lamp
    const px0 = kind === 'gable' ? x1 - 34 : x0 + 2;
    const px1 = px0 + 30;
    for (let x = px0 - 1; x <= px1 + 1; x++) {
      B.set(x, 179, B.c(M.shingle, FT, d * 0.9, x, 179));
      B.set(x, 180, B.c(M.trim, FF, d * 0.9, x, 180));
    }
    for (let x = px0; x <= px1; x += 10) for (let y = 181; y <= 200; y++) B.set(x, y, B.c(M.trim, FF, d * 0.9, x, y));
    for (let x = px0; x <= px1; x++) {
      B.set(x, 193, B.c(M.trim, FT, d * 0.9, x, 193));
      if (x % 2 === 0) for (let y = 194; y <= 199; y++) B.set(x, y, B.c(M.trim, FF, d * 0.9, x, y));
    }
    if (lk.lit > 0) {
      const lx = px0 + 15;
      B.set(lx, 182, B.c(M.dark, FF, d, lx, 182));
      B.set(lx, 183, mix(WARM[5], lk.fog, 0.05));
      B.set(lx, 184, mix(WARM[1], lk.fog, 0.1));
    }
  }
  function pole(B, x, top) {
    const d = 0.3;
    const lk = B.lk;
    for (let y = top; y <= 205; y++) {
      B.set(x, y, B.c(M.pole, lk.sun === FL ? FL : FF, d, x, y));
      B.set(x + 1, y, B.c(M.pole, lk.sun === FR ? FR : FL, d, x + 1, y));
    }
    for (let k = -7; k <= 8; k++) B.set(x + k, top + 4, B.c(M.pole, FT, d, x + k, top + 4));
    for (const k of [-6, 0, 7]) B.set(x + k, top + 3, B.c(M.pale, FT, d, x + k, top + 3));
    B.rect(x - 3, top + 12, x - 1, top + 17, M.steel, FF, d);
  }
  /** catenary wires through the given posts (three strands) */
  function wires(B, pts) {
    const wc = B.c(M.dark, FF, 0.3, 0, 120);
    for (let s = 0; s < 3; s++)
      for (let i = 0; i + 1 < pts.length; i++) {
        const [xa, ya] = pts[i];
        const [xb, yb] = pts[i + 1];
        const sag = 3 + (xb - xa) * 0.025;
        for (let x = xa; x <= xb; x++) {
          const u = (x - xa) / Math.max(1, xb - xa);
          B.set(x, Math.round(ya + (yb - ya) * u + sag * 4 * u * (1 - u) + s * 3), wc);
        }
      }
  }

  // ------------------------------------------------------------------
  // trains (Boston): sprites baked per edition in the mode's colours
  // ------------------------------------------------------------------
  const CAR = 36; // px per car incl. the gap
  function bakeTrain(B, cars) {
    const lk = B.lk;
    const d = 0.1;
    const w = cars * CAR - 2;
    const h = 12;
    const cv = HD.canvas(w, h, true);
    const ctx = cv.getContext('2d');
    const im = ctx.createImageData(w, h);
    const put = (x, y, c) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const i = (y * w + x) * 4;
      im.data[i] = c[0];
      im.data[i + 1] = c[1];
      im.data[i + 2] = c[2];
      im.data[i + 3] = 255;
    };
    const night = lk.lit > 0;
    for (let ci = 0; ci < cars; ci++) {
      const x0 = ci * CAR;
      for (let x = x0; x < x0 + CAR - 2; x++) {
        const lx = x - x0;
        const nose = (ci === 0 && lx < 2) || (ci === cars - 1 && lx > CAR - 5);
        for (let y = 0; y < h; y++) {
          if (nose && y < 2) continue;
          let c;
          if (y === 0) c = B.c(M.steel, FT, d, x, 150);
          else if (y === 1) c = B.c(M.silver, FT, d, x, 150);
          else if (y === 7 || y === 8) c = B.c(M.orange, y === 7 ? FT : FF, d, x, 150);
          else if (y === 10) c = B.c(M.dark, FF, d, x, 150);
          else if (y === 11) c = lx % 30 < 6 || lx % 30 > 26 ? B.c(M.dark, FL, d, x, 150) : null;
          else c = B.c(M.silver, FF, d, x, 150);
          if (c) put(x, y, c);
        }
        const door = (lx >= 8 && lx <= 10) || (lx >= 23 && lx <= 25);
        if (door) for (let y = 2; y <= 9; y++) if (y !== 7 && y !== 8) put(x, y, mix(B.c(M.silver, FF, d, x, 150), [20, 24, 36], 0.25));
        const winX = lx % 5 !== 0 && lx > 1 && lx < CAR - 4;
        if (winX || door)
          for (let y = 3; y <= 5; y++) {
            let c;
            if (night) {
              c = mix(hx(P.amber[7]), WARM[1], y === 5 ? 0.6 : 0.2);
              if (!door && hash(x >> 1, ci, 77, B.ls) < 0.12 && y >= 4) c = mix(c, [30, 26, 40], 0.75); // a passenger
            } else if (lk.mode === 'dusk') c = mix(B.c(M.glassD, FF, d, x, 150), hx(P.amber[6]), y === 3 ? 0.5 : 0.65);
            else {
              c = B.c(M.glassD, FF, d, x, 150);
              if (y === 3) c = mix(c, lk.refl, 0.4);
            }
            put(x, y, c);
          }
      }
    }
    ctx.putImageData(im, 0, 0);
    return {
      cv,
      w,
      h,
      head: css(night ? hx('#fff6dc') : mix(hx('#fff6dc'), B.c(M.silver, FF, d, 0, 150), 0.4)),
      tail: css(night ? hx('#ff4a3a') : hx('#c03a30')),
    };
  }

  // ------------------------------------------------------------------
  // the bake per edition
  // ------------------------------------------------------------------
  const PAINT = { apt1, apt2, soho: nyc, bhills: la, marina: sandiego, herndon };
  function toCanvas(data) {
    const cv = HD.canvas(W, BH, true);
    const ctx = cv.getContext('2d');
    const im = ctx.createImageData(W, BH);
    im.data.set(data);
    ctx.putImageData(im, 0, 0);
    return cv;
  }
  const art = HD.perEdition((ed) => {
    const B = new Bake(ed);
    const fn = PAINT[ed.place];
    if (fn) fn(B);
    const out = {
      cv: toCanvas(B.d),
      front: B.front ? toCanvas(B.front) : null,
      tw: B.tw,
      beacons: B.beacons,
      glints: B.glints,
      top: B.top,
      lit: B.lk.lit,
      train: ed.place === 'apt1' ? bakeTrain(B, 3) : ed.place === 'apt2' ? bakeTrain(B, 4) : null,
      bay: null,
    };
    if (ed.place === 'marina') {
      // cars on the bridge, a sailboat and glints on the bay
      const cars = [];
      const cc = ['#ecebe6', '#c84a3a', '#2a3a5a', '#d8d0b8'];
      for (let i = 0; i < 6; i++) cars.push({ dir: i % 2 ? 1 : -1, off: hash(i, 1, 88, 3), per: 40 + hash(i, 2, 88, 3) * 30, c: css(B.c(hx(cc[i % 4]), FF, 0.5, 0, 160)) });
      const sparkle = [];
      for (let i = 0; i < 24; i++) {
        const x = Math.floor(hash(i, 1, 44, B.gs) * W);
        const y = 181 + Math.floor(hash(i, 2, 44, B.gs) * 22);
        if (B.get(x, y) && (x < 140 || x > 326)) sparkle.push({ x, y, c: css(mix(B.lk.glint, B.lk.refl, 0.25)), per: 1.6 + hash(i, 3, 44, B.gs) * 2.4, seed: 4500 + i, th: 0.66 });
      }
      out.bay = { cars, sparkle, sail: css(B.c(M.white, FR, 0.5, 0, 190)), hull: css(B.c(M.white, FF, 0.5, 0, 190)), mast: css(B.c(M.steel, FT, 0.5, 0, 190)) };
    }
    return out;
  });

  // ------------------------------------------------------------------
  // per frame
  // ------------------------------------------------------------------
  /** where the Boston train is at t: {x, y, dir} or null */
  function trainAt(t, pl, tr) {
    const n = T.cyclesFor(60);
    const Pd = HD.LOOP / n;
    const s0 = HD.wrap(t);
    const idx = Math.floor(s0 / Pd) % n;
    const s = s0 - idx * Pd;
    const dir = idx % 2 === 0 ? -1 : 1; // -1: right to left
    let x;
    let y;
    if (pl.id === 'apt1') {
      // it pulls in, waits at the platform, pulls out
      y = 184;
      const A = 8;
      const D = 9;
      const E = 8;
      const u = s - 9;
      if (u < 0 || u > A + D + E) return null;
      const xs = dir < 0 ? 492 : 200;
      const xstop = dir < 0 ? 352 : 362;
      const xe = dir < 0 ? 140 : 492;
      if (u < A) {
        const k = u / A;
        x = xs + (xstop - xs) * (1 - (1 - k) * (1 - k));
      } else if (u < A + D) x = xstop;
      else {
        const k = (u - A - D) / E;
        x = xstop + (xe - xstop) * k * k;
      }
    } else {
      // straight through on the elevated deck
      y = 137;
      const dur = 15;
      const u = s - 22;
      if (u < 0 || u > dur) return null;
      const x0 = dir < 0 ? W + 4 : -tr.w - 4;
      const x1 = dir < 0 ? -tr.w - 4 : W + 4;
      x = x0 + ((x1 - x0) * u) / dur;
    }
    return { x: Math.round(x), y, dir };
  }
  function drawTrain(g, t, a) {
    const tr = a.train;
    const p = trainAt(t, HD.place(), tr);
    if (!p) return;
    g.sprite(tr.cv, p.x, p.y);
    const head = p.dir < 0 ? p.x : p.x + tr.w - 1;
    const tail = p.dir < 0 ? p.x + tr.w - 1 : p.x;
    g.px(head, p.y + 8, tr.head);
    g.px(head, p.y + 9, tr.head);
    g.px(tail, p.y + 8, tr.tail);
    if (a.lit > 0) HD.glow(g, head + p.dir * 2, p.y + 8, 4, [1, 0.9, 0.7], 0.35);
  }

  function drawAnim(g, t, a) {
    for (let i = 0; i < a.tw.length; i++) {
      const w = a.tw[i];
      if (T.noise(t, w.per, w.seed) > w.th) g.rect(w.x, w.y, w.w, w.h, w.c);
    }
    for (let i = 0; i < a.glints.length; i++) {
      const q = a.glints[i];
      if (T.noise(t, q.per, q.seed) > (q.th || 0.6)) g.px(q.x, q.y, q.c);
    }
    for (let i = 0; i < a.beacons.length; i++) {
      const b = a.beacons[i];
      const ph = T.phase(t, b.per, b.off);
      if (ph < 0.3) g.px(b.x, b.y, ph < 0.2 ? P.red[6] : P.red[4]);
    }
    const bay = a.bay;
    if (bay) {
      for (let i = 0; i < bay.sparkle.length; i++) {
        const q = bay.sparkle[i];
        if (T.noise(t, q.per, q.seed) > q.th) g.px(q.x, q.y, q.c);
      }
      // little cars crossing the bay bridge
      for (let i = 0; i < bay.cars.length; i++) {
        const c = bay.cars[i];
        const ph = T.phase(t, c.per, c.off);
        const x = Math.round(c.dir > 0 ? 326 + ph * 190 : W + 36 - ph * 190);
        if (x < 326 || x >= W) continue;
        g.px(x, Math.round(bridgeY(x)) - 2, c.c);
      }
      // a small sailboat drifting slowly across the open water
      const sx = Math.round(352 + 18 * T.wave(t, HD.LOOP, 0.1));
      const sy = 188;
      g.rect(sx, sy, 5, 1, bay.hull);
      g.vline(sx + 2, sy - 7, sy - 1, bay.mast);
      g.rect(sx + 3, sy - 6, 1, 5, bay.sail);
      g.rect(sx + 4, sy - 4, 1, 3, bay.sail);
      g.rect(sx + 1, sy - 4, 1, 3, bay.sail);
    }
  }

  HD.module('backdrops', {
    passes: [
      {
        layer: 'bg',
        z: 10,
        id: 'city',
        draw(g, t) {
          const a = art();
          g.ctx.drawImage(a.cv, 0, 0);
          drawAnim(g, t, a);
          if (a.train) drawTrain(g, t, a);
          if (a.front) g.ctx.drawImage(a.front, 0, 0);
        },
      },
    ],
  });

  /** top y of the backdrop at column x for the current place (999: open to the ground) */
  HD.backdrops = {
    top(x) {
      x = Math.round(x);
      return x >= 0 && x < W ? art().top[x] : 999;
    },
  };
})();
