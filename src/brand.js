/*
 * brand (Purrfect Year v2): the AZTMM marks, built into each place rather
 * than stamped on top of it.
 *  1. The emblem bake: the silver-on-black skyline badge (ring, lettering
 *     band, the two towers and the bridge pylons) as a pixel emblem. Shared
 *     through HD.brand.emblem() for anyone who needs the full-size mark.
 *  2. One small sign per place, at place.sign: a metal plaque (pewter,
 *     bronze or brass to suit the building) with the emblem's skyline in
 *     silver on black enamel. Scene layer (z 34.9, after the buildings and
 *     before the decorations and cats), painted in night colours so the
 *     daylight shows the true metal by day; after dark every sign sits by a
 *     lit lobby or porch, so the light on the plaque is topped up to a warm
 *     minimum. A 1 px drop shadow falls away from the strongest nearby light
 *     (or the sun), a slow specular glint runs across it three times a loop,
 *     and an exposed plaque drips in the rain.
 *  3. The logo firework (tag logo-firework): once per loop (118 s) a rocket
 *     rises from behind the roofs and bursts into the letters AZTMM in the
 *     brand gradient, in open sky: clear of the roofs (HD.placeTop), the
 *     moon (HD.sky), the title corner and, where it can, the rooftop steam.
 *
 * HD.brand (for other modules): emblem() the full-size badge, logoWindow
 * [start, end) loop seconds of the logo burst, logoBox() its sky box at the
 * current place, signRect() the plaque's rectangle.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const T = HD.time;
  const C = HD.color;

  const BRAND = { cyan: '#22d3ee', violet: '#a78bfa' };
  const GRAD = C.ramp(BRAND.cyan, BRAND.violet, 6);
  const GRAD_HOT = C.ramp('#d6fbff', '#efe6ff', 6);
  const GRAD_EMBER = C.ramp('#0f5a68', '#4a3a78', 6);

  /** a daylight (albedo) colour as it looks under the cold night ambient:
   *  the engine relights it back to the true colour by day or near a lamp */
  const AMB = HD.AMBIENT;
  function nite(hex) {
    const c = C.hex(hex);
    return C.css(c[0] * AMB[0], c[1] * AMB[1], c[2] * AMB[2]);
  }

  // ------------------------------------------------------------------
  // 1. the emblem bake (silver on black)
  // ------------------------------------------------------------------
  const SILVER = ['#0c0d10', '#15161b', '#24262d', '#3a3d46', '#5d616c', '#8a8f9c', '#b4b9c4', '#d2d6de'];
  function bakeEmblem(R) {
    const D = R * 2 + 1;
    return HD.bake(D, D, (g) => {
      const c = R;
      for (let y = 0; y < D; y++) {
        for (let x = 0; x < D; x++) {
          const dx = x - c;
          const dy = y - c;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R + 0.45) continue;
          let col = SILVER[1];
          if (d > R - 0.85) {
            const lit = -dx - dy; // rim lit from the upper left
            col = lit > 4 ? SILVER[6] : lit < -4 ? SILVER[3] : SILVER[5];
          } else if (d > 6.9 && d < 7.9) col = SILVER[5]; // inner ring
          else if (d >= 7.9) {
            // lettering band: small raised marks stand in for the circular text
            const a = Math.atan2(dy, dx);
            const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 40);
            col = d > 8.3 && d < 9.4 && k % 2 === 0 && HD.hash(k, 3, 19) < 0.85 ? SILVER[4] : SILVER[1];
          }
          g.px(x, y, col);
        }
      }
      const L = SILVER[7];
      const M = SILVER[5];
      const K = SILVER[3];
      const P = (x, y, col) => {
        if (x * x + y * y > 6.8 * 6.8) return; // inside the inner ring only
        g.px(c + x, c + y, col);
      };
      // cable-stayed bridge pylons and deck
      for (const sx of [-6, 6]) {
        const o = Math.sign(sx);
        for (let y = -2; y <= 5; y++) P(sx, y, M);
        P(sx - o, -1, K);
        P(sx - o * 2, 0, K);
        P(sx - o * 3, 1, K);
      }
      for (const x of [-6, -5, 5, 6]) P(x, 3, M);
      // left tower: shaft, stepped crown, antenna
      for (let y = -2; y <= 7; y++) {
        P(-4, y, L);
        P(-3, y, y % 3 === 0 ? K : M);
        P(-2, y, L);
      }
      for (let x = -5; x <= -1; x++) P(x, -3, L);
      P(-4, -4, M);
      P(-3, -4, M);
      P(-2, -4, M);
      for (let y = -7; y <= -5; y++) P(-3, y, L);
      // right slab tower with its slanted roof and shaded face
      for (let y = -6; y <= 7; y++) {
        if (y > -6) P(0, y, M);
        P(1, y, L);
        P(2, y, y % 2 ? K : M);
        P(3, y, M);
        P(4, y, L);
      }
      for (let x = 1; x <= 4; x++) P(x, -6, L);
      P(0, -5, L);
    });
  }
  let emblem = null;

  // ------------------------------------------------------------------
  // 2. the plaque at each place
  // ------------------------------------------------------------------
  // metals, true (daylight) colours dark -> light
  const METAL = {
    pewter: ['#1a1c21', '#30333a', '#4b4f58', '#6d727d', '#959aa5', '#c5c9d0'],
    bronze: ['#2a1a10', '#4e301d', '#76492b', '#9d6a40', '#c4935f', '#e6c08c'],
    brass: ['#33240b', '#634613', '#94691d', '#c3922c', '#e2b94e', '#f8e39a'],
  };
  const ENAMEL = ['#0d0e11'];
  const SKY = ['#545964', '#8d939f', '#c2c7d0', '#e2e6ec']; // the silver skyline

  /*
   * Plaques, pixel by pixel. Characters:
   *   H F f e d o   frame metal, highlight -> darkest (lit from the upper left)
   *   k             black enamel
   *   W S s z       the silver skyline (W top light, S bright, s mid, z shaded)
   * The skyline is the emblem's own: a tower with an antenna, lit face and
   * shaded face, and a slab with a slanted roof beside it, under black sky.
   * The towers touch and share one silhouette (lone 1 px bars would read as
   * letters); the shaded faces keep the buildings apart.
   */
  const PLAQUE = {
    // 9 x 7: the plaque on a lobby pier
    wide: [
      'HFFFFFFFf', //
      'FkkWkkkkd',
      'FkkSkkkkd',
      'FkSSzkksd',
      'FkSSzksSd',
      'FsSSzsSzd',
      'fdddddddo',
    ],
    // 9 x 7 with rounded corners: a Victorian porch
    round: [
      '.HFFFFFf.', //
      'HkkWkkkkd',
      'FkkSkkkkd',
      'FkSSzkksd',
      'FkSSzksSd',
      'FsSSzsSzd',
      '.ddddddo.',
    ],
    // 7 x 9 upright: a slim pier or a stone panel
    tall: [
      'HFFFFFf', //
      'FkkWkkd',
      'FkkSkkd',
      'FkSSkkd',
      'FkSzkkd',
      'FkSzksd',
      'FkSzsSd',
      'FsSzSzd',
      'fdddddo',
    ],
    // 11 x 8: the roomier plaque on a broad pier (a third, lower tower)
    large: [
      'HFFFFFFFFFf', //
      'FkkkWkkkkkd',
      'FkkkSkkkkkd',
      'FkkSSzkkkkd',
      'FkkSSzkkksd',
      'FkzSSzsksSd',
      'FszSSzszSzd',
      'fdddddddddo',
    ],
  };

  // which plaque each place gets, its metal, a nudge off the anchor's centre,
  // and whether a canopy or porch roof keeps the rain off it
  const SIGNS = {
    apt1: { shape: 'wide', metal: 'pewter', dx: -1, sheltered: true },
    apt2: { shape: 'tall', metal: 'bronze', dx: -3 }, // centred on the brick pier left of the lobby glass
    soho: { shape: 'tall', metal: 'brass' }, // fills the stone panel beside the lobby
    bhills: { shape: 'tall', metal: 'brass' },
    marina: { shape: 'large', metal: 'brass' },
    herndon: { shape: 'round', metal: 'brass', dx: -1, sheltered: true },
  };

  function plaqueMap(metal) {
    const m = METAL[metal];
    return {
      H: nite(m[5]),
      F: nite(m[4]),
      f: nite(m[3]),
      e: nite(m[2]),
      d: nite(m[1]),
      o: nite(m[0]),
      k: nite(ENAMEL[0]),
      z: nite(SKY[0]),
      s: nite(SKY[1]),
      S: nite(SKY[2]),
      W: nite(SKY[3]),
    };
  }

  const baked = new Map(); // place id -> {img, rows, w, h, x, y, solid, seed}
  function signArt(pl) {
    let a = baked.get(pl.id);
    if (a) return a;
    const spec = SIGNS[pl.id] || SIGNS.apt1;
    const rows = PLAQUE[spec.shape];
    const img = HD.sprite(rows, plaqueMap(spec.metal));
    const w = img.width;
    const h = img.height;
    const s = pl.sign;
    // centre the plaque on the anchor (it may grow a pixel past it)
    const x = s.x + Math.floor((s.w - w) / 2) + (spec.dx || 0);
    const y = s.y + Math.floor((s.h - h) / 2) + (spec.dy || 0);
    const solid = [];
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (rows[yy][xx] !== '.') solid.push([xx, yy]);
    const hx = rows[0].indexOf('H');
    a = { img, rows, w, h, x, y, solid, spec, hi: [x + hx, y], seed: HD.hash(pl.id.length, pl.id.charCodeAt(0), pl.id.charCodeAt(1)) };
    baked.set(pl.id, a);
    return a;
  }

  // the key light on the plaque this frame: direction the shadow falls
  const KEY = { dx: 1, dy: 1, lum: 0 };
  function keyLight(L, pl) {
    const a = signArt(pl);
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    let best = 0;
    let bx = 0;
    let by = 0;
    let sum = 0;
    for (const l of L.list) {
      const rx = l.r;
      const ry = l.ry || l.r;
      const ex = (cx - l.x) / rx;
      const ey = (cy - l.y) / ry;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d >= 1) continue;
      const cl = l.clip;
      if (cl && (cx < cl.x0 || cx > cl.x1 || cy < cl.y0 || cy > cl.y1)) continue;
      const col = l.color || [1, 0.6, 0.3];
      const v = (Math.pow(1 - d, l.pow || 1.6) * l.i * (col[0] + col[1] + col[2])) / 3;
      sum += v;
      if (v > best) {
        best = v;
        bx = l.x;
        by = l.y;
      }
    }
    const lt = HD.light();
    KEY.lum = sum;
    if (lt.sun && lt.day >= 0.5) {
      bx = lt.sun.x;
      by = lt.sun.y;
      best = 1;
    }
    if (best > 0.02) {
      KEY.dx = Math.abs(cx - bx) < 3 ? 0 : cx > bx ? 1 : -1;
      KEY.dy = cy >= by - 2 ? 1 : 0;
    } else {
      KEY.dx = 1;
      KEY.dy = 1;
    }
    if (!KEY.dx && !KEY.dy) KEY.dy = 1;
    // the entrance glow on the plaque: after dark every sign sits beside a
    // lit lobby or porch, so top the light on the plaque itself up to a warm
    // minimum (clipped to the plaque, so the wall around it is untouched)
    if (lt.day < 0.5) {
      const want = SIGN_GLOW - sum;
      if (want > 0.02) {
        L.add({ x: Math.round(cx) - 2, y: a.y - 2, r: a.w + 4, color: HD.LIGHT.candle, i: want * 1.6, bands: 3, pow: 1, clip: { x0: a.x, y0: a.y, x1: a.x + a.w - 1, y1: a.y + a.h - 1 } });
      }
    }
  }
  const SIGN_GLOW = 1.0;

  function drawSign(g, t) {
    const pl = HD.place();
    if (!pl || !pl.sign) return;
    const a = signArt(pl);
    // drop shadow: a 1 px offset silhouette, away from the key light
    const ctx = g.ctx;
    ctx.globalAlpha = 0.42;
    for (const [xx, yy] of a.solid) {
      const sx = xx + KEY.dx;
      const sy = yy + KEY.dy;
      if (sy < a.h && sx >= 0 && sx < a.w && a.rows[sy][sx] !== '.') continue;
      g.px(a.x + sx, a.y + sy, '#000000');
    }
    ctx.globalAlpha = 1;
    g.sprite(a.img, a.x, a.y);
    drawGlint(g, t, a);
    if (!a.spec.sheltered && HD.edition.weather && HD.edition.weather.rain > 0) drawDrips(g, t, a);
  }

  // rain on an exposed plaque: beads swell on its bottom edge, catch the
  // lobby light, and drop
  const DROP = { night: ['#8a7660', '#ffe2b8'], day: ['#9fb0c4', '#eef4fa'] };
  function drawDrips(g, t, a) {
    const pal = HD.light().day >= 0.5 ? DROP.day : DROP.night;
    const y0 = a.y + a.h;
    for (let i = 0; i < 2; i++) {
      const c = T.cycle(t, i, 5.5, 4100 + i);
      const age = c.age * c.P;
      const x = a.x + 1 + Math.floor(c.rnd(1) * (a.w - 2));
      const hang = 1.4 + c.rnd(2) * 2.2;
      if (age < hang) {
        if (age > 0.3) g.em.px(x, y0, age > hang * 0.6 ? pal[1] : pal[0]);
      } else {
        const ft = age - hang;
        const dy = Math.round(90 * ft * ft);
        if (dy > 16) continue;
        g.em.px(x, y0 + dy, pal[1]);
        if (dy > 2) g.em.px(x, y0 + dy - 1, pal[0]);
      }
    }
  }

  // now and then a slow specular glint sweeps across the plaque (emissive:
  // it is a reflection), then a tiny star winks on the top-left corner
  const GLINT = { period: 80, dur: 1.4 };
  function drawGlint(g, t, a) {
    const ph = T.phase(t, GLINT.period, a.seed);
    const s = ph * (HD.LOOP / T.cyclesFor(GLINT.period));
    if (s > GLINT.dur + 0.6) return;
    const lt = HD.light();
    const warm = lt.mode === 'night' || lt.mode === 'dusk' ? ['#ffd9a0', '#fff4dc'] : lt.mode === 'golden' ? ['#ffd890', '#fff2cc'] : ['#e8eef8', '#ffffff'];
    if (s < GLINT.dur) {
      const pos = (s / GLINT.dur) * (a.w + a.h + 4) - 2;
      for (const [xx, yy] of a.solid) {
        const ch = a.rows[yy][xx];
        if (ch === 'k' || ch === 'K' || ch === 'o' || ch === 'd') continue;
        const d = xx + yy - pos;
        if (d < 0 || d >= 1.6) continue;
        g.em.px(a.x + xx, a.y + yy, d < 0.8 ? warm[1] : warm[0]);
      }
    } else {
      // the wink: a 3 px cross on the highlight corner, for a moment
      const u = (s - GLINT.dur) / 0.6;
      const x = a.hi[0];
      const y = a.hi[1];
      g.em.px(x, y, warm[1]);
      if (u > 0.2 && u < 0.75) {
        g.em.px(x - 1, y, warm[0]);
        g.em.px(x + 1, y, warm[0]);
        g.em.px(x, y - 1, warm[0]);
        g.em.px(x, y + 1, warm[0]);
      }
    }
  }

  // ------------------------------------------------------------------
  // 3. the logo firework (tag logo-firework), once per loop
  // ------------------------------------------------------------------
  const BIG = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  };
  /** pixel coordinates of a word set in a glyph table */
  function word(font, text, gap) {
    const pts = [];
    let x = 0;
    for (const ch of text) {
      const gl = font[ch];
      for (let y = 0; y < gl.length; y++) for (let i = 0; i < gl[y].length; i++) if (gl[y][i] === '#') pts.push([x + i, y]);
      x += gl[0].length + gap;
    }
    return { pts, w: x - gap, h: font[text[0]].length };
  }
  const LOGO = word(BIG, 'AZTMM', 2);
  const SP = 2; // spark spacing in px
  const LW = LOGO.w * SP;
  const LH = LOGO.h * SP;
  const FW = { start: 118, dur: 5.5, cy: 24, launchY: 150, droop: 9 };
  const TITLE = (HD.layout && HD.layout.titleSafe) || { x0: 8, y0: 8, x1: 170, y1: 70 };
  /**
   * Where the logo bursts in this entry: in open sky (the letters hang at
   * least 16 px above every roof and their droop never reaches one), clear of
   * the moon and of the title corner, and out of the rooftop steam columns
   * (bright steam behind the sparks would swallow the letters). Among the
   * spots left, the one nearest the building's middle at a comfortable
   * height. Worked out once per entry.
   */
  function steamColumns(ed) {
    const cols = [];
    try {
      const R = HD.atmoSeasons && HD.atmoSeasons.build ? HD.atmoSeasons.build(ed) : null;
      for (const P of (R && R.plumes) || []) {
        for (const e of P.emitters || []) if (e.roof) cols.push(e.x);
      }
    } catch (err) {
      // no steam recipe: nothing to avoid
    }
    return cols;
  }
  const logoSpot = HD.perEdition((ed) => {
    const pl = HD.place();
    const moon = HD.sky && HD.sky.moon ? HD.sky.moon() : null;
    const steam = steamColumns(ed);
    const hw = (LW >> 1) + 3;
    const hh = LH >> 1;
    const pref = pl.building ? Math.round((pl.building.x0 + pl.building.x1) / 2) : 300;
    const ok = (cx, cy) => {
      const x0 = cx - hw;
      const x1 = cx + hw;
      const y0 = cy - hh - 3;
      const y1 = cy + hh + FW.droop;
      if (x0 < 4 || x1 > HD.W - 5 || y0 < 3) return false;
      if (x0 <= TITLE.x1 + 4 && y0 <= TITLE.y1 + 4) return false;
      if (moon) {
        const nx = Math.max(x0, Math.min(x1, moon.x));
        const ny = Math.max(y0, Math.min(y1, moon.y));
        if (Math.hypot(nx - moon.x, ny - moon.y) < moon.r + 6) return false;
      }
      for (let x = x0; x <= x1; x++) {
        const top = HD.placeTop(x, pl);
        if (top - (cy + hh) < 16 || top - y1 < 5) return false;
      }
      return true;
    };
    // how much of the logo's box a steam column would cover: a column rises
    // about 44 px off the roof and leans downwind (to the right)
    const steamHit = (cx, cy) => {
      let hit = 0;
      for (const sx of steam) {
        const ax = Math.max(cx - hw, sx - 6);
        const bx = Math.min(cx + hw, sx + 16);
        const top = HD.placeTop(sx, pl);
        const ay = Math.max(cy - hh - 3, top - 46);
        const by = Math.min(cy + hh + FW.droop, top);
        if (bx > ax && by > ay) hit += (bx - ax) * (by - ay);
      }
      return hit;
    };
    let best = null;
    let bestScore = Infinity;
    for (let cy = 12; cy <= 40; cy += 2) {
      for (let cx = hw + 4; cx <= HD.W - hw - 5; cx += 2) {
        if (!ok(cx, cy)) continue;
        const score = 2 * steamHit(cx, cy) + 0.5 * Math.abs(cx - pref) + 3 * Math.abs(cy - FW.cy);
        if (score < bestScore) {
          best = { cx, cy };
          bestScore = score;
        }
      }
    }
    return best || { cx: 300, cy: FW.cy };
  });
  function logoState(t) {
    const L = HD.LOOP;
    const s = (((t - FW.start) % L) + L) % L;
    return s < FW.dur ? s : -1;
  }
  function drawLogoFirework(g, t) {
    if (!HD.tag('logo-firework')) return;
    const s = logoState(t);
    if (s < 0) return;
    const sp = logoSpot();
    const cx = sp.cx;
    const cy = sp.cy;
    if (s < 1.1) {
      // rocket climbing with a short fading trail; it rises from behind the
      // roofs, so nothing of it shows below the skyline
      const u = s / 1.1;
      const e = 1 - (1 - u) * (1 - u);
      const y = Math.round(FW.launchY + (cy - FW.launchY) * e);
      const wob = Math.round(Math.sin(u * 9) * 0.6);
      const roof = HD.placeTop(cx);
      if (y < roof) g.px(cx + wob, y, '#fff6dc');
      for (let k = 1; k <= 4; k++) if (y + k * 2 < Math.min(FW.launchY, roof)) g.px(cx, y + k * 2, k < 2 ? '#ffc96a' : '#7a3a14');
      return;
    }
    const ox = cx - (LW >> 1);
    const oy = cy - (LH >> 1);
    const ts = T.step(t, 12);
    // soft flash behind the word, in the brand gradient
    const glowK = s < 1.5 ? 1 : s < 3.9 ? 0.7 : Math.max(0, 0.7 * (1 - (s - 3.9) / 1.6));
    if (glowK > 0) {
      HD.glow(g, cx - 16, cy, 34, [0.13, 0.6, 0.75], 0.32 * glowK);
      HD.glow(g, cx + 16, cy, 34, [0.45, 0.35, 0.8], 0.32 * glowK);
    }
    for (let i = 0; i < LOGO.pts.length; i++) {
      const [px, py] = LOGO.pts[i];
      const tx = ox + px * SP;
      const ty = oy + py * SP;
      const gi = Math.min(5, Math.floor((px / LOGO.w) * 6));
      let x;
      let y;
      let col;
      if (s < 1.5) {
        // sparks fly out from the burst centre to their letter positions
        const u = (s - 1.1) / 0.4;
        const e = 1 - Math.pow(1 - u, 3);
        x = cx + (tx - cx) * e;
        y = cy + (ty - cy) * e;
        col = GRAD_HOT[gi];
      } else if (s < 3.9) {
        x = tx;
        y = ty;
        col = HD.hash(i, Math.floor(ts * 12) % (12 * HD.LOOP), 77) < 0.18 ? GRAD_HOT[gi] : GRAD[gi];
        // a trailing spark fills the gap to the next dot so the letters read solid
        if (HD.hash(i, Math.floor(ts * 12) % (12 * HD.LOOP), 78) < 0.8) g.px(x + 1, y + 1, GRAD_EMBER[gi]);
      } else {
        // the letters droop and burn out
        const u = (s - 3.9) / 1.6;
        if (HD.hash(i, 5, 91) < u * 1.15) continue;
        x = tx;
        y = ty + FW.droop * u * u;
        col = u < 0.45 ? GRAD[gi] : GRAD_EMBER[gi];
      }
      g.px(x, y, col);
    }
  }
  function logoLight(t, L) {
    const s = logoState(t);
    if (s < 1.1) return;
    const k = s < 1.5 ? 1 : s < 3.9 ? 0.75 : Math.max(0, 0.75 * (1 - (s - 3.9) / 1.6));
    const sp = logoSpot();
    if (k > 0) L.add({ x: sp.cx, y: sp.cy, r: 150, color: [0.55, 0.72, 1.0], i: 0.5 * k, bands: 5 });
  }

  HD.brand = {
    /** the full-size emblem (21 x 21), baked on first use */
    emblem() {
      if (!emblem) emblem = bakeEmblem(10);
      return emblem;
    },
    /** loop seconds [start, end) of the logo firework, for anyone keeping that sky clear */
    logoWindow: [FW.start, FW.start + FW.dur],
    /** the logo's sky box at the current place {x0, y0, x1, y1} */
    logoBox() {
      const sp = logoSpot();
      return { x0: sp.cx - (LW >> 1) - 2, y0: sp.cy - (LH >> 1) - 2, x1: sp.cx + (LW >> 1) + 2, y1: sp.cy + (LH >> 1) + FW.droop };
    },
    /** the plaque's rectangle at the current place {x, y, w, h} */
    signRect() {
      const a = signArt(HD.place());
      return { x: a.x, y: a.y, w: a.w, h: a.h };
    },
  };

  HD.module('brand', {
    lights(t, L) {
      const pl = HD.place();
      if (pl && pl.sign) keyLight(L, pl);
      if (HD.tag('logo-firework')) logoLight(t, L);
    },
    passes: [
      // fx, just over the rooftop steam (z 54) and the halos, under the near
      // snow: the burst shines through the steam and lights it up
      { layer: 'fx', z: 56, id: 'logo-firework', draw: drawLogoFirework },
      { layer: 'scene', z: 34.9, id: 'sign', draw: drawSign },
    ],
  });
})();
