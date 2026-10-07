/*
 * building-herndon (Purrfect Year v2): the family house at the herndon place.
 *
 * A two-storey Queen Anne: a steep street-facing gable (sage fish-scale
 * shingles, a louvred arched vent, a spindle truss at the peak), butter-yellow
 * clapboard with white trim, barn-red standing-seam metal roofs (main hip,
 * bay, porch, the pent at the foot of the gable), a three-sided bay window
 * with a jewel transom, a white wraparound porch (turned posts, sawn brackets,
 * a spindle frieze, a balustrade, a lattice skirt, a haint-blue ceiling), a
 * brick chimney, deep green louvred shutters, hydrangeas and boxwoods.
 *
 * Painting model: every surface is a material (an albedo ramp, dark -> light)
 * plus a shade level. The bake turns them into night colours for the current
 * light mode (albedo x ambient x a per-mode exposure); the engine relights
 * them with the daylight fill and the placed lights. Lit window interiors are
 * emissive and baked separately; by day the glass is plain reflective glass.
 *
 * Per frame: two blits plus a moth at the porch lantern, a sheer curtain
 * stirring in the open upstairs window and the porch swing in the right-hand
 * bay. The cat window stays an empty lit room (a pot plant on the sill) unless
 * an entry seats the series cat there.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const T = HD.time;
  const W = HD.W;
  const H = HD.H;
  const NP = W * H;
  const bayer = HD.bayer;
  const AMB = HD.AMBIENT;
  const hexRGB = HD.color.hex;
  const PLACE = HD.PLACES.herndon;
  const R = Math.round;

  // ------------------------------------------------------------------
  // Materials: albedo ramps (true daylight colours), 7 steps dark -> light
  // ------------------------------------------------------------------
  const RAMPS = [null];
  const M = {};
  const mat = (name, ramp) => {
    M[name] = RAMPS.length;
    RAMPS.push(ramp);
  };
  mat('siding', ['#6c5f4a', '#8e7e5c', '#b19f6e', '#cbb87e', '#e0cd8e', '#ecdc9f', '#f6ebbb']);
  mat('trim', ['#7c808e', '#9fa2ac', '#c0c0c3', '#d8d5cf', '#eae6dd', '#f5f2e9', '#fffefa']);
  mat('roof', ['#38141a', '#521c21', '#6c2628', '#83302d', '#993c33', '#b2503f', '#cc6c54']);
  mat('shingle', ['#47513f', '#5f6b52', '#778466', '#8e9c7a', '#a4b18d', '#b8c49f', '#ced8b5']);
  mat('shutter', ['#101d18', '#182a23', '#20382e', '#2a483b', '#355948', '#436c58', '#56836d']);
  mat('brick', ['#3b1e1b', '#53281f', '#6c3326', '#84402d', '#9a4d36', '#ae6044', '#c27757']);
  mat('floor', ['#383a42', '#4e5159', '#656972', '#7b7f88', '#9298a0', '#a9aeb4', '#c2c6ca']);
  mat('door', ['#220b0b', '#331111', '#461917', '#5a211d', '#702a24', '#88392f', '#a04d3d']);
  mat('dark', ['#0b0b11', '#14141c', '#1d1e28', '#272935', '#333644', '#414555', '#535969']);
  mat('metal', ['#09090b', '#131317', '#1d1d23', '#292931', '#393943', '#4f4f5b', '#696977']);
  mat('leaf', ['#152818', '#1d3820', '#284a29', '#345d32', '#43713c', '#558648', '#6b9c56']);
  mat('box', ['#10221a', '#163021', '#1e3f29', '#285033', '#33623d', '#407448', '#518956']);
  mat('hydB', ['#2a3264', '#384888', '#4a60ab', '#5f7eca', '#789ade', '#96b6ec', '#bad0f6']);
  mat('hydL', ['#3c2b5c', '#513c7c', '#69509c', '#8266ba', '#9b80d2', '#b69ee4', '#d2c0f2']);
  mat('hydP', ['#58223e', '#783054', '#9a426e', '#ba5888', '#d474a0', '#e696ba', '#f2bcd4']);
  mat('hydW', ['#585e4c', '#7a826c', '#9ca68c', '#bcc6aa', '#d6dec4', '#e8eedc', '#f8fbf0']);
  mat('glass', ['#283850', '#3a5070', '#506e8d', '#6b8dae', '#8caecd', '#b2cde4', '#deecf7']);
  mat('haint', ['#2c4250', '#3c5866', '#4e7280', '#628e9a', '#78a6b0', '#92bec4', '#b2d6d8']);
  mat('brass', ['#3a2a0c', '#5c4414', '#86641e', '#b08a2a', '#d4ae40', '#ecd070', '#fff0b0']);
  mat('rose', ['#561226', '#7a1a36', '#a0264a', '#c63a5e', '#e05276', '#f27896', '#fca6bc']);
  mat('wood', ['#1e140e', '#2e1e14', '#40291b', '#543623', '#6a452d', '#82573a', '#9a6c4a']);
  const HOLE = 250; // window glass waiting for a room (lit) or daylight glass
  const EMI = 251; // emissive pixel, colour in e[]

  // per-mode exposure of the night colours: the house reads as a warm
  // butter yellow in the soft dusk afterglow, true albedo x ambient otherwise
  const EXPO = { night: [1.0, 1.0, 1.04], dusk: [1.28, 1.22, 1.03], golden: [1, 1, 1], day: [1, 1, 1] };

  // warm emissive interiors (lit rooms), dark -> light
  const ROOM = ['#2a130b', '#45200e', '#683113', '#8f4618', '#b8601f', '#db8029', '#f2a23b', '#ffc35c', '#ffdd90', '#fff2cc'];
  // curtains glowing with the room light behind them
  const CUR = ['#3a120e', '#571b13', '#782818', '#9a381d', '#bb4b24', '#d6632e', '#ea8240'];
  // a sheer lace / roller shade (warm translucent cloth)
  const LACE = ['#c87a34', '#e09a48', '#f2b862', '#ffd488', '#ffe8b8'];
  const JEWEL = ['#d84a5c', '#f2b23e', '#46b46e', '#5a7ee6', '#c868c8'];
  const LEAD = '#3a1e10';
  // fish-scale shingle (6 x 4, courses staggered by 3): shadowed under the
  // butts above, lit in the middle, a dark rounded butt at the bottom
  const FS = [
    [4, 4, 5, 5, 4, 3],
    [3, 4, 4, 4, 4, 3],
    [1, 3, 4, 4, 3, 1],
    [2, 1, 1, 1, 1, 2],
  ];
  // a leafy pot plant on the cat window's inner sill (backlit silhouette)
  const PLANT = [
    '...a.a..',
    '..aba.a.',
    '.abbbab.',
    'abbabbba',
    '.abbbba.',
    '..bbbb..',
    '..pppp..',
    '..pqqp..',
    '...pp...',
    '...pp...',
  ];
  const PLANT_C = { a: '#6a5418', b: '#45380e', p: '#8a3c18', q: '#a8521f' };

  const pack = (r, g, b) => ((255 << 24) | (Math.max(0, Math.min(255, Math.round(b))) << 16) | (Math.max(0, Math.min(255, Math.round(g))) << 8) | Math.max(0, Math.min(255, Math.round(r)))) >>> 0;
  const packHex = (h) => {
    const c = hexRGB(h);
    return pack(c[0], c[1], c[2]);
  };
  const toHex = (v) => '#' + [v & 255, (v >>> 8) & 255, (v >>> 16) & 255].map((n) => (n < 16 ? '0' : '') + n.toString(16)).join('');
  const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);

  /** night colours (packed) of every material for a light mode */
  function palette(mode) {
    const E = EXPO[mode] || EXPO.night;
    return RAMPS.map((r) =>
      r
        ? r.map((h) => {
            const c = hexRGB(h);
            return pack(c[0] * AMB[0] * E[0], c[1] * AMB[1] * E[1], c[2] * AMB[2] * E[2]);
          })
        : null
    );
  }

  // ------------------------------------------------------------------
  // Geometry (art px, inclusive ranges)
  // ------------------------------------------------------------------
  const GX = 201; // gable axis
  const GAPEX = 58; // top of the gable's roof edge
  const rake = (y) => Math.floor(((y - GAPEX) * 5) / 8); // half width of the gable roof edge at row y
  const WING = { x0: 166, x1: 237 }; // the gable wing's walls
  const MAIN = { x0: 238, x1: 309 }; // the hipped main block
  const POSTS = PLACE.porch.posts; // [236, 265, 296, 323]
  const WIN = {
    gl: { x0: 184, y0: 134, x1: 194, y1: 154 }, // gable, upstairs left
    cat: { x0: 208, y0: 134, x1: 218, y1: 154 }, // gable, upstairs right = place.catWindow
    ma: { x0: 252, y0: 133, x1: 262, y1: 148 }, // main block upstairs, over the door
    mb: { x0: 279, y0: 133, x1: 289, y1: 148 }, // main block upstairs, right
    bl: { x0: 173, y0: 170, x1: 178, y1: 189 }, // bay, left face
    bc: { x0: 187, y0: 170, x1: 216, y1: 189 }, // bay, centre (jewel transom y 170..173)
    br: { x0: 225, y0: 170, x1: 230, y1: 189 }, // bay, right face
    pw: { x0: 279, y0: 166, x1: 289, y1: 191 }, // porch window
    tr: { x0: 251, y0: 164, x1: 262, y1: 168 }, // door transom
    dg: { x0: 253, y0: 172, x1: 260, y1: 181 }, // door glass
  };
  const LANTERN = { x: 270, y: 174 }; // centre of the porch lantern glass
  const SWING = { x0: 300, x1: 318, top: 161, seat: 181 }; // the porch swing in the right-hand bay

  // ------------------------------------------------------------------
  // The bake
  // ------------------------------------------------------------------
  function build(mode) {
    const lit = mode === 'night' || mode === 'dusk';
    // light direction for rims and side faces: dusk afterglow from the left,
    // moon / sun from the right otherwise
    const fromLeft = mode === 'dusk';
    const m = new Uint8Array(NP);
    const l = new Int8Array(NP);
    const e = new Uint32Array(NP);
    const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const put = (x, y, mt, lv) => {
      if (!inb(x, y)) return;
      const p = y * W + x;
      m[p] = mt;
      l[p] = lv;
    };
    const rect = (x0, y0, x1, y1, mt, lv) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, mt, lv);
    };
    const hl = (x0, x1, y, mt, lv) => rect(x0, y, x1, y, mt, lv);
    const vl = (x, y0, y1, mt, lv) => rect(x, y0, x, y1, mt, lv);
    const at = (x, y) => (inb(x, y) ? m[y * W + x] : 0);
    const shade = (x, y, d) => {
      if (!inb(x, y)) return;
      const p = y * W + x;
      if (m[p] && m[p] < HOLE) l[p] += d;
    };
    const shadeRect = (x0, y0, x1, y1, d, lev) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lev === undefined || bayer(x, y) < lev) shade(x, y, d);
    };
    const shadeMat = (x0, y0, x1, y1, mt, d, lev) => {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) if (at(x, y) === mt && (lev === undefined || bayer(x, y) < lev)) l[y * W + x] += d;
    };
    const emit = (x, y, hex) => {
      if (!inb(x, y)) return;
      const p = y * W + x;
      m[p] = EMI;
      e[p] = packHex(hex);
    };
    // clapboard: a shadow line under every board (3 px courses)
    const clap = (x0, y0, x1, y1, base) => {
      for (let y = y0; y <= y1; y++) {
        const k = ((y % 3) + 3) % 3;
        const course = Math.floor(y / 3);
        for (let x = x0; x <= x1; x++) {
          let lv = k === 2 ? base - 2 : base;
          // staggered butt joints between boards, and a little paint wear
          const cell = Math.floor(x / 19);
          const jx = cell * 19 + Math.floor(HD.hash(course, cell, 41) * 19);
          if (k < 2 && x === jx && HD.hash(course, cell, 42) < 0.55) lv -= 1;
          else if (k === 0 && HD.hash(x, course, 43) < 0.05) lv += 1;
          put(x, y, M.siding, lv);
        }
      }
    };
    // standing-seam metal: a rib every 4 px (lit edge + shadow edge)
    const seam = (x, base) => {
      const k = ((x % 4) + 4) % 4;
      return k === 0 ? base + 1 : k === 1 ? base - 1 : base;
    };

    // ---------------- main block: hipped roof and chimney ----------------
    for (let y = 93; y <= 125; y++) {
      const d = (y - 93) >> 1;
      const x0 = 250 - d;
      const x1 = 297 + d;
      for (let x = x0; x <= x1; x++) {
        // the metal reflects the brighter sky near the ridge
        const f = 4.4 - ((y - 93) / 31) * 1.9;
        let lv = Math.floor(f) + (f - Math.floor(f) > bayer(x, y) ? 1 : 0);
        lv = seam(x, lv);
        if (y === 93) lv = 5;
        else if (y === 94) lv = 2;
        else if (y === 124) lv = 5;
        else if (y === 125) lv = 1;
        put(x, y, M.roof, lv);
      }
      if (y > 93 && y < 124) {
        // hip caps (the lit hip catches the afterglow / the moon)
        put(x0, y, M.roof, fromLeft ? 6 : 4);
        put(x1, y, M.roof, fromLeft ? 3 : 5);
      }
    }
    // chimney: a corbelled brick stack with a stone cap
    hl(279, 289, 72, M.trim, 3);
    hl(279, 289, 71, M.trim, 4);
    for (let y = 73; y <= 101; y++) {
      const corb = y <= 74;
      const x0 = corb ? 279 : 280;
      const x1 = corb ? 289 : 288;
      for (let x = x0; x <= x1; x++) {
        const row = y - 73;
        const mortarRow = row % 3 === 2;
        const joint = (x + (Math.floor(row / 3) % 2 ? 2 : 0)) % 4 === 0;
        let lv = mortarRow ? 1 : joint ? 2 : 3 + (bayer(x * 3, y) < 0.3 ? 1 : 0);
        if (x === x0) lv += fromLeft ? 1 : -1;
        if (x === x1) lv += fromLeft ? -1 : 1;
        put(x, y, M.brick, lv);
      }
    }
    hl(279, 289, 102, M.metal, 4); // flashing
    shadeRect(280, 75, 288, 77, -1, 0.7); // soot under the cap
    // the stack's soft shadow on the roof, away from the light
    if (fromLeft) {
      shadeMat(290, 94, 292, 103, M.roof, -1);
      shadeMat(293, 96, 294, 104, M.roof, -1, 0.5);
      shadeMat(280, 103, 290, 104, M.roof, -1, 0.6);
    } else {
      shadeMat(276, 94, 278, 103, M.roof, -1);
      shadeMat(280, 103, 290, 104, M.roof, -1, 0.6);
    }

    // ---------------- main block: upper wall ----------------
    hl(234, 313, 126, M.trim, 1); // soffit shadow
    hl(236, 311, 127, M.trim, 4); // frieze
    hl(236, 311, 128, M.trim, 3);
    clap(MAIN.x0, 129, MAIN.x1, 149, 4);
    rect(308, 129, 309, 149, M.trim, 4);
    vl(309, 129, 149, M.trim, 3);
    shadeRect(MAIN.x0, 129, MAIN.x1, 130, -1, 0.6);

    // ---------------- the gable wing ----------------
    // roof edges, bargeboards, apex truss, clapboard, vent, belt, fish scales
    for (let y = GAPEX; y <= 117; y++) {
      const o = rake(y);
      const xl = GX - o;
      const xr = GX + o;
      for (let x = xl; x <= xr; x++) {
        const d = Math.min(x - xl, xr - x);
        const leftSide = x - xl <= xr - x;
        if (d <= 2) {
          // the metal roof edge: outer pixel lit by the sky, inner darker
          let lv = d === 0 ? 5 : d === 1 ? 4 : 2;
          if (d === 0 && leftSide === fromLeft) lv = 6;
          if (d === 0 && leftSide !== fromLeft) lv = 4;
          put(x, y, M.roof, lv);
        } else if (d <= 4 && y >= 61) {
          put(x, y, M.trim, d === 3 ? 5 : 3);
        } else if (y >= 61) {
          if (y < 76) {
            // open apex truss: dark recess, spindles, king post, collar
            let mt = M.dark;
            let lv = 2;
            if (x === GX) {
              mt = M.trim;
              lv = 4;
            } else if (((x - GX) & 1) === 0 && y >= 66) {
              mt = M.trim;
              lv = 2;
            }
            if (d === 5) lv = Math.max(0, lv - 1);
            put(x, y, mt, lv);
          } else if (y <= 94) {
            put(x, y, M.siding, (y % 3 === 2 ? 2 : 4) - (d === 5 ? 2 : 0));
          } else if (y <= 96) {
            put(x, y, M.trim, y === 95 ? 5 : 3);
          } else {
            // sage fish-scale shingles: 6 px wide, 4 px courses, staggered by 3
            const row = Math.floor((y - 97) / 4);
            const ry = (y - 97) % 4;
            const sx = (((x - GX + 3 + (row & 1) * 3) % 6) + 6) % 6;
            let lv = FS[ry][sx];
            if (d === 5) lv -= 2;
            put(x, y, M.shingle, lv);
          }
        }
      }
    }
    // collar beam and king-post drop
    for (let x = GX - rake(75) + 5; x <= GX + rake(75) - 5; x++) put(x, 75, M.trim, 4);
    vl(GX, 76, 77, M.trim, 4);
    put(GX, 78, M.trim, 2);
    shadeMat(GX - 6, 76, GX + 6, 76, M.siding, -2);
    // finial
    vl(GX, 53, 57, M.metal, 3);
    put(GX, 53, M.metal, 5);
    put(GX, 56, M.metal, 4);
    // arched louvred vent
    hl(199, 203, 80, M.trim, 5);
    hl(197, 205, 81, M.trim, 5);
    rect(196, 82, 206, 91, M.trim, 4);
    vl(196, 82, 91, M.trim, fromLeft ? 5 : 3);
    vl(206, 82, 91, M.trim, fromLeft ? 3 : 5);
    hl(200, 202, 82, M.dark, 1);
    for (let y = 83; y <= 90; y++) for (let x = 198; x <= 204; x++) put(x, y, y & 1 ? M.trim : M.dark, y & 1 ? 2 : 1);
    hl(195, 207, 92, M.trim, 5);
    hl(196, 206, 93, M.trim, 2);
    shadeMat(195, 94, 207, 94, M.siding, -2);
    // the pent roof and cornice at the foot of the gable
    for (let x = 161; x <= 241; x++) {
      put(x, 118, M.roof, 5);
      put(x, 119, M.roof, seam(x, 4));
      put(x, 120, M.roof, seam(x, 3));
      put(x, 121, M.roof, 1);
    }
    put(161, 118, M.roof, fromLeft ? 6 : 4);
    put(241, 118, M.roof, fromLeft ? 4 : 6);
    hl(162, 240, 122, M.trim, 1);
    for (let x = 162; x <= 240; x++) put(x, 123, M.trim, (x & 1) === 0 ? 5 : 3); // dentils
    hl(162, 240, 124, M.trim, 4);
    // upper storey of the gable wing
    clap(WING.x0, 125, WING.x1, 156, 4);
    hl(WING.x0, WING.x1, 125, M.siding, 1);
    rect(WING.x0, 125, WING.x0 + 1, 197, M.trim, 4);
    vl(WING.x0, 125, 197, M.trim, fromLeft ? 5 : 3);
    rect(WING.x1 - 1, 125, WING.x1, 197, M.trim, 4);
    vl(WING.x1, 125, 197, M.trim, fromLeft ? 3 : 5);
    shadeRect(WING.x0 + 2, 126, WING.x1 - 2, 127, -1, 0.5);
    // the wing stands proud of the main block: its shadow on the main wall
    if (fromLeft) {
      shadeMat(238, 129, 241, 149, M.siding, -1, 0.9);
      shadeMat(238, 129, 239, 149, M.siding, -1);
    }

    // ---------------- windows ----------------
    // a sash window: casing, cornice-style head cap, sill, optional shutters;
    // glass pixels become HOLE (filled later by a room or daylight glass)
    function sash(w, o) {
      const { x0, y0, x1, y1 } = w;
      const sh = o.shutters || '';
      const sw = o.sw || 4;
      // shutters (louvred, deep green) with a thin shadow on the wall
      const shutter = (sx0, sx1) => {
        for (let y = y0 - 2; y <= y1; y++)
          for (let x = sx0; x <= sx1; x++) {
            const stile = x === sx0 || x === sx1;
            const rail = y === y0 - 2 || y === y1 || y === Math.round((y0 + y1) / 2);
            let lv = stile || rail ? 3 : y & 1 ? 4 : 1;
            if (stile && x === (fromLeft ? sx0 : sx1)) lv = 4;
            put(x, y, M.shutter, lv);
          }
        const sx = fromLeft ? sx1 + 1 : sx0 - 1;
        if (at(sx, y0) === M.siding) for (let y = y0 - 1; y <= y1 + 1; y++) shade(sx, y, -1);
        for (let x = sx0; x <= sx1; x++) shade(x, y1 + 1, -1);
      };
      if (sh.includes('L')) shutter(x0 - 2 - sw, x0 - 3);
      if (sh.includes('R')) shutter(x1 + 3, x1 + 2 + sw);
      // casing
      rect(x0 - 2, y0 - 2, x1 + 2, y1, M.trim, 4);
      vl(x0 - 2, y0 - 2, y1, M.trim, fromLeft ? 5 : 3);
      vl(x1 + 2, y0 - 2, y1, M.trim, fromLeft ? 3 : 5);
      vl(x0 - 1, y0 - 1, y1, M.trim, 3);
      vl(x1 + 1, y0 - 1, y1, M.trim, 3);
      hl(x0 - 1, x1 + 1, y0 - 1, M.trim, 2);
      // head cap
      if (o.cap !== false) {
        hl(x0 - 3, x1 + 3, y0 - 4, M.trim, 6);
        hl(x0 - 2, x1 + 2, y0 - 3, M.trim, 3);
        put(x0 - 3, y0 - 3, M.trim, 1);
        put(x1 + 3, y0 - 3, M.trim, 1);
      }
      // sill
      if (o.sill !== false) {
        hl(x0 - 3, x1 + 3, y1 + 1, M.trim, 6);
        hl(x0 - 2, x1 + 2, y1 + 2, M.trim, 2);
      }
      // glass
      rect(x0, y0, x1, y1, HOLE, 0);
      // sash bars (2-over-2 unless told otherwise)
      if (o.rail !== undefined && o.rail !== null) {
        hl(x0, x1, o.rail, M.trim, 4);
        hl(x0, x1, o.rail + 1, M.trim, 2);
      }
      if (o.mullion !== undefined && o.mullion !== null) {
        const yA = o.mullionFrom !== undefined ? o.mullionFrom : y0;
        vl(o.mullion, yA, y1, M.trim, 4);
      }
    }

    sash(WIN.gl, { shutters: 'L', rail: 144, mullion: 189 });
    // the cat window: lower sash raised (open for the summer evening)
    sash(WIN.cat, { shutters: 'R', rail: 142, mullion: 213, mullionFrom: 134 });
    for (let y = 144; y <= 154; y++) put(213, y, HOLE, 0); // open: no bar below the rail
    hl(208, 218, 143, M.trim, 3);

    // ---------------- bay window ----------------
    // roof: a little hip with ribs; side planes foreshortened
    for (let y = 157; y <= 163; y++) {
      const k = y - 157;
      const x0 = 172 - k;
      const x1 = 231 + k;
      for (let x = x0; x <= x1; x++) {
        let lv;
        if (y === 157) lv = 1;
        else if (y === 162) lv = 5;
        else if (y === 163) lv = 1;
        else {
          const side = x < 182 - (y - 158) ? -1 : x > 221 + (y - 158) ? 1 : 0;
          lv = seam(x, side === 0 ? 4 : side === (fromLeft ? -1 : 1) ? 4 : 2);
          if (side === 0 && y === 158) lv = 3;
        }
        put(x, y, M.roof, lv);
      }
      if (y > 157 && y < 162) {
        put(182 - (y - 158), y, M.roof, 5); // hip caps
        put(221 + (y - 158), y, M.roof, fromLeft ? 3 : 5);
      }
    }
    // walls and corner posts
    clap(169, 164, 234, 197, 4);
    hl(169, 234, 164, M.trim, 1);
    hl(169, 234, 165, M.trim, 4);
    hl(169, 234, 166, M.trim, 3);
    for (const cx of [169, 181, 221, 233]) {
      rect(cx, 165, cx + 1, 197, M.trim, 4);
      vl(cx, 165, 197, M.trim, 5);
    }
    // side faces turned away / towards the light
    const litFace = fromLeft ? [171, 180] : [223, 232];
    const darkFace = fromLeft ? [223, 232] : [171, 180];
    shadeMat(darkFace[0], 165, darkFace[1], 197, M.siding, -1);
    shadeMat(litFace[0], 165, litFace[1], 197, M.siding, 1, 0.5);
    sash(WIN.bl, { cap: false, rail: 179 });
    sash(WIN.br, { cap: false, rail: 179 });
    sash(WIN.bc, { cap: false, rail: 174 });
    hl(185, 218, 168, M.trim, 5);
    // panelled aprons under the bay windows
    const apron = (x0, x1) => {
      rect(x0, 193, x1, 196, M.trim, 3);
      rect(x0 + 1, 194, x1 - 1, 195, M.trim, 4);
      hl(x0 + 1, x1 - 1, 194, M.trim, 2);
    };
    apron(171, 180);
    apron(184, 219);
    apron(223, 232);
    hl(169, 234, 197, M.trim, 3);
    shadeMat(darkFace[0], 165, darkFace[1], 197, M.trim, -1);

    // ---------------- main block: ground floor behind the porch ----------------
    clap(MAIN.x0, 159, MAIN.x1, 195, 4);
    rect(308, 159, 309, 195, M.trim, 3); // corner board
    // the haint-blue porch ceiling glimpsed above the frieze
    hl(232, 327, 159, M.haint, 2);
    hl(232, 327, 160, M.haint, 3);
    // side porch (wraps round the corner): a shadowed depth
    for (let y = 161; y <= 195; y++)
      for (let x = 310; x <= 327; x++) {
        let mt = M.dark;
        let lv = y < 164 ? 3 : y < 170 ? 4 : 5;
        if (y >= 164 && y < 170 && bayer(x, y) < (y - 164) / 6) lv = 5;
        if (y <= 162) (mt = M.haint), (lv = 1);
        if (y >= 189) (mt = M.floor), (lv = y === 189 ? 1 : 2);
        put(x, y, mt, lv);
      }
    // the side wall, foreshortened
    for (let y = 161; y <= 188; y++) {
      put(310, y, M.siding, y % 3 === 2 ? 0 : 1);
      put(311, y, M.siding, y % 3 === 2 ? 0 : 2);
    }
    put(SWING.x0 + 2, 161, M.metal, 4);
    put(SWING.x1 - 2, 161, M.metal, 4);
    // door: casing, transom, oxblood leaf with a glazed panel and raised panels
    rect(249, 161, 264, 195, M.trim, 4);
    vl(249, 161, 195, M.trim, fromLeft ? 5 : 3);
    vl(250, 163, 195, M.trim, 3);
    rect(WIN.tr.x0, WIN.tr.y0, WIN.tr.x1, WIN.tr.y1, HOLE, 0);
    for (const bx of [254, 259]) vl(bx, 164, 168, M.trim, 3);
    hl(251, 262, 169, M.trim, 4);
    rect(251, 170, 262, 195, M.door, 3);
    vl(251, 170, 195, M.door, fromLeft ? 4 : 2);
    vl(262, 170, 195, M.door, 2);
    rect(WIN.dg.x0 - 1, WIN.dg.y0 - 1, WIN.dg.x1 + 1, WIN.dg.y1 + 1, M.door, 1);
    rect(WIN.dg.x0, WIN.dg.y0, WIN.dg.x1, WIN.dg.y1, HOLE, 0);
    for (const px of [253, 258]) {
      rect(px, 184, px + 2, 193, M.door, 2);
      rect(px + 1, 185, px + 1, 192, M.door, 4);
    }
    hl(252, 261, 183, M.door, 4);
    put(260, 182 + 2, M.brass, 5);
    put(260, 185, M.brass, 3);
    hl(251, 262, 195, M.door, 1);
    // porch lantern: black carriage lantern on a short arm
    put(267, 175, M.metal, 3);
    put(268, 175, M.metal, 4);
    hl(269, 271, 170, M.metal, 3);
    hl(268, 272, 171, M.metal, 4);
    vl(268, 172, 177, M.metal, 3);
    vl(272, 172, 177, M.metal, 2);
    rect(269, 172, 271, 177, HOLE, 0);
    hl(268, 272, 178, M.metal, 4);
    put(270, 179, M.metal, 3);
    put(270, 169, M.metal, 4);
    // porch window (dining room)
    sash(WIN.pw, { cap: true, rail: 178, mullion: 284 });
    // upstairs main block
    sash(WIN.ma, { shutters: 'LR', sw: 3, rail: 140, mullion: 257 });
    sash(WIN.mb, { shutters: 'LR', sw: 3, rail: 140, mullion: 284 });

    // covered porch: everything under the porch roof sits in shade
    for (let y = 159; y <= 195; y++)
      for (let x = MAIN.x0; x <= 309; x++) {
        const k = y < 166 ? 1.9 : y < 176 ? 1.45 : 1.15;
        const d = Math.floor(k) + (k - Math.floor(k) > bayer(x, y) ? 1 : 0);
        shade(x, y, -d);
      }

    // ---------------- porch roof ----------------
    for (let y = 150; y <= 158; y++) {
      const k = y - 150;
      const x0 = 238 - Math.min(k, 6);
      const x1 = 322 + Math.min(k, 6);
      for (let x = x0; x <= x1; x++) {
        let lv;
        if (y === 150) lv = 2;
        else if (y <= 155) lv = seam(x, y <= 152 ? 4 : 3);
        else if (y === 156) lv = 5;
        else lv = -1;
        if (lv >= 0) put(x, y, M.roof, lv);
        else put(x, y, M.trim, y === 157 ? 4 : 2);
      }
      if (y > 150 && y < 156) {
        put(x0, y, M.roof, fromLeft ? 6 : 4);
        put(x1, y, M.roof, fromLeft ? 3 : 5);
      }
    }

    // ---------------- porch frieze, posts, brackets ----------------
    const postL = POSTS.map((c) => c - 1);
    // spindle frieze between posts
    hl(232, 327, 159, M.trim, 4);
    for (let x = 232; x <= 327; x++) {
      if ((x & 1) === 0) {
        put(x, 160, M.trim, 2);
        put(x, 161, M.trim, 5);
        put(x, 162, M.trim, 3);
      }
    }
    hl(232, 327, 163, M.trim, 4);
    hl(232, 327, 164, M.trim, 2);
    // turned posts
    for (const c of POSTS) {
      for (let y = 159; y <= 195; y++) {
        const yy = y - 159;
        let half = 1;
        if (yy === 3 || yy === 17 || yy === 22) half = 2; // rings
        if (yy >= 9 && yy <= 12) half = 2; // the vase
        for (let x = c - half; x <= c + half; x++) {
          const dx = x - c;
          let lv = dx === 0 ? 4 : dx < 0 ? (fromLeft ? 5 : 3) : fromLeft ? 2 : 5;
          if (half === 2 && Math.abs(dx) === 2) lv = dx < 0 === fromLeft ? 4 : 1;
          if (yy === 4 || yy === 16 || yy === 21) lv -= 1; // necks
          put(x, y, M.trim, lv);
        }
      }
      // sawn brackets with a pierced eye
      for (const s of [-1, 1]) {
        if ((c === POSTS[0] && s < 0) || (c === POSTS[3] && s > 0)) continue;
        const b = (dx, dy, lv) => put(c + s * dx, 164 + dy, M.trim, lv);
        b(2, 0, 4);
        b(3, 0, 4);
        b(4, 0, 4);
        b(5, 0, 3);
        b(2, 1, 4);
        b(3, 1, 0);
        b(4, 1, 3);
        b(2, 2, 4);
        b(3, 2, 3);
        b(2, 3, 3);
      }
    }
    // ---------------- balustrade, floor edge, lattice, steps ----------------
    const OPEN = [249, 263]; // the stair opening
    const NEWEL = 247; // newel post left of the steps (247..248)
    for (let x = 232; x <= 327; x++) {
      if (x >= OPEN[0] && x <= OPEN[1]) continue;
      if (postL.some((p) => x >= p && x <= p + 2)) continue;
      if (x >= NEWEL && x <= NEWEL + 1) continue;
      put(x, 182, M.trim, 6);
      put(x, 183, M.trim, 3);
      if ((x & 1) === 0) {
        for (let y = 184; y <= 192; y++) put(x, y, M.trim, y === 186 || y === 190 ? 5 : y === 188 ? 3 : 4);
      }
      put(x, 193, M.trim, 4);
    }
    rect(NEWEL, 180, NEWEL + 1, 195, M.trim, 4);
    vl(NEWEL, 180, 195, M.trim, fromLeft ? 5 : 3);
    hl(NEWEL - 1, NEWEL + 2, 180, M.trim, 6);
    // floor edge (fascia)
    hl(232, 328, 194, M.trim, 5);
    hl(232, 328, 195, M.trim, 4);
    hl(232, 328, 196, M.trim, 2);
    // lattice skirt with brick piers under the posts
    for (let y = 197; y <= 205; y++)
      for (let x = 232; x <= 328; x++) {
        if (x >= 246 && x <= 271) continue;
        const a = (x + y) & 3;
        const b2 = (x - y) & 3;
        const slat = a === 0 || b2 === 0;
        put(x, y, slat ? M.trim : M.dark, slat ? (a === 0 && b2 === 0 ? 4 : 3) : 1);
      }
    hl(232, 245, 197, M.trim, 4);
    hl(272, 328, 197, M.trim, 4);
    for (const c of [POSTS[0], POSTS[2], POSTS[3]]) {
      for (let y = 197; y <= 205; y++)
        for (let x = c - 2; x <= c + 2; x++) {
          const row = y - 197;
          const lv = row % 3 === 2 ? 1 : (x + (row % 6 < 3 ? 0 : 2)) % 4 === 0 ? 2 : 3;
          put(x, y, M.brick, lv + (x === c - 2 ? (fromLeft ? 1 : -1) : 0));
        }
    }
    // steps: three treads with white stringers
    for (let y = 197; y <= 205; y++)
      for (let x = 246; x <= 271; x++) {
        const k = (y - 197) % 3;
        put(x, y, M.floor, k === 0 ? 5 : k === 1 ? 3 : 2);
      }
    for (const sx of [246, 271]) vl(sx, 197, 205, M.trim, sx === 246 ? (fromLeft ? 5 : 3) : fromLeft ? 3 : 5);

    // ---------------- foundation ----------------
    for (let y = 198; y <= 205; y++)
      for (let x = 164; x <= 236; x++) {
        if (x >= 232 && at(x, y) !== 0) continue;
        const row = y - 198;
        const mortar = row % 3 === 2;
        const joint = (x + (Math.floor(row / 3) & 1 ? 2 : 0)) % 4 === 0;
        put(x, y, M.brick, mortar ? 1 : joint ? 2 : 3 + (bayer(x * 5, y * 3) < 0.25 ? 1 : 0));
      }
    hl(164, 236, 198, M.trim, 2); // water table
    // crawlspace vent
    rect(198, 200, 204, 203, M.dark, 1);
    for (let x = 199; x <= 203; x += 2) vl(x, 200, 203, M.metal, 3);

    // ---------------- glass: lit rooms (emissive) or daylight glass ----------------
    const roomIx = (i) => ROOM[clampI(Math.floor(i), 0, ROOM.length - 1)];
    const glow = (x, y, lx, ly, rad, base, gain, sq) => {
      const dx = x - lx;
      const dy = (y - ly) * (sq || 1.15);
      const f = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / rad);
      return base + gain * f + (bayer(x, y) - 0.5) * 0.9;
    };
    const fill = (w, fn) => {
      for (let y = w.y0; y <= w.y1; y++)
        for (let x = w.x0; x <= w.x1; x++) {
          if (at(x, y) !== HOLE) continue;
          if (lit) emit(x, y, fn(x, y));
          else put(x, y, M.glass, dayGlass(w, x, y));
        }
    };
    // daylight glass: sky reflection bright above, trees darker below, a glint
    const dayGlass = (w, x, y) => {
      const v = (y - w.y0) / Math.max(1, w.y1 - w.y0);
      let lv = v < 0.3 ? 5 : v < 0.55 ? 4 : v < 0.8 ? 3 : 2;
      if (bayer(x, y) < 0.5 && (v > 0.27 && v < 0.33)) lv--;
      const gl = (x - w.x0 + (y - w.y0) * 0.6) % 14;
      if (gl >= 3 && gl < 4.5 && v < 0.75) lv = 6;
      if (x - w.x0 < 2 || w.x1 - x < 2) lv -= 2; // curtains seen through
      return clampI(lv, 0, 6);
    };
    // a curtain panel hanging at the left or right edge of a window
    const curtain = (x, y, w, side, width, tieY) => {
      const fromEdge = side < 0 ? x - w.x0 : w.x1 - x;
      let wd = width;
      if (tieY) {
        const k = y - tieY;
        if (k > 0) wd = Math.max(1, width - 1 + Math.min(1, k >> 2));
        else if (k > -4) wd = width - 1;
      }
      if (fromEdge >= wd) return null;
      const fold = (fromEdge + (y >> 3)) % 2;
      return CUR[clampI(3 + (fold ? 1 : 0) - (fromEdge === wd - 1 ? 1 : 0) + (y < w.y0 + 2 ? -1 : 0), 0, 6)];
    };

    // bay centre: the living room with a jewel transom, curtains, a lamp
    fill(WIN.bc, (x, y) => {
      if (y <= 173) {
        const i = x - WIN.bc.x0;
        if (i % 5 === 0 || y === 170) return LEAD;
        const cell = Math.floor(i / 5);
        const j = (cell * 3 + (y > 171 ? 1 : 0)) % JEWEL.length;
        if (y === 171 && i % 5 === 2) return '#fff0c8';
        return JEWEL[(cell % 2 === 0 ? 1 : j) % JEWEL.length];
      }
      const c = curtain(x, y, WIN.bc, x < 202 ? -1 : 1, 4, 182);
      if (c) return c;
      // lamp: a glowing shade on a side table, right of centre
      if (y >= 179 && y <= 182 && x >= 205 - (y - 179 > 1 ? 1 : 0) && x <= 208 + (y - 179 > 1 ? 1 : 0)) return y === 182 ? ROOM[8] : ROOM[9];
      if (x === 206 || x === 207) {
        if (y >= 183 && y <= 186) return ROOM[2];
      }
      if (y === 187 && x >= 203 && x <= 210) return ROOM[1];
      if (y >= 188 && (x === 204 || x === 209)) return ROOM[1];
      // a sofa back
      if (y >= 185 && x >= 191 && x <= 201) {
        if (y === 185 && (x === 191 || x === 201)) return roomIx(glow(x, y, 206, 181, 18, 4, 3));
        return y === 185 ? ROOM[3] : ROOM[2];
      }
      // a framed picture on the back wall
      if (y >= 176 && y <= 180 && x >= 193 && x <= 198) {
        if (y === 176 || y === 180 || x === 193 || x === 198) return ROOM[3];
        return y < 178 ? ROOM[6] : ROOM[5];
      }
      return roomIx(glow(x, y, 206, 181, 15, 5, 3.6));
    });
    // bay sides: deeper orange, showing the angle
    fill(WIN.bl, (x, y) => (x <= WIN.bl.x0 + 1 ? CUR[3 + ((y >> 2) & 1)] : roomIx(glow(x, y, 180, 178, 12, 4, 2.2))));
    fill(WIN.br, (x, y) => (x >= WIN.br.x1 - 1 ? CUR[3 + ((y >> 2) & 1)] : roomIx(glow(x, y, 222, 178, 12, 4, 2.2))));
    // upstairs left: a bedroom, curtains half drawn, a lamp on the dresser
    fill(WIN.gl, (x, y) => {
      const c = curtain(x, y, WIN.gl, x < 189 ? -1 : 1, 3, 146);
      if (c) return c;
      if (y >= 148 && x >= 186 && x <= 192) return y === 148 ? ROOM[3] : ROOM[2];
      if (y >= 144 && y <= 147 && x >= 190 && x <= 191) return y === 144 ? ROOM[9] : ROOM[8];
      return roomIx(glow(x, y, 191, 146, 14, 4.4, 3.2));
    });
    // the cat window: an empty lit room tonight, a pot plant on the sill
    fill(WIN.cat, (x, y) => {
      // a leafy pot plant on the inner sill, backlit by the room
      const px = x - 211;
      const py = y - 145;
      if (px >= 0 && px < PLANT[0].length && py >= 0 && py < PLANT.length) {
        const ch = PLANT[py][px];
        if (ch !== '.') return PLANT_C[ch];
      }
      return roomIx(glow(x, y, 219, 146, 17, 4.7, 3.5) - (y <= 136 ? 0.5 : 0));
    });
    // main upstairs left: the landing, a ceiling light and a framed picture
    fill(WIN.ma, (x, y) => {
      const c = curtain(x, y, WIN.ma, x < 257 ? -1 : 1, 2, 143);
      if (c) return c;
      if (y >= 141 && y <= 145 && x >= 254 && x <= 256) return y === 141 || y === 145 || x === 254 || x === 256 ? ROOM[3] : ROOM[5];
      return roomIx(glow(x, y, 258, 133, 14, 4.4, 3.2, 0.9));
    });
    // main upstairs right: a bedroom with the roller shade half down
    fill(WIN.mb, (x, y) => {
      if (y <= 139) {
        if (y === 139) return x === 284 ? LACE[0] : LACE[1];
        return LACE[(x + y) % 9 === 0 ? 1 : 2];
      }
      if (y >= 145 && x >= 280 && x <= 287) return y === 145 ? ROOM[3] : ROOM[2];
      return roomIx(glow(x, y, 284, 142, 10, 4.2, 2.4));
    });
    // porch window: the dining room, a little chandelier
    fill(WIN.pw, (x, y) => {
      const c = curtain(x, y, WIN.pw, x < 284 ? -1 : 1, 3, 177);
      if (c) return c;
      if (y === 167 && x === 284) return ROOM[3];
      if (y === 168 && x >= 283 && x <= 285) return ROOM[9];
      if (y === 169 && (x === 282 || x === 286)) return ROOM[8];
      if (y >= 186 && x >= 281 && x <= 287) return y === 186 ? ROOM[3] : ROOM[2];
      return roomIx(glow(x, y, 284, 170, 16, 4.3, 3.6, 0.9));
    });
    // door transom and glazed panel
    fill(WIN.tr, (x, y) => roomIx(glow(x, y, 257, 168, 8, 5.5, 2.5)));
    fill(WIN.dg, (x, y) => {
      // etched glass: a frosted oval in the middle of the panel
      const ox = (x - 256.5) / 3.2;
      const oy = (y - 176.5) / 4.6;
      const d = ox * ox + oy * oy;
      if (d < 1 && d > 0.45) return LACE[3];
      return roomIx(glow(x, y, 256, 176, 7, 5.6, 2));
    });
    // lantern glass: its own fixed warm glow (the moth flies in front)
    for (let y = 172; y <= 177; y++)
      for (let x = 269; x <= 271; x++) {
        if (lit) emit(x, y, y === 172 ? '#ffd27a' : x === 270 && y >= 174 && y <= 175 ? '#fffbe6' : '#ffe4a0');
        else put(x, y, M.glass, y < 175 ? 5 : 4);
      }

    // ---------------- plantings: hydrangeas and boxwoods ----------------
    const rnd = HD.rng(9171);
    // a rounded shrub mass with leafy texture, lit from the sky and the light side
    const bush = (cx, cy, rx, ry, mt, base) => {
      for (let y = Math.floor(cy - ry); y <= Math.min(205, Math.ceil(cy + ry)); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x - cx) / (rx + 0.3);
          const dy = (y - cy) / (ry + 0.3);
          // lumpy outline
          const lump = 0.12 * Math.sin(x * 1.7 + cy) + 0.1 * Math.sin(x * 0.9 + y * 0.4);
          const d = dx * dx + dy * dy;
          if (d > 1 + lump) continue;
          let lv = base;
          if (dy < -0.4) lv += 1;
          if (dy > 0.5) lv -= 1;
          if (dx < -0.25 === fromLeft && dy < 0.35 && Math.abs(dx) > 0.25) lv += 1;
          // leaf clumps: a lit fleck over a shadow fleck
          const h = HD.hash(x, y, 77, mt);
          if (h < 0.18) lv += 1;
          else if (h > 0.84) lv -= 1;
          if (d > 0.78 && dy > 0) lv -= 1;
          put(x, y, mt, lv);
        }
    };
    // hydrangea shrubs in front of the bay, crowned with mophead flowers
    const shrubs = [
      [177, 198, 11, 8, ['hydB', 'hydB', 'hydL']],
      [199, 197, 12, 9, ['hydL', 'hydB', 'hydL', 'hydP']],
      [222, 198, 11, 8, ['hydP', 'hydP', 'hydL']],
      [321, 198, 9, 7, ['hydW']], // a white one at the porch corner
    ];
    for (const s of shrubs) bush(s[0], s[1], s[2], s[3], M.leaf, 2);
    const HEAD = [
      [0, -1, 5],
      [1, -1, 5],
      [-1, 0, 4],
      [0, 0, 5],
      [1, 0, 4],
      [2, 0, 3],
      [-1, 1, 3],
      [0, 1, 4],
      [1, 1, 3],
      [2, 1, 2],
      [0, 2, 2],
      [1, 2, 1],
    ];
    for (const s of shrubs) {
      const white = s[4][0] === 'hydW';
      const n = white ? 8 : 13;
      for (let k = 0; k < n; k++) {
        // heads crowd the top of the shrub and dot its front
        const a = Math.PI * (0.06 + (0.88 * (k + rnd() * 0.6)) / n);
        const rr = k % 3 === 2 ? 0.25 + rnd() * 0.3 : 0.62 + rnd() * 0.3;
        const hx = R(s[0] - Math.cos(a) * s[2] * rr) - 1;
        const hy = R(s[1] - Math.sin(a) * s[3] * rr) - (k % 3 === 2 ? -2 : 0);
        const fm = M[s[4][k % s[4].length]];
        const shade0 = hy > s[1] ? -1 : 0;
        for (const p of HEAD) {
          if (hy + p[1] > 204) continue;
          if (!(rnd() < 0.93 || p[2] >= 4)) continue;
          put(hx + p[0], hy + p[1], fm, p[2] + shade0 + (white ? 1 : 0) - (fromLeft ? 0 : p[0] < 0 ? 1 : 0));
        }
      }
    }
    // a climbing rose twined up the middle porch post, flowering at the top
    {
      const c = POSTS[2];
      const leafAt = (x, y, lv) => put(x, y, M.leaf, lv);
      const bloom = (x, y, big) => {
        put(x, y, M.rose, 5);
        put(x + 1, y, M.rose, 4);
        put(x, y + 1, M.rose, 3);
        put(x + 1, y + 1, M.rose, 2);
        if (big) (put(x - 1, y, M.rose, 4), put(x, y - 1, M.rose, 6));
      };
      for (let y = 196; y >= 160; y--) {
        const k = 196 - y;
        const cx = c + Math.round(1.6 * Math.sin(k * 0.42));
        put(cx, y, M.wood, 3);
        // leaf clumps either side of the cane, fuller towards the top
        const reach = y < 174 ? 3 : y < 186 ? 2 : 1;
        for (let dx = -reach; dx <= reach; dx++) {
          if (dx === 0) continue;
          const h = HD.hash(y, dx, 51);
          if (h < 0.62 - Math.abs(dx) * 0.12) leafAt(cx + dx, y, h < 0.2 ? 4 : h < 0.45 ? 3 : 2);
        }
      }
      // blooms scattered up the post, thicker near the top
      for (let k = 0; k < 16; k++) {
        const y = 162 + Math.floor(HD.hash(k, 3, 54) * (k < 10 ? 16 : 30));
        const x = c - 3 + Math.floor(HD.hash(k, 4, 55) * 6);
        bloom(x, y, k % 3 === 0);
      }
      // a spray along the frieze either side of the post top
      for (let x = c - 8; x <= c + 7; x++) {
        if (Math.abs(x - c) < 2) continue;
        const y = 164 + (Math.abs(x - c) > 5 ? 1 : 0) + (HD.hash(x, 9, 56) < 0.4 ? 1 : 0);
        leafAt(x, y, HD.hash(x, 9, 57) < 0.5 ? 3 : 2);
        if (HD.hash(x, 9, 58) < 0.5) leafAt(x, y + 1, 2);
        if (HD.hash(x, 9, 59) < 0.3) bloom(x, y - 1, false);
      }
    }

    // boxwoods along the porch skirt and beside the steps
    for (const b of [
      [239, 202, 6, 4],
      [277, 202, 5, 4],
      [289, 201, 7, 5],
      [302, 202, 5, 4],
    ])
      bush(b[0], b[1], b[2], b[3], M.box, 3);

    // anything still marked as glass and never filled reads as dark glass
    for (let p = 0; p < NP; p++) if (m[p] === HOLE) (m[p] = M.dark), (l[p] = 1);

    // ---------------- to canvases ----------------
    const pal = palette(mode);
    let bx0 = W;
    let by0 = H;
    let bx1 = -1;
    let by1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (m[y * W + x]) {
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
    const bw = bx1 - bx0 + 1;
    const bh = by1 - by0 + 1;
    const mk = (pick) => {
      const c = HD.canvas(bw, bh, true);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(bw, bh);
      const u = new Uint32Array(img.data.buffer);
      for (let y = 0; y < bh; y++)
        for (let x = 0; x < bw; x++) {
          const p = (y + by0) * W + (x + bx0);
          u[y * bw + x] = pick(p) >>> 0;
        }
      ctx.putImageData(img, 0, 0);
      return c;
    };
    // dusk: the zenith's cool light on the upper house, the warm horizon
    // glow lower down (banded and dithered, a few percent either way)
    const TW = mode === 'dusk' ? [[0.93, 0.95, 1.07], [0.97, 0.98, 1.03], [1, 1, 1], [1.03, 1.0, 0.97]] : null;
    const tint = (p, v) => {
      if (!TW) return v;
      const x = p % W;
      const y = (p - x) / W;
      const f = clampI((y - 70) / 42, 0, 3);
      const i = Math.min(3, Math.floor(f) + (f - Math.floor(f) > bayer(x, y) ? 1 : 0));
      const k = TW[i];
      return pack((v & 255) * k[0], ((v >>> 8) & 255) * k[1], ((v >>> 16) & 255) * k[2]);
    };
    const house = mk((p) => (m[p] && m[p] < HOLE ? tint(p, pal[m[p]][clampI(l[p], 0, 6)]) : 0));
    const emc = mk((p) => (m[p] === EMI ? e[p] : 0));
    // skyline: top of the house per column
    const sky = new Int16Array(W).fill(999);
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++)
        if (m[y * W + x]) {
          sky[x] = y;
          break;
        }
    const col = (name, lv) => toHex(pal[M[name]][clampI(lv, 0, 6)]);
    return { house, emc, x: bx0, y: by0, lit, mode, fromLeft, col, sky };
  }

  const cache = {};
  const modeOf = (ed) => ((HD.LIGHTING && HD.LIGHTING[ed.light]) || { mode: 'night' }).mode;
  /** baked art for the current edition (cached per light mode, so switching is instant) */
  const art = HD.perEdition((ed) => cache[modeOf(ed)] || (cache[modeOf(ed)] = build(modeOf(ed))));
  const here = () => HD.place && HD.place().id === 'herndon';

  // ------------------------------------------------------------------
  // Animated bits
  // ------------------------------------------------------------------
  /** a moth circling the porch lantern (dusk and night) */
  function moth(g, t, A) {
    const ts = T.step(t, 12);
    const a = T.TAU * T.phase(ts, 2.9) + 1.3 * Math.sin(T.TAU * T.phase(ts, 7.1, 0.3));
    const rx = 3.2 + 2.2 * T.noise(ts, 5.3, 811);
    const ry = 2.4 + 1.4 * T.noise(ts, 4.1, 812);
    // now and then it settles on the lantern glass for a while
    const rest = T.noise(ts, 23, 813) > 0.72;
    const x = rest ? LANTERN.x + 2 : R(LANTERN.x + Math.cos(a) * rx + (T.noise(ts, 0.7, 814) - 0.5) * 1.6);
    const y = rest ? LANTERN.y - 1 : R(LANTERN.y - 1 + Math.sin(a) * ry + (T.noise(ts, 0.6, 815) - 0.5) * 1.4);
    const flap = !rest && Math.floor(ts * 12) % 2 === 0;
    // dusty brown body, paler wings catching the bulb
    g.px(x, y, A.col('wood', 4));
    if (flap) {
      g.px(x - 1, y - 1, A.col('wood', 6));
      g.px(x + 1, y - 1, A.col('wood', 6));
    } else if (!rest) g.px(x, y - 1, A.col('wood', 6));
    else g.px(x + 1, y, A.col('wood', 3));
  }

  /** the sheer curtain in the open lower sash of the cat window, stirring */
  function sheer(g, t) {
    const w = WIN.cat;
    const b = HD.summer ? HD.summer.breeze(t) : T.wave(t, 6.5);
    const ts = T.step(t, 8);
    // lower sash is open: the sheer hangs free and the breeze lifts its hem
    for (let y = 144; y <= w.y1; y++) {
      const k = (y - 144) / (w.y1 - 144);
      const edge = 2.6 + k * (1.4 + 1.3 * b) + 0.55 * Math.sin(T.TAU * (T.phase(ts, 3.3) + k * 0.8));
      const ex = Math.min(R(w.x0 + edge), w.x1 - 4);
      for (let x = w.x0; x <= ex; x++) {
        const fold = (x - w.x0 + R(k * 2 * b)) % 3 === 1;
        g.em.px(x, y, x === ex ? LACE[1] : fold ? LACE[2] : LACE[3]);
      }
    }
    // upper sash: the same curtain behind the glass, gathered and steadier
    for (let y = w.y0; y <= 141; y++) {
      const ex = w.x0 + 2 + (y > 138 ? R(0.4 + 0.5 * b) : 0);
      for (let x = w.x0; x <= ex; x++) g.em.px(x, y, x === ex ? LACE[1] : (x - w.x0) % 3 === 1 ? LACE[2] : LACE[3]);
    }
  }

  /** the white porch swing hanging in the right-hand bay, swinging gently */
  function swing(g, t, A) {
    // it swings towards and away from us: seen from the front it only
    // rises a pixel at either end of its arc
    const ts = T.step(t, 10);
    const sw = T.wave(ts, 5.6) + 0.25 * (HD.summer ? HD.summer.breeze(ts) : 0);
    const bob = Math.abs(sw) > 0.72 ? -1 : 0;
    const { x0, x1, top } = SWING;
    const y0 = SWING.seat + bob;
    const hi = A.col('trim', 5);
    const md = A.col('trim', 4);
    const lo = A.col('trim', 2);
    const sh = A.col('trim', 1);
    // chains from the ceiling hooks to the arms
    g.vline(x0 + 2, top + 1, y0 - 6, lo);
    g.vline(x1 - 2, top + 1, y0 - 6, lo);
    // slatted back between a top rail and a bottom rail
    g.hline(x0 + 1, x1 - 1, y0 - 8, hi);
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      if ((x - x0) % 2 === 0) g.vline(x, y0 - 7, y0 - 3, x === x0 + 2 || x === x1 - 2 ? md : hi);
      else g.vline(x, y0 - 7, y0 - 3, sh);
    }
    g.hline(x0 + 1, x1 - 1, y0 - 2, md);
    // arms and the seat's front edge
    g.vline(x0, y0 - 5, y0, md);
    g.vline(x1, y0 - 5, y0, md);
    g.hline(x0, x0 + 2, y0 - 5, hi);
    g.hline(x1 - 2, x1, y0 - 5, hi);
    g.hline(x0, x1, y0, hi);
    g.hline(x0 + 1, x1 - 1, y0 - 1, lo);
  }

  HD.module('building-herndon', {
    init() {
      // warm the cache for the herndon entries and register the silhouette
      const eds = (HD.EDITIONS || []).filter((e) => e.place === 'herndon');
      let A = null;
      for (const ed of eds) A = cache[modeOf(ed)] || (cache[modeOf(ed)] = build(modeOf(ed)));
      if (!A) A = cache.night || (cache.night = build('night'));
      PLACE.skyline = A.sky;
      PLACE.surfaces = [
        [234, 93, 313, 95], // main ridge
        [161, 118, 241, 119], // pent at the foot of the gable
        [232, 150, 328, 152], // porch roof
        [167, 157, 236, 159], // bay roof
        [181, 155, 197, 155], // sills
        [205, 155, 221, 155],
        [249, 149, 265, 149],
        [276, 149, 292, 149],
        [232, 182, 327, 182], // balustrade rail
        [246, 197, 271, 197], // top step
        [279, 71, 289, 71], // chimney cap
      ];
      PLACE.drips = [
        { x: 236, y: 126 },
        { x: 262, y: 126 },
        { x: 290, y: 126 },
        { x: 312, y: 126 },
        { x: 163, y: 122 },
        { x: 239, y: 122 },
        { x: 234, y: 159 },
        { x: 252, y: 159 },
        { x: 281, y: 159 },
        { x: 309, y: 159 },
        { x: 328, y: 159 },
        { x: 168, y: 164 },
        { x: 202, y: 164 },
        { x: 235, y: 164 },
      ];
    },
    lights(t, L) {
      if (!here()) return;
      const A = art();
      const lt = HD.light();
      if (lt.mode === 'day') return;
      // porch lantern: a steady warm bulb lighting the porch, door and steps
      L.add({ x: LANTERN.x, y: LANTERN.y, r: 28, ry: 24, color: [1.0, 0.64, 0.32], i: 0.42, bands: 5, pow: 1.5, halo: { r: 6, a: 0.32 } });
      L.add({ x: LANTERN.x, y: LANTERN.y, r: 8, color: [1.0, 0.7, 0.4], i: 0.25, bands: 3 });
      if (!A.lit) return;
      const warm = HD.LIGHT.candle;
      const wide = { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
      const below = (y) => Object.assign({}, wide, { y0: y });
      // the bay window spills onto the hydrangeas and the lawn in front
      L.add({ x: 202, y: 196, r: 30, ry: 12, color: warm, i: 0.55, bands: 4, clip: below(192), halo: { x: 202, y: 181, r: 20, a: 0.07 } });
      L.add({ x: 202, y: 212, r: 46, ry: 12, color: warm, i: 0.62, bands: 4, pow: 1.3, clip: below(206) });
      L.add({ x: 259, y: 210, r: 22, ry: 9, color: warm, i: 0.4, bands: 4, clip: below(206) });
      L.add({ x: 176, y: 196, r: 13, ry: 8, color: warm, i: 0.3, clip: below(192) });
      L.add({ x: 228, y: 196, r: 13, ry: 8, color: warm, i: 0.3, clip: below(192) });
      // the door's glass onto the steps and the walk
      L.add({ x: 257, y: 203, r: 18, ry: 9, color: warm, i: 0.35, clip: below(196) });
      // upstairs windows onto the roofs below them
      L.add({ x: 213, y: 159, r: 9, ry: 4, color: warm, i: 0.45, clip: below(155) });
      L.add({ x: 189, y: 159, r: 9, ry: 4, color: warm, i: 0.4, clip: below(155) });
      L.add({ x: 257, y: 152, r: 10, ry: 4, color: warm, i: 0.4, clip: below(149) });
      L.add({ x: 284, y: 152, r: 10, ry: 4, color: warm, i: 0.3, clip: below(149) });
    },
    passes: [
      {
        layer: 'scene',
        z: 25,
        id: 'house',
        draw(g, t) {
          if (!here()) return;
          const A = art();
          const ed = HD.edition;
          g.sprite(A.house, A.x, A.y);
          if (A.lit) {
            g.em.sprite(A.emc, A.x, A.y);
            sheer(g, t);
          }
          // the series cat, should an entry ever seat him in this window
          const pl = HD.place();
          const cw = ed.cast && ed.cast.window;
          if (pl.mascot && (cw === 'alone' || cw === 'together')) {
            HD.mascot.draw(g, t, pl.mascot.x, pl.mascot.y);
            if (cw === 'together' && HD.drawPartner && pl.partner) HD.drawPartner(g, t, pl.partner.x, pl.partner.base);
          }
          swing(g, t, A);
          if (A.mode !== 'day') moth(g, t, A);
        },
      },
    ],
  });
})();
