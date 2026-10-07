/*
 * building-soho: the hotel block at place 'soho' (scene layer, z 25..34).
 *
 * A slim twenty-storey hotel tower (graphite piers, floor-to-ceiling rooms,
 * a light stone spine that rises into a fin with a red aviation light, a
 * column of projecting glass bays on the right and a stepped deco crown
 * washed by cool uplights), with a warm double-height lobby, a revolving
 * door and a dark flat canopy. Around it, the rest of the block: a cream
 * cast-iron loft and a sage cast-iron loft (pilasters, arched sashes, deep
 * bracketed cornices), a red-brick loft with a rooftop water tank, a dark
 * brick loft with a second tank, a low painted loft with a little roof
 * terrace, black zigzag fire escapes, and boutique shopfronts with blank sign
 * bands, awnings and colourful window displays.
 *
 * Their room (place.catWindow, a glass bay on the twelfth floor) glows pink
 * with a little heart lamp; nobody is in it (they are on the bench outside).
 *
 * Static art is baked once per edition into three layers: base (facades,
 * dark glass; relit by the lightmap), em (lit glass; emissive) and front
 * (fire escapes, awnings, canopy, planters, window units). Per frame only
 * the animated bits are drawn: windows that switch on and off over the loop,
 * TV flicker, the revolving door, the heart lamp, fairy lights, the flag, the
 * aviation light, canopy downlights and firework glints in the glass bays.
 *
 * Every material colour below is a true daylight colour (albedo). It is
 * graded to a cold night tone at night and scaled so the engine's daylight
 * fill reveals it by day (see resolver()).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const T = HD.time;
  const CO = HD.color;
  const hash = HD.hash;
  const bayer = HD.bayer;
  const mix = CO.mix;
  const ID = 'soho';
  const W = 480;
  const GY = 206; // the buildings stand on y 206 (sidewalk top)

  // ------------------------------------------------------------------
  // Geometry (art pixels). The hotel and its anchors come from places.js.
  // ------------------------------------------------------------------
  const BL = { x0: 0, x1: 35, top: 112 }; // dark brick loft (cut by the frame)
  const CI1 = { x0: 36, x1: 150, top: 124 }; // cream cast-iron loft
  const PL = { x0: 151, x1: 193, top: 138 }; // low painted loft with a roof terrace
  const HT = { x0: 194, x1: 278 }; // the hotel
  const RB = { x0: 279, x1: 391, top: 113 }; // red-brick loft with a water tank
  const CI2 = { x0: 392, x1: 479, top: 124 }; // sage cast-iron loft
  const CI_FLOORS = [133, 146, 159, 172]; // storey tops on the cast-iron fronts (13 px)
  const BR_FLOORS = [120, 133, 146, 159, 172]; // storey tops on the brick lofts
  const PL_FLOORS = [146, 159, 172];
  // shop band shared by the lofts
  const SH = { cor: 184, sign0: 186, sign1: 189, glass0: 191, glass1: 202, kick0: 203 };

  // hotel facade columns
  const HW = [197, 212, 227]; // room windows, 13 px wide
  const HPIERS = [
    [194, 3],
    [210, 2],
    [225, 2],
    [240, 3],
  ];
  const SPINE = { x0: 243, x1: 248 };
  const BAY = { x0: 250, x1: 273 }; // projecting glass bays (24 px)
  const floorY = (f) => 186 - (f - 1) * 8; // floor f = 2..20 occupies y0 .. y0 + 7
  const THEIR_FLOOR = 12; // floorY(12) = 98 = place.catWindow.y
  const LOBBY = { x0: 207, x1: 274, y0: 187, y1: 205, mez: 195 };
  const DOOR = { x0: 224, x1: 236, y0: 190, cx: 230 };
  const CANOPY = { x0: 212, x1: 249, y: 183 };
  const FLAG = { bx: 37, by: 166, px: 29, py: 158, w: 13, h: 7 };

  // ------------------------------------------------------------------
  // Palette: true daylight colours (resolved per light mode)
  // ------------------------------------------------------------------
  const ALB = {
    // hotel
    hFrame: '#3c4250',
    hPier: '#68707f',
    hPierHi: '#8e97aa',
    hPierLo: '#515866',
    hSpan: '#2e333d',
    hSpanHi: '#737c8e',
    hDeep: '#1e2129',
    stone: '#b5ae9f',
    stoneHi: '#d3ccbc',
    stoneLo: '#8f897d',
    stoneDk: '#6c675e',
    alu: '#c5ccd8',
    aluLo: '#7c8494',
    mull: '#4a4038',
    canopy: '#3a3631',
    canopyHi: '#8a8e98',
    planter: '#2e3036',
    planterHi: '#50545e',
    box: '#3b6b3c',
    boxHi: '#5e9150',
    granite: '#45474e',
    // cast iron, cream
    c1face: '#e0c898',
    c1hi: '#f4e4be',
    c1lo: '#b49e78',
    c1deep: '#80705a',
    // cast iron, sage
    c2face: '#94b09a',
    c2hi: '#b2cab4',
    c2lo: '#72907c',
    c2deep: '#506a5a',
    // red brick
    brick: '#93453a',
    brickHi: '#a9574a',
    brickLo: '#783529',
    mortar: '#5d2c25',
    // dark brick
    dbrick: '#6c3a33',
    dbrickHi: '#7c463d',
    dmortar: '#45231f',
    // painted loft
    paint: '#5c5f67',
    paintHi: '#777b84',
    paintLo: '#45484f',
    // shared stone and metal
    lintel: '#c0b7a4',
    lintelLo: '#918878',
    cornice: '#4b4845',
    corniceHi: '#6f6b66',
    corniceLo: '#302e2c',
    sash: '#2c2826',
    iron: '#1b1c21',
    ironHi: '#3d3f49',
    roof: '#3e3f46',
    roofHi: '#5a5b63',
    tar: '#2a2a30',
    wood: '#7d5c45',
    woodHi: '#9a7358',
    woodLo: '#5a412f',
    shingle: '#4c3d36',
    shingleHi: '#6a564b',
    hoop: '#26262c',
    ac: '#9a9ea8',
    acLo: '#6a6e78',
    pot: '#a65a3a',
    leaf: '#3a7a40',
    leafHi: '#5aa052',
    // shopfronts
    col: '#2a2c34',
    colHi: '#4c505c',
    kick: '#33353d',
    kickHi: '#4e515b',
    door: '#3a2c26',
    doorHi: '#5a463a',
    gold: '#b8923e',
    signNavy: '#26345e',
    signOx: '#5e1f25',
    signBlack: '#1f2026',
    signGreen: '#1f4c3b',
    signCream: '#d6cab0',
    // awnings
    awRed: '#b22f3a',
    awRedLo: '#7c1c25',
    awGreen: '#2a7151',
    awGreenLo: '#1a4a34',
    awPlum: '#7d2a5f',
    awPlumLo: '#521a3e',
    awNavy: '#2b3d76',
    awNavyLo: '#1b284e',
    awWhite: '#e7e1d4',
    awWhiteLo: '#b4aea2',
    awBlack: '#36373f',
    awBlackLo: '#1f2026',
    // flag (accurate colours)
    flagRed: '#b22234',
    flagWhite: '#f2f0ea',
    flagBlue: '#3c3b6e',
    pole: '#b8bcc6',
    white: '#ffffff',
    // day glass (sky reflections)
    dGlass: '#5f7e9f',
    dGlassHi: '#a3bfdc',
    dGlassLo: '#3b5070',
    dGlint: '#eef6ff',
    dBay: '#6f93b8',
    dBayHi: '#b3cde6',
    dRoom: '#4a4e5a',
    // interiors by day (seen through glass, not glowing)
    dLobby: '#a88a66',
    dLobbyHi: '#c8ac88',
    dLobbyLo: '#6e5a46',
    dShop: '#9a8a74',
    dShopHi: '#c2b49c',
    dPink: '#c88a98',
    dPinkLo: '#9a6070',
  };

  // cold night glass (non-emissive, so firework light and lamps relight it)
  const NG = {
    dk: '#0d1222',
    dk2: '#121a2e',
    ref: '#1b2540',
    ref2: '#25335a',
    bay: '#16223c',
    bayRef: '#22365e',
    baySheen: '#2e4878',
    bayTop: '#3a5486',
    curtain: '#1a1824',
    curtainHi: '#24212f',
  };

  // emissive interiors (night and dusk)
  const WARM = ['#3a2010', '#6c3f20', '#a6652e', '#d68f40', '#f0b25a', '#ffd88e', '#fff2cc'];
  const CURT = ['#b8703e', '#a65440', '#c8945a', '#8e6a8a', '#6e8a68', '#c27a6a'];
  const TVC = ['#141c44', '#26407c', '#4468b4', '#7ea8ec', '#c8dcff'];
  const PINK = ['#5a1e36', '#a4446a', '#dc6f8e', '#f39cb2', '#ffc6d4', '#fff0f4'];
  const HEART = ['#8c1236', '#de2a5a', '#ff7aa0', '#ffd6e2'];
  const SHOPC = { deep: '#5c3418', shade: '#8c5628', floor: '#b47a40', wall: '#e4ac5c', hot: '#ffdc98', top: '#fff0c6' };
  const LOBC = {
    deep: '#6a3c1c',
    shade: '#a86a36',
    wall: '#dea25c',
    wallHi: '#f0bc72',
    ceil: '#ffe2a6',
    hot: '#fff4d6',
    floor: '#b07440',
    floorHi: '#eabb74',
    slab: '#5a321a',
    wood: '#7a4422',
    woodHi: '#c07a42',
  };
  const GOODS = ['#e8665a', '#f2dcc0', '#4f72c0', '#eab03e', '#a85c9e', '#3ea47c', '#ef8fae', '#7fc4e0', '#f4ec9c', '#c84a4a'];

  // ------------------------------------------------------------------
  // Colour resolution per light mode
  // ------------------------------------------------------------------
  const GRADE = [0.44, 0.47, 0.6]; // night: albedo -> cold night tone
  function factor(lt) {
    if (!(lt && lt.day > 0)) return GRADE;
    // scale so the neutral daylight fill reveals the albedo (the golden and
    // dusk fills then tint it warm or dim it)
    const A = HD.AMBIENT;
    const F = (HD.LIGHTING && HD.LIGHTING.day && HD.LIGHTING.day.fill) || [0.72, 0.66, 0.5];
    return [A[0] / (A[0] + F[0]), A[1] / (A[1] + F[1]), A[2] / (A[2] + F[2])];
  }
  /** a true colour as the scene colour for this light (k from factor()) */
  function scale(hex, k) {
    const c = CO.hex(hex);
    return CO.css(c[0] * k[0], c[1] * k[1], c[2] * k[2]);
  }
  function resolver(lt) {
    const k = factor(lt);
    const p = {};
    for (const n in ALB) p[n] = scale(ALB[n], k);
    return p;
  }

  // ------------------------------------------------------------------
  // Small drawing helpers
  // ------------------------------------------------------------------
  /** clear a rectangle of a baked layer (holes in the emissive layer for bars) */
  function clr(g, x, y, w, h) {
    if (g) g.ctx.clearRect(x, y, w, h);
  }

  /** daylight reflections on a big pane: two diagonal streaks of sky */
  function sheen(g, x0, y0, x1, y1, c, seed) {
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    g.hline(x0, x1, y0, c);
    for (const [off, wide] of [
      [(seed * 7) % Math.max(1, w), 3],
      [(seed * 7 + 9) % Math.max(1, w), 1],
    ]) {
      for (let k = 0; k < h; k++) {
        for (let j = 0; j < wide; j++) {
          const x = x0 + ((off + k + j) % (w + 6)) - 3;
          if (x >= x0 && x <= x1) g.px(x, y1 - k, c);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Windows
  // ------------------------------------------------------------------
  // shapes: [w, h]; bars are the non-glowing sash and mullion pixels
  const SHAPES = {
    hotel: [13, 6],
    bay: [24, 7],
    arch: [9, 9],
    rect: [9, 9],
  };
  function bars(g, shape, x, y, c) {
    if (shape === 'hotel') g.vline(x + 6, y, y + 5, c);
    else if (shape === 'bay') {
      g.vline(x + 8, y, y + 6, c);
      g.vline(x + 16, y, y + 6, c);
    } else {
      g.vline(x + 4, y + 1, y + 8, c);
      g.hline(x, x + 8, y + 4, c);
    }
  }
  function barHoles(E, shape, x, y) {
    if (!E) return;
    if (shape === 'hotel') clr(E, x + 6, y, 1, 6);
    else if (shape === 'bay') {
      clr(E, x + 8, y, 1, 7);
      clr(E, x + 16, y, 1, 7);
    } else {
      clr(E, x + 4, y, 1, 9);
      clr(E, x, y + 4, 9, 1);
      if (shape === 'arch') {
        clr(E, x, y, 1, 1);
        clr(E, x + 8, y, 1, 1);
      }
    }
  }

  /** dark (unlit) glass, non-emissive */
  function glassDark(S, shape, x, y, seed, kind) {
    const g = S.b;
    const p = S.p;
    const [w, h] = SHAPES[shape];
    const r = hash(seed, 5, 1, 9);
    if (!S.night) {
      // daylight: the sky reflected, a darker room below, a glint now and then
      const isBay = shape === 'bay';
      g.rect(x, y, w, h, isBay ? p.dBay : p.dGlass);
      g.hline(x, x + w - 1, y, isBay ? p.dBayHi : p.dGlassHi);
      if (!isBay) {
        g.hline(x, x + w - 1, y + h - 1, p.dGlassLo);
        if (h > 6) g.dither(x, y + h - 3, w, 2, p.dGlassLo, 0.5);
      }
      const off = Math.floor(r * w);
      for (let k = 0; k < h; k++) {
        const xx = x + ((off + k) % (w + 4)) - 2;
        if (xx >= x && xx < x + w) g.px(xx, y + h - 1 - k, isBay ? p.dBayHi : p.dGlassHi);
        if (isBay && xx + 1 >= x && xx + 1 < x + w) g.px(xx + 1, y + h - 1 - k, p.dBayHi);
      }
      if (r < (S.golden ? 0.3 : 0.18)) g.px(x + 1 + (Math.floor(r * 37) % Math.max(1, w - 2)), y + 1, S.golden ? '#ffe2a0' : p.dGlint);
      return;
    }
    if (shape === 'bay') {
      g.rect(x, y, w, h, NG.bay);
      g.hline(x, x + w - 1, y, NG.bayTop);
      // two diagonal sheen bands
      const off = 2 + Math.floor(r * 10);
      for (let k = 0; k < h; k++) {
        const xx = x + off + k;
        g.px(xx, y + h - 1 - k, NG.baySheen);
        g.px(xx + 1, y + h - 1 - k, NG.baySheen);
        if (xx + 9 < x + w) g.px(xx + 9, y + h - 1 - k, NG.bayRef);
      }
      return;
    }
    if (kind === 'closed') {
      // dark room, curtains drawn
      g.rect(x, y, w, h, NG.curtain);
      for (let xx = x + 1; xx < x + w; xx += 2) g.vline(xx, y, y + h - 1, NG.curtainHi);
      g.hline(x, x + w - 1, y, NG.ref);
      return;
    }
    g.rect(x, y, w, h, shape === 'hotel' ? NG.dk : NG.dk2);
    g.hline(x, x + w - 1, y, NG.ref);
    if (r < 0.5) {
      // a faint diagonal reflection of the sky glow
      const off = Math.floor(r * 2 * w);
      for (let k = 1; k < h; k++) g.px(x + ((off + k) % w), y + h - k, NG.ref);
    }
  }

  /** lit interior, emissive (drawn into E; the bars are holes) */
  function paintLit(E, shape, x, y, kind, seed) {
    const [w, h] = SHAPES[shape];
    const r1 = hash(seed, 1, 3, 7);
    const r2 = hash(seed, 2, 3, 7);
    const cc = CURT[Math.floor(r2 * CURT.length) % CURT.length];
    if (kind === 'dim') {
      E.rect(x, y, w, h, WARM[1]);
      const lx = x + 1 + Math.floor(r1 * (w - 2));
      E.px(lx, y + h - 3, WARM[3]);
      E.px(lx, y + h - 2, WARM[2]);
      E.hline(x, x + w - 1, y + h - 1, WARM[0]);
      return;
    }
    if (kind === 'sheer') {
      E.rect(x, y, w, h, WARM[4]);
      for (let xx = x + (seed & 1); xx < x + w; xx += 2) E.vline(xx, y + 1, y + h - 1, WARM[3]);
      E.hline(x, x + w - 1, y, WARM[5]);
      E.hline(x, x + w - 1, y + h - 1, WARM[2]);
      return;
    }
    if (kind === 'blind') {
      const drop = Math.max(2, Math.floor(h * (0.35 + 0.35 * r1)));
      E.rect(x, y, w, h, WARM[3]);
      for (let yy = y; yy < y + drop; yy++) E.hline(x, x + w - 1, yy, (yy - y) % 2 ? WARM[2] : WARM[4]);
      E.hline(x, x + w - 1, y + drop, WARM[1]);
      E.hline(x, x + w - 1, y + h - 1, WARM[2]);
      return;
    }
    if (kind === 'curtain') {
      // closed coloured curtains, lit from behind
      const c1 = mix(cc, WARM[4], 0.35);
      E.rect(x, y, w, h, c1);
      for (let xx = x + 1; xx < x + w; xx += 3) E.vline(xx, y + 1, y + h - 1, cc);
      E.hline(x, x + w - 1, y, mix(c1, WARM[5], 0.5));
      return;
    }
    // 'warm': curtains open at the sides, the soft pool of a lamp, a darker floor
    E.rect(x, y, w, h, WARM[3]);
    E.hline(x, x + w - 1, y, WARM[4]);
    if (h >= 7) E.hline(x, x + w - 1, y + 1, WARM[4]);
    const lx = x + 2 + Math.floor(r1 * Math.max(1, w - 5));
    E.rect(lx, y + 1, 2, h - 2, WARM[4]);
    E.px(lx + (r1 > 0.5 ? 1 : 0), y + Math.max(1, h - 4), WARM[5]);
    E.hline(x, x + w - 1, y + h - 1, WARM[2]);
    const cw = w >= 12 ? 2 : 1;
    E.rect(x, y, cw, h, cc);
    E.rect(x + w - cw, y, cw, h, cc);
    E.vline(x + cw - 1, y, y + h - 1, mix(cc, WARM[5], 0.4));
    E.vline(x + w - cw, y, y + h - 1, mix(cc, WARM[5], 0.4));
    // now and then a plant on the sill, dark against the light
    if (h >= 9 && r2 > 0.55) {
      const px = r1 > 0.5 ? x + 1 : x + w - 4;
      const leaf = '#2a2a1a';
      E.rect(px, y + h - 2, 2, 1, WARM[0]);
      E.px(px, y + h - 3, leaf);
      E.px(px + 1, y + h - 3, leaf);
      E.px(px - 1 + (r1 > 0.5 ? 1 : 0), y + h - 4, leaf);
      E.px(px + 2, y + h - 4, leaf);
      E.px(px + 1, y + h - 5, leaf);
    }
  }

  /**
   * A window: dark glass in base, lit glass in em, bars in base. `state`:
   * 'dark' | 'closed' | 'warm' | 'sheer' | 'blind' | 'dim' | 'curtain' |
   * 'tv' (flickers) | 'dyn' (switches on and off over the loop).
   */
  function windowAt(S, shape, x, y, state, seed, barC) {
    glassDark(S, shape, x, y, seed, state === 'closed' ? 'closed' : 'dark');
    const lit = state !== 'dark' && state !== 'closed';
    if (S.night && lit) {
      if (state === 'tv') S.tvs.push({ shape, x, y, seed, barC });
      else if (state === 'dyn') {
        // a window that switches on and off: its lit look is baked once as a
        // small sprite (bars and arch corners are holes) and blitted when on
        const kind = ['warm', 'sheer', 'blind', 'warm'][seed & 3];
        const [w, h] = SHAPES[shape];
        const spr = HD.bake(w, h, (gg) => {
          paintLit(gg, shape, 0, 0, kind, seed);
          barHoles(gg, shape, 0, 0);
        });
        S.dyn.push({ x, y, seed, spr });
      }
      else {
        paintLit(S.e, shape, x, y, state, seed);
        barHoles(S.e, shape, x, y);
      }
    }
    bars(S.b, shape, x, y, barC);
  }

  /** pick a night state for a window from a hash; lit is the lit share */
  function pickState(h, lit) {
    if (h < lit * 0.62) return 'warm';
    if (h < lit * 0.76) return 'sheer';
    if (h < lit * 0.86) return 'blind';
    if (h < lit * 0.93) return 'curtain';
    if (h < lit) return 'dim';
    if (h < lit + 0.08) return 'closed';
    return 'dark';
  }

  // ------------------------------------------------------------------
  // The hotel
  // ------------------------------------------------------------------
  // windows that switch on/off over the loop and TVs (by floor:index)
  const HOTEL_DYN = new Set(['5:1', '9:0', '15:2', '17:0', '7:2']);
  const HOTEL_TV = new Set(['4:0', '13:1', '18:2']);
  // lit glass bays stay few and away from their room, so the pink one sings
  const BAY_STATE = { 3: 'warm', 6: 'sheer', 16: 'dyn', 18: 'warm' };

  // night states of the room windows, chosen once: about 30% lit, never more
  // than two lit rooms stacked in one column, so the tower reads calm
  const HOTEL_STATES = (function () {
    const st = {};
    for (let i = 0; i < 3; i++) {
      let run = 0;
      for (let f = 2; f <= 20; f++) {
        const key = f + ':' + i;
        let s = HOTEL_TV.has(key) ? 'tv' : HOTEL_DYN.has(key) ? 'dyn' : pickState(hash(77, f, i, 1), 0.32);
        const lit = s !== 'dark' && s !== 'closed';
        if (lit && run >= 2 && s !== 'tv' && s !== 'dyn') s = 'dark';
        run = s !== 'dark' && s !== 'closed' ? run + 1 : 0;
        st[key] = s;
      }
    }
    return st;
  })();
  function hotelWindowState(f, i) {
    return HOTEL_STATES[f + ':' + i];
  }

  function bakeHotel(S) {
    const g = S.b;
    const p = S.p;
    const { x0, x1 } = HT;
    // the frame behind everything
    g.rect(x0, 30, x1 - x0 + 1, GY - 30, p.hFrame);

    for (let f = 2; f <= 20; f++) {
      const y0 = floorY(f);
      // spandrels (recessed between the piers): a light sill line, then the head shadow
      g.hline(x0, 242, y0, p.hSpanHi);
      g.hline(x0, 242, y0 + 1, p.hSpan);
      for (let i = 0; i < 3; i++) {
        const st = S.night ? hotelWindowState(f, i) : 'dark';
        windowAt(S, 'hotel', HW[i], y0 + 2, st, 1000 + f * 7 + i, p.hDeep);
      }
      bakeBay(S, f, y0);
    }
    // piers run the full height (deco verticals), over the spandrels
    for (const [px, w] of HPIERS) {
      g.rect(px, 34, w, 152, p.hPier);
      g.vline(px, 34, 185, p.hPierHi);
      if (w > 2) g.vline(px + w - 1, 34, 185, p.hPierLo);
      for (let f = 2; f <= 20; f++) g.px(px + 1, floorY(f), p.hPierLo);
    }
    // right corner pier, in the shadow of the bays
    g.rect(275, 30, 4, 156, p.hPier);
    g.vline(275, 34, 185, p.hDeep);
    g.vline(276, 34, 185, p.hPierLo);
    g.vline(278, 30, 185, p.hPierLo);
    bakeCrown(S);
    // stone spine rising through the crown into the fin
    g.rect(SPINE.x0, 25, 6, 161, p.stone);
    g.vline(SPINE.x0, 25, 185, p.stoneHi);
    g.vline(SPINE.x1, 25, 185, p.stoneLo);
    g.vline(SPINE.x1 - 1, 25, 185, mix(p.stone, p.stoneLo, 0.5));
    for (let f = 2; f <= 20; f++) g.hline(SPINE.x0 + 1, SPINE.x1 - 1, floorY(f) + 7, p.stoneLo);
    g.vline(SPINE.x0 + 2, 36, 183, p.stoneLo); // a groove down the middle
    // fin top: stepped, standing proud of the crown, cut free of it by dark slots
    g.rect(244, 23, 4, 2, p.stone);
    g.vline(244, 23, 24, p.stoneHi);
    g.vline(247, 23, 24, p.stoneLo);
    g.rect(245, 22, 2, 1, p.stoneHi);
    g.hline(243, 248, 25, p.stoneHi);
    g.vline(242, 26, 33, p.hDeep);
    g.vline(249, 26, 33, p.hDeep);

    bakeLobby(S);
  }

  function bakeBay(S, f, y0) {
    const g = S.b;
    const p = S.p;
    // the slab edge (each floor's projecting box) and its frames
    g.hline(BAY.x0 - 1, BAY.x1 + 1, y0, p.alu);
    g.vline(BAY.x0 - 1, y0 + 1, y0 + 7, mix(p.alu, p.aluLo, 0.3));
    g.vline(BAY.x1 + 1, y0 + 1, y0 + 7, p.aluLo);
    const gy = y0 + 1;
    if (f === THEIR_FLOOR) {
      theirRoom(S, gy);
      return;
    }
    const st = S.night ? BAY_STATE[f] || 'dark' : 'dark';
    windowAt(S, 'bay', BAY.x0, gy, st, 2000 + f, mix(p.aluLo, p.hDeep, 0.4));
    if (st === 'dark') S.darkBays.push(f);
  }

  /** their room: the glass bay on floor 12, lit pink, a heart lamp, nobody home */
  function theirRoom(S, y) {
    const g = S.b;
    const p = S.p;
    const x = BAY.x0;
    const w = 24;
    if (!S.night) {
      // by day: rose curtains tied back, the room in shade behind the reflections
      g.rect(x, y, w, 7, p.dRoom);
      g.rect(x + 3, y + 5, 18, 2, p.dPinkLo);
      g.rect(x, y, 3, 7, p.dPink);
      g.rect(x + w - 3, y, 3, 7, p.dPink);
      g.hline(x, x + w - 1, y, p.dBayHi);
      for (let k = 0; k < 6; k++) g.px(x + 6 + k, y + 6 - k, p.dBayHi);
      bars(g, 'bay', x, y, p.aluLo);
      return;
    }
    // base under the glass (seen only if the em layer is missing)
    g.rect(x, y, w, 7, NG.bay);
    const E = S.e;
    // pink walls glowing round the lamp
    E.rect(x, y, w, 7, PINK[2]);
    E.hline(x, x + w - 1, y, PINK[3]);
    // the lamp's glow on the back wall (kept inside the glass)
    for (let yy = y + 1; yy <= y + 5; yy++) {
      for (let xx = x + 4; xx <= x + 20; xx++) {
        const dx = (xx - (x + 12)) / 8;
        const dy = (yy - (y + 3)) / 3.2;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1 && bayer(xx, yy) < 1.2 - d) E.px(xx, yy, PINK[3]);
      }
    }
    E.hline(x, x + w - 1, y + 6, PINK[1]);
    // a small framed picture on the left wall
    E.rect(x + 4, y + 1, 3, 2, PINK[1]);
    E.px(x + 5, y + 1, PINK[4]);
    // the bed on the right: duvet and pillow
    E.rect(x + 17, y + 4, 4, 2, PINK[4]);
    E.px(x + 19, y + 3, PINK[5]);
    E.px(x + 20, y + 3, PINK[5]);
    E.vline(x + 21, y + 3, y + 5, PINK[1]);
    // nightstand under the lamp
    E.rect(x + 10, y + 5, 5, 2, PINK[0]);
    E.hline(x + 10, x + 14, y + 5, PINK[1]);
    // curtains open and tied back (narrow at the tie)
    const cur = '#b4466a';
    const curHi = '#e2789a';
    for (const [cx, dir] of [
      [x, 1],
      [x + w - 1, -1],
    ]) {
      for (let r = 0; r < 7; r++) {
        const ww = r === 3 ? 1 : r === 2 || r === 4 ? 2 : 3;
        for (let k = 0; k < ww; k++) E.px(cx + dir * k, y + r, k === ww - 1 ? curHi : cur);
      }
    }
    barHoles(E, 'bay', x, y);
    bars(g, 'bay', x, y, mix(p.aluLo, p.hDeep, 0.4));
  }

  /** a stepped stone tier: lit top edge, fluted face, shadow under its lip */
  function tier(g, p, x0, x1, y0, y1, flute) {
    g.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, p.stone);
    g.hline(x0, x1, y0, p.stoneHi);
    g.vline(x0, y0, y1, p.stoneHi);
    g.vline(x1, y0 + 1, y1, p.stoneLo);
    if (flute) for (let x = x0 + 2; x < x1 - 1; x += 3) g.vline(x, y0 + 1, y1, p.stoneLo);
  }

  function bakeCrown(S) {
    const g = S.b;
    const p = S.p;
    // a dark recessed band under the crown, then the stone parapet with a
    // deco chevron frieze, washed by uplights from the ledge below
    g.rect(194, 30, 85, 4, p.stone);
    g.hline(194, 278, 30, p.stoneHi);
    g.hline(194, 278, 33, p.stoneDk);
    for (let x = 195; x < 278; x++) {
      const m = x % 4;
      if (m === 2) g.px(x, 31, p.stoneLo);
      if (m === 1 || m === 3) g.px(x, 32, p.stoneLo);
    }
    g.hline(194, 278, 34, p.hDeep);
    // stepped tiers over the room block (a little ziggurat) and over the bays
    tier(g, p, 199, 240, 27, 29, true);
    tier(g, p, 205, 234, 25, 26, true);
    tier(g, p, 212, 227, 24, 24, false);
    tier(g, p, 251, 273, 27, 29, true);
    tier(g, p, 257, 267, 25, 26, true);
    // corner pinnacles
    tier(g, p, 194, 196, 26, 29, false);
    tier(g, p, 275, 278, 26, 29, false);
    g.px(195, 25, p.stoneHi);
    g.px(276, 25, p.stoneHi);
    g.px(277, 25, p.stoneLo);
    // shadows where each tier sits on the one below
    g.hline(200, 239, 30, p.stoneLo);
    g.hline(206, 233, 27, p.stoneLo);
    g.hline(252, 272, 30, p.stoneLo);
    g.hline(258, 266, 27, p.stoneLo);
  }

  function bakeLobby(S) {
    const g = S.b;
    const p = S.p;
    // the transfer beam over the lobby and the frame round the glass
    g.rect(194, 186, 85, 20, p.hFrame);
    g.hline(194, 278, 186, p.hSpan);
    // corner piers to the ground
    g.rect(194, 186, 3, 20, p.hPier);
    g.vline(194, 186, 205, p.hPierHi);
    g.rect(275, 186, 4, 20, p.hPier);
    g.vline(275, 186, 205, p.hPierLo);
    g.vline(278, 186, 205, p.hPierLo);
    // stone panel for the plaque (left plain: the plaque is drawn by the sign module)
    g.rect(197, 186, 9, 20, p.stone);
    g.vline(197, 186, 205, p.stoneHi);
    g.vline(205, 186, 205, p.stoneLo);
    g.hline(197, 205, 186, p.stoneHi);
    g.hline(198, 204, 204, p.stoneLo);
    g.hline(197, 205, 205, p.stoneDk);
    // granite base under the piers
    g.rect(194, 204, 3, 2, p.granite);
    g.rect(275, 204, 4, 2, p.granite);
    g.vline(206, 187, 205, p.hFrame);

    const { x0, x1, y0, y1, mez } = LOBBY;
    if (S.night) {
      const E = S.e;
      // walls, ceiling glow, the mezzanine (double height) and the floor
      E.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, LOBC.wall);
      E.rect(x0, y0, x1 - x0 + 1, 2, LOBC.ceil);
      E.dither(x0, y0 + 2, x1 - x0 + 1, 2, LOBC.wallHi, 0.6);
      E.rect(x0, y0 + 4, x1 - x0 + 1, mez - y0 - 4, LOBC.wallHi);
      // under the mezzanine (right part) a little darker
      E.rect(238, mez + 1, x1 - 237, 7, LOBC.wall);
      E.dither(238, mez + 1, x1 - 237, 2, LOBC.shade, 0.35);
      // mezzanine slab and its rail
      E.hline(238, x1, mez, LOBC.slab);
      E.hline(238, x1, mez - 2, LOBC.wood);
      for (let x = 239; x <= x1; x += 3) E.px(x, mez - 1, LOBC.wood);
      // polished floor
      E.rect(x0, 203, x1 - x0 + 1, 3, LOBC.floor);
      E.hline(x0, x1, 203, LOBC.shade);
      // left part: an artwork, a tall plant, a lounge chair
      E.rect(209, 190, 7, 5, LOBC.deep);
      E.rect(210, 191, 2, 3, '#3e9c8c');
      E.rect(212, 191, 2, 3, '#ec7a5e');
      E.rect(214, 191, 1, 3, '#f6e2b4');
      E.rect(210, 193, 5, 1, '#e9c26a');
      E.rect(218, 200, 4, 3, LOBC.deep);
      E.rect(217, 194, 6, 6, '#2e5a34');
      E.px(218, 193, '#2e5a34');
      E.px(221, 193, '#3e7a42');
      E.px(219, 192, '#3e7a42');
      E.px(219, 195, '#4e9450');
      E.px(221, 196, '#4e9450');
      E.rect(209, 199, 5, 3, '#2c5c60');
      E.hline(209, 213, 199, '#3e7c7e');
      E.px(209, 202, LOBC.deep);
      E.px(213, 202, LOBC.deep);
      // right part: reception desk under the mezzanine, a lit back wall, elevator doors
      E.rect(245, 197, 12, 2, LOBC.ceil);
      E.rect(244, 199, 16, 4, LOBC.wood);
      E.hline(244, 259, 199, LOBC.woodHi);
      E.rect(266, 197, 7, 6, '#b8783c');
      E.vline(269, 197, 202, LOBC.deep);
      E.hline(266, 272, 197, LOBC.woodHi);
      // pendant lights (double-height space)
      for (const px of [242, 252, 262, 271]) {
        E.vline(px, y0, y0 + 3, LOBC.deep);
        E.px(px, y0 + 4, LOBC.hot);
        E.px(px - 1, y0 + 4, LOBC.ceil);
        E.px(px + 1, y0 + 4, LOBC.ceil);
        E.px(px, y0 + 5, LOBC.ceil);
        E.px(px, 204, LOBC.floorHi);
        E.px(px - 1, 204, LOBC.floorHi);
      }
      E.px(214, y0 + 2, LOBC.hot);
      // inside the revolving door drum (wings drawn per frame)
      E.rect(DOOR.x0 + 1, DOOR.y0 + 1, 11, 15, LOBC.ceil);
      E.rect(DOOR.x0 + 1, 203, 11, 3, LOBC.floorHi);
    } else {
      // by day: the lobby in shade behind reflective glass
      g.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, p.dLobby);
      g.rect(x0, y0, x1 - x0 + 1, 2, p.dLobbyHi);
      g.hline(238, x1, mez, p.dLobbyLo);
      g.rect(244, 199, 16, 4, p.dLobbyLo);
      g.rect(217, 194, 6, 8, p.box);
      g.rect(x0, 203, x1 - x0 + 1, 3, p.dLobbyLo);
      sheen(g, x0, y0, x1, y1, p.dGlassHi, 7);
      g.rect(DOOR.x0 + 1, DOOR.y0 + 1, 11, 15, p.dLobbyHi);
    }
    // mullions and a transom (holes in the emissive layer)
    const mc = p.mull;
    for (const mx of [215, 246, 256, 265]) {
      g.vline(mx, y0, y1, mc);
      clr(S.e, mx, y0, 1, y1 - y0 + 1);
    }
    for (const [a, b] of [
      [x0, DOOR.x0 - 1],
      [DOOR.x1 + 1, x1],
    ]) {
      g.hline(a, b, mez + 1, mc);
      clr(S.e, a, mez + 1, b - a + 1, 1);
    }
    // door drum: cap and curved edges
    g.rect(DOOR.x0 - 1, DOOR.y0 - 1, 15, 2, p.canopy);
    g.hline(DOOR.x0 - 1, DOOR.x1 + 1, DOOR.y0 - 1, p.canopyHi);
    g.vline(DOOR.x0, DOOR.y0, 205, p.canopy);
    g.vline(DOOR.x1, DOOR.y0, 205, p.canopy);
    g.vline(DOOR.x0 - 1, DOOR.y0, 205, mc);
    g.vline(DOOR.x1 + 1, DOOR.y0, 205, mc);
    clr(S.e, DOOR.x0 - 1, DOOR.y0 - 1, 2, 17);
    clr(S.e, DOOR.x1, DOOR.y0 - 1, 2, 17);
    clr(S.e, DOOR.x0, DOOR.y0 - 1, 13, 2);
  }

  /** the front layer of the hotel: canopy and planters */
  function bakeHotelFront(S) {
    const F = S.f;
    const p = S.p;
    const { x0, x1, y } = CANOPY;
    // a thin flat canopy: a bright metal lip, a dark fascia, the soffit catching the lobby light
    F.rect(x0, y, x1 - x0 + 1, 3, p.canopy);
    F.hline(x0, x1, y, p.canopyHi);
    F.px(x0, y + 1, p.canopyHi);
    F.hline(x0 + 1, x1, y + 2, S.night ? '#4a3220' : p.hDeep);
    F.hline(x0, x1, y - 1, p.hDeep);
    // slim tie rods to the facade
    F.line(x0 + 3, y - 1, x0 + 9, y - 6, p.hDeep);
    F.line(x1 - 3, y - 1, x1 - 9, y - 6, p.hDeep);
    // planters with clipped box balls either side of the door
    for (const px of [208, 238]) {
      F.rect(px, 200, 6, 6, p.planter);
      F.hline(px, px + 5, 200, p.planterHi);
      F.vline(px + 5, 201, 205, p.hDeep);
      F.circle(px + 3, 196, 2.6, p.box);
      F.px(px + 2, 194, p.boxHi);
      F.px(px + 1, 195, p.boxHi);
      F.px(px + 2, 195, p.boxHi);
      F.px(px + 4, 198, mix(p.box, p.hDeep, 0.5));
      F.px(px + 5, 197, mix(p.box, p.hDeep, 0.5));
    }
  }

  // ------------------------------------------------------------------
  // Lofts
  // ------------------------------------------------------------------
  /** a cast-iron front: pilasters, arched 2-over-2 sashes, belt courses, bracketed cornice */
  function castIron(S, B, pre, floors, seed, opts) {
    const g = S.b;
    const p = S.p;
    const c = { face: p[pre + 'face'], hi: p[pre + 'hi'], lo: p[pre + 'lo'], deep: p[pre + 'deep'] };
    const { x0, x1, top } = B;
    const w = x1 - x0 + 1;
    g.rect(x0, top, w, SH.cor - top, c.face);
    const pil = [];
    for (let px = x0; px <= x1; px += 16) pil.push(px);
    for (let fi = 0; fi < floors.length; fi++) {
      const yt = floors[fi];
      g.hline(x0, x1, yt, c.hi);
      g.hline(x0, x1, yt + 1, c.lo);
      for (let pi = 0; pi < pil.length; pi++) {
        const px = pil[pi];
        // pilaster with a capital
        g.rect(px, yt + 2, 3, 11, c.face);
        g.vline(px, yt + 2, yt + 12, c.hi);
        g.vline(px + 2, yt + 2, yt + 12, c.lo);
        g.hline(px - 1, px + 3, yt + 2, c.hi);
        g.hline(px - 1, px + 3, yt + 3, c.deep);
        g.px(px + 1, yt + 4, c.lo);
        // window bay
        const wx = px + 5;
        if (wx > x1) continue;
        const key = fi + ':' + pi;
        let st = 'dark';
        if (S.night) st = opts.dyn && opts.dyn.has(key) ? 'dyn' : opts.tv && opts.tv.has(key) ? 'tv' : pickState(hash(seed, fi, px, 2), opts.lit);
        // arch hood with a keystone
        g.hline(wx - 1, wx + 9, yt + 2, c.hi);
        g.rect(wx + 3, yt + 1, 3, 2, c.hi);
        g.px(wx + 4, yt + 1, c.face);
        windowAt(S, 'arch', wx, yt + 3, st, seed * 31 + fi * 7 + px, p.sash);
        // arch corners and the sill
        g.px(wx, yt + 3, c.face);
        g.px(wx + 8, yt + 3, c.face);
        g.px(wx - 1, yt + 3, c.lo);
        g.px(wx + 9, yt + 3, c.lo);
        g.hline(wx - 1, wx + 9, yt + 12, c.hi);
        g.px(wx - 1, yt + 12, c.lo);
        g.px(wx + 9, yt + 12, c.lo);
        if (fi < floors.length - 1) g.hline(wx, wx + 8, yt + 13, c.lo);
      }
    }
    // cornice: cap, corona with brackets over the pilasters and dentils, frieze
    const cx0 = Math.max(0, x0 - (opts.capL === undefined ? 2 : opts.capL));
    const cx1 = Math.min(W - 1, x1 + (opts.capR === undefined ? 2 : opts.capR));
    g.rect(cx0, top, cx1 - cx0 + 1, 2, c.lo);
    g.hline(cx0, cx1, top, c.hi);
    g.rect(cx0 + 1, top + 2, cx1 - cx0 - 1, 3, c.face);
    g.hline(cx0 + 1, cx1 - 1, top + 2, c.hi);
    g.hline(cx0 + 1, cx1 - 1, top + 4, c.lo);
    for (let x = x0; x <= x1; x += 2) g.px(x, top + 5, (x >> 1) & 1 ? c.hi : c.deep);
    g.hline(x0, x1, top + 6, c.face);
    g.hline(x0, x1, top + 7, c.face);
    g.hline(x0, x1, top + 8, c.deep);
    // blank name panel in the frieze (no lettering)
    const mid = (x0 + x1) >> 1;
    if (opts.panel) {
      g.rect(mid - 9, top + 6, 19, 2, c.lo);
      g.hline(mid - 9, mid + 9, top + 6, c.deep);
    }
    // console brackets over the pilasters
    for (const px of pil) {
      g.rect(px, top + 2, 3, 6, c.face);
      g.vline(px, top + 2, top + 7, c.hi);
      g.vline(px + 2, top + 2, top + 7, c.deep);
      g.px(px + 1, top + 7, c.lo);
    }
    // small modillions between
    for (let x = x0 + 8; x < x1 - 2; x += 16) {
      g.rect(x, top + 4, 2, 2, c.face);
      g.px(x + 1, top + 5, c.deep);
    }
    g.dither(x0, top + 9, w, 1, c.deep, 0.5);
    // shop cornice
    g.hline(x0, x1, SH.cor, c.hi);
    g.hline(x0, x1, SH.cor + 1, c.lo);
    return pil;
  }

  /** brick front with stone lintels and sills; windows at xs */
  function brickFront(S, B, mat, floors, xs, seed, opts) {
    const g = S.b;
    const p = S.p;
    const { x0, x1, top } = B;
    const bc = p[mat.brick];
    const mc = p[mat.mortar];
    const hc = p[mat.hi];
    g.rect(x0, top, x1 - x0 + 1, SH.cor - top, bc);
    for (let y = top; y < SH.cor; y++) {
      const course = Math.floor(y / 3);
      for (let x = x0; x <= x1; x++) {
        if (y % 3 === 2) {
          if ((x + y) % 4) g.px(x, y, mc);
        } else if ((x + (course % 2) * 3) % 6 === 0 && y % 3 === 0) g.px(x, y, mc);
        else if (hash(x, y, seed, 3) < 0.05) g.px(x, y, hc);
      }
    }
    for (let fi = 0; fi < floors.length; fi++) {
      const yt = floors[fi];
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const key = fi + ':' + i;
        let st = 'dark';
        if (S.night) st = opts.dyn && opts.dyn.has(key) ? 'dyn' : opts.tv && opts.tv.has(key) ? 'tv' : pickState(hash(seed, fi, i, 4), opts.lit);
        // stone lintel and sill
        g.rect(x - 1, yt + 1, 11, 2, p.lintel);
        g.hline(x - 1, x + 9, yt + 2, p.lintelLo);
        g.px(x - 1, yt + 1, p.lintelLo);
        g.px(x + 9, yt + 1, p.lintelLo);
        windowAt(S, 'rect', x, yt + 3, st, seed * 37 + fi * 11 + i, p.sash);
        g.hline(x - 1, x + 9, yt + 12, p.lintel);
        g.px(x + 9, yt + 12, p.lintelLo);
      }
    }
    // metal cornice with brackets
    const cx0 = Math.max(0, x0 - (opts.capL === undefined ? 2 : opts.capL));
    const cx1 = Math.min(W - 1, x1 + (opts.capR === undefined ? 2 : opts.capR));
    g.rect(cx0, top, cx1 - cx0 + 1, 5, p.cornice);
    g.hline(cx0, cx1, top, p.corniceHi);
    g.hline(cx0, cx1, top + 4, p.corniceLo);
    for (let x = x0 + 2; x < x1 - 1; x += 7) {
      g.rect(x, top + 1, 2, 4, p.corniceHi);
      g.px(x + 1, top + 4, p.corniceLo);
    }
    g.hline(x0, x1, top + 5, p.corniceLo);
    g.dither(x0, top + 6, x1 - x0 + 1, 1, p.corniceLo, 0.5);
    // shop cornice
    g.hline(x0, x1, SH.cor, p.corniceHi);
    g.hline(x0, x1, SH.cor + 1, p.corniceLo);
  }

  // ------------------------------------------------------------------
  // Shopfronts
  // ------------------------------------------------------------------
  /**
   * units: [{x0, x1, kind, awning, stripe, sign, door, mull, hue}] between
   * columns. kind is the display (dress, rack, shoes, flowers, cafe, books,
   * vases, bags) or 'res' (the loft's own street door). awning is a colour
   * name or absent (then a blank sign band shows). door: 'l' | 'r' | 'c'.
   */
  function shopfronts(S, units, colC, colHi) {
    const g = S.b;
    const p = S.p;
    for (const u of units) {
      const a = u.x0;
      const b = u.x1;
      if (u.kind === 'res') {
        // the loft's own street door: dark wood, a glazed transom
        g.rect(a, SH.sign0, b - a + 1, GY - SH.sign0, p.col);
        g.rect(a + 2, 190, b - a - 3, 16, p.door);
        g.vline(a + 2, 190, 205, p.doorHi);
        g.hline(a + 2, b - 2, 190, p.doorHi);
        const mid = (a + b) >> 1;
        g.vline(mid, 194, 205, p.col);
        g.rect(a + 4, 196, mid - a - 5, 4, p.doorHi);
        g.rect(mid + 2, 196, b - mid - 5, 4, p.doorHi);
        if (S.night) {
          S.e.rect(a + 2, 187, b - a - 3, 2, WARM[3]);
          S.e.hline(a + 2, b - 2, 187, WARM[4]);
        } else g.rect(a + 2, 187, b - a - 3, 2, p.dGlass);
        g.px(b - 4, 200, p.gold);
        continue;
      }
      const g0 = SH.glass0;
      const g1 = SH.glass1;
      const sc = p[u.sign || 'signBlack'];
      // sign band (blank: a painted board with a thin gilt line), frame, kick plate
      g.rect(a, SH.sign0, b - a + 1, 4, sc);
      g.hline(a, b, SH.sign0, mix(sc, p.gold, 0.25));
      g.hline(a + 2, b - 2, SH.sign0 + 1, mix(sc, p.gold, 0.6));
      g.hline(a + 2, b - 2, SH.sign1 - 1, mix(sc, p.gold, 0.35));
      g.hline(a, b, SH.sign1 + 1, p.col);
      g.rect(a, SH.kick0, b - a + 1, 3, p.kick);
      g.hline(a, b, SH.kick0, p.kickHi);
      // door position
      let da = -1;
      let db = -1;
      if (u.door) {
        const dw = 7;
        da = u.door === 'l' ? a + 1 : u.door === 'r' ? b - dw : ((a + b) >> 1) - 3;
        db = da + dw - 1;
      }
      // display glass
      if (S.night) {
        const E = S.e;
        E.rect(a, g0, b - a + 1, g1 - g0 + 1, SHOPC.wall);
        E.hline(a, b, g0, SHOPC.top);
        E.dither(a, g0 + 1, b - a + 1, 2, SHOPC.hot, 0.55);
        E.rect(a, g1 - 1, b - a + 1, 2, SHOPC.floor);
        E.hline(a, b, g1 - 2, SHOPC.shade);
        display(S, E, u, a, b, g0, g1, true);
      } else {
        g.rect(a, g0, b - a + 1, g1 - g0 + 1, p.dShop);
        g.hline(a, b, g0, p.dShopHi);
        display(S, g, u, a, b, g0, g1, false);
        sheen(g, a, g0, b, g1, p.dGlassHi, u.x0);
      }
      // the shop door, over the glass
      if (da >= 0) {
        g.rect(da, g0 - 1, db - da + 1, GY - g0 + 1, p.col);
        if (S.night) {
          S.e.rect(da + 1, g0, db - da - 1, 11, SHOPC.hot);
          S.e.hline(da + 1, db - 1, g0 + 6, SHOPC.shade);
          S.e.px(db - 2, g0 + 6, SHOPC.top);
          clr(S.e, da, g0 - 1, 1, GY - g0 + 1);
          clr(S.e, db, g0 - 1, 1, GY - g0 + 1);
          clr(S.e, da + 1, g0 + 11, db - da - 1, GY - g0 - 11);
        } else {
          g.rect(da + 1, g0, db - da - 1, 11, p.dShop);
          g.dither(da + 1, g0, db - da - 1, 11, p.dGlassHi, 0.3);
        }
        g.rect(da + 1, g0 + 11, db - da - 1, GY - g0 - 11, p.col);
        g.px(db - 2, g0 + 7, p.gold);
      }
      // thin mullions between panes
      if (u.mull)
        for (const m of u.mull) {
          g.vline(m, g0, g1, p.col);
          clr(S.e, m, g0, 1, g1 - g0 + 1);
        }
      if (u.awning) awning(S, a - 1, b + 1, u.awning, u.stripe);
      S.shops.push({ x0: a, x1: b, awn: !!u.awning });
    }
    // cast-iron columns between units (over the glass edges)
    for (const u of units) {
      for (const cxp of [u.x0 - 3, u.x1 + 1]) {
        if (cxp + 2 < 0 || cxp > W - 1) continue;
        g.rect(cxp, SH.cor + 2, 3, GY - SH.cor - 2, colC);
        g.vline(cxp, SH.cor + 2, GY - 1, colHi);
        g.hline(cxp - 1, cxp + 3, SH.sign1 + 1, colHi);
        g.hline(cxp - 1, cxp + 3, 204, colHi);
        g.hline(cxp - 1, cxp + 3, 205, colC);
        clr(S.e, cxp, SH.cor + 2, 3, GY - SH.cor - 2);
      }
    }
  }

  /** window displays: colourful goods in a warm-lit window */
  function display(S, E, u, a, b, g0, g1, lit) {
    // lit: emissive colours as they are; by day: true colours resolved for the fill
    const k = factor(S.lt);
    const L = lit ? (c) => c : (c) => scale(c, k);
    const P = GOODS.map(L);
    const dark = lit ? SHOPC.deep : S.p.dLobbyLo;
    const shade = L(SHOPC.shade);
    const white = L('#ffffff');
    const top = u.awning ? g0 + 3 : g0; // the awning valance covers the top rows
    const seed = u.x0 * 13;
    const C = (i) => P[(((i + (u.hue || 0)) % P.length) + P.length) % P.length];
    const fy = g1 - 2;
    if (u.kind === 'dress') {
      for (let m = a + 3, i = 0; m + 4 <= b; m += 8, i++) {
        // mannequin: head, a dress, a stand
        E.rect(m + 1, top + 1, 2, 2, L('#f0d8b8'));
        E.rect(m + 1, top + 3, 2, 1, C(i));
        E.rect(m, top + 4, 4, 2, C(i));
        E.rect(m - 1, top + 6, 6, 2, C(i));
        E.px(m - 1, top + 6, mix(C(i), dark, 0.4));
        E.vline(m + 2, top + 8, fy, dark);
        E.hline(m, m + 4, fy, dark);
      }
    } else if (u.kind === 'rack') {
      E.hline(a + 2, b - 2, top + 1, dark);
      E.vline(a + 2, top + 1, fy, dark);
      E.vline(b - 2, top + 1, fy, dark);
      for (let m = a + 3, i = 0; m < b - 2; m += 2, i++) {
        const ln = 5 + ((i * 7 + seed) % 3);
        E.rect(m, top + 2, 2, ln, C(i));
        E.px(m + 1, top + 2, mix(C(i), white, 0.25));
      }
    } else if (u.kind === 'shoes') {
      for (const sy of [top + 3, top + 7]) {
        E.hline(a + 1, b - 1, sy + 2, shade);
        for (let m = a + 2, i = 0; m + 2 < b; m += 4, i++) {
          E.rect(m, sy, 3, 2, C(i + sy));
          E.px(m, sy, mix(C(i + sy), white, 0.3));
        }
      }
    } else if (u.kind === 'flowers') {
      for (let m = a + 2, i = 0; m + 3 < b; m += 5, i++) {
        // buckets of bunches on tiers
        const by = fy - (i % 2 ? 4 : 2);
        E.rect(m, by, 3, 3, L('#7a8a94'));
        E.rect(m - 1, by - 3, 5, 3, L('#3e8a48'));
        E.px(m, by - 4, C(i * 3));
        E.px(m + 2, by - 4, C(i * 3 + 2));
        E.px(m + 1, by - 3, C(i * 3 + 1));
        E.px(m - 1, by - 3, C(i * 3 + 4));
        E.px(m + 3, by - 2, C(i * 3));
      }
    } else if (u.kind === 'cafe') {
      // pastry counter, little tables, a hanging bulb
      const cw = Math.min(14, b - a - 4);
      E.rect(a + 2, fy - 5, cw, 5, L('#c88a4a'));
      E.hline(a + 2, a + 1 + cw, fy - 5, L('#fff0c8'));
      for (let m = a + 3, i = 0; m < a + cw; m += 3, i++) E.px(m, fy - 4, C(i + 1));
      for (let m = a + 19; m + 4 < b; m += 8) {
        E.hline(m, m + 4, fy - 3, dark);
        E.vline(m + 2, fy - 2, fy, dark);
        E.px(m + 2, fy - 4, C(m));
      }
      E.vline(b - 12, top, top + 2, dark);
      E.px(b - 12, top + 3, L('#fffbe8'));
    } else if (u.kind === 'books') {
      for (const sy of [top + 1, top + 5]) {
        for (let m = a + 2, i = 0; m < b - 1; m++, i++) {
          if ((i * 5 + sy) % 11 === 0) continue;
          const hgt = 3 - ((i * 3) % 2);
          E.vline(m, sy + 3 - hgt, sy + 2, C(i * 2 + sy));
        }
        E.hline(a + 1, b - 1, sy + 3, shade);
      }
    } else if (u.kind === 'vases') {
      for (let m = a + 3, i = 0; m + 3 < b; m += 6, i++) {
        const ht = 3 + ((i * 2 + 1) % 3);
        E.rect(m - 1, fy - 1, 5, 2, dark);
        E.rect(m, fy - 1 - ht, 3, ht, C(i * 2 + 1));
        E.px(m + 1, fy - 2 - ht, C(i * 2 + 1));
        E.px(m, fy - 1 - ht, mix(C(i * 2 + 1), white, 0.35));
      }
      E.hline(a + 1, b - 1, top + 3, shade);
      for (let m = a + 4, i = 0; m + 1 < b; m += 5, i++) E.rect(m, top + 1, 2, 2, C(i + 4));
    } else if (u.kind === 'bags') {
      // handbags on two glass shelves
      for (const sy of [top + 3, top + 8]) {
        E.hline(a + 1, b - 1, sy + 3, shade);
        for (let m = a + 2, i = 0; m + 3 < b; m += 6, i++) {
          const c = C(i * 3 + sy);
          E.hline(m + 1, m + 2, sy - 1, c);
          E.px(m, sy, c);
          E.px(m + 3, sy, c);
          E.rect(m, sy + 1, 4, 2, c);
          E.px(m, sy + 1, mix(c, white, 0.35));
        }
      }
    }
  }

  function awning(S, a, b, col, stripe) {
    const F = S.f;
    const p = S.p;
    const c = p[col];
    const lo = p[col + 'Lo'];
    const y = SH.sign0;
    // sloped canopy (its top seen from the street), then a scalloped valance
    for (let r = 0; r < 5; r++) {
      const xa = a + Math.max(0, 2 - r);
      const xb = b - Math.max(0, 2 - r);
      for (let x = xa; x <= xb; x++) {
        let cc = r === 0 ? mix(c, p.white, 0.18) : r < 3 ? c : mix(c, lo, 0.35);
        if (stripe && Math.floor((x - a) / 3) % 2) cc = r === 0 ? p.awWhite : r < 3 ? mix(p.awWhite, p.awWhiteLo, 0.3) : p.awWhiteLo;
        F.px(x, y + r, cc);
      }
    }
    for (let x = a; x <= b; x++) {
      let cc = lo;
      if (stripe && Math.floor((x - a) / 3) % 2) cc = p.awWhiteLo;
      F.px(x, y + 5, cc);
      F.px(x, y + 6, cc);
      if ((x - a) % 3 !== 2) F.px(x, y + 7, cc);
    }
    // the iron arm at each end
    F.line(a, y + 7, a + 2, y + 3, p.iron);
    F.line(b, y + 7, b - 2, y + 3, p.iron);
  }

  // ------------------------------------------------------------------
  // Fire escapes, water tanks, roof clutter, window units
  // ------------------------------------------------------------------
  function fireEscape(S, x0, x1, floors, opts) {
    const F = S.f;
    const p = S.p;
    const ic = p.iron;
    const hi = p.ironHi;
    for (let i = 0; i < floors.length; i++) {
      const yt = floors[i];
      const py = yt + 12; // platform deck at the floor line
      // railing: top rail, balusters, deck with slats, end posts
      F.hline(x0, x1, py - 5, hi);
      for (let x = x0; x <= x1; x += 3) F.vline(x, py - 4, py - 1, ic);
      F.vline(x0, py - 5, py, ic);
      F.vline(x1, py - 5, py, ic);
      F.hline(x0, x1, py, ic);
      for (let x = x0; x <= x1; x += 2) F.px(x, py + 1, ic);
      // brackets under the deck
      F.line(x0 + 1, py + 1, x0 + 3, py + 3, ic);
      F.line(x1 - 1, py + 1, x1 - 3, py + 3, ic);
      // stair down to the next platform
      if (i < floors.length - 1) {
        const dir = i % 2 ? 1 : -1;
        const sx = dir > 0 ? x0 + 3 : x1 - 3;
        const ex = sx + dir * 15;
        const ny = floors[i + 1] + 12;
        for (let k = 0; k <= 12; k++) {
          const x = Math.round(sx + ((ex - sx) * k) / 12);
          const yy = py + 1 + k;
          if (yy >= ny) break;
          F.px(x, yy, ic);
          F.px(x + dir, yy, ic);
          if (k % 2 === 0) F.px(x - dir, yy, hi);
        }
        F.line(sx, py - 3, Math.round(sx + (ex - sx) * 0.8), ny - 4, ic); // handrail
      }
    }
    // drop ladder (retracted) under the lowest platform
    if (opts && opts.ladder !== undefined) {
      const lx = opts.ladder;
      const ly = floors[floors.length - 1] + 13;
      F.vline(lx, ly, ly + 7, ic);
      F.vline(lx + 3, ly, ly + 7, ic);
      for (let y = ly + 1; y <= ly + 7; y += 2) F.hline(lx, lx + 3, y, ic);
    }
    // gooseneck ladder to the roof from the top platform
    if (opts && opts.roof !== undefined) {
      const gx = opts.roof;
      const top = floors[0] + 7;
      F.vline(gx, opts.roofY, top, ic);
      F.vline(gx + 2, opts.roofY, top, ic);
      for (let y = opts.roofY + 1; y < top; y += 2) F.px(gx + 1, y, ic);
    }
  }

  /** a pot plant on a fire-escape deck at (x, deck y) */
  function potPlant(F, p, x, y, big) {
    F.rect(x, y - 2, 2, 2, p.pot);
    F.px(x - 1, y - 3, p.leaf);
    F.px(x, y - 3, p.leafHi);
    F.px(x + 1, y - 3, p.leaf);
    F.px(x + 2, y - 4, p.leaf);
    F.px(x, y - 4, p.leaf);
    if (big) {
      F.px(x + 1, y - 5, p.leafHi);
      F.px(x - 1, y - 5, p.leaf);
      F.px(x + 2, y - 3, p.leafHi);
    }
  }

  function waterTank(S, x, roofY, w, h) {
    const g = S.b;
    const p = S.p;
    const ic = p.iron;
    const tankBot = roofY - 12;
    const tankTop = tankBot - h + 1;
    // steel stand: legs, cross bracing, the beams under the tank
    const legs = [x + 1, x + Math.round(w / 3), x + Math.round((2 * w) / 3) - 1, x + w - 2];
    for (const lx of legs) g.vline(lx, tankBot + 1, roofY - 1, ic);
    g.line(legs[0], tankBot + 3, legs[1], roofY - 2, ic);
    g.line(legs[1], tankBot + 3, legs[0], roofY - 2, ic);
    g.line(legs[2], tankBot + 3, legs[3], roofY - 2, ic);
    g.line(legs[3], tankBot + 3, legs[2], roofY - 2, ic);
    g.hline(x - 1, x + w, tankBot + 1, ic);
    g.hline(x - 1, x + w, tankBot + 2, p.ironHi);
    g.hline(legs[0], legs[3], roofY - 6, ic);
    // the wooden barrel: staves, rounded shading, steel hoops
    g.rect(x, tankTop, w, h, p.wood);
    for (let xx = x + 3; xx < x + w - 2; xx += 2) g.vline(xx, tankTop, tankBot, mix(p.wood, p.woodLo, 0.35));
    g.vline(x, tankTop, tankBot, p.woodLo);
    g.vline(x + 1, tankTop, tankBot, p.woodHi);
    g.vline(x + 2, tankTop, tankBot, p.woodHi);
    g.vline(x + w - 2, tankTop, tankBot, p.woodLo);
    g.vline(x + w - 1, tankTop, tankBot, mix(p.woodLo, p.hoop, 0.5));
    for (let y = tankTop + 2; y < tankBot; y += 3) g.hline(x, x + w - 1, y, p.hoop);
    // conical roof with a finial
    let r = 0;
    for (let ww = w + 2; ww >= 2; ww -= 2, r++) {
      const xa = x - 1 + (w + 2 - ww) / 2;
      g.hline(xa, xa + ww - 1, tankTop - 1 - r, r % 2 ? p.shingle : p.shingleHi);
      g.px(xa, tankTop - 1 - r, p.shingleHi);
      g.px(xa + ww - 1, tankTop - 1 - r, mix(p.shingle, p.hoop, 0.5));
    }
    const apex = tankTop - 1 - r;
    const cx = x + Math.floor(w / 2) - 1;
    g.px(cx, apex, p.hoop);
    g.px(cx, apex - 1, p.hoop);
    // the ladder up its side
    g.vline(x + w + 1, tankTop + 1, roofY - 1, ic);
    for (let y = tankTop + 2; y < roofY; y += 2) g.px(x + w, y, ic);
    return apex - 1;
  }

  function acUnit(F, p, x, y) {
    F.rect(x, y, 5, 3, p.ac);
    F.hline(x, x + 4, y, mix(p.ac, p.white, 0.2));
    F.px(x + 1, y + 1, p.acLo);
    F.px(x + 3, y + 1, p.acLo);
    F.hline(x, x + 4, y + 3, p.acLo);
  }

  function flowerBox(F, p, x, y, w, seed) {
    F.rect(x, y, w, 2, p.pot);
    for (let k = 0; k < w; k++) {
      F.px(x + k, y - 1, k % 2 ? p.leaf : p.leafHi);
      if (hash(seed, k, 1, 1) < 0.45) F.px(x + k, y - 2, GOODS[(seed + k) % GOODS.length]);
    }
  }

  // ------------------------------------------------------------------
  // The whole block
  // ------------------------------------------------------------------
  const DYN_CI1 = new Set(['1:2', '3:5']);
  const TV_CI1 = new Set(['2:4']);
  const DYN_RB = new Set(['0:4', '2:1', '4:3']);
  const TV_RB = new Set(['1:0']);
  const DYN_CI2 = new Set(['1:1', '3:3']);
  const TV_CI2 = new Set(['0:4']);

  function bakeBlock(S) {
    const g = S.b;
    const p = S.p;
    const F = S.f;

    // ---- far left: dark brick loft (cut by the frame), with a water tank
    brickFront(S, BL, { brick: 'dbrick', mortar: 'dmortar', hi: 'dbrickHi' }, BR_FLOORS, [4, 20], 11, { lit: 0.36, capL: 0, capR: 1 });
    waterTank(S, 3, BL.top, 13, 11);
    g.rect(24, 104, 7, 8, p.roof); // stair bulkhead
    g.hline(24, 30, 104, p.roofHi);
    g.rect(26, 107, 3, 5, p.tar);
    shopfronts(S, [{ x0: 3, x1: 32, kind: 'rack', awning: 'awBlack', hue: 6, door: 'r' }], p.col, p.colHi);

    // ---- cream cast-iron loft (fire escape, flag)
    castIron(S, CI1, 'c1', CI_FLOORS, 31, { lit: 0.36, dyn: DYN_CI1, tv: TV_CI1, panel: true, capL: 0 });
    // roof: a skylight and a chimney stack
    g.rect(60, 120, 12, 4, p.roof);
    g.hline(61, 70, 119, p.roofHi);
    g.dither(61, 120, 10, 3, p.dGlassLo, 0.5);
    g.rect(138, 116, 5, 8, p.dbrick);
    g.hline(137, 143, 116, p.corniceHi);
    g.rect(118, 121, 3, 3, p.tar);
    g.px(119, 119, p.tar);
    g.px(119, 120, p.tar);
    shopfronts(
      S,
      [
        { x0: 39, x1: 83, kind: 'dress', awning: 'awRed', door: 'l', hue: 0, mull: [61] },
        { x0: 87, x1: 115, kind: 'shoes', sign: 'signNavy', door: 'r', hue: 2 },
        { x0: 119, x1: 131, kind: 'res' },
        { x0: 135, x1: 147, kind: 'vases', sign: 'signOx', hue: 5 },
      ],
      p.c1lo,
      p.c1hi
    );

    // ---- low painted loft with a roof terrace
    brickFront(S, PL, { brick: 'paint', mortar: 'paintLo', hi: 'paintHi' }, PL_FLOORS, [157, 169, 181], 41, { lit: 0.45, capR: 0, capL: 1, dyn: new Set(['1:2']) });
    g.hline(152, 192, 133, p.iron);
    for (let x = 152; x <= 192; x += 4) g.vline(x, 134, 137, p.iron);
    g.vline(155, 126, 137, p.woodLo);
    g.vline(188, 126, 137, p.woodLo);
    g.hline(154, 189, 126, p.woodLo);
    for (const tx of [160, 181]) {
      g.rect(tx - 1, 134, 4, 4, p.pot);
      g.circle(tx + 1, 130, 3, p.leaf);
      g.px(tx, 128, p.leafHi);
      g.px(tx + 1, 129, p.leafHi);
    }
    shopfronts(S, [{ x0: 154, x1: 190, kind: 'cafe', awning: 'awNavy', stripe: true, door: 'r', hue: 1 }], p.col, p.colHi);

    // ---- the hotel
    bakeHotel(S);

    // ---- red-brick loft with the big water tank and a fire escape
    brickFront(S, RB, { brick: 'brick', mortar: 'mortar', hi: 'brickHi' }, BR_FLOORS, [285, 307, 329, 351, 373], 53, { lit: 0.36, dyn: DYN_RB, tv: TV_RB, capL: 0 });
    waterTank(S, 360, RB.top, 18, 16);
    g.rect(292, 103, 15, 10, p.roof);
    g.hline(292, 306, 103, p.roofHi);
    g.rect(296, 106, 4, 7, p.tar);
    g.vline(296, 106, 112, p.roofHi);
    g.rect(382, 104, 4, 9, p.dbrick);
    g.hline(381, 386, 104, p.corniceHi);
    g.vline(318, 107, 112, p.iron);
    g.px(317, 107, p.iron);
    shopfronts(
      S,
      [
        { x0: 282, x1: 316, kind: 'flowers', awning: 'awGreen', door: 'r', hue: 0 },
        { x0: 320, x1: 334, kind: 'res' },
        { x0: 338, x1: 388, kind: 'dress', awning: 'awPlum', stripe: true, door: 'l', hue: 3, mull: [364] },
      ],
      p.col,
      p.colHi
    );

    // ---- sage cast-iron loft
    castIron(S, CI2, 'c2', CI_FLOORS, 61, { lit: 0.34, dyn: DYN_CI2, tv: TV_CI2, panel: true, capR: 0 });
    g.rect(420, 119, 13, 5, p.roof);
    g.hline(420, 432, 119, p.roofHi);
    g.rect(423, 120, 3, 3, p.tar);
    g.rect(428, 120, 3, 3, p.tar);
    g.rect(452, 116, 4, 8, p.dbrick);
    g.hline(451, 456, 116, p.corniceHi);
    shopfronts(
      S,
      [
        { x0: 395, x1: 439, kind: 'books', awning: 'awBlack', door: 'c', hue: 4, mull: [409, 425] },
        { x0: 443, x1: 455, kind: 'res' },
        { x0: 459, x1: 479, kind: 'bags', sign: 'signGreen', hue: 7 },
      ],
      p.c2lo,
      p.c2hi
    );

    // ---- front layer: fire escapes, window units, flower boxes, the hotel canopy
    fireEscape(S, 100, 146, CI_FLOORS, { ladder: 139, roof: 141, roofY: 125 });
    fireEscape(S, 302, 344, BR_FLOORS, { ladder: 339 });
    potPlant(F, p, 104, 145, true);
    potPlant(F, p, 140, 158, false);
    potPlant(F, p, 133, 171, true);
    potPlant(F, p, 306, 145, true);
    potPlant(F, p, 337, 171, false);
    for (const [x, y] of [
      [59, 154],
      [75, 180],
      [287, 141],
      [375, 167],
      [353, 128],
      [415, 141],
      [463, 180],
      [6, 154],
      [159, 167],
    ])
      acUnit(F, p, x, y);
    flowerBox(F, p, 428, 158, 11, 3);
    flowerBox(F, p, 444, 171, 11, 5);
    flowerBox(F, p, 71, 145, 11, 7);
    flowerBox(F, p, 371, 132, 11, 9);
    // flag bracket on the cream loft (the flag itself waves per frame)
    F.line(FLAG.bx, FLAG.by, FLAG.px, FLAG.py, p.pole);
    F.px(FLAG.bx + 1, FLAG.by, p.iron);
    F.px(FLAG.bx + 1, FLAG.by + 1, p.iron);
    F.px(FLAG.px - 1, FLAG.py - 1, p.gold);
    bakeHotelFront(S);
  }

  // ------------------------------------------------------------------
  // Flag: a US flag (pixel scale) on an angled pole, flying to the left
  // ------------------------------------------------------------------
  function drawFlag(g, t, p) {
    const ts = T.step(t, 8);
    const br = HD.summer ? HD.summer.breeze(ts) : 0;
    const amp = 0.6 + 0.5 * Math.abs(br);
    const ph = T.phase(ts, 1.6);
    const hx = FLAG.px; // hoist at the pole tip
    const y0 = FLAG.py;
    for (let c = 0; c < FLAG.w; c++) {
      const x = hx - c;
      const s = Math.sin(T.TAU * (ph - c / 9));
      const dy = c < 2 ? 0 : Math.round(amp * s * Math.min(1, c / 6));
      const shade = s > 0.5 && c > 4;
      for (let r = 0; r < FLAG.h; r++) {
        let col = r % 2 ? p.flagWhite : p.flagRed;
        if (c < 5 && r < 4) {
          // blue canton at the hoist with white stars
          col = p.flagBlue;
          if ((r === 0 || r === 2) && (c === 1 || c === 3)) col = p.flagWhite;
          if (r === 1 && (c === 2 || c === 4)) col = p.flagWhite;
        }
        if (shade) col = mix(col, '#000000', 0.2);
        g.px(x, y0 + r + dy, col);
      }
    }
  }

  /**
   * At night the street lights the lofts from below: their upper storeys and
   * roofs sink a little into the dark (banded, ordered-dithered; the hotel
   * keeps its own values, its crown is uplit).
   */
  function nightFalloff(canvas) {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, W, GY);
    const d = img.data;
    for (let y = 60; y < 176; y++) {
      const f = Math.min(1, Math.max(0, (y - 104) / 70)); // 0 at the roofs .. 1 low down
      for (let x = 0; x < W; x++) {
        if (x >= HT.x0 && x <= HT.x1) continue;
        const q = d[(y * W + x) * 4 + 3];
        if (!q) continue;
        const lv = Math.floor(f * 3 + bayer(x, y)) / 3; // 0, 1/3, 2/3, 1
        const k = 0.8 + 0.2 * Math.min(1, lv);
        if (k >= 1) continue;
        const i = (y * W + x) * 4;
        d[i] *= k;
        d[i + 1] *= k;
        d[i + 2] *= k * 1.04;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------------
  // Baking per edition (and light mode)
  // ------------------------------------------------------------------
  function bakeAll() {
    const lt = HD.light();
    const night = lt.day < 0.5; // night and dusk: lit windows
    let gB = null;
    let gE = null;
    let gF = null;
    const base = HD.bake(W, GY, (g) => (gB = g));
    const em = night ? HD.bake(W, GY, (g) => (gE = g)) : null;
    const front = HD.bake(W, GY + 8, (g) => (gF = g));
    const S = { b: gB, e: gE, f: gF, p: resolver(lt), night, golden: lt.mode === 'golden', lt, dyn: [], tvs: [], shops: [], darkBays: [] };
    bakeBlock(S);
    if (night) nightFalloff(base);
    return { base, em, front, S };
  }
  const cache = new Map();
  function art() {
    const ed = HD.edition;
    const key = ed.id + '|' + (ed.light || 'night');
    let v = cache.get(key);
    if (!v) {
      v = bakeAll();
      cache.set(key, v);
    }
    return v;
  }

  // ------------------------------------------------------------------
  // Per-frame animation
  // ------------------------------------------------------------------
  /** a dynamic window is lit at t (switches a couple of times per loop) */
  function dynOn(t, seed) {
    return T.noise(t, 46, seed) > 0.47;
  }

  function drawDynamic(g, t, A) {
    const S = A.S;
    for (const d of S.dyn) if (dynOn(t, d.seed)) g.em.sprite(d.spr, d.x, d.y);
    // TVs: a cold flicker
    const ts = T.step(t, 6);
    for (const v of S.tvs) {
      const [w, h] = SHAPES[v.shape];
      const n = T.noise(ts, 0.8, v.seed);
      const n2 = T.noise(ts, 2.3, v.seed + 9);
      const e = g.em;
      const ac = v.shape === 'arch' ? 1 : 0; // keep the arch corners
      e.hline(v.x + ac, v.x + w - 1 - ac, v.y, TVC[n > 0.62 ? 2 : 1]);
      e.rect(v.x, v.y + 1, w, h - 1, TVC[n > 0.62 ? 2 : 1]);
      e.hline(v.x, v.x + w - 1, v.y + h - 1, TVC[0]);
      const px = v.x + 1 + Math.floor(n2 * (w - 3));
      e.rect(px, v.y + 1, 2, Math.max(1, h - 3), TVC[n > 0.4 ? 3 : 2]);
      if (n > 0.8) e.px(px, v.y + 1, TVC[4]);
      bars(g, v.shape, v.x, v.y, v.barC);
    }
  }

  /** the revolving door: four glass wings turning slowly */
  function drawDoor(g, t, A) {
    const S = A.S;
    const p = S.p;
    const ts = T.step(t, 8);
    const ang = T.phase(ts, 15) * T.TAU;
    const cx = DOOR.cx;
    const e = S.night ? g.em : g;
    const back = S.night ? LOBC.wall : p.dLobby;
    const front = S.night ? LOBC.slab : p.mull;
    const wings = [];
    for (let k = 0; k < 4; k++) {
      const a = ang + (k * Math.PI) / 2;
      wings.push({ x: Math.round(cx + 5.4 * Math.sin(a)), near: Math.cos(a) > 0 });
    }
    for (const wv of wings) if (!wv.near) e.vline(wv.x, DOOR.y0 + 2, 203, back);
    g.vline(cx, DOOR.y0 + 1, 204, front);
    for (const wv of wings)
      if (wv.near) {
        g.vline(wv.x, DOOR.y0 + 1, 204, front);
        g.px(wv.x, DOOR.y0 + 8, S.night ? LOBC.woodHi : p.alu);
      }
  }

  /** the heart lamp in their room: a slow warm pulse */
  // the heart lamp: a glowing heart-shaped shade (e edge, h glow, H hot core)
  const HEART_ROWS = ['ee.ee', 'ehHhe', '.ehe.', '..e..'];
  function drawHeart(g, t, A) {
    const S = A.S;
    const x = BAY.x0 + 10;
    const y = floorY(THEIR_FLOOR) + 2;
    const k = 0.5 + 0.5 * T.wave(t, 6.4);
    const e = S.night ? g.em : g;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        const ch = HEART_ROWS[r][c];
        if (ch === '.') continue;
        let col;
        if (!S.night) col = ch === 'e' ? S.p.awRedLo : S.p.awRed;
        else if (ch === 'e') col = HEART[1];
        else if (ch === 'h') col = k > 0.3 ? HEART[2] : HEART[1];
        else col = k > 0.55 ? HEART[3] : HEART[2];
        e.px(x + c, y + r, col);
      }
    }
  }

  /** firework glints in the dark glass bays (from the sky lights of this frame) */
  function drawGlints(g, t, A) {
    const S = A.S;
    if (!S.night) return;
    const list = HD.lights.list;
    let bursts = null;
    for (const l of list) {
      if (l.src === ID || !(l.y < 150) || (l.r || 0) < 14) continue;
      (bursts || (bursts = [])).push(l);
    }
    if (!bursts) return;
    for (const f of S.darkBays) {
      const y0 = floorY(f) + 1;
      const cy = y0 + 3;
      let r = 0;
      let gg = 0;
      let b = 0;
      for (const l of bursts) {
        const dx = l.x - 262;
        const dy = l.y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const k = (l.i || 0) * Math.max(0, 1 - d / Math.max(60, l.r * 1.3));
        const c = l.color || [1, 0.7, 0.4];
        r += c[0] * k;
        gg += c[1] * k;
        b += c[2] * k;
      }
      const s = Math.max(r, gg, b);
      if (s < 0.02) continue;
      const q = Math.floor(Math.min(1, s * 10) * 3 + bayer(f, 3)) / 3;
      if (q <= 0) continue;
      const col = CO.css(46 + ((200 * r) / s - 46) * q * 0.75, 72 + ((200 * gg) / s - 72) * q * 0.75, 120 + ((220 * b) / s - 120) * q * 0.75);
      const off = 2 + Math.floor(hash(2000 + f, 5, 1, 9) * 10);
      for (let k = 0; k < 7; k++) {
        for (const xx of [BAY.x0 + off + k, BAY.x0 + off + k + 1]) {
          if (xx === BAY.x0 + 8 || xx === BAY.x0 + 16 || xx > BAY.x1) continue;
          g.em.px(xx, y0 + 6 - k, col);
        }
      }
      if (q > 0.6) for (let x = BAY.x0; x <= BAY.x1; x += 2) if (x !== BAY.x0 + 8 && x !== BAY.x0 + 16) g.em.px(x, y0, col);
    }
  }

  // fairy lights along the red-brick fire escape and the roof terrace pergola
  const FAIRY = [
    { pts: [302, 135, 344, 135], sag: 1, n: 14, seed: 5 },
    { pts: [155, 127, 188, 127], sag: 3, n: 11, seed: 9 },
  ];
  const BULB = ['#fff0c0', '#ffd27a', '#ffb860'];
  function drawFairy(g, t) {
    for (const s of FAIRY) {
      const [x0, y0, x1, y1] = s.pts;
      for (let i = 0; i < s.n; i++) {
        const u = (i + 0.5) / s.n;
        const x = Math.round(x0 + (x1 - x0) * u);
        const y = Math.round(y0 + (y1 - y0) * u + s.sag * 4 * u * (1 - u));
        const tw = T.noise(t, 2.6, s.seed * 100 + i);
        g.em.px(x, y, tw > 0.62 ? BULB[0] : tw > 0.3 ? BULB[1] : BULB[2]);
      }
    }
  }

  function drawAviation(g, t) {
    const on = T.phase(t, 2.5) < 0.42;
    g.em.px(245, 21, on ? '#ff4a3a' : '#5a1814');
    g.em.px(246, 21, on ? '#ff6a52' : '#5a1814');
  }

  function drawDownlights(g) {
    for (let x = CANOPY.x0 + 3; x < CANOPY.x1; x += 6) g.em.px(x, CANOPY.y + 3, '#fff2cc');
  }

  // ------------------------------------------------------------------
  // Pass and lights
  // ------------------------------------------------------------------
  function here() {
    const pl = HD.place && HD.place();
    return !!pl && pl.id === ID;
  }

  function draw(g, t) {
    if (!here()) return;
    const A = art();
    const S = A.S;
    g.sprite(A.base, 0, 0);
    if (A.em) g.em.sprite(A.em, 0, 0);
    if (S.night) drawDynamic(g, t, A);
    drawHeart(g, t, A);
    drawDoor(g, t, A);
    drawGlints(g, t, A);
    g.sprite(A.front, 0, 0);
    drawFlag(g, t, S.p);
    if (S.night) {
      drawFairy(g, t);
      drawDownlights(g);
    }
    drawAviation(g, t);
  }

  const LT = {
    shop: [1.0, 0.7, 0.38],
    lobby: [1.0, 0.72, 0.42],
    pink: [1.0, 0.42, 0.62],
    crown: [0.6, 0.72, 1.0],
    flag: [1.0, 0.92, 0.8],
    red: [1.0, 0.18, 0.12],
    fairy: [1.0, 0.75, 0.4],
  };

  function lights(t, L) {
    if (!here()) return;
    const S = art().S;
    const nightish = S.lt.day < 0.5;
    // the lobby: a warm pool on the sidewalk, the canopy and the planters
    L.add({ src: ID, x: 241, y: 205, r: 50, ry: 20, color: LT.lobby, i: nightish ? 0.95 : 0.5, clip: { x0: 150, y0: 183, x1: 330, y1: 269 } });
    if (!nightish) return;
    // shop windows spill onto the columns, awnings and the sidewalk
    for (const s of S.shops) {
      const w = s.x1 - s.x0 + 1;
      L.add({ src: ID, x: (s.x0 + s.x1) >> 1, y: 203, r: Math.round(w * 0.62 + 8), ry: 21, color: LT.shop, i: 0.62, clip: { x0: 0, y0: 174, x1: 479, y1: 269 } });
    }
    // their room: a soft pink breath on the frames around it
    const k = 0.5 + 0.5 * T.wave(t, 6.4);
    L.add({ src: ID, x: BAY.x0 + 12, y: floorY(THEIR_FLOOR) + 4, r: 13, ry: 9, color: LT.pink, i: 0.55 + 0.2 * k, bands: 4 });
    // crown uplights washing the deco tiers
    L.add({ src: ID, x: 236, y: 32, r: 46, ry: 10, color: LT.crown, i: 0.5, bands: 3, dither: 0.25, clip: { x0: 194, y0: 18, x1: 278, y1: 33 } });
    // the flag is lit at night
    L.add({ src: ID, x: FLAG.px - 6, y: FLAG.py + 4, r: 11, ry: 8, color: LT.flag, i: 0.85, bands: 3 });
    // fairy lights
    L.add({ src: ID, x: 323, y: 136, r: 24, ry: 9, color: LT.fairy, i: 0.32, bands: 3 });
    L.add({ src: ID, x: 171, y: 129, r: 20, ry: 9, color: LT.fairy, i: 0.32, bands: 3 });
    // the aviation light
    if (T.phase(t, 2.5) < 0.42) L.add({ src: ID, x: 245, y: 21, r: 4, color: LT.red, i: 0.8, bands: 2, halo: { r: 5, a: 0.3 } });
  }

  // ------------------------------------------------------------------
  // Init: skyline, rain ledges and drip points for the other modules
  // ------------------------------------------------------------------
  function init() {
    const place = HD.PLACES && HD.PLACES[ID];
    if (!place) return;
    // bake once (geometry is the same in every light) to read the silhouette
    let gB = null;
    let gF = null;
    const base = HD.bake(W, GY, (g) => (gB = g));
    HD.bake(W, GY + 8, (g) => (gF = g));
    const S = { b: gB, e: null, f: gF, p: resolver(null), night: false, golden: false, lt: null, dyn: [], tvs: [], shops: [], darkBays: [] };
    bakeBlock(S);
    const d = base.getContext('2d').getImageData(0, 0, W, GY).data;
    const sky = new Int16Array(W);
    for (let x = 0; x < W; x++) {
      let top = 999;
      for (let y = 0; y < GY; y++) {
        if (d[(y * W + x) * 4 + 3] > 0) {
          top = y;
          break;
        }
      }
      sky[x] = top;
    }
    sky[245] = Math.min(sky[245], 21); // the aviation light on the fin
    sky[246] = Math.min(sky[246], 21);
    place.skyline = sky;

    const surfaces = [
      [BL.x0, BL.top, BL.x1 + 1, BL.top],
      [CI1.x0, CI1.top, CI1.x1 + 2, CI1.top],
      [PL.x0 - 1, PL.top, PL.x1, PL.top],
      [194, 30, 198, 30],
      [199, 27, 204, 27],
      [205, 25, 210, 25],
      [228, 25, 233, 25],
      [234, 27, 242, 27],
      [249, 30, 250, 30],
      [251, 27, 255, 27],
      [256, 25, 268, 25],
      [269, 27, 273, 27],
      [274, 30, 278, 30],
      [CANOPY.x0, CANOPY.y, CANOPY.x1, CANOPY.y],
      [RB.x0, RB.top, RB.x1 + 2, RB.top],
      [CI2.x0 - 2, CI2.top, CI2.x1, CI2.top],
      [292, 103, 306, 103],
      [100, 145, 146, 145],
      [100, 158, 146, 158],
      [100, 171, 146, 171],
      [302, 132, 344, 132],
      [302, 145, 344, 145],
      [302, 158, 344, 158],
      [302, 171, 344, 171],
    ];
    for (const s of S.shops) if (s.awn) surfaces.push([s.x0, SH.sign0, s.x1, SH.sign0]);
    place.surfaces = surfaces;

    const drips = [];
    for (let x = CANOPY.x0 + 2; x < CANOPY.x1; x += 7) drips.push({ x, y: CANOPY.y + 3 });
    for (const s of S.shops) if (s.awn) for (let x = s.x0 + 3; x < s.x1; x += 9) drips.push({ x, y: SH.sign0 + 8 });
    drips.push({ x: CI1.x1 + 2, y: CI1.top + 2 }, { x: PL.x0 - 1, y: PL.top + 5 }, { x: RB.x0 - 1, y: RB.top + 5 }, { x: CI2.x0 - 2, y: CI2.top + 2 });
    place.drips = drips;
  }

  HD.module('building-soho', {
    init,
    lights,
    passes: [{ layer: 'scene', z: 27, id: 'block', draw }],
  });
})();
