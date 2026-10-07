/*
 * Summer Story family cats (see SUMMER.md). Owned by the family module.
 *
 * Every family member is a small upright cat built from ASCII parts (head,
 * features, hair, outfit, arms) and baked once per pose into a sprite pair
 * (albedo + emissive eye-shine/glints), then blitted per frame. Poses are
 * chosen from t only (pure, loop-safe), idle life runs at 8 fps.
 *
 * Draws NOTHING unless HD.edition.story is true. The family adds no lights of
 * its own: the cats sit inside the pools the chapter's real sources cast
 * (porch lantern, cake candles, plaza lanterns, heater, heart lantern), and
 * the outfits are painted as mid-tones that still read at ambient.
 *
 *  match: you (red Spain-style jersey) + partner on the porch steps watching
 *    the TV in the ground-left window, cheering at the goal; the niece drops by.
 *  home: partner beside the series cat in the lit upper-right window
 *    (silhouette, z 29.7); the niece drops by.
 *  nyc / la / sandiego: the family outdoors at z 47.
 *  dc: a back row behind the birthday table (z 33) and a front row (z 47).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const LAY = HD.layout;
  const SU = LAY.summer;
  const R = Math.round;

  // ---------------------------------------------------------------------
  // colour helpers: paint each outfit as its "night" colour. FILL is the
  // modest warm light the cats typically get from the chapter's sources, so
  // colours read at ambient and warm up (without blowing out) when lit.
  // ---------------------------------------------------------------------
  const FILL = 0.3;
  const AMB = HD.AMBIENT || [0.34, 0.38, 0.52];
  const LC = HD.LIGHT.candle;
  function rgb(h) {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function hex(r, g, b) {
    const c = (x) => Math.max(0, Math.min(255, R(x))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }
  /** daytime colour -> night albedo that relights back to it under FILL */
  function nite(h, k) {
    const kk = k === undefined ? FILL : k;
    const [r, g, b] = rgb(h);
    return hex(r / (1 + (kk * LC[0]) / AMB[0]), g / (1 + (kk * LC[1]) / AMB[1]), b / (1 + (kk * LC[2]) / AMB[2]));
  }

  // ---------------------------------------------------------------------
  // grid helpers
  // ---------------------------------------------------------------------
  function grid(w, h) {
    const G = [];
    for (let y = 0; y < h; y++) G.push(new Array(w).fill('.'));
    return G;
  }
  function set(G, x, y, ch) {
    if (y >= 0 && y < G.length && x >= 0 && x < G[0].length) G[y][x] = ch;
  }
  function get(G, x, y) {
    return y >= 0 && y < G.length && x >= 0 && x < G[0].length ? G[y][x] : '.';
  }
  function stamp(G, rows, ox, oy) {
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) if (rows[y][x] !== '.') set(G, ox + x, oy + y, rows[y][x]);
  }
  const EMCH = 'zeyw';
  const OUTLINE = '#0b0910';
  function bake(G, map, emMap) {
    // pad by one cell and add a dark 1px outline (not under the feet) so the
    // small characters read against the lit grass
    const H0 = G.length;
    const W0 = G[0].length;
    const Q = grid(W0 + 2, H0 + 2);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) Q[y + 1][x + 1] = G[y][x];
    for (let y = 0; y < H0 + 1; y++)
      for (let x = 0; x < W0 + 2; x++) {
        if (Q[y][x] !== '.') continue;
        const n = (xx, yy) => yy >= 0 && yy < H0 + 2 && xx >= 0 && xx < W0 + 2 && Q[yy][xx] !== '.' && Q[yy][xx] !== 'o';
        if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) Q[y][x] = 'o';
      }
    map = Object.assign({ o: OUTLINE }, map);
    const rows = Q.map((r) => r.join(''));
    const alb = HD.sprite(rows, map);
    let em = null;
    if (emMap && rows.some((r) => [...r].some((c) => EMCH.includes(c) && emMap[c]))) em = HD.sprite(rows, emMap);
    return { alb, em, w: alb.width, h: alb.height };
  }
  function blit(g, s, x, y) {
    g.sprite(s.alb, x - 1, y - 1);
    if (s.em) g.em.sprite(s.em, x - 1, y - 1);
  }
  const cache = new Map();
  function memo(key, fn) {
    let s = cache.get(key);
    if (!s) cache.set(key, (s = fn()));
    return s;
  }

  // ---------------------------------------------------------------------
  // adult cat: 17x19 grid, head 9x7 at (HX0.., HY0..), body 9 wide at BX, BY.
  // Two rows of headroom above the ears for raised paws.
  // stand: feet on the last row (base); sit: lap row BY+3 = seat
  // ---------------------------------------------------------------------
  const AW = 17;
  const AH = 19;
  const CX = 8; // centre column
  const BX = 4;
  const BY = 12;
  const HX0 = 4;
  const HY0 = 5;
  const HEAD = ['.E.....E.', '.EI...IE.', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const HEAD_FLICK = ['.......E.', 'EEI...IE.', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  // ears pushed to the corners (a rider sits between them)
  const HEAD_WIDE = ['E.......E', 'EI.....IE', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const BODY = {
    stand: ['..SSSSS..', '.SSSSSSS.', '.SSSSSSS.', '.hSSSSSh.', '..LLLLL..', '..LL.LL..', '..kk.kk..'],
    round: ['..SSSSS..', '.SSSSSSS.', 'SSSSSSSSS', 'hSSSSSSSh', '.LLLLLLL.', '..LL.LL..', '..kk.kk..'],
    sit: ['..SSSSS..', '.SSSSSSS.', '.SSSSSSS.', '.hLLLLLh.', '..LL.LL..', '..kk.kk..'],
  };
  // raised arms, left side as [dx from BX, y, ch]; mirrored for the right
  const ARM = {
    // cheer: sleeve from the shoulder, forearm up beside the head, paw above the ears
    up: [[1, BY, 'S'], [0, BY, 'S'], [0, BY - 1, 'S'], [-1, BY - 1, 'S'], [-1, BY - 2, 'h'], [-2, BY - 3, 'h'], [-2, BY - 4, 'h'], [-2, BY - 5, 'h'], [-2, BY - 6, 'h'], [-2, BY - 7, 'h'], [-2, BY - 8, 'h'], [-3, BY - 8, 'h']],
    // the other wave frame: the paw tips one pixel further out
    up2: [[1, BY, 'S'], [0, BY, 'S'], [0, BY - 1, 'S'], [-1, BY - 1, 'S'], [-1, BY - 2, 'h'], [-2, BY - 3, 'h'], [-2, BY - 4, 'h'], [-2, BY - 5, 'h'], [-2, BY - 6, 'h'], [-3, BY - 7, 'h'], [-3, BY - 8, 'h'], [-4, BY - 8, 'h']],
    // holding the rider's sneakers at cheek height
    shoulder: [[1, BY, 'S'], [0, BY, 'S'], [0, BY - 1, 'S'], [-1, BY - 1, 'h'], [-1, BY - 2, 'h']],
  };

  // ---- night-out wardrobe and single-paw poses (left side, mirrored) ----
  const NARM = {
    // forearm across the chest, paw under the chin (a songbook)
    chest: [[1, BY + 1, 'S'], [1, BY + 2, 'S'], [2, BY + 2, 'S'], [3, BY + 1, 'h']],
    // held out at the side at waist height (a glass, a mug, a lantern stick)
    out: [[1, BY + 1, 'S'], [0, BY + 2, 'h'], [-1, BY + 2, 'h']],
    // raised beside the head (a toast)
    toast: [[1, BY, 'S'], [0, BY, 'S'], [-1, BY - 1, 'S'], [-2, BY - 2, 'h'], [-2, BY - 3, 'h']],
    // straight out sideways at shoulder height (a cape spread wide)
    wide: [[1, BY, 'S'], [0, BY, 'S'], [-1, BY, 'S'], [-2, BY, 'S'], [-3, BY, 'h']],
    up: ARM.up,
    up2: ARM.up2,
  };
  function nightArm(G, side, kind, pawX) {
    const a = NARM[kind];
    if (!a) return;
    for (let y = BY + 1; y <= BY + 3; y++) if ('ShAC'.includes(get(G, pawX, y))) set(G, pawX, y, '.');
    for (const [dx, y, ch] of a) set(G, side < 0 ? BX + dx : BX + 8 - dx, y, ch);
  }
  /** body wear drawn before the arms: collars, long coats, dresses, capes */
  function nightWear(G, sp) {
    if (sp.neck === 'mandarin') {
      for (let x = BX + 3; x <= BX + 5; x++) set(G, x, BY, 'C');
      set(G, BX + 5, BY + 1, 'C');
    } else if (sp.neck === 'vneck') {
      set(G, BX + 4, BY, 'h');
      set(G, BX + 4, BY + 1, 'h');
    }
    if (sp.coat) {
      for (let x = BX + 2; x <= BX + 6; x++) set(G, x, BY + 4, 'S');
      set(G, BX + 4, BY + 1, 'A');
      set(G, BX + 4, BY + 3, 'A');
    }
    if (sp.dress) {
      for (let x = BX + 1; x <= BX + 7; x++) set(G, x, BY + 4, 'L');
      for (const x of [BX + 2, BX + 3, BX + 5, BX + 6]) if (get(G, x, BY + 5) === 'L') set(G, x, BY + 5, 'h');
    }
    if (sp.cape) {
      // falls from the shoulders and flares out to the ankles
      for (let y = BY; y <= BY + 6; y++) {
        set(G, BX, y, 'K');
        set(G, BX + 8, y, 'K');
      }
      for (let y = BY + 4; y <= BY + 6; y++) {
        set(G, BX - 1, y, 'K');
        set(G, BX + 9, y, 'K');
      }
      set(G, BX + 1, BY, 'K');
      set(G, BX + 7, BY, 'K');
    }
  }
  // hats in head coords [col, row, ch]; the head is 9 wide, ears at cols 1 and 7
  const WITCH_BRIM = [];
  for (let c = -1; c <= 9; c++) WITCH_BRIM.push([c, 1, 'a']);
  const HATS = {
    party: [[4, -3, 'p'], [4, -2, 'a'], [4, -1, 'c'], [3, 0, 'a'], [4, 0, 'a'], [5, 0, 'c'], [3, 1, 'c'], [4, 1, 'c'], [5, 1, 'a']],
    beanie: [[4, -1, 'p'], [3, 0, 'a'], [4, 0, 'a'], [5, 0, 'a'], [2, 1, 'a'], [3, 1, 'a'], [4, 1, 'a'], [5, 1, 'a'], [6, 1, 'a'], [1, 2, 'c'], [2, 2, 'c'], [3, 2, 'c'], [4, 2, 'c'], [5, 2, 'c'], [6, 2, 'c'], [7, 2, 'c']],
    witch: [[6, -4, 'a'], [5, -3, 'a'], [6, -3, 'a'], [4, -2, 'a'], [5, -2, 'a'], [3, -1, 'a'], [4, -1, 'a'], [5, -1, 'a'], [2, 0, 'd'], [3, 0, 'd'], [4, 0, 'd'], [5, 0, 'd'], [6, 0, 'd']].concat(WITCH_BRIM),
    crown: [[1, 2, 'v'], [2, 2, 'p'], [3, 2, 'v'], [4, 2, 'u'], [5, 2, 'v'], [6, 2, 'p'], [7, 2, 'v'], [3, 1, 'u'], [5, 1, 'p']],
    bunny: [[2, -4, 'a'], [3, -4, 'a'], [5, -4, 'a'], [6, -4, 'a'], [2, -3, 'a'], [3, -3, 'c'], [5, -3, 'c'], [6, -3, 'a'], [2, -2, 'a'], [3, -2, 'c'], [5, -2, 'c'], [6, -2, 'a'], [3, -1, 'a'], [5, -1, 'a'], [2, 0, 'd'], [3, 0, 'd'], [4, 0, 'd'], [5, 0, 'd'], [6, 0, 'd']],
    stem: [[4, 1, 'v'], [4, 0, 'v'], [5, -1, 'v']],
  };
  /** worn over fur and hair: hats, scarves, a cape's high collar */
  function nightTop(G, sp, HX, HY) {
    if (sp.hat) for (const [c, r, ch] of HATS[sp.hat]) set(G, HX + c, HY + r, ch);
    if (sp.scarf) {
      for (let x = BX + 2; x <= BX + 6; x++) set(G, x, BY, x & 1 ? 'r' : 's');
      const tx = sp.scarf === 'L' ? BX + 3 : BX + 5;
      set(G, tx, BY + 1, 's');
      set(G, tx, BY + 2, 'r');
    }
    if (sp.cape) {
      // tall collar points either side of the jaw, red inside
      set(G, HX - 1, HY + 4, 'K');
      set(G, HX - 1, HY + 5, 'K');
      set(G, HX - 1, HY + 6, 'K');
      set(G, HX, HY + 6, 'c');
      set(G, HX + 9, HY + 4, 'K');
      set(G, HX + 9, HY + 5, 'K');
      set(G, HX + 9, HY + 6, 'K');
      set(G, HX + 8, HY + 6, 'c');
    }
  }

  /**
   * sp: character spec (colours + traits), p: pose
   *  p.look -1|0|1, p.blink, p.ear, p.eyes 'open'|'happy'|'closed',
   *  p.mouth 'none'|'smile'|'laugh'|'o', p.arms 'down'|'up'|'shoulder'|
   *  'wave'|'wave2'|'offer'|'hold', p.sit, p.hx/p.hy head offset,
   *  p.br breeze px (-2..2), p.gust -1|0|1
   */
  function buildAdult(sp, p) {
    const G = grid(AW, AH);
    const HX = HX0 + (p.hx || 0);
    const HY = HY0 + (p.hy || 0);
    const sit = !!p.sit;
    // ---- body (does not move with the head) ----
    const body = sit ? BODY.sit : sp.round ? BODY.round : BODY.stand;
    stamp(G, body, BX, BY);
    // shirt pattern
    for (let y = BY; y < BY + 4; y++)
      for (let x = 0; x < AW; x++) {
        if (G[y][x] !== 'S') continue;
        const u = x - BX;
        const v = y - BY;
        if (sp.pattern === 'stripesV' && u % 2 === 1) G[y][x] = 'A';
        else if (sp.pattern === 'stripesH' && v % 2 === 1) G[y][x] = 'A';
        else if (sp.pattern === 'plaid' && (u % 3 === 1 || v === 2)) G[y][x] = 'A';
        else if (sp.pattern === 'floral' && (u * 3 + v * 5) % 7 === 2) G[y][x] = 'A';
        // night-out wardrobe (only the night-out cast uses these)
        else if (sp.pattern === 'band' && v === 2) G[y][x] = 'A';
        else if (sp.pattern === 'cable' && v >= 1 && u % 3 === 1) G[y][x] = 'A';
        else if (sp.pattern === 'hem' && v === 3) G[y][x] = 'A';
        else if (sp.pattern === 'bones' && ((u === 4 && v >= 1) || ((v === 1 || v === 3) && u >= 2 && u <= 6 && u !== 4))) G[y][x] = 'A';
        else if (sp.pattern === 'jack' && ((v === 1 && (u === 2 || u === 6)) || (v === 2 && u === 4) || (v === 3 && u >= 2 && u <= 6 && u !== 4))) G[y][x] = 'A';
      }
    if (sp.neck === 'tee') set(G, BX + 4, BY, 'h');
    if (sp.neck === 'polo' || sp.neck === 'shirt') {
      set(G, BX + 3, BY, 'C');
      set(G, BX + 5, BY, 'C');
      set(G, BX + 4, BY, 'h');
    }
    if (sp.neck === 'shirt') {
      set(G, BX + 4, BY + 1, 'A');
      set(G, BX + 4, BY + 2, 'A');
    }
    if (sp.sleeveTip) {
      const w = sp.round ? 0 : 1;
      set(G, BX + w, BY + 2, 'C');
      set(G, BX + 8 - w, BY + 2, 'C');
    }
    // waistband: separates a pale tee from pale shorts
    if (sp.belt && !sit) for (let x = BX + 2; x <= BX + 6; x++) set(G, x, BY + 4, 'Q');
    if (sp.belt && sit) for (let x = BX + 2; x <= BX + 6; x++) set(G, x, BY + 3, 'Q');
    if (sp.night && !sit) nightWear(G, sp);
    // ---- arms ----
    const pawL = sp.round ? BX : BX + 1;
    const pawR = sp.round ? BX + 8 : BX + 7;
    const arms = p.arms || 'down';
    const raise = (side, kind) => {
      const sx = side < 0 ? pawL : pawR;
      for (let y = BY + 1; y <= BY + 3; y++) if ('ShAC'.includes(get(G, sx, y))) set(G, sx, y, '.');
      for (const [dx, y, ch] of ARM[kind]) set(G, side < 0 ? BX + dx : BX + 8 - dx, y, ch);
    };
    if (arms === 'up') {
      raise(-1, 'up');
      raise(1, 'up');
    } else if (arms === 'shoulder') {
      raise(-1, 'shoulder');
      raise(1, 'shoulder');
    } else if (arms === 'wave') raise(1, 'up');
    else if (arms === 'wave2') raise(1, 'up2');
    else if (arms === 'offer') {
      for (let y = BY + 1; y <= BY + 3; y++) set(G, pawL, y, '.');
      set(G, pawL, BY + 1, 'S');
      set(G, pawL - 1, BY + 2, 'h');
      set(G, pawL - 2, BY + 2, 'h');
    } else if (arms === 'hold') {
      set(G, pawL, BY + 3, '.');
    }
    // night-out: each paw posed on its own (p.al / p.ar)
    if (p.al) nightArm(G, -1, p.al, pawL);
    if (p.ar) nightArm(G, 1, p.ar, pawR);
    // ---- head ----
    stamp(G, p.wide ? HEAD_WIDE : p.ear ? HEAD_FLICK : HEAD, HX, HY);
    if (sp.temples) for (const [x, y] of [[0, 3], [8, 3], [1, 2], [7, 2], [0, 4], [8, 4]]) set(G, HX + x, HY + y, 'x');
    if (sp.tabby) for (const [x, y] of [[3, 2], [5, 2], [4, 3], [0, 3], [8, 3], [1, 5], [7, 5]]) set(G, HX + x, HY + y, 'O');
    if (sp.sheen && sp.hair !== 'long') for (const [x, y] of [[2, 2], [3, 2]]) set(G, HX + x, HY + y, 'J');
    const L = HX + (p.look || 0);
    // muzzle
    if (sp.muzzle) {
      set(G, L + 3, HY + 5, sp.muzzle);
      set(G, L + 5, HY + 5, sp.muzzle);
      set(G, L + 4, HY + 6, sp.muzzle);
    }
    // eyes / glasses
    const eyes = p.blink ? 'closed' : p.eyes || 'open';
    const arc = sp.happyEm ? 'e' : 'q';
    if (sp.glasses) {
      const av = sp.glasses === 'aviator';
      if (eyes === 'happy') {
        // the frame stays on the eyes; happy arcs peek out under it
        for (let k = 1; k <= 7; k++) set(G, L + k, HY + 3, 'g');
        for (const ox of [2, 6]) {
          set(G, L + ox - 1, HY + 5, arc);
          set(G, L + ox, HY + 4, arc);
          set(G, L + ox + 1, HY + 5, arc);
        }
      } else {
        // two 2x2 lenses on a 1px bridge; outer head columns and muzzle stay clear
        for (const ox of [2, 5])
          for (let k = 0; k < 2; k++) {
            set(G, L + ox + k, HY + 3, 'G');
            set(G, L + ox + k, HY + 4, 'G');
          }
        set(G, L + 1, HY + 3, 'g');
        set(G, L + 4, HY + 3, 'g');
        set(G, L + 7, HY + 3, 'g');
        set(G, L + 2, HY + 3, 'z');
        set(G, L + 5, HY + 3, 'z');
        if (av) {
          // teardrop: the outer lower corner drops a pixel
          set(G, L + 2, HY + 5, 'G');
          set(G, L + 6, HY + 5, 'G');
        }
      }
    } else if (eyes === 'happy') {
      for (const ox of [2, 6]) {
        set(G, L + ox - 1, HY + 4, arc);
        set(G, L + ox, HY + 3, arc);
        set(G, L + ox + 1, HY + 4, arc);
      }
    } else {
      for (const ox of [2, 6]) set(G, L + ox, HY + 4, eyes === 'closed' ? 'q' : 'e');
    }
    set(G, L + 4, HY + 5, 'n');
    const mouth = p.mouth || sp.mouth || 'smile';
    if (mouth === 'smile') {
      set(G, L + 3, HY + 6, 'm');
      set(G, L + 5, HY + 6, 'm');
    } else if (mouth === 'laugh') {
      set(G, L + 3, HY + 6, 'm');
      set(G, L + 4, HY + 6, 'M');
      set(G, L + 5, HY + 6, 'm');
    } else if (mouth === 'o') {
      set(G, L + 4, HY + 6, 'm');
      set(G, HX - 1, HY + 5, 'F');
      set(G, HX + 9, HY + 5, 'F');
    }
    if (sp.whiskers && mouth !== 'o') {
      // one dim tick per side, on alternating rows
      set(G, HX - 1, HY + 5, 'w');
      set(G, HX + 9, HY + 4, 'w');
    }
    // ---- long straight hair (partner) ----
    if (sp.hair === 'long') {
      const br = p.br || 0;
      // crown cap down to the brows
      for (let x = 1; x <= 7; x++) set(G, HX + x, HY + 2, 'H');
      for (const x of [0, 1, 7, 8]) set(G, HX + x, HY + 3, 'H');
      set(G, HX + 2, HY + 2, 'J');
      set(G, HX + 3, HY + 2, 'J');
      // 2px curtains framing the face
      for (let y = HY + 3; y <= HY + 6; y++) {
        set(G, HX - 1, y, 'H');
        set(G, HX, y, 'H');
        set(G, HX + 8, y, 'H');
        set(G, HX + 9, y, 'H');
      }
      set(G, HX - 1, HY + 4, 'J');
      set(G, HX - 1, HY + 5, 'J');
      // over the shoulders onto the tee, down to the waist; the lower rows
      // trail with the breeze
      const sg = Math.sign(br);
      const ab = Math.abs(br);
      for (let i = 0; i < 4; i++) {
        const y = BY + i;
        const d = sg * Math.min(ab, i === 0 ? 0 : i < 3 ? 1 : 2);
        const lx = (i === 0 ? BX : BX + 1) + d;
        const rx = (i === 0 ? BX + 7 : BX + 6) + d;
        set(G, lx, y, i === 1 ? 'J' : 'H');
        set(G, lx + 1, y, 'H');
        set(G, rx, y, 'H');
        set(G, rx + 1, y, 'H');
      }
      // one strand lifts at the top of a gust
      if (p.gust) set(G, p.gust > 0 ? HX + 10 : HX - 2, HY + 3, 'H');
    }
    // ---- wavy hair (sister) ----
    if (sp.hair === 'wavy') {
      for (let y = HY + 2; y <= HY + 11; y++) {
        const k = y - HY;
        const drift = k >= 7 ? Math.sign(p.br || 0) : 0;
        const wv = k % 3 === 1 ? 1 : 0;
        if (k >= 3 && k <= 6) {
          set(G, HX + 0, HY + k, 'H');
          set(G, HX + 8, HY + k, 'H');
        }
        if (k >= 4) {
          set(G, HX - 1 - wv + drift, y, k === 5 ? 'J' : 'H');
          set(G, HX + 9 + wv + drift, y, 'H');
          if (k >= 9) {
            set(G, HX - 2 + drift, y, 'H');
            set(G, HX + 10 + drift, y, 'H');
          }
        }
      }
      set(G, HX + 1, HY + 2, 'H');
      set(G, HX + 7, HY + 2, 'H');
    }
    if (sp.headband) {
      for (let x = 1; x <= 7; x++) set(G, HX + x, HY + 2, 'B');
      // bow at the top left, beside the ear
      set(G, HX + 1, HY - 1, 'B');
      set(G, HX + 3, HY - 1, 'B');
      set(G, HX + 1, HY + 0, 'B');
      set(G, HX + 2, HY + 0, 'b');
      set(G, HX + 3, HY + 0, 'B');
      set(G, HX + 2, HY + 1, 'B');
    }
    // night-out: hats, scarves and collars go on last, over fur and hair
    if (sp.night) nightTop(G, sp, HX, HY);
    return G;
  }

  function adultMap(sp) {
    const F = sp.fur;
    const m = {
      E: F,
      F,
      h: F,
      I: sp.inner || nite('#b06878'),
      O: sp.dark || F,
      x: sp.silver || F,
      w: sp.whisker || '#6a6c76',
      f: sp.light || F,
      J: sp.sheenC || F,
      H: sp.hairC || F,
      n: sp.nose || nite('#c07080'),
      m: sp.mouthC || '#0a070c',
      M: nite('#e07080'),
      q: sp.lid || '#07060a',
      S: sp.shirt,
      A: sp.shirtAlt || sp.shirt,
      C: sp.collar || sp.shirt,
      L: sp.pants,
      Q: sp.belt || sp.pants,
      k: sp.shoes || '#121218',
      g: sp.frame || '#2c3242',
      G: sp.lens || '#0c0f18',
      B: sp.bow || nite('#3a6ad0'),
      b: sp.bowDark || nite('#244a9a'),
    };
    if (sp.night) {
      // night-out wardrobe: hat, hat stripe/lining, hat band, pompom/flower,
      // second flower, leaf/stem, scarf stripes, cape
      Object.assign(m, { a: sp.hatC, c: sp.hatC2 || sp.hatC, d: sp.hatBand || sp.hatC, p: sp.pom, u: sp.flower2 || sp.pom, v: sp.leaf, r: sp.scarfC, s: sp.scarfC2 || sp.scarfC, K: sp.capeC });
    }
    const em = { e: sp.eye || '#d9b45a', z: sp.glint || '#a8c4e8' };
    return { m, em };
  }
  function adult(sp, p) {
    let key = sp.key + '|' + (p.look || 0) + (p.blink ? 'b' : '') + (p.ear ? 'e' : '') + (p.eyes || '') + '|' + (p.mouth || '') + '|' + (p.arms || '') + (p.sit ? 's' : '') + (p.wide ? 'w' : '') + '|' + (p.hx || 0) + ',' + (p.hy || 0) + ',' + (p.br || 0) + ',' + (p.gust || 0);
    if (p.al || p.ar) key += '|' + (p.al || '') + ',' + (p.ar || '');
    return memo(key, () => {
      const mp = sp._map || (sp._map = adultMap(sp));
      return bake(buildAdult(sp, p), mp.m, mp.em);
    });
  }

  // ---------------------------------------------------------------------
  // niece kitten. Head 9x7 (pointed ears, top-knot) with a big pink bow on
  // the top-knot, tiny body. Head col c / row r -> world (x-4+c, base-9+r);
  // feet on base. Grid: head col 0 = KX, head row 0 = KR (+ extra rows)
  // ---------------------------------------------------------------------
  const NW = 15;
  const NH = 13;
  const KX = 3;
  const KR = 3;
  const KHEAD = ['.E..t..E.', '.EIFFFIE.', 'FFFfffFFF', 'FfwWfwWfF', 'FFWvnWvFF', '.cFlslFc.', '..FFFFF..'];
  const KHEAD_BLINK = ['.E..t..E.', '.EIFFFIE.', 'FFFfffFFF', 'FfFFfFFfF', 'FFqqnqqFF', '.cFlslFc.', '..FFFFF..'];
  const KFEAT = 'wWvnsql';
  // BIG pink bow: two lobes with a highlight each and a dark knot, sitting on
  // the brown top-knot tuft (head cols 2..6, rows -3..-1)
  const KBOW = ['Pp.pP', 'ppkpp', 'pp.pp'];
  // raised arms, left side [col, row, ch] in head coords; mirrored (8-col)
  const KARM = {
    up: [[2, 7, 'T'], [1, 6, 'T'], [0, 5, 'h'], [-1, 4, 'h'], [-2, 3, 'h'], [-2, 2, 'h'], [-2, 1, 'h'], [-2, 0, 'h'], [-2, -1, 'h'], [-2, -2, 'h']],
    up2: [[2, 7, 'T'], [1, 6, 'T'], [0, 5, 'h'], [-1, 4, 'h'], [-2, 3, 'h'], [-2, 2, 'h'], [-2, 1, 'h'], [-2, 0, 'h'], [-2, -1, 'h'], [-3, -2, 'h']],
    lift: [[2, 7, 'T'], [1, 6, 'T'], [0, 5, 'h'], [-1, 4, 'h'], [-1, 3, 'h'], [-1, 2, 'h'], [-1, 1, 'h'], [-1, 0, 'h'], [-1, -1, 'h'], [-1, -2, 'h'], [-1, -3, 'h'], [0, -4, 'h'], [0, -5, 'h']],
  };
  /**
   * p.pose: stand|walk|sit|ride|held|carry|lift
   * p.arms: down|up|wave|wave2 (lift/carry set their own)
   * p.blink, p.look
   */
  function buildKit(o, p) {
    const pose = p.pose || 'stand';
    const extra = pose === 'lift' ? 2 : 0;
    const G = grid(NW, NH + extra);
    const ox = KX;
    const oy = KR + extra;
    const S = (c, r, ch) => set(G, ox + c, oy + r, ch);
    const look = p.look || 0;
    // ---- body (rows 7..9) ----
    const top = pose === 'ride' ? ['...TTT...', '...TTT...'] : o.dress ? ['...TTT...', '..TUTUT..'] : ['...TTT...', '..TTTTT..'];
    stamp(G, top, ox, oy + 7);
    if (o.stripes) for (let c = 2; c <= 6; c++) if (get(G, ox + c, oy + 8) === 'T') S(c, 8, 'U');
    if (o.vest) {
      // tiny orange life vest: two strips and a strap across
      S(3, 7, 'V');
      S(5, 7, 'V');
      S(3, 8, 'V');
      S(5, 8, 'V');
      S(4, 8, 'V');
    }
    if (pose === 'walk' || pose === 'sit') stamp(G, ['..z...z..'], ox, oy + 9);
    else if (pose !== 'ride') stamp(G, ['...z.z...'], ox, oy + 9);
    // ---- arms ----
    let arms = p.arms || 'down';
    if (pose === 'lift') arms = 'lift';
    const raise = (side, kind) => {
      for (const [c, r, ch] of KARM[kind]) S(side < 0 ? c : 8 - c, r, ch);
    };
    if (arms === 'up' || arms === 'lift') {
      raise(-1, arms);
      raise(1, arms);
    } else if (arms === 'wave' || arms === 'wave2') {
      raise(1, arms === 'wave' ? 'up' : 'up2');
      if (pose !== 'ride') S(1, 8, 'h');
    } else if (pose === 'carry') {
      S(0, 7, 'h');
      S(8, 7, 'h');
    } else if (pose === 'ride') {
      // paws resting on the rider's knees: none drawn beside the body
    } else {
      S(1, 8, 'h');
      S(7, 8, 'h');
    }
    // ---- head ----
    const head = p.blink ? KHEAD_BLINK : KHEAD;
    for (let r = 0; r < head.length; r++)
      for (let c = 0; c < head[r].length; c++) {
        const ch = head[r][c];
        if (ch === '.') continue;
        // the face shape stays, features follow the look direction
        S(c, r, KFEAT.includes(ch) ? (r === 3 ? 'f' : 'F') : ch);
      }
    for (let r = 0; r < head.length; r++)
      for (let c = 0; c < head[r].length; c++) {
        const ch = head[r][c];
        if (KFEAT.includes(ch)) S(c + look, r, ch);
      }
    // ---- bow on the top-knot ----
    for (let r = 0; r < KBOW.length; r++)
      for (let c = 0; c < KBOW[r].length; c++) if (KBOW[r][c] !== '.') S(2 + c, r - 3, KBOW[r][c]);
    S(4, -1, 't');
    if (pose === 'held' && o.cup) {
      S(7, 7, 'Y');
      S(7, 8, 'y');
      S(6, 8, 'h');
    }
    return G;
  }
  const KIT_C = {
    F: nite('#6e4430'),
    E: nite('#6e4430'),
    I: nite('#e88aa0'),
    t: nite('#8a5638'),
    f: nite('#946247'),
    l: nite('#d6a888'),
    v: '#2a2a4a',
    h: nite('#6e4430'),
    p: nite('#ff5aa0', 0.22),
    P: nite('#ffc4e0', 0.22),
    k: nite('#b02a68', 0.22),
    W: '#0a070c',
    n: nite('#e08a96'),
    s: nite('#a03848'),
    c: nite('#f08a9a'),
    q: '#120c10',
    z: nite('#d83a3a'),
    Y: nite('#ffd23a'),
    V: nite('#ff7a1a', 0.22),
  };
  function kitMap(o) {
    const m = Object.assign({}, KIT_C, { T: o.top, U: o.alt || o.top });
    if (o.cup) m.y = nite('#f0e8d8');
    return { m, em: { w: '#ffffff' } };
  }
  function kit(o, p) {
    const key = 'kit|' + o.key + '|' + (p.pose || 'stand') + '|' + (p.arms || 'down') + (p.blink ? 'b' : '') + (p.look || 0);
    return memo(key, () => {
      const mp = o._map || (o._map = kitMap(o));
      return bake(buildKit(o, p), mp.m, mp.em);
    });
  }
  /** blit the kitten so her feet sit on base, centred on x */
  function blitKit(g, o, p, x, base) {
    const s = kit(o, p);
    const extra = p.pose === 'lift' ? 2 : 0;
    blit(g, s, x - 4 - KX, base - 9 - KR - extra);
  }

  // ---------------------------------------------------------------------
  // cast per chapter
  // ---------------------------------------------------------------------
  const BLACK = '#100d16';
  const WARM_WHITE = nite('#fff6e8');
  const KIT_OUT = {
    blue: { key: 'blue', top: nite('#3c66e0') },
    la: { key: 'stripe', top: nite('#26346a'), alt: nite('#fff6e8'), stripes: true },
    sandiego: { key: 'bay', top: nite('#26346a'), alt: nite('#fff6e8'), stripes: true, vest: true },
    dc: { key: 'dress', top: nite('#6a1830', 0.2), alt: nite('#f4c8d4'), dress: true, cup: true },
  };
  const YOU = {};
  function you(ed) {
    return YOU[ed] || (YOU[ed] = makeYou(ed));
  }
  function makeYou(ed) {
    const base = {
      fur: BLACK,
      light: '#241e2c',
      inner: nite('#7a4050'),
      nose: '#2a1a24',
      eye: HD.color.mix(P.amber[7], P.spirit[3], 0.45),
      mouth: 'smile',
      mouthC: '#6e5872',
      frame: '#454b60',
      lens: '#161c2a',
      happyEm: true,
      neck: 'tee',
    };
    if (ed === 'match')
      return Object.assign(base, { key: 'you-match', shirt: nite('#c8102e'), collar: nite('#ffc400'), neck: 'polo', sleeveTip: true, pants: nite('#2a2a34') });
    if (ed === 'nyc') return Object.assign(base, { key: 'you-nyc', shirt: nite('#f07a68'), pants: nite('#d8ccb0'), glasses: 'wayfarer' });
    if (ed === 'la')
      return Object.assign(base, { key: 'you-la', shirt: nite('#b8343c'), shirtAlt: nite('#2a3460'), pattern: 'plaid', neck: 'shirt', collar: nite('#c84450'), pants: nite('#3a3a44'), glasses: 'wayfarer' });
    if (ed === 'sandiego')
      return Object.assign(base, { key: 'you-sd', shirt: WARM_WHITE, pants: nite('#8e887a'), belt: nite('#3a3028'), glasses: 'wayfarer', shoes: nite('#e8e4dc') });
    return Object.assign(base, {
      key: 'you-dc',
      shirt: nite('#7aa6e8'),
      shirtAlt: nite('#a8c8f4'),
      collar: nite('#a8c8f4'),
      neck: 'shirt',
      pants: nite('#e8e0cc'),
      glasses: 'aviator',
      frame: nite('#b0b4c0'),
      lens: nite('#3a7ae0', 0.2),
      glint: '#bfe6ff',
    });
  }
  const PARTNER = {
    key: 'partner',
    fur: '#1a1418',
    hair: 'long',
    hairC: '#2a2236',
    happyEm: true,
    sheenC: nite('#6a6490'),
    light: '#2a1e24',
    eye: '#c8d870',
    nose: nite('#a05868'),
    mouth: 'smile',
    mouthC: '#3a1a22',
    shirt: WARM_WHITE,
    neck: 'tee',
    pants: nite('#2a2a34'),
  };
  const SISTER = {
    key: 'sister',
    fur: '#21171a',
    hair: 'wavy',
    hairC: '#2a1a17',
    happyEm: true,
    sheen: true,
    sheenC: '#4c3228',
    eye: '#d8c070',
    nose: nite('#b06070'),
    mouth: 'smile',
    mouthC: '#3a1a22',
    headband: true,
    bow: nite('#3a78e8', 0.5),
    bowDark: nite('#2050b0', 0.5),
    shirt: nite('#3a68c0'),
    shirtAlt: nite('#f0f2f6'),
    pattern: 'stripesV',
    neck: 'shirt',
    collar: nite('#f0f2f6'),
    pants: nite('#ece8e0'),
    shoes: nite('#c8b890'),
  };
  const BIL = {
    key: 'bil',
    fur: nite('#8a8a90'),
    dark: nite('#3e3e46'),
    light: nite('#c8c8cc'),
    muzzle: 'f',
    tabby: true,
    eye: '#d8c070',
    nose: nite('#a86070'),
    mouth: 'smile',
    mouthC: '#2a1a22',
    glasses: 'aviator',
    frame: nite('#f0c040', 0.3),
    lens: nite('#8a5a2a', 0.3),
    glint: '#ffe0a0',
    shirt: nite('#f2ead2'),
    collar: nite('#fff8e6'),
    neck: 'polo',
    pants: nite('#2a2a30'),
    shoes: nite('#7a5a3a'),
  };
  const BIL_LA = Object.assign({}, BIL, { key: 'bil-la', shirt: nite('#d8dce4'), shirtAlt: nite('#7a8aa8'), pattern: 'stripesV', neck: 'shirt', collar: nite('#e8ecf2') });
  const DAD = {
    key: 'dad',
    fur: '#1f181b',
    silver: nite('#9a9ca4'),
    muzzle: 'x',
    temples: true,
    whiskers: true,
    whisker: '#5c5e68',
    happyEm: true,
    eye: '#d8b060',
    nose: nite('#a86070'),
    mouth: 'laugh',
    round: true,
    shirt: nite('#d42a30'),
    collar: nite('#ffffff'),
    neck: 'polo',
    sleeveTip: true,
    pants: nite('#1c1c22'),
    shoes: nite('#2a2a30'),
  };

  // ---------------------------------------------------------------------
  // idle life (8 fps, staggered by seed)
  // ---------------------------------------------------------------------
  function idle(t, seed) {
    const ts = T.step(t, 8);
    const bc = T.cycle(ts, 0, 4.1 + (seed % 7) * 0.43, seed * 31 + 1);
    const bAge = bc.age * bc.P;
    const bAt = 0.4 + bc.rnd(1) * (bc.P - 1);
    const dbl = bc.rnd(2) < 0.25;
    const blink = (bAge > bAt && bAge < bAt + 0.15) || (dbl && bAge > bAt + 0.3 && bAge < bAt + 0.42);
    const ec = T.cycle(ts, 1, 7.7 + (seed % 5) * 0.61, seed * 31 + 2);
    const eAge = ec.age * ec.P;
    const eAt = 0.5 + ec.rnd(1) * (ec.P - 1.2);
    const ear = eAge > eAt && eAge < eAt + 0.25;
    const n = T.noise(ts, 9 + (seed % 4) * 1.9, seed * 31 + 3);
    const look = n > 0.66 ? 1 : n < 0.34 ? -1 : 0;
    const sw = T.wave(ts, 4.3 + (seed % 3) * 0.8, seed * 0.137);
    return { blink, ear, look, sw, ts };
  }
  /** cheer hop, staggered per cat (k = 0..3) at 6 fps */
  function hopAt(t, k) {
    return (Math.floor(T.step(t, 6) * 6) + k) % 4 < 2 ? 1 : 0;
  }
  /** long-hair breeze: px drift (-2..2) and a gust strand side */
  function hairWind(t) {
    const b = HD.summer.breeze(t);
    return { br: Math.max(-2, Math.min(2, R(b * 2))), gust: b > 0.78 ? 1 : b < -0.78 ? -1 : 0 };
  }

  // tail: short curl from the hip; side -1 = left, +1 = right
  const TAILS = [
    [[1, 0], [2, -1], [3, -2], [3, -3], [3, -4], [2, -5]],
    [[1, 0], [2, -1], [3, -1], [4, -2], [4, -3], [4, -4], [3, -5]],
    [[1, 0], [2, 0], [3, -1], [4, -2], [5, -3], [5, -4], [5, -5]],
  ];
  function tail(g, x, y, side, sw, c) {
    const k = sw < -0.33 ? 0 : sw > 0.33 ? 2 : 1;
    const pts = TAILS[k];
    for (let i = 0; i < pts.length; i++) {
      const px = x + side * pts[i][0];
      const py = y + pts[i][1];
      g.px(px, py, c);
      if (i < 2) g.px(px, py - 1, c);
    }
  }
  // long plume tail hanging down (partner seated), drifts with breeze
  function plume(g, x, y, side, br, c, hi) {
    for (let i = 0; i < 7; i++) {
      const dx = side * (1 + Math.min(i, 3)) + R(br * Math.max(0, i - 2) * 0.25);
      g.px(x + dx, y + i, c);
      g.px(x + dx + side, y + i, c);
      if (i === 2) g.px(x + dx, y + i, hi);
    }
  }
  function shadow(g, x, base, hw) {
    for (let dx = -hw; dx <= hw; dx++) {
      if (Math.abs(dx) === hw && HD.bayer(x + dx, base) > 0.5) continue;
      g.px(x + dx, base + 1, '#0a120e');
    }
  }

  // ---------------------------------------------------------------------
  // a standing / sitting adult with idle life
  // ---------------------------------------------------------------------
  function drawAdult(g, t, sp, x, base, seed, o) {
    const id = idle(t, seed);
    const p = Object.assign({ look: id.look, blink: id.blink, ear: id.ear }, o || {});
    if (p.look === undefined) p.look = id.look;
    const s = adult(sp, p);
    const sit = !!p.sit;
    const top = base - (sit ? BY + 3 : AH - 1);
    const left = x - CX;
    if (!sit) shadow(g, x, base, sp.round ? 4 : 3);
    if (sp.tailSide !== 0 && !(o && o.noTail)) {
      const side = sp.tailSide || (seed % 2 ? 1 : -1);
      if (sit && sp.hair) plume(g, x + side * 3, base + 1, side, p.br || 0, sp.hairC || sp.fur, sp.sheenC || sp.fur);
      else tail(g, x + side * (sp.round ? 4 : 3), sit ? base + 1 : base - 3, side, id.sw, sp.fur);
    }
    blit(g, s, left, top);
    return { top, left, id, p };
  }
  /** cheer pose shared by everyone at a happy beat */
  function cheer(extra) {
    return Object.assign({ arms: 'up', mouth: 'laugh', eyes: 'happy', look: 0 }, extra || {});
  }

  // ---------------------------------------------------------------------
  // the niece
  // ---------------------------------------------------------------------
  function drawKit(g, t, o, x, base, p) {
    if (p.pose !== 'ride') {
      shadow(g, x, base, 2);
      // tiny tail
      const sw = T.wave(T.step(t, 8), 3.3, 0.4);
      g.px(x + 4, base - 2, KIT_C.F);
      g.px(x + 5, base - 3 + (sw > 0.3 ? -1 : 0), KIT_C.F);
    }
    blitKit(g, o, p, x, base);
  }
  function kitIdle(t, seed) {
    const id = idle(t, seed);
    return { blink: id.blink, look: id.look };
  }
  /** waving arm frame at 5 fps */
  function waveArm(t) {
    return Math.floor(T.step(t, 5) * 5) % 2 ? 'wave2' : 'wave';
  }

  // small yellow toy crane, 8x7, facing right: wheels, body, cab with a pale
  // window, a 5px diagonal boom; string + red hook drawn per frame
  const CRANE_ROWS = [
    // boom low / mid / high
    ['........', '........', '.....YYY', '.YY.Y...', '.gYY....', 'YYYYYY..', 'yyyyyyy.', '.KK..KK.'],
    ['........', '......YY', '.....Y..', '.YY.Y...', '.gYY....', 'YYYYYY..', 'yyyyyyy.', '.KK..KK.'],
    ['.......Y', '......Y.', '.....Y..', '.YY.Y...', '.gYY....', 'YYYYYY..', 'yyyyyyy.', '.KK..KK.'],
  ];
  const CRANE_TIP = [[7, 2], [7, 1], [7, 0]];
  const CRANE_C = { Y: nite('#ffd02a', 0.22), y: nite('#d89a10', 0.22), K: '#141218', g: nite('#d8e8f0', 0.22) };
  const craneArt = (b) => memo('crane' + b, () => bake(CRANE_ROWS[b].map((r) => r.split('')), CRANE_C, null));
  /** (x, base) = bottom centre of the wheels; boom 0..2; drop = string px */
  function drawCrane(g, x, base, boom, drop) {
    x = R(x);
    base = R(base);
    const s = craneArt(boom);
    const ox = x - 4;
    const oy = base - 7;
    blit(g, s, ox, oy);
    const [tx, ty] = CRANE_TIP[boom];
    const n = Math.max(1, Math.min(3 - ty, R(drop === undefined ? 3 : drop)));
    for (let i = 1; i <= n; i++) g.px(ox + tx, oy + ty + i, '#141218');
    g.px(ox + tx, oy + ty + n + 1, nite('#e04030', 0.22));
    g.px(ox + tx - 1, oy + ty + n + 1, nite('#e04030', 0.22));
  }
  // wrapped present 7x5: pink paper, gold ribbon and bow; lid = top 3 rows
  const BOX_ROWS = ['..R.R..', 'BBBRBBB', 'bbbRbbb', 'BBBRBBB', 'BBBRBBB'];
  const BOX_C = { B: nite('#f070b0', 0.22), b: nite('#c04888', 0.22), R: nite('#ffd040', 0.22) };
  const boxArt = (part) =>
    memo('box' + part, () => {
      const rows = part === 'lid' ? BOX_ROWS.slice(0, 3) : part === 'body' ? BOX_ROWS.slice(3) : BOX_ROWS;
      return bake(rows.map((r) => r.split('')), BOX_C, null);
    });
  /** (x, base) = bottom centre */
  function drawBox(g, x, base, part) {
    part = part || 'full';
    const h = part === 'lid' ? 3 : part === 'body' ? 2 : 5;
    blit(g, boxArt(part), R(x) - 3, R(base) - h + 1);
  }
  function sparkle(g, t, x, y) {
    const sp = Math.floor(T.step(t, 8) * 8) % 3;
    const e = g.em;
    e.px(x - 4 + sp, y, '#fff2b0');
    e.px(x + 4 - sp, y + 1, '#ffe08a');
    e.px(x, y - 2 + (sp % 2), '#ffffff');
  }

  // ---------------------------------------------------------------------
  // chapter scenes
  // ---------------------------------------------------------------------
  // NYC: you + partner on the anniversary bench
  const BENCH = SU.bench;
  const SEAT = BENCH.base - 6;
  const NYC_YOU = BENCH.x - 5;
  const NYC_PARTNER = BENCH.x + 6;
  const NYC_LEANS = [[57, 70], [177, 190], [118, 126], [222, 228]];
  /** 0 apart, 1 leaning in, 2 heads together (eases over 2 frames) */
  function nycLean(t) {
    const s = HD.summer.sec(T.step(t, 8));
    for (const [a, b] of NYC_LEANS) {
      if (s < a || s >= b) continue;
      const d = Math.min(s - a, b - s);
      return d < 0.25 ? 1 : 2;
    }
    return 0;
  }
  function drawNYC(g, t) {
    const lean = nycLean(t);
    const w = hairWind(t);
    const ys = you('nyc');
    const yi = idle(t, 3);
    drawAdult(g, t, Object.assign(ys, { tailSide: -1 }), NYC_YOU, SEAT, 3, {
      sit: true,
      hx: lean === 2 ? 1 : 0,
      look: lean ? 1 : yi.look,
      mouth: lean === 2 ? 'laugh' : 'smile',
    });
    const pi = idle(t, 8);
    drawAdult(g, t, Object.assign(PARTNER, { tailSide: 1 }), NYC_PARTNER, SEAT, 8, {
      sit: true,
      hx: -lean,
      hy: lean === 2 ? 1 : 0,
      look: lean ? -1 : pi.look,
      eyes: lean === 2 ? 'happy' : undefined,
      br: w.br,
      gust: w.gust,
    });
    drawHeart(g, t);
  }
  function drawHeart(g, t) {
    const u = HD.summer.heart(t);
    if (u < 0) return;
    // starts where the two heads meet
    const x0 = NYC_YOU + 5;
    const y0 = SEAT - BY - 3 + HY0 + 2;
    const x = R(x0 + T.wave(t, 2, 0.3) * (u > 0.15 ? 1 : 0));
    const y = R(y0 - u * 22);
    const e = g.em;
    const c1 = '#ff5a7a';
    const c2 = '#ffb0c4';
    const c0 = '#c0304e';
    if (u < 0.12) {
      e.px(x, y, c1);
      e.px(x - 1, y - 1, c1);
      e.px(x + 1, y - 1, c1);
      return;
    }
    const rows = ['.a.a.', 'abaaa', 'aaaaa', '.aaa.', '..a..'];
    const fade = u > 0.75 ? (u - 0.75) / 0.25 : 0;
    for (let r = 0; r < rows.length; r++)
      for (let c = 0; c < 5; c++) {
        const ch = rows[r][c];
        if (ch === '.') continue;
        if (fade > 0 && HD.bayer(c + x, r + y) < fade) continue;
        e.px(x - 2 + c, y - 2 + r, ch === 'b' ? c2 : r >= 3 ? c0 : c1);
      }
  }

  // LA: you, niece, sister, brother-in-law, gathered in the patio heater's glow
  const LA_X = SU.heater.x - 10; // you, just left of the heater
  const LA_A = LA_X - 18; // between her mum and you
  const LA_B = LA_X - 7; // three px from your feet
  function laKit(t) {
    const s = HD.summer.sec(t);
    const trips = [
      [50, 53, LA_A, LA_B],
      [110, 113, LA_B, LA_A],
      [170, 173, LA_A, LA_B],
      [224, 227, LA_B, LA_A],
    ];
    let x = LA_A;
    let walking = false;
    for (const [a, b, from, to] of trips) {
      if (s >= b) x = to;
      else if (s >= a) {
        x = from + ((to - from) * (s - a)) / (b - a);
        walking = true;
        break;
      } else break;
    }
    return { x: R(x), walking, nearYou: x > (LA_A + LA_B) / 2 };
  }
  function drawLA(g, t) {
    const k = laKit(t);
    drawAdult(g, t, Object.assign(BIL_LA, { tailSide: -1 }), LA_X - 42, 228, 5, {});
    drawAdult(g, t, Object.assign(SISTER, { tailSide: -1 }), LA_X - 29, 230, 6, { br: R(HD.summer.breeze(t)), look: k.nearYou ? undefined : 1 });
    const ys = you('la');
    const yi = idle(t, 3);
    const ts = T.step(t, 8);
    const hop = !k.walking && k.nearYou && T.cycle(ts, 2, 13, 77).age * 13 < 1.5;
    drawAdult(g, t, Object.assign(ys, { tailSide: -1 }), LA_X, 231, 3, { look: k.nearYou ? -1 : yi.look, mouth: hop ? 'laugh' : 'smile' });
    const ki = kitIdle(t, 11);
    const wf = Math.floor(ts * 8) % 2;
    const kp = k.walking ? (wf ? 'walk' : 'stand') : 'stand';
    const bob = (k.walking && wf) || (hop && wf) ? -1 : 0;
    drawKit(g, t, KIT_OUT.la, k.x, 235 + bob, {
      pose: kp,
      arms: hop ? 'up' : 'down',
      blink: ki.blink,
      look: k.walking ? 0 : k.nearYou ? 1 : -1,
    });
  }
  // San Diego: you with the niece on your shoulders, sister, brother-in-law,
  // in the porch lantern's pool
  function drawSD(g, t) {
    drawAdult(g, t, Object.assign(SISTER, { tailSide: -1 }), 150, 230, 6, { br: R(HD.summer.breeze(t)) });
    drawAdult(g, t, Object.assign(BIL, { tailSide: -1 }), 163, 228, 5, { look: 1 });
    const x = 180;
    const base = 232;
    const ys = you('sandiego');
    const yi = idle(t, 3);
    const me = drawAdult(g, t, Object.assign(ys, { tailSide: 1 }), x, base, 3, { arms: 'shoulder', wide: true, look: yi.look > 0 ? 1 : 0, mouth: 'smile' });
    // niece: waves now and then (2.5 s every ~9 s), sometimes both paws up
    const ts = T.step(t, 6);
    const wc = T.cycle(ts, 3, 9.2, 515);
    const wa = wc.age * wc.P;
    const both = wc.rnd(1) < 0.3;
    const waving = wa < 2.5;
    const ki = kitIdle(t, 12);
    const hy = me.top + HY0; // your ear-tip row
    // she sits on your crown between your ears: her seat row = your skull top
    const kb = hy + 2;
    // legs over your cheeks, sneakers in your paws at shoulder height
    const leg = KIT_C.F;
    for (const side of [-1, 1]) {
      g.px(x + side * 3, hy + 2, leg);
      g.px(x + side * 4, hy + 3, leg);
      g.px(x + side * 5, hy + 4, KIT_C.z);
    }
    blitKit(g, KIT_OUT.sandiego, {
      pose: 'ride',
      arms: waving ? (both ? 'up' : waveArm(t)) : 'down',
      blink: ki.blink,
      look: waving ? 1 : ki.look,
    }, x, kb);
  }

  // DC: the birthday. Sister, brother-in-law and dad stand behind the table
  // (z 33, the props table and cake cover their legs); you, the niece and her
  // crane are in front (z 47). Positions follow layout.summer.table and keep
  // the faces clear of the cake (x ~107..118 on the table top).
  const TB = SU.table;
  const BACK = TB.base - 7; // back-row feet, hidden behind the tablecloth
  const DCP = {
    sister: [TB.x - 21, BACK],
    bil: [TB.x - 11, BACK],
    dad: [TB.x + 10, BACK],
    you: [TB.x + 24, TB.base + 2],
    kit: [TB.x - 3, TB.base + 7],
    crane: [TB.x + 6, TB.base + 7],
    held: [TB.x + 18, BACK - 3], // in dad's arms, at his right side
  };
  function dcState(t) {
    const s = HD.summer.sec(t);
    const gift = HD.summer.gift(t);
    const out = HD.summer.candlesOut(t);
    const blow = HD.summer.blowing(t);
    // niece: held | lower | stand | gift | play | tuck | wantup | raise
    let kit = 'play';
    if (s < 34 || s >= 234) kit = 'held';
    else if (s < 36) kit = 'lower';
    else if (s < 40) kit = 'stand';
    else if (gift >= 0) kit = 'gift';
    else if (s >= 226 && s < 229) kit = 'tuck';
    else if (s >= 229 && s < 231) kit = 'wantup';
    else if (s >= 231 && s < 234) kit = 'raise';
    const pc = T.cycle(T.step(t, 8), 4, 7.3, 91);
    return { s, gift, out, blow, kit, cheer: out >= 0 && out < 0.55, play: pc.age * pc.P < 1.6 };
  }
  function dadPose(t, st) {
    const g0 = st.gift;
    let dp = { look: -1 };
    // leans toward the cake, head up over the candles
    if (st.blow >= 0) dp = { hx: -2, hy: -2, mouth: 'o', eyes: 'closed', look: -1 };
    else if (st.cheer) dp = cheer();
    else if (st.kit === 'held') dp = { arms: 'hold', look: 1, mouth: st.play ? 'laugh' : 'smile', eyes: st.play ? 'happy' : undefined };
    else if (st.kit === 'lower' || st.kit === 'raise') dp = { arms: 'offer', hy: 1, look: -1, mouth: 'smile' };
    else if (st.kit === 'gift') dp = g0 < 0.1 ? { hy: 2, look: -1 } : g0 < 0.4 ? { arms: 'offer', hy: 1, look: -1, mouth: 'smile' } : { look: -1, mouth: 'laugh', eyes: g0 > 0.7 ? 'happy' : undefined };
    else if (st.kit === 'tuck') dp = { arms: 'offer', hy: 1, look: -1, mouth: 'smile' };
    else if (st.out >= 0) dp = { look: -1, mouth: 'laugh', eyes: 'happy' };
    if (dp.eyes === undefined && dp.blink === undefined) dp.blink = idle(t, 9).blink;
    return dp;
  }
  function drawDCBack(g, t) {
    const st = dcState(t);
    const hb = (k) => (st.cheer ? hopAt(t, k) : 0);
    drawAdult(g, t, Object.assign(SISTER, { tailSide: -1 }), DCP.sister[0], DCP.sister[1] - hb(1), 6, st.cheer ? cheer() : { br: R(HD.summer.breeze(t)), look: 1 });
    drawAdult(g, t, Object.assign(BIL, { tailSide: -1 }), DCP.bil[0], DCP.bil[1] - hb(3), 5, st.cheer ? cheer() : { look: st.out >= 0 ? 1 : undefined, mouth: st.out >= 0 ? 'laugh' : 'smile' });
    const [dx, db] = DCP.dad;
    drawAdult(g, t, Object.assign(DAD, { tailSide: 1 }), dx, db - hb(2), 9, dadPose(t, st));
    if (st.kit === 'held') {
      // in his arms at his right side; he bounces her and they laugh
      const ki = kitIdle(t, 12);
      const [hx, hb0] = DCP.held;
      const bob = st.play && Math.floor(T.step(t, 4) * 4) % 2 ? -1 : 0;
      blitKit(g, KIT_OUT.dc, { pose: 'held', arms: st.play ? 'up' : 'down', blink: !st.play && ki.blink, look: -1 }, hx, hb0 + bob);
      g.px(hx - 3, hb0 - 1 + bob, DAD.fur); // dad's paw under her
      g.px(hx - 2, hb0 - 1 + bob, DAD.fur);
    }
  }
  function drawDC(g, t) {
    const st = dcState(t);
    const g0 = st.gift;
    const [dx, db] = DCP.dad;
    const dadTop = db - (AH - 1);

    // his breath: pale dithered puffs from his mouth up to the candles
    if (st.blow >= 0) {
      const mx = dx - CX + HX0 - 2 - 1 + 4;
      const my = dadTop + HY0 - 2 + 6;
      for (let i = 0; i < 3; i++) {
        const u = (st.blow * 2.4 + i * 0.34) % 1;
        const px = R(mx - 2 - 5 * u);
        const py = R(my - 1 - 5 * u + Math.sin(u * 6 + i) * 0.6);
        const a = 1 - u * 0.85;
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]])
          if (HD.bayer(px + ox, py + oy) < a * (ox || oy ? 0.6 : 1)) g.px(px + ox, py + oy, i === 1 ? '#d8ecff' : '#9cc0e4');
      }
    }

    // you, at the right end of the table
    const yhop = st.cheer ? hopAt(t, 0) : 0;
    drawAdult(g, t, Object.assign(you('dc'), { tailSide: 1 }), DCP.you[0], DCP.you[1] - yhop, 3, st.cheer ? cheer() : { look: -1, mouth: st.out >= 0 || st.play ? 'laugh' : 'smile' });

    // the niece
    const ki = kitIdle(t, 12);
    const o = KIT_OUT.dc;
    const [kx, kb] = DCP.kit;
    const cup = () => {
      g.px(kx - 5, kb - 1, KIT_C.Y);
      g.px(kx - 5, kb, nite('#f0e8d8'));
    };
    if (st.kit === 'held') return;
    if (st.kit === 'lower' || st.kit === 'raise') {
      // dad lifts her over the table front to the grass (and back up)
      const u = st.kit === 'lower' ? (st.s - 34) / 2 : 1 - (st.s - 231) / 3;
      const q = Math.min(1, Math.max(0, u));
      const [hx, hb0] = DCP.held;
      const x = R(hx + (kx - hx) * q);
      const b = R(hb0 + (kb - hb0) * q - Math.sin(q * Math.PI) * 3);
      blitKit(g, o, { pose: 'held', arms: 'up', look: -1 }, x, b);
      if (q < 0.6) g.px(x + 4, b - 3, DAD.fur);
      return;
    }
    if (st.kit === 'gift') {
      let pose = 'stand';
      let arms = 'down';
      if (g0 >= 0.4 && g0 < 0.6) pose = 'carry';
      else if (g0 >= 0.6 && g0 < 0.85) pose = 'lift';
      else if (g0 >= 0.85) arms = 'up';
      drawKit(g, t, o, kx, kb, { pose, arms, blink: pose === 'stand' && ki.blink, look: pose === 'stand' ? 1 : 0 });
      if (g0 >= 0.1 && g0 < 0.4) {
        // dad brings the box up from behind the table and holds it out to her
        const q = Math.min(1, (g0 - 0.1) / 0.24);
        const px = dx - CX + 1;
        const py = db - 5;
        drawBox(g, R(px + (kx + 4 - px) * q), R(py + (kb - 1 - py) * q - Math.sin(q * Math.PI) * 3));
      } else if (pose === 'carry') drawBox(g, kx, kb + 1);
      else if (pose === 'lift') {
        const top = kb - 9 - 4;
        if (g0 < 0.75) drawBox(g, kx, top - 1);
        else {
          // the lid pops off: box in her paws, lid flies up, sparkle
          drawBox(g, kx, top - 1, 'body');
          const up = 2 + Math.min(2, Math.floor((g0 - 0.75) / 0.03));
          drawBox(g, kx, top - 3 - up, 'lid');
          sparkle(g, t, kx, top - 8);
        }
      } else if (g0 >= 0.85) {
        drawCrane(g, DCP.crane[0], DCP.crane[1], 2, 2);
        if (g0 < 0.97) sparkle(g, t, DCP.crane[0] + 1, DCP.crane[1] - 9);
      }
      cup();
      return;
    }
    // on the grass by the cake
    let pose = 'sit';
    let arms = 'down';
    let look = 1;
    if (st.kit === 'stand') pose = 'stand';
    if (st.kit === 'wantup') {
      pose = 'stand';
      arms = 'up';
      look = 1;
    }
    if (st.cheer) {
      pose = 'stand';
      arms = 'up';
      look = 0;
    }
    if (st.kit === 'play' && !st.cheer) {
      // mostly watching her crane, now and then glancing about
      const n = T.noise(T.step(t, 8), 11, 1201);
      look = n < 0.25 ? -1 : n < 0.4 ? 0 : 1;
    }
    const hop = st.cheer ? hopAt(t, 1) : 0;
    drawKit(g, t, o, kx, kb - hop, { pose, arms, blink: ki.blink, look });
    cup();
    if (st.kit === 'play' || st.kit === 'tuck') {
      // she plays with it by the cake: the boom goes up and down, hook bobs
      const tc = T.step(t, 6);
      const boom = st.cheer ? 2 : [0, 1, 2, 2, 1, 0][Math.floor(tc / 0.8) % 6];
      const drop = 2.5 + T.wave(tc, 2.4, 0.2) * 1.5;
      let cx = DCP.crane[0];
      let cb = DCP.crane[1];
      if (st.kit === 'tuck') {
        // she hands it back to dad to wrap again (loop-safe)
        const q = Math.min(1, (st.s - 226) / 2.4);
        const px = dx - CX + 1;
        const py = db - 4;
        cx = R(DCP.crane[0] + (px - DCP.crane[0]) * q);
        cb = R(DCP.crane[1] + (py - DCP.crane[1]) * q - Math.sin(q * Math.PI) * 4);
      }
      if (!(st.kit === 'tuck' && st.s >= 228.4)) drawCrane(g, cx, cb, boom, drop);
    }
  }

  // ---------------------------------------------------------------------
  // Match Night: you (Spain-style jersey) + partner on the porch steps,
  // watching the TV in the ground-left window; cheering at the goal
  // ---------------------------------------------------------------------
  const DOOR = LAY.house.door;
  const STEPS = LAY.house.steps;
  const MATCH_SEAT = STEPS.y0 + 2;
  const MATCH_YOU = 212;
  const MATCH_PARTNER = 223;
  const MATCH_LEANS = [[56, 78], [188, 206]];
  function matchLean(t) {
    const s = HD.summer.sec(T.step(t, 8));
    for (const [a, b] of MATCH_LEANS) {
      if (s < a || s >= b) continue;
      return Math.min(s - a, b - s) < 0.25 ? 1 : 2;
    }
    return 0;
  }
  // night out: he watches alone, glancing out at her group now and then
  const MATCH_GLANCES = [[96, 99.5], [201, 204]];
  function drawMatchAlone(g, t) {
    const goal = HD.summer.goal(t);
    const cheering = goal >= 0 && goal < 0.6;
    const s = HD.summer.sec(T.step(t, 8));
    const glance = MATCH_GLANCES.some(([a, b]) => s >= a && s < b);
    const yi = idle(t, 3);
    drawAdult(g, t, Object.assign(you('match'), { tailSide: -1 }), MATCH_YOU, MATCH_SEAT - (cheering ? hopAt(t, 0) : 0), 3,
      cheering ? cheer() : { sit: true, look: glance ? 1 : -1, blink: yi.blink, mouth: 'smile' });
  }
  function drawMatch(g, t) {
    if (nightCfg()) return drawMatchAlone(g, t);
    const goal = HD.summer.goal(t);
    const cheering = goal >= 0 && goal < 0.6;
    const lean = cheering ? 0 : matchLean(t);
    const w = hairWind(t);
    // the niece passes behind them when she is up by the door
    const k = homeKit(t);
    if (k && k.base < MATCH_SEAT + 2) drawNiece(g, t, k);
    const yi = idle(t, 3);
    drawAdult(g, t, Object.assign(you('match'), { tailSide: -1 }), MATCH_YOU, MATCH_SEAT - (cheering ? hopAt(t, 0) : 0), 3,
      cheering ? cheer() : { sit: true, look: lean === 2 ? 0 : -1, hx: lean === 2 ? 1 : 0, blink: yi.blink, mouth: 'smile' });
    const pi = idle(t, 8);
    drawAdult(g, t, Object.assign(PARTNER, { tailSide: 1 }), MATCH_PARTNER, MATCH_SEAT - (cheering ? hopAt(t, 2) : 0), 8,
      cheering
        ? cheer({ br: w.br })
        : { sit: true, look: -1, hx: -lean, hy: lean === 2 ? 1 : 0, eyes: lean === 2 ? 'happy' : undefined, blink: pi.blink, br: w.br, gust: w.gust });
    if (k && k.base >= MATCH_SEAT + 2) drawNiece(g, t, k);
  }

  // ---------------------------------------------------------------------
  // home: partner in the window beside the series cat
  // ---------------------------------------------------------------------
  const CATWIN = LAY.house.windows.find((w) => w.cat);
  // 6 wide, column 0 stays glass (a 1px gap to the series cat) until she leans
  const WP = [
    // upright
    ['.K...K', '.KK.KK', '.KKKKK', '.KKKKK', '.KKKKJ', '..KKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKK'],
    // tipping in: head one px left
    ['K...K.', 'KK.KKJ', 'KKKKKJ', 'KKKKKJ', 'KKKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKK'],
    // resting her head on his: one px left and one down
    ['......', 'K...KJ', 'KK.KKJ', 'KKKKKJ', 'KKKKKJ', 'KKKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKJ', '.KKKKK'],
  ];
  const WP_EYES = [[[2, 3], [4, 3]], [[1, 3], [3, 3]], [[1, 4], [3, 4]]];
  const WP_EYE = '#c8d870';
  const winPartner = (k) => memo('winp' + k, () => HD.sprite(WP[k], { K: P.violet[1], J: P.violet[3] }));
  const WIN_LEANS = [[30, 52], [168, 196]];
  function winLean(t) {
    const s = HD.summer.sec(T.step(t, 8));
    for (const [a, b] of WIN_LEANS) {
      if (s < a || s >= b) continue;
      return Math.min(s - a, b - s) < 0.5 ? 1 : 2;
    }
    return 0;
  }
  function drawWindow(g, t) {
    if (!CATWIN) return;
    const gx = CATWIN.x;
    const gy = CATWIN.y;
    const x = gx + CATWIN.w - 6;
    const bot = gy + CATWIN.h - 1;
    const k = winLean(t);
    const spr = winPartner(k);
    const y = bot - spr.height + 1;
    g.sprite(spr, x, y);
    // a strand of her long fur lifts in the breeze
    const br = HD.summer.breeze(t);
    if (br > 0.6) g.px(x + 5, y + 9 + (br > 0.85 ? 0 : 1), P.violet[3]);
    const id = idle(t, 21);
    const s = HD.summer.sec(t);
    if (!id.blink && !(k === 2 && s % 20 < 9)) for (const [ex, ey] of WP_EYES[k]) g.px(x + ex, y + ey, WP_EYE);
  }

  // ---------------------------------------------------------------------
  // the niece dropping by (match, home): out of the front door and back
  // ---------------------------------------------------------------------
  function homePath(ed) {
    const door = [DOOR.x + DOOR.w / 2, STEPS.y0];
    if (ed === 'match') {
      // around the pair on the steps: along the porch to the right edge, then to the lawn
      return [door, [STEPS.x1 + 1, STEPS.y0 + 1], [STEPS.x1 + 3, STEPS.y1 + 2], [SU.football.x + 8, SU.football.base + 1]];
    }
    const foot = [DOOR.x + DOOR.w / 2 - 1, STEPS.y1 + 2];
    return [door, foot, [STEPS.x0 - 8, STEPS.y1 + 9]];
  }
  function along(pts, u) {
    let total = 0;
    const seg = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      seg.push(l);
      total += l;
    }
    let d = u * total;
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) {
        const k = seg[i] > 0 ? Math.min(1, d / seg[i]) : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
      }
      d -= seg[i];
    }
    return pts[pts.length - 1];
  }
  function homeKit(t) {
    const v = HD.summer.niece(t);
    if (!v.here) return null;
    const pts = homePath(HD.edition.id);
    let u = 1;
    let walking = false;
    if (v.phase === 'in') {
      u = v.u;
      walking = true;
    } else if (v.phase === 'out') {
      u = 1 - v.u;
      walking = true;
    }
    const [x, y] = along(pts, u);
    return { x: R(x), base: R(y), walking, v, u };
  }
  /** the front door opens from its hinge side as she comes and goes */
  function drawDoor(g, k) {
    if (!k || !k.walking) return;
    const u = k.u;
    const w = u < 0.03 ? 1 : u < 0.06 ? 2 : u < 0.16 ? 3 : u < 0.19 ? 2 : u < 0.22 ? 1 : 0;
    if (!w) return;
    const x0 = DOOR.x + 1;
    const y0 = DOOR.y + 3;
    const y1 = DOOR.y + DOOR.h - 1;
    const e = g.em;
    for (let x = x0; x < x0 + w; x++)
      for (let y = y0; y <= y1; y++) {
        const f = (x - x0 + 1) / (w + 1) + (y - y0) / (y1 - y0) * 0.25;
        e.px(x, y, HD.bayer(x, y) < f ? P.amber[5] : P.amber[6]);
      }
    g.vline(x0 + w, y0, y1, P.wood[2]);
  }
  function drawNiece(g, t, k) {
    const ed = HD.edition.id;
    const o = KIT_OUT.blue;
    const ts = T.step(t, 8);
    const wf = Math.floor(ts * 8) % 2;
    const ki = kitIdle(t, 14);
    let pose = 'stand';
    let arms = 'down';
    let look = ki.look;
    let bob = 0;
    if (k.walking) {
      pose = wf ? 'walk' : 'stand';
      bob = wf ? -1 : 0;
      look = 0;
    } else if (ed === 'match') {
      const goal = HD.summer.goal(t);
      if (goal >= 0 && goal < 0.7) {
        arms = 'up';
        bob = hopAt(t, 3) ? -1 : 0;
        look = 0;
      } else {
        look = -1; // watching her ball
        const pc = T.cycle(ts, 5, 11, 61);
        if (pc.age * pc.P < 1.6) {
          arms = waveArm(t); // waving to you on the steps
          look = -1;
        }
      }
    } else {
      // home: reaching up at the fireflies now and then
      const pc = T.cycle(ts, 5, 8.5, 63);
      if (pc.age * pc.P < 1.5) {
        arms = 'up';
        look = 0;
      }
    }
    drawKit(g, t, o, k.x, k.base + bob, { pose, arms, blink: ki.blink, look });
  }

  // =====================================================================
  // NIGHT OUT: the Boston celebrations. She is out in the lit yard with her
  // friends; he is home alone in the upper-right window (drawn by house).
  // OFF unless the edition carries the 'night-out' tag or the page has
  // ?nightout=1, and only in the editions listed in NIGHT below.
  // =====================================================================
  const NIGHT_FLAG = HD.flag('nightout', false);
  function nightCfg() {
    const c = NIGHT[HD.edition.id];
    return c && (NIGHT_FLAG || HD.tag('night-out')) ? c : null;
  }

  // the wife plus three friends: original generic cats, no names
  const NFUR = {
    wife: { fur: PARTNER.fur, hair: 'long', hairC: PARTNER.hairC, sheenC: PARTNER.sheenC, light: PARTNER.light, eye: PARTNER.eye, nose: PARTNER.nose, mouthC: PARTNER.mouthC, happyEm: true },
    ginger: { fur: nite('#d4782f'), dark: nite('#94451a'), light: nite('#f6d29c'), muzzle: 'f', tabby: true, inner: nite('#f0a0a0'), eye: '#e8d050', nose: nite('#e88a94'), mouthC: '#3a160c', happyEm: true },
    cream: { fur: nite('#ece2d0'), light: nite('#fffaf0'), muzzle: 'f', inner: nite('#f4a8b4'), eye: '#8cc8f4', nose: nite('#f08c9c'), mouthC: '#5a3438', lid: '#3a2a2a', happyEm: true },
    tabby: { fur: nite('#a0a6b0'), dark: nite('#4e545e'), light: nite('#dfe2e8'), muzzle: 'f', tabby: true, inner: nite('#d8909c'), eye: '#a8dc68', nose: nite('#c87888'), mouthC: '#2a1a22', happyEm: true },
  };
  const NSPEC = new Map();
  function nightSpec(id, who, tail) {
    const k = id + '|' + who;
    let s = NSPEC.get(k);
    if (!s) NSPEC.set(k, (s = Object.assign({ key: 'no-' + k, night: true }, NFUR[who], NIGHT[id].wear[who], { tailSide: tail })));
    return s;
  }

  // two stages, both inside the x 152..305 phone crop with his window:
  //  LEFT, between the fire/porch light and the path; RIGHT, under his window.
  // A loose zig-zag row [x, base, tail side, facing], left to right.
  const STAGE = {
    left: [[158, 227, -1, 1], [170, 220, -1, 1], [182, 226, 1, -1], [194, 219, 1, -1]],
    right: [[262, 224, -1, 1], [273, 219, -1, 1], [285, 225, 1, -1], [296, 220, 1, -1]],
  };

  /** chatting: look at the neighbours, talk in short bursts, laugh now and then */
  function social(t, seed, face) {
    const ts = T.step(t, 8);
    const n = T.noise(ts, 6 + (seed % 4) * 1.3, seed * 17 + 9);
    const look = n < 0.6 ? face : n < 0.82 ? 0 : -face;
    const tc = T.cycle(ts, 8, 8.3 + (seed % 5) * 1.7, seed * 13 + 7);
    const a = tc.age * tc.P;
    const laugh = a > 2.6 && a < 3.9 && tc.rnd(1) < 0.5;
    const talk = a < 2.2 && (Math.floor(T.step(t, 5) * 5) + seed) % 3 !== 0;
    return { look, mouth: laugh || talk ? 'laugh' : 'smile', eyes: laugh ? 'happy' : undefined };
  }
  /** something to hold: sets that paw's pose and remembers the item */
  function give(c, side, arm, k, extra) {
    if (side < 0) c.al = arm;
    else c.ar = arm;
    c.items.push(Object.assign({ k, side, arm }, extra || {}));
  }
  function cheerUp(c, t, k) {
    c.o.eyes = 'happy';
    c.o.mouth = 'laugh';
    c.o.look = 0;
    c.hop = hopAt(t, k);
  }

  let NS_T = NaN;
  let NS_ED = null;
  let NS = null;
  /** the whole group at time t (pure; memoised for the lights + draw of one frame) */
  function nightScene(t) {
    const cfg = nightCfg();
    if (!cfg) return null;
    if (t === NS_T && NS_ED === HD.edition) return NS;
    const id = HD.edition.id;
    const s = HD.summer.sec(t);
    const big = cfg.big ? cfg.big(t, s) : -1;
    const st = STAGE[cfg.stage];
    const cats = cfg.cast.map((who, i) => {
      const [x, base, tail, face] = st[i];
      const seed = 41 + i * 7 + cfg.seed;
      const c = { who, i, x, base, tail, face, seed, sp: nightSpec(id, who, tail), al: '', ar: '', items: [], hop: 0, o: social(t, seed, face) };
      cfg.act(c, t, s, big);
      c.b = c.base - c.hop;
      return c;
    });
    cats.sort((a, b) => a.base - b.base || a.x - b.x);
    NS_T = t;
    NS_ED = HD.edition;
    NS = { cfg, cats, s, big };
    return NS;
  }

  // ---- held items (night colours relight warm; glows are emissive) ----
  const IC = {
    glass: nite('#e4ecf4'),
    fizz: nite('#f2d27a'),
    lemon: nite('#f4e08a'),
    stick: '#2c2a32',
    wick: '#4a4048',
    steam: '#7c8296',
    wicker: nite('#b88a4e'),
    wickerD: nite('#7a5430'),
    clay: nite('#b8643a'),
    clayD: nite('#7a3a22'),
    pail: nite('#ee7a22'),
    pailD: nite('#a8461a'),
    book: nite('#9a1e2a'),
    bookG: nite('#2a6a3a'),
    page: nite('#f2ead6'),
    frame: '#24222a',
  };
  const EGGC = [nite('#f4a8c8'), nite('#a8d0f4'), nite('#f4e08a'), nite('#b8e8b0'), nite('#d0b0f0')];
  const SPARK = ['#fffbe8', '#ffe8a0', '#ffc860', '#ff9a40'];
  /** the paw a held item sits in, in world pixels */
  function pawOf(c, side, arm) {
    const x = c.x;
    const b = c.b;
    if (arm === 'out') return [x + side * 5, b - 4];
    if (arm === 'toast') return [x + side * 6, b - 9];
    if (arm === 'up') return [x + side * 7, b - 14];
    if (arm === 'up2') return [x + side * 8, b - 14];
    if (arm === 'chest') return [x + side, b - 5];
    if (arm === 'wide') return [x + side * 7, b - 6];
    return [x + side * 3, b - 3];
  }
  /** where an item's light (or glowing head) is */
  function itemHead(c, it) {
    const [px, py] = pawOf(c, it.side, it.arm);
    const s = it.side;
    if (it.k === 'sparkler') return it.arm === 'out' ? [px + 2 * s, py - 4] : [px + s, py - 3];
    if (it.k === 'redLantern' || it.k === 'paperLantern') return it.arm === 'out' ? [px + s, py - 5] : [px + 2 * s, py - 3];
    if (it.k === 'pole') return [px + 2 * s, py - 17];
    return [px, py];
  }
  function drawSparkler(g, t, x0, y0, hx, hy, seed, big) {
    g.line(x0, y0, hx, hy + 1, IC.stick);
    const e = g.em;
    const fr = Math.floor(T.step(t, 12) * 12);
    // white-hot core with a gold cross, then short fizzing streaks
    e.px(hx, hy, SPARK[0]);
    e.px(hx - 1, hy, SPARK[1]);
    e.px(hx + 1, hy, SPARK[1]);
    e.px(hx, hy - 1, SPARK[1]);
    e.px(hx, hy + 1, SPARK[2]);
    const n = big ? 9 : 7;
    const rmax = big ? 5 : 4;
    for (let k = 0; k < n; k++) {
      const a = HD.hash(seed, fr, k, 1) * Math.PI * 2;
      const r = 2 + HD.hash(seed, fr, k, 2) * (rmax - 2);
      const ca = Math.cos(a);
      const sa = Math.sin(a) * 0.9;
      e.px(R(hx + ca * r), R(hy + sa * r), SPARK[r < 3 ? 1 : r < 4 ? 2 : 3]);
      if (HD.hash(seed, fr, k, 3) < 0.5) e.px(R(hx + ca * (r - 1)), R(hy + sa * (r - 1)), SPARK[0]);
    }
  }
  function drawCandleLantern(g, t, x, y, seed) {
    // metal carol lantern on a hook: ring, peaked cap, two glowing panes
    // around a candle, base
    const [bx, by] = HD.festive.lanternPos(x, y, t, seed, { len: 2, amp: 0.14 });
    g.line(R(x), R(y), bx, by, IC.frame);
    const f = T.flicker(T.step(t, 10), seed, 1.2);
    const e = g.em;
    g.px(bx, by + 1, IC.frame);
    g.hline(bx - 1, bx + 1, by + 2, IC.frame);
    g.hline(bx - 2, bx + 2, by + 3, IC.frame);
    for (let y = by + 4; y <= by + 6; y++) {
      g.px(bx - 2, y, IC.frame);
      g.px(bx + 2, y, IC.frame);
      e.px(bx - 1, y, P.amber[y === by + 6 ? 5 : 6]);
      e.px(bx + 1, y, P.amber[y === by + 6 ? 5 : 6]);
      g.px(bx, y, IC.frame);
    }
    e.px(bx, by + 4, P.amber[f > 0.5 ? 8 : 7]);
    e.px(bx, by + 5, P.amber[f > 0.25 ? 8 : 7]);
    g.hline(bx - 2, bx + 2, by + 7, IC.frame);
  }
  /** a little camp lantern standing on the grass (x, base = its foot) */
  function drawCampLantern(g, t, x, base, seed) {
    const f = T.flicker(T.step(t, 10), seed, 0.8);
    const e = g.em;
    g.px(x, base - 7, IC.frame);
    g.hline(x - 1, x + 1, base - 6, IC.frame);
    for (let y = base - 5; y <= base - 2; y++) {
      g.px(x - 2, y, IC.frame);
      g.px(x + 2, y, IC.frame);
      e.hline(x - 1, x + 1, y, P.amber[y === base - 2 ? 6 : 7]);
    }
    e.px(x, base - 4, P.amber[f > 0.4 ? 8 : 7]);
    e.px(x, base - 3, P.amber[8]);
    g.hline(x - 2, x + 2, base - 1, IC.frame);
    g.hline(x - 1, x + 1, base, '#16141a');
  }
  function drawItem(g, t, c, it) {
    const s = it.side;
    const [px, py] = pawOf(c, s, it.arm);
    const seed = c.seed * 5 + (s > 0 ? 1 : 0);
    const k = it.k;
    if (k === 'flute') {
      g.px(px, py - 1, IC.glass);
      g.px(px, py - 2, IC.fizz);
      g.px(px, py - 3, IC.fizz);
      g.px(px, py - 4, IC.glass);
      if (it.glint) g.em.px(px, py - 4, '#ffffff');
    } else if (k === 'cup') {
      g.px(px, py - 1, IC.lemon);
      g.px(px + s, py - 1, IC.lemon);
      g.px(px, py - 2, IC.glass);
      g.px(px + s, py - 2, IC.lemon);
      if (it.glint) g.em.px(px + s, py - 2, '#ffffff');
    } else if (k === 'mug') {
      const mc = it.c || IC.glass;
      g.px(px, py - 1, mc);
      g.px(px + s, py - 1, mc);
      g.px(px, py - 2, mc);
      g.px(px + s, py - 2, mc);
      g.px(px + 2 * s, py - 2, mc);
      // steam: two wisps curling up, 3 fps
      const fr = Math.floor(T.step(t, 3) * 3) + c.seed;
      for (let w = 0; w < 2; w++) {
        const u = (fr + w * 2) % 4;
        const sx = px + (w ? s : 0) + (u >= 2 ? s : 0);
        const sy = py - 4 - u;
        if (HD.bayer(sx, sy) < 0.75 - u * 0.15) g.px(sx, sy, IC.steam);
      }
    } else if (k === 'sparkler') {
      const [hx, hy] = itemHead(c, it);
      drawSparkler(g, t, px, py - 1, hx, hy, seed, it.big);
    } else if (k === 'redLantern' || k === 'paperLantern') {
      const [hx, hy] = itemHead(c, it);
      g.line(px, py - 1, hx, hy, IC.stick);
      HD.festive.lantern(g, hx, hy, t, seed, k === 'redLantern' ? 'red' : 'paper', { size: 'small', len: 1, amp: 0.3 });
    } else if (k === 'pole') {
      const [hx, hy] = itemHead(c, it);
      g.vline(px, hy, py - 1, IC.stick);
      g.px(px + s, hy, IC.stick);
      g.px(hx, hy + 1, IC.stick);
      drawCandleLantern(g, t, hx, hy + 1, seed);
    } else if (k === 'diya') {
      g.hline(px - 1, px + 1, py - 1, IC.clay);
      g.px(px, py, IC.clayD);
      g.px(px + s * 2, py - 2, IC.clay);
      g.em.px(px, py - 2, P.amber[3]);
      HD.festive.flame(g, px + s * 2, py - 2, t, seed, 1);
    } else if (k === 'basket') {
      const bx = px + 2 * s;
      const by = c.base;
      for (let y = by - 2; y <= by; y++) for (let x = bx - 2; x <= bx + 2; x++) g.px(x, y, (x + y) & 1 ? IC.wicker : IC.wickerD);
      g.px(bx - 1, by - 3, EGGC[0]);
      g.px(bx, by - 3, EGGC[2]);
      g.px(bx + 1, by - 3, EGGC[1]);
      g.px(bx - 2, by - 3, IC.wickerD);
      g.px(bx + 2, by - 3, IC.wickerD);
      g.hline(bx - 1, bx + 1, by - 5, IC.wicker);
      g.px(bx - 2, by - 4, IC.wicker);
      g.px(bx + 2, by - 4, IC.wicker);
    } else if (k === 'book') {
      const bc = it.c || IC.book;
      g.hline(px - 1, px + 1, py - 1, bc);
      g.hline(px - 1, px + 1, py, bc);
      g.px(px + s, py - 1, IC.page);
    } else if (k === 'pail') {
      g.px(px - 1, py, IC.frame);
      g.px(px + 1, py, IC.frame);
      g.hline(px - 1, px + 1, py + 1, IC.pail);
      g.hline(px - 1, px + 1, py + 2, IC.pail);
      g.hline(px - 1, px + 1, py + 3, IC.pailD);
      const f = T.flicker(T.step(t, 10), seed, 1.2);
      g.em.px(px - 1, py + 2, P.fire[f > 0.4 ? 8 : 7]);
      g.em.px(px + 1, py + 2, P.fire[f > 0.4 ? 8 : 7]);
      g.em.px(px, py + 3, P.fire[f > 0.6 ? 7 : 6]);
    } else if (k === 'egg') {
      const ec = EGGC[it.c || 4];
      g.px(px, py - 1, ec);
      g.px(px + s, py - 1, ec);
      g.px(px, py - 2, EGGC[2]);
      g.px(px + s, py - 2, EGGC[2]);
      g.px(px, py - 3, ec);
    } else if (k === 'scarfUp') {
      // a football scarf held up between both paws
      const y = c.b - 15;
      for (let x = c.x - 7; x <= c.x + 7; x++) {
        const ch = ((x - c.x + 7) >> 1) & 1 ? c.sp.scarfC2 : c.sp.scarfC;
        g.px(x, y, ch);
        g.px(x, y - 1, ch);
      }
      g.px(c.x - 8, y, c.sp.scarfC);
      g.px(c.x - 8, y + 1, c.sp.scarfC2);
      g.px(c.x + 8, y, c.sp.scarfC);
      g.px(c.x + 8, y + 1, c.sp.scarfC2);
    } else if (k === 'wings') {
      // the vampire spreads the cape wide: red lining between arm and hem,
      // dark edges, a scalloped bat-wing hem
      for (const sd of [-1, 1]) {
        for (let y = c.b - 5; y <= c.b - 1; y++) {
          const reach = 8 - ((y - (c.b - 5)) >> 1);
          for (let d = 5; d <= reach; d++) g.px(c.x + sd * d, y, d === reach ? c.sp.capeC : c.sp.hatC2);
        }
        g.px(c.x + sd * 8, c.b - 6, c.sp.capeC);
        g.px(c.x + sd * 7, c.b - 2, c.sp.capeC);
        g.px(c.x + sd * 5, c.b, c.sp.capeC);
      }
    }
  }
  /** sequins on a party dress: a couple of emissive glints hop about */
  function sequins(g, t, c) {
    const fr = Math.floor(T.step(t, 4) * 4);
    for (let k = 0; k < 2; k++) {
      const dx = Math.floor(HD.hash(c.seed, fr, k, 3) * 7) - 3;
      const dy = Math.floor(HD.hash(c.seed, fr, k, 4) * 5);
      g.em.px(c.x + dx, c.b - 6 + dy, k ? '#fff4c8' : '#ffffff');
    }
  }

  function drawNight(g, t) {
    const S = nightScene(t);
    if (!S) return;
    const w = hairWind(t);
    for (const c of S.cats) {
      const o = Object.assign({}, c.o);
      if (c.al) o.al = c.al;
      if (c.ar) o.ar = c.ar;
      if (c.who === 'wife') {
        o.br = w.br;
        o.gust = w.gust;
      }
      drawAdult(g, t, c.sp, c.x, c.b, c.seed, o);
      if (c.sp.sequins) sequins(g, t, c);
      for (const it of c.items) drawItem(g, t, c, it);
    }
    if (S.cfg.after) S.cfg.after(g, t, S);
  }
  const SPK_L = [1, 0.82, 0.5];
  function lightsNight(t, L) {
    const S = nightScene(t);
    if (!S) return;
    for (const c of S.cats)
      for (const it of c.items) {
        const seed = c.seed * 5 + (it.side > 0 ? 1 : 0);
        const [hx, hy] = itemHead(c, it);
        if (it.k === 'sparkler') {
          const f = T.flicker(T.step(t, 12), seed, 2);
          L.add({ x: hx, y: hy, r: it.big ? 28 : 24, color: SPK_L, i: (it.big ? 0.5 : 0.4) * (0.8 + 0.35 * f) });
        } else if (it.k === 'redLantern' || it.k === 'paperLantern') {
          HD.festive.lanternLight(L, hx, hy, t, seed, it.k === 'redLantern' ? 'red' : 'paper', { size: 'small', len: 1, amp: 0.3, r: 28, i: 0.42, halo: false });
        } else if (it.k === 'pole') {
          const [bx, by] = HD.festive.lanternPos(hx, hy + 1, t, seed, { len: 2, amp: 0.14 });
          const f = T.flicker(T.step(t, 10), seed, 1.2);
          L.add({ x: bx, y: by + 5, r: 38, color: HD.LIGHT.candle, i: 0.6 * (0.85 + 0.25 * f), halo: { r: 8, a: 0.14 } });
        } else if (it.k === 'diya') {
          const [px, py] = pawOf(c, it.side, it.arm);
          HD.festive.flameLight(L, px + it.side * 2, py - 2, t, seed, 22, 0.4);
        } else if (it.k === 'pail') {
          const f = T.flicker(T.step(t, 10), seed, 1.2);
          L.add({ x: hx, y: hy + 2, r: 22, color: HD.LIGHT.pumpkin, i: 0.38 * (0.8 + 0.3 * f) });
        }
      }
    if (S.cfg.fill) S.cfg.fill(t, L, S);
  }

  // ---- the editions -----------------------------------------------------
  const inWin = (s, a, b) => (s >= a && s < b ? (s - a) / (b - a) : -1);
  const N = nite;
  // her clothes are painted a touch brighter: she is the one the eye should find
  const NV = (h) => nite(h, 0.2);
  const NIGHT = {
    // Lunar New Year: red tops with gold trim, small red lanterns and sparklers
    lunar: {
      stage: 'right',
      seed: 0,
      cast: ['wife', 'ginger', 'cream', 'tabby'],
      wear: {
        wife: { shirt: NV('#d41e2a'), collar: NV('#f4c440'), neck: 'mandarin', sleeveTip: true, pants: NV('#24182a') },
        ginger: { shirt: N('#c8202c'), shirtAlt: N('#f0b830'), pattern: 'floral', neck: 'tee', pants: N('#2a2228') },
        cream: { shirt: N('#b0162c'), collar: N('#f4c440'), neck: 'mandarin', sleeveTip: true, pants: N('#1e1a22') },
        tabby: { shirt: N('#e23428'), shirtAlt: N('#f4c440'), pattern: 'hem', neck: 'tee', pants: N('#2a2a34') },
      },
      big: (t, s) => inWin(s, 118, 124),
      act(c, t, s, big) {
        const up = big >= 0;
        if (c.who === 'wife') give(c, -1, up ? 'up' : 'out', 'redLantern');
        else if (c.who === 'tabby') give(c, 1, up ? 'up' : 'out', 'redLantern');
        else give(c, c.who === 'ginger' ? -1 : 1, up ? 'up' : 'out', 'sparkler', { big: up });
        if (up) cheerUp(c, t, c.i);
      },
    },
    // Easter: pastel tops, a night egg hunt with a basket and a paper lantern
    spring: {
      stage: 'left',
      seed: 3,
      cast: ['cream', 'ginger', 'wife', 'tabby'],
      wear: {
        wife: { shirt: NV('#c4a0ea'), neck: 'tee', pants: NV('#efe6d2') },
        ginger: { shirt: N('#9cdcb8'), neck: 'tee', pants: N('#f2ecdc'), hat: 'bunny', hatC: N('#f6f2ee'), hatC2: N('#f4a8c0'), hatBand: N('#f4a8c0') },
        cream: { shirt: N('#f6b49c'), neck: 'tee', pants: N('#f4f0e6') },
        tabby: { shirt: N('#9cc4f0'), neck: 'tee', pants: N('#ece6d6') },
      },
      big: (t, s) => inWin(s, 96, 102),
      act(c, t, s, big) {
        if (c.who === 'cream') give(c, 1, 'down', 'basket');
        if (c.who === 'wife') give(c, 1, 'out', 'paperLantern');
        if (big >= 0) {
          if (c.who === 'tabby') {
            give(c, -1, 'up', 'egg', { c: 4 });
            c.o.eyes = 'happy';
            c.o.mouth = 'laugh';
          } else if (c.who === 'ginger') cheerUp(c, t, 1);
          else {
            c.o.eyes = 'happy';
            c.o.mouth = 'laugh';
            c.o.look = c.face;
          }
        }
      },
    },
    // Midsummer: flower crowns, light summer clothes, a toast by the bonfire
    summer: {
      stage: 'left',
      seed: 6,
      cast: ['ginger', 'cream', 'wife', 'tabby'],
      wear: {
        wife: { shirt: NV('#f6f2ea'), shirtAlt: NV('#e86a8a'), pattern: 'hem', pants: NV('#f6f2ea'), dress: true, neck: 'tee', hat: 'crown', pom: NV('#f4a0c0'), flower2: NV('#f8e070'), leaf: NV('#5aa84a') },
        ginger: { shirt: N('#f2d24a'), neck: 'tee', pants: N('#9ab4d8'), hat: 'crown', pom: N('#f8f4f0'), flower2: N('#c8a0f0'), leaf: N('#5aa84a') },
        cream: { shirt: N('#8ec0f0'), pants: N('#8ec0f0'), dress: true, neck: 'tee', hat: 'crown', pom: N('#f8e070'), flower2: N('#f48aa8'), leaf: N('#5aa84a') },
        tabby: { shirt: N('#f08a70'), neck: 'tee', pants: N('#f2ecdc'), hat: 'crown', pom: N('#ffffff'), flower2: N('#f8e070'), leaf: N('#5aa84a') },
      },
      big: (t, s) => inWin(s, 84, 90),
      act(c, t, s, big) {
        const side = c.face;
        if (big >= 0) {
          give(c, side, 'toast', 'cup', { glint: big > 0.3 && big < 0.5 });
          c.o.eyes = 'happy';
          c.o.mouth = 'laugh';
          c.o.look = side;
        } else give(c, side, 'out', 'cup');
      },
    },
    // Harvest & Thanksgiving: cosy sweaters and scarves, warm mugs
    harvest: {
      stage: 'left',
      seed: 9,
      cast: ['tabby', 'ginger', 'wife', 'cream'],
      wear: {
        wife: { shirt: NV('#ece0c4'), shirtAlt: NV('#cdbf9e'), pattern: 'cable', neck: 'tee', pants: NV('#2c3650'), scarf: 'R', scarfC: NV('#c0582a'), scarfC2: NV('#e8923e') },
        ginger: { shirt: N('#3a7a50'), shirtAlt: N('#ece0c4'), pattern: 'band', neck: 'tee', pants: N('#3a3036'), scarf: 'L', scarfC: N('#efe6d2'), scarfC2: N('#c8bca4') },
        cream: { shirt: N('#8e2a3a'), shirtAlt: N('#b84a58'), pattern: 'cable', neck: 'tee', pants: N('#2a2a34'), scarf: 'R', scarfC: N('#e0a83a'), scarfC2: N('#b88028') },
        tabby: { shirt: N('#d8a033'), shirtAlt: N('#8e2a3a'), pattern: 'band', neck: 'tee', pants: N('#4a3a30'), scarf: 'L', scarfC: N('#8e2a3a'), scarfC2: N('#b84a58') },
      },
      big: (t, s) => inWin(s, 132, 138),
      act(c, t, s, big) {
        const mugs = { wife: N('#efe6d6'), ginger: N('#c84a3a'), cream: N('#4a7ab8'), tabby: N('#efe6d6') };
        if (big >= 0) {
          give(c, c.face, 'toast', 'mug', { c: mugs[c.who] });
          c.o.eyes = 'happy';
          c.o.mouth = 'laugh';
          c.o.look = c.face;
        } else give(c, c.face, 'out', 'mug', { c: mugs[c.who] });
      },
    },
    // Halloween: simple homemade costumes around the campfire
    halloween: {
      stage: 'left',
      seed: 12,
      cast: ['cream', 'ginger', 'wife', 'tabby'],
      wear: {
        wife: { shirt: NV('#6a3a9a'), neck: 'vneck', pants: NV('#1c1622'), dress: true, hat: 'witch', hatC: NV('#3a2a58'), hatBand: NV('#e88a24') },
        ginger: { shirt: N('#e8e6f0'), collar: N('#b01828'), neck: 'polo', pants: N('#1a1820'), cape: true, capeC: '#15111c', hatC2: N('#b01828') },
        cream: { round: true, shirt: N('#ec781c'), shirtAlt: '#2a1406', pattern: 'jack', neck: 'none', pants: N('#ec781c'), hat: 'stem', leaf: N('#4a8a3a') },
        tabby: { shirt: '#1e1c24', shirtAlt: N('#ece8de'), pattern: 'bones', neck: 'none', pants: '#1e1c24' },
      },
      big: (t, s) => inWin(s, 140, 146),
      act(c, t, s, big) {
        const on = big >= 0;
        if (c.who === 'wife') give(c, -1, on ? 'toast' : 'out', 'pail');
        if (!on) return;
        if (c.who === 'ginger') {
          // the vampire swirls the cape open: "boo!"
          c.al = 'wide';
          c.ar = 'wide';
          c.items.push({ k: 'wings', side: 0, arm: '' });
          c.o.mouth = 'o';
          c.o.eyes = undefined;
          c.o.look = 0;
        } else {
          c.o.eyes = 'happy';
          c.o.mouth = 'laugh';
          c.o.look = c.x < 170 ? 1 : -1;
          if (c.who === 'cream') c.hop = hopAt(t, 1);
        }
      },
    },
    // Diwali: jewel colours with gold trim, sparklers and little diyas
    lights: {
      stage: 'right',
      seed: 15,
      cast: ['wife', 'ginger', 'cream', 'tabby'],
      wear: {
        wife: { shirt: NV('#d0207a'), shirtAlt: NV('#f4c440'), pattern: 'hem', collar: NV('#f4c440'), neck: 'mandarin', sleeveTip: true, pants: NV('#f0b838') },
        ginger: { shirt: N('#1a9a5c'), shirtAlt: N('#f4c440'), pattern: 'hem', collar: N('#f4c440'), neck: 'mandarin', pants: N('#ece2c8') },
        cream: { shirt: N('#2a50d8'), shirtAlt: N('#f4c440'), pattern: 'hem', collar: N('#f4c440'), neck: 'mandarin', sleeveTip: true, pants: N('#2a50d8'), dress: true },
        tabby: { shirt: N('#f08a1a'), shirtAlt: N('#c81a6a'), pattern: 'hem', collar: N('#c81a6a'), neck: 'mandarin', pants: N('#ece2c8') },
      },
      big: (t, s) => inWin(s, 126, 132),
      act(c, t, s, big) {
        const up = big >= 0;
        if (c.who === 'wife') give(c, -1, up ? 'toast' : 'out', 'diya');
        else if (c.who === 'cream') give(c, 1, up ? 'toast' : 'out', 'diya');
        else give(c, c.who === 'ginger' ? -1 : 1, up ? 'up' : 'out', 'sparkler', { big: up });
        if (up) cheerUp(c, t, c.i);
      },
    },
    // Christmas & Hanukkah: long coats, knitted hats and scarves, carols by lantern light
    winter: {
      stage: 'right',
      seed: 18,
      cast: ['wife', 'ginger', 'cream', 'tabby'],
      wear: {
        wife: { shirt: NV('#c88e52'), shirtAlt: NV('#7a5432'), coat: true, neck: 'tee', pants: NV('#2a2228'), hat: 'beanie', hatC: NV('#d42a32'), hatC2: NV('#f4eee6'), pom: NV('#ffffff'), scarf: 'R', scarfC: NV('#f4eee6'), scarfC2: NV('#d42a32') },
        ginger: { shirt: N('#2c3c70'), shirtAlt: N('#c8a040'), coat: true, neck: 'tee', pants: N('#22222a'), hat: 'beanie', hatC: N('#ece4d4'), hatC2: N('#c8bca8'), pom: N('#ffffff'), scarf: 'L', scarfC: N('#c82a30'), scarfC2: N('#f2ece4') },
        cream: { shirt: N('#c02a30'), shirtAlt: N('#6a1218'), coat: true, neck: 'tee', pants: N('#22222a'), hat: 'beanie', hatC: N('#2a7a44'), hatC2: N('#f2ece4'), pom: N('#ffffff'), scarf: 'R', scarfC: N('#2a7a44'), scarfC2: N('#f2ece4') },
        tabby: { shirt: N('#2a6a40'), shirtAlt: N('#14361e'), coat: true, neck: 'tee', pants: N('#22222a'), hat: 'beanie', hatC: N('#3a5ab0'), hatC2: N('#ece4d4'), pom: N('#ffffff'), scarf: 'L', scarfC: N('#ece4d4'), scarfC2: N('#3a5ab0') },
      },
      big: (t, s) => inWin(s, 160, 166),
      act(c, t, s, big) {
        if (c.who === 'tabby') give(c, -1, 'out', 'pole');
        else give(c, c.face, 'chest', 'book', { c: c.who === 'cream' ? IC.bookG : IC.book });
        // a carol: phrases of notes on a slow beat, everyone together
        const beat = Math.floor(T.step(t, 2) * 2);
        const sing = (beat % 16) < 11 && (beat + (c.i & 1)) % 4 !== 3;
        c.o.look = c.face > 0 ? 1 : 0;
        if (big >= 0) {
          c.o.mouth = 'o';
          c.o.eyes = 'happy';
          c.o.look = 0;
        } else if (sing) {
          c.o.mouth = (beat + c.i) % 2 ? 'o' : 'laugh';
          c.o.eyes = undefined;
        }
      },
    },
    // New Year's Eve: party hats, a sparkly dress, glasses raised to the fireworks
    newyear: {
      stage: 'left',
      seed: 21,
      cast: ['ginger', 'cream', 'wife', 'tabby'],
      wear: {
        wife: { shirt: NV('#e8c050'), pants: NV('#e8c050'), dress: true, neck: 'vneck', sequins: true, hat: 'party', hatC: NV('#f04a9a'), hatC2: NV('#f4c440'), pom: NV('#ffffff') },
        ginger: { shirt: N('#7a3ab0'), neck: 'tee', pants: N('#22222a'), hat: 'party', hatC: N('#2ab0b0'), hatC2: N('#e8e8f0'), pom: N('#f4c440') },
        cream: { shirt: N('#1f8a6a'), pants: N('#1f8a6a'), dress: true, neck: 'vneck', sequins: true, hat: 'party', hatC: N('#f4c440'), hatC2: N('#c81a6a'), pom: N('#ffffff') },
        tabby: { shirt: N('#2a3a8a'), collar: N('#f2ece4'), neck: 'shirt', shirtAlt: N('#f2ece4'), pants: N('#1e1e28'), hat: 'party', hatC: N('#d82a30'), hatC2: N('#f2ece4'), pom: N('#f4c440') },
      },
      // the fireworks salvo bursts (fire-seasons: launched at LOOP/4 and 3*LOOP/4)
      big: (t, s) => inWin(s, HD.LOOP * 0.75 + 1.2, HD.LOOP * 0.75 + 6.5),
      act(c, t, s, big) {
        const look = inWin(s, HD.LOOP * 0.25 + 1.2, HD.LOOP * 0.25 + 5) >= 0;
        const item = c.who === 'wife' ? 'sparkler' : 'flute';
        const side = c.who === 'wife' ? -1 : c.face;
        if (big >= 0) {
          give(c, side, 'up', item, { big: true, glint: (Math.floor(T.step(t, 6) * 6) + c.i) % 3 === 0 });
          cheerUp(c, t, c.i);
        } else if (look) {
          give(c, side, 'toast', item);
          c.o.look = 0;
          c.o.mouth = 'o';
          c.o.eyes = undefined;
        } else give(c, side, 'out', item);
      },
    },
    // Match Night: football scarves in plain stripes, a cheer at the goal
    match: {
      stage: 'right',
      seed: 24,
      cast: ['wife', 'ginger', 'cream', 'tabby'],
      wear: {
        wife: { shirt: NV('#f2eee6'), neck: 'tee', pants: NV('#2a2a34'), scarf: 'R', scarfC: NV('#d0202a'), scarfC2: NV('#f4c440') },
        ginger: { shirt: N('#2a5a3a'), neck: 'tee', pants: N('#2c3448'), scarf: 'L', scarfC: N('#8cc8f0'), scarfC2: N('#f4f4f4') },
        cream: { shirt: N('#2a3460'), neck: 'tee', pants: N('#2a2a34'), scarf: 'R', scarfC: N('#2a8a4a'), scarfC2: N('#f4f4f4') },
        tabby: { shirt: N('#7a2a3a'), neck: 'tee', pants: N('#22222a'), scarf: 'L', scarfC: N('#26346a'), scarfC2: N('#f08a2a') },
      },
      big: (t) => {
        const gl = HD.summer.goal(t);
        return gl >= 0 && gl < 0.6 ? gl / 0.6 : -1;
      },
      // a little camp lantern on the grass lights the group
      after(g, t) {
        drawCampLantern(g, t, 274, 228, 77);
      },
      fill(t, L) {
        const f = T.flicker(T.step(t, 10), 77, 0.8);
        L.add({ x: 274, y: 224, r: 38, color: HD.LIGHT.lantern, i: 0.5 * (0.9 + 0.15 * f), halo: { r: 8, a: 0.12 } });
      },
      act(c, t, s, big) {
        if (big < 0) return;
        c.al = 'up';
        c.ar = 'up';
        c.items.push({ k: 'scarfUp', side: 0, arm: '' });
        cheerUp(c, t, c.i);
      },
    },
  };

  HD.module('family', {
    passes: [
      {
        layer: 'scene',
        z: 29.7,
        id: 'window',
        draw(g, t) {
          const ed = HD.edition;
          if (!ed.story || ed.id !== 'home') return;
          drawWindow(g, t);
        },
      },
      {
        // back row: behind the props birthday table
        layer: 'scene',
        z: 33,
        id: 'family-back',
        draw(g, t) {
          const ed = HD.edition;
          if (!ed.story || ed.id !== 'dc') return;
          drawDCBack(g, t);
        },
      },
      {
        layer: 'scene',
        z: 47,
        id: 'family',
        draw(g, t) {
          const ed = HD.edition;
          if (!ed.story) return;
          const id = ed.id;
          if (id === 'nyc') drawNYC(g, t);
          else if (id === 'la') drawLA(g, t);
          else if (id === 'sandiego') drawSD(g, t);
          else if (id === 'dc') drawDC(g, t);
          else if (id === 'match' || id === 'home') {
            // on a night out he is alone on the steps: no niece, no door
            const k = id === 'match' && nightCfg() ? null : homeKit(t);
            drawDoor(g, k);
            if (id === 'match') drawMatch(g, t);
            else if (k) drawNiece(g, t, k);
          }
        },
      },
      {
        // night out: her group in the yard, in front of the yard props
        layer: 'scene',
        z: 47.5,
        id: 'night-out',
        draw(g, t) {
          drawNight(g, t);
        },
      },
    ],
    lights(t, L) {
      lightsNight(t, L);
    },
  });
})();
