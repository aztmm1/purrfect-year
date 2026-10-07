/*
 * decor-trips (Purrfect Year v2): decorations and props on the trips.
 *
 *   soho     a slatted bench on a cast-iron frame (place.bench), shopping
 *            bags beside it, a heart-shaped paper lantern hung from the
 *            hotel canopy over the couple, and pleated red-white-blue fans
 *            on the lofts' fire escapes and sills (tags shopping-bags,
 *            heart-lantern, bunting-usa)
 *   bhills   a wooden valet podium and a brass bell cart with luggage by the
 *            drive, low white planters of flowers along the lobby glass
 *            (valet-stand, planters)
 *   marina   sailboats and a motor yacht moored at the floating docks
 *            (y 258..262), rocking gently; the toy-brick castle on the
 *            promenade at place.castle (boats, brick-castle)
 *   herndon  the birthday table at place.table: a cloth, a pink cake and
 *            three candles that lean when dad blows (HD.summer.blowing), go
 *            out with smoke wisps (candlesOut) and are lit again; balloons
 *            tied to the outer porch posts and the table; party bunting
 *            along the porch (birthday-table, balloons, bunting-party)
 *
 * Scene layer z 35..44. Colours are written as albedos (how a thing looks in
 * plain daylight) and turned into scene paint by A() for the light mode: the
 * engine relights the scene, so the same art reads true by day, soft at dusk
 * and cold at night, and warms up inside the light pools. Static art is baked
 * once per edition; a frame blits it and draws only what moves.
 *
 * For the family module: HD.decorTrips.table() gives the birthday table's
 * geometry (top, cloth, cake, candles, a free spot for the gift) and
 * HD.decorTrips.drawTable(g, t) redraws the whole table (cloth, cake,
 * candles) so it can cover a back row of cats standing behind it.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const FX = HD.festive;
  const R = Math.round;
  const AMB = HD.AMBIENT;
  const bayer = HD.bayer;
  const mix = HD.color.mix;

  // ------------------------------------------------------------------
  // albedo -> scene paint for the current light mode. The engine relights
  // scene pixels as paint * (1 + light / AMBIENT). By day and at golden hour
  // the paint is scaled so the daylight fill gives the albedo back exactly;
  // at dusk and at night it is albedo x ambient with a small exposure lift,
  // graded like the buildings (soft dusk afterglow, cold night).
  // ------------------------------------------------------------------
  const EXPO = { night: [1.29, 1.24, 1.15], dusk: [1.28, 1.22, 1.03] };
  const FDAY = (HD.LIGHTING && HD.LIGHTING.day && HD.LIGHTING.day.fill) || [0.72, 0.66, 0.5];
  const KDAY = [AMB[0] / (AMB[0] + FDAY[0]), AMB[1] / (AMB[1] + FDAY[1]), AMB[2] / (AMB[2] + FDAY[2])];
  const paintCache = new Map();
  function curMode() {
    const lt = HD.light ? HD.light() : null;
    return (lt && lt.mode) || 'night';
  }
  /** scene paint of an albedo; gain > 1 lifts festive pieces a little in low light */
  function A(hex, gain) {
    const mode = curMode();
    const gn = gain === undefined ? 1 : gain;
    const key = mode + hex + gn;
    let v = paintCache.get(key);
    if (v === undefined) {
      const c = HD.color.hex(hex);
      const e = EXPO[mode];
      const k = e ? [AMB[0] * e[0], AMB[1] * e[1], AMB[2] * e[2]] : KDAY;
      v = HD.color.css(c[0] * k[0] * gn, c[1] * k[1] * gn, c[2] * k[2] * gn);
      paintCache.set(key, v);
    }
    return v;
  }
  const As = (arr, gain) => arr.map((h) => A(h, gain));
  /** the lift for festive pieces (balloons, bunting) at dusk and at night */
  const festive = () => (EXPO[curMode()] ? 1.22 : 1);

  // ------------------------------------------------------------------
  // init-time raster in screen coordinates, baked to a trimmed canvas
  // ------------------------------------------------------------------
  function Buf(x0, y0, w, h) {
    this.x0 = x0;
    this.y0 = y0;
    this.w = w;
    this.h = h;
    this.c = new Array(w * h).fill(null);
  }
  Buf.prototype.set = function (x, y, c) {
    x = R(x) - this.x0;
    y = R(y) - this.y0;
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y * this.w + x] = c;
  };
  Buf.prototype.get = function (x, y) {
    x = R(x) - this.x0;
    y = R(y) - this.y0;
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.c[y * this.w + x] : null;
  };
  Buf.prototype.hl = function (x0, x1, y, c) {
    for (let x = R(x0); x <= R(x1); x++) this.set(x, y, c);
  };
  Buf.prototype.vl = function (x, y0, y1, c) {
    for (let y = R(y0); y <= R(y1); y++) this.set(x, y, c);
  };
  /** a soft contact shadow row under a prop: a fine checker reads as a half-tone */
  Buf.prototype.contact = function (x0, x1, y, c, solid0, solid1) {
    for (let x = R(x0); x <= R(x1); x++) {
      if (this.get(x, y)) continue;
      if (((x + y) & 1) === 0 || (solid0 !== undefined && x >= solid0 && x <= solid1)) this.set(x, y, c);
    }
  };
  /** bake to a trimmed canvas: {cv, x, y} (screen position of its top-left) */
  Buf.prototype.bake = function () {
    let mx0 = this.w;
    let my0 = this.h;
    let mx1 = -1;
    let my1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.c[y * this.w + x]) {
          if (x < mx0) mx0 = x;
          if (y < my0) my0 = y;
          if (x > mx1) mx1 = x;
          if (y > my1) my1 = y;
        }
    if (mx1 < 0) return { cv: HD.bake(1, 1, () => {}), x: 0, y: 0 };
    const w = mx1 - mx0 + 1;
    const h = my1 - my0 + 1;
    const src = this.c;
    const W0 = this.w;
    const cv = HD.bake(w, h, (g, c) => {
      const ctx = c.getContext('2d');
      const im = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const col = src[(y + my0) * W0 + x + mx0];
          if (!col) continue;
          const v = HD.color.hex(col);
          const q = (y * w + x) * 4;
          im.data[q] = v[0];
          im.data[q + 1] = v[1];
          im.data[q + 2] = v[2];
          im.data[q + 3] = 255;
        }
      ctx.putImageData(im, 0, 0);
    });
    return { cv, x: this.x0 + mx0, y: this.y0 + my0 };
  };
  const blit = (g, a) => g.sprite(a.cv, a.x, a.y);

  // the 5-10 fps sprite cadences sit half a frame off the loop seam
  const Q = 0.05;
  const breeze = (t) => HD.summer.breeze(t);
  /** loop-safe index of a slow re-roll every ~period seconds */
  function epoch(t, period) {
    const n = T.cyclesFor(period);
    return Math.floor((HD.wrap(t) * n) / HD.LOOP) % n;
  }

  // ==================================================================
  // HERNDON: the birthday table, cake and candles; balloons; bunting
  // ==================================================================
  /** birthday-table geometry at the current place (null if it has none) */
  function tableGeo(pl) {
    const p = pl || HD.place();
    if (!p || !p.table) return null;
    const x = p.table.x;
    const base = p.table.base;
    const top = base - 9; // front edge of the table top
    return {
      x,
      base,
      top,
      x0: x - 15,
      x1: x + 15,
      cloth: { y0: top - 2, y1: top + 7 }, // top surface .. hem
      cake: { x0: x - 5, x1: x + 5, y0: top - 10, y1: top - 2, plate: [x - 7, x + 7] },
      // wick tops (each little flame stands on its wick)
      candles: [
        { x: x - 3, y: top - 14 },
        { x, y: top - 15 },
        { x: x + 3, y: top - 14 },
      ],
      gift: { x0: x + 8, x1: x + 11, y: top - 1 }, // a clear spot on the cloth right of the cake
    };
  }

  function bakeTable(G) {
    const { x, top, base, x0, x1 } = G;
    const B = new Buf(x0 - 4, top - 18, x1 - x0 + 9, base - top + 22);
    // cotton cloth: the dusk sun is low on the left, so the left side is the lit one
    const CL = {
      far: A('#d6d0cc'),
      mid: A('#ece6de'),
      edge: A('#fffbf4'),
      face: A('#e8e1d8'),
      faceL: A('#f6f0e8'),
      fold: A('#c6beb8'),
      low: A('#d2cac2'),
      right: A('#bcb4b0'),
    };
    const HEM = As(['#a83a6c', '#e46b9e', '#ff9ec4']);
    for (let xx = x0; xx <= x1; xx++) {
      if (xx > x0 && xx < x1) B.set(xx, top - 2, CL.far);
      B.set(xx, top - 1, CL.mid);
      B.set(xx, top, xx > x1 - 2 ? CL.mid : CL.edge);
      for (let y = top + 1; y <= top + 5; y++) {
        const k = (xx - x0) % 6;
        let c = y >= top + 4 ? CL.low : CL.face;
        if (k === 3 && y > top + 1) c = CL.fold; // a soft fold every 6 px
        else if (k === 2 && y > top + 1) c = CL.faceL; // its lit side
        if (xx === x0) c = CL.faceL;
        if (xx === x1) c = CL.right;
        B.set(xx, y, c);
      }
      // scalloped pink hem
      const s = (xx - x0) % 4;
      B.set(xx, top + 6, HEM[s === 0 ? 1 : 2]);
      if (s === 1 || s === 2) B.set(xx, top + 7, HEM[s === 1 ? 1 : 0]);
    }
    // legs below the hem and a soft contact shadow on the lawn
    const LEG = A('#5a3e2c');
    for (const lx of [x0 + 2, x1 - 2]) B.vl(lx, top + 7, base, LEG);
    const SH = A('#182418');
    B.contact(x0 + 1, x1 + 3, base + 1, SH, x0 + 3, x1 - 1);
    B.contact(x0 + 3, x1 - 3, base, SH);

    // the cake on its plate
    const PK = As(['#a8406e', '#d8689a', '#f494bc', '#ffbcd8']);
    const CR = As(['#d8ccd0', '#f6eef0', '#fffaf8']);
    const PL = As(['#c4c4d0', '#f2f2f6', '#ffffff']);
    for (let dx = -7; dx <= 7; dx++) B.set(x + dx, top - 1, dx < -4 ? PL[2] : PL[1]);
    for (let dx = -6; dx <= 6; dx++) B.set(x + dx, top, PL[0]);
    const cy = top - 2; // the cake's bottom row
    for (let dx = -5; dx <= 5; dx++) {
      const side = dx === -5 ? 3 : dx === 5 ? 0 : dx >= 3 ? 1 : 2;
      B.set(x + dx, cy, PK[dx >= 2 ? 0 : 1]);
      B.set(x + dx, cy - 1, PK[side]);
      B.set(x + dx, cy - 2, PK[side]);
      B.set(x + dx, cy - 3, dx >= 4 ? CR[0] : CR[1]); // cream filling
      B.set(x + dx, cy - 4, PK[side]);
      B.set(x + dx, cy - 5, PK[side]);
      B.set(x + dx, cy - 6, PK[side]);
      B.set(x + dx, cy - 7, dx >= 4 ? CR[1] : CR[2]); // frosting rim
    }
    for (let dx = -4; dx <= 4; dx++) B.set(x + dx, cy - 8, dx >= 3 ? CR[1] : CR[2]); // frosting top
    // frosting drips over the rim
    for (const [dx, d] of [[-5, 1], [-3, 2], [-1, 1], [1, 2], [4, 1]]) for (let k = 1; k <= d; k++) B.set(x + dx, cy - 7 + k, dx >= 4 ? CR[0] : CR[1]);
    // berries on the rim
    const BER = A('#d0283a');
    B.set(x - 4, cy - 8, BER);
    B.set(x + 4, cy - 8, BER);
    B.set(x - 1, cy - 7, BER);
    B.set(x + 2, cy - 7, BER);
    // candles: striped wax, dark wick on top (flames are drawn per frame)
    const CW = A('#fff8f0');
    const CC = As(['#7ec4ff', '#ffd24a', '#ff8cc0']);
    G.candles.forEach((c, i) => {
      B.set(c.x, c.y + 1, CC[i]);
      B.set(c.x, c.y + 2, CW);
      B.set(c.x, c.y + 3, CC[i]);
      if (c.y + 4 < cy - 8) B.set(c.x, c.y + 4, CW);
      B.set(c.x, c.y, A('#2a2026'));
    });
    // a stack of small plates and a pink cup on the left
    for (let xx = x0 + 1; xx <= x0 + 5; xx++) {
      B.set(xx, top - 1, PL[0]);
      B.set(xx, top - 2, xx === x0 + 1 || xx === x0 + 5 ? A('#f07aa8') : PL[1]);
      if (xx > x0 + 1 && xx < x0 + 5) B.set(xx, top - 3, PL[2]);
    }
    const CUP = As(['#c44a82', '#ff86b8']);
    B.set(x0 + 7, top - 1, CUP[0]);
    B.set(x0 + 7, top - 2, CUP[1]);
    B.set(x0 + 8, top - 1, CUP[0]);
    B.set(x0 + 8, top - 2, CUP[0]);
    // a glass jug of lemonade on the right (the gift spot x+8..x+11 stays clear)
    const LM = As(['#c89a28', '#f0cc48', '#fff0a0']);
    const GL = As(['#c8d8e0', '#f4fbff']);
    const jx = x1 - 3;
    B.set(jx, top - 6, GL[0]);
    B.set(jx + 1, top - 6, GL[1]);
    B.set(jx + 2, top - 6, GL[0]);
    B.set(jx - 1, top - 6, GL[0]); // spout
    for (let y = top - 5; y <= top - 1; y++) {
      B.set(jx, y, LM[2]);
      B.set(jx + 1, y, y === top - 5 ? LM[2] : LM[1]);
      B.set(jx + 2, y, LM[0]);
    }
    B.set(jx + 3, top - 4, GL[0]); // handle
    B.set(jx + 4, top - 3, GL[0]);
    B.set(jx + 3, top - 2, GL[0]);
    return B.bake();
  }

  // the candles are out through HD.summer.candlesOut (100..112 s of the loop);
  // after the cheer they are lit again one by one, left to right: a match
  // flares at each wick for a moment, then the flame catches
  const OUT0 = 100;
  const RELIGHT = 112;
  const RELIGHT_STEP = 0.8;
  const MATCH = 0.45;
  /** per-candle state: lit, leaning (dad is blowing), or out with a smoke wisp */
  function candleState(t, i) {
    const s = HD.summer.sec(t);
    const out = HD.summer.candlesOut(t);
    if (out >= 0) return { lit: false, smoke: s - OUT0 };
    const at = RELIGHT + RELIGHT_STEP * i;
    if (s >= RELIGHT && s < at + MATCH) return { lit: false, smoke: 99, match: s >= at };
    return { lit: true, blow: HD.summer.blowing(t) };
  }
  function drawCandles(g, t, G) {
    const e = g.em;
    G.candles.forEach((c, i) => {
      const st = candleState(t, i);
      if (!st.lit) {
        g.px(c.x, c.y, P.night[0]);
        if (st.match) {
          // the match: a little stick held in from the right with a bright head
          const f = T.flicker(T.step(t + Q, 12), 90 + i, 2);
          g.px(c.x + 2, c.y - 1, A('#d8b07a'));
          g.px(c.x + 3, c.y, A('#d8b07a'));
          e.px(c.x + 1, c.y - 1, P.fire[f > 0.5 ? 10 : 9]);
          e.px(c.x + 1, c.y - 2, P.fire[f > 0.4 ? 8 : 7]);
          if (f > 0.55) e.px(c.x + 1, c.y - 3, P.fire[6]);
        }
        // a thin grey wisp curls up from the wick, then lets go and thins out
        const age = st.smoke;
        if (age < 4.2) {
          const ts = T.step(t + Q, 8);
          const top = Math.min(10, 1 + age * 6);
          const lo = Math.max(0, (age - 1.4) * 3.4);
          for (let h = Math.ceil(lo); h <= top; h++) {
            const y = c.y - 1 - h;
            const x = c.x + R(Math.sin(h * 0.62 + ts * 2.6 + i * 1.9) * Math.min(1.5, h * 0.28));
            if (h > 4 && bayer(x, y) > 0.95 - age * 0.16 - (h - 4) * 0.06) continue;
            g.px(x, y, A(h < 3 ? '#f2f2f8' : h < 6 ? '#cfd0dc' : '#a4a6b8'));
          }
        }
        return;
      }
      if (st.blow >= 0) {
        // dad blows from the right: the flames lean away, shrink and gutter
        const b = st.blow;
        const lean = b > 0.2 ? -1 : 0;
        e.px(c.x, c.y - 1, P.fire[b > 0.6 ? 6 : 8]);
        if (b < 0.7 || (i + R(b * 12)) % 2) e.px(c.x + lean, c.y - 2, P.fire[b > 0.5 ? 5 : 7]);
        if (b < 0.35) e.px(c.x + lean - (b > 0.15 ? 1 : 0), c.y - 3, P.fire[5]);
        return;
      }
      FX.flame(g, c.x, c.y, t + Q, 50 + i, 1);
    });
  }
  function candleLights(t, L, G) {
    let n = 0;
    let fl = 0;
    G.candles.forEach((c, i) => {
      const st = candleState(t, i);
      if (!st.lit) return;
      n += st.blow >= 0 ? 0.55 - 0.4 * st.blow : 1;
      fl += T.flicker(T.step(t + Q, 10), 50 + i, 1.4);
    });
    if (n <= 0) return;
    const f = fl / 3;
    // a warm pool on the cake, the cloth and the faces round the table
    L.add({ x: G.x, y: G.top - 9, r: 32, ry: 22, color: HD.LIGHT.candle, i: (0.22 + 0.15 * n) * (0.8 + 0.3 * f), bands: 5, halo: { x: G.x, y: G.top - 16, r: 8, a: 0.06 + 0.025 * n } });
  }
  function drawTable(g, t) {
    const G = tableGeo();
    if (!G) return;
    const art = herndonArt && herndonArt();
    if (!art || !art.table) return;
    blit(g, art.table);
    drawCandles(g, t, G);
  }

  // ---- balloons -----------------------------------------------------
  const BAL_COLS = {
    red: ['#a01c2e', '#ec3c4a', '#ffa49a'],
    gold: ['#b87a10', '#f8c230', '#fff2b0'],
    blue: ['#1e4caa', '#428ef6', '#b8dcff'],
    pink: ['#ae3a78', '#ff7ab6', '#ffd6ea'],
    mint: ['#1c8a58', '#4ad08e', '#c8f8e0'],
    purple: ['#5a30a0', '#9e68ea', '#e0ccff'],
  };
  // highlight on the upper left (the dusk sun is low on the left); 'k' is the knot
  const BAL_ROWS = ['.bbbb.', 'bcbbba', 'bbbbba', 'bbbbba', '.bbbaa', '..ba..', '..k...'];
  const BAL_KNOT = [2, 6];
  function balloonSprites(flip) {
    const out = {};
    for (const cn in BAL_COLS) {
      const C = As(BAL_COLS[cn], festive());
      const rows = flip ? BAL_ROWS.map((r) => r.split('').reverse().join('')) : BAL_ROWS;
      out[cn] = HD.sprite(rows, { a: C[0], b: C[1], c: C[2], k: C[0] });
    }
    return out;
  }
  // bunches: knot on the post / table corner, balloons as offsets of their knots
  function porchBunches(pl) {
    const po = pl.porch;
    if (!po) return [];
    const L0 = po.posts[0];
    const L1 = po.posts[po.posts.length - 1];
    const ty = po.floor - 24; // tied a little above the balustrade
    return [
      { x: L0 - 2, y: ty, side: -1, list: [[-7, -29, 'red'], [-1, -37, 'gold'], [5, -27, 'blue']] },
      { x: L1 + 2, y: ty, side: 1, list: [[-6, -28, 'pink'], [1, -36, 'mint'], [7, -27, 'purple']] },
    ];
  }
  // the party's own bunch is tied beside the table, to the garden gate post
  // just left of it, so its strings never cross the faces round the table
  function gateBunch(pl, G) {
    const f = pl.ground && pl.ground.fence;
    const gx = f && f.gates ? f.gates[0] + 1 : G.x0 - 16;
    const gy = f ? f.base - 12 : G.base - 7;
    return { x: gx, y: gy, side: 1, list: [[-11, -22, 'gold'], [-5, -28, 'pink'], [0, -21, 'blue']] };
  }
  function drawBalloons(g, t, art, list) {
    const STR = art.string;
    const ts = T.step(t + Q, 8);
    const br = breeze(ts);
    for (let bi = 0; bi < list.length; bi++) {
      const bn = list[bi];
      // the knot round the post
      g.px(bn.x, bn.y, STR);
      g.px(bn.x - bn.side, bn.y, STR);
      for (let i = 0; i < bn.list.length; i++) {
        const [dx, dy, cn] = bn.list[i];
        const sway = br * 1.4 * (-dy / 30) + 0.9 * T.wave(ts, 5.3 + i * 0.9, bi * 0.31 + i * 0.17);
        const bob = T.wave(ts, 4.1 + i * 0.7, i * 0.23 + bi * 0.4) > 0.5 ? -1 : 0;
        const kx = R(bn.x + dx + sway);
        const ky = bn.y + dy + bob;
        // string: from the knot up to the balloon's knot with a soft kink
        const mx = R((bn.x + kx) / 2 + sway * 0.35 + (i - 1) * 0.5);
        const my = R((bn.y + ky) / 2);
        g.line(bn.x, bn.y - 1, mx, my, STR);
        g.line(mx, my, kx, ky + 1, STR);
        g.sprite(art.bal[cn], kx - BAL_KNOT[0], ky - BAL_KNOT[1]);
      }
    }
  }

  // ---- party bunting along the porch -----------------------------------
  const FLAG_COLS = [
    ['#c8303c', '#ff6a66'],
    ['#e8a818', '#ffd860'],
    ['#2a6ad0', '#6ca8ff'],
    ['#2aa468', '#70e0a0'],
    ['#e45c9c', '#ffa0cc'],
    ['#ece8e0', '#ffffff'],
  ];
  function buntingPath(pl) {
    const po = pl.porch;
    const y = po.roof + 15; // under the spindle frieze, at the brackets
    const pts = [];
    for (let i = 0; i + 1 < po.posts.length; i++) {
      const a = po.posts[i] + 2;
      const b = po.posts[i + 1] - 2;
      const sag = Math.min(4, (b - a) / 7);
      for (let x = a; x <= b; x++) {
        const u = (x - a) / (b - a);
        pts.push([x, R(y + 4 * sag * u * (1 - u))]);
      }
    }
    return pts;
  }
  function bakeBunting(pl) {
    const pts = buntingPath(pl);
    const B = new Buf(0, pl.porch.roof, 480, 34);
    const ROPE = A('#5a4a48');
    const gn = festive();
    const flags = [];
    let k = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      B.set(x, y, ROPE);
      // a pennant every 5 px, clear of the posts
      const near = pl.porch.posts.some((p) => Math.abs(p - x) < 4);
      if (!near && x % 5 === 0) flags.push({ x, y: y + 1, c: k++ % FLAG_COLS.length });
    }
    for (const f of flags) {
      const C = As(FLAG_COLS[f.c], gn);
      B.hl(f.x - 1, f.x + 1, f.y, C[1]);
      B.set(f.x - 1, f.y + 1, C[1]);
      B.set(f.x, f.y + 1, C[0]);
      B.set(f.x + 1, f.y + 1, C[0]);
    }
    return { art: B.bake(), flags, tips: FLAG_COLS.map((c) => A(c[0], gn)) };
  }
  /** the pennant tips flutter in the breeze (one px, 6 fps) */
  function drawBuntingTips(g, t, bun) {
    const ts = T.step(t + Q, 6);
    const br = breeze(ts);
    for (let i = 0; i < bun.flags.length; i++) {
      const f = bun.flags[i];
      const n = T.noise(ts, 1.3, 600 + i);
      const off = n + br * 0.25 > 0.72 ? 1 : n + br * 0.25 < 0.18 ? -1 : 0;
      g.px(f.x + off, f.y + 2, bun.tips[f.c]);
    }
  }

  let herndonArt = null;
  function buildHerndon(ed) {
    const pl = HD.PLACES[ed.place];
    if (!pl || pl.id !== 'herndon') return null;
    const G = tableGeo(pl);
    const lt = HD.LIGHTING[ed.light] || HD.LIGHTING.night;
    const sunLeft = !lt.sun || lt.sun.x < 240;
    return {
      table: G ? bakeTable(G) : null,
      bal: balloonSprites(!sunLeft),
      string: A('#ece8e0', festive()),
      bunting: pl.porch ? bakeBunting(pl) : null,
      porch: porchBunches(pl),
      partyBunch: G ? gateBunch(pl, G) : null,
    };
  }

  function herndonBack(g, t) {
    const art = herndonArt();
    if (!art) return;
    if (HD.tag('bunting-party') && art.bunting) {
      blit(g, art.bunting.art);
      drawBuntingTips(g, t, art.bunting);
    }
    if (HD.tag('balloons')) drawBalloons(g, t, art, art.porch);
  }
  function herndonMid(g, t) {
    const art = herndonArt();
    if (!art) return;
    if (HD.tag('balloons') && art.partyBunch && HD.tag('birthday-table')) drawBalloons(g, t, art, [art.partyBunch]);
    if (HD.tag('birthday-table')) drawTable(g, t);
  }
  function herndonLights(t, L) {
    if (!HD.tag('birthday-table')) return;
    const G = tableGeo();
    if (G) candleLights(t, L, G);
  }

  // ==================================================================
  // MARINA: moored boats rocking at the docks; the toy-brick castle
  // ==================================================================
  const DOCK_Y = 258; // the floating docks (street draws them) run y 258..262
  const HULL = ['#f8fafc', '#e6ebf0', '#c8d0da', '#a4aebc'];
  const BOATS = [
    { kind: 'sail', x: 40, wl: 252, len: 44, mast: 84, dir: 1, cover: '#1e3a70', stripe: '#1e3a70', seed: 1 },
    { kind: 'sail', x: 101, wl: 253, len: 36, mast: 68, dir: -1, cover: '#1c6e7c', stripe: '#1c6e7c', seed: 2 },
    { kind: 'yacht', x: 389, wl: 253, len: 62, dir: -1, seed: 3 },
    { kind: 'sail', x: 452, wl: 252, len: 40, mast: 78, dir: -1, cover: '#1e3a70', stripe: '#a82c36', seed: 4 },
  ];

  /**
   * Sailboat (bow to the right), origin = waterline centre. A white hull
   * with a sheer that rises to the bow, a raked stem, a boot stripe and a
   * thin cove line, a low coachroof with windows, a spray hood, rails, and
   * the furled main on its boom under a canvas cover.
   */
  function bakeSailboat(b) {
    const L = b.len;
    const hx0 = -(L >> 1);
    const hx1 = hx0 + L - 1;
    const B = new Buf(hx0 - 4, -18, L + 10, 20);
    const W = As(HULL);
    const ST = A(b.stripe);
    const COV = As([mix(b.cover, '#000000', 0.4), b.cover, mix(b.cover, '#ffffff', 0.28)]);
    const RAIL = A('#b4bcc6');
    const TEAK = As(['#8a6440', '#c09468']);
    const WIN = A('#24303c');
    // hull rows from the waterline (r = 0) up to the deck; the bow end rises a row
    const rows = [
      [hx0 + 4, hx1 - 6, ST], // boot stripe at the waterline
      [hx0 + 2, hx1 - 4, W[2]],
      [hx0 + 1, hx1 - 2, W[1]],
      [hx0 + 1, hx1 - 1, W[0]],
      [hx0, hx1, W[0]],
    ];
    rows.forEach(([a, z, c], r) => B.hl(a, z, -r, c));
    B.hl(hx0 + 2, hx1 - 3, -3, A(b.stripe)); // the thin cove line
    B.set(hx0 + 1, -3, W[1]);
    // the deck edge (teak toe rail); the bow sheer lifts over the last 7 px
    B.hl(hx0, hx1 - 7, -5, TEAK[1]);
    B.hl(hx1 - 7, hx1 + 1, -5, W[0]);
    B.set(hx1 + 1, -4, W[1]);
    B.hl(hx1 - 6, hx1 + 2, -6, TEAK[1]);
    B.set(hx0, -4, W[1]); // transom edge in shade
    B.set(hx0, -5, TEAK[0]);
    // a pair of long hull ports under the cabin
    const mx = R(L * 0.06);
    B.hl(mx - 5, mx - 4, -2, WIN);
    B.hl(mx + 1, mx + 2, -2, WIN);
    // coachroof: side with windows, a roof one row up
    const cx0 = R(-L * 0.2);
    const cx1 = R(L * 0.18);
    B.hl(cx0, cx1, -6, W[0]);
    for (let x = cx0 + 2; x <= cx1 - 3; x++) if ((x - cx0) % 4 !== 1) B.set(x, -6, WIN);
    B.hl(cx0 + 1, cx1 - 2, -7, W[1]);
    B.set(cx1 - 1, -7, W[2]);
    // spray hood over the companionway, in the cover canvas
    B.hl(cx0 - 4, cx0 - 1, -6, COV[0]);
    B.hl(cx0 - 4, cx0, -7, COV[1]);
    B.hl(cx0 - 3, cx0, -8, COV[2]);
    B.set(cx0 - 2, -7, A('#7890a8')); // its little window
    // stern and bow rails
    B.vl(hx0 + 1, -7, -6, RAIL);
    B.hl(hx0 + 1, hx0 + 5, -8, RAIL);
    B.vl(hx0 + 5, -7, -6, RAIL);
    B.vl(hx1, -8, -7, RAIL);
    B.hl(hx1 - 4, hx1, -9, RAIL);
    // boom with the furled main under its cover: deep at the mast, tapering aft
    const bx0 = hx0 + 3;
    const BOOM = A('#9aa2ac');
    B.hl(bx0 - 2, mx - 1, -10, BOOM); // the boom itself
    for (let x = bx0; x <= mx - 1; x++) {
      const u = (x - bx0) / Math.max(1, mx - 1 - bx0);
      const th = u > 0.78 ? 4 : u > 0.4 ? 3 : 2;
      for (let k = 0; k < th; k++) B.set(x, -11 - k, k === th - 1 ? COV[2] : k === 0 ? COV[0] : COV[1]);
    }
    // the cover's zip seam and the sail's head stacked at the mast
    for (let x = bx0 + 2; x < mx - 1; x += 3) B.set(x, -12, COV[0]);
    B.vl(mx - 1, -16, -15, COV[1]);
    // fenders hanging over the side towards the dock
    const FEN = As(['#22407a', '#3c66b4']);
    for (const fx of [hx0 + 7, R(L * 0.28)]) {
      B.set(fx, -4, FEN[1]);
      B.set(fx, -3, FEN[1]);
      B.set(fx, -2, FEN[0]);
    }
    return { art: B.bake(), mx, hx0, hx1 };
  }

  /** motor yacht (bow to the right); origin = waterline centre */
  function bakeYacht(b) {
    const L = b.len;
    const hx0 = -(L >> 1);
    const hx1 = hx0 + L - 1;
    const B = new Buf(hx0 - 4, -24, L + 10, 26);
    const W = As(HULL);
    const NAVY = A('#14243e');
    const GLASS = As(['#1a2430', '#2c3c50', '#5c7a96']);
    const RAIL = A('#b4bcc6');
    const TEAK = As(['#8a6038', '#b88a5a']);
    // hull: sheer rising to a raked bow
    for (let r = 0; r <= 6; r++) {
      const y = -r;
      const xa = hx0 + (r === 0 ? 4 : r === 1 ? 2 : 1);
      const xb = hx1 - (r <= 1 ? 7 - r * 2 : r <= 3 ? 4 - r : 0) + (r >= 5 ? 1 : 0);
      for (let x = xa; x <= xb; x++) B.set(x, y, r === 0 ? NAVY : r === 1 ? W[2] : r <= 3 ? W[1] : W[0]);
    }
    B.hl(hx1 - 6, hx1 + 2, -7, W[0]); // the bow rises
    B.set(hx1 + 2, -6, W[1]);
    B.hl(hx0 + 1, hx1 + 1, -6, RAIL); // rub rail
    // long dark hull windows
    B.hl(hx0 + 14, hx0 + 20, -3, GLASS[0]);
    B.hl(hx0 + 23, hx0 + 29, -3, GLASS[0]);
    B.hl(hx0 + 32, hx0 + 36, -3, GLASS[0]);
    // swim platform at the stern
    B.hl(hx0 - 3, hx0, -1, TEAK[1]);
    B.hl(hx0 - 3, hx0, 0, TEAK[0]);
    // main deck saloon: white with a long raked band of tinted glass
    const s0 = hx0 + 9;
    const s1 = hx1 - 16;
    for (let y = -11; y <= -7; y++) {
      const rake = -7 - y; // the front slopes back
      for (let x = s0; x <= s1 - rake; x++) B.set(x, y, y === -11 ? W[1] : W[0]);
    }
    for (let x = s0 + 2; x <= s1 - 3; x++) {
      B.set(x, -9, GLASS[x > s1 - 8 ? 2 : 1]);
      B.set(x, -8, GLASS[0]);
    }
    for (let x = s0 + 6; x <= s1 - 6; x += 8) B.vl(x, -9, -8, W[1]); // mullions
    // foredeck rail
    for (let x = s1 + 2; x <= hx1 - 1; x += 3) B.set(x, -8, RAIL);
    B.hl(s1 + 1, hx1, -9, RAIL);
    // flybridge with a hardtop on slim posts
    const f0 = s0 + 3;
    const f1 = s0 + 22;
    B.hl(f0, f1, -12, W[0]);
    B.hl(f0, f1 - 1, -13, W[1]);
    B.set(f1 - 2, -14, GLASS[1]); // windscreen
    B.set(f1 - 3, -14, GLASS[0]);
    B.vl(f0 + 2, -16, -14, RAIL);
    B.vl(f1 - 4, -16, -14, RAIL);
    B.hl(f0, f1 - 3, -17, W[0]);
    B.hl(f0 + 1, f1 - 4, -16, W[2]);
    // a radar arch with a small dome on top
    B.vl(f0 + 4, -20, -18, W[1]);
    B.vl(f0 + 9, -20, -18, W[2]);
    B.hl(f0 + 4, f0 + 9, -21, W[0]);
    B.hl(f0 + 6, f0 + 7, -22, W[0]);
    // fenders
    const FEN = As(['#22407a', '#3c66b4']);
    for (const fx of [hx0 + 8, hx0 + 30]) {
      B.set(fx, -4, FEN[1]);
      B.set(fx, -3, FEN[0]);
    }
    return { art: B.bake(), hx0, hx1 };
  }

  /** a moored boat's motion at time t: bob (0/-1 px) and mast lean (-1..1 px at the head) */
  function boatMotion(b, t) {
    const ts = T.step(t + Q, 6);
    const bob = T.wave(ts, b.kind === 'yacht' ? 7.1 : 4.7 + b.seed * 0.6, b.seed * 0.21) > 0.45 ? -1 : 0;
    const roll = T.wave(ts, 6.3 + b.seed * 0.8, b.seed * 0.37) + 0.35 * T.wave(ts, 2.9 + b.seed * 0.3, b.seed * 0.11);
    const lean = roll > 0.75 ? 1 : roll < -0.75 ? -1 : 0;
    return { bob, lean, ts };
  }

  /** broken streaks of reflection under a hull; they re-roll slowly and drift by a px */
  function drawReflection(g, t, x0, x1, wl, seed, C) {
    const ep = epoch(t, 1.6);
    const tr = T.step(t + Q, 2);
    for (let r = 1; r <= 5; r++) {
      const y = wl + r;
      if (y >= DOCK_Y) break;
      const off = R(0.9 * T.wave(tr, 5.3, seed * 0.13 + r * 0.29));
      const inset = r;
      const dens = r === 1 ? 0.95 : r === 2 ? 0.75 : r === 3 ? 0.55 : 0.35;
      for (let cx = x0 + inset; cx <= x1 - inset; cx += 4) {
        if (HD.hash(seed, r, cx >> 2, ep) >= dens) continue;
        const len = r === 1 ? 4 : 2 + ((HD.hash(seed, cx, r, ep + 7) * 3) | 0);
        const c = r === 1 ? C.dark : r === 2 ? C.mid : C.light;
        g.hline(cx + off, Math.min(x1 - inset, cx + off + len - 1), y, c);
      }
    }
  }

  function drawBoat(g, t, k, C) {
    const b = k.b;
    const { bob, lean, ts } = boatMotion(b, t);
    const flip = b.dir < 0;
    const wl = b.wl + bob;
    // local hull x -> screen x
    const sx = (lx) => b.x + (flip ? -lx : lx);
    const xa = Math.min(sx(k.hx0), sx(k.hx1));
    const xb = Math.max(sx(k.hx0), sx(k.hx1));
    drawReflection(g, t, xa + 1, xb - 1, b.wl, b.seed, C);
    // mooring lines from the bow and stern cleats down to the dock
    g.line(sx(k.hx1 - 2), wl - 5, sx(k.hx1 + 4), DOCK_Y, C.rope);
    g.line(sx(k.hx0 + 1), wl - 5, sx(k.hx0 - 4), DOCK_Y, C.rope);
    // hull sprite (baked bow-right, mirrored for boats facing left)
    if (flip) g.sprite(k.art.cv, b.x - (k.art.x + k.art.cv.width - 1), k.art.y + wl, true);
    else g.sprite(k.art.cv, k.art.x + b.x, k.art.y + wl);
    if (b.kind !== 'sail') return;
    // the rig leans as one with the roll: x shift grows with height above the deck
    const mx = sx(k.mx);
    const deck = wl - 7;
    const top = wl - b.mast;
    const H = deck - top;
    const at = (y) => mx + R((lean * (deck - y)) / H);
    const hx = at(top);
    const bowX = sx(k.hx1 + 1);
    const sternX = sx(k.hx0 + 1);
    // backstay (a fine, broken wire) and forestay
    const bs = Math.max(1, Math.abs(sternX - hx), wl - 8 - top);
    for (let s = 1; s < bs; s++) {
      const x = R(hx + ((sternX - hx) * s) / bs);
      const y = R(top + 1 + ((wl - 8 - top - 1) * s) / bs);
      if (((x + y) & 1) === 0 || s % 3 === 0) g.px(x, y, C.wire);
    }
    g.line(hx, top + 1, bowX, wl - 7, C.wire);
    // furled headsail wrapped round the lower forestay (a second, canvas-coloured line)
    const fy0 = R(top + H * 0.4);
    for (let y = fy0; y <= wl - 8; y++) {
      const u = (y - top - 1) / (wl - 7 - top - 1);
      const x = R(hx + (bowX - hx) * u);
      g.px(x - b.dir, y, k.cov);
    }
    // mast: a pale aluminium spar, spreaders a little above half height
    for (let y = top; y <= deck; y++) g.px(at(y), y, C.mast);
    const spy = R(top + H * 0.42);
    g.hline(at(spy) - 2, at(spy) + 2, spy, C.mastD);
    // masthead: a little red burgee that flicks in the breeze
    const fl = T.noise(ts, 1.1, 700 + b.seed) + 0.3 * breeze(ts) > 0.6 ? 1 : 0;
    const bd = flip ? 1 : -1; // streams aft
    g.px(hx + bd, top - 1, C.burgee);
    g.px(hx + bd * 2, top - 1 + fl, C.burgee);
    g.px(hx, top - 1, C.mastD);
  }

  // ---- toy-brick castle ----------------------------------------------
  const BRICK = {
    r: ['#8a1a1e', '#cc3428', '#ee5c46', '#ff8c70'],
    b: ['#103a86', '#2464cc', '#4a8cf0', '#80b4ff'],
    y: ['#9c7008', '#eab218', '#ffd448', '#fff08c'],
    g: ['#165e22', '#2a9036', '#48b852', '#7ade7e'],
    w: ['#a8aeb8', '#dce2e8', '#f6f8fa', '#ffffff'],
  };
  function brickFill(B, x0, y0, x1, y1, col) {
    const C = As(BRICK[col]);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const ry = (y - y0) % 3;
        const row = Math.floor((y - y0) / 3);
        const seam = (x - x0 + (row % 2) * 2) % 4 === 3 && ry !== 2;
        let c = ry === 2 ? C[0] : ry === 0 ? C[2] : C[1];
        if (seam) c = C[0];
        if (x === x0 && ry !== 2) c = C[0];
        if (x === x1 && ry !== 2) c = C[3];
        B.set(x, y, c);
      }
  }
  function studs(B, x0, x1, y, col) {
    const C = As(BRICK[col]);
    for (let x = x0; x <= x1; x += 2) if (!B.get(x, y)) B.set(x, y, x >= x1 - 1 ? C[3] : C[2]);
  }
  function castleGeo(pl) {
    const c = pl.castle;
    return { x: c.x, base: c.base, ox: c.x - 15 };
  }
  function bakeCastle(pl) {
    const { base, ox } = castleGeo(pl);
    const B = new Buf(ox - 6, base - 40, 46, 44);
    const Y = (k) => base - k;
    // baseplate
    brickFill(B, ox - 3, Y(1), ox + 32, Y(0), 'g');
    // left tower (blue) with yellow battlements
    brickFill(B, ox, Y(23), ox + 8, Y(2), 'b');
    for (const k of [0, 3, 6]) brickFill(B, ox + k, Y(26), ox + k + 2 - (k === 6 ? 0 : 1), Y(24), 'y');
    for (const k of [0, 3, 6]) studs(B, ox + k, ox + k + 1, Y(27), 'y');
    // right tower (blue) with a stepped red roof
    brickFill(B, ox + 21, Y(18), ox + 29, Y(2), 'b');
    for (let k = 0; k < 4; k++) brickFill(B, ox + 21 + k, Y(21 + k * 2), ox + 29 - k, Y(19 + k * 2), 'r');
    studs(B, ox + 24, ox + 26, Y(28), 'r');
    for (let k = 0; k < 3; k++) {
      studs(B, ox + 21 + k, ox + 21 + k, Y(21 + k * 2 + 1), 'r');
      studs(B, ox + 29 - k, ox + 29 - k, Y(21 + k * 2 + 1), 'r');
    }
    // curtain wall (red), battlements alternate red / yellow
    brickFill(B, ox + 9, Y(13), ox + 20, Y(2), 'r');
    [9, 12, 15, 18].forEach((k, i) => {
      brickFill(B, ox + k, Y(16), ox + k + 1, Y(14), i % 2 ? 'y' : 'r');
      studs(B, ox + k, ox + k + 1, Y(17), i % 2 ? 'y' : 'r');
    });
    // the gate: an arched opening, a portcullis line and a lowered drawbridge
    const DK = As(['#141620', '#232634', '#343a4c']);
    for (let y = Y(9); y <= Y(2); y++)
      for (let x = ox + 12; x <= ox + 17; x++) {
        if (y === Y(9) && (x === ox + 12 || x === ox + 17)) continue;
        B.set(x, y, x === ox + 12 || y === Y(9) ? DK[0] : DK[1]);
      }
    for (let x = ox + 13; x <= ox + 16; x += 2) B.set(x, Y(8), DK[2]);
    const YB = As(BRICK.y);
    for (let x = ox + 11; x <= ox + 18; x++) {
      B.set(x, Y(1), x === ox + 18 ? YB[3] : YB[2]);
      B.set(x, Y(0), YB[0]);
    }
    // arrow slits and a round window over the gate
    for (const [wx, wy] of [[ox + 4, 17], [ox + 4, 9], [ox + 25, 12]]) {
      B.set(wx, Y(wy), DK[0]);
      B.set(wx, Y(wy - 1), DK[1]);
    }
    const WH = As(BRICK.w);
    B.set(ox + 14, Y(11), WH[2]);
    B.set(ox + 15, Y(11), WH[3]);
    // studs along the baseplate
    studs(B, ox - 3, ox + 32, Y(2), 'g');
    // flag pole on the left tower (the flag itself waves per frame)
    B.vl(ox + 4, Y(34), Y(27), WH[1]);
    B.set(ox + 4, Y(35), YB[2]);
    return B.bake();
  }
  function drawCastleFlag(g, t, pl, cols) {
    const { base, ox } = castleGeo(pl);
    const fx = ox + 5;
    const fy = base - 34;
    const ts = T.step(t + Q, 5);
    const w = T.noise(ts, 1.7, 77) + 0.3 * breeze(ts);
    const long = w > 0.55;
    g.hline(fx, fx + (long ? 5 : 4), fy, cols[1]);
    g.hline(fx, fx + (long ? 4 : 5), fy + 1, cols[2]);
    g.hline(fx, fx + (long ? 2 : 3), fy + 2, cols[1]);
    g.px(fx + (long ? 5 : 4), fy + 1, cols[0]);
  }
  function castleShade(pl, L) {
    const { base, ox } = castleGeo(pl);
    const sun = HD.light().sun;
    if (!sun) return;
    const dir = sun.x > ox + 15 ? -1 : 1;
    const a = ox - 3;
    const b = ox + 32;
    L.shade({ poly: [[a, base + 1], [b, base + 1], [b + dir * 8, base + 4], [a + dir * 8, base + 4]], k: 0.4 });
  }

  let marinaArt = null;
  function buildMarina(ed) {
    const pl = HD.PLACES[ed.place];
    if (!pl || pl.id !== 'marina') return null;
    const boats = BOATS.map((b) => Object.assign({ b, cov: b.cover ? A(b.cover) : null }, b.kind === 'yacht' ? bakeYacht(b) : bakeSailboat(b)));
    return {
      boats,
      cols: {
        mast: A('#d4dae2'),
        mastD: A('#8e98a4'),
        wire: A('#a8b2bc'),
        rope: A('#e8dec8'),
        dark: A('#2a4468'),
        mid: A('#b4d0e4'),
        light: A('#d8eaf6'),
        burgee: A('#e0303c'),
      },
      castle: pl.castle ? bakeCastle(pl) : null,
      flag: As(['#a01822', '#e83a3a', '#ff7a6a']),
    };
  }
  function marinaBack(g, t) {
    const art = marinaArt();
    if (art && HD.tag('boats')) for (const k of art.boats) drawBoat(g, t, k, art.cols);
  }
  function marinaMid(g, t) {
    const art = marinaArt();
    if (art && HD.tag('brick-castle') && art.castle) {
      blit(g, art.castle);
      drawCastleFlag(g, t, HD.place(), art.flag);
    }
  }
  function marinaLights(t, L) {
    const pl = HD.place();
    if (HD.tag('brick-castle') && pl.castle) castleShade(pl, L);
  }

  // ==================================================================
  // BHILLS: valet podium, bell cart, planters along the lobby glass
  // ==================================================================
  function bhillsGeo(pl) {
    const cn = pl.entrance && pl.entrance.canopy;
    const cols = (cn && cn.columns) || [192, 268];
    const b = pl.building;
    return {
      planters: [
        { x0: b.x0 + 7, x1: cols[0] - 7 },
        { x0: cols[1] + 26, x1: b.x1 - 9 },
      ],
      podium: { x: cols[1] + 5, base: 214 },
      cart: { x0: cols[1] + 10, base: 216 },
    };
  }
  /** a lush planter mass: clipped clumps, bougainvillea, agave spikes */
  function plantMass(B, p, top, rnd) {
    const LF = As(['#163c1c', '#225a28', '#2e7834', '#48984a', '#6cb862']);
    const BG = As(['#8a1c54', '#c42c74', '#ea5aa0', '#ff9acb']);
    const AG = As(['#2c5c58', '#4c8c80', '#7cb4a4', '#b0dccc']);
    const WF = As(['#fff4e0', '#ffc04a']);
    // rounded clumps along the box, lit from the upper right
    for (let cx = p.x0 + 3; cx <= p.x1 - 2; cx += 5) {
      const r = 2.6 + rnd() * 0.9;
      const cy = top - 3 + (rnd() < 0.5 ? 0 : -1);
      for (let y = Math.floor(cy - r); y <= top - 1; y++)
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
          if (x <= p.x0 || x >= p.x1) continue;
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy * 1.3 > r * r + 1 && y < top - 1) continue;
          const lit = -dy * 0.6 + dx * 0.5;
          const lv = lit > 1.6 ? 4 : lit > 0.4 ? 3 : lit > -0.8 ? 2 : 1;
          B.set(x, y, LF[bayer(x, y) < 0.5 && lv > 1 ? lv - 1 : lv]);
        }
    }
    // bougainvillea: magenta sprays over the clumps and spilling over the lip
    for (let x = p.x0 + 2; x <= p.x1 - 2; x++) {
      const band = Math.sin(x * 0.55 + p.x0) + Math.sin(x * 0.21);
      if (band < 0.2) continue;
      for (let y = top - 6; y <= top - 1; y++) {
        if (!B.get(x, y) || rnd() > 0.55) continue;
        B.set(x, y, BG[y < top - 4 ? 3 : rnd() < 0.5 ? 2 : 1]);
      }
      if (band > 0.9 && rnd() < 0.7) {
        B.set(x, top + 1, BG[2]);
        if (rnd() < 0.5) B.set(x, top + 2, BG[1]);
      }
    }
    // two agave rosettes poking above the hedge
    for (const u of [0.27, 0.73]) {
      const cx = R(p.x0 + (p.x1 - p.x0) * u);
      for (const [dx, dy] of [[0, -8], [-2, -7], [2, -7], [-4, -5], [4, -5], [-5, -3], [5, -3]]) {
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        for (let s = 2; s <= steps; s++) {
          const x = cx + R((dx * s) / steps);
          const y = top - 1 + R((dy * s) / steps);
          B.set(x, y, s === steps ? AG[3] : dx > 0 ? AG[2] : dx < 0 ? AG[0] : AG[1]);
        }
      }
    }
    // a few white and golden flowers
    for (let x = p.x0 + 3; x < p.x1 - 2; x += 4) {
      const y = top - 2 - ((rnd() * 3) | 0);
      if (rnd() < 0.5 && B.get(x, y)) B.set(x, y, WF[rnd() < 0.6 ? 0 : 1]);
    }
  }
  function bakePlanters(pl) {
    const G = bhillsGeo(pl);
    const B = new Buf(0, 180, 480, 32);
    const ST = As(['#a8a094', '#cfc8ba', '#e4ded2', '#f4f0e8', '#fffdf8']);
    const rnd = HD.rng(4242);
    for (const p of G.planters) {
      const top = 200;
      const bot = 206;
      // the box: a pale stucco trough with a lit lip, a shadowed lip underside and a dark foot
      for (let x = p.x0; x <= p.x1; x++) {
        B.set(x, top, x === p.x0 ? ST[2] : ST[4]);
        B.set(x, top + 1, ST[1]);
        for (let y = top + 2; y < bot; y++) B.set(x, y, x === p.x0 ? ST[1] : x === p.x1 ? ST[3] : ST[2]);
        B.set(x, bot, ST[0]);
      }
      plantMass(B, p, top, rnd);
    }
    return B.bake();
  }
  function bakePodium(pl) {
    const { podium: p } = bhillsGeo(pl);
    const B = new Buf(p.x - 6, p.base - 16, 13, 18);
    const WD = As(['#3e2414', '#5a3820', '#7a5030', '#9a6a40']);
    const BR = As(['#8a6418', '#d8a838', '#ffe07a']);
    const x0 = p.x - 3;
    const x1 = p.x + 3;
    const b = p.base;
    // plinth, cabinet with a recessed panel, a brass-edged sloping desk
    B.hl(x0 - 1, x1 + 1, b, WD[0]);
    B.hl(x0, x1, b - 1, WD[1]);
    for (let y = b - 9; y <= b - 2; y++)
      for (let x = x0; x <= x1; x++) {
        let c = WD[2];
        if (x === x0) c = WD[1];
        if (x === x1) c = WD[3];
        if (x > x0 + 1 && x < x1 - 1 && y > b - 8 && y < b - 3) c = x === x1 - 2 ? WD[2] : WD[1]; // panel
        B.set(x, y, c);
      }
    B.hl(x0 - 1, x1 + 1, b - 10, BR[1]); // brass lip
    B.set(x1 + 1, b - 10, BR[2]);
    B.hl(x0 - 1, x1 + 1, b - 11, WD[3]); // desk top
    B.hl(x0, x1 + 1, b - 12, WD[2]);
    // a little brass key box on the side and a reading lamp
    B.set(x1, b - 6, BR[1]);
    B.set(x1, b - 5, BR[0]);
    B.vl(x0 + 1, b - 15, b - 13, BR[0]);
    B.hl(x0 + 1, x0 + 3, b - 15, BR[1]);
    B.set(x0 + 3, b - 14, BR[2]);
    return B.bake();
  }
  function bakeCart(pl) {
    const { cart: c } = bhillsGeo(pl);
    const x0 = c.x0;
    const x1 = c.x0 + 13;
    const b = c.base;
    const B = new Buf(x0 - 2, b - 20, 18, 22);
    const BR = As(['#7a5410', '#b8881c', '#e0b440', '#fff0a0']);
    const CARPET = As(['#6a1420', '#a82432']);
    const TEAL = As(['#145a64', '#1f8a96', '#4ab8c2']);
    const TAN = As(['#8a5a2c', '#c08446', '#e4ad6c']);
    const NV = As(['#1a2448', '#2c3c70', '#4a5c98']);
    const WH = A('#202024');
    // carpeted deck on four little wheels
    B.hl(x0, x1, b - 2, CARPET[1]);
    B.hl(x0, x1, b - 1, BR[1]);
    for (const wx of [x0 + 1, x1 - 1, x0 + 4, x1 - 4]) B.set(wx, b, WH);
    // brass uprights and the arched top rail
    B.vl(x0, b - 16, b - 3, BR[2]);
    B.vl(x1, b - 16, b - 3, BR[3]);
    B.hl(x0 + 2, x1 - 2, b - 18, BR[2]);
    B.set(x0 + 1, b - 17, BR[2]);
    B.set(x1 - 1, b - 17, BR[3]);
    B.set(x1 - 3, b - 18, BR[3]);
    B.hl(x0 + 1, x1 - 1, b - 14, BR[1]); // hanging bar
    // a garment bag on the bar
    for (let y = b - 13; y <= b - 6; y++) B.hl(x0 + 2, x0 + 4, y, y === b - 13 ? NV[2] : y > b - 8 ? NV[0] : NV[1]);
    B.set(x0 + 4, b - 12, NV[2]);
    // a big teal hard case standing up and a tan case lying on the deck
    for (let y = b - 9; y <= b - 3; y++)
      for (let x = x0 + 5; x <= x0 + 9; x++) B.set(x, y, x === x0 + 5 ? TEAL[0] : x === x0 + 9 ? TEAL[2] : y === b - 6 ? TEAL[0] : TEAL[1]);
    B.hl(x0 + 6, x0 + 8, b - 10, TEAL[0]); // handle
    for (let y = b - 6; y <= b - 3; y++) for (let x = x0 + 10; x <= x1 - 1; x++) B.set(x, y, x === x1 - 1 ? TAN[2] : y === b - 6 ? TAN[2] : TAN[1]);
    B.set(x0 + 11, b - 7, TAN[0]);
    B.set(x1 - 2, b - 7, TAN[0]);
    return B.bake();
  }
  /** contact shadows of the props on the drive and the sidewalk (daylight only) */
  function bhillsShade(pl, L) {
    const sun = HD.light().sun;
    if (!sun) return;
    const G = bhillsGeo(pl);
    const sk = (x0, x1, y, len, h) => {
      const d = sun.x > (x0 + x1) / 2 ? -1 : 1;
      L.shade({ poly: [[x0, y], [x1, y], [x1 + d * len, y + h], [x0 + d * len, y + h]], k: 0.38 });
    };
    if (HD.tag('planters')) for (const p of G.planters) sk(p.x0, p.x1 + 1, 207, 4, 2);
    if (HD.tag('valet-stand')) {
      sk(G.podium.x - 3, G.podium.x + 4, G.podium.base + 1, 7, 2);
      sk(G.cart.x0, G.cart.x0 + 14, G.cart.base + 1, 9, 2);
    }
  }

  let bhillsArt = null;
  function buildBhills(ed) {
    const pl = HD.PLACES[ed.place];
    if (!pl || pl.id !== 'bhills') return null;
    return { planters: bakePlanters(pl), podium: bakePodium(pl), cart: bakeCart(pl) };
  }
  function bhillsBack(g) {
    const art = bhillsArt();
    if (art && HD.tag('planters')) blit(g, art.planters);
  }
  function bhillsMid(g) {
    const art = bhillsArt();
    if (art && HD.tag('valet-stand')) {
      blit(g, art.podium);
      blit(g, art.cart);
    }
  }

  // ==================================================================
  // SOHO: the bench, shopping bags, the heart lantern, July 4th bunting
  // ==================================================================
  function benchGeo(pl) {
    const b = pl.bench;
    return { x0: b.x0, x1: b.x1, seat: b.seat, base: b.seat + 7 };
  }
  function bakeBench(pl) {
    const { x0, x1, seat: s, base } = benchGeo(pl);
    const B = new Buf(x0 - 4, s - 16, x1 - x0 + 9, base - s + 20);
    const WD = As(['#4a2c18', '#7a4a28', '#a86c3c', '#cc8c50']);
    const IR = As(['#16171c', '#26282e', '#3c3f48', '#5a5e6a']);
    // cast-iron back uprights with a little scroll on top
    for (const lx of [x0 + 1, x1 - 1]) {
      B.vl(lx, s - 11, s, IR[1]);
      B.set(lx, s - 12, IR[2]);
    }
    B.set(x0, s - 12, IR[1]);
    B.set(x1, s - 12, IR[1]);
    // three back slats: lit top edge, face
    for (const sy of [s - 11, s - 8, s - 5])
      for (let x = x0; x <= x1; x++) {
        B.set(x, sy, x < x0 + 3 ? WD[2] : WD[3]);
        B.set(x, sy + 1, x === x0 ? WD[0] : WD[1]);
      }
    // arms: a curl of iron at each end
    for (const [ax, d] of [[x0, -1], [x1, 1]]) {
      B.set(ax + d, s - 4, IR[1]);
      B.set(ax + d * 2, s - 4, IR[2]);
      B.set(ax + d * 2, s - 3, IR[1]);
      B.set(ax + d * 2, s - 2, IR[1]);
      B.set(ax + d, s - 1, IR[1]);
      B.set(ax + d * 2, s - 1, IR[1]);
    }
    // seat: slat tops seen from above, the front plank, a dark underside
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      B.set(x, s - 1, WD[3]);
      B.set(x, s, (x - x0) % 8 === 7 ? WD[1] : WD[2]);
      B.set(x, s + 1, WD[1]);
      B.set(x, s + 2, WD[0]);
    }
    // iron legs with splayed feet; the back pair darker and set in
    for (const lx of [x0 + 3, x1 - 3]) B.vl(lx, s + 3, base - 2, IR[0]);
    for (const lx of [x0 + 1, x1 - 1]) {
      B.vl(lx, s + 3, base, IR[1]);
      B.set(lx - 1, base, IR[1]);
      B.set(lx + 1, base, IR[1]);
      B.set(lx + 1, s + 3, IR[3]);
    }
    // a soft shadow under the seat on the pavement
    B.contact(x0, x1 + 2, base + 1, A('#141520'));
    return B.bake();
  }
  /** a paper shopping bag: (x, base) = bottom-left, w x h body, rope handles */
  function bag(B, x, base, w, h, col, tissue, handle) {
    const C = As(col);
    const top = base - h + 1;
    for (let y = top; y <= base; y++)
      for (let xx = x; xx < x + w; xx++) {
        let c = C[1];
        if (xx === x) c = C[0]; // shaded side
        if (xx === x + w - 1) c = C[2];
        if (y === top) c = xx === x ? C[1] : C[2]; // the folded rim catches the light
        B.set(xx, y, c);
      }
    // a side gusset crease
    B.vl(x + 1, top + 2, base - 1, C[0]);
    // tissue paper puffing out of the top
    if (tissue) {
      const TI = As(tissue);
      B.set(x + 1, top - 1, TI[1]);
      B.set(x + 2, top - 1, TI[0]);
      B.set(x + 2, top - 2, TI[1]);
      if (w > 5) B.set(x + 3, top - 1, TI[1]);
    }
    // rope handles: two loops
    const H = A(handle);
    const hx0 = x + 1;
    const hx1 = x + w - 2;
    B.set(hx0, top - 1, H);
    B.set(hx0, top - 2, H);
    B.set(hx0 + 1, top - 3, H);
    B.set(hx1 - 1, top - 3, H);
    B.set(hx1, top - 2, H);
    B.set(hx1, top - 1, H);
    if (hx1 - hx0 > 3) B.hl(hx0 + 2, hx1 - 2, top - 3, H);
    // a soft shadow at its foot
    B.contact(x, x + w, base + 1, A('#141520'));
  }
  function bakeBags(pl) {
    const { x0, x1, base } = benchGeo(pl);
    const B = new Buf(x0 - 20, base - 16, x1 - x0 + 40, 20);
    // left of the bench: a tall pink bag and a shorter mint one in front of it
    bag(B, x0 - 13, base, 6, 9, ['#d8608e', '#ff86b4', '#ffbad6'], ['#ffffff', '#ffe4ee'], '#5a2a40');
    bag(B, x0 - 8, base + 1, 5, 6, ['#38a888', '#66dcb8', '#aaf4dc'], ['#ffc0da', '#ffe8f0'], '#1e4a3e');
    // right of the bench: a kraft paper bag with a ribbon tied on its handle
    bag(B, x1 + 3, base, 6, 8, ['#9a6a3a', '#cc9a62', '#ecc088'], ['#fffaf0', '#ffffff'], '#5a3a20');
    const RB = As(['#8a1c2c', '#e04050']);
    B.set(x1 + 7, base - 9, RB[1]);
    B.set(x1 + 8, base - 8, RB[0]);
    B.set(x1 + 8, base - 10, RB[1]);
    return B.bake();
  }

  // the heart lantern hangs on a short cord from the hotel canopy's end, just
  // above the couple; a 6 fps cadence swings it by a px in the breeze
  const HEART_ROWS = ['.aa.aa.', 'abbabba', 'abccbba', 'abbbbba', '.abbba.', '..aba..', '...a...'];
  const HEART_COL = {
    a: [P.red[4], P.red[5]],
    b: [mix(P.blossom[5], P.red[5], 0.35), mix(P.blossom[6], P.red[6], 0.3)],
    c: [P.blossom[6], P.blossom[7]],
  };
  function heartHook(pl) {
    const cn = pl.entrance && pl.entrance.canopy;
    const b = pl.bench;
    if (cn && cn.x1 >= b.x0 - 2) return [Math.min(cn.x1 - 2, b.x0 + 2), cn.y + 3];
    return [b.x0 + 2, b.seat - 28];
  }
  function heartPos(t, pl) {
    const ts = T.step(t + Q, 6);
    const [hx, hy] = heartHook(pl);
    const amp = 0.12 + 0.1 * Math.max(0, breeze(ts));
    return FX.lanternPos(hx, hy, ts, 31, { len: 4, amp });
  }
  function drawHeartLantern(g, t, pl) {
    const [hx, hy] = heartHook(pl);
    const [bx, by] = heartPos(t, pl);
    // a small iron hook under the canopy edge, then the cord
    g.px(hx, hy - 2, P.night[1]);
    g.px(hx, hy - 1, P.night[1]);
    g.line(hx, hy, bx, by, A('#2a2228'));
    const f = T.flicker(T.step(t + Q, 8), 77, 0.8);
    const hi = f > 0.55 ? 1 : 0;
    g.px(bx, by + 1, P.night[2]); // paper cap
    for (let dy = 0; dy < HEART_ROWS.length; dy++) {
      const row = HEART_ROWS[dy];
      for (let dx = 0; dx < row.length; dx++) {
        const ch = row[dx];
        if (ch === '.') continue;
        g.em.px(bx - 3 + dx, by + 2 + dy, HEART_COL[ch][hi]);
      }
    }
    g.px(bx, by + 2 + HEART_ROWS.length, P.red[2]); // tassel
  }
  function heartLight(t, L, pl) {
    const [bx, by] = heartPos(t, pl);
    const f = T.flicker(T.step(t + Q, 8), 77, 0.8);
    // a pink-warm pool that falls on the couple, the bench and the bags
    L.add({ x: bx + 6, y: by + 20, r: 40, ry: 22, color: [1.0, 0.56, 0.5], i: 0.62 * (0.88 + 0.22 * f), bands: 5, halo: { x: bx, y: by + 5, r: 9, a: 0.18 } });
  }

  // pleated half-fans (a blue band with white stars over red and white
  // stripes) draped on the lofts' fire-escape rails and under sills
  const FAN_W = 13;
  function fanSprite() {
    const gn = festive();
    const BL = As(['#1a2c6a', '#2c46a8'], gn);
    const RD = As(['#8a1420', '#d02c3c', '#f0505a'], gn);
    const WT = As(['#c8c4c8', '#f2eeee', '#ffffff'], gn);
    const ST = A('#ffffff', gn);
    return HD.bake(FAN_W, 7, (g) => {
      const cx = 6;
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < FAN_W; x++) {
          const dx = x - cx;
          const d = Math.sqrt(dx * dx + y * y * 3.2);
          if (d > 6.6) continue;
          let c;
          if (y <= 1) c = BL[x & 1 ? 0 : 1];
          else {
            const band = Math.floor((d - 0.5) / 1.6);
            c = band % 2 ? WT[x & 1 ? 1 : 2] : RD[x & 1 ? 1 : 2];
            if (x === 0 || x === FAN_W - 1) c = band % 2 ? WT[0] : RD[0];
          }
          g.px(x, y, c);
        }
      for (const sx of [2, 6, 10]) g.px(sx, 0, ST);
      for (const sx of [4, 8]) g.px(sx, 1, ST);
    });
  }
  // [left x, top y]: on the fire-escape rails (deck 171, rail top 166) and
  // under the third-floor sills (y 171) of the cast-iron lofts
  const FANS = [
    [71, 172],
    [106, 166],
    [128, 166],
    [307, 166],
    [328, 166],
    [411, 172],
    [443, 172],
  ];
  function fanSpots(pl) {
    const b = pl.building;
    return FANS.filter(([x]) => x + FAN_W < b.x0 - 1 || x > b.x1 + 1);
  }

  let sohoArt = null;
  function buildSoho(ed) {
    const pl = HD.PLACES[ed.place];
    if (!pl || pl.id !== 'soho') return null;
    return { bench: pl.bench ? bakeBench(pl) : null, bags: pl.bench ? bakeBags(pl) : null, fan: fanSprite(), fans: fanSpots(pl) };
  }
  function sohoBack(g) {
    const art = sohoArt();
    if (art && HD.tag('bunting-usa')) for (const [x, y] of art.fans) g.sprite(art.fan, x, y);
  }
  function sohoMid(g) {
    const art = sohoArt();
    if (!art) return;
    if (art.bench) blit(g, art.bench);
    if (HD.tag('shopping-bags') && art.bags) blit(g, art.bags);
  }
  function sohoFront(g, t) {
    const pl = HD.place();
    if (HD.tag('heart-lantern') && pl.bench) drawHeartLantern(g, t, pl);
  }
  function sohoLights(t, L) {
    const pl = HD.place();
    if (HD.tag('heart-lantern') && pl.bench) heartLight(t, L, pl);
    // the fans catch a little warm spill from the lit rooms behind them
    if (HD.tag('bunting-usa')) {
      const art = sohoArt();
      if (art) for (const [x, y] of art.fans) L.add({ x: x + 6, y: y + 3, r: 9, ry: 6, color: HD.LIGHT.candle, i: 0.16, bands: 3 });
    }
  }

  // ==================================================================
  // dispatch
  // ==================================================================
  function placeId() {
    const p = HD.place();
    return p ? p.id : '';
  }
  HD.module('decor-trips', {
    init() {
      herndonArt = HD.perEdition(buildHerndon);
      marinaArt = HD.perEdition(buildMarina);
      bhillsArt = HD.perEdition(buildBhills);
      sohoArt = HD.perEdition(buildSoho);
    },
    lights(t, L) {
      const id = placeId();
      if (id === 'soho') sohoLights(t, L);
      else if (id === 'herndon') herndonLights(t, L);
      else if (id === 'marina') marinaLights(t, L);
      else if (id === 'bhills') bhillsShade(HD.place(), L);
    },
    passes: [
      {
        layer: 'scene',
        z: 36,
        id: 'back',
        draw(g, t) {
          const id = placeId();
          if (id === 'soho') sohoBack(g, t);
          else if (id === 'herndon') herndonBack(g, t);
          else if (id === 'marina') marinaBack(g, t);
          else if (id === 'bhills') bhillsBack(g, t);
        },
      },
      {
        layer: 'scene',
        z: 40,
        id: 'mid',
        draw(g, t) {
          const id = placeId();
          if (id === 'soho') sohoMid(g, t);
          else if (id === 'herndon') herndonMid(g, t);
          else if (id === 'marina') marinaMid(g, t);
          else if (id === 'bhills') bhillsMid(g, t);
        },
      },
      {
        layer: 'scene',
        z: 43,
        id: 'front',
        draw(g, t) {
          if (placeId() === 'soho') sohoFront(g, t);
        },
      },
    ],
  });

  HD.decorTrips = {
    /** birthday-table geometry at the current place, or null */
    table: () => tableGeo(),
    /** redraw the whole birthday table (cloth, cake, candles), e.g. over a back row of cats */
    drawTable(g, t) {
      if (placeId() === 'herndon' && HD.tag('birthday-table') && herndonArt) drawTable(g, t);
    },
    /** where the soho heart lantern hangs at time t ([x, y] of its cap), or null */
    heartLantern: (t) => (placeId() === 'soho' && HD.place().bench ? heartPos(t, HD.place()) : null),
  };
})();
