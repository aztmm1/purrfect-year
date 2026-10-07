/*
 * weather-seasons — snow, leaves, petals and fireflies for the Rainy Hollow
 * series (rain itself lives in weather.js). Plugs into the 'weather' module
 * through the HD.weatherSeasons hooks, which weather.js calls at draw time:
 *
 *   far   bg z23   far snow behind the house; distant fireflies over the fields
 *   mid   fx z43   mid snow, falling leaves, petals, meadow and tree fireflies
 *   near  fx z67   big soft near snowflakes, a few close leaves and petals
 *   lights          a handful of aggregated firefly lights (never one per bug)
 *
 * Everything reads HD.edition at draw time (live switching works) and is a
 * stateless HD.time.cycle life or a loop-safe noise path, so the frame is a
 * pure function of t and loops at HD.LOOP. fx particles are not relit by the
 * engine, so each one samples the lightmap (HD.lights.rgb) and picks a
 * precomputed tone for both the strength and the colour of the light: cream
 * and gold by candles and fire, pink by red lanterns, blue-white under the
 * moon and cool fireworks, green-white by fireflies and green bursts.
 *
 * Leaves and petals detach from the tree's foliage clumps (hand-traced crown
 * anchors per tree, see CROWN), fade in over a few frames and fade out on the
 * ground, so nothing pops into or out of existence in the open sky.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const LY = HD.layout;
  const T = HD.time;
  const W = HD.W;
  const H = HD.H;
  const TAU = Math.PI * 2;
  const mix = HD.color.mix;
  const hash = HD.hash;
  const rgbAt = HD.lights.rgb;
  const sin = Math.sin;
  const cos = Math.cos;
  const R = Math.round;
  const SEA = (HD.weatherSeasons = HD.weatherSeasons || {});

  const G0 = LY.ground.houseBase; // 206
  const G1 = LY.ground.front; // 238
  const TS = LY.titleSafe;
  const inTitle = (x, y) => x >= TS.x0 - 4 && x <= TS.x1 + 4 && y >= TS.y0 - 4 && y <= TS.y1 + 4;
  /** how far (x, y) sits inside the title-safe box grown by margin m (<= 0: outside) */
  const titleDepth = (x, y, m) => Math.min(x - (TS.x0 - m), TS.x1 + m - x, y - (TS.y0 - m), TS.y1 + m - y);
  const TREE = LY.tree;

  // ------------------------------------------------------------------
  // light: level (same thresholds as the rain) and colour family.
  // Tables are flat [family * 7 + level]; level 0 is the cold night colour.
  //   family 0 warm   fire, candles, lanterns, diyas, gold bulbs
  //          1 red    red lanterns, red/pink bulbs, red/magenta bursts
  //          2 cool   moon, blue/violet/white bursts
  //          3 green  fireflies, green bulbs and bursts
  // ------------------------------------------------------------------
  const LVT = [0.035, 0.08, 0.15, 0.25, 0.38, 0.56];
  const NLV = 7;
  function lvOf(l) {
    let k = 0;
    while (k < 6 && l >= LVT[k]) k++;
    return k;
  }
  /** table index for the light at (x, y); k scales the strength (far layers) */
  function lightIdx(x, y, k) {
    const c = rgbAt(x, y);
    const r = c[0];
    const g = c[1];
    const b = c[2];
    const lv = lvOf((0.4 * r + 0.45 * g + 0.15 * b) * k);
    if (lv === 0) return 0;
    let fam = 0;
    if (g > r * 0.85 && g > b * 1.15) fam = 3;
    else if (b >= r * 0.85) fam = 2;
    else if (g < r * 0.36 || (g < r * 0.45 && b > g)) fam = 1;
    return fam * NLV + lv;
  }
  // per family, a dark -> light ramp; a warm target is swapped for the entry
  // of the same brightness, so a flake gets as bright as it would by a candle
  // but takes the colour of the light it is actually in
  const FAM_RAMP = [
    null,
    [P.red[2], P.red[3], P.red[4], P.red[5], P.red[6], mix(P.red[6], P.blossom[7], 0.55), mix(P.blossom[7], P.snow[8], 0.5)],
    [P.night[8], P.night[9], P.moon[0], P.moon[1], P.moon[2], P.moon[3], P.moon[4]],
    [P.firefly[0], P.firefly[1], mix(P.firefly[1], P.firefly[2], 0.5), P.firefly[2], mix(P.firefly[3], P.snow[7], 0.45), mix(P.firefly[4], P.snow[8], 0.45), mix(P.firefly[4], P.snow[8], 0.75)],
  ];
  const lumHex = (c) => {
    const v = HD.color.hex(c);
    return 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2];
  };
  function famTarget(fam, warm) {
    const lw = lumHex(warm);
    let best = FAM_RAMP[fam][0];
    let bd = 1e9;
    for (const c of FAM_RAMP[fam]) {
      const d = Math.abs(lumHex(c) - lw);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }
  /** cold colour -> [family * 7 + level] table built by `steps` per family */
  function famSteps(steps, cold, warm, kmax) {
    let out = steps(cold, warm, kmax);
    for (let f = 1; f < FAM_RAMP.length; f++) out = out.concat(steps(cold, famTarget(f, warm), kmax));
    return out;
  }
  /** 7 levels warming towards `warm` (max mix kmax) */
  function warmSteps(cold, warm, kmax) {
    const out = [cold];
    for (let k = 1; k <= 6; k++) out.push(mix(cold, warm, Math.min(kmax, 0.08 + 0.12 * k)));
    return out;
  }
  /** 7 levels that brighten towards a lit highlight (snow) */
  function glowSteps(cold, warm, kmax) {
    const out = [cold];
    for (let k = 1; k <= 6; k++) out.push(mix(cold, warm, Math.min(kmax, 0.1 + 0.14 * k)));
    return out;
  }
  const perArr = (n, a, b, seed) => Array.from({ length: n }, (_, i) => a + (b - a) * hash(i, seed, 3));

  // ------------------------------------------------------------------
  // SNOW: three depth layers. Snow at night is blue-lilac; near a lamp it
  // brightens into glowing cream and pale gold (pink by the red lanterns,
  // blue-white in a cool firework flash), so the flakes sparkle against the
  // warm walls instead of melting into them. Flakes drift with the wind
  // (slightly right, like the smoke), wobble, and simply vanish where they land.
  // ------------------------------------------------------------------
  const CREAM = P.amber[7];
  const GOLD = P.amber[6];
  const WHITE_W = P.amber[8];
  const SF = [
    famSteps(glowSteps, mix(P.snow[3], P.snow[4], 0.6), P.warmrain[3], 0.45),
    famSteps(glowSteps, P.snow[4], P.warmrain[4], 0.5),
    famSteps(glowSteps, mix(P.snow[5], P.snow[6], 0.4), GOLD, 0.55),
  ];
  const SM = [famSteps(glowSteps, mix(P.snow[5], P.snow[6], 0.4), GOLD, 0.7), famSteps(glowSteps, P.snow[7], CREAM, 0.8), famSteps(glowSteps, P.snow[8], WHITE_W, 0.85)];
  const SN = [famSteps(glowSteps, mix(P.snow[4], P.snow[5], 0.5), GOLD, 0.65), famSteps(glowSteps, P.snow[6], CREAM, 0.78), famSteps(glowSteps, P.snow[8], WHITE_W, 0.85)];
  // clear skies: the few flakes kept in the title area (dimmer than the
  // fainter stars), and a flake fading out at the edge of that area
  const STITLE = famSteps(glowSteps, mix(P.snow[3], P.snow[4], 0.4), P.warmrain[3], 0.45);
  const SGHOST = famSteps(glowSteps, mix(P.snow[2], P.snow[3], 0.5), P.warmrain[2], 0.4);
  // clear skies: a 1px flake up in the sky trails a faint pixel above it, so
  // it reads as a falling flake rather than one more star
  const SKY_Y = 150;

  const SNOW_FAR_N = 440;
  const SNOW_MID_N = 360;
  const SNOW_NEAR_N = 42;
  const SFP = perArr(SNOW_FAR_N, 15, 21, 9101);
  const SMP = perArr(SNOW_MID_N, 8.5, 11.5, 9202);
  const SNP = perArr(SNOW_NEAR_N, 5.2, 7, 9303);
  const DRIFT_FAR = 0.1; // px right per px fallen
  const DRIFT_MID = 0.14;
  const DRIFT_NEAR = 0.2;
  // Under a clear starry sky (lunar, newyear) a 1px flake in a still frame is
  // a star. There the far flakes only show low down, against the hills and
  // behind the house, and in the title-safe corner only ~40% of the mid and
  // near flakes show, in their darkest tone (the rest fade out at its edge).
  const FAR_CLEAR_Y = 112;
  const TITLE_KEEP = 0.4;
  /**
   * title-area rule for one flake in a clear sky: 0 draw as usual, 1 draw in
   * the darkest tone, 2 draw as a ghost (fading band), 3 skip
   */
  function titleRule(x, y, keep, marg) {
    const d = titleDepth(x, y, 4 + marg * 12);
    if (d <= 0) return 0;
    if (keep < TITLE_KEEP) return 1;
    return d < 5 ? 2 : 3;
  }

  function snowFar(g, t, s, clear) {
    const n = R(SNOW_FAR_N * s);
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, SFP[i], 9101);
      const age = c.age;
      const yEnd = 196 + c.rnd(1) * 10;
      const y = R(-3 + (yEnd + 3) * age);
      const r3 = c.rnd(3);
      let b = r3 < 0.5 ? 0 : r3 < 0.9 ? 1 : 2;
      if (clear) {
        // each flake shows from its own start line (no visible edge), dark at first
        const yS = FAR_CLEAR_Y + c.rnd(7) * 26;
        if (y < yS) continue;
        if (y < yS + 8) b = 0;
      }
      const amp = 0.8 + c.rnd(4) * 1.4;
      const x = R(c.rnd(0) * (W + 50) - 30 + y * DRIFT_FAR + amp * sin(TAU * (age * (2 + c.rnd(5) * 2) + c.rnd(6))));
      if (b > 0 && inTitle(x, y)) b--;
      g.rect(x, y, 1, 1, SF[b][lightIdx(x, y, 0.6)]);
    }
  }

  function snowMid(g, t, s, clear) {
    const n = R(SNOW_MID_N * s);
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, SMP[i], 9202);
      const age = c.age;
      const d = c.rnd(1);
      const yl = G0 + d * (G1 - 1 - G0);
      const y = R(-4 + (yl + 4) * age);
      const amp = 1.4 + c.rnd(4) * 2.2;
      const x = R(c.rnd(0) * (W + 60) - 40 + y * DRIFT_MID + amp * sin(TAU * (age * (2.2 + c.rnd(5) * 2) + c.rnd(6))));
      const r3 = c.rnd(3);
      let b = d > 0.55 ? (r3 < 0.55 ? 2 : 1) : r3 < 0.3 ? 0 : r3 < 0.85 ? 1 : 2;
      const li = lightIdx(x, y, 1);
      if (clear) {
        const tr = titleRule(x, y, c.rnd(7), c.rnd(8));
        if (tr === 3) continue;
        if (tr === 2) {
          g.rect(x, y, 1, 1, SGHOST[li]);
          continue;
        }
        if (tr === 1) {
          g.rect(x, y, 1, 1, STITLE[li]);
          continue;
        }
      } else if (b > 0 && inTitle(x, y)) b--;
      if (d > 0.62) {
        // the nearest mid flakes: a soft round 2x2, lit from the top-left
        g.rect(x, y, 1, 1, SM[b][li]);
        g.rect(x + 1, y, 1, 1, SM[b > 0 ? b - 1 : 0][li]);
        g.rect(x, y + 1, 1, 1, SM[b > 0 ? b - 1 : 0][li]);
        g.rect(x + 1, y + 1, 1, 1, SM[0][li]);
      } else {
        if (clear && y < SKY_Y) g.rect(x, y - 1, 1, 1, SF[b][li]);
        g.rect(x, y, 1, 1, SM[b][li]);
      }
    }
  }

  function snowNear(g, t, s, clear) {
    const n = Math.max(3, R(SNOW_NEAR_N * s));
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, SNP[i], 9303);
      const age = c.age;
      const y = R(-6 + (H + 12) * age);
      const amp = 3 + c.rnd(4) * 3;
      const x = R(c.rnd(0) * (W + 90) - 60 + y * DRIFT_NEAR + amp * sin(TAU * (age * (1.2 + c.rnd(5) * 1.2) + c.rnd(6))));
      const li = lightIdx(x, y, 1);
      let dim = inTitle(x, y) ? 1 : 0;
      if (clear) {
        const tr = titleRule(x, y, c.rnd(7), c.rnd(8));
        if (tr === 3) continue;
        if (tr === 2) {
          g.rect(x, y, 2, 2, SGHOST[li]);
          continue;
        }
        dim = tr === 1 ? 2 : 0;
      }
      const lo = dim > 1 ? STITLE[li] : SN[0][li];
      const hi = dim > 1 ? SN[0][li] : SN[2 - dim][li];
      const mid = dim > 1 ? lo : SN[1 - dim][li];
      if (i % 3 === 0 && dim < 2) {
        // big soft flake: 2x2 core with a 1px halo of dim arms
        g.rect(x, y, 2, 2, mid);
        g.rect(x, y, 1, 1, hi);
        g.rect(x, y - 1, 2, 1, lo);
        g.rect(x, y + 2, 2, 1, lo);
        g.rect(x - 1, y, 1, 2, lo);
        g.rect(x + 2, y, 1, 2, lo);
      } else {
        // small near flake: a soft 2x2, lit from the top-left
        g.rect(x, y, 1, 1, hi);
        g.rect(x + 1, y, 1, 1, mid);
        g.rect(x, y + 1, 1, 1, mid);
        g.rect(x + 1, y + 1, 1, 1, lo);
      }
    }
  }

  // ------------------------------------------------------------------
  // falling things with two-frame flips (leaves, petals)
  // frames: lists of [dx, dy, tone]; tone 0 dark (the stem) .. 2 light.
  // `seed` is the frame's darkest pixel (the stem): a leaf fades in and out
  // as that single pixel.
  // ------------------------------------------------------------------
  function parse(rows) {
    const a = [];
    let w = 0;
    for (const r of rows) w = Math.max(w, r.length);
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch >= '0' && ch <= '2') a.push([x, y, +ch]);
      }
    return { a, w, h: rows.length };
  }
  /** mirrored and one tone darker: the back of the leaf */
  const back = (a, w) => a.map((p) => [w - 1 - p[0], p[1], Math.max(0, p[2] - 1)]);
  function finish(fr, w, h) {
    const ox = (w - 1) >> 1;
    const oy = (h - 1) >> 1;
    let s = 0;
    for (let k = 0; k < fr.length; k++) {
      fr[k][0] -= ox;
      fr[k][1] -= oy;
      const q = fr[k];
      const p = fr[s];
      if (q[2] < p[2] || (q[2] === p[2] && q[1] > p[1])) s = k;
    }
    fr.seed = fr[s];
    return fr;
  }
  const outline = (a) => {
    let mx = 1e9;
    for (const p of a) mx = Math.min(mx, p[0]);
    return a
      .map((p) => p[0] - mx + ',' + p[1])
      .sort()
      .join(' ');
  };
  const tones = (a) => new Set(a.map((p) => p[2])).size;
  /** init-time check: the flip must change the outline, and both faces keep 2+ tones */
  function assertShape(a, b, rows) {
    if (outline(a) === outline(b)) throw new Error('weather-seasons: shape ' + rows.join('/') + ' is mirror-symmetric, so its flip would not show');
    if (tones(a) < 2 || tones(b) < 2) throw new Error('weather-seasons: shape ' + rows.join('/') + ' needs 2+ tones on both faces');
  }
  function frames(rows) {
    const { a, w, h } = parse(rows);
    const b = back(a, w);
    assertShape(a, b, rows);
    return [finish(a, w, h), finish(b, w, h)];
  }
  /** a near leaf tumbling end over end: broad face, edge-on, back, edge-on */
  function tumble(broadRows, edgeRows) {
    const A = parse(broadRows);
    const E = parse(edgeRows);
    const Ab = back(A.a, A.w);
    const Eb = back(E.a, E.w);
    assertShape(A.a, Ab, broadRows);
    assertShape(E.a, Eb, edgeRows);
    return [finish(A.a, A.w, A.h), finish(E.a, E.w, E.h), finish(Ab, A.w, A.h), finish(Eb, E.w, E.h)];
  }
  // mid leaves, 5-10 px each, all asymmetric with an off-centre stem
  const LEAF_SHAPES = [
    frames(['..22', '.211', '011.']), // long leaf, stem bottom-left
    frames(['21.', '.12', '..0']), // curled leaf, stem bottom-right
    frames(['.221', '011.']), // flat leaf side-on
    frames(['.22', '221', '10.']), // round birch leaf
    frames(['..22', '.221', '2211', '0...']), // broad ovate leaf, tilted, stem bottom-left
  ];
  // near leaves: ~8 px across, a dark body with a lit rim along the top edge
  const LEAF_TUMBLE = tumble(
    ['.....222', '...22202', '..20010.', '.200100.', '.20100..', '.2100...', '.10.....', '0.......'],
    ['........', '........', '.......2', '....2221', '..22110.', '.2110...', '210.....', '0.......'],
  );
  const PETAL = frames(['21', '.1']);
  const PETAL_SMALL = frames(['2.', '.1']); // a petal edge-on, tilting as it turns
  function drawFrame(g, fr, x, y, tab, li) {
    for (let k = 0; k < fr.length; k++) {
      const p = fr[k];
      g.rect(x + p[0], y + p[1], 1, 1, tab[p[2]][li]);
    }
  }
  /** [tone][family*7+level] tables from three cold tones; .dk is a darker fourth */
  function toneTab(c0, c1, c2, warm, kmax) {
    const tab = [famSteps(warmSteps, c0, warm, kmax * 0.8), famSteps(warmSteps, c1, warm, kmax), famSteps(warmSteps, c2, warm, kmax)];
    tab.dk = famSteps(warmSteps, mix(c0, P.night[1], 0.45), warm, kmax * 0.6);
    return tab;
  }
  /** one step dimmer (far, just detached): still three tones */
  const dimTab = (tab) => [tab.dk, tab[0], tab[1]];
  /** resting on the ground: two dark tones */
  const restTab = (tab) => [tab.dk, tab.dk, tab[0]];

  // leaf hues at night (they warm to fiery orange near the fire and lanterns).
  // More red, gold and yellow than orange, so they never pass for sparks.
  const LEAF_HUES = [
    toneTab(P.autumn[3], P.autumn[5], P.autumn[6], P.fire[7], 0.6), // rust-orange
    toneTab(P.autumn[4], P.autumn[6], P.gold[5], P.fire[8], 0.6), // gold
    toneTab(P.red[3], P.red[4], P.red[5], P.fire[6], 0.55), // red
    toneTab(P.autumn[2], P.autumn[4], P.autumn[5], P.fire[6], 0.55), // russet
    toneTab(P.gold[2], P.gold[3], P.gold[4], P.fire[8], 0.55), // yellow
    toneTab(P.red[2], P.red[3], mix(P.red[4], P.autumn[6], 0.4), P.fire[6], 0.55), // crimson
  ];
  const LEAF_PICK = [2, 2, 5, 5, 1, 1, 4, 4, 3, 0]; // weighted hue choice
  const LEAF_DIM = LEAF_HUES.map(dimTab);
  const LEAF_REST = LEAF_HUES.map(restTab);
  const LEAF_NEAR = [
    toneTab(P.red[1], P.red[3], P.red[5], P.fire[6], 0.5), // crimson, rim catching the light
    toneTab(P.autumn[0], P.autumn[2], P.gold[4], P.fire[7], 0.5), // dark russet with a gold rim
    toneTab(mix(P.red[1], P.autumn[0], 0.5), P.autumn[3], P.autumn[7], P.fire[7], 0.5), // brown with an amber rim
  ];

  const PETAL_PINK = toneTab(P.blossom[4], P.blossom[6], P.blossom[7], P.amber[7], 0.5);
  const PETAL_PINK2 = toneTab(P.blossom[4], P.blossom[5], P.blossom[6], P.amber[7], 0.5);
  // red plum petals: bright enough to read against the navy sky and dark branches
  const PETAL_PLUM = toneTab(P.plum[4], P.plum[5], P.blossom[7], P.amber[6], 0.45);
  const PETAL_PLUM2 = toneTab(mix(P.plum[4], P.red[4], 0.5), mix(P.plum[5], P.red[5], 0.4), mix(P.blossom[7], P.plum[5], 0.3), P.amber[6], 0.45);

  // ------------------------------------------------------------------
  // CROWN: points well inside the foliage clumps of each tree (traced from the
  // props tree: pixels that stay leafy through the sway, >= 7 px apart; plum
  // = the blossom sprays, lanterns excluded). Leaves and petals detach here.
  // Anchors on the moon disc are dropped: nothing starts on the focal point.
  // ------------------------------------------------------------------
  const CROWN = {
    autumn: [
      418,1, 338,2, 427,2, 327,3, 355,6, 416,8, 342,10, 376,10, 423,10, 441,11, 449,14, 352,15, 418,15, 338,16,
      345,17, 433,18, 441,18, 451,21, 364,22, 419,22, 427,22, 340,23, 350,23, 357,23, 434,27, 443,27, 345,28, 415,28,
      423,28, 361,29, 352,32, 429,32, 436,34, 444,34, 362,38, 347,40, 372,42, 355,43, 437,43, 461,43, 363,49, 426,50,
      434,50, 441,50, 351,51, 460,51, 370,53, 357,56, 429,57, 369,60, 362,61, 457,61, 352,62, 424,62, 432,64, 369,68,
      466,68, 339,71, 363,72, 384,73, 334,77, 346,77, 448,77, 455,77, 379,78, 353,79, 386,80, 435,80, 347,84, 447,84,
      354,86, 374,86, 381,86, 439,87, 468,88, 433,91, 360,92, 444,92, 476,92, 368,93, 376,94, 426,95, 383,96, 431,100,
      475,100, 365,101, 468,101, 440,106, 471,108, 446,110, 434,111, 341,112, 477,112, 463,114, 470,115, 454,116, 333,117, 434,122,
      442,122, 465,122, 449,123, 457,123, 337,124, 345,124, 325,126, 438,128, 431,129, 445,129, 348,131, 339,133, 325,135, 435,135,
      353,136, 425,140, 442,141, 435,142, 354,143, 342,146, 363,148, 355,150, 371,151,
    ],
    blossom: [
      427,1, 340,2, 357,6, 421,6, 379,8, 438,11, 342,12, 352,14, 450,14, 429,15, 347,20, 357,20, 364,20, 433,21,
      449,22, 388,26, 352,28, 434,28, 364,29, 419,30, 449,30, 365,36, 439,37, 447,37, 423,40, 370,41, 460,41, 440,44,
      363,47, 465,47, 430,48, 369,53, 361,54, 376,55, 439,57, 354,59, 458,59, 361,61, 370,62, 434,63, 467,67, 367,69,
      409,70, 338,71, 395,71, 352,72, 454,73, 382,77, 391,77, 358,78, 441,78, 448,78, 359,85, 440,85, 449,85, 433,86,
      467,86, 383,87, 366,90, 373,91, 445,91, 424,92, 477,93, 380,95, 470,100, 477,102, 444,107, 470,107, 478,111, 343,112,
      449,112, 464,115, 337,116, 454,117, 444,121, 325,126, 346,126, 432,126, 442,128, 328,133, 347,133, 433,134, 354,135, 440,135,
      359,142, 367,147, 377,148,
    ],
    plum: [
      324,3, 356,4, 420,4, 378,8, 416,8, 338,11, 425,12, 417,13, 449,13, 353,15, 361,16, 421,17, 429,17, 343,18,
      368,18, 444,19, 349,20, 355,20, 426,20, 431,21, 346,23, 418,23, 444,23, 362,24, 387,27, 432,27, 446,27, 348,28,
      358,28, 415,28, 364,30, 436,31, 349,32, 357,32, 415,32, 443,35, 413,36, 357,37, 440,38, 353,41, 372,41, 412,41,
      459,41, 363,42, 438,44, 414,46, 362,48, 410,48, 441,48, 457,48, 401,49, 446,49, 435,50, 461,52, 359,53, 401,53,
      432,53, 369,55, 404,56, 430,59, 351,60, 360,60, 399,60, 459,61, 356,62, 402,63, 429,63, 348,64, 362,64, 396,64,
      351,67, 393,67, 427,67, 461,67, 465,68, 363,70, 409,71, 389,72, 427,72, 337,73, 454,73, 364,75, 350,76, 355,77,
      386,77, 448,78, 381,79, 439,79, 346,81, 366,82, 446,82, 353,83, 378,83, 438,85, 442,85, 364,87, 425,88, 470,88,
      369,89, 377,90, 361,91, 420,91, 430,91, 372,92, 442,92, 425,93, 479,94, 375,95, 361,96, 429,97, 476,100, 469,101,
      479,103, 442,107, 476,107, 473,110, 417,111, 441,111, 446,112, 340,113, 471,114, 465,116, 337,119, 455,119, 459,119, 379,123,
      461,123, 450,124, 342,126, 339,129, 345,129, 327,130, 439,130, 344,133, 435,134, 350,135, 428,137, 354,138, 357,141, 424,142,
      348,143, 438,143, 341,144, 360,146, 431,146, 367,155,
    ],
  };
  const MOON_R = { full: LY.moon.r, harvest: 22, crescent: 14 };
  /** this edition's crown anchors as a flat [x, y, ...] list (null: no foliage) */
  const crownAnchors = HD.perEdition((ed) => {
    const src = CROWN[ed.tree];
    if (!src) return null;
    const mr = MOON_R[ed.moon] ? MOON_R[ed.moon] + 2 : 0;
    const out = [];
    for (let k = 0; k + 1 < src.length; k += 2) {
      const dx = src[k] - LY.moon.x;
      const dy = src[k + 1] - LY.moon.y;
      if (mr && dx * dx + dy * dy < mr * mr) continue;
      out.push(src[k], src[k + 1]);
    }
    return out.length ? out : null;
  });

  const FADE_IN = 0.3; // s: only the stem pixel shows while a leaf detaches
  const FADE_OUT = 0.5; // s: one darker pixel on the ground before it is gone

  /**
   * One leaf/petal falling from the canopy: it detaches from a foliage clump,
   * drifts with the wind, swings like a pendulum (rising a touch at each end
   * of the swing, the swing growing as it leaves the branch), flips at each
   * swing, then lies on the ground for a moment and fades away.
   */
  function faller(g, t, i, o, seed) {
    const c = T.cycle(t, i, o.per[i], seed);
    const age = c.age;
    const fall = o.fall;
    const A = crownAnchors();
    let x0;
    let y0;
    if (A) {
      const k = ((c.rnd(0) * (A.length >> 1)) | 0) << 1;
      x0 = A[k] + ((c.rnd(12) * 3) | 0) - 1;
      y0 = A[k + 1] + ((c.rnd(13) * 3) | 0) - 1;
    } else {
      x0 = o.x0 + c.rnd(0) * o.xw;
      y0 = o.y0 + c.rnd(1) * o.yh;
    }
    const d = c.rnd(2);
    const yl = G0 + 1 + d * (G1 - 3 - G0);
    const drift = o.drift0 + c.rnd(3) * o.drift1;
    const amp = o.amp0 + c.rnd(4) * o.amp1;
    const nsw = o.sw0 + c.rnd(5) * o.sw1;
    const ph = c.rnd(6);
    const hue = o.pick ? o.pick[(c.rnd(8) * o.pick.length) | 0] : (c.rnd(8) * o.hues.length) | 0;
    const shape = o.shapes[(c.rnd(9) * o.shapes.length) | 0];
    const spin = c.rnd(10) < o.spinP ? o.spin0 + c.rnd(11) * o.spin1 : 0;
    const ts = age * c.P;
    const tl = (1 - age) * c.P;
    let x;
    let y;
    let f;
    let tab;
    if (age < fall) {
      const s = age / fall;
      const phi = TAU * (nsw * s + ph);
      const sw = sin(phi);
      const e = HD.smoothstep(0, 0.12, s); // the swing grows as it leaves the branch
      x = x0 + drift * s + amp * e * sw;
      y = y0 + (yl - y0) * s - o.lift * e * sw * sw;
      f = cos(phi) > 0 ? 0 : 1;
      if (spin) f ^= Math.floor(ts * spin) & 1;
      tab = s < 0.05 || (d < 0.25 && !o.noDim) ? o.dim[hue] : o.hues[hue];
    } else {
      // resting where it landed (the last pose of the fall), then gone
      x = x0 + drift + amp * sin(TAU * (nsw + ph));
      y = yl;
      f = 0;
      tab = (age - fall) / (1 - fall) > 0.55 ? o.rest[hue] : o.dim[hue];
    }
    x = R(x);
    y = R(y);
    if (x < -4 || x > W + 3) return;
    const fr = shape[f];
    if (ts < FADE_IN || tl < FADE_OUT) {
      const p = fr.seed;
      g.rect(x + p[0], y + p[1], 1, 1, (ts < FADE_IN ? o.hues[hue][0] : o.hues[hue].dk)[lightIdx(x, y, 1)]);
      return;
    }
    drawFrame(g, fr, x, y, tab, lightIdx(x, y, 1));
  }

  /** a leaf blown in from the woods on the left, gusting across the yard */
  function traveller(g, t, i, o, seed) {
    const c = T.cycle(t, i, o.per[i], seed);
    const age = c.age;
    const fall = o.fall;
    const y0 = o.y0 + c.rnd(1) * o.yh;
    const d = c.rnd(2);
    const yl = G0 + 1 + d * (G1 - 3 - G0);
    const xl = o.xl0 + c.rnd(0) * o.xl1;
    const hue = o.pick[(c.rnd(8) * o.pick.length) | 0];
    const shape = o.shapes[(c.rnd(9) * o.shapes.length) | 0];
    const spin = o.spin0 + c.rnd(11) * o.spin1;
    const ph = c.rnd(6);
    let x;
    let y;
    let f;
    let tab;
    if (age < fall) {
      const s = age / fall;
      // a gust: quick across the top, settling as the wind drops
      const u = 1 - (1 - s) * (1 - s);
      const bob = sin(TAU * (2.2 * s + ph));
      x = -6 + (xl + 6) * u + 2 * bob;
      y = y0 + (yl - y0) * Math.pow(s, 1.7) - 3 * bob * (1 - s);
      f = Math.floor(age * c.P * spin * (1.2 - s)) & 1;
      tab = o.hues[hue];
    } else {
      x = xl + 2 * sin(TAU * (2.2 + ph));
      y = yl;
      f = 0;
      tab = (age - fall) / (1 - fall) > 0.55 ? o.rest[hue] : o.dim[hue];
    }
    x = R(x);
    y = R(y);
    const fr = shape[f];
    if ((1 - age) * c.P < FADE_OUT) {
      const p = fr.seed;
      g.rect(x + p[0], y + p[1], 1, 1, o.hues[hue].dk[lightIdx(x, y, 1)]);
      return;
    }
    drawFrame(g, fr, x, y, tab, lightIdx(x, y, 1));
  }

  // ---- leaves (harvest) ----
  const LEAF_TREE_N = 34;
  const LEAF_TRAV_N = 16; // 13 at harvest's 0.8: the wind carries leaves across the whole yard
  const LEAF_NEAR_N = 3;
  const LEAF_TREE = {
    per: perArr(LEAF_TREE_N, 14, 20, 9401),
    fall: 0.86,
    x0: TREE.x - 68, // only used if a tree has no crown anchors
    xw: 136,
    y0: 36,
    yh: 112,
    drift0: 6,
    drift1: 26,
    amp0: 4,
    amp1: 7,
    sw0: 1.4,
    sw1: 1.8,
    lift: 2.2,
    spinP: 0.35,
    spin0: 3,
    spin1: 3,
    shapes: LEAF_SHAPES,
    hues: LEAF_HUES,
    pick: LEAF_PICK,
    dim: LEAF_DIM,
    rest: LEAF_REST,
  };
  const LEAF_TRAV = {
    per: perArr(LEAF_TRAV_N, 13, 18, 9402),
    fall: 0.88,
    y0: 112,
    yh: 70,
    xl0: 30,
    xl1: 300,
    spin0: 3,
    spin1: 4,
    shapes: LEAF_SHAPES,
    hues: LEAF_HUES,
    pick: LEAF_PICK,
    dim: LEAF_DIM,
    rest: LEAF_REST,
  };
  // near leaves drift past the camera slowly (~36 px/s) and are on screen
  // about half the time each
  const LEAF_NEAR_P = perArr(LEAF_NEAR_N, 24, 32, 9403);
  const NEAR_ON = 0.5;

  function leavesMid(g, t, k) {
    const nt = R(LEAF_TREE_N * k);
    for (let i = 0; i < nt; i++) faller(g, t, i, LEAF_TREE, 9401);
    const nv = R(LEAF_TRAV_N * k);
    for (let i = 0; i < nv; i++) traveller(g, t, i, LEAF_TRAV, 9402);
  }
  function leavesNear(g, t, k) {
    const n = Math.max(1, R(LEAF_NEAR_N * k));
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, LEAF_NEAR_P[i], 9403);
      const age = c.age;
      // only crosses during the first half of its life, then rests off-screen
      if (age > NEAR_ON) continue;
      const s = age / NEAR_ON;
      const y0 = 92 + c.rnd(1) * 86;
      const ph = c.rnd(6);
      const x = R(-12 + (W + 24) * s + 4 * sin(TAU * (1.5 * s + ph)));
      const y = R(y0 + 46 * s * s + 7 * sin(TAU * (1.5 * s + ph + 0.25)));
      const f = Math.floor(age * c.P * (2.4 + c.rnd(11) * 1.4)) & 3;
      const tab = LEAF_NEAR[(c.rnd(8) * LEAF_NEAR.length) | 0];
      drawFrame(g, LEAF_TUMBLE[f], x, y, tab, lightIdx(x, y, 1));
    }
  }

  // ---- petals (spring blossom, lunar plum) ----
  const PETAL_N = 70;
  const PETALS = {
    per: perArr(PETAL_N, 15, 22, 9501),
    fall: 0.88,
    x0: TREE.x - 66,
    xw: 132,
    y0: 40,
    yh: 104,
    drift0: 4,
    drift1: 22,
    amp0: 3,
    amp1: 5,
    sw0: 1.6,
    sw1: 2.2,
    lift: 1.5,
    spinP: 0.5,
    spin0: 1.5,
    spin1: 2.5,
    shapes: [PETAL, PETAL, PETAL_SMALL],
    hues: [PETAL_PINK, PETAL_PINK2],
    dim: [dimTab(PETAL_PINK), dimTab(PETAL_PINK2)],
    rest: [restTab(PETAL_PINK), restTab(PETAL_PINK2)],
  };
  // lunar: a few red plum petals, always the full 3px petal, never dimmed in the air
  const PLUMS = Object.assign({}, PETALS, {
    shapes: [PETAL],
    hues: [PETAL_PLUM, PETAL_PLUM2],
    dim: [dimTab(PETAL_PLUM), dimTab(PETAL_PLUM2)],
    rest: [restTab(PETAL_PLUM), restTab(PETAL_PLUM2)],
    noDim: true,
  });
  function petalsMid(g, t, k, plum) {
    const n = plum ? Math.min(PETAL_N, Math.max(8, R(140 * k))) : Math.max(1, R(PETAL_N * k));
    const o = plum ? PLUMS : PETALS;
    for (let i = 0; i < n; i++) faller(g, t, i, o, 9501);
  }
  // a couple of petals drifting right past the camera (2x2, soft)
  const PETAL_NEAR_P = perArr(3, 12, 16, 9502);
  function petalsNear(g, t, k, plum) {
    const n = k > 0.5 ? 3 : 1;
    const tab = plum ? PETAL_PLUM : PETAL_PINK;
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, PETAL_NEAR_P[i], 9502);
      const age = c.age;
      if (age > 0.55) continue;
      const s = age / 0.55;
      const y0 = 100 + c.rnd(1) * 70;
      const ph = c.rnd(6);
      const x = R(-8 + (W + 16) * s + 5 * sin(TAU * (1.2 * s + ph)));
      const y = R(y0 + 60 * s + 7 * sin(TAU * (1.2 * s + ph + 0.3)));
      const li = lightIdx(x, y, 1);
      const f = Math.floor(age * c.P * 2.2) & 1;
      if (f) {
        g.rect(x, y, 2, 1, tab[1][li]);
        g.rect(x + 1, y + 1, 1, 1, tab[0][li]);
      } else {
        g.rect(x, y, 2, 2, tab[1][li]);
        g.rect(x, y, 1, 1, tab[2][li]);
        g.rect(x + 1, y + 1, 1, 1, tab[0][li]);
      }
    }
  }

  // ------------------------------------------------------------------
  // FIREFLIES: wander on smooth loop-safe noise, blink slowly (quick rise,
  // long fade, mostly dark). A few aggregated lights glow over the meadow.
  // ------------------------------------------------------------------
  const FF_N = 56;
  const FF = [];
  const FF_ZONES = [
    { x: 26, y: 200 },
    { x: 180, y: 224 },
    { x: 280, y: 222 },
    { x: 340, y: 206 },
    { x: 412, y: 150 },
    { x: 446, y: 222 },
  ];
  for (let i = 0; i < FF_N; i++) {
    const h = (k) => hash(i, k, 9601);
    let kind;
    let hx;
    let hy;
    let ax;
    let ay;
    const fireX = LY.campfire.x;
    if (i < 26) {
      kind = 0; // low over the meadow; the bonfire would drown them, so keep clear of it
      hx = 8 + h(1) * 464;
      if (Math.abs(hx - fireX) < 44) hx = fireX + 44 + h(8) * 70;
      hy = 200 + h(2) * 32;
      ax = 10 + h(3) * 10;
      ay = 3 + h(4) * 4;
    } else if (i < 34) {
      kind = 0; // higher, against the dark hedges either side of the house
      hx = h(1) < 0.4 ? 6 + h(9) * 40 : 306 + h(9) * 40;
      hy = 166 + h(2) * 30;
      ax = 8 + h(3) * 8;
      ay = 5 + h(4) * 5;
    } else if (i < 48) {
      kind = 1; // around the tree
      hx = TREE.x - 55 + h(1) * 110;
      hy = 96 + h(2) * 100;
      ax = 8 + h(3) * 8;
      ay = 6 + h(4) * 8;
    } else {
      kind = 2; // far: over the distant fields, behind the house
      hx = h(1) * 480;
      hy = 188 + h(2) * 12;
      ax = 6 + h(3) * 6;
      ay = 1.5;
    }
    let zone = 0;
    let best = 1e9;
    FF_ZONES.forEach((z, k) => {
      const dd = (z.x - hx) ** 2 + (z.y - hy) ** 2 * 2;
      if (dd < best) {
        best = dd;
        zone = k;
      }
    });
    FF.push({
      kind,
      hx,
      hy,
      ax,
      ay,
      pw: 7 + h(5) * 6,
      pb: 3.2 + h(6) * 3.6,
      ob: h(7),
      s: i * 7 + 3,
      zone,
    });
  }
  const FF_X = new Float64Array(FF_N);
  const FF_Y = new Float64Array(FF_N);
  const FF_E = new Float64Array(FF_N);
  /** position and blink envelope of every firefly at t */
  function ffState(t, n) {
    for (let i = 0; i < n; i++) {
      const f = FF[i];
      FF_X[i] = f.hx + f.ax * (2 * T.noise(t, f.pw, f.s) - 1) + 2 * T.wave(t, f.pw * 0.37, f.ob);
      FF_Y[i] = f.hy + f.ay * (2 * T.noise(t, f.pw * 1.3, f.s + 1) - 1) + 1.2 * T.wave(t, f.pw * 0.29, f.ob + 0.3);
      const ph = T.phase(t, f.pb, f.ob);
      FF_E[i] = ph < 0.14 ? ph / 0.14 : ph < 0.56 ? 1 - (ph - 0.14) / 0.42 : 0;
    }
  }
  const FFC = P.firefly;
  /** one firefly at envelope e (>= 0.12): a dim dot, a soft glow, or full bloom */
  function flyPx(g, x, y, e) {
    if (e > 0.62) {
      // full glow: a soft yellow-green bloom, a white-hot core and a plus of light
      HD.glow(g, x, y, 7, HD.LIGHT.firefly, 0.5 * e);
      g.rect(x - 1, y, 3, 1, FFC[2]);
      g.rect(x, y - 1, 1, 3, FFC[2]);
      g.rect(x, y, 1, 1, FFC[4]);
    } else if (e > 0.34) {
      HD.glow(g, x, y, 4, HD.LIGHT.firefly, 0.4 * e);
      g.rect(x, y, 1, 1, FFC[3]);
    } else {
      g.rect(x, y, 1, 1, FFC[e > 0.22 ? 2 : 1]);
    }
  }
  /** a small firefly (resting in the grass, or hovering over the cake): a tight glow, never the big bloom */
  function flySmall(g, x, y, e) {
    if (e > 0.45) {
      HD.glow(g, x, y, 4, HD.LIGHT.firefly, 0.5 * e);
      g.rect(x, y, 1, 1, FFC[4]);
    } else if (e > 0.27) {
      HD.glow(g, x, y, 3, HD.LIGHT.firefly, 0.35 * e);
      g.rect(x, y, 1, 1, FFC[3]);
    } else {
      g.rect(x, y, 1, 1, FFC[e > 0.18 ? 2 : 1]);
    }
  }
  function fireflies(g, t, k, far) {
    const n = R(FF_N * k);
    ffState(t, n);
    for (let i = 0; i < n; i++) {
      const f = FF[i];
      if ((f.kind === 2) !== far) continue;
      const e = FF_E[i];
      if (e < 0.12) continue;
      const x = R(FF_X[i]);
      const y = R(FF_Y[i]);
      if (far) {
        g.rect(x, y, 1, 1, e > 0.6 ? FFC[2] : FFC[1]);
        continue;
      }
      flyPx(g, x, y, e);
    }
  }
  // One light per zone, centred on the flies that are lit right now (so the
  // pool follows the blinks, clamped near the zone), with a soft saturating
  // strength instead of a hard cap and a gentle edge.
  const ZSUM = new Float64Array(FF_ZONES.length);
  const ZX = new Float64Array(FF_ZONES.length);
  const ZY = new Float64Array(FF_ZONES.length);
  const ZONE_DX = 14;
  const ZONE_DY = 9;
  function fireflyLights(t, L, k) {
    const n = R(FF_N * k);
    ffState(t, n);
    ZSUM.fill(0);
    ZX.fill(0);
    ZY.fill(0);
    for (let i = 0; i < n; i++) {
      if (FF[i].kind === 2) continue;
      const z = FF[i].zone;
      const e = FF_E[i];
      ZSUM[z] += e;
      ZX[z] += e * FF_X[i];
      ZY[z] += e * FF_Y[i];
    }
    for (let z = 0; z < FF_ZONES.length; z++) {
      const s = ZSUM[z];
      const i = 0.13 * (1 - Math.exp(-0.4 * s));
      if (i < 0.01) continue;
      const zn = FF_ZONES[z];
      const x = HD.clamp(ZX[z] / s, zn.x - ZONE_DX, zn.x + ZONE_DX);
      const y = HD.clamp(ZY[z] / s, zn.y - ZONE_DY, zn.y + ZONE_DY);
      L.add({ x: R(x), y: R(y), r: 42, ry: 30, color: HD.LIGHT.firefly, i, bands: 5, pow: 2.2 });
    }
  }

  // ------------------------------------------------------------------
  // SUMMER STORY fireflies (edition.story). SUMMER.md: fireflies in match,
  // dc and home only; every other chapter is a clear, dry night, so a story
  // chapter without an entry in STORY_FF draws none (whatever its
  // weather.fireflies says). The same bugs as Midsummer, but laid out per
  // chapter around the family and the chapter's props (never over a cat),
  // with no far layer (the backdrop is a city now). Each one climbs a little
  // while it glows (the firefly "J" stroke), a few rest on grass blades and
  // glow softly, and each chapter has one small moment:
  //   match  the goal: the yard dims, a little cheer of fireflies rises from
  //          the grass in front of the porch, and flashes ripple out from
  //          there across the yard and up into the tree
  //   dc     candles out: the fireflies nearest the table come in one by one
  //          and hover where the flames were, and drift off again as the
  //          candles are relit
  //   home   one visits the niece and lights up just as she reaches for it
  // Counts follow edition.weather.fireflies (56 at 1.0). Story timing comes
  // from the shared HD.summer helpers (never copied numbers).
  // ------------------------------------------------------------------
  const SU = LY.summer;
  const STEPS = LY.house.steps;
  // groups: [weight, x0, x1, y0, y1, kind]  m meadow, t tree (homes on
  //         SUMMER_CROWN, the box is unused), h hedge line, r resting in the grass
  // avoid:  [x0, y0, x1, y1] that no firefly's wander may enter
  // zones:  ground light pools (one L.add each, fixed where its fireflies live)
  const FLAG = [26, 166, 66, 198]; // the US flag on its pole (props)
  const MOON_BOX = [372, 24, 426, 80];
  // every ground firefly keeps its whole wander below the skyline's base, so a
  // dim firefly never passes for a lit window in the city behind
  const YARD_TOP = 196;
  const MIN_GAP = 10; // px between home positions (8 when a group is crowded)
  // Leafy points of the props summer tree, traced from the rendered canopy:
  // every pixel within 6 px across and 5 px up or down stays leaf through the
  // sway in match, dc and home; nothing on the moon; the lowest at y 139, so no
  // tree firefly dips below y 144 towards the skyline. Tree fireflies live here
  // and wander only a few px, so they always glow against leaves, never sky.
  const SUMMER_CROWN = [
    357,76, 361,76, 351,77, 354,80, 358,80, 432,80, 436,81, 440,81, 444,81, 448,81, 362,82, 353,84, 357,84, 432,84,
    436,85, 440,85, 361,86, 425,86, 429,87, 365,88, 433,88, 422,89, 437,89, 369,90, 426,90, 430,91, 372,93, 376,93,
    368,94, 473,110, 470,113, 467,116, 449,125, 436,127, 445,128, 432,129, 440,129, 436,131, 443,132, 430,133, 347,134, 439,134,
    434,135, 352,137, 429,137, 437,138, 433,139,
  ];
  // tree light pools: the left and right halves of the canopy
  const TREE_ZONES = [[362, 88], [440, 120]];
  // wander per kind: ax/ay [base, random], wx/wy the extra sway, jr the J climb
  const KIND = {
    m: { ax: [6, 6], ay: [3, 2], wx: 2, wy: 1.2, jr: [2, 1.5] },
    h: { ax: [6, 4], ay: [2, 1], wx: 2, wy: 1, jr: [1.5, 0] },
    t: { ax: [3, 1], ay: [2, 0.5], wx: 1, wy: 0.8, jr: [1.2, 0.6] },
    r: { ax: [0, 0], ay: [0, 0], wx: 0, wy: 0, jr: [0, 0] },
  };
  const STORY_FF = {
    match: {
      seed: 9701,
      groups: [
        [10, 8, 190, 206, 234, 'm'], // the left meadow round the flagpole
        [4, 294, 340, 206, 236, 'm'], // between the niece's ball and the garden
        [3, 70, 160, 200, 208, 'h'], // along the back of the yard
        [7, 0, 0, 0, 0, 't'],
        [6, 340, 474, 202, 228, 'm'], // over the garden
        [6, 8, 470, 213, 236, 'r'],
      ],
      // you + partner on the porch steps; the niece by her ball
      avoid: [FLAG, [196, 184, 250, 217], [250, 216, 292, 238]],
      zones: [[44, 220], [130, 216], [322, 222], [398, 216], [452, 220]],
      ripple: true,
    },
    // nyc: none (SUMMER.md). If the story ever wants the circling pair by the
    // anniversary bench, add: nyc: { seed: 9702, groups: [], avoid: [], zones: [], pair: true }
    dc: {
      seed: 9703,
      groups: [
        [4, 8, 46, 206, 234, 'm'], // the left meadow
        [3, 44, 70, 206, 232, 'm'], // close by the party: these come to the cake
        [3, 6, 72, 200, 208, 'h'],
        [3, 156, 178, 210, 234, 'm'], // close by the party, right
        [4, 178, 250, 210, 236, 'm'], // past the steps
        [4, 250, 318, 212, 236, 'm'],
        [7, 0, 0, 0, 0, 't'],
        [5, 318, 474, 204, 230, 'm'], // over the garden, under the balloons
        [6, 8, 470, 213, 236, 'r'],
      ],
      // the whole party round the table; the balloon bunches on the fence
      avoid: [FLAG, [74, 184, 152, 238], [316, 164, 348, 204], [406, 164, 438, 204]],
      zones: [[40, 220], [196, 222], [284, 224], [398, 218], [454, 220]],
      gather: true,
    },
    home: {
      seed: 9704,
      groups: [
        [11, 8, 180, 204, 234, 'm'],
        [5, 240, 318, 212, 236, 'm'],
        [4, 70, 160, 200, 208, 'h'],
        [7, 0, 0, 0, 0, 't'],
        [6, 318, 474, 202, 228, 'm'],
        [7, 8, 470, 213, 236, 'r'],
      ],
      // the niece's spot below the steps and her way to and from the door
      avoid: [FLAG, [184, 194, 234, 228]],
      zones: [[44, 220], [128, 216], [280, 226], [370, 214], [446, 220]],
      friend: true,
    },
  };

  // ---- shared story timing (HD.summer), found once from the helpers ----
  /** [start, end] (s) of a HD.summer window helper (0..1 progress inside, -1 outside) */
  function winOf(fn) {
    for (let s = 0; s < HD.LOOP; s += 0.25) {
      const p = fn(s);
      const p2 = fn(s + 0.1);
      if (p < 0 || !(p2 > p)) continue;
      const len = 0.1 / (p2 - p);
      return [s - p * len, s - p * len + len];
    }
    return null;
  }
  const WIN = {};
  const winFor = (k) => (WIN[k] === undefined ? (WIN[k] = winOf(HD.summer[k])) : WIN[k]);
  /** signed seconds from `a` to the loop time s, in (-LOOP/2, LOOP/2] */
  function since(s, a) {
    const L = HD.LOOP;
    const r = s - a;
    return r - Math.floor(r / L + 0.5) * L;
  }

  // DC: where the gathered fireflies hover, relative to the middle candle's
  // wick (props: the table top is base - 10, the wicks 9 px above it, the
  // candles 3 px apart): just over each wick, where the little flames were,
  // plus two a touch higher at the sides
  const TBL = SU.table;
  const CAKE_X = TBL.x;
  const WICK_Y = TBL.base - 19;
  const HOVER = [[-6, -5], [-3, -2], [0, -3], [3, -2], [6, -6]]; // sorted by x
  const GATHER_NEAR = 48; // px from the table: only these fireflies come in
  const G_IN = 5; // s to fly in
  const G_OUT = 3.5; // s to drift off
  const G_STAGGER = 0.5; // s between arrivals

  // Match: the cheer, little fireflies that rise from the grass in front of
  // the porch as the goal goes in (clear of the pair on the steps and the niece)
  const CHEER = [[154, 222], [168, 226], [182, 220], [194, 228], [207, 230], [221, 231], [235, 228], [246, 232]];
  // their light pool: at their middle, a little above where they start (they rise ~7 px)
  const CHEER_POOL = [R(CHEER.reduce((a, c) => a + c[0], 0) / CHEER.length), R(CHEER.reduce((a, c) => a + c[1], 0) / CHEER.length) - 4];

  const storyFlies = HD.perEdition((ed) => {
    const cfg = STORY_FF[ed.id];
    if (!ed.story || !cfg) return null;
    const rnd = HD.rng(cfg.seed);
    const total = R(FF_N * (ed.weather.fireflies || 0));
    let wsum = 0;
    for (const gr of cfg.groups) wsum += gr[0];
    const flies = [];
    const spaced = (hx, hy, gap) => flies.every((f) => (f.hx - hx) ** 2 + (f.hy - hy) ** 2 >= gap * gap);
    for (const [w, x0, x1, y0, y1, kind] of cfg.groups) {
      const K = KIND[kind];
      const n = R((total * w) / wsum);
      for (let j = 0; j < n; j++) {
        const ax = K.ax[0] + rnd() * K.ax[1];
        const ay = K.ay[0] + rnd() * K.ay[1];
        const jr = K.jr[0] + rnd() * K.jr[1];
        // the whole wander: noise + sway across, and up/down with the J climb
        const ex = ax + K.wx + 1;
        const eu = ay + K.wy + 0.7 * jr + 1;
        const ed2 = ay + K.wy + 0.3 * jr + 1;
        let hx = 0;
        let hy = 0;
        let ok = false;
        for (let k = 0; k < 48 && !ok; k++) {
          if (kind === 't') {
            const q = ((rnd() * (SUMMER_CROWN.length >> 1)) | 0) << 1;
            hx = SUMMER_CROWN[q];
            hy = SUMMER_CROWN[q + 1];
          } else {
            hx = x0 + rnd() * (x1 - x0);
            hy = y0 + rnd() * (y1 - y0);
          }
          const box = (a) => hx + ex >= a[0] && hx - ex <= a[2] && hy + ed2 >= a[1] && hy - eu <= a[3];
          ok = spaced(hx, hy, k < 32 ? MIN_GAP : MIN_GAP - 2) && !cfg.avoid.some(box) && !box(MOON_BOX) && (kind === 't' || hy - eu >= YARD_TOP);
        }
        if (!ok) continue;
        flies.push({
          hx,
          hy,
          ax,
          ay,
          jr,
          wx: K.wx,
          wy: K.wy,
          wob: kind === 'r' ? 0 : 1,
          rest: kind === 'r',
          tree: kind === 't',
          pw: 7 + rnd() * 6,
          pb: kind === 'r' ? 5.5 + rnd() * 4 : 3.4 + rnd() * 3.6,
          ob: rnd(),
          s: cfg.seed + flies.length * 7,
          zone: 0,
          gather: -1,
        });
      }
    }
    // light pools: ground zones, then the two canopy halves; each pool sits
    // fixed at the middle of its fireflies' homes (only its strength changes)
    const nz = cfg.zones.length;
    const anchors = cfg.zones.concat(TREE_ZONES);
    const ZS = anchors.map(() => [0, 0, 0]);
    for (const f of flies) {
      let best = 1e9;
      const lo = f.tree ? nz : 0;
      const hi = f.tree ? anchors.length : nz;
      for (let q = lo; q < hi; q++) {
        const dd = (anchors[q][0] - f.hx) ** 2 + (anchors[q][1] - f.hy) ** 2 * 2;
        if (dd < best) {
          best = dd;
          f.zone = q;
        }
      }
      const z = ZS[f.zone];
      z[0]++;
      z[1] += f.hx;
      z[2] += f.hy;
    }
    const pools = ZS.map((z, q) => (z[0] ? { x: R(z[1] / z[0]), y: R(Math.max(q < nz ? 214 : 0, z[2] / z[0])), r: 30, ry: q < nz ? 20 : 22 } : null));
    // dc: the meadow fireflies nearest the table come to the cake: three from
    // the left and two from the right, so nobody crosses the party; the left
    // ones take the left places; the nearest comes first
    if (cfg.gather) {
      const tx0 = TBL.x - (TBL.w >> 1);
      const tx1 = tx0 + TBL.w - 1;
      const dTable = (f) => Math.hypot(Math.max(0, tx0 - f.hx, f.hx - tx1), Math.max(0, WICK_Y - f.hy, f.hy - TBL.base));
      const side = (left, k) =>
        flies
          .filter((f) => !f.rest && !f.tree && f.hx < CAKE_X === left && dTable(f) <= GATHER_NEAR)
          .sort((a, b) => dTable(a) - dTable(b))
          .slice(0, k);
      const L3 = side(true, 3);
      const R2 = side(false, HOVER.length - L3.length);
      // places by x: left fireflies fill from the left, right ones from the right
      L3.slice().sort((a, b) => a.hx - b.hx).forEach((f, k) => (f.slot = k));
      R2.slice().sort((a, b) => b.hx - a.hx).forEach((f, k) => (f.slot = HOVER.length - 1 - k));
      L3.concat(R2)
        .sort((a, b) => dTable(a) - dTable(b))
        .forEach((f, k) => (f.gather = k));
    }
    const n = flies.length;
    return {
      cfg,
      flies,
      pools,
      X: new Float64Array(n),
      Y: new Float64Array(n),
      E: new Float64Array(n),
      M: new Float64Array(n),
      small: new Uint8Array(n),
      CX: new Float64Array(CHEER.length),
      CY: new Float64Array(CHEER.length),
      CE: new Float64Array(CHEER.length),
      t: NaN,
      gm: 0,
      cheer: false,
    };
  });

  SEA.storyFlies = storyFlies; // for inspection from the tools

  /** the J stroke: climbs while it glows (ph 0..0.56), sinks back while dark; continuous through the wrap */
  const jStroke = (ph) => (ph < 0.56 ? 0.3 - ph / 0.56 : HD.smoothstep(0.56, 1, ph) - 0.7);
  /** blink envelope: quick rise, long fade, mostly dark */
  const blink = (ph) => (ph < 0.14 ? ph / 0.14 : ph < 0.56 ? 1 - (ph - 0.14) / 0.42 : 0);

  // ---- match: the goal ripple ----
  // The yard dims as the goal goes in, the cheer rises in front of the porch,
  // then flashes spread out from the porch steps (~50 px/s, each flash 1.6 s,
  // so a broad ring is lit at once; a second, softer ripple follows) and the
  // usual blinking comes back once both have passed. Times are seconds after
  // HD.summer.goal starts.
  const RIPPLE_C = [(STEPS.x0 + STEPS.x1) / 2, STEPS.y0];
  const RIPPLES = [[1.0, 1], [3.4, 0.85]];
  const RIP_SPD = 50;
  const RIP_LEN = 1.6;
  const RIP_Q = 0.35; // the yard's blinking dims to this, never to black
  const RIP_HOLD = [1];
  /** flash (0..1) at goal-time g for (x, y); writes the blink damping to RIP_HOLD[0] */
  function goalRipple(g, x, y) {
    RIP_HOLD[0] = 1;
    if (g < -0.8 || g > 16) return 0;
    const d = Math.hypot(x - RIPPLE_C[0], (y - RIPPLE_C[1]) * 1.5) / RIP_SPD;
    let w = 0;
    for (const [a, k] of RIPPLES) {
      const u = g - a - d;
      if (u < 0 || u >= RIP_LEN) continue;
      w = Math.max(w, k * (u < 0.2 ? u / 0.2 : u < 0.6 ? 1 : 1 - (u - 0.6) / (RIP_LEN - 0.6)));
    }
    const back = RIPPLES[RIPPLES.length - 1][0] + d + RIP_LEN; // the last ripple has passed here
    RIP_HOLD[0] = g < 0 ? 1 - (1 - RIP_Q) * HD.smoothstep(-0.8, 0, g) : g < back ? RIP_Q : RIP_Q + (1 - RIP_Q) * HD.smoothstep(back, back + 1.6, g);
    return w;
  }
  /** the cheer fireflies at goal-time g (into S.CX/CY/CE); false when none show */
  function cheerState(t, g, S) {
    if (g < 0 || g > 9) return false;
    let any = false;
    for (let k = 0; k < CHEER.length; k++) {
      const [cx, cy] = CHEER[k];
      const a = 0.08 + 0.12 * k; // they come up one after another
      const u = (g - a) / 1.1; // rising out of the grass
      const out = (g - (5.6 + 0.15 * k)) / 1.2; // fading away (all gone before the window ends)
      let e = 0;
      if (u > 0 && out < 1) e = (0.74 + 0.14 * T.wave(t, 1.3 + 0.17 * k, k * 0.31)) * HD.smoothstep(0, 0.45, u) * (1 - HD.smoothstep(0, 1, out));
      const x = cx + 2.5 * (2 * T.noise(t, 2.4 + 0.3 * k, 9840 + k) - 1);
      const y = cy - 7 * HD.smoothstep(0, 1, Math.max(0, u)) + 1.2 * (2 * T.noise(t, 2.1 + 0.2 * k, 9850 + k) - 1);
      const w = goalRipple(g, x, y);
      e = Math.max(e, e > 0 ? w : 0);
      S.CX[k] = x;
      S.CY[k] = y;
      S.CE[k] = e;
      if (e >= 0.12) any = true;
    }
    return any;
  }

  // ---- dc: candles out ----
  /** 0..1 how far gathering firefly q has come in (HD.summer.candlesOut) */
  function gatherAmt(s, q) {
    const W0 = winFor('candlesOut');
    if (!W0) return 0;
    const g = since(s, W0[0]);
    const a = 0.3 + G_STAGGER * q;
    if (g < a || g > W0[1] - W0[0] + 3 + G_OUT) return 0;
    const back = W0[1] - W0[0] - 1.2 + 0.4 * q; // lifts off just before the candles are relit
    if (g < back) return HD.smoothstep(0, 1, (g - a) / G_IN);
    return Math.min(HD.smoothstep(0, 1, (g - a) / G_IN), 1 - HD.smoothstep(0, 1, (g - back) / G_OUT));
  }

  function storyState(t, S) {
    if (S.t === t) return; // lights() and the mid pass share one evaluation per frame
    S.t = t;
    const s = HD.summer.sec(t);
    const F = S.flies;
    const cfg = S.cfg;
    const GW = cfg.ripple ? winFor('goal') : null;
    const g = GW ? since(s, GW[0]) : -1e9;
    let gm = 0;
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      const ph = T.phase(t, f.pb, f.ob);
      let e = blink(ph);
      let x = f.hx;
      let y = f.hy;
      if (f.wob) {
        x += f.ax * (2 * T.noise(t, f.pw, f.s) - 1) + f.wx * T.wave(t, f.pw * 0.37, f.ob);
        y += f.ay * (2 * T.noise(t, f.pw * 1.3, f.s + 1) - 1) + f.wy * T.wave(t, f.pw * 0.29, f.ob + 0.3);
        y += f.jr * jStroke(ph);
      }
      let small = f.rest ? 1 : 0;
      let m = 0;
      if (f.gather >= 0) {
        m = gatherAmt(s, f.gather);
        if (m > 0) {
          const hv = HOVER[f.slot];
          const tx = CAKE_X + hv[0] + 0.8 * T.wave(t, 2.6 + 0.4 * f.gather, f.ob);
          const ty = WICK_Y + hv[1] + 0.6 * T.wave(t, 2.1 + 0.3 * f.gather, f.ob + 0.25);
          x += (tx - x) * m;
          y += (ty - y) * m;
          // a soft steady glow, like the little flames they stand in for
          const eg = 0.5 + 0.12 * T.wave(t, 1.7 + 0.25 * f.gather, f.ob + 0.5);
          e = e * (1 - m) + eg * m;
          if (m > 0.25) small = 1;
          gm += m;
        }
      }
      if (GW) {
        const w = goalRipple(g, x, y);
        e = Math.max(e * RIP_HOLD[0], w);
      }
      if (small && e > 0.6) e = 0.6;
      S.X[i] = x;
      S.Y[i] = y;
      S.E[i] = e;
      S.M[i] = m;
      S.small[i] = small;
    }
    S.gm = gm / HOVER.length;
    S.cheer = GW ? cheerState(t, g, S) : false;
  }

  // nyc (off, see STORY_FF): a pair circling each other; she answers him
  // ~0.9 s later, and now and then they skip a blink together
  function pairState(t, j) {
    const cx = 163 + 7 * (2 * T.noise(t, 31, 9811) - 1);
    const cy = 210 + 3 * (2 * T.noise(t, 23, 9812) - 1);
    const a = TAU * T.phase(t, 3.6, 0) + j * Math.PI;
    const n = T.cyclesFor(4.8);
    const u = (t * n) / HD.LOOP + 0.37; // his blinks; hers starts 0.18 of a cycle later
    const ph = j ? T.phase(t, 4.8, 0.19) : u - Math.floor(u);
    const k = Math.floor(u); // his blink (while she glows, still the one she answers)
    const on = hash(((k % n) + n) % n, 9813, 5) > 0.3; // about one blink in three is skipped
    return [cx + 3.2 * cos(a), cy + 1.3 * sin(a) + 2 * jStroke(ph), on ? blink(ph) : 0];
  }
  // home: one firefly visits the niece while she stays below the steps, and
  // lights up half a second before she reaches up for it. Her reach and her
  // spot belong to family: family.js has her reach up for the first 1.5 s of
  // an 8.5 s cycle (T.cycle slot 5, seed 63) at the end of her path, 8 px left
  // of the steps. Mirrored here in one place until family shares them (asked
  // for: an HD.summer.nieceReach(t) helper and her spot in HD.layout.summer).
  const NIECE_REACH = [5, 8.5, 63]; // family's cycle: slot, period, seed
  const KIT = [STEPS.x0 - 8, STEPS.y1 + 9];
  function friendState(t) {
    const v = HD.summer.niece(t);
    if (!v.here || v.phase !== 'stay') return null;
    const c = T.cycle(t, NIECE_REACH[0], NIECE_REACH[1], NIECE_REACH[2]);
    const tau = (c.age * c.P + 0.5) % c.P;
    const e = tau < 0.3 ? tau / 0.3 : tau < 1.9 ? 1 : tau < 2.9 ? 1 - (tau - 1.9) : 0;
    if (e <= 0) return null;
    const rise = 3 * Math.min(1, Math.max(0, (tau - 0.3) / 2.6));
    const x = KIT[0] + 1 + 2.5 * (2 * T.noise(t, 5.4, 9821) - 1);
    const y = KIT[1] - 19 + 1.2 * (2 * T.noise(t, 4.2, 9822) - 1) - rise;
    return [x, y, e];
  }

  function storyFireflies(g, t, S) {
    storyState(t, S);
    const F = S.flies;
    // resting ones first (they sit in the grass), then the flying ones
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < F.length; i++) {
        if ((F[i].rest ? 0 : 1) !== pass) continue;
        const e = S.E[i];
        if (e < 0.12) continue;
        (S.small[i] ? flySmall : flyPx)(g, R(S.X[i]), R(S.Y[i]), e);
      }
    if (S.cheer)
      for (let k = 0; k < CHEER.length; k++) if (S.CE[k] >= 0.12) flyPx(g, R(S.CX[k]), R(S.CY[k]), S.CE[k]);
    if (S.cfg.pair)
      for (let j = 0; j < 2; j++) {
        const p = pairState(t, j);
        if (p[2] >= 0.12) flyPx(g, R(p[0]), R(p[1]), p[2]);
      }
    if (S.cfg.friend) {
      const p = friendState(t);
      if (p && p[2] >= 0.12) flyPx(g, R(p[0]), R(p[1]), p[2]);
    }
  }

  // Pool strength in 4 flat steps, so a pool changes only now and then
  // (the pools never move; with 5 bands a moving pool crawls every frame).
  const POOL_I = 0.12;
  const steps4 = (k) => Math.round(4 * HD.clamp(k, 0, 1)) / 4;
  const poolK = (sum) => steps4(1 - Math.exp(-0.4 * sum));
  const SZ_S = new Float64Array(8);
  function storyLights(t, L, S) {
    storyState(t, S);
    const F = S.flies;
    const pools = S.pools;
    SZ_S.fill(0);
    for (let i = 0; i < F.length; i++) {
      const e = S.E[i];
      if (!(e > 0) || S.M[i] > 0.5) continue; // the ones over the cake are pooled there below
      SZ_S[F[i].zone] += e;
    }
    for (let z = 0; z < pools.length; z++) {
      const p = pools[z];
      const k = p ? poolK(SZ_S[z]) : 0;
      if (k > 0) L.add({ x: p.x, y: p.y, r: p.r, ry: p.ry, color: HD.LIGHT.firefly, i: POOL_I * k, bands: 5, pow: 2.2 });
    }
    // match: the cheer lights the grass in front of the porch
    if (S.cheer) {
      let sum = 0;
      for (let k = 0; k < CHEER.length; k++) sum += S.CE[k];
      const k = poolK(sum);
      if (k > 0) L.add({ x: CHEER_POOL[0], y: CHEER_POOL[1], r: 30, ry: 18, color: HD.LIGHT.firefly, i: POOL_I * k, bands: 5, pow: 2.2 });
    }
    // dc: the fireflies over the cake keep a little light on the party while the candles are out
    const gk = steps4(S.gm);
    if (gk > 0) L.add({ x: CAKE_X, y: WICK_Y - 4, r: 30, ry: 22, color: HD.LIGHT.firefly, i: 0.085 * gk, bands: 5, pow: 2 });
    if (S.cfg.pair) {
      const a = pairState(t, 0);
      const b = pairState(t, 1);
      const k = steps4((a[2] + b[2]) / 2);
      if (k > 0) L.add({ x: 163, y: 210, r: 20, ry: 14, color: HD.LIGHT.firefly, i: 0.1 * k, bands: 4, pow: 2 });
    }
    if (S.cfg.friend) {
      const p = friendState(t);
      const k = p ? steps4(p[2]) : 0;
      if (k > 0) L.add({ x: R(p[0] / 2) * 2, y: R(p[1] / 2) * 2 + 2, r: 16, ry: 12, color: HD.LIGHT.firefly, i: 0.09 * k, bands: 4, pow: 2 });
    }
  }

  // ------------------------------------------------------------------
  // hooks
  // ------------------------------------------------------------------
  SEA.far = function (g, t) {
    const ed = HD.edition;
    const w = ed.weather;
    if (w.snow > 0) snowFar(g, t, w.snow, ed.sky === 'clear');
    if (w.fireflies > 0 && !ed.story) fireflies(g, t, w.fireflies, true);
  };
  SEA.mid = function (g, t) {
    const ed = HD.edition;
    const w = ed.weather;
    if (w.snow > 0) snowMid(g, t, w.snow, ed.sky === 'clear');
    if (w.leaves > 0) leavesMid(g, t, w.leaves);
    if (w.petals > 0) petalsMid(g, t, w.petals, ed.tree === 'plum');
    if (w.fireflies > 0) {
      const S = ed.story ? storyFlies() : null;
      if (S) storyFireflies(g, t, S);
      else if (!ed.story) fireflies(g, t, w.fireflies, false);
    }
  };
  SEA.near = function (g, t) {
    const ed = HD.edition;
    const w = ed.weather;
    if (w.snow > 0) snowNear(g, t, w.snow, ed.sky === 'clear');
    if (w.leaves > 0) leavesNear(g, t, w.leaves);
    if (w.petals > 0.3) petalsNear(g, t, w.petals, ed.tree === 'plum');
  };
  SEA.lights = function (t, L) {
    const ed = HD.edition;
    const w = ed.weather;
    if (!(w.fireflies > 0)) return;
    if (!ed.story) fireflyLights(t, L, w.fireflies);
    else {
      const S = storyFlies();
      if (S) storyLights(t, L, S);
    }
  };
})();
