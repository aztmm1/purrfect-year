/*
 * building-apt2 (Purrfect Year v2): apartment 2, the second Boston building,
 * used from September 2026 (Harvest at golden hour, Halloween on a cold
 * rainy night).
 *
 * A long, low eight-storey block on the street stage (x 138..338, base y 206):
 *   - a white-panel corner tower on the left with a slate-blue accent column
 *   - a narrow slate-blue stair strip
 *   - the rust terra-cotta bay: horizontal lap panels with the windows stacked
 *     in narrow charcoal bands; his ONE window (place.catWindow) is a feature
 *     window in a dark box surround, the warmest window, the series cat in it
 *   - a charcoal-brick bay
 *   - the charcoal gateway corner, the highest point: a thin orange edge, a
 *     white frame of big windows, a plain blade fin and a glowing glass lobby
 *     under a canopy with a warm soffit
 *   - a light-grey top-floor band under a flat roof with dark coping
 *   - a two-storey grey-brick podium: warm shops, a bike room, a railed terrace
 *
 * Static art is baked once per edition (a plain layer and an emissive layer);
 * per frame only his window, a few living windows and the lights are drawn.
 * Night colours are painted as seen under the cold ambient. For golden hour
 * and day the intended sunlit colours are divided by the engine's daylight
 * gain at bake time, so the relit result lands exactly on them.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const CL = HD.color;
  const PL = HD.PLACES.apt2;
  const here = () => HD.place() === PL;

  // ------------------------------------------------------------------
  // Layout (art px, inclusive ranges)
  // ------------------------------------------------------------------
  const BASE = 206; // sidewalk line
  const POD = 166; // podium top (terrace level)
  const FT = [0, 184, 166, 148, 130, 112, 94, 76, 58]; // top y of floors L1..L8
  const TW = { x0: 138, x1: 175, top: 50 }; // white corner tower
  const ST = { x0: 176, x1: 181, top: 55 }; // slate stair strip
  const TC = { x0: 182, x1: 262 }; // terra cotta bay
  const BK = { x0: 263, x1: 299 }; // charcoal brick bay
  const GW = { x0: 300, x1: 338, top: 44 }; // gateway corner
  const ROOF = 57; // field coping top
  const STRIPES = [194, 212, 230, 248]; // centres of the charcoal window bands
  const CW = PL.catWindow; // his window glass (x 205..219, y 131..146)
  const BOX = { x0: CW.x - 2, y0: CW.y - 2, x1: CW.x + CW.w + 1, y1: CW.y + CW.h + 1 };
  const LOBBY = { x0: 302, x1: 336, y0: 169, y1: 205 };
  const SHOPS = [
    { x0: 141, x1: 172, kind: 'cafe' },
    { x0: 188, x1: 200, kind: 'florist' },
    { x0: 206, x1: 218, kind: 'bakery' },
    { x0: 224, x1: 236, kind: 'books' },
    { x0: 242, x1: 254, kind: 'grocer' },
  ];
  const SHOP_Y0 = 187;
  const BIKE = { x0: 266, x1: 290, y0: 188, y1: 205 };

  // bake box (everything the module draws lies inside it)
  const BX = 128;
  const BY = 38;
  const BW = 220;
  const BH = 170;

  // ------------------------------------------------------------------
  // Windows (static geometry; states are chosen per edition)
  // ------------------------------------------------------------------
  const WINS = [];
  function addWin(x, y, w, h, kind, bay, f) {
    WINS.push({ x, y, w, h, kind, bay, f, i: WINS.length });
  }
  for (let f = 3; f <= 8; f++) {
    addWin(143, FT[f] + 4, 5, 11, 'std', 'slate', f);
    addWin(161, FT[f] + 4, 5, 11, 'std', 'tower', f);
  }
  for (let f = 2; f <= 8; f++) addWin(177, FT[f] + 8, 4, 6, 'stair', 'stair', f);
  for (let f = 3; f <= 7; f++) for (const c of STRIPES) if (!(f === 4 && c === 212)) addWin(c - 2, FT[f] + 4, 5, 11, 'std', 'tc', f);
  for (let x = 185; x <= 257; x += 9) addWin(x - 2, FT[8] + 4, 5, 11, 'std', 'top', 8);
  for (let f = 3; f <= 8; f++) for (const x of [269, 279, 289]) addWin(x, FT[f] + 4, 5, 11, 'std', f >= 7 ? 'top' : 'brick', f);
  for (let f = 3; f <= 8; f++) for (const x of [309, 317, 325]) addWin(x, FT[f] + 2, 7, 14, 'big', 'gate', f);
  for (const x of [143, 161]) addWin(x, 170, 5, 10, 'film', 'pod', 2);
  for (const c of STRIPES) addWin(c - 2, 170, 5, 10, 'film', 'pod', 2);

  // ------------------------------------------------------------------
  // Palettes
  // ------------------------------------------------------------------
  // night: as seen under the cold ambient (lights warm them up)
  const NIGHT = {
    cap: '#12141b', capHi: '#262b38', frame: '#0a0c13', frameHi: '#1a1e28',
    tc: '#783a29', tcLn: '#653024', tcHi: '#7f3f2c', tcDk: '#5a2a1f',
    ch: '#262932', chHi: '#30343e', chDk: '#1e2128',
    wh: '#687187', wh2: '#646d83', whLn: '#596277', whHi: '#757d93', whDk: '#4d556a',
    gr: '#5a6174', gr2: '#575e71', grLn: '#4d5466', grHi: '#666d80',
    sl: '#2f4459', sl2: '#2c4054', slHi: '#3b5168', slDk: '#25374a',
    bk: '#23252c', bk2: '#2a2c34', bkLn: '#1b1d23', bkHi: '#30323b',
    pod: '#3c404a', pod2: '#424651', podLn: '#32353e', podHi: '#4c515d', podDk: '#2a2d35',
    or: '#c4642a', orDk: '#7e3d1c',
    gD: '#111725', gM: '#161e30', gHi: '#243049', gHi2: '#2f3c5a', gLo: '#0d121d',
    film: '#1b2130', filmHi: '#252c3c', cur: '#232838', curLn: '#1a1e2b',
    fin: '#0f1117', finHi: '#252a33', finL: '#252a33', finR: '#0c0e13',
    rail: '#090b10', railHi: '#22262f',
    louv: '#252831', louvHi: '#2f333d',
    roofU: '#14161d', roofUHi: '#1d2028',
    door: '#1a1d25', doorHi: '#262a34',
    box: '#2a2d36', boxHi: '#3a3e49', boxDk: '#1b1e25', sill: '#4a4f5b', sillHi: '#5b6170',
    pump: '#73331f', pumpHi: '#934426', pumpLn: '#55251a', stem: '#384c30',
    mc: '#5c3a1c', mcHi: '#7a5226', plate: '#6a6e7a', edge: '#3a4560', reveal: '#1a1e28',
    awnA: '#1f3b3a', awnB: '#5d5f63', awnC: '#4a1f22', awnHi: '#33363f',
  };
  // golden hour: the intended sunlit colours (converted to paint at bake time)
  const GOLDEN = {
    cap: '#3a2b2a', capHi: '#7a5442', frame: '#2a2124', frameHi: '#5a4440',
    tc: '#c95b38', tcLn: '#a7482f', tcHi: '#d96c43', tcDk: '#8c3b28',
    ch: '#564a4b', chHi: '#70605a', chDk: '#40363a',
    wh: '#efd9bc', wh2: '#e9d2b4', whLn: '#d5bc9d', whHi: '#f8e6c8', whDk: '#bca38a',
    gr: '#d2bea5', gr2: '#cbb79e', grLn: '#b8a28a', grHi: '#e2cfb4',
    sl: '#56627a', sl2: '#515d74', slHi: '#6e788a', slDk: '#424c60',
    bk: '#564a48', bk2: '#605250', bkLn: '#463c3c', bkHi: '#6c5c58',
    pod: '#8a7b70', pod2: '#938373', podLn: '#776a60', podHi: '#a79381', podDk: '#62574f',
    or: '#f0873a', orDk: '#b0572a',
    gD: '#5e4e5a', gM: '#8a7682', gHi: '#f0c48e', gHi2: '#fff0d0', gLo: '#4a3c48', gSky2: '#d6a48e',
    blind: '#e2cbb0', blindLn: '#c4aa90',
    film: '#5e5458', filmHi: '#7a6a68',
    fin: '#3a2e2e', finHi: '#e0a066', finL: '#2a2224', finR: '#e8a46a',
    rail: '#1e1a1c', railHi: '#8a6048',
    louv: '#5e5450', louvHi: '#7a6c64',
    roofU: '#4a3c3a', roofUHi: '#8a6450',
    door: '#3e3436', doorHi: '#5c4c4a',
    box: '#4e4446', boxHi: '#d09468', boxDk: '#2e2628', sill: '#c6b098', sillHi: '#ead2b2',
    pump: '#e07020', pumpHi: '#f59a40', pumpLn: '#b8501a', stem: '#5a7030',
    mc: '#c07a30', mcHi: '#e8aa58', plate: '#f2e6d4', edge: '#e89a62', reveal: '#b8805a',
    awnA: '#2f7a72', awnB: '#f0e2c8', awnC: '#b83a32', awnHi: '#8a6a58',
  };
  // plain day (not used by the current entries, kept so the place works in any light)
  const DAY = Object.assign({}, GOLDEN, {
    tc: '#c4553a', tcLn: '#a8462f', tcHi: '#d0623f', tcDk: '#8a3a28',
    wh: '#e6e7e9', wh2: '#dfe0e3', whLn: '#c9ccd2', whHi: '#f2f3f4', whDk: '#a9adb6',
    gr: '#c8ccd2', gr2: '#c1c5cc', grLn: '#aeb3bb', grHi: '#d6dade',
    sl: '#4f6779', sl2: '#4b6274', slHi: '#627a8c', slDk: '#3e5464',
    ch: '#3e4048', chHi: '#4c4f58', chDk: '#30323a',
    bk: '#4a4b50', bk2: '#54555a', bkLn: '#3c3d42', bkHi: '#5c5d62',
    pod: '#6e7075', pod2: '#76787d', podLn: '#5e6065', podHi: '#86888d', podDk: '#55575c',
    gD: '#3a4a60', gM: '#5a6a82', gHi: '#b8d0e8', gHi2: '#eef6fc', gLo: '#2a3446', gSky2: '#9ab4d0',
    blind: '#e8e6e0', blindLn: '#c8c6c0',
    cap: '#1c1d22', capHi: '#3a3c44', frame: '#1c1d22', frameHi: '#3a3c44',
    fin: '#1e2026', finHi: '#5a5e68', finL: '#2a2c32', finR: '#6a6e78', rail: '#1c1d22', railHi: '#4a4e58',
  });

  /** the daylight gain of `mode` (what the engine multiplies a night colour by) */
  function gainOf(mode) {
    const lt = HD.LIGHTING[mode];
    const A = HD.AMBIENT;
    if (!lt || !(lt.day > 0)) return [1, 1, 1];
    return [1 + lt.fill[0] / A[0], 1 + lt.fill[1] / A[1], 1 + lt.fill[2] / A[2]];
  }
  function toPaint(hex, k) {
    const c = CL.hex(hex);
    return CL.css(c[0] / k[0], c[1] / k[1], c[2] / k[2]);
  }
  function palette(mode) {
    const day = mode === 'golden' || mode === 'day';
    const src = mode === 'golden' ? GOLDEN : mode === 'day' ? DAY : NIGHT;
    const k = day ? gainOf(mode) : [1, 1, 1];
    const out = { mode, day };
    for (const key in src) out[key] = toPaint(src[key], k);
    return out;
  }

  // emissive (never relit) warm interiors
  const A = P.amber;
  const LIT = { d0: A[2], d1: A[3], d2: A[4], m: A[5], b: A[6], hi: A[7], w: A[8] };

  // ------------------------------------------------------------------
  // Bake helpers
  // ------------------------------------------------------------------
  function layer(fn) {
    return HD.bake(BW, BH, (g) => {
      g.ctx.translate(-BX, -BY);
      fn(g);
    });
  }
  const h2 = (a, b, s) => HD.hash(a, b, s | 0, 77);

  /** horizontal lap panels on a rectangle */
  function lap(g, x0, y0, x1, y1, pal) {
    g.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, pal.tc);
    for (let y = y0; y <= y1; y++) {
      const r = (y - y0) % 3;
      if (r === 0) g.hline(x0, x1, y, pal.tcHi);
      else if (r === 2) g.hline(x0, x1, y, pal.tcLn);
    }
    // staggered butt joints and a little variegation
    for (let y = y0; y <= y1; y += 3) {
      const row = (y - y0) / 3;
      for (let x = x0 + Math.floor(h2(row, 5, 11) * 23); x <= x1; x += 23 + Math.floor(h2(row, x, 12) * 9)) g.vline(x, y, Math.min(y1, y + 1), pal.tcLn);
      for (let x = x0; x <= x1; x++) if (h2(x, y, 13) < 0.05) g.px(x, y + 1, pal.tcDk);
    }
  }

  /** large-format panels with joints */
  function panels(g, x0, y0, x1, y1, c1, c2, ln, pw, ph) {
    for (let y = y0; y <= y1; y += ph)
      for (let x = x0; x <= x1; x += pw) {
        const alt = ((x - x0) / pw + (y - y0) / ph) & 1;
        g.rect(x, y, Math.min(pw, x1 - x + 1), Math.min(ph, y1 - y + 1), alt ? c2 : c1);
      }
    for (let y = y0 + ph - 1; y <= y1; y += ph) g.hline(x0, x1, y, ln);
    for (let x = x0 + pw - 1; x <= x1; x += pw) g.vline(x, y0, y1, ln);
  }

  /** brick courses (2 px) with offset head joints */
  function brick(g, x0, y0, x1, y1, c1, c2, ln, hi) {
    g.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, c1);
    for (let y = y0; y <= y1; y += 2) {
      const row = (y - y0) >> 1;
      if (row & 1) g.hline(x0, x1, y, c2);
      g.hline(x0, x1, Math.min(y1, y + 1), ln);
      for (let x = x0 + (row & 1 ? 2 : 0); x <= x1; x += 4) g.px(x, y, ln);
      if (hi) for (let x = x0; x <= x1; x++) if (h2(x, y, 21) < 0.04) g.px(x, y, hi);
    }
  }

  // ------------------------------------------------------------------
  // Window drawing
  // ------------------------------------------------------------------
  /** a dark (night) pane */
  function glassNight(g, w, pal, seed) {
    const { x, y } = w;
    const tone = h2(w.i, 1, seed) < 0.5 ? pal.gD : pal.gM;
    g.rect(x, y, w.w, w.h, tone);
    // faint reflection of the overcast sky in the upper panes
    g.hline(x, x + w.w - 1, y, pal.gHi);
    if (w.w >= 5) g.px(x, y + 1, pal.gHi);
    if (w.kind === 'big') {
      // a soft diagonal sheen across the big panes
      const o = Math.floor(h2(w.i, 2, seed) * 6);
      for (let k = 0; k < w.h; k++) {
        const xx = x + ((k + o) % (w.w + 6)) - 3;
        if (xx >= x && xx < x + w.w && k > 1) g.px(xx, y + k, pal.gHi);
      }
    }
    g.hline(x, x + w.w - 1, y + w.h - 1, pal.gLo);
    // some flats have drawn their curtains or blinds for the night
    const r = h2(w.i, 7, seed);
    const tr = w.kind === 'big' ? 4 : 3;
    if (w.kind !== 'stair' && r < 0.16) {
      g.rect(x, y + tr + 1, w.w, w.h - tr - 2, pal.cur);
      g.vline(x + (w.w >> 1), y + tr + 1, y + w.h - 2, pal.curLn);
    } else if (w.kind !== 'stair' && r < 0.27) {
      const by = y + tr + 1 + Math.floor(h2(w.i, 8, seed) * 4);
      g.rect(x, y + tr + 1, w.w, by - y - tr, pal.cur);
      for (let yy = y + tr + 2; yy <= by; yy += 2) g.hline(x, x + w.w - 1, yy, pal.curLn);
    }
  }

  /** a sunlit pane reflecting the golden sky (non-emissive, relit) */
  function glassDay(g, w, pal, seed) {
    const { x, y } = w;
    const x1 = x + w.w - 1;
    const y1 = y + w.h - 1;
    const up = HD.clamp((BASE - y) / 150, 0, 1); // higher windows see more sky
    const r = h2(w.i, 3, seed);
    const tr = w.kind === 'big' ? 4 : w.kind === 'stair' ? 2 : 3; // transom row
    const sky = up > 0.45 ? pal.gHi : pal.gSky2;
    // lower panes: the street and the blocks opposite
    g.rect(x, y, w.w, w.h, pal.gM);
    // upper panes: the golden sky, bleeding into the top of the lower pane
    g.rect(x, y, w.w, tr, sky);
    g.dither(x, y + tr + 1, w.w, 2, sky, 0.5, x, y);
    if (r < 0.3 && w.kind !== 'stair') {
      // blinds part way down
      const by = y + tr + 2 + Math.floor(h2(w.i, 6, seed) * 4);
      g.rect(x, y + tr + 1, w.w, by - y - tr, pal.blind);
      for (let yy = y + tr + 2; yy <= by; yy += 2) g.hline(x, x1, yy, pal.blindLn);
    } else if (r < 0.55) {
      // a clean diagonal glint
      const o = Math.floor(h2(w.i, 4, seed) * 3);
      for (let k = 0; k < w.h - tr - 1; k++) {
        const xx = x1 - o - k + 2;
        const yy = y + tr + 1 + k;
        if (xx >= x && xx <= x1) g.px(xx, yy, pal.gHi2);
        if (xx - 1 >= x && xx - 1 <= x1) g.px(xx - 1, yy, pal.gHi);
      }
    }
    g.hline(x, x1, y1, pal.gD);
    // the right-hand reveal throws a thin shadow across the glass (sun on the right)
    g.vline(x1, y, y1, pal.gLo);
  }

  /** a lit (warm) pane on the emissive layer: st 1 dim, 2 lit */
  function glassLit(e, w, st, seed) {
    const { x, y } = w;
    const r = h2(w.i, 5, seed);
    if (st === 1) {
      // a dim room: dark above, a lamp somewhere low in the back
      e.rect(x, y, w.w, w.h, '#24160f');
      const gy = y + Math.floor(w.h * 0.45);
      e.rect(x, gy, w.w, y + w.h - gy, '#4a2410');
      e.dither(x, gy - 2, w.w, 2, '#4a2410', 0.5, w.i);
      e.dither(x, gy + 2, w.w, y + w.h - gy - 2, LIT.d0, 0.6, w.i);
      e.px(x + (r < 0.5 ? 1 : w.w - 2), gy + 2, LIT.d2);
      return;
    }
    e.rect(x, y, w.w, w.h, LIT.b);
    e.dither(x, y, w.w, Math.ceil(w.h / 2), LIT.hi, 0.35, w.i);
    e.rect(x, y + w.h - 3, w.w, 3, LIT.m);
    e.hline(x, x + w.w - 1, y + w.h - 1, LIT.d2);
    // a curtain, blinds or a lamp
    if (r < 0.35) {
      e.rect(x, y, 2, w.h, LIT.d2);
      e.vline(x + 1, y, y + w.h - 1, LIT.m);
    } else if (r < 0.6) {
      for (let k = 1; k < w.h - 3; k += 2) e.hline(x, x + w.w - 1, y + k, LIT.m);
    } else {
      const lx = x + w.w - 2;
      e.px(lx, y + w.h - 6, LIT.w);
      e.vline(lx, y + w.h - 5, y + w.h - 2, LIT.d1);
    }
  }

  /** frame, mullions and the pane for one window */
  function drawWin(g, e, w, st, pal, seed) {
    const { x, y } = w;
    // the big gateway panes sit flush in the white frame: only their heads are dark
    if (w.kind === 'big') g.hline(x, x + w.w - 1, y - 1, pal.frame);
    else g.rect(x - 1, y - 1, w.w + 2, w.h + 2, pal.frame);
    if (w.kind === 'film') {
      g.rect(x, y, w.w, w.h, pal.film);
      g.hline(x, x + w.w - 1, y, pal.filmHi);
      return;
    }
    const lit = st === 1 || st === 2;
    if (lit) glassLit(e, w, st, seed);
    else if (pal.day) glassDay(g, w, pal, seed);
    else glassNight(g, w, pal, seed);
    // transom and mullion (on the emissive layer too when the pane is lit)
    const m = lit ? e : g;
    const mc = lit ? LIT.d0 : pal.frame;
    if (w.kind === 'std') {
      m.hline(x, x + w.w - 1, y + 3, mc);
      m.vline(x + 2, y + 4, y + w.h - 1, mc);
    } else if (w.kind === 'big') {
      m.hline(x, x + w.w - 1, y + 4, mc);
      m.vline(x + 3, y + 5, y + w.h - 1, mc);
    }
    if (w.kind === 'big') return;
    // sill
    g.hline(x - 1, x + w.w, y + w.h + 1, pal.frameHi);
    // golden hour: the left reveal faces the low sun and catches it
    if (pal.day) g.vline(x - 1, y, y + w.h - 1, pal.reveal);
  }

  // ------------------------------------------------------------------
  // Window states per edition (0 dark, 1 dim, 2 lit)
  // ------------------------------------------------------------------
  function windowStates(ed, mode) {
    const seed = ed.id === 'halloween' ? 31 : ed.id === 'harvest' ? 17 : 5;
    const st = new Int8Array(WINS.length);
    if (mode === 'golden' || mode === 'day') return { st, seed };
    for (const w of WINS) {
      if (w.kind === 'film') continue;
      const r = h2(w.i, 9, seed);
      // keep the windows round his dark, so his stands out
      const near = Math.abs(w.x + 2 - 212) < 14 && Math.abs(w.y - CW.y) < 24;
      if (near) continue;
      if (w.kind === 'stair') st[w.i] = r < 0.3 ? 1 : 0;
      else st[w.i] = r < 0.065 ? 2 : r < 0.15 ? 1 : 0;
    }
    // the living windows are drawn per frame over their dark bake
    st[TV.i] = 0;
    for (const s of SWITCH) if (s.w) st[s.w.i] = 0;
    // a neighbour has strung little lights for the holiday
    if (ed.id === 'halloween') st[FEST.i] = 1;
    return { st, seed };
  }

  // a window two floors up the brick bay with orange and violet bulbs
  const FEST = WINS.find((w) => w.bay === 'brick' && w.f === 5 && w.x === 289);
  function festiveWindow(e) {
    const { x, y } = FEST;
    // a dark room lit only by its decorations
    e.rect(x, y, 5, 11, '#1c120e');
    e.rect(x, y + 6, 5, 5, '#2e1810');
    e.hline(x, x + 4, y + 3, '#120c0a');
    // a sagging string of bulbs across the top
    const cols = ['#ffa040', '#c09aff', '#ffc060', '#a07aff', '#ffa040'];
    const sag = [1, 2, 2, 2, 1];
    for (let k = 0; k < 5; k++) e.px(x + k, y + sag[k], cols[k]);
    // and a little lantern pumpkin on the inner sill
    e.rect(x + 1, y + 8, 3, 3, '#a8481a');
    e.px(x + 1, y + 9, '#ffc25a');
    e.px(x + 3, y + 9, '#ffc25a');
    e.px(x + 2, y + 10, '#ff9a3a');
    e.px(x + 2, y + 7, '#4a5a2a');
  }

  // ------------------------------------------------------------------
  // The bake
  // ------------------------------------------------------------------
  function bake(ed) {
    const mode = (HD.LIGHTING[ed.light] || HD.LIGHTING.night).mode;
    const pal = palette(mode);
    const { st, seed } = windowStates(ed, mode);
    let base = null;
    const em = layer((e) => {
      base = layer((g) => {
        drawStructure(g, pal);
        drawPodiumWalls(g, pal);
        for (const w of WINS) drawWin(g, e, w, st[w.i], pal, seed);
        if (ed.id === 'halloween' && !pal.day) festiveWindow(e);
        drawPodium(g, e, pal, mode, ed);
        drawHisFrame(g, pal);
        drawRailing(g, pal);
        drawCanopy(g, e, pal);
        if (pal.day) drawShadows(g, pal);
        else drawNightDepth(g);
      });
    });
    const lit = [];
    const dark = [];
    for (const w of WINS) {
      if (st[w.i] === 2) lit.push(w);
      if (st[w.i] === 0 && w.kind !== 'film') dark.push(w);
    }
    const room = HD.bake(ROOM.w, ROOM.h, (r) => {
      r.ctx.translate(-ROOM.x, -ROOM.y);
      roomStatic(r, ed, pal);
    });
    return { base, em, room, pal, mode, lit, dark, st };
  }
  const art = HD.perEdition(bake);

  function drawStructure(g, pal) {
    // ---- white corner tower
    panels(g, TW.x0, TW.top + 3, TW.x1, POD - 1, pal.wh, pal.wh2, pal.whLn, 9, 9);
    g.rect(TW.x0, TW.top, TW.x1 - TW.x0 + 1, 3, pal.cap);
    g.hline(TW.x0, TW.x1, TW.top, pal.capHi);
    g.hline(TW.x0, TW.x1, TW.top + 3, pal.whDk);
    // slate-blue accent column on its outer side
    g.rect(140, TW.top + 3, 11, POD - TW.top - 3, pal.sl);
    for (let y = TW.top + 3 + 8; y < POD; y += 9) g.hline(140, 150, y, pal.slDk);
    g.vline(140, TW.top + 3, POD - 1, pal.slHi);
    g.vline(151, TW.top + 3, POD - 1, pal.slDk);
    g.vline(TW.x0, TW.top + 3, POD - 1, pal.whDk);
    g.vline(TW.x1, TW.top + 3, POD - 1, pal.whHi);
    // ---- slate stair strip (rises a touch above the roof)
    g.rect(ST.x0, ST.top, ST.x1 - ST.x0 + 1, POD - ST.top, pal.sl2);
    g.rect(ST.x0, ST.top, ST.x1 - ST.x0 + 1, 2, pal.cap);
    g.vline(ST.x0, ST.top + 2, POD - 1, pal.slDk);
    g.vline(ST.x1, ST.top + 2, POD - 1, pal.slHi);
    // ---- roof: coping, small rooftop units set back behind it
    for (const [x0, x1, y0] of ROOF_UNITS) {
      g.rect(x0, y0, x1 - x0 + 1, ROOF - y0, pal.roofU);
      g.hline(x0, x1, y0, pal.roofUHi);
      g.vline(x1, y0, ROOF - 1, pal.roofUHi);
    }
    g.rect(TC.x0, ROOF, BK.x1 - TC.x0 + 1, 2, pal.cap);
    g.hline(TC.x0, BK.x1, ROOF, pal.capHi);
    // ---- light-grey top band (L8 over the terra cotta, L7-L8 over the brick bay)
    panels(g, TC.x0, ROOF + 2, TC.x1, FT[7] - 2, pal.gr, pal.gr2, pal.grLn, 10, 17);
    panels(g, BK.x0, ROOF + 2, BK.x1, FT[6] - 2, pal.gr, pal.gr2, pal.grLn, 10, 17);
    g.hline(TC.x0, TC.x1, FT[7] - 1, pal.cap); // dark reveal
    g.hline(BK.x0, BK.x1, FT[6] - 1, pal.cap);
    g.vline(BK.x0, FT[6], POD - 1, pal.chDk);
    // ---- terra cotta bay with charcoal window bands
    lap(g, TC.x0, FT[7], TC.x1, POD - 1, pal);
    for (const c of STRIPES) {
      g.rect(c - 4, FT[7], 9, POD - FT[7], pal.ch);
      g.vline(c - 4, FT[7], POD - 1, pal.chHi);
      g.vline(c + 4, FT[7], POD - 1, pal.chDk);
      // spandrel panel joints
      for (let f = 3; f <= 7; f++) g.hline(c - 3, c + 3, FT[f] + 1, pal.chDk);
    }
    // ---- charcoal brick bay
    brick(g, BK.x0, FT[6], BK.x1, POD - 1, pal.bk, pal.bk2, pal.bkLn, pal.bkHi);
    // ---- gateway corner
    g.rect(GW.x0, GW.top, GW.x1 - GW.x0 + 1, POD - GW.top, pal.ch);
    for (let y = GW.top + 3 + 12; y < POD; y += 13) g.hline(GW.x0, 304, y, pal.chDk);
    g.rect(GW.x0, GW.top, GW.x1 - GW.x0 + 1, 3, pal.cap);
    g.hline(GW.x0, GW.x1, GW.top, pal.capHi);
    g.vline(GW.x0, GW.top + 3, POD - 1, pal.chHi);
    // thin orange edge strip
    g.vline(305, 56, POD - 1, pal.or);
    g.vline(306, 56, POD - 1, pal.orDk);
    // white frame of big windows
    g.rect(307, 56, 27, POD - 56, pal.wh);
    g.hline(307, 333, 56, pal.whHi);
    g.vline(333, 56, POD - 1, pal.whDk);
    // plain blade fin at the corner (no lettering)
    g.rect(335, 47, 3, POD - 47, pal.fin);
    g.vline(335, 47, POD - 1, pal.finL);
    g.vline(337, 47, POD - 1, pal.finR);
    g.vline(338, GW.top + 3, POD - 1, pal.edge);
  }
  const ROOF_UNITS = [
    [196, 205, 53],
    [226, 239, 51],
    [272, 279, 54],
  ];

  // ------------------------------------------------------------------
  // Podium: shops, bike room, lobby
  // ------------------------------------------------------------------
  const GOODS = {
    cafe: ['#e8d2a8', '#c0603a', '#6a3a2a', '#f0e6d0'],
    florist: ['#e05a7a', '#f2a0b8', '#4a9a5a', '#f0d050', '#7a4ab0'],
    bakery: ['#d8a060', '#b06a30', '#f4dca8', '#8a4a24'],
    books: ['#c43a3a', '#3a6ac4', '#e0b636', '#2f9a5e', '#7a3cc4', '#e8e0d0'],
    grocer: ['#e0701a', '#d23a2a', '#e8bf2e', '#5aa04a', '#9a2a5a'],
  };
  const MULL = '#0a0c13';

  function shopFront(g, e, s, pal, mode, ed) {
    const x0 = s.x0;
    const x1 = s.x1;
    const y0 = SHOP_Y0;
    const y1 = BASE - 1;
    const w = x1 - x0 + 1;
    const cafe = s.kind === 'cafe';
    g.rect(x0 - 1, y0 - 1, w + 2, y1 - y0 + 2, pal.frame);
    // the interior: a warm back wall, brightest under the lamps, a darker floor
    e.rect(x0, y0, w, y1 - y0 + 1, LIT.m);
    e.rect(x0, y0, w, 3, LIT.hi);
    e.rect(x0, y0 + 4, w, 4, LIT.b);
    e.dither(x0, y0 + 8, w, 2, LIT.b, 0.5, x0);
    e.rect(x0, y1 - 2, w, 3, LIT.d2);
    e.hline(x0, x1, y1 - 3, LIT.d1);
    // pendant lamps in the transom
    for (let x = x0 + 3; x < x1 - 1; x += 6) {
      e.px(x, y0, LIT.d1);
      e.px(x, y0 + 1, LIT.w);
    }
    // the door at one end, with a bright glass pane
    const door = cafe ? x0 : x1 - 3;
    const dx0 = cafe ? x0 + 5 : x0; // the display window
    const dx1 = cafe ? x1 : x1 - 5;
    e.rect(door, y0 + 4, 4, y1 - y0 - 3, LIT.hi);
    e.vline(door + 1, y0 + 9, y0 + 12, LIT.d1);
    // goods on two shelves, chunky enough to read
    const cols = GOODS[s.kind];
    for (const sy of [y0 + 7, y0 + 12]) {
      e.hline(dx0, dx1, sy + 1, LIT.d1);
      for (let x = dx0 + (sy & 1); x <= dx1 - 1; x += 3) {
        if (h2(x, sy, 41) < 0.18) continue;
        const c = cols[Math.floor(h2(x, sy, 42) * cols.length)];
        const tall = h2(x, sy, 43) < 0.4;
        e.rect(x, sy - (tall ? 2 : 1), 2, tall ? 3 : 2, c);
      }
    }
    // the front display, one per kind
    const fy = y1 - 3;
    if (s.kind === 'grocer') {
      for (let x = dx0; x <= dx1 - 1; x += 3) {
        e.rect(x, fy, 2, 2, ed.season === 'autumn' ? (x % 2 ? '#e0701a' : '#d23a2a') : '#d23a2a');
        e.px(x, fy - 1, '#5aa04a');
      }
    } else if (s.kind === 'florist') {
      for (let x = dx0; x <= dx1; x += 2) {
        e.vline(x, fy - 1, fy + 1, '#3e7a3e');
        e.px(x, fy - 2, cols[(x >> 1) % 2 ? 0 : 1]);
      }
    } else if (s.kind === 'bakery') {
      e.rect(dx0, fy, dx1 - dx0 + 1, 3, LIT.d0);
      for (let x = dx0; x <= dx1 - 2; x += 3) {
        e.rect(x, fy - 1, 2, 1, '#d8a060');
        e.px(x, fy - 2, '#f0c888');
      }
    } else if (s.kind === 'books') {
      for (let x = dx0; x <= dx1; x++) e.vline(x, fy - (x % 3 === 0 ? 2 : 1), fy, cols[x % cols.length]);
    } else if (cafe) {
      // a counter with a coffee machine, two little tables
      e.rect(x0 + 20, y1 - 6, 11, 2, LIT.d1);
      e.rect(x0 + 20, y1 - 4, 11, 5, LIT.d2);
      e.rect(x0 + 26, y1 - 9, 3, 3, '#5a5a62');
      e.px(x0 + 27, y1 - 10, '#8a8a92');
      for (const tx of [x0 + 7, x0 + 13]) {
        e.hline(tx - 1, tx + 2, y1 - 5, LIT.d0);
        e.vline(tx, y1 - 4, y1, LIT.d0);
        e.px(tx + 1, y1 - 6, '#f0e6d0');
      }
    }
    // mullions
    e.hline(x0, x1, y0 + 3, MULL);
    e.vline(cafe ? door + 4 : door - 1, y0, y1, MULL);
    if (cafe) e.vline(x0 + 18, y0 + 4, y1, MULL);
    // golden hour: the upper glass catches the sky, a clean glint
    if (pal.day) {
      e.rect(x0, y0, w, 3, '#ffe2b0');
      e.dither(x0, y0 + 4, w, 2, '#ffe9c4', 0.35, x0);
      for (let k = 0; k < 9; k++) {
        const xx = x1 - 1 - k;
        if (xx >= x0) {
          e.px(xx, y0 + 4 + k, '#fff6e0');
          if (xx + 1 <= x1) e.px(xx + 1, y0 + 4 + k, '#ffe6bc');
        }
      }
    }
  }

  /** striped fabric awnings over two of the shops */
  function awning(g, x0, x1, c1, c2, pal) {
    const y = SHOP_Y0 - 6;
    for (let x = x0; x <= x1; x++) {
      const c = ((x - x0) >> 1) & 1 ? c2 : c1;
      g.vline(x, y + 1, y + 4, c);
      if ((x - x0) % 2 === 0) g.px(x, y + 5, c);
    }
    g.hline(x0, x1, y, pal.cap);
    g.hline(x0, x1, y + 1, pal.awnHi);
  }

  /** small gooseneck lamps over the shop fronts (lit after dark) */
  const SCONCES = [194, 230, 248, 278];
  function sconces(g, e, pal) {
    const y = SHOP_Y0 - 5;
    for (const x of SCONCES) {
      g.px(x, y - 1, pal.cap);
      g.px(x + 1, y - 1, pal.cap);
      g.px(x + 1, y, pal.cap);
      if (pal.day) g.px(x, y, pal.capHi);
      else e.px(x, y, P.amber[8]);
    }
  }

  function bikeRoom(g, e, pal) {
    const { x0, x1, y0, y1 } = BIKE;
    const w = x1 - x0 + 1;
    g.rect(x0 - 1, y0 - 1, w + 2, y1 - y0 + 2, pal.frame);
    // a softly lit bike room: pale wall, a darker floor
    e.rect(x0, y0, w, y1 - y0 + 1, '#c8a274');
    e.dither(x0, y0, w, 5, '#e2c290', 0.5);
    e.rect(x0, y1 - 3, w, 4, '#8a6a4a');
    e.hline(x0, x1, y1 - 4, '#a8845c');
    // a strip light
    e.hline(x0 + 3, x1 - 3, y0, '#fff0cc');
    // bikes standing in a rack: two wheels, a frame, a saddle and bars
    const BIKE_ROWS = ['...##..##..', '....#..#...', '....####...', '.##..#..##.', '#..#.#.#..#', '#..###.#..#', '.##.....##.'];
    const c = '#2a2026';
    for (const bx of [x0 + 1, x0 + 13]) {
      const by = y1 - 7;
      for (let r = 0; r < BIKE_ROWS.length; r++) {
        const row = BIKE_ROWS[r];
        for (let k = 0; k < row.length; k++) if (row[k] === '#' && bx + k <= x1) e.px(bx + k, by + r, c);
      }
    }
    e.vline(x0 + 12, y0, y1, MULL);
    if (pal.day) {
      e.dither(x0, y0, w, 3, '#fff6e0', 0.5, 3);
      for (let k = 0; k < 7; k++) e.px(x1 - 1 - k, y0 + 2 + k, '#fff2d6');
    }
  }

  function lobby(g, e, pal) {
    const { x0, x1, y0, y1 } = LOBBY;
    g.rect(x0 - 1, y0 - 1, x1 - x0 + 3, y1 - y0 + 2, pal.frame);
    // double-height warm lobby
    e.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, LIT.b);
    // back wall of warm wood slats
    for (let x = x0 + 1; x <= x1; x += 3) e.vline(x, y0 + 6, y1 - 6, '#f6b656');
    e.rect(x0, y0, x1 - x0 + 1, 5, LIT.hi);
    // a ring pendant light
    e.vline(319, y0, y0 + 4, LIT.d1);
    e.hline(315, 323, y0 + 6, LIT.w);
    e.hline(316, 322, y0 + 5, LIT.d2);
    e.px(314, y0 + 7, LIT.w);
    e.px(324, y0 + 7, LIT.w);
    // floor with a warm sheen
    e.rect(x0, y1 - 1, x1 - x0 + 1, 2, LIT.hi);
    e.dither(x0, y1 - 3, x1 - x0 + 1, 2, LIT.w, 0.25);
    // a tall plant on the left, the desk on the right
    const leaf = '#3e5a2a';
    const leaf2 = '#557a34';
    e.rect(304, y1 - 4, 4, 4, '#6a3a1e');
    for (const [dx, dy] of [[0, -6], [1, -8], [2, -10], [3, -7], [-1, -9], [4, -9], [1, -12], [3, -11], [2, -6], [0, -11], [4, -6]]) e.px(305 + dx, y1 - 2 + dy, dx & 1 ? leaf : leaf2);
    e.rect(327, y1 - 6, 8, 6, '#7a4a26');
    e.hline(327, 334, y1 - 6, '#c08a50');
    // mullions and doors
    for (const x of [309, 314, 323, 330]) e.vline(x, y0, y1, MULL);
    e.hline(x0, x1, 185, MULL);
    // glass doors (entrance anchor x 315..322 from y 186)
    e.rect(315, 186, 8, y1 - 186 + 1, LIT.hi);
    e.vline(319, 186, y1, MULL);
    e.vline(318, 193, 198, LIT.d0);
    e.vline(320, 193, 198, LIT.d0);
    if (pal.day) {
      e.dither(x0, y0, x1 - x0 + 1, 6, '#fff0cc', 0.35, 1);
      for (let k = 0; k < 14; k++) e.px(x1 - 3 - k, y0 + 6 + k, '#fff6dc');
    }
  }

  function drawPodiumWalls(g, pal) {
    // grey brick podium, full width (the lobby glass is cut into it)
    brick(g, TW.x0, POD + 2, GW.x1, BASE - 1, pal.pod, pal.pod2, pal.podLn, pal.podHi);
    // precast ledge at the terrace level
    g.rect(TW.x0, POD, GW.x1 - TW.x0 + 1, 2, pal.podHi);
    g.hline(TW.x0, GW.x1, POD + 2, pal.podDk);
    // precast sign band over the shops (left blank)
    g.rect(TW.x0, SHOP_Y0 - 5, BK.x1 - TW.x0 + 1, 3, pal.podDk);
    g.hline(TW.x0, BK.x1, SHOP_Y0 - 5, pal.podHi);
    // a plinth course along the sidewalk
    g.hline(TW.x0, GW.x1, BASE - 1, pal.podDk);
  }

  function drawPodium(g, e, pal, mode, ed) {
    for (const s of SHOPS) shopFront(g, e, s, pal, mode, ed);
    sconces(g, e, pal);
    awning(g, SHOPS[0].x0 - 1, SHOPS[0].x1 + 1, pal.awnA, pal.awnB, pal);
    awning(g, SHOPS[2].x0 - 1, SHOPS[2].x1 + 1, pal.awnC, pal.awnB, pal);
    // stair exit door under the slate strip
    g.rect(ST.x0, SHOP_Y0 + 2, 5, BASE - SHOP_Y0 - 2, pal.door);
    g.vline(ST.x0, SHOP_Y0 + 2, BASE - 1, pal.doorHi);
    g.px(ST.x0 + 3, SHOP_Y0 + 11, pal.capHi);
    // louvers on L2 over the bike room
    g.rect(266, 170, 27, 11, pal.frame);
    for (let y = 171; y < 181; y += 2) {
      g.hline(266, 292, y, pal.louv);
      g.hline(266, 292, y + 1, pal.louvHi);
    }
    bikeRoom(g, e, pal);
    lobby(g, e, pal);
  }

  function drawCanopy(g, e, pal) {
    // dark metal canopy over the lobby with a warm-lit soffit
    g.rect(GW.x0, POD - 2, GW.x1 - GW.x0 + 1, 3, pal.cap);
    g.hline(GW.x0, GW.x1, POD - 2, pal.capHi);
    e.hline(GW.x0 + 1, GW.x1 - 1, POD + 1, pal.day ? P.amber[5] : P.amber[4]);
    for (const x of [305, 312, 319, 326, 333]) e.px(x, POD + 1, P.amber[8]);
    e.hline(GW.x0, GW.x1, POD + 2, pal.day ? P.fire[6] : P.fire[5]);
  }

  // ------------------------------------------------------------------
  // His window: a feature window in a dark box surround
  // ------------------------------------------------------------------
  function drawHisFrame(g, pal) {
    const { x0, y0, x1, y1 } = BOX;
    // the projecting box surround: dark metal, its top edge catching the light
    g.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, pal.box);
    g.hline(x0, x1, y0, pal.boxHi);
    g.vline(x0, y0 + 1, y1, pal.boxHi);
    g.vline(x1, y0 + 1, y1, pal.boxDk);
    // the inner frame round the glass
    g.rect(CW.x - 1, CW.y - 1, CW.w + 2, CW.h + 2, pal.frame);
    // a deep precast sill, wider than the box, and its shadow on the wall
    g.rect(x0 - 1, y1 + 1, x1 - x0 + 3, 2, pal.sill);
    g.hline(x0 - 1, x1 + 1, y1 + 1, pal.sillHi);
    g.hline(x0, 208, y1 + 3, pal.tcDk);
    g.hline(216, x1, y1 + 3, pal.tcDk);
  }

  function drawRailing(g, pal) {
    const t = PL.terrace;
    const top = POD - 7;
    g.hline(t.x0, t.x1, top, pal.rail);
    g.hline(t.x0, t.x1, top - 1, pal.railHi);
    g.hline(t.x0, t.x1, POD - 1, pal.rail);
    for (let x = t.x0; x <= t.x1; x += 2) g.vline(x, top + 1, POD - 2, pal.rail);
    for (let x = t.x0; x <= t.x1; x += 13) g.vline(x, top - 1, POD - 1, pal.rail);
  }

  /** night: the lower floors sink a little into the dark street canyon */
  function drawNightDepth(g) {
    const ctx = g.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const band = (y0, y1, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(TW.x0, y0, GW.x1 - TW.x0 + 1, y1 - y0 + 1);
    };
    band(FT[5], FT[4] - 1, '#f2f2f6');
    band(FT[4], FT[3] - 1, '#e4e4ec');
    band(FT[3], POD - 1, '#d6d6e2');
    ctx.restore();
    g.reset();
  }

  /** golden hour: shadows thrown to the left by the low sun on the right */
  function drawShadows(g, pal) {
    const ctx = g.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const sh = (x, y, w, h, c) => {
      ctx.fillStyle = c || '#8a7aa0';
      ctx.fillRect(x, y, w, h);
    };
    // the projecting gateway onto the brick bay
    sh(294, ROOF + 2, 6, POD - ROOF - 2);
    // the blade fin onto the white frame
    sh(331, 56, 4, POD - 56);
    // his box surround onto the terra cotta
    sh(BOX.x0 - 2, BOX.y0 + 2, 2, BOX.y1 - BOX.y0 + 1);
    sh(BOX.x0, BOX.y1 + 1, BOX.x1 - BOX.x0, 1);
    // under the coping, the tower cap and the crown
    sh(TC.x0, ROOF + 2, BK.x1 - TC.x0 + 1, 1, '#b0a0b8');
    sh(TW.x0, TW.top + 3, TW.x1 - TW.x0 + 1, 1, '#b0a0b8');
    // the corner tower onto the stair strip side
    sh(ST.x0, ST.top + 2, 2, POD - ST.top - 2, '#a090b0');
    // the canopy onto the pier left of the lobby
    sh(295, POD - 1, 5, 6);
    // podium under the ledge
    sh(TW.x0, POD + 2, GW.x0 - TW.x0, 1, '#b0a0b8');
    ctx.restore();
    g.reset();
  }

  // ------------------------------------------------------------------
  // His room (per frame: it is small) and the series cat
  // ------------------------------------------------------------------
  /** the still parts of his room and ledge, baked per edition (emissive) */
  function roomStatic(e, ed, pal) {
    const { x, y, w, h } = CW;
    const x1 = x + w - 1;
    const y1 = y + h - 1;
    // the back wall, lit by a lamp just out of view on the right (flat bands)
    e.rect(x, y, w, h, LIT.b);
    e.rect(x + 6, y + 2, 9, 10, LIT.hi);
    e.px(x + 6, y + 2, LIT.b);
    e.px(x + 6, y + 11, LIT.b);
    e.rect(x + 11, y + 2, 4, 5, LIT.w);
    e.px(x + 11, y + 6, LIT.hi);
    e.rect(x, y1 - 2, w, 2, LIT.m);
    // a valance across the top, scalloped
    e.rect(x, y, w, 2, LIT.d2);
    e.hline(x, x1, y, LIT.d1);
    for (let k = x + 1; k <= x1; k += 2) e.px(k, y + 2, LIT.d2);
    // the curtain, gathered on the left, and a sliver on the right
    e.rect(x, y, 2, h, LIT.d2);
    e.vline(x + 1, y + 3, y1 - 1, LIT.m);
    e.vline(x + 2, y1 - 4, y1, LIT.d2);
    e.vline(x1, y + 2, y1, LIT.d2);
    // the inner sill he sits on
    e.hline(x, x1, y1, LIT.d1);
    if (ed.tagSet.has('mooncakes-sill')) {
      // a small red paper lantern hung for the moon festival
      e.vline(x + 1, y + 2, y + 3, LIT.d0);
      e.rect(x, y + 4, 3, 3, '#d8343a');
      e.px(x + 1, y + 4, '#ff8a62');
      e.px(x + 1, y + 5, '#ff6a4a');
      e.hline(x, x + 2, y + 7, '#e0b636');
      e.px(x + 1, y + 8, '#e0b636');
    }
    // a glint on the glass, clear of his ears
    if (pal.day) {
      for (let k = 0; k < 4; k++) e.px(x + 4 - k, y + 1 + k, '#fff4dc');
      e.px(x + 4, y + 2, '#ffe6b8');
      e.px(x + 3, y + 3, '#ffe6b8');
    } else {
      e.px(x + 2, y + 4, '#ffe9c0');
      e.px(x + 3, y + 3, '#ffe9c0');
    }
    ledgeStatic(e, ed, pal);
  }

  /** his room: the baked still life, then the series cat, rain on the glass, a flicker */
  function drawRoom(g, t, ed, a) {
    const e = g.em;
    const { x, y, w, h } = CW;
    e.sprite(a.room, ROOM.x, ROOM.y);
    // the series cat at his window
    if (ed.cast.window !== 'empty') HD.mascot.draw(g, t, PL.mascot.x, PL.mascot.y);
    // rain on the glass: drops cling, then slide down catching the room light
    const ww = ed.weather;
    if (ww && ww.rain > 0) {
      for (let i = 0; i < 5; i++) {
        const c = T.cycle(t, i, 5.8 + i * 1.3, 9100);
        const dx = 1 + Math.floor(c.rnd(1) * (w - 2));
        const hold = 0.3 + c.rnd(2) * 0.35;
        const k = c.age < hold ? 0 : (c.age - hold) / (1 - hold);
        const sy = y + 1 + Math.floor(c.rnd(3) * 4) + Math.floor(Math.pow(k, 1.8) * (h + 2));
        if (sy > y + h - 2) continue;
        e.px(x + dx, sy, '#fff6dc');
        if (k > 0.05 && sy - 1 > y) e.px(x + dx, sy - 1, LIT.hi);
      }
    }
    if (ed.id === 'halloween') {
      // the carved pumpkin on the ledge flickers
      const f = T.flicker(T.step(t, 10), 711, 1.2);
      const glow = f > 0.55 ? '#ffe2a0' : f > 0.25 ? '#ffc25a' : '#f09a38';
      const lx = BOX.x0 - 1;
      const ly = BOX.y1 + 1;
      e.px(lx + 1, ly - 3, glow);
      e.px(lx + 3, ly - 3, glow);
      e.hline(lx + 1, lx + 3, ly - 2, f > 0.4 ? '#ffb347' : '#e8892e');
    }
  }
  // the baked room covers the glass and the left end of the ledge
  const ROOM = { x: BOX.x0 - 1, y: CW.y, w: CW.x + CW.w - (BOX.x0 - 1), h: BOX.y1 + 1 - CW.y };

  // the things on his sill ledge: emissive with their final colours, since
  // they overlap the lit glass (which is emissive and never relit)
  const LEDGE = {
    night: { pump: '#a8481c', pumpHi: '#c8622a', pumpLn: '#7a3216', stem: '#4a5a2a', box: '#2a2d36', mc: '#9a5a26', mcHi: '#c27c34', plate: '#a8a49c' },
    golden: { pump: '#e07020', pumpHi: '#f59a40', pumpLn: '#b8501a', stem: '#5a7030', box: '#4e4446', mc: '#c07a30', mcHi: '#e8aa58', plate: '#f2e6d4' },
  };
  /** the still things on his sill ledge (left end, standing on y BOX.y1 + 1) */
  function ledgeStatic(e, ed, pal) {
    const c = pal.day ? LEDGE.golden : LEDGE.night;
    const ly = BOX.y1 + 1; // ledge top
    const lx = BOX.x0 - 1;
    if (ed.id === 'halloween') {
      // a small carved pumpkin keeps him company (its face flickers per frame)
      e.rect(lx, ly - 3, 5, 2, c.pump);
      e.hline(lx + 1, lx + 3, ly - 4, c.pumpHi);
      e.hline(lx + 1, lx + 3, ly - 1, c.pumpLn);
      e.px(lx + 2, ly - 5, c.stem);
      e.px(lx + 3, ly - 6, c.stem);
    } else if (ed.tagSet.has('mooncakes-sill')) {
      // a plate of mooncakes
      e.hline(lx, lx + 5, ly - 1, c.plate);
      e.px(lx, ly - 2, c.plate);
      e.px(lx + 5, ly - 2, c.plate);
      e.rect(lx + 1, ly - 3, 2, 2, c.mc);
      e.px(lx + 1, ly - 3, c.mcHi);
      e.rect(lx + 3, ly - 3, 2, 2, c.mc);
      e.px(lx + 3, ly - 3, c.mcHi);
      e.rect(lx + 2, ly - 5, 2, 2, c.mc);
      e.px(lx + 2, ly - 5, c.mcHi);
    }
  }

  // ------------------------------------------------------------------
  // Living windows (a television, lights that go on and off)
  // ------------------------------------------------------------------
  const TV = WINS.find((w) => w.bay === 'gate' && w.f === 6 && w.x === 325);
  const SWITCH = [
    { w: WINS.find((w) => w.bay === 'tower' && w.f === 5), on: 52, off: 196 },
    { w: WINS.find((w) => w.bay === 'brick' && w.f === 3 && w.x === 279), on: 128, off: 228 },
    { w: WINS.find((w) => w.bay === 'tc' && w.f === 7 && w.x === 246), on: 12, off: 88 },
  ];
  function onNow(t, s) {
    const u = HD.wrap(t);
    return s.on < s.off ? u >= s.on && u < s.off : u >= s.on || u < s.off;
  }
  function tvColor(t) {
    const n = T.noise(t, 0.9, 5150);
    const cut = T.noise(t, 4.3, 5151);
    if (cut > 0.75) return ['#6a8ad0', '#9ab8f0', 0.32];
    return n > 0.6 ? ['#4a6ab0', '#7a9ae0', 0.24] : n > 0.3 ? ['#3a5498', '#5a7ac4', 0.18] : ['#5a5aa8', '#8a7ad8', 0.2];
  }
  // golden hour: the low sun glints off a few panes now and then
  const GLINTS = [
    { x: 330, y: FT[7] + 3, p: 13.7, o: 0.1 },
    { x: 322, y: FT[5] + 3, p: 17.3, o: 0.55 },
    { x: 329, y: FT[4] + 4, p: 11.9, o: 0.8 },
    { x: 292, y: FT[8] + 5, p: 19.1, o: 0.3 },
    { x: 165, y: FT[6] + 5, p: 23.3, o: 0.65 },
  ];
  function drawGlints(g, t) {
    const e = g.em;
    for (const s of GLINTS) {
      const u = T.phase(t, s.p, s.o);
      if (u > 0.09) continue;
      const k = Math.sin((u / 0.09) * Math.PI);
      e.px(s.x, s.y, k > 0.5 ? '#fffbea' : '#ffe9b8');
      if (k > 0.35) {
        e.px(s.x - 1, s.y, '#ffe2a6');
        e.px(s.x + 1, s.y, '#ffe2a6');
        e.px(s.x, s.y - 1, '#ffe2a6');
        e.px(s.x, s.y + 1, '#ffe2a6');
      }
      if (k > 0.75) {
        e.px(s.x - 2, s.y, '#f6c47e');
        e.px(s.x + 2, s.y, '#f6c47e');
        e.px(s.x, s.y - 2, '#f6c47e');
        e.px(s.x, s.y + 2, '#f6c47e');
      }
    }
  }
  /** lightning: the dark panes catch the cold flash */
  function drawFlash(g, t, a) {
    const lv = HD.sky && HD.sky.flash ? HD.sky.flash(t) : 0;
    if (!(lv > 0.2)) return;
    const e = g.em;
    const c = lv > 0.6 ? '#aab4e0' : lv > 0.35 ? '#6c76a8' : '#454e7c';
    const c2 = lv > 0.6 ? '#6c76a8' : '#353d62';
    for (const w of a.dark) {
      const tr = w.kind === 'big' ? 4 : w.kind === 'stair' ? 2 : 3;
      e.rect(w.x, w.y, w.w, tr, c);
      e.hline(w.x, w.x + w.w - 1, w.y + tr + 1, c2);
    }
  }

  function drawLiving(g, t, a) {
    if (a.pal.day) {
      drawGlints(g, t);
      return;
    }
    if (HD.edition.weather && HD.edition.weather.lightning > 0) drawFlash(g, t, a);
    const e = g.em;
    const tv = tvColor(T.step(t, 6));
    e.rect(TV.x, TV.y, TV.w, TV.h, tv[0]);
    e.rect(TV.x, TV.y + 5, TV.w, 5, tv[1]);
    e.hline(TV.x, TV.x + TV.w - 1, TV.y + 4, '#141a2c');
    e.vline(TV.x + 3, TV.y + 5, TV.y + TV.h - 1, '#141a2c');
    e.rect(TV.x, TV.y + TV.h - 3, TV.w, 3, '#232a48');
    for (const s of SWITCH) {
      if (!s.w || !onNow(t, s)) continue;
      const w = s.w;
      e.rect(w.x, w.y, w.w, w.h, LIT.b);
      e.rect(w.x, w.y + w.h - 3, w.w, 3, LIT.m);
      e.hline(w.x, w.x + w.w - 1, w.y + 3, LIT.d0);
      e.vline(w.x + 2, w.y + 4, w.y + w.h - 1, LIT.d0);
    }
  }

  // ------------------------------------------------------------------
  // Lights
  // ------------------------------------------------------------------
  const WARM = [1.0, 0.66, 0.34];
  const SHOPLIGHT = [1.0, 0.72, 0.42];
  function lights(t, L) {
    if (!here()) return;
    const a = art();
    const day = a.pal.day;
    // his window: the warmest light on the facade
    L.add({ x: CW.x + 7, y: CW.y + 8, r: 26, ry: 22, color: WARM, i: day ? 0.32 : 0.62, day: true, bands: 5, halo: { r: 18, a: day ? 0.06 : 0.14 } });
    // lit flats spill a little onto the walls round them
    for (const w of a.lit) L.add({ x: w.x + (w.w >> 1), y: w.y + (w.h >> 1), r: 8, color: WARM, i: 0.22 });
    if (HD.edition.id === 'halloween' && !day) L.add({ x: FEST.x + 2, y: FEST.y + 8, r: 6, color: HD.LIGHT.pumpkin, i: 0.22 });
    if (HD.edition.id === 'halloween') L.add({ x: BOX.x0 + 1, y: BOX.y1 - 2, r: 7, color: HD.LIGHT.pumpkin, i: 0.25 + 0.2 * T.flicker(T.step(t, 10), 711, 1.2) });
    if (!day) {
      for (const x of SCONCES) L.add({ x, y: SHOP_Y0 - 2, r: 7, ry: 5, color: WARM, i: 0.32 });
      const tv = tvColor(T.step(t, 6));
      L.add({ x: TV.x + 3, y: TV.y + 7, r: 9, color: [0.45, 0.6, 1.0], i: tv[2] });
      for (const s of SWITCH) if (s.w && onNow(t, s)) L.add({ x: s.w.x + 2, y: s.w.y + 5, r: 8, color: WARM, i: 0.22 });
    }
    // shops onto the sidewalk
    for (const s of SHOPS) {
      const cx = (s.x0 + s.x1) >> 1;
      const rx = Math.max(12, (s.x1 - s.x0) >> 1) + 6;
      L.add({ x: cx, y: 204, r: rx, ry: 12, color: SHOPLIGHT, i: 0.55, clip: { x0: 0, y0: 178, x1: 479, y1: 269 } });
    }
    L.add({ x: 278, y: 204, r: 18, ry: 10, color: [0.95, 0.9, 0.8], i: 0.4, clip: { x0: 0, y0: 180, x1: 479, y1: 269 } });
    // the lobby and its canopy downlights
    L.add({ x: 319, y: 200, r: 34, ry: 20, color: SHOPLIGHT, i: 0.7, clip: { x0: 0, y0: 168, x1: 479, y1: 269 }, halo: { r: 22, a: 0.08, y: 190 } });
    L.add({ x: 319, y: 214, r: 28, ry: 9, color: SHOPLIGHT, i: 0.45 });
  }

  // ------------------------------------------------------------------
  // Shared anchors for weather (rain splashes, fat drips) and the sky
  // ------------------------------------------------------------------
  function register() {
    const sky = new Int16Array(480).fill(999);
    for (let x = TW.x0; x <= TW.x1; x++) sky[x] = TW.top;
    for (let x = ST.x0; x <= ST.x1; x++) sky[x] = ST.top;
    for (let x = TC.x0; x <= BK.x1; x++) sky[x] = ROOF;
    for (const [x0, x1, y0] of ROOF_UNITS) for (let x = x0; x <= x1; x++) sky[x] = y0;
    for (let x = GW.x0; x <= GW.x1; x++) sky[x] = GW.top;
    PL.skyline = sky;
    PL.surfaces = [
      [TW.x0, TW.top - 1, TW.x1, TW.top - 1],
      [ST.x0, ST.top - 1, ST.x1, ST.top - 1],
      [TC.x0, ROOF - 1, BK.x1, ROOF - 1],
      [GW.x0, GW.top - 1, GW.x1, GW.top - 1],
      [BOX.x0, BOX.y0 - 1, BOX.x1, BOX.y0 - 1],
      [PL.terrace.x0, POD - 9, PL.terrace.x1, POD - 9],
      [TW.x0, POD - 1, PL.terrace.x0 - 1, POD - 1],
      [PL.terrace.x1 + 1, POD - 1, GW.x0 - 1, POD - 1],
      [GW.x0, POD - 3, GW.x1, POD - 3],
      [TW.x0, SHOP_Y0 - 6, BK.x1, SHOP_Y0 - 6],
    ];
    PL.drips = [
      { x: GW.x0, y: POD + 3 },
      { x: 308, y: POD + 3 },
      { x: 327, y: POD + 3 },
      { x: GW.x1, y: POD + 3 },
      { x: BOX.x0, y: BOX.y1 + 3 },
      { x: BOX.x1 + 1, y: BOX.y1 + 3 },
      { x: TW.x0, y: TW.top + 3 },
      { x: GW.x1, y: GW.top + 3 },
      { x: 190, y: POD + 2 },
      { x: 238, y: POD + 2 },
    ];
  }

  HD.module('building-apt2', {
    init: register,
    lights,
    passes: [
      {
        layer: 'scene',
        z: 26,
        id: 'block',
        draw(g, t) {
          if (!here()) return;
          const a = art();
          g.sprite(a.base, BX, BY);
          g.em.sprite(a.em, BX, BY);
          drawLiving(g, t, a);
        },
      },
      {
        layer: 'scene',
        z: 27,
        id: 'his-window',
        draw(g, t) {
          if (!here()) return;
          drawRoom(g, t, HD.edition, art());
        },
      },
    ],
  });
})();
