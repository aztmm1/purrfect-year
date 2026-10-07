/*
 * Purrfect Year v2: the family cats (owned by the family module).
 *
 * Every family member is a small upright cat built from ASCII parts (head,
 * features, hair, outfit, arms, legs) and baked once per pose and edition into
 * a sprite pair (albedo + emissive eyes and glints), then blitted per frame.
 * Poses are chosen from t only (pure, loop-safe); idle life runs at 8 fps.
 * Outfit colours are painted per light mode, so the same character reads as
 * true colours by day, warm at golden hour and cool but legible at night.
 *
 * Who is where comes from HD.edition.cast and the anchors of HD.place():
 *   window 'together'   HD.drawPartner(g, t, x, base): his wife beside the
 *                       series cat in the cat window (the building calls it
 *                       before its balcony rail or window frame)
 *   out 'friends'       she and three friends (ginger, cream, grey tabby)
 *                       celebrating in stages.group, an outfit and activity
 *                       per entry
 *   out 'passby'        they walk past along the sidewalk (in, across, out)
 *   party 'match'       him on his balcony in a red jersey; HD.drawBalcony
 *                       lets the building draw him before its rail
 *   party 'bench'       the couple on the bench, a heart floats up
 *   party 'trip'        him, the niece, his sister and her husband
 *   party 'birthday'    the party round the table with his dad
 *   niece               she comes out of the entrance and goes back in
 *   tag trick-or-treat  tiny costumed kittens call at the lobby
 * Scene layer z 45..49, plus z 34.97 for the back row standing behind the
 * birthday table (so the tablecloth hides their legs).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const SU = HD.summer;
  const R = Math.round;
  const sec = (t) => SU.sec(t);
  const inWin = (s, a, b) => (s >= a && s < b ? (s - a) / (b - a) : -1);
  /** inWin for a window that may run past the loop's end (it wraps to the start) */
  const inWinWrap = (s, a, b) => {
    const u = inWin(s, a, b);
    return u >= 0 ? u : inWin(s + HD.LOOP, a, b);
  };

  // ---------------------------------------------------------------------
  // colour: each outfit is given as its daylight colour and painted per
  // light mode (night: as it looks under a modest warm light; day, golden,
  // dusk: the albedo the engine's daylight fill turns back into it)
  // ---------------------------------------------------------------------
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
  /** painter for a light mode: c(daylightHex, k) -> albedo; k < 0.3 paints a touch brighter */
  function painter(mode) {
    return function (h, k) {
      const kk = k === undefined ? 0.3 : k;
      const [r, g, b] = rgb(h);
      if (mode === 'night') return hex(r / (1 + (kk * LC[0]) / AMB[0]), g / (1 + (kk * LC[1]) / AMB[1]), b / (1 + (kk * LC[2]) / AMB[2]));
      const m = (mode === 'dusk' ? 1.15 : mode === 'golden' ? 0.94 : 0.98) * (1 + (0.3 - kk) * 0.5);
      return hex(r * AMB[0] * m, g * AMB[1] * m, b * AMB[2] * m);
    };
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
  /** ASCII rows -> canvas in one putImageData ('.' and ' ' are transparent) */
  const rgbCache = new Map();
  function spriteRows(rows, map) {
    const h = rows.length;
    let w = 0;
    for (const r of rows) w = Math.max(w, r.length);
    const cv = HD.canvas(Math.max(1, w), Math.max(1, h));
    const ctx = cv.getContext('2d');
    const im = ctx.createImageData(Math.max(1, w), Math.max(1, h));
    const d = im.data;
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const c = map[row[x]];
        if (!c || row[x] === '.' || row[x] === ' ') continue;
        let v = rgbCache.get(c);
        if (!v) rgbCache.set(c, (v = rgb(c)));
        const i = (y * w + x) * 4;
        d[i] = v[0];
        d[i + 1] = v[1];
        d[i + 2] = v[2];
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
    return cv;
  }
  const EMCH = 'zeyw';
  const OUTLINE = '#0b0910';
  /** pad by one cell, add a dark 1px outline (not under the feet), bake albedo + emissive */
  function bake(G, map, emMap, noOutline) {
    const H0 = G.length;
    const W0 = G[0].length;
    const Q = grid(W0 + 2, H0 + 2);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) Q[y + 1][x + 1] = G[y][x];
    if (!noOutline)
      for (let y = 0; y < H0 + 1; y++)
        for (let x = 0; x < W0 + 2; x++) {
          if (Q[y][x] !== '.') continue;
          const n = (xx, yy) => yy >= 0 && yy < H0 + 2 && xx >= 0 && xx < W0 + 2 && Q[yy][xx] !== '.' && Q[yy][xx] !== 'o';
          if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) Q[y][x] = 'o';
        }
    map = Object.assign({ o: OUTLINE }, map);
    const rows = Q.map((r) => r.join(''));
    const alb = spriteRows(rows, map);
    let em = null;
    if (emMap && rows.some((r) => [...r].some((c) => EMCH.includes(c) && emMap[c]))) em = spriteRows(rows, emMap);
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
  // Two rows of headroom above the ears for raised paws and hats.
  // stand: feet on the last row (base); sit: lap row BY+3 = seat
  // ---------------------------------------------------------------------
  const AW = 17;
  const AH = 19;
  const CX = 8;
  const BX = 4;
  const BY = 12;
  const HX0 = 4;
  const HY0 = 5;
  const HEAD = ['.E.....E.', '.EI...IE.', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const HEAD_FLICK = ['.......E.', 'EEI...IE.', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const HEAD_WIDE = ['E.......E', 'EI.....IE', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const HEAD_BACK = ['.E.....E.', '.EE...EE.', '.FFFFFFF.', 'FFFFFFFFF', 'FFFFFFFFF', 'FFFFFFFFF', '.FFFFFFF.'];
  const BODY = {
    stand: ['..SSSSS..', '.SSSSSSS.', '.SSSSSSS.', '.hSSSSSh.', '..LLLLL..', '..LL.LL..', '..kk.kk..'],
    round: ['..SSSSS..', '.SSSSSSS.', 'SSSSSSSSS', 'hSSSSSSSh', '.LLLLLLL.', '..LL.LL..', '..kk.kk..'],
    sit: ['..SSSSS..', '.SSSSSSS.', '.SSSSSSS.', '.hLLLLLh.', '..LL.LL..', '..kk.kk..'],
  };
  // raised arms, left side as [dx from BX, y, ch]; mirrored for the right
  const ARM = {
    up: [[1, BY, 'S'], [0, BY, 'S'], [0, BY - 1, 'S'], [-1, BY - 1, 'S'], [-1, BY - 2, 'h'], [-2, BY - 3, 'h'], [-2, BY - 4, 'h'], [-2, BY - 5, 'h'], [-2, BY - 6, 'h'], [-2, BY - 7, 'h'], [-2, BY - 8, 'h'], [-3, BY - 8, 'h']],
    up2: [[1, BY, 'S'], [0, BY, 'S'], [0, BY - 1, 'S'], [-1, BY - 1, 'S'], [-1, BY - 2, 'h'], [-2, BY - 3, 'h'], [-2, BY - 4, 'h'], [-2, BY - 5, 'h'], [-2, BY - 6, 'h'], [-3, BY - 7, 'h'], [-3, BY - 8, 'h'], [-4, BY - 8, 'h']],
    // holding the rider's sneakers at cheek height
    shoulder: [[1, BY, 'S'], [0, BY, 'S'], [0, BY - 1, 'S'], [-1, BY - 1, 'h'], [-1, BY - 2, 'h']],
    // forearm across the chest, paw under the chin (a songbook)
    chest: [[1, BY + 1, 'S'], [1, BY + 2, 'S'], [2, BY + 2, 'S'], [3, BY + 1, 'h']],
    // held out at the side at waist height (a glass, a mug, a lantern stick)
    out: [[1, BY + 1, 'S'], [0, BY + 2, 'h'], [-1, BY + 2, 'h']],
    // raised beside the head (a toast, an umbrella)
    toast: [[1, BY, 'S'], [0, BY, 'S'], [-1, BY - 1, 'S'], [-2, BY - 2, 'h'], [-2, BY - 3, 'h']],
    // straight out sideways at shoulder height (a cape spread wide)
    wide: [[1, BY, 'S'], [0, BY, 'S'], [-1, BY, 'S'], [-2, BY, 'S'], [-3, BY, 'h']],
  };
  /** pose one paw (side -1 left, 1 right) */
  function armPose(G, side, kind, pawX) {
    const a = ARM[kind];
    if (!a) return;
    for (let y = BY + 1; y <= BY + 3; y++) if ('ShAC'.includes(get(G, pawX, y))) set(G, pawX, y, '.');
    for (const [dx, y, ch] of a) set(G, side < 0 ? BX + dx : BX + 8 - dx, y, ch);
  }
  /** body wear drawn before the arms: collars, long coats, dresses, capes */
  function bodyWear(G, sp, sit) {
    if (sp.neck === 'mandarin') {
      for (let x = BX + 3; x <= BX + 5; x++) set(G, x, BY, 'C');
      set(G, BX + 5, BY + 1, 'C');
    } else if (sp.neck === 'vneck') {
      set(G, BX + 4, BY, 'h');
      set(G, BX + 4, BY + 1, 'h');
    }
    if (sit) return;
    if (sp.coat) {
      for (let x = BX + 2; x <= BX + 6; x++) set(G, x, BY + 4, 'S');
      set(G, BX + 4, BY + 1, 'A');
      set(G, BX + 4, BY + 3, 'A');
      set(G, BX + 4, BY + 4, 'A');
    }
    if (sp.dress) {
      for (let x = BX + 1; x <= BX + 7; x++) set(G, x, BY + 4, 'L');
      for (const x of [BX + 2, BX + 3, BX + 5, BX + 6]) if (get(G, x, BY + 5) === 'L') set(G, x, BY + 5, 'h');
    }
    if (sp.cape) {
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
    beret: [[2, 1, 'a'], [3, 1, 'a'], [4, 1, 'a'], [5, 1, 'a'], [6, 1, 'a'], [3, 0, 'a'], [4, 0, 'a'], [5, 0, 'a'], [4, -1, 'p']],
  };
  /** worn over fur and hair: hats, scarves, a cape's high collar */
  function topWear(G, sp, HX, HY) {
    if (sp.hat) for (const [c, r, ch] of HATS[sp.hat]) set(G, HX + c, HY + r, ch);
    if (sp.scarf) {
      for (let x = BX + 2; x <= BX + 6; x++) set(G, x, BY, x & 1 ? 'r' : 's');
      const tx = sp.scarf === 'L' ? BX + 3 : BX + 5;
      set(G, tx, BY + 1, 's');
      set(G, tx, BY + 2, 'r');
    }
    if (sp.cape) {
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
   *  'wave'|'wave2'|'offer'|'hold', p.al / p.ar single-paw poses, p.sit,
   *  p.walk 0..3 (1, 3 lift a foot), p.back (seen from behind),
   *  p.hx/p.hy head offset, p.br breeze px (-2..2), p.gust -1|0|1
   */
  function buildAdult(sp, p) {
    const G = grid(AW, AH);
    const HX = HX0 + (p.hx || 0);
    const HY = HY0 + (p.hy || 0);
    const sit = !!p.sit;
    const body = sit ? BODY.sit : sp.round ? BODY.round : BODY.stand;
    stamp(G, body, BX, BY);
    // shirt pattern
    for (let y = BY; y < BY + 4; y++)
      for (let x = 0; x < AW; x++) {
        if (G[y][x] !== 'S') continue;
        const u = x - BX;
        const v = y - BY;
        const pt = sp.pattern;
        if (pt === 'stripesV' && u % 2 === 1) G[y][x] = 'A';
        else if (pt === 'stripesH' && v % 2 === 1) G[y][x] = 'A';
        else if (pt === 'plaid' && (u % 3 === 1 || v === 2)) G[y][x] = 'A';
        else if (pt === 'floral' && (u * 3 + v * 5) % 7 === 2) G[y][x] = 'A';
        else if (pt === 'band' && v === 2) G[y][x] = 'A';
        else if (pt === 'cable' && v >= 1 && u % 3 === 1) G[y][x] = 'A';
        else if (pt === 'hem' && v === 3) G[y][x] = 'A';
        else if (pt === 'sash' && (u === v + 2 || u === v + 3)) G[y][x] = 'A';
        else if (pt === 'bones' && ((u === 4 && v >= 1) || ((v === 1 || v === 3) && u >= 2 && u <= 6 && u !== 4))) G[y][x] = 'A';
        else if (pt === 'jack' && ((v === 1 && (u === 2 || u === 6)) || (v === 2 && u === 4) || (v === 3 && u >= 2 && u <= 6 && u !== 4))) G[y][x] = 'A';
      }
    if (!p.back) {
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
    } else if (sp.neck === 'polo') for (let x = BX + 3; x <= BX + 5; x++) set(G, x, BY, 'C');
    if (sp.sleeveTip) {
      const w = sp.round ? 0 : 1;
      set(G, BX + w, BY + 2, 'C');
      set(G, BX + 8 - w, BY + 2, 'C');
    }
    if (sp.belt) for (let x = BX + 2; x <= BX + 6; x++) set(G, x, sit ? BY + 3 : BY + 4, 'Q');
    if (!p.back) bodyWear(G, sp, sit);
    // ---- legs: a walk cycle lifts one foot at a time ----
    const step = p.walk === 1 || p.walk === 3 ? (p.walk === 1 ? [BX + 2, BX + 3] : [BX + 5, BX + 6]) : null;
    // ---- arms ----
    const pawL = sp.round ? BX : BX + 1;
    const pawR = sp.round ? BX + 8 : BX + 7;
    const arms = p.arms || 'down';
    if (arms === 'up') {
      armPose(G, -1, 'up', pawL);
      armPose(G, 1, 'up', pawR);
    } else if (arms === 'shoulder') {
      armPose(G, -1, 'shoulder', pawL);
      armPose(G, 1, 'shoulder', pawR);
    } else if (arms === 'wave') armPose(G, 1, 'up', pawR);
    else if (arms === 'wave2') armPose(G, 1, 'up2', pawR);
    else if (arms === 'offer') {
      for (let y = BY + 1; y <= BY + 3; y++) set(G, pawL, y, '.');
      set(G, pawL, BY + 1, 'S');
      set(G, pawL - 1, BY + 2, 'h');
      set(G, pawL - 2, BY + 2, 'h');
    } else if (arms === 'hold') set(G, pawL, BY + 3, '.');
    if (p.al) armPose(G, -1, p.al, pawL);
    if (p.ar) armPose(G, 1, p.ar, pawR);
    // ---- head ----
    if (p.back) {
      stamp(G, HEAD_BACK, HX, HY);
      if (sp.glassesUp || sp.glasses) {
        // the temple arms of his sunglasses, seen from behind
        set(G, HX, HY + 3, 'g');
        set(G, HX + 8, HY + 3, 'g');
      }
      topWear(G, sp, HX, HY);
      return G;
    }
    stamp(G, p.wide ? HEAD_WIDE : p.ear ? HEAD_FLICK : HEAD, HX, HY);
    if (sp.temples) for (const [x, y] of [[0, 3], [8, 3], [1, 2], [7, 2], [0, 4], [8, 4]]) set(G, HX + x, HY + y, 'x');
    if (sp.tabby) for (const [x, y] of [[3, 2], [5, 2], [4, 3], [0, 3], [8, 3], [1, 5], [7, 5]]) set(G, HX + x, HY + y, 'O');
    if (sp.sheen && sp.hair !== 'long') for (const [x, y] of [[2, 2], [3, 2]]) set(G, HX + x, HY + y, 'J');
    const L = HX + (p.look || 0);
    if (sp.muzzle) {
      set(G, L + 3, HY + 5, sp.muzzle);
      set(G, L + 5, HY + 5, sp.muzzle);
      set(G, L + 4, HY + 6, sp.muzzle);
    }
    const eyes = p.blink ? 'closed' : p.eyes || 'open';
    const arc = sp.happyEm ? 'e' : 'q';
    if (sp.glasses) {
      // the lenses stay on whatever the eyes do; the mouth carries the laugh
      const av = sp.glasses === 'aviator';
      {
        for (const ox of [2, 5])
          for (let k = 0; k < 2; k++) {
            set(G, L + ox + k, HY + 3, 'G');
            set(G, L + ox + k, HY + 4, 'G');
          }
        set(G, L + 1, HY + 3, 'g');
        set(G, L + 4, HY + 3, 'g');
        set(G, L + 7, HY + 3, 'g');
        set(G, L + 2, HY + 3, 'z');
        if (av) {
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
    if (sp.glassesUp) {
      // sunglasses pushed up on his head
      for (let k = 1; k <= 7; k++) set(G, HX + k, HY + 2, 'g');
      for (const ox of [2, 5]) {
        set(G, HX + ox, HY + 2, 'G');
        set(G, HX + ox + 1, HY + 2, 'G');
      }
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
      set(G, HX - 1, HY + 5, 'w');
      set(G, HX + 9, HY + 4, 'w');
    }
    // ---- long straight hair (his wife) ----
    if (sp.hair === 'long') {
      const br = p.br || 0;
      for (let x = 1; x <= 7; x++) set(G, HX + x, HY + 2, 'H');
      for (const x of [0, 1, 7, 8]) set(G, HX + x, HY + 3, 'H');
      set(G, HX + 2, HY + 2, 'J');
      set(G, HX + 3, HY + 2, 'J');
      for (let y = HY + 3; y <= HY + 6; y++) {
        set(G, HX - 1, y, 'H');
        set(G, HX, y, 'H');
        set(G, HX + 8, y, 'H');
        set(G, HX + 9, y, 'H');
      }
      set(G, HX - 1, HY + 4, 'J');
      set(G, HX - 1, HY + 5, 'J');
      // over the shoulders, then falling straight down the sides of her top
      // to the waist; the ends trail with the breeze
      const sg = Math.sign(br);
      const ab = Math.abs(br);
      for (let i = 0; i < 5; i++) {
        const y = BY + i;
        const d = sg * Math.min(ab, i < 2 ? 0 : i - 1);
        if (i < 2) {
          set(G, BX + 1, y, i === 1 ? 'J' : 'H');
          set(G, BX + 7, y, 'H');
        }
        if (i < 4 || d !== 0) {
          set(G, BX + d, y, 'H');
          set(G, BX + 8 + d, y, 'H');
        }
      }
      if (p.gust) set(G, p.gust > 0 ? HX + 10 : HX - 2, HY + 3, 'H');
    }
    // ---- wavy hair (his sister) ----
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
      set(G, HX + 1, HY - 1, 'B');
      set(G, HX + 3, HY - 1, 'B');
      set(G, HX + 1, HY + 0, 'B');
      set(G, HX + 2, HY + 0, 'b');
      set(G, HX + 3, HY + 0, 'B');
      set(G, HX + 2, HY + 1, 'B');
    }
    topWear(G, sp, HX, HY);
    if (step) {
      // passing frame: the body rides a pixel higher on the planted leg,
      // the lifted foot swings up under the hem
      for (let y = 0; y < BY + 5; y++) G[y] = G[y + 1].slice();
      for (const x of step) {
        set(G, x, BY + 4, 'k');
        set(G, x, BY + 5, '.');
        set(G, x, BY + 6, '.');
      }
    }
    return G;
  }

  function adultMap(sp) {
    const F = sp.fur;
    const m = {
      E: F,
      F,
      h: F,
      I: sp.inner,
      O: sp.dark || F,
      x: sp.silver || F,
      w: sp.whisker || '#6a6c76',
      f: sp.light || F,
      J: sp.sheenC || F,
      H: sp.hairC || F,
      n: sp.nose,
      m: sp.mouthC || '#0a070c',
      M: sp.tongue,
      q: sp.lid || '#07060a',
      S: sp.shirt,
      A: sp.shirtAlt || sp.shirt,
      C: sp.collar || sp.shirt,
      L: sp.pants,
      Q: sp.belt || sp.pants,
      k: sp.shoes || '#121218',
      g: sp.frame || '#2c3242',
      G: sp.lens || '#0c0f18',
      B: sp.bow || F,
      b: sp.bowDark || F,
      a: sp.hatC || F,
      c: sp.hatC2 || sp.hatC || F,
      d: sp.hatBand || sp.hatC || F,
      p: sp.pom || F,
      u: sp.flower2 || sp.pom || F,
      v: sp.leaf || F,
      r: sp.scarfC || F,
      s: sp.scarfC2 || sp.scarfC || F,
      K: sp.capeC || F,
    };
    const em = { e: sp.eye || '#d9b45a', z: sp.glint || '#a8c4e8' };
    return { m, em };
  }
  const POSEK = ['look', 'blink', 'ear', 'eyes', 'mouth', 'arms', 'sit', 'wide', 'hx', 'hy', 'br', 'gust', 'al', 'ar', 'walk', 'back'];
  function adult(sp, p) {
    let key = 'A|' + sp.key;
    for (const k of POSEK) key += '|' + (p[k] === undefined || p[k] === false || p[k] === 0 ? '' : p[k]);
    return memo(key, () => {
      const mp = sp._map || (sp._map = adultMap(sp));
      return bake(buildAdult(sp, p), mp.m, mp.em);
    });
  }

  // ---------------------------------------------------------------------
  // the niece: oversized round head (pointed ears, top-knot) with a big pink
  // bow, big shiny eyes, a tiny body. Head col c / row r -> world
  // (x - 4 + c, base - 9 + r); feet on base.
  // ---------------------------------------------------------------------
  const NW = 15;
  const NH = 13;
  const KX = 3;
  const KR = 3;
  const KHEAD = ['.E..t..E.', '.EIFFFIE.', 'FFFfffFFF', 'FfwWfwWfF', 'FFWvnWvFF', '.cFlslFc.', '..FFFFF..'];
  const KHEAD_BLINK = ['.E..t..E.', '.EIFFFIE.', 'FFFfffFFF', 'FfFFfFFfF', 'FFqqnqqFF', '.cFlslFc.', '..FFFFF..'];
  const KFEAT = 'wWvnsql';
  const KBOW = ['Pp.pP', 'ppkpp', 'pp.pp'];
  const KARM = {
    up: [[2, 7, 'T'], [1, 6, 'T'], [0, 5, 'h'], [-1, 4, 'h'], [-2, 3, 'h'], [-2, 2, 'h'], [-2, 1, 'h'], [-2, 0, 'h'], [-2, -1, 'h'], [-2, -2, 'h']],
    up2: [[2, 7, 'T'], [1, 6, 'T'], [0, 5, 'h'], [-1, 4, 'h'], [-2, 3, 'h'], [-2, 2, 'h'], [-2, 1, 'h'], [-2, 0, 'h'], [-2, -1, 'h'], [-3, -2, 'h']],
    lift: [[2, 7, 'T'], [1, 6, 'T'], [0, 5, 'h'], [-1, 4, 'h'], [-1, 3, 'h'], [-1, 2, 'h'], [-1, 1, 'h'], [-1, 0, 'h'], [-1, -1, 'h'], [-1, -2, 'h'], [-1, -3, 'h'], [0, -4, 'h'], [0, -5, 'h']],
  };
  /**
   * p.pose: stand|walk|walk2|sit|ride|held|carry|lift
   * p.arms: down|up|wave|wave2 (lift/carry set their own), p.blink, p.look
   */
  function buildKit(o, p) {
    const pose = p.pose || 'stand';
    const extra = pose === 'lift' ? 2 : 0;
    const G = grid(NW, NH + extra);
    const ox = KX;
    const oy = KR + extra;
    const S = (c, r, ch) => set(G, ox + c, oy + r, ch);
    const look = p.look || 0;
    const top = pose === 'ride' ? ['...TTT...', '...TTT...'] : o.dress ? ['...TTT...', '..TUTUT..'] : ['...TTT...', '..TTTTT..'];
    stamp(G, top, ox, oy + 7);
    if (o.stripes) for (let c = 2; c <= 6; c++) if (get(G, ox + c, oy + 8) === 'T') S(c, 8, 'U');
    if (pose === 'walk' || pose === 'sit') stamp(G, ['..z...z..'], ox, oy + 9);
    else if (pose === 'walk2') stamp(G, ['...z..z..'], ox, oy + 9);
    else if (pose !== 'ride') stamp(G, ['...z.z...'], ox, oy + 9);
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
    } else if (pose !== 'ride') {
      S(1, 8, 'h');
      S(7, 8, 'h');
    }
    const head = p.blink ? KHEAD_BLINK : KHEAD;
    for (let r = 0; r < head.length; r++)
      for (let c = 0; c < head[r].length; c++) {
        const ch = head[r][c];
        if (ch === '.') continue;
        S(c, r, KFEAT.includes(ch) ? (r === 3 ? 'f' : 'F') : ch);
      }
    for (let r = 0; r < head.length; r++)
      for (let c = 0; c < head[r].length; c++) {
        const ch = head[r][c];
        if (KFEAT.includes(ch)) S(c + look, r, ch);
      }
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
  function kit(o, p) {
    const key = 'K|' + o.key + '|' + (p.pose || 'stand') + '|' + (p.arms || 'down') + (p.blink ? 'b' : '') + (p.look || 0);
    return memo(key, () => bake(buildKit(o, p), o.map, { w: '#ffffff' }));
  }
  /** blit the kitten so her feet sit on base, centred on x */
  function blitKit(g, o, p, x, base) {
    const s = kit(o, p);
    const extra = p.pose === 'lift' ? 2 : 0;
    blit(g, s, x - 4 - KX, base - 9 - KR - extra);
  }

  // ---------------------------------------------------------------------
  // the cast of an edition (colours painted for its light mode)
  // ---------------------------------------------------------------------
  const BLACK = '#1e1826'; // his fur in daylight (painted per light mode like everything else)
  function makeCast(ed) {
    const c = painter(ed.light || 'night');
    const V = (h) => c(h, 0.2); // her clothes: a touch brighter, the eye finds her
    const id = ed.id;
    const pre = id + ':';
    // ---- him ----
    const you = {
      key: pre + 'you',
      fur: c(BLACK),
      light: c('#3a3044'),
      inner: c('#7a4050'),
      nose: c('#4a3040'),
      tongue: c('#e07080'),
      eye: HD.mascot ? HD.mascot.eye : '#e8d890',
      mouth: 'smile',
      mouthC: c('#9a80a0'),
      frame: c('#5a6078'),
      lens: c('#1a2030'),
      happyEm: true,
      neck: 'tee',
      shoes: c('#1e1c24'),
    };
    if (id === 'match')
      Object.assign(you, { shirt: c('#c8102e', 0.2), collar: c('#ffc400', 0.2), neck: 'polo', sleeveTip: true, pants: c('#2a2a34'), glasses: 'wayfarer', glint: '#6a7898' });
    else if (id === 'nyc') Object.assign(you, { shirt: c('#f07a68', 0.2), pants: c('#d8ccb0'), glassesUp: true });
    else if (id === 'la')
      Object.assign(you, { shirt: c('#b8343c'), shirtAlt: c('#2a3460'), pattern: 'plaid', neck: 'shirt', collar: c('#c84450'), pants: c('#3a3a44'), glasses: 'wayfarer', glint: '#ffffff' });
    else if (id === 'sandiego') Object.assign(you, { shirt: c('#f6f1e6'), pants: c('#9a9484'), belt: c('#4a3e34'), glasses: 'wayfarer', shoes: c('#e8e4dc'), glint: '#ffffff' });
    else
      Object.assign(you, {
        shirt: c('#7aa6e8'),
        shirtAlt: c('#a8c8f4'),
        collar: c('#a8c8f4'),
        neck: 'shirt',
        pants: c('#e8e0cc'),
        glassesUp: true,
        frame: c('#d8c070'),
        lens: c('#3a7ae0'),
      });
    // ---- his wife ----
    const herFur = { fur: c('#2a2026'), hair: 'long', hairC: c('#221c2e'), sheenC: c('#5c5680'), light: c('#3a2c34'), eye: '#c8d870', nose: c('#a05868'), inner: c('#b06878'), tongue: c('#e07080'), mouthC: c('#4a2630'), happyEm: true, shoes: c('#1e1c24') };
    const partner = Object.assign({ key: pre + 'partner', mouth: 'smile', shirt: V('#fff6e8'), neck: 'tee', pants: V('#2a2a34') }, herFur);
    // ---- his sister and her husband, his dad ----
    const sister = {
      key: pre + 'sister',
      fur: c('#32242a'),
      hair: 'wavy',
      hairC: c('#3a241e'),
      happyEm: true,
      sheen: true,
      sheenC: c('#7a5240'),
      eye: '#d8c070',
      nose: c('#b06070'),
      inner: c('#b06878'),
      tongue: c('#e07080'),
      mouth: 'smile',
      mouthC: c('#4a2630'),
      headband: true,
      bow: c('#3a78e8', 0.2),
      bowDark: c('#2050b0', 0.2),
      shirt: c('#3a68c0'),
      shirtAlt: c('#f0f2f6'),
      pattern: 'stripesV',
      neck: 'shirt',
      collar: c('#f0f2f6'),
      pants: c('#ece8e0'),
      shoes: c('#c8b890'),
    };
    const bil = {
      key: pre + 'bil',
      fur: c('#8a8a90'),
      dark: c('#3e3e46'),
      light: c('#c8c8cc'),
      muzzle: 'f',
      tabby: true,
      eye: '#d8c070',
      nose: c('#a86070'),
      inner: c('#c08890'),
      tongue: c('#e07080'),
      mouth: 'smile',
      mouthC: '#2a1a22',
      glasses: 'aviator',
      frame: c('#f0c040', 0.2),
      lens: c('#8a5a2a'),
      glint: '#ffe0a0',
      shirt: c('#f2ead2'),
      collar: c('#fff8e6'),
      neck: 'polo',
      pants: c('#2a2a30'),
      shoes: c('#7a5a3a'),
    };
    if (id === 'la') Object.assign(bil, { shirt: c('#d8dce4'), shirtAlt: c('#7a8aa8'), pattern: 'stripesV', neck: 'shirt', collar: c('#e8ecf2') });
    if (id === 'dc') Object.assign(bil, { glasses: null, shirt: c('#4a5670'), shirtAlt: c('#7a879c'), pattern: 'plaid', neck: 'shirt', collar: c('#8a96aa') });
    const dad = {
      key: pre + 'dad',
      fur: c('#2e2428'),
      silver: c('#9a9ca4'),
      muzzle: 'x',
      temples: true,
      whiskers: true,
      whisker: c('#8a8c96'),
      happyEm: true,
      eye: '#d8b060',
      nose: c('#a86070'),
      inner: c('#a87078'),
      tongue: c('#e07080'),
      mouth: 'laugh',
      round: true,
      shirt: c('#d42a30', 0.2),
      collar: c('#ffffff'),
      neck: 'polo',
      sleeveTip: true,
      pants: c('#1c1c22'),
      shoes: c('#2a2a30'),
      hat: 'party',
      hatC: c('#f4c440', 0.2),
      hatC2: c('#3a8ae0', 0.2),
      pom: c('#ffffff'),
    };
    // ---- her friends: original generic cats ----
    const friend = {
      ginger: { fur: c('#d4782f'), dark: c('#94451a'), light: c('#f6d29c'), muzzle: 'f', tabby: true, inner: c('#f0a0a0'), eye: '#e8d050', nose: c('#e88a94'), tongue: c('#e07080'), mouthC: '#3a160c', happyEm: true },
      cream: { fur: c('#ece2d0'), light: c('#fffaf0'), muzzle: 'f', inner: c('#f4a8b4'), eye: '#8cc8f4', nose: c('#f08c9c'), tongue: c('#e07080'), mouthC: '#5a3438', lid: '#3a2a2a', happyEm: true },
      tabby: { fur: c('#a0a6b0'), dark: c('#4e545e'), light: c('#dfe2e8'), muzzle: 'f', tabby: true, inner: c('#d8909c'), eye: '#a8dc68', nose: c('#c87888'), tongue: c('#e07080'), mouthC: '#2a1a22', happyEm: true },
      partner: herFur,
    };
    // ---- the niece's outfit ----
    const kitC = {
      F: c('#6e4430'),
      E: c('#6e4430'),
      I: c('#e88aa0'),
      t: c('#8a5638'),
      f: c('#946247'),
      l: c('#d6a888'),
      v: '#2a2a4a',
      h: c('#6e4430'),
      p: c('#ff5aa0', 0.15),
      P: c('#ffc4e0', 0.15),
      k: c('#b02a68', 0.15),
      W: '#0a070c',
      n: c('#e08a96'),
      s: c('#a03848'),
      c: c('#f08a9a'),
      q: '#120c10',
      z: c('#d83a3a'),
      Y: c('#ffd23a', 0.15),
      y: c('#f0e8d8'),
    };
    const kitTop = {
      la: { top: c('#26346a'), alt: c('#fff6e8'), stripes: true },
      sandiego: { top: c('#3c66e0', 0.2) },
      dc: { top: c('#6a1830', 0.15), alt: c('#f4c8d4'), dress: true, cup: true },
    }[id] || { top: c('#f27aa8', 0.15), alt: c('#ffd0e2', 0.15) };
    const niece = Object.assign({ key: pre + 'kit' }, kitTop);
    niece.map = Object.assign({}, kitC, { T: kitTop.top, U: kitTop.alt || kitTop.top });
    return { c, V, you, partner, sister, bil, dad, friend, niece, kitC };
  }
  const CAST = HD.perEdition(makeCast);

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
    const b = SU.breeze(t);
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
  // walking: the tail streams out behind, the tip bobbing
  function trailTail(g, x, y, side, f, c) {
    const pts = [[1, 0], [2, 0], [3, -1], [4, -1], [5, -2 - (f & 1)]];
    for (let i = 0; i < pts.length; i++) {
      g.px(x + side * pts[i][0], y + pts[i][1], c);
      if (i < 2) g.px(x + side * pts[i][0], y + pts[i][1] - 1, c);
    }
  }
  // long plume tail hanging down (her, seated), drifts with breeze
  function plume(g, x, y, side, br, c, hi) {
    for (let i = 0; i < 7; i++) {
      const dx = side * (1 + Math.min(i, 3)) + R(br * Math.max(0, i - 2) * 0.25);
      g.px(x + dx, y + i, c);
      g.px(x + dx + side, y + i, c);
      if (i === 2) g.px(x + dx, y + i, hi);
    }
  }
  /** contact shadow under the feet (soft dithered ends) */
  function shadow(g, x, base, hw) {
    const c = HD.light().day > 0.5 ? '#1c1a20' : '#0a0a10';
    for (let dx = -hw; dx <= hw; dx++) {
      if (Math.abs(dx) === hw && HD.bayer(x + dx, base) > 0.5) continue;
      g.px(x + dx, base + 1, c);
    }
  }

  // ---------------------------------------------------------------------
  // a standing / sitting / walking adult with idle life
  // ---------------------------------------------------------------------
  function drawAdult(g, t, sp, x, base, seed, o) {
    const id = idle(t, seed);
    const p = Object.assign({ look: id.look, blink: id.blink, ear: id.ear }, o || {});
    if (p.look === undefined) p.look = id.look;
    if (p.eyes || p.back) p.blink = false;
    const s = adult(sp, p);
    const sit = !!p.sit;
    const top = base - (sit ? BY + 3 : AH - 1);
    const left = x - CX;
    if (!sit && !(o && o.noShadow)) shadow(g, x, base, sp.round ? 4 : 3);
    const side = sp.tailSide || (seed % 2 ? 1 : -1);
    if (!(o && o.noTail) && !p.back) {
      if (p.walk !== undefined) trailTail(g, x + side * 3, base - 3, side, p.walk, sp.fur);
      else if (sit && sp.hair) plume(g, x + side * 3, base + 1, side, p.br || 0, sp.hairC || sp.fur, sp.sheenC || sp.fur);
      else tail(g, x + side * (sp.round ? 4 : 3), sit ? base + 1 : base - 3, side, id.sw, sp.fur);
    }
    blit(g, s, left, top);
    if (p.back && !(o && o.noTail)) {
      // seen from behind: the tail hangs down the middle and flicks at the tip
      const k = id.sw > 0.33 ? 1 : id.sw < -0.33 ? -1 : 0;
      g.px(x + 1, base - 3, sp.fur);
      g.px(x + 2, base - 2, sp.fur);
      g.px(x + 2, base - 1, sp.fur);
      g.px(x + 2 + k, base, sp.fur);
    }
    return { top, left, id, p };
  }
  function cheer(extra) {
    return Object.assign({ arms: 'up', mouth: 'laugh', eyes: 'happy', look: 0 }, extra || {});
  }
  /** walk frame (0..3) at ~7 fps, phase-shifted per walker */
  function walkFrame(t, k) {
    return (Math.floor(T.step(t, 7) * 7) + k) % 4;
  }

  // ---------------------------------------------------------------------
  // the niece
  // ---------------------------------------------------------------------
  function drawKit(g, t, o, x, base, p) {
    if (p.pose !== 'ride' && p.pose !== 'held') {
      shadow(g, x, base, 2);
      const sw = T.wave(T.step(t, 8), 3.3, 0.4);
      const c = o.map.F;
      g.px(x + 4, base - 2, c);
      g.px(x + 5, base - 3 + (sw > 0.3 ? -1 : 0), c);
    }
    blitKit(g, o, p, x, base);
  }
  function kitIdle(t, seed) {
    const id = idle(t, seed);
    return { blink: id.blink, look: id.look };
  }
  function waveArm(t) {
    return Math.floor(T.step(t, 5) * 5) % 2 ? 'wave2' : 'wave';
  }

  // ---------------------------------------------------------------------
  // small things: the toy crane, the present, sparkles, the giraffe plush
  // ---------------------------------------------------------------------
  const CRANE_ROWS = [
    ['........', '........', '.....YYY', '.YY.Y...', '.gYY....', 'YYYYYY..', 'yyyyyyy.', '.KK..KK.'],
    ['........', '......YY', '.....Y..', '.YY.Y...', '.gYY....', 'YYYYYY..', 'yyyyyyy.', '.KK..KK.'],
    ['.......Y', '......Y.', '.....Y..', '.YY.Y...', '.gYY....', 'YYYYYY..', 'yyyyyyy.', '.KK..KK.'],
  ];
  const CRANE_TIP = [[7, 2], [7, 1], [7, 0]];
  function smallMap(ed) {
    return memo('small|' + ed.id, () => {
      const c = painter(ed.light || 'night');
      return {
        crane: { Y: c('#ffd02a', 0.15), y: c('#d89a10', 0.15), K: '#141218', g: c('#d8e8f0', 0.15) },
        box: { B: c('#f070b0', 0.15), b: c('#c04888', 0.15), R: c('#ffd040', 0.15) },
        hook: c('#e04030', 0.15),
        giraffe: { Y: c('#f2c84a', 0.15), o: c('#a8682c'), k: c('#4a3020'), m: c('#e8b880') },
        IC: {
          glass: c('#e4ecf4'),
          fizz: c('#f2d27a'),
          lemon: c('#f4e08a'),
          stick: '#2c2a32',
          steam: ed.light === 'golden' || ed.light === 'day' ? c('#f4f0ea') : '#7c8296',
          wicker: c('#c89a5e'),
          wickerD: c('#8a6038'),
          book: c('#9a1e2a'),
          bookG: c('#2a6a3a'),
          page: c('#f2ead6'),
          frame: '#24222a',
          step: c('#4a4048'),
          stepHi: c('#6a5e66'),
          pail: c('#ee7a22'),
          pailD: c('#a8461a'),
          bag: [c('#e86a9a'), c('#5ac0a8'), c('#f2c84a')],
          canopy: c('#4a2a6a'),
          canopyD: c('#2e1a46'),
          canopyH: c('#6a4a8e'),
        },
        egg: [c('#f4a8c8'), c('#a8d0f4'), c('#f4e08a'), c('#b8e8b0'), c('#d0b0f0')],
        mug: { white: c('#efe6d6'), red: c('#c84a3a'), blue: c('#4a7ab8') },
      };
    });
  }
  function drawCrane(g, x, base, boom, drop) {
    const sm = smallMap(HD.edition);
    x = R(x);
    base = R(base);
    const s = memo('crane|' + HD.edition.id + boom, () => bake(CRANE_ROWS[boom].map((r) => r.split('')), sm.crane, null));
    const ox = x - 4;
    const oy = base - 7;
    blit(g, s, ox, oy);
    const [tx, ty] = CRANE_TIP[boom];
    const n = Math.max(1, Math.min(3 - ty, R(drop === undefined ? 3 : drop)));
    for (let i = 1; i <= n; i++) g.px(ox + tx, oy + ty + i, '#141218');
    g.px(ox + tx, oy + ty + n + 1, sm.hook);
    g.px(ox + tx - 1, oy + ty + n + 1, sm.hook);
  }
  const BOX_ROWS = ['..R.R..', 'BBBRBBB', 'bbbRbbb', 'BBBRBBB', 'BBBRBBB'];
  function drawBox(g, x, base, part) {
    part = part || 'full';
    const sm = smallMap(HD.edition);
    const h = part === 'lid' ? 3 : part === 'body' ? 2 : 5;
    const s = memo('box|' + HD.edition.id + part, () => {
      const rows = part === 'lid' ? BOX_ROWS.slice(0, 3) : part === 'body' ? BOX_ROWS.slice(3) : BOX_ROWS;
      return bake(rows.map((r) => r.split('')), sm.box, null);
    });
    blit(g, s, R(x) - 3, R(base) - h + 1);
  }
  function sparkle(g, t, x, y) {
    const sp = Math.floor(T.step(t, 8) * 8) % 3;
    const e = g.em;
    e.px(x - 4 + sp, y, '#fff2b0');
    e.px(x + 4 - sp, y + 1, '#ffe08a');
    e.px(x, y - 2 + (sp % 2), '#ffffff');
  }
  // a small giraffe plush: ossicones, head with a muzzle, spotted neck and body
  const GIRAFFE = ['.k.k.', '.YYY.', '.YYmm', '.Yo..', '.oY..', '.Yo..', 'YoYY.', 'YYoY.', 'k..k.'];
  function drawGiraffe(g, x, y, flip) {
    const sm = smallMap(HD.edition);
    const s = memo('giraffe|' + HD.edition.id, () => bake(GIRAFFE.map((r) => r.split('')), sm.giraffe, null));
    if (flip) g.sprite(s.alb, R(x) - 1, R(y) - 1, true);
    else blit(g, s, R(x), R(y));
  }

  // =====================================================================
  // HIS WIFE IN THE WINDOW: HD.drawPartner(g, t, x, base)
  // A dark silhouette like the series cat, with long straight hair falling
  // past her shoulder and a long plume tail. x = left edge of her 11-px
  // column (head at x+2..x+8), base = the row under her (as the series
  // cat's: 12 px tall).
  // She leans her head on his now and then (he sits to her right).
  // =====================================================================
  // the series cat's head and body, with long straight hair from a side
  // parting swept over her outer shoulder and falling to the sill, where it
  // spreads a little: the asymmetric outline reads as hair even as a
  // silhouette. R is the backlit rim of the hair (mid-tone paint that the
  // room light behind her warms into a soft edge).
  const WP_ROWS = [
    '..K.....K..',
    '..KK...KK..',
    '.HHJJKKKK..',
    '.HKKKKKKK..',
    '.HKKKKKKK..',
    'RHHKKKKK...',
    'RHHKKKKK...',
    'RHJKKKKKK..',
    'RHHKKKKKKK.',
    'RHHKKKKKKKK',
    'RRHHKKKKKKK',
    'RRHHKKKKKKK',
  ];
  const WP_C = { K: '#0e0a14', H: '#1c1626', J: '#4e4268', R: '#46385a' };
  const WP_EYE = '#c8e070';
  function winPartner(lean) {
    return memo('winp' + lean, () => {
      const G = grid(16, 13);
      const hd = [0, 2, 5][lean];
      const hy = lean === 2 ? 1 : 0;
      // the head tips toward him; the body follows less and less toward the sill
      for (let r = WP_ROWS.length - 1; r >= 0; r--) {
        const sh = r <= 6 ? hd : R((hd * (11 - r)) / 6);
        stamp(G, [WP_ROWS[r]], sh, r + (r <= 6 ? hy : 0));
      }
      return spriteRows(G.map((r) => r.join('')), WP_C);
    });
  }
  const WIN_LEANS = [[30, 52], [118, 131], [168, 196]];
  function winLean(t) {
    const s = sec(T.step(t, 8));
    for (const [a, b] of WIN_LEANS) {
      if (s < a || s >= b) continue;
      return Math.min(s - a, b - s) < 0.6 ? 1 : 2;
    }
    return 0;
  }
  HD.drawPartner = function (g, t, x, base) {
    x = R(x);
    base = R(base);
    const k = winLean(t);
    const top = base - 12;
    // her plume tail, curling up on her outer side
    const ts = T.step(t, 8);
    const sw = T.wave(ts, 9.3, 0.31);
    const tc = WP_C.H;
    g.px(x + 1, base - 1, tc);
    g.px(x, base - 1, tc);
    g.px(x - 1, base - 2, tc);
    g.px(x, base - 2, tc);
    g.px(x - 1, base - 3, tc);
    g.px(x - 2, base - 4, tc);
    g.px(x - 2, base - 5, tc);
    g.px(x - 2 + (sw > 0.4 ? 1 : 0), base - 6, tc);
    g.px(x - 1 + (sw > 0.4 ? 1 : sw < -0.4 ? -1 : 0), base - 7, WP_C.J);
    g.sprite(winPartner(k), x, top);
    // when the niece waves up from the sidewalk, she waves back
    if (k === 0 && HD.edition.cast.niece && nieceWavingHome(t)) {
      const f = Math.floor(T.step(t, 5) * 5) % 2;
      g.vline(x - 1, top + 4, top + 7, WP_C.K);
      g.px(x - 2 + f, top + 3, WP_C.K);
      g.px(x - 2 + f, top + 2, WP_C.K);
      g.px(x - 1 + f, top + 2, WP_C.K);
    }
    // eyes: her own green-gold, now and then a glance at him; closed while she rests on him
    const id = idle(t, 21);
    const hd = [0, 2, 5][k];
    const hy = k === 2 ? 1 : 0;
    if (k === 2 || id.blink) return;
    const lk = id.look > 0 || k === 1 ? 1 : 0;
    g.px(x + hd + 3 + lk, top + hy + 4, WP_EYE);
    g.px(x + hd + 7 + lk, top + hy + 4, WP_EYE);
  };

  // =====================================================================
  // HER FRIENDS: the plaza group (cast.out 'friends')
  // =====================================================================
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

  // [x, base, tail side, facing], left to right; the plaza is x 330..440
  const ROW_PIT = [[371, 221, -1, 1], [384, 224, -1, 1], [416, 224, 1, -1], [429, 221, 1, -1]];
  const ROW_MID = [[352, 221, -1, 1], [365, 224, -1, 1], [378, 221, 1, -1], [391, 224, 1, -1]];

  const GROUP = {
    // Thanksgiving: sweaters and scarves, warm mugs by the fire pit, a toast
    thanksgiving: {
      row: ROW_PIT,
      cast: ['tabby', 'partner', 'ginger', 'cream'],
      wear: (c, V) => ({
        partner: { shirt: V('#ece0c4'), shirtAlt: V('#cdbf9e'), pattern: 'cable', neck: 'tee', pants: V('#2c3650'), scarf: 'R', scarfC: V('#c0582a'), scarfC2: V('#e8923e') },
        ginger: { shirt: c('#3a7a50'), shirtAlt: c('#ece0c4'), pattern: 'band', neck: 'tee', pants: c('#3a3036'), scarf: 'L', scarfC: c('#efe6d2'), scarfC2: c('#c8bca4') },
        cream: { shirt: c('#8e2a3a'), shirtAlt: c('#b84a58'), pattern: 'cable', neck: 'tee', pants: c('#2a2a34'), scarf: 'R', scarfC: c('#e0a83a'), scarfC2: c('#b88028') },
        tabby: { shirt: c('#d8a033'), shirtAlt: c('#8e2a3a'), pattern: 'band', neck: 'tee', pants: c('#4a3a30'), scarf: 'L', scarfC: c('#8e2a3a'), scarfC2: c('#b84a58') },
      }),
      big: (t, s) => inWin(s, 132, 138),
      act(c, t, s, big, sm) {
        const mugs = { partner: sm.mug.white, ginger: sm.mug.red, cream: sm.mug.blue, tabby: sm.mug.white };
        if (big >= 0) {
          give(c, c.face, 'toast', 'mug', { c: mugs[c.who] });
          c.o.eyes = 'happy';
          c.o.mouth = 'laugh';
          c.o.look = c.face;
        } else give(c, c.face, 'out', 'mug', { c: mugs[c.who] });
      },
    },
    // Christmas: long coats, knitted hats and scarves, carols by lantern light
    christmas: {
      row: ROW_MID,
      cast: ['partner', 'ginger', 'cream', 'tabby'],
      wear: (c, V) => ({
        partner: { shirt: V('#c88e52'), shirtAlt: V('#7a5432'), coat: true, neck: 'tee', pants: V('#2a2228'), hat: 'beanie', hatC: V('#d42a32'), hatC2: V('#f4eee6'), pom: V('#ffffff'), scarf: 'R', scarfC: V('#f4eee6'), scarfC2: V('#d42a32') },
        ginger: { shirt: c('#2c3c70'), shirtAlt: c('#c8a040'), coat: true, neck: 'tee', pants: c('#22222a'), hat: 'beanie', hatC: c('#ece4d4'), hatC2: c('#c8bca8'), pom: c('#ffffff'), scarf: 'L', scarfC: c('#c82a30'), scarfC2: c('#f2ece4') },
        cream: { shirt: c('#c02a30'), shirtAlt: c('#6a1218'), coat: true, neck: 'tee', pants: c('#22222a'), hat: 'beanie', hatC: c('#2a7a44'), hatC2: c('#f2ece4'), pom: c('#ffffff'), scarf: 'R', scarfC: c('#2a7a44'), scarfC2: c('#f2ece4') },
        tabby: { shirt: c('#2a6a40'), shirtAlt: c('#14361e'), coat: true, neck: 'tee', pants: c('#22222a'), hat: 'beanie', hatC: c('#3a5ab0'), hatC2: c('#ece4d4'), pom: c('#ffffff'), scarf: 'L', scarfC: c('#ece4d4'), scarfC2: c('#3a5ab0') },
      }),
      big: (t, s) => inWin(s, 160, 166),
      act(c, t, s, big, sm) {
        if (c.who === 'partner') give(c, 1, 'out', 'pole');
        else give(c, c.face, 'chest', 'book', { c: c.who === 'cream' ? sm.IC.bookG : sm.IC.book });
        const beat = Math.floor(T.step(t, 2) * 2);
        const sing = beat % 16 < 11 && (beat + (c.i & 1)) % 4 !== 3;
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
      row: ROW_MID,
      cast: ['ginger', 'partner', 'cream', 'tabby'],
      wear: (c, V) => ({
        partner: { shirt: V('#e8c050'), pants: V('#e8c050'), dress: true, neck: 'vneck', sequins: true, hat: 'party', hatC: V('#f04a9a'), hatC2: V('#f4c440'), pom: V('#ffffff') },
        ginger: { shirt: c('#7a3ab0'), neck: 'tee', pants: c('#22222a'), hat: 'party', hatC: c('#2ab0b0'), hatC2: c('#e8e8f0'), pom: c('#f4c440') },
        cream: { shirt: c('#1f8a6a'), pants: c('#1f8a6a'), dress: true, neck: 'vneck', sequins: true, hat: 'party', hatC: c('#f4c440'), hatC2: c('#c81a6a'), pom: c('#ffffff') },
        tabby: { shirt: c('#2a3a8a'), collar: c('#f2ece4'), neck: 'shirt', shirtAlt: c('#f2ece4'), pants: c('#1e1e28'), hat: 'party', hatC: c('#d82a30'), hatC2: c('#f2ece4'), pom: c('#f4c440') },
      }),
      // a cheer at the fire module's salvos (the first one is midnight)
      big: (t, s) => {
        for (const a of salvoTimes()) {
          const u = inWinWrap(s, a + 0.6, a + 6);
          if (u >= 0) return u;
        }
        return -1;
      },
      act(c, t, s, big) {
        // everyone looks up, glasses half raised, while the logo firework climbs and blooms
        const lw = HD.brand && HD.brand.logoWindow;
        const look = lw ? inWinWrap(s, lw[0] + 0.5, lw[1]) >= 0 : inWin(s, HD.LOOP * 0.25 + 1.2, HD.LOOP * 0.25 + 5) >= 0;
        const item = c.who === 'partner' ? 'sparkler' : 'flute';
        const side = c.who === 'partner' ? -1 : c.face;
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
    // Lunar New Year: red tops with gold trim, small red lanterns and sparklers
    lunar: {
      row: ROW_MID,
      cast: ['partner', 'ginger', 'cream', 'tabby'],
      wear: (c, V) => ({
        partner: { shirt: V('#d41e2a'), collar: V('#f4c440'), neck: 'mandarin', sleeveTip: true, pants: V('#24182a') },
        ginger: { shirt: c('#c8202c'), shirtAlt: c('#f0b830'), pattern: 'floral', neck: 'tee', pants: c('#2a2228') },
        cream: { shirt: c('#b0162c'), collar: c('#f4c440'), neck: 'mandarin', sleeveTip: true, pants: c('#1e1a22') },
        tabby: { shirt: c('#e23428'), shirtAlt: c('#f4c440'), pattern: 'hem', neck: 'tee', pants: c('#2a2a34') },
      }),
      big: (t, s) => inWin(s, 118, 124),
      act(c, t, s, big) {
        const up = big >= 0;
        if (c.who === 'partner') give(c, -1, up ? 'up' : 'out', 'redLantern');
        else if (c.who === 'tabby') give(c, 1, up ? 'up' : 'out', 'redLantern');
        else if (c.who === 'ginger') give(c, -1, up ? 'up' : 'toast', 'sparkler', { big: up });
        else give(c, 1, up ? 'up' : 'out', 'sparkler', { big: up });
        if (up) cheerUp(c, t, c.i);
      },
    },
    // Easter morning: pastel tops, an egg basket, a found egg held up
    easter: {
      row: ROW_MID.map((r) => [r[0] - 4, r[1], r[2], r[3]]),
      cast: ['cream', 'partner', 'ginger', 'tabby'],
      wear: (c, V) => ({
        partner: { shirt: V('#c4a0ea'), neck: 'tee', pants: V('#efe6d2') },
        ginger: { shirt: c('#9cdcb8'), neck: 'tee', pants: c('#f2ecdc'), hat: 'bunny', hatC: c('#f6f2ee'), hatC2: c('#f4a8c0'), hatBand: c('#f4a8c0') },
        cream: { shirt: c('#f6b49c'), neck: 'tee', pants: c('#f4f0e6') },
        tabby: { shirt: c('#9cc4f0'), neck: 'tee', pants: c('#ece6d6') },
      }),
      big: (t, s) => inWin(s, 96, 102),
      act(c, t, s, big) {
        if (c.who === 'cream') give(c, 1, 'down', 'basket');
        if (c.who === 'partner') give(c, -1, 'out', 'egg', { c: 1 });
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
    // Midsummer: flower crowns, light summer clothes, a toast by the fire pit
    midsummer: {
      row: ROW_PIT,
      cast: ['ginger', 'partner', 'cream', 'tabby'],
      wear: (c, V) => ({
        partner: { shirt: V('#f6f2ea'), shirtAlt: V('#e86a8a'), pattern: 'hem', pants: V('#f6f2ea'), dress: true, neck: 'tee', hat: 'crown', pom: V('#f4a0c0'), flower2: V('#f8e070'), leaf: V('#5aa84a') },
        ginger: { shirt: c('#f2d24a'), neck: 'tee', pants: c('#9ab4d8'), hat: 'crown', pom: c('#f8f4f0'), flower2: c('#c8a0f0'), leaf: c('#5aa84a') },
        cream: { shirt: c('#8ec0f0'), pants: c('#8ec0f0'), dress: true, neck: 'tee', hat: 'crown', pom: c('#f8e070'), flower2: c('#f48aa8'), leaf: c('#5aa84a') },
        tabby: { shirt: c('#f08a70'), neck: 'tee', pants: c('#f2ecdc'), hat: 'crown', pom: c('#ffffff'), flower2: c('#f8e070'), leaf: c('#5aa84a') },
      }),
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
    // Match Night: football scarves in plain stripes, the match followed on a
    // phone (its screen lights their faces), a cheer at the goal
    match: {
      // a huddle round the phone; at the goal everyone jumps
      row: [[361, 221, -1, 1], [372, 224, -1, 1], [383, 221, 1, -1], [394, 224, 1, -1]],
      cast: ['tabby', 'partner', 'ginger', 'cream'],
      wear: (c, V) => ({
        partner: { shirt: V('#f2eee6'), neck: 'tee', pants: V('#2a2a34'), scarf: 'R', scarfC: V('#d0202a'), scarfC2: V('#f4c440') },
        ginger: { shirt: c('#2a5a3a'), neck: 'tee', pants: c('#2c3448'), scarf: 'L', scarfC: c('#8cc8f0'), scarfC2: c('#f4f4f4') },
        cream: { shirt: c('#2a3460'), neck: 'tee', pants: c('#2a2a34'), scarf: 'R', scarfC: c('#2a8a4a'), scarfC2: c('#f4f4f4') },
        tabby: { shirt: c('#7a2a3a'), neck: 'tee', pants: c('#22222a'), scarf: 'L', scarfC: c('#26346a'), scarfC2: c('#f08a2a') },
      }),
      big: (t) => {
        const gl = SU.goal(t);
        return gl >= 0 && gl < 0.6 ? gl / 0.6 : -1;
      },
      act(c, t, s, big) {
        if (big < 0) {
          // everyone leans in on the phone in the ginger's paws
          if (c.who === 'ginger') {
            give(c, -1, 'chest', 'phone');
            c.o.look = -1;
          } else {
            c.o.look = c.x < 383 ? 1 : -1;
            // heads lean in toward the screen now and then
            if (T.noise(T.step(t, 8), 5.3, 70 + c.i) > 0.45) c.o.hx = c.x < 383 ? 1 : -1;
          }
          const tense = inWin(s, 144, 150) >= 0;
          if (tense) {
            c.o.mouth = 'o';
            c.o.eyes = undefined;
          }
          return;
        }
        c.al = 'up';
        c.ar = 'up';
        c.items.push({ k: 'scarfUp', side: 0, arm: '' });
        cheerUp(c, t, c.i);
      },
    },
  };

  function salvoTimes() {
    try {
      const sv = HD._fireworks && HD._fireworks.salvos();
      if (sv && sv.length) return sv;
    } catch (e) {
      // the fire module is optional
    }
    return [HD.LOOP * 0.25, HD.LOOP * 0.75];
  }
  /** the group's specs (per edition, outfit painted for the light mode) */
  const GROUP_SPEC = HD.perEdition((ed) => {
    const cfg = GROUP[ed.id];
    if (!cfg) return null;
    const C = CAST();
    const wear = cfg.wear(C.c, C.V);
    const out = {};
    cfg.cast.forEach((who, i) => {
      const tail = cfg.row[i][2];
      out[who] = Object.assign({ key: ed.id + ':g-' + who }, C.friend[who], wear[who], { tailSide: tail });
    });
    return out;
  });

  let GS_T = NaN;
  let GS_ED = null;
  let GS = null;
  /** the whole group at time t (pure; memoised for the lights + draw of one frame) */
  function groupScene(t) {
    const ed = HD.edition;
    if (ed.cast.out !== 'friends') return null;
    const cfg = GROUP[ed.id];
    if (!cfg) return null;
    if (t === GS_T && GS_ED === ed) return GS;
    const s = sec(t);
    const big = cfg.big ? cfg.big(t, s) : -1;
    const specs = GROUP_SPEC();
    const sm = smallMap(ed);
    const cats = cfg.cast.map((who, i) => {
      const [x, base, tl, face] = cfg.row[i];
      const seed = 41 + i * 7;
      const seat = !!cfg.row[i][4];
      const c = { who, i, x, base, tail: tl, face, seed, seat, sit: false, sp: specs[who], al: '', ar: '', items: [], hop: 0, o: social(t, seed, face) };
      cfg.act(c, t, s, big, sm);
      // seated on the plaza bench: the lap sits on the seat
      if (c.sit) c.base = (HD.place().plaza && HD.place().plaza.seat) || 214;
      c.b = c.base - c.hop;
      return c;
    });
    cats.sort((a, b) => a.base - b.base || a.x - b.x);
    GS_T = t;
    GS_ED = ed;
    GS = { cfg, cats, s, big };
    return GS;
  }

  // ---- held items (albedo relights warm; glows are emissive) ----
  const SPARK = ['#fffbe8', '#ffe8a0', '#ffc860', '#ff9a40'];
  function pawOf(c, side, arm) {
    const x = c.x;
    const b = c.sit ? c.b + (AH - 1 - (BY + 3)) : c.b;
    if (arm === 'out') return [x + side * 5, b - 4];
    if (arm === 'toast') return [x + side * 6, b - 9];
    if (arm === 'up') return [x + side * 7, b - 14];
    if (arm === 'up2') return [x + side * 8, b - 14];
    if (arm === 'chest') return [x + side, b - 5];
    if (arm === 'wide') return [x + side * 7, b - 6];
    return [x + side * 3, b - 3];
  }
  function itemHead(c, it) {
    const [px, py] = pawOf(c, it.side, it.arm);
    const s = it.side;
    if (it.k === 'sparkler') return it.arm === 'out' ? [px + 2 * s, py - 4] : [px + s, py - 3];
    if (it.k === 'redLantern') return it.arm === 'out' ? [px + s, py - 5] : [px + 2 * s, py - 3];
    if (it.k === 'pole') return [px + 2 * s, py - 17];
    return [px, py];
  }
  function drawSparkler(g, t, x0, y0, hx, hy, seed, big, IC) {
    g.line(x0, y0, hx, hy + 1, IC.stick);
    const e = g.em;
    const fr = Math.floor(T.step(t, 12) * 12) % (12 * HD.LOOP);
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
  function drawCandleLantern(g, t, x, y, seed, IC) {
    const [bx, by] = HD.festive.lanternPos(x, y, t, seed, { len: 2, amp: 0.14 });
    g.line(R(x), R(y), bx, by, IC.frame);
    const f = T.flicker(T.step(t, 10), seed, 1.2);
    const e = g.em;
    g.px(bx, by + 1, IC.frame);
    g.hline(bx - 1, bx + 1, by + 2, IC.frame);
    g.hline(bx - 2, bx + 2, by + 3, IC.frame);
    for (let y2 = by + 4; y2 <= by + 6; y2++) {
      g.px(bx - 2, y2, IC.frame);
      g.px(bx + 2, y2, IC.frame);
      e.px(bx - 1, y2, P.amber[y2 === by + 6 ? 5 : 6]);
      e.px(bx + 1, y2, P.amber[y2 === by + 6 ? 5 : 6]);
      g.px(bx, y2, IC.frame);
    }
    e.px(bx, by + 4, P.amber[f > 0.5 ? 8 : 7]);
    e.px(bx, by + 5, P.amber[f > 0.25 ? 8 : 7]);
    g.hline(bx - 2, bx + 2, by + 7, IC.frame);
  }
  function drawItem(g, t, c, it, sm) {
    const IC = sm.IC;
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
      const fr = Math.floor(T.step(t, 3) * 3) + c.seed;
      for (let w = 0; w < 2; w++) {
        const u = (fr + w * 2) % 4;
        const sx = px + (w ? s : 0) + (u >= 2 ? s : 0);
        const sy = py - 4 - u;
        if (HD.bayer(sx, sy) < 0.75 - u * 0.15) g.px(sx, sy, IC.steam);
      }
    } else if (k === 'sparkler') {
      const [hx, hy] = itemHead(c, it);
      drawSparkler(g, t, px, py - 1, hx, hy, seed, it.big, IC);
    } else if (k === 'redLantern') {
      const [hx, hy] = itemHead(c, it);
      g.line(px, py - 1, hx, hy, IC.stick);
      HD.festive.lantern(g, hx, hy, t, seed, 'red', { size: 'small', len: 1, amp: 0.3 });
    } else if (k === 'pole') {
      const [hx, hy] = itemHead(c, it);
      g.vline(px, hy, py - 1, IC.stick);
      g.px(px + s, hy, IC.stick);
      g.px(hx, hy + 1, IC.stick);
      drawCandleLantern(g, t, hx, hy + 1, seed, IC);
    } else if (k === 'basket') {
      const bx = px + 2 * s;
      const by = c.base;
      for (let y = by - 2; y <= by; y++) for (let x = bx - 2; x <= bx + 2; x++) g.px(x, y, (x + y) & 1 ? IC.wicker : IC.wickerD);
      g.px(bx - 1, by - 3, sm.egg[0]);
      g.px(bx, by - 3, sm.egg[2]);
      g.px(bx + 1, by - 3, sm.egg[1]);
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
    } else if (k === 'egg') {
      const ec = sm.egg[it.c === undefined ? 4 : it.c];
      g.px(px, py - 1, ec);
      g.px(px + s, py - 1, ec);
      g.px(px, py - 2, sm.egg[2]);
      g.px(px + s, py - 2, sm.egg[2]);
      g.px(px, py - 3, ec);
    } else if (k === 'phone') {
      // a phone held up to the group: the lit screen and a sliver of pitch
      const e = g.em;
      g.px(px - 1, py - 3, IC.frame);
      e.px(px, py - 3, '#c8f0ff');
      e.px(px, py - 2, '#8ad8a0');
      e.px(px - 1, py - 2, '#5ab878');
      g.px(px - 1, py - 1, IC.frame);
      g.px(px, py - 1, IC.frame);
    } else if (k === 'scarfUp') {
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
    }
  }
  function sequins(g, t, c) {
    const fr = Math.floor(T.step(t, 4) * 4) % (4 * HD.LOOP);
    for (let k = 0; k < 2; k++) {
      const dx = Math.floor(HD.hash(c.seed, fr, k, 3) * 7) - 3;
      const dy = Math.floor(HD.hash(c.seed, fr, k, 4) * 5);
      g.em.px(c.x + dx, c.b - 6 + dy, k ? '#fff4c8' : '#ffffff');
    }
  }
  function drawGroup(g, t) {
    const S = groupScene(t);
    if (!S) return;
    const w = hairWind(t);
    const sm = smallMap(HD.edition);
    for (const c of S.cats) {
      const o = Object.assign({}, c.o);
      if (c.al) o.al = c.al;
      if (c.ar) o.ar = c.ar;
      if (c.who === 'partner') {
        o.br = w.br;
        o.gust = w.gust;
      }
      if (c.sit) o.sit = true;
      drawAdult(g, t, c.sp, c.x, c.b, c.seed, o);
      if (c.sp.sequins) sequins(g, t, c);
      for (const it of c.items) drawItem(g, t, c, it, sm);
    }
  }
  const SPK_L = [1, 0.82, 0.5];
  function lightsGroup(t, L) {
    const S = groupScene(t);
    if (!S) return;
    for (const c of S.cats)
      for (const it of c.items) {
        const seed = c.seed * 5 + (it.side > 0 ? 1 : 0);
        const [hx, hy] = itemHead(c, it);
        if (it.k === 'sparkler') {
          const f = T.flicker(T.step(t, 12), seed, 2);
          L.add({ x: hx, y: hy, r: it.big ? 28 : 24, color: SPK_L, i: (it.big ? 0.5 : 0.4) * (0.8 + 0.35 * f) });
        } else if (it.k === 'redLantern') {
          HD.festive.lanternLight(L, hx, hy, t, seed, 'red', { size: 'small', len: 1, amp: 0.3, r: 28, i: 0.42, halo: false });
        } else if (it.k === 'phone') {
          const [px, py] = pawOf(c, it.side, it.arm);
          L.add({ x: px, y: py - 4, r: 18, color: [0.55, 0.85, 1.0], i: 0.32 });
        } else if (it.k === 'pole') {
          const [bx, by] = HD.festive.lanternPos(hx, hy + 1, t, seed, { len: 2, amp: 0.14 });
          const f = T.flicker(T.step(t, 10), seed, 1.2);
          L.add({ x: bx, y: by + 5, r: 38, color: HD.LIGHT.candle, i: 0.6 * (0.85 + 0.25 * f), halo: { r: 8, a: 0.14 } });
        }
      }
  }

  // =====================================================================
  // THE PASS-BY: she and her friends walk past (cast.out 'passby')
  // =====================================================================
  const PASS = {
    harvest: {
      cast: ['ginger', 'partner', 'cream', 'tabby'],
      wear: (c, V) => ({
        partner: { shirt: V('#c8925a'), shirtAlt: V('#8a5a32'), coat: true, neck: 'tee', pants: V('#2a2430'), scarf: 'R', scarfC: V('#b8402a'), scarfC2: V('#e88a3a'), shoes: c('#3a2420') },
        ginger: { shirt: c('#2c3a5c'), shirtAlt: c('#1c2640'), coat: true, neck: 'tee', pants: c('#24242c'), scarf: 'L', scarfC: c('#e0b040'), scarfC2: c('#b88a28'), hat: 'beret', hatC: c('#7a2a2a'), pom: c('#5a1a1a') },
        cream: { shirt: c('#8a2a34'), shirtAlt: c('#5a1820'), coat: true, neck: 'tee', pants: c('#2a2a34'), scarf: 'R', scarfC: c('#efe6d2'), scarfC2: c('#cfc4ac') },
        tabby: { shirt: c('#5a6a3a'), shirtAlt: c('#3a4626'), coat: true, neck: 'tee', pants: c('#2a2a30'), scarf: 'L', scarfC: c('#d86a2a'), scarfC2: c('#8a3a1a') },
      }),
    },
    halloween: {
      cast: ['tabby', 'ginger', 'partner', 'cream'],
      wear: (c, V) => ({
        partner: { shirt: V('#6a3a9a'), neck: 'vneck', pants: V('#1c1622'), dress: true, hat: 'witch', hatC: V('#3a2a58'), hatBand: V('#e88a24') },
        ginger: { shirt: c('#e8e6f0'), collar: c('#b01828'), neck: 'polo', pants: c('#1a1820'), cape: true, capeC: '#15111c', hatC2: c('#b01828') },
        cream: { round: true, shirt: c('#ec781c'), shirtAlt: '#2a1406', pattern: 'jack', neck: 'none', pants: c('#ec781c'), hat: 'stem', leaf: c('#4a8a3a') },
        tabby: { shirt: '#1e1c24', shirtAlt: c('#ece8de'), pattern: 'bones', neck: 'none', pants: '#1e1c24' },
      }),
      umbrella: true,
    },
  };
  // [start s, dir]: a stroll across the whole sidewalk at ~11 px/s
  const PASSES = [[18, 1], [138, -1]];
  const PASS_SPEED = 11;
  const PASS_SPAN = [-24, 504];
  const PASS_SPEC = HD.perEdition((ed) => {
    const cfg = PASS[ed.id];
    if (!cfg) return null;
    const C = CAST();
    const wear = cfg.wear(C.c, C.V);
    const out = {};
    for (const who of cfg.cast) out[who] = Object.assign({ key: ed.id + ':p-' + who }, C.friend[who], wear[who]);
    return out;
  });
  /** where each walker is at t (or null when they are not on screen) */
  function passScene(t) {
    const ed = HD.edition;
    if (ed.cast.out !== 'passby') return null;
    const cfg = PASS[ed.id];
    if (!cfg) return null;
    const pl = HD.place();
    const st = (pl.stages && pl.stages.passby) || { base: 223 };
    const ts = T.step(t, 8);
    const s = sec(ts);
    const len = (PASS_SPAN[1] - PASS_SPAN[0] + 60) / PASS_SPEED;
    for (const [a, dir] of PASSES) {
      if (s < a || s >= a + len) continue;
      const d = (s - a) * PASS_SPEED;
      const lead = dir > 0 ? PASS_SPAN[0] + d : PASS_SPAN[1] - d;
      const cats = cfg.cast.map((who, i) => {
        // a loose cluster: pairs side by side, spacing breathing a little
        const gap = 11 + T.wave(ts, 7.1, i * 0.23) * 1.2;
        const x = R(lead - dir * i * gap);
        const base = st.base + (i % 2 ? 1 : -1);
        return { who, i, x, base, dir };
      });
      return { cfg, cats, dir, s, a };
    }
    return null;
  }
  function drawPass(g, t) {
    const S = passScene(t);
    if (!S) return;
    const specs = PASS_SPEC();
    const w = hairWind(t);
    const pl = HD.place();
    const win = pl.catWindow;
    const order = S.cats.slice().sort((a, b) => a.base - b.base || a.i - b.i);
    for (const c of order) {
      if (c.x < -20 || c.x > 500) continue;
      const sp = Object.assign(specs[c.who], { tailSide: -c.dir });
      const so = social(t, 41 + c.i * 7, c.dir);
      const o = { walk: walkFrame(t, c.i), look: so.look === -c.dir ? 0 : so.look, mouth: so.mouth, eyes: so.eyes };
      if (c.who === 'partner') {
        o.br = R(w.br - c.dir);
        o.gust = w.gust;
        // passing under his window, she looks up at it for a moment
        if (win && S.dir > 0 && Math.abs(c.x - (win.x + win.w / 2)) < 9) {
          o.look = 0;
          o.hy = -1;
          o.mouth = 'smile';
          o.eyes = undefined;
        }
      }
      if (S.cfg.umbrella && c.who === 'ginger') o.ar = 'toast';
      drawAdult(g, t, sp, c.x, c.base, 41 + c.i * 7, o);
    }
    if (S.cfg.umbrella) drawUmbrella(g, t, S);
  }
  /** a big dark umbrella the vampire holds over himself and the witch */
  function drawUmbrella(g, t, S) {
    const h = S.cats.find((c) => c.who === 'ginger');
    const w = S.cats.find((c) => c.who === 'partner');
    if (!h || !w) return;
    const IC = smallMap(HD.edition).IC;
    const hx = h.x + 6;
    const cx = R((h.x + w.x) / 2 + S.dir);
    const top = Math.min(h.base, w.base) - 25;
    const sw = T.wave(T.step(t, 8), 3.1, 0.2) > 0.6 ? 1 : 0;
    // shaft from his raised paw up to the crown
    g.line(hx, h.base - 9, cx + sw, top + 1, IC.frame);
    // a dome on five ribs: a lit crown, the rim dipping between rib tips
    const half = 10;
    const cxs = cx + sw;
    const HW = [3, 6, 8, 10];
    for (let r = 0; r < 4; r++)
      for (let x = -HW[r]; x <= HW[r]; x++) {
        const rib = r >= 2 && x % 5 === 0;
        g.px(cxs + x, top + r, rib ? IC.canopyD : r < 2 && x < 2 ? IC.canopyH : IC.canopy);
      }
    for (const x of [-10, -5, 0, 5, 10]) g.px(cxs + x, top + 4, IC.canopyD);
    for (const x of [-9, -6, -4, -1, 1, 4, 6, 9]) g.px(cxs + x, top + 3, IC.canopyD);
    g.px(cxs, top - 1, IC.frame);
    // rain runs off the rim in fat drops
    if (HD.edition.weather.rain > 0)
      for (let k = 0; k < 3; k++) {
        const cy = T.cycle(t, k, 0.9, 777);
        const ex = cxs + (k === 0 ? -half : k === 1 ? half : 5);
        const y = top + 5 + R(cy.age * cy.age * 14);
        g.px(ex, y, '#8aa2c8');
        if (cy.age < 0.5) g.px(ex, y - 1, '#5a6e94');
      }
  }

  // =====================================================================
  // TRICK-OR-TREATERS: tiny costumed kittens call at the lobby
  // =====================================================================
  // 7 wide; E fur, e eyes (emissive), T costume, t costume shade, O dark
  const TOT_ROWS = {
    ghost: [
      ['.T...T.', '.TTTTT.', 'TTTTTTt', 'TOTTOTt', 'TTTTTTt', 'TTTTTtt', 'TTTTTtt', 'TTTTTtt', 'T.TT.Tt', '.k...k.'],
      ['.T...T.', '.TTTTT.', 'TTTTTTt', 'TOTTOTt', 'TTTTTTt', 'TTTTTtt', 'TTTTTtt', 'TTTTTtt', 'TT.TT.t', '..k.k..'],
    ],
    pumpkin: [
      ['.E.v.E.', '.EEEEE.', 'EEEEEEE', 'EeEEEeE', '.EEnEE.', '.TtTtT.', 'TTtTtTT', 'TTtTtTT', '.TtTtT.', '.k...k.'],
      ['.E.v.E.', '.EEEEE.', 'EEEEEEE', 'EeEEEeE', '.EEnEE.', '.TtTtT.', 'TTtTtTT', 'TTtTtTT', '.TtTtT.', '..k.k..'],
    ],
    witch: [
      ['....H..', '...HH..', '..HHH..', 'HHHHHHH', '.EEEEE.', 'EeEEEeE', '.EEnEE.', '.TTTTT.', 'TtTTTtT', '.k...k.'],
      ['....H..', '...HH..', '..HHH..', 'HHHHHHH', '.EEEEE.', 'EeEEEeE', '.EEnEE.', '.TTTTT.', 'TtTTTtT', '..k.k..'],
    ],
  };
  const TOT_KIDS = ['witch', 'ghost', 'pumpkin'];
  function totSprite(kind, f) {
    const ed = HD.edition;
    return memo('tot|' + ed.id + kind + f, () => {
      const c = painter(ed.light || 'night');
      const maps = {
        ghost: { T: c('#f2f0ea', 0.15), t: c('#c8c6d2'), O: '#141018', k: '#1a1418' },
        pumpkin: { E: c('#8a8e98'), e: '#d8e070', n: c('#d88a96'), v: c('#4a8a3a'), T: c('#f08020', 0.15), t: c('#b85412'), k: '#1a1418' },
        witch: { H: '#1c1626', E: c('#e8d8c0'), e: '#78b8f0', n: c('#e88a96'), T: c('#6a3a9a', 0.15), t: c('#4a2470'), k: '#1a1418' },
      };
      const m = maps[kind];
      return bake(TOT_ROWS[kind][f].map((r) => r.split('')), m, { e: m.e });
    });
  }
  /** the kids' route: in from the street end, a stop at the lobby, out the other way */
  function totScene(t) {
    if (!HD.tag('trick-or-treat')) return null;
    const pl = HD.place();
    const door = pl.stages && pl.stages.door;
    if (!door) return null;
    const ts = T.step(t, 8);
    const s = sec(ts);
    const doorX = R((door.x0 + door.x1) / 2);
    const fromLeft = pl.id !== 'apt2';
    const start = pl.id === 'apt2' ? 76 : 92;
    const sp = 9;
    const x0 = fromLeft ? -12 : 492;
    const x2 = fromLeft ? 492 : -12;
    const d1 = Math.abs(doorX - x0) / sp;
    const stop = 6;
    const d2 = Math.abs(x2 - doorX) / sp;
    const u = s - start;
    if (u < 0 || u > d1 + stop + d2 + 3) return null;
    const dir = fromLeft ? 1 : -1;
    let lead;
    let walking = true;
    if (u < d1) lead = x0 + dir * u * sp;
    else if (u < d1 + stop) {
      lead = doorX;
      walking = false;
    } else lead = doorX + dir * (u - d1 - stop) * sp;
    const kids = TOT_KIDS.map((kind, i) => ({
      kind,
      i,
      x: R(lead - dir * i * (walking ? 11 : 10)),
      base: door.base + (i === 1 ? 2 : 0),
      dir,
      walking,
      ask: !walking && u - d1 > 0.6 && u - d1 < stop - 0.8,
    }));
    return { kids, dir };
  }
  function drawTot(g, t) {
    const S = totScene(t);
    if (!S) return;
    const IC = smallMap(HD.edition).IC;
    const f = Math.floor(T.step(t, 6) * 6);
    for (const k of S.kids.slice().sort((a, b) => a.base - b.base)) {
      if (k.x < -10 || k.x > 490) continue;
      const fr = k.walking ? (f + k.i) % 2 : 0;
      const bob = k.ask && (f + k.i) % 4 < 2 ? 1 : 0;
      const spr = totSprite(k.kind, fr);
      const h = TOT_ROWS[k.kind][0].length;
      shadow(g, k.x, k.base, 2);
      blit(g, spr, k.x - 3, k.base - h + 1 - bob);
      // a little jack-o'-lantern pail, held up at the door
      const px = k.x + k.dir * 4;
      const py = k.ask ? k.base - 8 - bob : k.base - 4;
      g.px(px - 1, py - 1, IC.frame);
      g.px(px + 1, py - 1, IC.frame);
      g.hline(px - 1, px + 1, py, IC.pail);
      g.hline(px - 1, px + 1, py + 1, IC.pail);
      g.hline(px - 1, px + 1, py + 2, IC.pailD);
      if (HD.light().day < 0.5) {
        const fl = T.flicker(T.step(t, 10), 300 + k.i, 1.2);
        g.em.px(px - 1, py + 1, P.fire[fl > 0.4 ? 8 : 7]);
        g.em.px(px + 1, py + 1, P.fire[fl > 0.4 ? 8 : 7]);
      }
    }
  }
  function lightsTot(t, L) {
    const S = totScene(t);
    if (!S || HD.light().day >= 0.5) return;
    for (const k of S.kids) {
      const fl = T.flicker(T.step(t, 10), 300 + k.i, 1.2);
      L.add({ x: k.x + k.dir * 4, y: k.ask ? k.base - 7 : k.base - 3, r: 14, color: HD.LIGHT.pumpkin, i: 0.3 * (0.8 + 0.3 * fl) });
    }
  }

  // =====================================================================
  // MATCH NIGHT: him on his balcony in the red jersey, back to us, watching
  // the TV through the open door; he turns and cheers at the goal.
  // =====================================================================
  let BAL_T = NaN;
  function drawFan(g, t) {
    const pl = HD.place();
    const b = pl.balcony;
    if (!b) return null;
    const C = CAST();
    const goal = SU.goal(t);
    const cheering = goal >= 0 && goal < 0.65;
    // he stands on the door's threshold step, so the jersey clears the handrail
    const x = b.x1 - 11;
    const base = b.slab - 5;
    const sp = Object.assign(C.you, { tailSide: -1 });
    // the step he stands on (the rail drawn back over it hides most of it)
    const stp = smallMap(HD.edition).IC;
    g.rect(x - 5, base + 1, 11, b.slab - base - 1, stp.step);
    g.hline(x - 5, x + 5, base + 1, stp.stepHi);
    if (cheering) drawAdult(g, t, sp, x, base - hopAt(t, 0), 3, Object.assign(cheer(), { noShadow: true }));
    else {
      // fidgets now and then: a step to the side, a lean in at the tense moment
      const s = sec(T.step(t, 8));
      const tense = s >= 144 && s < 150;
      const shift = T.noise(T.step(t, 8), 23, 911) > 0.62 ? -1 : 0;
      drawAdult(g, t, sp, x + shift, base, 3, { back: true, hy: tense ? 1 : 0, ear: idle(t, 3).ear, noShadow: true });
    }
    return { x0: x - 9, x1: x + 9, top: base - 20, base };
  }
  /** for building-apt1: draw him on the balcony BEFORE the rail (optional hook) */
  HD.drawBalcony = function (g, t) {
    const ed = HD.edition;
    if (ed.cast.party !== 'match' || !HD.place().balcony) return;
    BAL_T = t;
    drawFan(g, t);
  };
  /**
   * otherwise: draw him after the building, then put the rail back in front
   * of him from a snapshot taken just before (its handrail row and the
   * pickets every 3 px from the balcony's left end, as the anchors describe)
   */
  function drawMatchBalcony(g, t) {
    if (BAL_T === t) return;
    const b = HD.place().balcony;
    if (!b) return;
    const ctx = g.ctx;
    const x0 = b.x1 - 22;
    const w = b.x1 - x0 + 1;
    const y0 = b.rail;
    const h = b.slab - b.rail;
    let snap = null;
    try {
      snap = ctx.getImageData(x0, y0, w, h);
    } catch (e) {
      snap = null;
    }
    drawFan(g, t);
    if (!snap) return;
    const now = ctx.getImageData(x0, y0, w, h);
    const sd = snap.data;
    const nd = now.data;
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const x = x0 + xx;
        if (yy > 0 && (x - b.x0) % 3 !== 0 && x !== b.x1) continue;
        const i = (yy * w + xx) * 4;
        if (sd[i + 3] === 0) continue;
        nd[i] = sd[i];
        nd[i + 1] = sd[i + 1];
        nd[i + 2] = sd[i + 2];
        nd[i + 3] = sd[i + 3];
      }
    ctx.putImageData(now, x0, y0);
  }

  // =====================================================================
  // THE NIECE DROPS BY: out of the entrance and back (cast.niece at home)
  // =====================================================================
  const KIT_SPEED = 8;
  /** her route from the entrance: down to the sidewalk, then along to a spot */
  function nieceRoute(pl, id) {
    const en = pl.entrance;
    const ex = R((en.x0 + en.x1) / 2);
    const door = [ex, en.y1 + 2];
    const st = (pl.stages && pl.stages.door) || { base: 222 };
    const down = [ex + 2, st.base];
    if (id === 'match') {
      // out to the plaza, by the lamp at the corner of her aunt's group
      return [door, down, [pl.stages.group.x0 + 14, st.base + 1]];
    }
    return [door, down, [R(pl.catWindow.x + pl.catWindow.w + 2), st.base + 1]];
  }
  function along(pts, d) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (d <= l || i === pts.length - 2) {
        const k = l > 0 ? Math.min(1, d / l) : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k, Math.sign(pts[i + 1][0] - pts[i][0])];
      }
      d -= l;
    }
    const q = pts[pts.length - 1];
    return [q[0], q[1], 0];
  }
  function pathLen(pts) {
    let s = 0;
    for (let i = 0; i + 1 < pts.length; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    return s;
  }
  /** seconds since she came out and until she goes back in, from HD.summer.niece */
  function visitClock(t) {
    const v = SU.niece(t);
    if (!v.here) return null;
    const rate = (tt) => {
      const a = SU.niece(tt);
      const b2 = SU.niece(tt + 0.05);
      return a.phase === b2.phase && b2.u > a.u ? (b2.u - a.u) / 0.05 : 0;
    };
    let r = rate(t) || rate(t - 0.06);
    const dur = r > 0 ? 1 / r : 4;
    // elapsed / remaining in the whole visit (walk-in and walk-out phases are short)
    let ins = 4;
    let outs = 4;
    let stay = v.phase === 'stay' ? dur : 60;
    if (v.phase === 'in') ins = dur;
    if (v.phase === 'out') outs = dur;
    const el = v.phase === 'in' ? v.u * ins : v.phase === 'stay' ? ins + v.u * stay : ins + stay + v.u * outs;
    const rem = v.phase === 'in' ? (1 - v.u) * ins + stay + outs : v.phase === 'stay' ? (1 - v.u) * stay + outs : (1 - v.u) * outs;
    return { el, rem, v };
  }
  function nieceScene(t) {
    const ed = HD.edition;
    if (!ed.cast.niece || ed.cast.party === 'trip' || ed.cast.party === 'birthday') return null;
    const pl = HD.place();
    if (!pl.entrance || !pl.catWindow) return null;
    const ts = T.step(t, 8);
    const vc = visitClock(ts);
    if (!vc) return null;
    const pts = nieceRoute(pl, ed.id);
    const total = pathLen(pts);
    const walkT = total / KIT_SPEED;
    // she pauses on the doorstep for a beat before setting off, and before going in
    const pause = 0.8;
    let d;
    let walking = false;
    let dir = 0;
    if (vc.el < pause) d = 0;
    else if (vc.el < pause + walkT) {
      d = (vc.el - pause) * KIT_SPEED;
      walking = true;
    } else if (vc.rem < pause) d = 0;
    else if (vc.rem < pause + walkT) {
      d = (vc.rem - pause) * KIT_SPEED;
      walking = true;
    } else d = total;
    const [x, y, sx] = along(pts, d);
    dir = walking ? (vc.rem < pause + walkT ? -sx : sx) : 0;
    return { x: R(x), base: R(y), walking, dir, vc, atDoor: d < 3 };
  }
  /** seconds into the niece's wave cycle at home (she waves for the first 2) */
  function homeWaveAge(t) {
    const pc = T.cycle(T.step(t, 8), 5, 9.5, 63);
    return pc.age * pc.P;
  }
  /** she is out on the sidewalk and waving up at the window right now */
  function nieceWavingHome(t) {
    if (HD.edition.cast.party === 'match') return false;
    const k = nieceScene(t);
    return !!k && !k.walking && !k.atDoor && homeWaveAge(t) < 2;
  }
  function drawNiece(g, t) {
    const k = nieceScene(t);
    if (!k) return;
    const C = CAST();
    const ed = HD.edition;
    const ts = T.step(t, 8);
    const wf = Math.floor(ts * 8) % 4;
    const ki = kitIdle(t, 14);
    let pose = 'stand';
    let arms = 'down';
    let look = ki.look;
    let bob = 0;
    const goal = SU.goal(t);
    if (ed.cast.party === 'match' && goal >= 0 && goal < 0.7) {
      arms = 'up';
      bob = hopAt(t, 3) ? -1 : 0;
      look = 0;
    } else if (k.walking) {
      pose = wf === 1 ? 'walk' : wf === 3 ? 'walk2' : 'stand';
      bob = wf & 1 ? -1 : 0;
      look = k.dir;
    } else if (!k.atDoor) {
      if (ed.cast.party === 'match') {
        // at the edge of the plaza crowd: looking at them, about, now and
        // then a wave and a little hop
        const n = T.noise(ts, 7, 1301);
        look = n < 0.45 ? 1 : n < 0.6 ? 0 : -1;
        const pc = T.cycle(ts, 5, 11, 61);
        const a = pc.age * pc.P;
        if (a < 1.6) {
          arms = waveArm(t);
          look = 1;
        } else if (a > 6 && a < 6.8) bob = Math.floor(ts * 8) % 2 ? -1 : 0;
      } else {
        // home: waving up at the two of them in the window, reaching for fireflies
        const a = homeWaveAge(t);
        if (a < 2) {
          arms = waveArm(t);
          look = -1;
        } else if (a > 5 && a < 6.2) {
          arms = 'up';
          look = 0;
        }
      }
    }
    drawKit(g, t, C.niece, k.x, k.base + bob, { pose, arms, blink: ki.blink, look });
  }

  // =====================================================================
  // THE BENCH: the anniversary (cast.party 'bench')
  // =====================================================================
  const NYC_LEANS = [[57, 70], [177, 190], [118, 126], [222, 228]];
  function benchLean(t) {
    const s = sec(T.step(t, 8));
    for (const [a, b] of NYC_LEANS) {
      if (s < a || s >= b) continue;
      return Math.min(s - a, b - s) < 0.25 ? 1 : 2;
    }
    return 0;
  }
  function benchSpots() {
    const pl = HD.place();
    const st = (pl.stages && pl.stages.bench) || { x0: pl.bench.x0 + 4, x1: pl.bench.x1 - 2, base: pl.bench.seat };
    const mid = (st.x0 + st.x1) / 2;
    return { you: R(mid - 6), her: R(mid + 5), seat: st.base };
  }
  function drawBench(g, t) {
    const pl = HD.place();
    if (!pl.bench && !(pl.stages && pl.stages.bench)) return;
    const C = CAST();
    const B = benchSpots();
    const lean = benchLean(t);
    const w = hairWind(t);
    const yi = idle(t, 3);
    drawAdult(g, t, Object.assign(C.you, { tailSide: -1 }), B.you, B.seat, 3, {
      sit: true,
      hx: lean === 2 ? 1 : 0,
      look: lean ? 1 : yi.look,
      mouth: lean === 2 ? 'laugh' : 'smile',
    });
    const pi = idle(t, 8);
    drawAdult(g, t, Object.assign(C.partner, { tailSide: 1 }), B.her, B.seat, 8, {
      sit: true,
      hx: -lean,
      hy: lean === 2 ? 1 : 0,
      look: lean ? -1 : pi.look,
      eyes: lean === 2 ? 'happy' : undefined,
      br: w.br,
      gust: w.gust,
    });
    drawHeart(g, t, B);
  }
  function drawHeart(g, t, B) {
    const u = SU.heart(t);
    if (u < 0) return;
    const x0 = R((B.you + B.her) / 2);
    const y0 = B.seat - BY - 3 + HY0 + 2;
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

  // =====================================================================
  // TRIPS: him, the niece, his sister and her husband (cast.party 'trip')
  // =====================================================================
  function tripSpots() {
    const pl = HD.place();
    const st = pl.stages.family;
    const w = st.x1 - st.x0;
    if (HD.edition.cast.shoulderRide) return { bil: st.x0 + R(w * 0.2), sister: st.x0 + R(w * 0.38), you: st.x0 + R(w * 0.7), base: st.base };
    return { bil: st.x0 + R(w * 0.12), sister: st.x0 + R(w * 0.33), you: st.x0 + R(w * 0.56), kitHome: st.x0 + R(w * 0.75), kitAway: st.x0 + R(w * 0.45), base: st.base };
  }
  /** the niece trots over to her mum now and then and back to him */
  function tripKit(t, P2) {
    const s = sec(t);
    const trips = [
      [50, 53.5, P2.kitHome, P2.kitAway],
      [72, 75.5, P2.kitAway, P2.kitHome],
      [170, 173.5, P2.kitHome, P2.kitAway],
      [196, 199.5, P2.kitAway, P2.kitHome],
    ];
    let x = P2.kitHome;
    let walking = false;
    let dir = 0;
    for (const [a, b, from, to] of trips) {
      if (s >= b) x = to;
      else if (s >= a) {
        x = from + ((to - from) * (s - a)) / (b - a);
        walking = true;
        dir = Math.sign(to - from);
        break;
      } else break;
    }
    return { x: R(x), walking, dir, nearMum: x < (P2.kitHome + P2.kitAway) / 2 };
  }
  function drawTrip(g, t) {
    const C = CAST();
    const S = tripSpots();
    const ts = T.step(t, 8);
    const br = R(SU.breeze(t));
    if (HD.edition.cast.shoulderRide) return drawShoulderRide(g, t, C, S);
    const k = tripKit(t, S);
    drawAdult(g, t, Object.assign(C.bil, { tailSide: -1 }), S.bil, S.base - 1, 5, { look: k.nearMum ? 1 : undefined });
    drawAdult(g, t, Object.assign(C.sister, { tailSide: -1 }), S.sister, S.base, 6, { br, look: k.nearMum ? 1 : undefined });
    const yi = idle(t, 3);
    const hop = !k.walking && !k.nearMum && T.cycle(ts, 2, 13, 77).age * 13 < 1.5;
    drawAdult(g, t, Object.assign(C.you, { tailSide: -1 }), S.you, S.base, 3, { look: !k.nearMum ? 1 : yi.look, mouth: hop ? 'laugh' : 'smile' });
    const ki = kitIdle(t, 11);
    const wf = Math.floor(ts * 8) % 4;
    const kp = k.walking ? (wf === 1 ? 'walk' : wf === 3 ? 'walk2' : 'stand') : 'stand';
    const bob = (k.walking && wf & 1) || (hop && wf & 1) ? -1 : 0;
    drawKit(g, t, C.niece, k.x, S.base + 1 + bob, { pose: kp, arms: hop ? 'up' : 'down', blink: ki.blink, look: k.walking ? k.dir : k.nearMum ? 1 : -1 });
  }
  function drawShoulderRide(g, t, C, S) {
    const br = R(SU.breeze(t));
    drawAdult(g, t, Object.assign(C.sister, { tailSide: -1 }), S.sister, S.base, 6, { br, look: 1 });
    drawAdult(g, t, Object.assign(C.bil, { tailSide: -1 }), S.bil, S.base - 1, 5, { look: 1 });
    const x = S.you;
    const base = S.base;
    const yi = idle(t, 3);
    const me = drawAdult(g, t, Object.assign(C.you, { tailSide: 1 }), x, base, 3, { arms: 'shoulder', wide: true, look: yi.look > 0 ? 1 : 0, mouth: 'smile' });
    // she waves now and then, and every so often holds her giraffe up high
    const ts = T.step(t, 6);
    const wc = T.cycle(ts, 3, 9.2, 515);
    const wa = wc.age * wc.P;
    const lift = wc.rnd(1) < 0.3;
    const waving = wa < 2.5;
    const ki = kitIdle(t, 12);
    const hy = me.top + HY0;
    const kb = hy + 2;
    const leg = C.niece.map.F;
    for (const side of [-1, 1]) {
      g.px(x + side * 3, hy + 2, leg);
      g.px(x + side * 4, hy + 3, leg);
      g.px(x + side * 5, hy + 4, C.niece.map.z);
    }
    const arms = waving ? (lift ? 'up' : waveArm(t)) : 'down';
    blitKit(g, C.niece, { pose: 'ride', arms, blink: ki.blink, look: waving ? 1 : ki.look }, x, kb);
    // the giraffe plush: tucked under her arm, or held up high
    if (waving && lift) drawGiraffe(g, x - 3, kb - 21);
    else drawGiraffe(g, x - 8, kb - 8, true);
  }

  // =====================================================================
  // THE BIRTHDAY: the party round the table (cast.party 'birthday')
  // =====================================================================
  function dcSpots() {
    const pl = HD.place();
    const tb = pl.table;
    const back = (pl.stages && pl.stages.back) || { x0: tb.x - 28, x1: tb.x + 24, base: tb.base - 9 };
    const front = (pl.stages && pl.stages.party) || { x0: tb.x - 32, x1: tb.x + 38, base: tb.base };
    // back row: his sister clear of the balloon strings at the table's left
    // corner, dad at the right end by the cake, her husband beside dad;
    // front row: the niece in front of the table, him at the right
    return {
      sister: back.x0 + 2,
      bil: tb.x + 29,
      dad: tb.x + 17,
      back: back.base,
      you: tb.x + 41,
      youBase: front.base + 2,
      kit: tb.x - 2,
      kitBase: front.base + 4,
      crane: tb.x + 7,
      held: tb.x + 9,
      tx: tb.x,
      tbase: tb.base,
      gift: giftSpot(tb),
    };
  }
  /** where the wrapped present waits on the table (decor-trips keeps a spot clear) */
  function giftSpot(tb) {
    const G = HD.decorTrips && HD.decorTrips.table ? HD.decorTrips.table() : null;
    if (G && G.gift) return [G.gift.x1, G.gift.y];
    return [tb.x + 11, tb.base - 10];
  }
  function dcState(t) {
    const s = sec(t);
    const gift = SU.gift(t);
    const out = SU.candlesOut(t);
    const blow = SU.blowing(t);
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
    const C = CAST();
    const D = dcSpots();
    const st = dcState(t);
    const hb = (k) => (st.cheer ? hopAt(t, k) : 0);
    const br = R(SU.breeze(t));
    drawAdult(g, t, Object.assign(C.sister, { tailSide: -1 }), D.sister, D.back - hb(1), 6, st.cheer ? cheer() : { br, look: 1 });
    drawAdult(g, t, Object.assign(C.bil, { tailSide: -1 }), D.bil, D.back - hb(3), 5, st.cheer ? cheer() : { look: st.out >= 0 ? 1 : undefined, mouth: st.out >= 0 ? 'laugh' : 'smile' });
    drawAdult(g, t, Object.assign(C.dad, { tailSide: 1 }), D.dad, D.back - hb(2), 9, dadPose(t, st));
    if (st.kit === 'held') {
      const ki = kitIdle(t, 12);
      const bob = st.play && Math.floor(T.step(t, 4) * 4) % 2 ? -1 : 0;
      const hx = D.held;
      const hb0 = D.back - 3;
      blitKit(g, C.niece, { pose: 'held', arms: st.play ? 'up' : 'down', blink: !st.play && ki.blink, look: -1 }, hx, hb0 + bob);
      // dad's paw under her, from his side
      g.px(hx + 3, hb0 - 1 + bob, C.dad.fur);
      g.px(hx + 4, hb0 - 1 + bob, C.dad.fur);
    }
  }
  function drawDC(g, t) {
    const C = CAST();
    const D = dcSpots();
    const st = dcState(t);
    const g0 = st.gift;
    const dadTop = D.back - (AH - 1);
    if (st.blow >= 0) {
      // his breath: pale dithered puffs from his mouth toward the candles
      const mx = D.dad - CX + HX0 - 2 + 3;
      const my = dadTop + HY0 - 2 + 6;
      for (let i = 0; i < 3; i++) {
        const u = (st.blow * 2.4 + i * 0.34) % 1;
        const px = R(mx - 2 - 11 * u);
        const py = R(my - 1 - 5 * u + Math.sin(u * 6 + i) * 0.6);
        const a = 1 - u * 0.85;
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]])
          if (HD.bayer(px + ox, py + oy) < a * (ox || oy ? 0.6 : 1)) g.px(px + ox, py + oy, i === 1 ? '#d8ecff' : '#9cc0e4');
      }
    }
    const yhop = st.cheer ? hopAt(t, 0) : 0;
    drawAdult(g, t, Object.assign(C.you, { tailSide: 1 }), D.you, D.youBase - yhop, 3, st.cheer ? cheer() : { look: -1, mouth: st.out >= 0 || st.play ? 'laugh' : 'smile' });
    // the present waits on the table until dad picks it up (and is back, wrapped, at the end)
    if (st.s < 40.6 || st.s >= 228.4) drawBox(g, D.gift[0], D.gift[1]);
    const ki = kitIdle(t, 12);
    const o = C.niece;
    const kx = D.kit;
    const kb = D.kitBase;
    const cup = () => {
      g.px(kx - 5, kb - 1, o.map.Y);
      g.px(kx - 5, kb, o.map.y);
    };
    if (st.kit === 'held') return;
    if (st.kit === 'lower' || st.kit === 'raise') {
      const u = st.kit === 'lower' ? (st.s - 34) / 2 : 1 - (st.s - 231) / 3;
      const q = Math.min(1, Math.max(0, u));
      const hx = D.held;
      const hb0 = D.back - 3;
      const x = R(hx + (kx - hx) * q);
      const b = R(hb0 + (kb - hb0) * q - Math.sin(q * Math.PI) * 3);
      blitKit(g, o, { pose: 'held', arms: 'up', look: -1 }, x, b);
      if (q < 0.6) g.px(x + 4, b - 3, C.dad.fur);
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
        // dad lifts the box off the table and holds it out to her
        const q = Math.min(1, (g0 - 0.1) / 0.24);
        const [px, py] = D.gift;
        drawBox(g, R(px + (kx + 4 - px) * q), R(py + (kb - 1 - py) * q - Math.sin(q * Math.PI) * 6));
      } else if (pose === 'carry') drawBox(g, kx, kb + 1);
      else if (pose === 'lift') {
        const top = kb - 9 - 4;
        if (g0 < 0.75) drawBox(g, kx, top - 1);
        else {
          drawBox(g, kx, top - 1, 'body');
          const up = 2 + Math.min(2, Math.floor((g0 - 0.75) / 0.03));
          drawBox(g, kx, top - 3 - up, 'lid');
          sparkle(g, t, kx, top - 8);
        }
      } else if (g0 >= 0.85) {
        drawCrane(g, D.crane, kb, 2, 2);
        if (g0 < 0.97) sparkle(g, t, D.crane + 1, kb - 9);
      }
      cup();
      return;
    }
    let pose = 'sit';
    let arms = 'down';
    let look = 1;
    if (st.kit === 'stand') pose = 'stand';
    if (st.kit === 'wantup') {
      pose = 'stand';
      arms = 'up';
    }
    if (st.cheer) {
      pose = 'stand';
      arms = 'up';
      look = 0;
    }
    if (st.kit === 'play' && !st.cheer) {
      const n = T.noise(T.step(t, 8), 11, 1201);
      look = n < 0.25 ? -1 : n < 0.4 ? 0 : 1;
    }
    const hop = st.cheer ? hopAt(t, 1) : 0;
    drawKit(g, t, o, kx, kb - hop, { pose, arms, blink: ki.blink, look });
    cup();
    if (st.kit === 'play' || st.kit === 'tuck') {
      const tc = T.step(t, 6);
      const boom = st.cheer ? 2 : [0, 1, 2, 2, 1, 0][Math.floor(tc / 0.8) % 6];
      const drop = 2.5 + T.wave(tc, 2.4, 0.2) * 1.5;
      let cx = D.crane;
      let cb = kb;
      if (st.kit === 'tuck') {
        const q = Math.min(1, (st.s - 226) / 2.4);
        const [px, py] = D.gift;
        cx = R(D.crane + (px - D.crane) * q);
        cb = R(kb + (py - kb) * q - Math.sin(q * Math.PI) * 5);
      }
      if (!(st.kit === 'tuck' && st.s >= 228.4)) drawCrane(g, cx, cb, boom, drop);
    }
  }

  // =====================================================================
  // daylight: everyone casts a short shadow away from the sun
  // =====================================================================
  function feet(t) {
    const ed = HD.edition;
    const out = [];
    const S = groupScene(t);
    if (S) for (const c of S.cats) out.push([c.x, c.base, 4]);
    const Q = passScene(t);
    if (Q) for (const c of Q.cats) out.push([c.x, c.base, 4]);
    const K = nieceScene(t);
    if (K) out.push([K.x, K.base, 3]);
    if (ed.cast.party === 'trip') {
      const Sp = tripSpots();
      out.push([Sp.bil, Sp.base - 1, 4], [Sp.sister, Sp.base, 4], [Sp.you, Sp.base, 4]);
      if (!ed.cast.shoulderRide) out.push([tripKit(t, Sp).x, Sp.base + 1, 3]);
    }
    const O = totScene(t);
    if (O) for (const k of O.kids) out.push([k.x, k.base, 3]);
    return out;
  }
  function castShadows(t, L) {
    const lt = HD.light();
    if (!(lt.day > 0) || !lt.sun) return;
    const list = feet(T.step(t, 8));
    for (const [x, b, hw] of list) {
      const dx = x - lt.sun.x;
      const dy = b - lt.sun.y;
      const len = lt.mode === 'golden' ? 16 : lt.mode === 'dusk' ? 12 : 7;
      const n = Math.hypot(dx, dy) || 1;
      const sx = (dx / n) * len;
      const sy = Math.max(1, (dy / n) * len * 0.22);
      L.shade({ poly: [[x - hw, b + 0.5], [x + hw, b + 0.5], [x + hw + sx, b + 0.5 + sy], [x - hw + sx, b + 0.5 + sy]], k: lt.mode === 'day' ? 0.42 : 0.36 });
    }
  }

  // =====================================================================
  HD.module('family', {
    passes: [
      {
        // the back row behind the birthday table: drawn before the table so
        // the tablecloth covers their legs
        layer: 'scene',
        z: 34.97,
        id: 'family-back',
        draw(g, t) {
          if (HD.edition.cast.party === 'birthday' && HD.place().table) drawDCBack(g, t);
        },
      },
      {
        layer: 'scene',
        z: 45,
        id: 'balcony',
        draw(g, t) {
          if (HD.edition.cast.party === 'match') drawMatchBalcony(g, t);
        },
      },
      {
        layer: 'scene',
        z: 46,
        id: 'family',
        draw(g, t) {
          const ed = HD.edition;
          const party = ed.cast.party;
          if (party === 'bench') drawBench(g, t);
          else if (party === 'trip') drawTrip(g, t);
          else if (party === 'birthday' && HD.place().table) drawDC(g, t);
          if (ed.cast.out === 'friends') drawGroup(g, t);
          else if (ed.cast.out === 'passby') drawPass(g, t);
        },
      },
      {
        layer: 'scene',
        z: 47,
        id: 'visitors',
        draw(g, t) {
          drawNiece(g, t);
          drawTot(g, t);
        },
      },
    ],
    lights(t, L) {
      lightsGroup(t, L);
      lightsTot(t, L);
      castShadows(t, L);
    },
  });
})();
