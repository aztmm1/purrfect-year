/*
 * building-bhills (Purrfect Year v2): the hotel at place 'bhills' and its
 * low-rise neighbours on the same block (scene layer, z 25..34).
 *
 * A warm-white twelve-storey 1970s slab: a regular grid of blue-grey tinted
 * windows between thin white fins, split by a solid central spine; a small
 * set-back penthouse box with one thin mast; a deep flat porte-cochere slab on
 * two slim columns over the paver drive; a double-height glass lobby; and low
 * pastel stucco shopfronts with striped awnings on either side.
 *
 * Everything static is painted once per edition into private RGBA rasters in
 * DAY colours (what the eye should see in full sun), sun shadows are applied
 * as multiplies, and the result is divided by the daylight fill so that the
 * engine's relight gives exactly those colours back by day (and a natural
 * dim version at night). Emissive bits (lamps, downlights, lit windows at
 * night) live on separate rasters blitted with g.em. Per frame we only blit
 * the baked art and draw a few animated details: sun glints on the glass, two
 * sheer curtains breathing at open windows, and a bellhop crossing the lobby.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const T = HD.time;
  const mix = HD.color.mix;
  const hexRGB = HD.color.hex;
  const hash = HD.hash;

  const PLACE = 'bhills';

  // ---------------------------------------------------------------- geometry
  const X0 = 150; // left edge of the front face
  const X1 = 311; // right edge of the front face
  const XR = 319; // right edge of the sunlit return face
  const CROWN = 40; // crown band y 40..51
  const FT = 52; // first (top) floor row
  const FH = 12; // floor height
  const NF = 11; // floors 2..12
  const LOBBY = 184; // lobby band y 184..187, glass 188..205
  const BASE = 206; // the sidewalk line
  const WINGS = [156, 240]; // each wing: 6 bays of 11 px (2 px fin + 9 px pane)
  const BAYS = 6;
  const CORE0 = 222;
  const CORE1 = 239;
  const PH = { x0: 212, x1: 249, y: 31 }; // penthouse box
  const MAST = { x: 240, y: 25 };
  const CAN = { x0: 186, x1: 275, y: 175, cols: [192, 268], foot: 217 }; // porte-cochere
  const LOB_L = [156, 211]; // lobby glass, left of the portal
  const LOB_R = [250, 305]; // lobby glass, right of the portal
  const TRANSOM = 191; // lobby glass transom, level with the door head
  const DOOR = { x0: 225, x1: 236, y0: 191 };
  const CATWIN = { x: 275, y: 81, w: 9, h: 7 }; // floor 10, right wing, 4th bay

  // bake rectangles
  const HB = { x: 146, y: 22, w: 178, h: 198 }; // hotel incl. mast and column feet
  const SL = { x: 0, y: 150, w: 150, h: 56 }; // shops left
  const SR = { x: 320, y: 150, w: 160, h: 56 }; // shops right
  const GS = { x: 168, y: 206, w: 116, h: 14 }; // ground shade under the porte-cochere

  // two sheer curtains that breathe at open windows: [wing, bay, floor]
  const OPEN = [
    [0, 1, 6],
    [1, 5, 3],
  ];

  // the porte-cochere's shade on the lobby front (world coordinates)
  const SHADE_LOBBY = [
    [CAN.x0 - 2, CAN.y + 11],
    [CAN.x1 - 4, CAN.y + 11],
    [CAN.x1 - 10, BASE],
    [CAN.x0 - 8, BASE],
  ];
  const SHADE_K = [0.72, 0.72, 0.79];
  const SHADE_GLASS = [0.86, 0.87, 0.92]; // glass keeps reflecting the sunlit street
  /** x of the shade's sunlit (right) edge at row y */
  const shadeRight = (y) => CAN.x1 - 4 - ((y - (CAN.y + 11)) / (BASE - CAN.y - 11)) * 6;

  // ---------------------------------------------------------------- palette
  // DAY colours (as they should read in full sun)
  const C = {
    cap: '#fcf9f1',
    lit: '#f8f4ea',
    front: '#ebe5d8',
    tex: '#e3dccd',
    sh: '#d8d1c3',
    sh2: '#c7bfb0',
    deep: '#b2aa9a',
    finL: '#faf6ec',
    finS: '#dcd5c7',
    ret: '#f6f1e5',
    retSh: '#e4ddcf',
    // tinted glass, reflecting a hot pale sky
    gTop: '#4d6f90',
    gBot: '#344e69',
    gHead: '#22344a',
    gFin: '#2c4259',
    gBand: '#6f93b4',
    gBand2: '#5a7c9d',
    gGlint: '#b4cde3',
    gGlint2: '#dceaf5',
    gRet: '#5b7fa2',
    gRetHi: '#a9c6de',
    sheer: '#ddd3bf',
    drape: '#c9b99c',
    drapeSh: '#ab9c80',
    blind: '#d3cbbb',
    room: '#24303c',
    // lobby
    lgTint: '#2a3b4e',
    lgRefl: '#8eabc6',
    frame: '#d9d2c4',
    bronze: '#5b4a3c',
    bronzeHi: '#86705a',
    granite: '#8d8882',
    graniteHi: '#aaa59e',
    graniteSh: '#6b6762',
    // porte-cochere
    soffit: '#a99f8e',
    soffit2: '#968c7c',
    soffit3: '#857b6c',
    // mast
    mast: '#8c8a90',
    mastHi: '#c4c2c8',
  };

  // ---------------------------------------------------------------- albedo
  // The scene layer is relit: shown = painted * (1 + fill / AMBIENT). Painting
  // day colours divided by the daylight factor gives them back exactly by day.
  let KF = null;
  function dayFactor() {
    if (KF) return KF;
    const fill = (HD.LIGHTING && HD.LIGHTING.day && HD.LIGHTING.day.fill) || [0.72, 0.66, 0.5];
    const amb = HD.AMBIENT || [0.34, 0.38, 0.52];
    KF = [0, 1, 2].map((i) => 1 + fill[i] / amb[i]);
    return KF;
  }
  const albCache = new Map();
  /** albedo css colour of a day colour (for per-frame non-emissive drawing); k = optional shade */
  function alb(c, k) {
    const key = k ? c + '|' + k.join(',') : c;
    let v = albCache.get(key);
    if (v) return v;
    const f = dayFactor();
    const a = hexRGB(c);
    const m = k || [1, 1, 1];
    v = HD.color.css((a[0] * m[0]) / f[0], (a[1] * m[1]) / f[1], (a[2] * m[2]) / f[2]);
    albCache.set(key, v);
    return v;
  }

  // ---------------------------------------------------------------- raster
  /** a private RGBA raster in world coordinates (origin ox, oy) */
  function Raster(o) {
    this.ox = o.x;
    this.oy = o.y;
    this.w = o.w;
    this.h = o.h;
    this.d = new Uint8ClampedArray(o.w * o.h * 4);
    this.glass = new Uint8Array(o.w * o.h); // 1 = glazing (shades more weakly)
  }
  Raster.prototype.idx = function (x, y) {
    x = Math.round(x) - this.ox;
    y = Math.round(y) - this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return (y * this.w + x) * 4;
  };
  Raster.prototype.px = function (x, y, c, a) {
    const i = this.idx(x, y);
    if (i < 0) return;
    const v = hexRGB(c);
    this.d[i] = v[0];
    this.d[i + 1] = v[1];
    this.d[i + 2] = v[2];
    this.d[i + 3] = a === undefined ? 255 : a;
  };
  Raster.prototype.rect = function (x, y, w, h, c) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c);
  };
  Raster.prototype.hl = function (x0, x1, y, c) {
    for (let x = x0; x <= x1; x++) this.px(x, y, c);
  };
  Raster.prototype.vl = function (x, y0, y1, c) {
    for (let y = y0; y <= y1; y++) this.px(x, y, c);
  };
  /** current colour at (x, y) as hex (null if empty) */
  Raster.prototype.get = function (x, y) {
    const i = this.idx(x, y);
    if (i < 0 || this.d[i + 3] === 0) return null;
    return HD.color.css(this.d[i], this.d[i + 1], this.d[i + 2]);
  };
  /** copy one pixel from another raster with the same box */
  Raster.prototype.copy = function (src, x, y) {
    const i = this.idx(x, y);
    if (i < 0) return;
    for (let k = 0; k < 4; k++) this.d[i + k] = src.d[i + k];
  };
  /** mark a pixel as glass */
  Raster.prototype.isGlass = function (x, y) {
    const i = this.idx(x, y);
    if (i >= 0) this.glass[i >> 2] = 1;
  };
  /** multiply the pixels inside a polygon (sampled at pixel centres) by k = [r, g, b] (kg for glass) */
  Raster.prototype.shade = function (pts, k, kg) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    const xs = [];
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if (a[1] <= sy !== b[1] <= sy) xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const xa = Math.ceil(xs[n] - 0.5);
        const xb = Math.floor(xs[n + 1] - 0.5);
        for (let x = xa; x <= xb; x++) {
          const i = this.idx(x, y);
          if (i < 0 || this.d[i + 3] === 0) continue;
          const m = kg && this.glass[i >> 2] ? kg : k;
          this.d[i] *= m[0];
          this.d[i + 1] *= m[1];
          this.d[i + 2] *= m[2];
        }
      }
    }
  };
  /**
   * to a sprite trimmed to what was painted: {img, x, y} in world coordinates
   * (null if empty); albedo = divide by the daylight factor (non-emissive art)
   */
  Raster.prototype.sprite = function (albedo) {
    const d = this.d;
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (d[(y * this.w + x) * 4 + 3]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return null;
    const k = albedo ? dayFactor() : [1, 1, 1];
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const img = HD.bake(w, h, (g, c) => {
      const ctx = c.getContext('2d');
      const im = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = ((y + y0) * this.w + x + x0) * 4;
          const o = (y * w + x) * 4;
          if (!d[i + 3]) continue;
          im.data[o] = d[i] / k[0];
          im.data[o + 1] = d[i + 1] / k[1];
          im.data[o + 2] = d[i + 2] / k[2];
          im.data[o + 3] = d[i + 3];
        }
      ctx.putImageData(im, 0, 0);
    });
    return { img, x: this.ox + x0, y: this.oy + y0 };
  };
  // ---------------------------------------------------------------- helpers
  const H = (a, b, c, d) => hash(a, b, c, d === undefined ? 4021 : d);
  /** a pane's character: plain glass, sheer, drapes, blind... (stable per window) */
  function paneKind(wing, bay, f) {
    for (const o of OPEN) if (o[0] === wing && o[1] === bay && o[2] === f) return 'open';
    const h = H(wing * 7 + 1, bay, f, 77);
    if (h < 0.1) return 'sheerL';
    if (h < 0.18) return 'sheerR';
    if (h < 0.24) return 'drapes';
    if (h < 0.28) return 'closed';
    if (h < 0.34) return 'blind';
    if (h < 0.38) return 'dark';
    return 'glass';
  }
  function paneX(wing, bay) {
    return WINGS[wing] + bay * 11 + 2;
  }
  function rowTop(f) {
    return FT + f * FH;
  }
  const isCatPane = (wing, bay, f) => wing === 1 && bay === 3 && f === 2;

  // ---------------------------------------------------------------- the hotel
  /** sky-reflecting glass colour at world pixel (x, y) in a pane of floor f */
  function glassAt(x, y, f) {
    let base = mix(C.gTop, C.gBot, f / (NF - 1));
    // a soft wide sheen of reflected sky sweeping across the grid
    const v = (((x + y) % 150) + 150) % 150;
    if (v >= 24 && v < 46) base = mix(base, C.gBand, v < 28 || v >= 42 ? 0.12 : 0.22);
    const u = (((x + y * 1) % 61) + 61) % 61; // thin reflection streaks rising to the right
    if (u < 3) return mix(base, C.gBand, 0.75);
    if (u === 3 || u === 9) return mix(base, C.gBand2, 0.7);
    return base;
  }

  function drawPane(R, wing, bay, f, lit) {
    const x0 = paneX(wing, bay);
    const top = rowTop(f);
    const y0 = top + 5;
    const kind = paneKind(wing, bay, f);
    const h = H(wing, bay, f, 13);
    for (let y = y0; y < y0 + 7; y++) {
      for (let x = x0; x < x0 + 9; x++) {
        let c = glassAt(x, y, f);
        if (y === y0) c = C.gHead;
        else if (x === x0 + 8) c = C.gFin;
        R.px(x, y, c);
      }
    }
    // what is behind the glass, seen through the tint
    const tint = (c, k) => mix(c, glassAt(x0 + 4, y0 + 3, f), k === undefined ? 0.2 : k);
    // vertical folds: two light columns, then one in shadow
    const fold = (x) => ((x - x0) % 3 === 2 ? C.drape : C.sheer);
    const edge = (x) => (x === x0 + 8 ? 0.42 : 0.2); // the fin's shadow still falls on the right column
    if (kind === 'sheerL' || kind === 'sheerR') {
      const w = 3 + (h > 0.5 ? 1 : 0);
      const xa = kind === 'sheerL' ? x0 : x0 + 9 - w;
      for (let y = y0 + 1; y < y0 + 7; y++) for (let x = xa; x < xa + w; x++) R.px(x, y, tint(fold(x), edge(x)));
    } else if (kind === 'drapes') {
      for (let y = y0 + 1; y < y0 + 7; y++) {
        R.px(x0, y, tint(C.drape));
        R.px(x0 + 1, y, tint(C.drapeSh));
        R.px(x0 + 7, y, tint(C.drape));
        R.px(x0 + 8, y, tint(C.drapeSh, 0.42));
      }
    } else if (kind === 'closed') {
      for (let y = y0 + 1; y < y0 + 7; y++) for (let x = x0; x < x0 + 9; x++) R.px(x, y, tint(fold(x), edge(x)));
    } else if (kind === 'blind') {
      const n = 2 + Math.floor(h * 2);
      for (let y = y0 + 1; y < y0 + 1 + n; y++) for (let x = x0; x < x0 + 9; x++) R.px(x, y, tint(C.blind, edge(x)));
      R.hl(x0, x0 + 7, y0 + n, tint(C.drapeSh, 0.3)); // the blind's bottom rail
    } else if (kind === 'dark') {
      for (let y = y0 + 1; y < y0 + 7; y++) for (let x = x0; x < x0 + 8; x++) R.px(x, y, mix(C.room, glassAt(x, y, f), 0.3));
    } else if (kind === 'open') {
      // an open window: the shaded room behind, warm and dim (the curtain is drawn per frame)
      for (let y = y0 + 1; y < y0 + 7; y++) for (let x = x0; x < x0 + 9; x++) R.px(x, y, y < y0 + 3 ? '#4a3e38' : y === y0 + 6 ? '#5a4a40' : '#40363a');
      R.px(x0 + 6, y0 + 5, '#8a7a68');
      R.px(x0 + 7, y0 + 5, '#8a7a68');
    }
    // now and then something on the inside sill: a pot of flowers, a vase
    if ((kind === 'glass' || kind === 'sheerL' || kind === 'sheerR') && h < 0.035) {
      const px0 = kind === 'sheerR' ? x0 + 1 : x0 + 5;
      R.px(px0, y0 + 6, tint('#c8643c', 0.15));
      R.px(px0 + 1, y0 + 6, tint('#a84e30', 0.15));
      R.px(px0, y0 + 5, tint(h < 0.018 ? '#e85a6a' : '#f0c040', 0.15));
      R.px(px0 + 1, y0 + 5, tint('#4e8a3e', 0.15));
    }
    // a small sky glint in the top-right corner of most panes
    if (kind !== 'open' && h > 0.35 && !lit) {
      R.px(x0 + 6, y0 + 1, mix(C.gGlint, C.gBand, 0.3));
      R.px(x0 + 7, y0 + 1, C.gGlint);
      R.px(x0 + 6, y0 + 2, mix(C.gBand, glassAt(x0 + 6, y0 + 2, f), 0.4));
    }
  }

  function drawCatWindow(R, E, lit) {
    const { x, y, w, h } = CATWIN;
    // their room, empty while they are out: a lamp left on, a made bed, red
    // curtains tied back (the one warm window in the white grid)
    const wall = (xx, yy) => {
      const d = Math.abs(xx - (x + 6)) + Math.abs(yy - (y + 2)) * 1.4; // lamp glow on the wall
      return d < 2.5 ? '#f4d49a' : d < 4.5 ? '#e6bc80' : '#cf9e68';
    };
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) R.px(xx, yy, wall(xx, yy));
    R.hl(x, x + w - 1, y, '#8a5a3a'); // head shadow
    // the bed: a white duvet and a pillow, lower left
    R.hl(x + 2, x + 5, y + 5, '#f6f0e4');
    R.hl(x + 2, x + 5, y + 6, '#ddd2c0');
    R.px(x + 2, y + 4, '#fffaf0');
    R.px(x + 3, y + 4, '#efe6d6');
    // a nightstand and the lamp (its shade glows)
    R.px(x + 6, y + 5, '#7a4e32');
    R.px(x + 6, y + 6, '#5e3a24');
    R.px(x + 6, y + 4, '#4a3426');
    // curtains: red, gathered and tied back with a gold cord
    for (let yy = y; yy < y + h; yy++) {
      const tie = yy === y + 3;
      R.px(x, yy, yy === y ? '#8a2a24' : '#c4483c');
      R.px(x + w - 1, yy, yy === y ? '#8a2a24' : '#a83a32');
      if (yy > y + 3) {
        R.px(x + 1, yy, '#b8423a');
        R.px(x + w - 2, yy, '#c4483c');
      }
      if (tie) {
        R.px(x, yy, '#e8c070');
        R.px(x + w - 1, yy, '#d8a850');
      }
    }
    R.px(x + 1, y + 1, '#a83a32');
    R.px(x + w - 2, y + 1, '#c4483c');
    E.px(x + 6, y + 2, lit ? '#fff4cc' : '#fff0c0');
    E.px(x + 6, y + 3, lit ? '#ffd890' : '#f6d690');
    E.px(x + 5, y + 3, lit ? '#e8b060' : '#e8c080');
    if (!lit) R.px(x + w - 3, y + 1, mix(wall(x + w - 3, y + 1), '#ffffff', 0.5)); // a glint on the glass
    R.hl(x - 1, x + w, y + h, C.cap); // a bright sill
  }

  function drawFacade(R, E, lit) {
    // crown band and parapet
    for (let y = CROWN; y < FT; y++) {
      for (let x = X0; x <= XR; x++) {
        const ret = x > X1;
        let c = ret ? C.ret : C.front;
        if (y <= CROWN + 1) c = C.cap;
        else if (y === CROWN + 2) c = ret ? C.retSh : C.sh; // the cap projects: a crisp line of shade
        else if (y === 46) c = ret ? C.retSh : C.sh;
        else if (y === 47) c = ret ? C.cap : C.lit;
        else if (y === 51) c = ret ? C.retSh : C.sh2;
        R.px(x, y, c);
      }
    }
    // floors 2..12
    for (let f = 0; f < NF; f++) {
      const top = rowTop(f);
      for (let y = top; y < top + FH; y++) {
        for (let x = X0; x <= X1; x++) {
          let c = C.front;
          // stucco grain
          if (H(x, y, 3) < 0.05) c = C.tex;
          R.px(x, y, c);
        }
      }
      // spandrel: a bright sill on top, its shadow under it
      for (let w = 0; w < 2; w++) {
        for (let b = 0; b < BAYS; b++) {
          const fx = WINGS[w] + b * 11;
          const x0 = fx + 2;
          R.hl(x0, x0 + 8, top, C.cap);
          R.hl(x0, x0 + 8, top + 1, C.sh);
          R.hl(x0, x0 + 8, top + 4, mix(C.front, C.sh, 0.4)); // the window head
          if (isCatPane(w, b, f)) drawCatWindow(R, E, lit);
          else drawPane(R, w, b, f, lit);
        }
      }
      // the spine: a stair window per floor
      R.rect(228, top + 6, 6, 5, mix(C.gTop, C.gBot, f / (NF - 1)));
      R.hl(228, 233, top + 6, C.gHead);
      R.vl(233, top + 7, top + 10, C.gFin);
      R.px(231, top + 7, C.gGlint);
      R.hl(227, 234, top + 11, C.cap);
      R.hl(227, 234, top + 5, C.sh);
      // the sunlit return face: one narrow, brighter window per floor
      for (let y = top; y < top + FH; y++) for (let x = X1 + 1; x <= XR; x++) R.px(x, y, H(x, y, 5) < 0.04 ? C.retSh : C.ret);
      R.hl(X1 + 2, XR - 1, top, C.cap);
      R.hl(X1 + 2, XR - 1, top + 1, C.retSh);
      for (let y = top + 5; y <= top + 11; y++) for (let x = 314; x <= 317; x++) R.px(x, y, y === top + 5 ? '#3e5a76' : C.gRet);
      R.px(316, top + 7, C.gRetHi);
      R.px(315, top + 8, C.gRetHi);
      R.px(317, top + 6, mix(C.gRet, C.gRetHi, 0.5));
    }
    // fins: continuous from the crown to the lobby band, lit on their right
    for (let w = 0; w < 2; w++) {
      for (let b = 0; b < BAYS; b++) {
        const fx = WINGS[w] + b * 11;
        R.vl(fx, FT, LOBBY - 1, C.finS);
        R.vl(fx + 1, FT, LOBBY - 1, C.finL);
        // each fin casts a thin shadow to its left on the spandrels
        if (fx - 1 > X0 + 1) for (let f = 0; f < NF; f++) R.vl(fx - 1, rowTop(f) + 2, rowTop(f) + 3, C.sh);
      }
    }
    // the right wing's last fin (the end pier edge) and the spine edges
    R.vl(306, FT, LOBBY - 1, C.finS);
    R.vl(CORE0, CROWN + 3, LOBBY - 1, C.sh2); // spine projects: shaded left edge
    R.vl(CORE0 + 1, CROWN + 3, LOBBY - 1, C.sh);
    R.vl(CORE1, CROWN + 3, LOBBY - 1, C.cap); // sunlit right edge
    R.vl(CORE1 - 1, FT, LOBBY - 1, C.lit);
    // the spine's shadow falls on the left wing's last pane edge
    for (let f = 0; f < NF; f++) R.vl(CORE0 - 1, rowTop(f) + 5, rowTop(f) + 11, C.gHead);
    // building edges
    R.vl(X0, CROWN, BASE - 1, C.sh2);
    R.vl(X0 + 1, CROWN + 2, BASE - 1, C.sh);
    R.vl(X1, CROWN + 2, BASE - 1, C.cap); // the sunlit corner
    R.vl(XR, CROWN, BASE - 1, C.retSh);
  }

  function drawRoof(R, E, lit) {
    // the penthouse (machine room), set back on the spine
    const { x0, x1, y } = PH;
    for (let yy = y; yy < CROWN; yy++) for (let x = x0; x <= x1; x++) R.px(x, yy, '#e2dbcd');
    R.hl(x0, x1, y, C.cap);
    R.hl(x0 + 1, x1 - 1, y + 1, C.sh);
    for (let yy = y + 3; yy <= y + 7; yy += 2) R.hl(x0 + 3, x1 - 4, yy, '#c9c1b2'); // louvres
    for (let yy = y + 4; yy <= y + 8; yy += 2) R.hl(x0 + 3, x1 - 4, yy, '#ece6da');
    R.vl(x0, y, CROWN - 1, C.sh2);
    R.vl(x1, y, CROWN - 1, C.cap);
    R.vl(x1 - 1, y + 1, CROWN - 1, C.lit);
    // a thin mast with a tiny tip
    R.vl(MAST.x, MAST.y + 1, y - 1, C.mast);
    R.px(MAST.x, MAST.y, C.mastHi);
    if (lit) E.px(MAST.x, MAST.y, '#7a1c18'); // aviation light (blinks at night, per frame)
  }

  /** lobby interior, drawn in plain colours (tinted and reflected later) */
  function lobbyInterior(x, y, side) {
    // ceiling, back wall, floor
    if (y <= 189) return '#8f8170';
    if (y === 190) return '#6e6152';
    if (y >= 202) return (x + y) % 5 === 0 ? '#9a8c7a' : '#857868';
    const panel = (x - (side ? 250 : 156)) % 11;
    let c = panel === 0 ? '#5f412f' : '#7a5640';
    if (y === 195 || y === 196) c = y === 195 ? '#b8a68a' : '#4a3426'; // the mezzanine edge
    return c;
  }

  function drawLobby(R, E, lit) {
    // the band over the lobby (the floor-2 sill line on top)
    for (let y = LOBBY; y < 188; y++) {
      for (let x = X0; x <= XR; x++) {
        const ret = x > X1;
        let c = ret ? C.ret : C.front;
        if (y === LOBBY) c = C.cap;
        else if (y === 187) c = ret ? C.retSh : C.sh2;
        R.px(x, y, c);
      }
    }
    // end piers and return face at lobby level
    for (let y = 188; y < BASE; y++) {
      for (let x = X0; x <= 155; x++) R.px(x, y, x === X0 ? C.sh2 : x === X0 + 1 ? C.sh : C.front);
      for (let x = 306; x <= X1; x++) R.px(x, y, x === X1 ? C.cap : C.front);
      for (let x = X1 + 1; x <= XR; x++) R.px(x, y, x === XR ? C.retSh : C.ret);
    }
    // a granite base course along the foot of the piers and the return face
    for (let y = 202; y < BASE; y++)
      for (const [a, b] of [[X0, 155], [306, XR]])
        for (let x = a; x <= b; x++) R.px(x, y, y === 202 ? C.graniteHi : y === BASE - 1 ? C.graniteSh : x === X0 || x === XR ? C.graniteSh : x > X1 ? mix(C.granite, C.graniteHi, 0.5) : C.granite);
    // portal piers either side of the doors, with recessed reveals (the plaque
    // goes on the plain middle of the right pier)
    for (let y = 188; y < BASE; y++) {
      for (let x = 212; x <= 222; x++) R.px(x, y, x === 212 || x === 220 ? C.sh2 : x === 213 || x === 221 ? C.cap : x === 222 ? C.sh : C.front);
      for (let x = 239; x <= 249; x++) R.px(x, y, x === 240 || x === 248 ? C.sh2 : x === 239 || x === 241 || x === 249 ? C.cap : C.front);
    }
    R.hl(212, 222, 188, C.sh);
    R.hl(239, 249, 188, C.sh);
    R.hl(212, 222, BASE - 1, C.sh2);
    R.hl(239, 249, BASE - 1, C.sh2);
    // the glass walls
    for (const [a, b] of [LOB_L, LOB_R]) {
      const side = a === LOB_R[0];
      for (let y = 188; y < BASE; y++) {
        for (let x = a; x <= b; x++) {
          let c;
          if (y >= 203) c = y === 203 ? C.graniteHi : y === 205 ? C.graniteSh : C.granite; // stone base
          else {
            c = mix(lobbyInterior(x, y, side), C.lgTint, lit ? 0 : 0.45);
            if (!lit) {
              const u = (((x + y * 1) % 47) + 47) % 47;
              if (u < 2) c = mix(c, C.lgRefl, 0.45);
              else if (u === 6) c = mix(c, C.lgRefl, 0.25);
            }
            R.isGlass(x, y);
          }
          R.px(x, y, c);
        }
      }
      // aluminium frame: head, transom, mullions
      R.hl(a, b, 188, C.frame);
      R.hl(a, b, TRANSOM, mix(C.frame, C.sh2, 0.3));
      for (let x = a; x <= b; x += 11) R.vl(x, 188, 202, C.frame);
      R.vl(b, 188, 202, C.frame);
    }
    // lobby furniture (behind the glass, tinted)
    const tint = (c) => (lit ? c : mix(c, C.lgTint, 0.36));
    const put = (x, y, c) => R.px(x, y, tint(c));
    // left: a teal velvet sofa, a low table, a floor lamp, a painting, a tall potted palm
    for (let x = 160; x <= 171; x++) {
      put(x, 199, '#3f8a84');
      put(x, 200, '#357670');
      put(x, 201, '#2a5e5a');
    }
    put(160, 198, '#3f8a84');
    put(171, 198, '#3f8a84');
    put(163, 199, '#e0b050');
    put(168, 199, '#d87a4a');
    for (let x = 174; x <= 179; x++) put(x, 200, '#5a3e2c');
    put(175, 201, '#4a3224');
    put(178, 201, '#4a3224');
    put(176, 199, '#d8d0c0');
    put(184, 197, '#c8a060');
    for (let y = 198; y <= 201; y++) put(184, y, '#3a2e26');
    // an abstract painting (colour blocks) on the mezzanine wall
    for (let y = 192; y <= 194; y++) for (let x = 196; x <= 203; x++) put(x, y, x < 199 ? '#c96a3a' : x < 201 ? '#e0b050' : '#3f7a8a');
    const palm = (px0) => {
      for (let y = 194; y <= 201; y++) put(px0, y, '#5a4030');
      for (const [dx, dy, c] of [[-2, 194, '#4f8a3e'], [-1, 193, '#5f9a48'], [1, 193, '#4f8a3e'], [2, 194, '#3f7232'], [0, 192, '#6aa452'], [-1, 195, '#3f7232'], [1, 195, '#5f9a48'], [-3, 196, '#3f7232'], [3, 196, '#4f8a3e']]) put(px0 + dx, dy, c);
      for (let x = px0 - 2; x <= px0 + 2; x++) put(x, 201, '#d8d0c0');
      put(px0 - 2, 200, '#d8d0c0');
      put(px0 + 2, 200, '#d8d0c0');
    };
    // the front desk, just inside, with a screen and a little brass lamp
    for (let x = 192; x <= 204; x++) {
      put(x, 198, '#ece2cc');
      put(x, 199, '#6a4a34');
      put(x, 200, '#5a3e2c');
      put(x, 201, '#4a3224');
    }
    for (let x = 194; x <= 203; x += 3) put(x, 200, '#7a5a40');
    put(197, 197, '#2a3a4a');
    put(198, 197, '#2a3a4a');
    put(203, 197, '#c8a060');
    palm(208);
    // right: a second sofa and a plant; the bellhop walks the open floor by the doors
    for (let x = 281; x <= 292; x++) {
      put(x, 199, '#c87a4a');
      put(x, 200, '#a8623a');
      put(x, 201, '#84492c');
    }
    put(281, 198, '#c87a4a');
    put(292, 198, '#c87a4a');
    palm(302);
    // lobby pendant lights hang from the ceiling (emissive by day too: they are on)
    for (const [a, b] of [LOB_L, LOB_R]) {
      for (let x = a + 5; x < b; x += 11) {
        R.px(x, 189, tint('#3a2e26'));
        R.px(x + 1, 189, tint('#3a2e26'));
        E.px(x, 190, lit ? '#ffd890' : '#f2cc80');
        E.px(x + 1, 190, lit ? '#ffe7aa' : '#f6d690');
      }
    }
    if (lit) {
      // at night the whole lobby glows from inside (emissive), frame stays solid
      for (const [a, b] of [LOB_L, LOB_R])
        for (let y = 189; y < 203; y++)
          for (let x = a + 1; x < b; x++) {
            if ((x - a) % 11 === 0 || y === TRANSOM || E.get(x, y)) continue;
            const c = R.get(x, y);
            if (c) E.px(x, y, mix(c, '#ffc878', y < 195 ? 0.38 : 0.3));
          }
    }
    // the entrance: a bronze frame, a glass transom, two sliding glass leaves
    for (let y = 188; y < BASE; y++) for (let x = 223; x <= 238; x++) R.px(x, y, x === 238 ? C.bronzeHi : C.bronze);
    R.hl(223, 238, 188, C.bronzeHi);
    const inside = (x, y) => {
      // the warm lobby seen through the doors: a lit back wall, a pendant, the floor
      if (y >= 202) return (x + y) % 3 ? '#c09468' : '#d0a678';
      if (y <= 190) return '#b88a5a';
      if ((x === 227 || x === 234) && y === 192) return '#ffe2a0';
      return y < 196 ? '#e0b070' : '#d49e62';
    };
    for (let y = 189; y < BASE; y++) {
      for (let x = DOOR.x0; x <= DOOR.x1; x++) {
        if (y === 190) {
          R.px(x, y, C.bronzeHi); // the door head
          continue;
        }
        if (x === DOOR.x0 || x === DOOR.x1 || x === 230 || x === 231) {
          R.px(x, y, x === 231 || x === DOOR.x1 ? C.bronzeHi : C.bronze);
          continue;
        }
        let c = inside(x, y);
        // a soft reflection across each leaf
        const u = (((x + y) % 13) + 13) % 13;
        if (u === 0) c = mix(c, '#f6ead0', 0.35);
        E.px(x, y, lit ? mix(c, '#ffd890', 0.25) : mix(c, C.lgTint, 0.22));
      }
    }
    // push bars
    for (const [a, b] of [[226, 229], [232, 235]]) R.hl(a, b, 198, C.bronzeHi);
  }

  function drawCanopy(R, E, lit) {
    const { x0, x1, y } = CAN;
    // fascia: a deep flat white slab with a reveal line
    for (let x = x0; x <= x1; x++) {
      R.px(x, y, C.cap);
      R.px(x, y + 1, C.lit);
      for (let yy = y + 2; yy <= y + 6; yy++) R.px(x, yy, yy === y + 4 ? C.sh : yy === y + 5 ? C.lit : C.front);
      R.px(x, y + 7, C.sh2);
    }
    // the underside, in shade, with a row of downlights
    for (let x = x0 + 1; x < x1; x++) {
      R.px(x, y + 8, C.soffit);
      R.px(x, y + 9, C.soffit2);
      R.px(x, y + 10, C.soffit3);
    }
    for (let x = x0 + 5; x < x1 - 3; x += 8) {
      E.px(x, y + 9, lit ? '#fff4cc' : '#fff1b8');
      E.px(x + 1, y + 9, lit ? '#ffe49a' : '#f6dc98');
    }
    // the slab's ends: shaded on the left, sunlit on the right
    R.vl(x0, y, y + 7, C.sh);
    R.vl(x1, y, y + 7, C.cap);
    R.px(x0, y + 8, C.soffit3);
    R.px(x1, y + 8, C.soffit2);
    // two slim columns down to the drive
    for (const cx of CAN.cols) {
      R.hl(cx - 1, cx + 2, y + 11, C.sh2); // capital
      for (let yy = y + 12; yy < CAN.foot - 1; yy++) {
        R.px(cx, yy, C.sh);
        R.px(cx + 1, yy, C.cap);
      }
      R.hl(cx - 1, cx + 2, CAN.foot - 1, C.front); // base
      R.hl(cx - 1, cx + 2, CAN.foot, C.sh2);
      R.px(cx + 2, CAN.foot - 1, C.lit);
    }
  }

  function buildHotel(ed) {
    const lit = HD.LIGHTING[ed.light || 'night'].day < 0.5;
    const R = new Raster(HB);
    const E = new Raster(HB);
    drawRoof(R, E, lit);
    drawFacade(R, E, lit);
    drawLobby(R, E, lit);
    // sun shadow (not at night): the porte-cochere's shade on the lobby front
    if (!lit) R.shade(SHADE_LOBBY, SHADE_K, SHADE_GLASS);
    // the lobby's glazing bars, kept apart so a figure inside can pass behind them
    const F = new Raster(HB);
    for (let x = LOB_R[0]; x <= LOB_R[1]; x++) {
      const bar = (x - LOB_R[0]) % 11 === 0 || x === LOB_R[1];
      for (let y = 188; y <= 202; y++) if (bar || y === TRANSOM) F.copy(R, x, y);
    }
    drawCanopy(R, E, lit);
    if (lit) drawNightWindows(R, E);
    return { art: R.sprite(true), em: E.sprite(false), bars: F.sprite(true), lit };
  }

  /** night: most rooms lit warm, some dark, a few blue with a TV */
  function drawNightWindows(R, E) {
    for (let w = 0; w < 2; w++)
      for (let b = 0; b < BAYS; b++)
        for (let f = 0; f < NF; f++) {
          if (isCatPane(w, b, f)) continue;
          const h = H(w, b, f, 991);
          if (h < 0.34) continue; // dark room
          const x0 = paneX(w, b);
          const y0 = rowTop(f) + 5;
          const tv = h > 0.95;
          const kind = paneKind(w, b, f);
          for (let y = y0; y < y0 + 7; y++)
            for (let x = x0; x < x0 + 9; x++) {
              let c = y === y0 ? '#8a5428' : tv ? (y < y0 + 3 ? '#8aa2d0' : '#6a82b8') : y < y0 + 3 ? '#f0b25e' : '#e09a4a';
              if (h < 0.5 && !tv) c = mix(c, '#5a3418', 0.45); // a dim bedside lamp
              if ((kind === 'drapes' && (x <= x0 + 1 || x >= x0 + 7)) || (kind === 'sheerL' && x <= x0 + 2) || (kind === 'sheerR' && x >= x0 + 6))
                c = mix(c, '#7a3e1a', 0.35);
              if (x === x0 + 8 && y > y0) c = mix(c, '#5a3418', 0.3);
              E.px(x, y, c);
            }
        }
    // the stair windows in the spine: cool and dim
    for (let f = 0; f < NF; f++) {
      const top = rowTop(f);
      for (let y = top + 7; y <= top + 10; y++) for (let x = 228; x <= 232; x++) E.px(x, y, '#a8b4c8');
    }
  }

  // ---------------------------------------------------------------- shops
  // low pastel stucco shopfronts with striped awnings (no signs, no names)
  const SHOPS = [
    { x0: 0, x1: 46, top: 172, wall: '#ead8b6', awn: ['#c94a42', '#f3ece0'], style: 'flat', goods: 'bakery', door: [33, 39], unit: [8, 15] },
    { x0: 47, x1: 98, top: 160, wall: '#cf8466', awn: ['#2f8a86', '#e9e4d6'], style: 'tile', goods: 'boutique', door: [52, 58] },
    { x0: 99, x1: 149, top: 174, wall: '#e8bcae', awn: ['#e4b23e', '#f6efe2'], style: 'deco', goods: 'florist', door: [137, 143] },
    { x0: 320, x1: 358, top: 178, wall: '#bcc8a2', awn: ['#3d6aa8', '#eef0ec'], style: 'flat', goods: 'books', door: [325, 331], unit: [340, 346] },
    { x0: 359, x1: 419, top: 166, wall: '#f0eadf', awn: ['#3f8a52', '#f2efe6'], style: 'office', goods: 'gelato', door: [404, 410] },
    { x0: 420, x1: 479, top: 172, wall: '#ddb46e', awn: ['#b8433c', '#f4ece0'], style: 'mission', goods: 'hats', door: [446, 452] },
  ];
  const AWN = 186; // awning top face y 186..189, valance 190..192
  const FRONT_Y = 193; // shopfront header; glass 194..203, kick 204..205

  /** the top y of a shop at column x (parapet, tiles, gable, roof units) */
  function shopTop(s, x) {
    let top = s.top;
    const cx = (s.x0 + s.x1) >> 1;
    if (s.style === 'tile') top = s.top - 2;
    if (s.style === 'deco' && Math.abs(x - cx) <= 9) top = s.top - (Math.abs(x - cx) <= 5 ? 7 : 4);
    if (s.style === 'mission') {
      const d = Math.abs(x - cx);
      if (d <= 12) top = s.top - Math.round(7 * Math.sqrt(1 - (d / 12.5) * (d / 12.5)));
    }
    if (s.style === 'office') top = s.top - 1;
    if (s.unit && x >= s.unit[0] && x <= s.unit[1]) top = Math.min(top, s.top - 4);
    return top;
  }

  function drawShop(R, E, s, lit) {
    const { x0, x1, top, wall } = s;
    const lite = mix(wall, '#ffffff', 0.35);
    const shd = mix(wall, '#6b6070', 0.2);
    const shd2 = mix(wall, '#5a5060', 0.32);
    const cx = (x0 + x1) >> 1;
    // walls with a faint stucco grain
    for (let x = x0; x <= x1; x++) {
      const t0 = shopTop(s, x);
      for (let y = t0; y < BASE; y++) R.px(x, y, H(x, y, 9) < 0.06 ? mix(wall, shd, 0.5) : wall);
    }
    // roof units peeking over the parapet
    if (s.unit) {
      const [a, b] = s.unit;
      for (let y = top - 4; y < top; y++) for (let x = a; x <= b; x++) R.px(x, y, y === top - 4 ? '#c8c6c0' : x === b ? '#e0ded8' : '#a8a6a2');
      R.hl(a + 1, b - 1, top - 2, '#8a8884');
    }
    // parapet / roofline
    if (s.style === 'tile') {
      // clay tile coping
      for (let x = x0; x <= x1; x++) {
        R.px(x, top - 2, (x - x0) % 3 === 1 ? '#d8764e' : '#b5583a');
        R.px(x, top - 1, (x - x0) % 3 === 2 ? '#8e3f2a' : '#c4643f');
        R.px(x, top, '#7a3424');
      }
      R.hl(x0, x1, top + 1, shd2);
    } else if (s.style === 'mission') {
      // a curved parapet gable with a cap
      for (let x = x0; x <= x1; x++) {
        const t0 = shopTop(s, x);
        R.px(x, t0, lite);
        R.px(x, t0 + 1, x - cx > 0 ? wall : shd);
      }
      // a round vent in the gable
      R.px(cx, top - 3, shd2);
      R.px(cx - 1, top - 3, shd);
      R.px(cx + 1, top - 3, shd);
    } else if (s.style === 'deco') {
      for (let x = x0; x <= x1; x++) {
        const t0 = shopTop(s, x);
        R.px(x, t0, lite);
      }
      // stepped centre edges and speed lines
      R.vl(cx - 9, top - 4, top, shd);
      R.vl(cx - 5, top - 7, top - 4, shd);
      R.vl(cx + 9, top - 4, top, lite);
      R.vl(cx + 5, top - 7, top - 4, lite);
      for (const yy of [top + 4, top + 6, top + 8]) {
        R.hl(x0 + 2, x1 - 2, yy, shd);
        R.hl(x0 + 2, x1 - 2, yy + 1, lite);
      }
      // a fluted centre panel
      for (let x = cx - 4; x <= cx + 4; x += 2) R.vl(x, top - 5, top + 2, shd);
    } else if (s.style === 'office') {
      R.hl(x0, x1, top - 1, '#c8c6c0'); // metal coping
      R.hl(x0, x1, top, '#9a9894');
    } else {
      R.hl(x0, x1, top, lite);
      R.hl(x0, x1, top + 1, shd);
    }
    // the left edge reads as a shaded return (the sun is on the right)
    R.vl(x0, shopTop(s, x0) + 1, BASE - 1, shd);

    // upper floor
    const glass = '#465f78';
    const glassHi = '#8fb0cc';
    if (s.style === 'tile') {
      // second storey: three arched windows with iron balconettes
      for (let k = 0; k < 3; k++) {
        const wx = x0 + 8 + k * 15;
        for (let y = top + 6; y <= top + 15; y++)
          for (let x = wx; x < wx + 7; x++) {
            const dy = y - (top + 6);
            if (dy === 0 && (x === wx || x === wx + 6 || x === wx + 1 || x === wx + 5)) continue;
            if (dy === 1 && (x === wx || x === wx + 6)) continue;
            R.px(x, y, dy <= 1 ? '#34495e' : x === wx + 6 ? '#3a5068' : glass);
          }
        R.px(wx + 4, top + 9, glassHi);
        R.px(wx + 5, top + 8, glassHi);
        R.vl(wx + 3, top + 8, top + 15, '#d8cfc0'); // a mullion
        // a tiny wrought-iron rail and its sill
        R.hl(wx - 1, wx + 7, top + 16, lite);
        R.hl(wx - 1, wx + 7, top + 13, '#2a2420');
        for (let x = wx - 1; x <= wx + 7; x += 2) R.vl(x, top + 14, top + 15, '#2a2420');
        // a pot of red geraniums on one rail
        if (k === 1) {
          R.px(wx + 1, top + 12, '#d8584a');
          R.px(wx + 2, top + 12, '#e87a5a');
          R.px(wx + 3, top + 12, '#4e7e3a');
        }
      }
    } else if (s.style === 'office') {
      // second storey office: a ribbon of windows with half-drawn blinds
      const y0 = top + 5;
      for (let y = y0; y <= y0 + 7; y++) for (let x = x0 + 4; x <= x1 - 4; x++) R.px(x, y, y === y0 ? '#34495e' : glass);
      for (let x = x0 + 4; x <= x1 - 4; x += 8) R.vl(x, y0, y0 + 7, '#d8d4cc');
      for (let x = x0 + 5; x < x1 - 4; x++) {
        const seg = Math.floor((x - x0 - 4) / 8);
        const n = 1 + Math.floor(H(seg, 3, 1) * 4);
        for (let y = y0 + 1; y <= y0 + n; y++) if ((x - x0 - 4) % 8 !== 0) R.px(x, y, y % 2 ? '#d8d2c4' : '#bcb4a4');
      }
      for (let x = x0 + 10; x < x1 - 4; x += 16) R.px(x, y0 + 6, glassHi);
      R.hl(x0 + 3, x1 - 3, y0 + 8, lite);
      R.hl(x0 + 3, x1 - 3, y0 + 9, shd);
    } else {
      // a blank sign band: a recessed panel, no lettering
      const ya = Math.max(top + 3, AWN - 10);
      const yb = AWN - 3;
      if (yb - ya >= 3) {
        const pa = x0 + 4;
        const pb = x1 - 4;
        for (let y = ya; y <= yb; y++) for (let x = pa; x <= pb; x++) R.px(x, y, mix(wall, '#ffffff', 0.12));
        R.hl(pa, pb, ya, shd);
        R.vl(pa, ya, yb, shd);
        R.hl(pa, pb, yb, lite);
        R.vl(pb, ya, yb, lite);
        // two gooseneck lamps lean over the blank panel
        for (const gx of [pa + Math.round((pb - pa) * 0.25), pa + Math.round((pb - pa) * 0.75)]) {
          R.px(gx, ya - 1, '#3a3430');
          R.px(gx, ya - 2, '#3a3430');
          R.px(gx + 1, ya - 3, '#3a3430');
          R.px(gx + 2, ya - 3, '#4a4440');
          R.px(gx + 3, ya - 2, '#2a2420');
          R.px(gx + 2, ya - 2, '#5a524c');
          if (lit) E.px(gx + 3, ya - 1, '#ffe2a0');
        }
      }
    }
    // a pair of small wall sconces over the shopfront
    for (const sx of [x0 + 3, x1 - 3]) {
      R.px(sx, AWN - 2, '#5a4a3c');
      if (lit) E.px(sx, AWN - 1, '#ffd890');
      else R.px(sx, AWN - 1, '#e8dcc0');
    }

    // the shopfront: glass with goods, a door
    for (let y = FRONT_Y; y < BASE; y++) {
      for (let x = x0 + 2; x <= x1 - 2; x++) {
        let c;
        if (y === FRONT_Y) c = shd2;
        else if (y >= 204) c = y === 204 ? mix(wall, '#3a3430', 0.45) : mix(wall, '#2a2420', 0.6);
        else c = y < 197 ? '#33465a' : '#3b4f64';
        R.px(x, y, c);
      }
    }
    drawGoods(R, E, s, lit);
    // the door: a glass leaf in a dark frame with a brass pull
    const [da, db] = s.door;
    for (let y = FRONT_Y + 1; y < BASE; y++) {
      for (let x = da; x <= db; x++) {
        const edge = x === da || x === db || y === FRONT_Y + 1;
        R.px(x, y, edge ? '#3a302a' : y > 202 ? '#4a4038' : '#24323f');
      }
    }
    R.px(db - 2, 199, '#d4a650');
    R.px(db - 2, 200, '#b88a3a');
    // glass reflections
    for (let x = x0 + 2; x <= x1 - 2; x++)
      for (let y = FRONT_Y + 1; y < 204; y++) {
        const u = (((x + y) % 23) + 23) % 23;
        if ((u === 0 || u === 1) && !(x >= da && x <= db)) R.px(x, y, mix(R.get(x, y) || '#2d3d4e', '#a8c4dc', u === 0 ? 0.42 : 0.22));
      }
    // shopfront frame: pilasters and mullions
    R.vl(x0 + 1, FRONT_Y, BASE - 1, shd);
    R.vl(x1 - 1, FRONT_Y, BASE - 1, lite);
    for (let x = x0 + 13; x < x1 - 4; x += 12) if (x < da - 1 || x > db + 1) R.vl(x, FRONT_Y + 1, 203, mix(wall, '#3a3430', 0.25));

    // the striped awning
    const [ca, cb] = s.awn;
    for (let x = x0 + 1; x <= x1 - 1; x++) {
      const st = Math.floor((x - x0 - 1) / 3) % 2 ? cb : ca;
      R.px(x, AWN - 1, '#4a3a30'); // the bracket line on the wall
      R.px(x, AWN, mix(st, '#ffffff', 0.3)); // the sunlit slope
      R.px(x, AWN + 1, mix(st, '#ffffff', 0.15));
      R.px(x, AWN + 2, st);
      R.px(x, AWN + 3, st);
      R.px(x, AWN + 4, mix(st, '#20242c', 0.12)); // the valance
      R.px(x, AWN + 5, mix(st, '#20242c', 0.16));
      if ((x - x0 - 1) % 3 === 1) R.px(x, AWN + 6, mix(st, '#20242c', 0.22)); // scallops
    }
    // the awning's ends
    R.vl(x0 + 1, AWN, AWN + 5, mix(ca, '#20242c', 0.35));
    R.vl(x1 - 1, AWN, AWN + 5, mix(s.awn[Math.floor((x1 - x0 - 2) / 3) % 2], '#ffffff', 0.2));
  }

  function drawGoods(R, E, s, lit) {
    const { x0, x1 } = s;
    const y0 = FRONT_Y + 1;
    const [da, db] = s.door;
    const free = (x) => x > x0 + 2 && x < x1 - 2 && (x < da - 1 || x > db + 1);
    const put = (x, y, c) => {
      if (!free(x)) return;
      if (lit) E.px(x, y, c);
      else R.px(x, y, mix(c, '#33465a', 0.2));
    };
    const back = lit ? '#e0a860' : null;
    if (back) for (let x = x0 + 3; x < x1 - 2; x++) for (let y = y0; y < 204; y++) put(x, y, y < y0 + 3 ? '#f0c27a' : back);
    const k = s.goods;
    for (let x = x0 + 4; x < x1 - 3; x++) {
      const h = H(x, x0, 21);
      if (k === 'bakery') {
        // counter with pastries and a pendant
        if (x % 7 === 0) {
          put(x, y0 + 1, '#3a2e26');
          put(x, y0 + 2, '#f2cc80');
        }
        put(x, 201, '#8a6a52');
        put(x, 202, '#6a4e3c');
        put(x, 203, '#6a4e3c');
        if (h < 0.7) put(x, 200, ['#e2a23a', '#c8783a', '#f0d8a8', '#d8584a'][Math.floor(h * 5.7)]);
      } else if (k === 'boutique') {
        // a rail of clothes and a mannequin
        put(x, y0 + 2, '#8a8a90');
        if (x % 2 === 0) for (let y = y0 + 3; y < y0 + 8 - Math.floor(h * 2); y++) put(x, y, ['#d8584a', '#6bb0a0', '#e8d8b0', '#9a7ad0', '#e2a23a'][Math.floor(h * 5)]);
        if (x === x0 + 34) {
          for (let y = y0 + 2; y < 204; y++) put(x, y, y < y0 + 4 ? '#d8cfc0' : y < y0 + 8 ? '#2f6a8a' : '#2a2a30');
          put(x - 1, y0 + 5, '#2f6a8a');
          put(x + 1, y0 + 5, '#2f6a8a');
        }
      } else if (k === 'florist') {
        // buckets of flowers on two steps
        const step = x % 10 < 5 ? 0 : 2;
        put(x, 202 - step, '#8a8a90');
        put(x, 203 - step, '#6a6a70');
        put(x, 201 - step, '#3f7a32');
        if (h < 0.85) put(x, 200 - step, ['#f06a8a', '#ffd23a', '#ffffff', '#e8483a', '#b07ae0', '#ff9a3a'][Math.floor(h * 7) % 6]);
        if (h < 0.4) put(x, 199 - step, ['#f8a0b8', '#ffe27a', '#f0f0e8'][Math.floor(h * 7.5) % 3]);
      } else if (k === 'books') {
        // shelves of colourful spines (no titles)
        for (const sy of [y0 + 1, y0 + 5]) {
          if (h < 0.85) for (let y = sy; y < sy + 3; y++) put(x, y, ['#c94a42', '#2f6cc4', '#e8bf2e', '#2f8a52', '#efe8dc', '#7a3cc4', '#d87a3a'][Math.floor(h * 8) % 7]);
          put(x, sy + 3, '#6a4e3c');
        }
        put(x, 203, '#6a4e3c');
      } else if (k === 'gelato') {
        // a glass counter of pastel tubs
        put(x, 200, '#c8d8e0');
        put(x, 201, ['#f6c6d0', '#c8ecd0', '#fff0b8', '#f0d8b8', '#c8b8e8'][Math.floor((x - x0) / 3) % 5]);
        put(x, 202, '#e8e4dc');
        put(x, 203, '#d0ccc4');
        if (x % 9 === 0) {
          put(x, y0, '#3a2e26');
          put(x, y0 + 1, '#f6e0b0');
        }
      } else if (k === 'hats') {
        // hats on stands
        if (x % 7 === 2) {
          // a hat on a stand: crown, band, brim
          const c = ['#d8b070', '#3a3a44', '#c94a42', '#e8dcc4', '#5a7a9a'][Math.floor(h * 5)];
          const band = c === '#3a3a44' ? '#c94a42' : '#3a3a44';
          const hy = 198 + (x % 14 === 2 ? -2 : 1);
          put(x - 1, hy - 2, c);
          put(x, hy - 2, c);
          put(x + 1, hy - 2, c);
          put(x - 1, hy - 1, band);
          put(x, hy - 1, band);
          put(x + 1, hy - 1, band);
          for (let d = -2; d <= 2; d++) put(x + d, hy, c);
          for (let y = hy + 1; y < 203; y++) put(x, y, '#8a8a90');
          put(x - 1, 203, '#6a6a70');
          put(x + 1, 203, '#6a6a70');
        }
      }
    }
  }

  function buildShops(ed) {
    const lit = HD.LIGHTING[ed.light || 'night'].day < 0.5;
    const out = [];
    for (const box of [SL, SR]) {
      const R = new Raster(box);
      const E = new Raster(box);
      for (const s of SHOPS) if (s.x0 >= box.x && s.x1 < box.x + box.w) drawShop(R, E, s, lit);
      // sun shadows: under each awning on the shopfront, and the parapet units
      if (!lit)
        for (const s of SHOPS) {
          if (s.x0 < box.x || s.x1 >= box.x + box.w) continue;
          R.shade(
            [
              [s.x0 - 1, AWN + 6],
              [s.x1 - 2, AWN + 6],
              [s.x1 - 5, AWN + 10],
              [s.x0 - 4, AWN + 10],
            ],
            [0.66, 0.68, 0.76]
          );
          if (s.unit)
            R.shade(
              [
                [s.unit[0] - 3, s.top - 1],
                [s.unit[0], s.top - 1],
                [s.unit[0], s.top + 1],
                [s.unit[0] - 3, s.top + 1],
              ],
              [0.8, 0.82, 0.88]
            );
        }
      out.push({ art: R.sprite(true), em: E.sprite(false) });
    }
    return out;
  }

  /** the porte-cochere's shadow on the drive (drawn source-atop over the ground) */
  function buildGroundShade(ed) {
    const lt = HD.LIGHTING[ed.light || 'night'];
    if (lt.day < 0.5) return null;
    const R = new Raster(GS);
    const k = dayFactor();
    // a cool dark tint in albedo terms, laid over the pavers at ~40 %
    const col = HD.color.css(34 / k[0], 40 / k[1], 62 / k[2]);
    const a = 108;
    for (let y = BASE; y <= BASE + 10; y++) {
      // the shadow's far edge is under the slab front, shifted left by the sun
      const t = (y - BASE) / 10;
      const xa = Math.round(CAN.x0 - 3 - t * 6);
      const xb = Math.round(CAN.x1 - 6 - t * 6);
      for (let x = xa; x <= xb; x++) R.px(x, y, col, a);
    }
    // the slim columns' own short shadows, down and to the left
    for (const cx of CAN.cols) {
      for (let s = 0; s < 4; s++) {
        R.px(cx - 1 - s * 2, CAN.foot + 1 + (s >> 1), col, a);
        R.px(cx - 2 - s * 2, CAN.foot + 1 + (s >> 1), col, a);
      }
    }
    return R.sprite(false);
  }

  // ---------------------------------------------------------------- per frame
  let hotelArt = null;
  let shopArt = null;
  let groundArt = null;
  let glintPanes = null;

  const mine = () => HD.edition && HD.edition.place === PLACE;

  /** sun glints: a pane catches the sun for a moment, now and then */
  function glints(g, t, golden) {
    const core = golden ? '#fff4d0' : '#ffffff';
    const arm = golden ? '#ffd890' : '#e6f2fc';
    for (let i = 0; i < 3; i++) {
      const cy = T.cycle(t, i, 5.3 + i * 1.1, 8801);
      const age = cy.age;
      if (age > 0.11) continue;
      const pick = glintPanes[Math.floor(cy.rnd(1) * glintPanes.length)];
      const x = pick[0];
      const y = pick[1];
      const fr = Math.floor((age / 0.11) * 5); // 0..4: dot, plus, star, plus, dot
      g.em.px(x, y, core);
      if (fr === 1 || fr === 3) {
        g.em.px(x - 1, y, arm);
        g.em.px(x + 1, y, arm);
        g.em.px(x, y - 1, arm);
        g.em.px(x, y + 1, arm);
      } else if (fr === 2) {
        g.em.hline(x - 2, x + 2, y, arm);
        g.em.vline(x, y - 2, y + 2, arm);
        g.em.px(x - 1, y, core);
        g.em.px(x + 1, y, core);
      }
    }
  }

  /** sheer curtains breathing at the two open windows */
  function curtains(g, t, lit) {
    const s = T.step(t, 8);
    const br = HD.summer ? HD.summer.breeze(s) : T.wave(s, 6.5);
    const c1 = alb(C.sheer);
    const c2 = alb(mix(C.sheer, C.drape, 0.5));
    const c3 = alb('#efe8da');
    for (let n = 0; n < OPEN.length; n++) {
      const [w, b, f] = OPEN[n];
      const x0 = paneX(w, b);
      const y0 = rowTop(f) + 6;
      const v = n === 0 ? br : 0.7 * T.wave(s, 7.9, 0.3) + 0.3 * br;
      // the hem swings by up to 2 px, the top stays gathered at the rail
      for (let y = 0; y < 6; y++) {
        const k = y / 5;
        const off = Math.round(v * 2 * k * k);
        const wdt = 3 + Math.round(k * 1.5);
        const xa = n === 0 ? x0 + off : x0 + 8 - wdt + off;
        for (let x = 0; x < wdt; x++) {
          const xx = HD.clamp(xa + x, x0, x0 + 7);
          g.px(xx, y0 + y, (xx + y) % 3 === 0 ? c2 : y < 2 ? c3 : c1);
        }
      }
      if (lit) g.em.px(n === 0 ? x0 + 6 : x0 + 1, y0 + 4, '#c88a48');
    }
  }

  /** two guests draw their sheer curtains for part of the loop, then open them again */
  const DRAWN = [
    { pane: [0, 4, 8], close: 30, open: 150 },
    { pane: [1, 1, 5], close: 96, open: 206 },
  ];
  let drawnCols = null;
  function drawn(g, t) {
    const s = HD.summer ? HD.summer.sec(T.step(t, 8)) : T.step(t, 8);
    for (let n = 0; n < DRAWN.length; n++) {
      const d = DRAWN[n];
      // 0 = open, 1 = drawn; each move takes 2.5 s
      let p = 0;
      if (s >= d.close && s < d.open) p = Math.min(1, (s - d.close) / 2.5);
      else if (s >= d.open && s < d.open + 2.5) p = 1 - (s - d.open) / 2.5;
      if (p <= 0) continue;
      const [w, b, f] = d.pane;
      const x0 = paneX(w, b);
      const y0 = rowTop(f) + 6;
      const wdt = Math.max(1, Math.round(p * 8));
      const cols = drawnCols[n];
      for (let x = 0; x < wdt; x++) g.rect(x0 + x, y0, 1, 6, cols[(x + 8 - wdt) % 3]);
    }
  }

  /** a bellhop with a suitcase crosses the lobby by the doors, behind the glass */
  const BH_COL = {};
  function bellhop(g, t, lit) {
    const LOOP = HD.LOOP;
    const s = T.step(t, 8);
    const P = LOOP / 2; // two round trips per loop
    const u = (((s % P) + P) % P) / P;
    const XA = 265; // by the column
    const XB = 254; // by the doors
    let x;
    let moving = true;
    if (u < 0.3) {
      x = XA;
      moving = false;
    } else if (u < 0.45) x = XA + ((u - 0.3) / 0.15) * (XB - XA);
    else if (u < 0.65) {
      x = XB;
      moving = false;
    } else if (u < 0.8) x = XB + ((u - 0.65) / 0.15) * (XA - XB);
    else {
      x = XA;
      moving = false;
    }
    x = Math.round(x);
    const walk = moving ? Math.floor(s * 4) % 2 : 0;
    const base = 202;
    const col = (name, c, xx) => {
      // tinted by the glass; darker where the porte-cochere shades the front
      const shaded = xx < shadeRight(base - 4);
      const key = name + (shaded ? 's' : '') + (lit ? 'n' : '');
      let v = BH_COL[key];
      if (!v) {
        if (lit) v = mix(c, '#3a2418', 0.55);
        else v = alb(mix(c, C.lgTint, 0.42), shaded ? SHADE_K : null);
        BH_COL[key] = v;
      }
      return v;
    };
    const pen = lit ? g.em : g;
    const fur = col('fur', '#2a2228', x);
    // a suitcase in his left paw
    const sx = x - 3;
    pen.rect(sx, base - 5, 3, 3, col('case', '#3a64a0', sx));
    pen.px(sx + 1, base - 6, col('handle', '#2a2a30', sx));
    pen.px(sx + 2, base - 4, col('strap', '#c8a060', sx));
    // the bellhop: a dark cat in a red jacket and a pillbox cap
    pen.rect(x, base - 6, 3, 4, col('coat', '#b8383a', x));
    pen.px(x - 1, base - 5, col('coat', '#b8383a', x));
    pen.rect(x, base - 9, 3, 3, fur);
    pen.px(x, base - 10, fur);
    pen.px(x + 2, base - 10, fur);
    pen.px(x + 1, base - 10, col('cap', '#d84a3c', x));
    pen.px(x, base - 8, col('eye', '#e8d060', x));
    pen.px(x + 1, base - 2, fur);
    pen.px(x + walk * 2, base - 1, fur);
    pen.px(x + 2 - walk * 2, base - 1, fur);
  }

  function draw(g, t) {
    if (!mine()) return;
    const H0 = hotelArt();
    const S0 = shopArt();
    const G0 = groundArt();
    const lt = HD.light();
    // the porte-cochere's shadow on the drive, laid only over existing ground
    const blit = (gg, sp) => {
      if (sp) gg.sprite(sp.img, sp.x, sp.y);
    };
    if (G0) {
      const ctx = g.ctx;
      const op = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.drawImage(G0.img, G0.x, G0.y);
      ctx.globalCompositeOperation = op;
    }
    for (const s of S0) {
      blit(g, s.art);
      blit(g.em, s.em);
    }
    blit(g, H0.art);
    if (H0.lit) blit(g.em, H0.em);
    // the bellhop walks behind the lobby's glazing bars
    bellhop(g, t, H0.lit);
    blit(g, H0.bars);
    if (!H0.lit) blit(g.em, H0.em);
    curtains(g, t, H0.lit);
    if (!H0.lit) drawn(g, t);
    if (!H0.lit && lt.day > 0.5) glints(g, t, lt.mode === 'golden');
    if (H0.lit && T.phase(t, 2.4) < 0.18) g.em.px(MAST.x, MAST.y, '#ff5a4a'); // the mast light blinks
  }

  function lights(t, L) {
    if (!mine()) return;
    const lt = HD.light();
    if (lt.day >= 0.5) return; // by day the lamps hardly show
    // downlights under the porte-cochere pool on the drive and the doors
    L.add({ x: 230, y: 206, r: 46, ry: 16, color: HD.LIGHT.candle, i: 0.9, bands: 4, clip: { x0: 180, y0: 186, x1: 280, y1: 226 } });
    // the lobby spills warm light onto the sidewalk
    for (const x of [184, 278]) L.add({ x, y: 210, r: 34, ry: 9, color: HD.LIGHT.lantern, i: 0.55, bands: 3, clip: { x0: 150, y0: 204, x1: 312, y1: 226 } });
    // shop windows
    for (const s of SHOPS) L.add({ x: (s.x0 + s.x1) >> 1, y: 208, r: Math.round((s.x1 - s.x0) * 0.6), ry: 8, color: HD.LIGHT.lantern, i: 0.4, bands: 3, clip: { x0: s.x0, y0: 204, x1: s.x1, y1: 226 } });
  }

  // ---------------------------------------------------------------- anchors
  // registered at load, so modules reading them in their own init see them
  (function register() {
    const pl = HD.PLACES && HD.PLACES[PLACE];
    if (!pl) return;
    const sky = new Int16Array(480).fill(999);
    for (const s of SHOPS) for (let x = s.x0; x <= s.x1; x++) sky[x] = shopTop(s, x);
    for (let x = X0; x <= XR; x++) sky[x] = CROWN;
    for (let x = PH.x0; x <= PH.x1; x++) sky[x] = PH.y;
    sky[MAST.x] = MAST.y;
    pl.skyline = sky;
    // ledges where rain would splash: crown, penthouse, canopy, awnings, parapets
    const surf = [
      [X0, CROWN, XR, CROWN],
      [PH.x0, PH.y, PH.x1, PH.y],
      [CAN.x0, CAN.y, CAN.x1, CAN.y],
      [X0, LOBBY, CAN.x0 - 1, LOBBY],
      [CAN.x1 + 1, LOBBY, XR, LOBBY],
    ];
    for (const s of SHOPS) {
      surf.push([s.x0 + 1, AWN, s.x1 - 1, AWN]);
      surf.push([s.x0, s.top, s.x1, s.top]);
    }
    pl.surfaces = surf;
    // fat drips from the canopy edge and the awning valances
    const drips = [];
    for (let x = CAN.x0 + 4; x < CAN.x1; x += 9) drips.push({ x, y: CAN.y + 11 });
    for (const s of SHOPS) for (let x = s.x0 + 4; x < s.x1 - 2; x += 8) drips.push({ x, y: AWN + 7 });
    pl.drips = drips;
  })();

  HD.module('building-bhills', {
    init() {
      hotelArt = HD.perEdition(buildHotel);
      shopArt = HD.perEdition(buildShops);
      groundArt = HD.perEdition(buildGroundShade);
      // panes that can catch a glint (top-right corner of plain glass)
      drawnCols = DRAWN.map((d) => {
        const f = d.pane[2];
        const gx = paneX(d.pane[0], d.pane[1]) + 4;
        const gc = glassAt(gx, rowTop(f) + 8, f);
        return [mix(C.sheer, gc, 0.2), mix(C.sheer, gc, 0.2), mix(C.drape, gc, 0.2)].map((c) => alb(c));
      });
      glintPanes = [];
      for (let w = 0; w < 2; w++)
        for (let b = 0; b < BAYS; b++)
          for (let f = 0; f < NF; f++) {
            if (isCatPane(w, b, f)) continue;
            const k = paneKind(w, b, f);
            if (k !== 'glass' && k !== 'blind') continue;
            if (DRAWN.some((d) => d.pane[0] === w && d.pane[1] === b && d.pane[2] === f)) continue;
            glintPanes.push([paneX(w, b) + 6, rowTop(f) + 7]);
          }
      for (let f = 0; f < NF; f++) glintPanes.push([316, rowTop(f) + 7]);
    },
    lights,
    passes: [{ layer: 'scene', z: 28, id: 'hotel', draw }],
  });
})();
