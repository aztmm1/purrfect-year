/*
 * weather-seasons: snow, leaves, petals, fireflies and gulls (rain itself
 * lives in weather.js). Plugs into the 'weather' module through the
 * HD.weatherSeasons hooks, which weather.js calls at draw time:
 *
 *   far    bg z23   far snow and far gulls, behind the buildings
 *   mid    fx z43   mid snow, falling leaves and petals, fireflies, gulls
 *   near   fx z67   big soft near snowflakes, a few close leaves and petals,
 *                   now and then a gull gliding close past the camera
 *   lights          a handful of pooled firefly lights (never one per bug)
 *
 * Everything reads HD.edition and HD.place() at draw time (live switching
 * works) and is a stateless HD.time.cycle life or a loop-safe noise path, so
 * the frame is a pure function of t and loops at HD.LOOP.
 *
 * fx is never relit, so every particle picks its colours for the light mode
 * (night, dusk, golden, day: a separate table per mode), and then samples the
 * placed lights at its pixel with the daylight fill taken out: cream and gold
 * by lamps and the fire pit, pink by red lanterns, blue-white under cool
 * fireworks, green-white by fireflies. By day a particle inside a cast shadow
 * (L.shade) takes the shadow tone of its mode.
 *
 * Anchors: leaves and petals detach from the street-tree crowns
 * (place.crowns [{x, y, rx, ry, base}] when the street module registers them,
 * otherwise estimated from place.plaza.trees) and gusts carry more across the
 * frame from off-screen trees. Fireflies live in the plaza and the yard per
 * place, never over a building (checked against HD.placeTop).
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

  const BASE = 206; // the building base and the back of the ground, every place
  const GB = 266; // the nearest ground row things land on (front of the street)
  const TS = LY.titleSafe;
  const inTitle = (x, y) => x >= TS.x0 - 4 && x <= TS.x1 + 4 && y >= TS.y0 - 4 && y <= TS.y1 + 4;
  /** how far (x, y) sits inside the title-safe box grown by margin m (<= 0: outside) */
  const titleDepth = (x, y, m) => Math.min(x - (TS.x0 - m), TS.x1 + m - x, y - (TS.y0 - m), TS.y1 + m - y);
  const perArr = (n, a, b, seed) => Array.from({ length: n }, (_, i) => a + (b - a) * hash(i, seed, 3));

  // ------------------------------------------------------------------
  // light: the placed lights at a pixel with the daylight fill taken out.
  // Tables are flat [family * 7 + level] plus one shadow entry (SH);
  // level 0 is the plain colour of the light mode.
  //   family 0 warm   fire, candles, lanterns, lamps, gold bulbs
  //          1 red    red lanterns, red/pink bulbs, red/magenta bursts
  //          2 cool   moon, blue/violet/white bursts
  //          3 green  fireflies, green bulbs and bursts
  // ------------------------------------------------------------------
  const LVT = [0.035, 0.08, 0.15, 0.25, 0.38, 0.56];
  const NLV = 7;
  const SH = 4 * NLV; // in a daylight shadow
  let F0 = 0;
  let F1 = 0;
  let F2 = 0;
  let FLUM = 0;
  let MODE = 'night';
  function syncLight() {
    const lt = HD.light();
    MODE = lt.mode;
    const f = lt.day > 0 ? lt.fill : null;
    F0 = f ? f[0] : 0;
    F1 = f ? f[1] : 0;
    F2 = f ? f[2] : 0;
    FLUM = 0.4 * F0 + 0.45 * F1 + 0.15 * F2;
  }
  function lvOf(l) {
    let k = 0;
    while (k < 6 && l >= LVT[k]) k++;
    return k;
  }
  /** table index for the light at (x, y); k scales the strength (far layers) */
  function lightIdx(x, y, k) {
    const c = rgbAt(x, y);
    const r = c[0] - F0 > 0 ? c[0] - F0 : 0;
    const g = c[1] - F1 > 0 ? c[1] - F1 : 0;
    const b = c[2] - F2 > 0 ? c[2] - F2 : 0;
    const lv = lvOf((0.4 * r + 0.45 * g + 0.15 * b) * k);
    if (lv === 0) return FLUM > 0 && 0.4 * c[0] + 0.45 * c[1] + 0.15 * c[2] < 0.8 * FLUM ? SH : 0;
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
  // what a cast shadow does to a colour, per light mode (cool by day, violet at golden hour)
  const SHADE = { night: ['#05060c', 0.3], dusk: ['#221a38', 0.35], golden: ['#3a2246', 0.42], day: ['#28366a', 0.4] };
  let BUILD_MODE = 'night';
  /** cold colour -> [family * 7 + level] table built by `steps` per family, plus the shadow tone */
  function famSteps(steps, cold, warm, kmax) {
    let out = steps(cold, warm, kmax);
    for (let f = 1; f < FAM_RAMP.length; f++) out = out.concat(steps(cold, famTarget(f, warm), kmax));
    const sh = SHADE[BUILD_MODE];
    out.push(mix(cold, sh[0], sh[1]));
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
  const MODES = ['night', 'dusk', 'golden', 'day'];
  /** build fn(mode) for every light mode: { night, dusk, golden, day } */
  function byMode(fn) {
    const o = {};
    for (const m of MODES) {
      BUILD_MODE = m;
      o[m] = fn(m);
    }
    BUILD_MODE = 'night';
    return o;
  }

  // ------------------------------------------------------------------
  // SNOW: three depth layers. Snow at night is blue-lilac; near a lamp it
  // brightens into glowing cream and pale gold (pink by the red lanterns,
  // blue-white in a cool firework flash), so the flakes sparkle against the
  // warm windows instead of melting into them. Flakes drift with the wind
  // (slightly right, like the smoke), wobble, and vanish where they land.
  // By day (no snow entry is, but switching must hold) the flakes are white.
  // ------------------------------------------------------------------
  const CREAM = P.amber[7];
  const GOLD = P.amber[6];
  const WHITE_W = P.amber[8];
  const snowC = (m, c) => (m === 'night' ? c : mix(c, '#f2f5fa', m === 'dusk' ? 0.3 : 0.6));
  const SNOW = byMode((m) => ({
    F: [
      famSteps(glowSteps, snowC(m, mix(P.snow[3], P.snow[4], 0.6)), P.warmrain[3], 0.45),
      famSteps(glowSteps, snowC(m, P.snow[4]), P.warmrain[4], 0.5),
      famSteps(glowSteps, snowC(m, mix(P.snow[5], P.snow[6], 0.4)), GOLD, 0.55),
    ],
    M: [famSteps(glowSteps, snowC(m, mix(P.snow[5], P.snow[6], 0.4)), GOLD, 0.7), famSteps(glowSteps, snowC(m, P.snow[7]), CREAM, 0.8), famSteps(glowSteps, snowC(m, P.snow[8]), WHITE_W, 0.85)],
    N: [famSteps(glowSteps, snowC(m, mix(P.snow[4], P.snow[5], 0.5)), GOLD, 0.65), famSteps(glowSteps, snowC(m, P.snow[6]), CREAM, 0.78), famSteps(glowSteps, snowC(m, P.snow[8]), WHITE_W, 0.85)],
    // clear skies: the few flakes kept in the title area (dimmer than the
    // fainter stars), and a flake fading out at the edge of that area
    TITLE: famSteps(glowSteps, snowC(m, mix(P.snow[3], P.snow[4], 0.4)), P.warmrain[3], 0.45),
    GHOST: famSteps(glowSteps, snowC(m, mix(P.snow[2], P.snow[3], 0.5)), P.warmrain[2], 0.4),
  }));
  // clear skies: a 1px flake up in the sky trails a faint pixel above it, so
  // it reads as a falling flake rather than one more star
  const SKY_Y = 150;

  const SNOW_FAR_N = 440;
  const SNOW_MID_N = 560;
  const SNOW_NEAR_N = 56;
  // a full snowfall (snow = 1, Christmas) is heavy and takes the whole
  // arrays; lighter snow scales from a gentler base (380 mid, 42 near)
  const snowN = (n, s, light) => (s >= 1 ? n : R(light * s));
  const SFP = perArr(SNOW_FAR_N, 15, 21, 9101);
  const SMP = perArr(SNOW_MID_N, 9.5, 12.5, 9202);
  const SNP = perArr(SNOW_NEAR_N, 5.2, 7, 9303);
  const DRIFT_FAR = 0.1; // px right per px fallen
  const DRIFT_MID = 0.14;
  const DRIFT_NEAR = 0.2;
  // Under a clear starry sky (lunar, newyear) a 1px flake in a still frame is
  // a star. There the far flakes only show low down, against the far city
  // and behind the buildings, and in the title-safe corner only ~40% of the
  // mid and near flakes show, in their darkest tone (the rest fade out at its edge).
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
    const SF = SNOW[MODE].F;
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
      if (y > HD.placeTop(x)) continue; // behind a building: the scene covers it
      if (b > 0 && inTitle(x, y)) b--;
      g.rect(x, y, 1, 1, SF[b][lightIdx(x, y, 0.6)]);
    }
  }

  function snowMid(g, t, s, clear) {
    const Sm = SNOW[MODE];
    const SM = Sm.M;
    const n = snowN(SNOW_MID_N, s, 380);
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, SMP[i], 9202);
      const age = c.age;
      const d = c.rnd(1);
      const yl = BASE + d * (GB - 1 - BASE);
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
          g.rect(x, y, 1, 1, Sm.GHOST[li]);
          continue;
        }
        if (tr === 1) {
          g.rect(x, y, 1, 1, Sm.TITLE[li]);
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
        if (clear && y < SKY_Y) g.rect(x, y - 1, 1, 1, Sm.F[b][li]);
        g.rect(x, y, 1, 1, SM[b][li]);
      }
    }
  }

  function snowNear(g, t, s, clear) {
    const Sm = SNOW[MODE];
    const SN = Sm.N;
    const n = Math.max(3, snowN(SNOW_NEAR_N, s, 42));
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
          g.rect(x, y, 2, 2, Sm.GHOST[li]);
          continue;
        }
        dim = tr === 1 ? 2 : 0;
      }
      const lo = dim > 1 ? Sm.TITLE[li] : SN[0][li];
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
  const PETAL_FULL = frames(['.22', '211', '10.']); // a whole little petal, face-on
  function drawFrame(g, fr, x, y, tab, li) {
    for (let k = 0; k < fr.length; k++) {
      const p = fr[k];
      g.rect(x + p[0], y + p[1], 1, 1, tab[p[2]][li]);
    }
  }
  /** [tone][family*7+level] tables from three tones; .dk is a darker fourth */
  function toneTab(c0, c1, c2, warm, kmax, dark) {
    const tab = [famSteps(warmSteps, c0, warm, kmax * 0.8), famSteps(warmSteps, c1, warm, kmax), famSteps(warmSteps, c2, warm, kmax)];
    tab.dk = famSteps(warmSteps, mix(c0, dark || P.night[1], 0.45), warm, kmax * 0.6);
    return tab;
  }
  /** one step dimmer (far, just detached): still three tones */
  const dimTab = (tab) => [tab.dk, tab[0], tab[1]];
  /** resting on the ground: two dark tones */
  const restTab = (tab) => [tab.dk, tab.dk, tab[0]];
  /** a hue set per mode: { hues, dim, rest } */
  const hueSet = (hues) => ({ hues, dim: hues.map(dimTab), rest: hues.map(restTab) });

  // Leaf hues. At night they are deep (they warm to fiery orange by the
  // lamps); at golden hour the sun catches them: saturated rust, gold and red
  // with a bright lit face; by day they are plain autumn colours. More red,
  // gold and yellow than orange, so they never pass for sparks.
  const AU = P.autumn;
  const GO = P.gold;
  const RE = P.red;
  const LEAF_TONES = {
    night: [
      [AU[3], AU[5], AU[6]],
      [AU[4], AU[6], GO[5]],
      [RE[3], RE[4], RE[5]],
      [AU[2], AU[4], AU[5]],
      [GO[2], GO[3], GO[4]],
      [RE[2], RE[3], mix(RE[4], AU[6], 0.4)],
    ],
    golden: [
      [AU[4], AU[6], mix(AU[7], GO[6], 0.35)],
      [mix(AU[5], GO[3], 0.5), GO[4], GO[5]],
      [RE[3], RE[5], mix(RE[6], AU[7], 0.35)],
      [AU[3], AU[5], AU[7]],
      [GO[3], GO[5], GO[6]],
      [RE[2], RE[4], mix(RE[5], AU[6], 0.4)],
    ],
    day: [
      [AU[4], AU[6], AU[7]],
      [GO[3], GO[4], GO[5]],
      [RE[3], RE[4], RE[5]],
      [AU[3], AU[5], AU[6]],
      [GO[4], GO[5], GO[6]],
      [RE[2], RE[3], mix(RE[4], AU[6], 0.4)],
    ],
  };
  LEAF_TONES.dusk = LEAF_TONES.night.map((tr, k) => tr.map((c, j) => mix(c, LEAF_TONES.golden[k][j], 0.4)));
  const LEAF_WARM = [P.fire[7], P.fire[8], P.fire[6], P.fire[6], P.fire[8], P.fire[6]];
  const LEAF = byMode((m) => hueSet(LEAF_TONES[m].map((tr, k) => toneTab(tr[0], tr[1], tr[2], LEAF_WARM[k], m === 'night' ? 0.6 : 0.4, m === 'night' ? null : mix(tr[0], P.night[2], 0.5)))));
  const LEAF_PICK = [2, 2, 5, 5, 1, 1, 4, 4, 3, 0]; // weighted hue choice
  const LEAF_NEAR_TONES = {
    night: [[RE[1], RE[3], RE[5]], [AU[0], AU[2], GO[4]], [mix(RE[1], AU[0], 0.5), AU[3], AU[7]]],
    golden: [[RE[2], RE[4], mix(RE[6], GO[6], 0.3)], [AU[2], AU[4], GO[5]], [AU[1], AU[4], mix(AU[7], GO[6], 0.4)]],
    day: [[RE[2], RE[4], RE[6]], [AU[2], AU[4], GO[5]], [AU[1], AU[4], AU[7]]],
  };
  LEAF_NEAR_TONES.dusk = LEAF_NEAR_TONES.night.map((tr, k) => tr.map((c, j) => mix(c, LEAF_NEAR_TONES.golden[k][j], 0.4)));
  const LEAF_NEAR = byMode((m) => LEAF_NEAR_TONES[m].map((tr) => toneTab(tr[0], tr[1], tr[2], P.fire[7], 0.5)));

  // Petals: pink and white blossom; by day a darker pink edge keeps them
  // readable against a pale sky, and the lit face is nearly white.
  const BL = P.blossom;
  const PETAL_TONES = {
    night: [[BL[4], BL[6], BL[7]], [BL[4], BL[5], BL[6]], [BL[5], BL[6], mix(BL[7], P.snow[8], 0.5)]],
    day: [[BL[4], BL[5], mix(BL[7], '#ffffff', 0.3)], [mix(BL[3], BL[4], 0.5), BL[5], BL[6]], [mix(BL[4], '#9a7a90', 0.35), BL[6], '#fff6fa']],
  };
  PETAL_TONES.golden = PETAL_TONES.day.map((tr) => tr.map((c) => mix(c, P.amber[7], 0.22)));
  PETAL_TONES.dusk = PETAL_TONES.night.map((tr, k) => tr.map((c, j) => mix(c, PETAL_TONES.day[k][j], 0.35)));
  const PETALS_C = byMode((m) => hueSet(PETAL_TONES[m].map((tr) => toneTab(tr[0], tr[1], tr[2], P.amber[7], m === 'night' ? 0.5 : 0.3, m === 'night' ? null : mix(tr[0], P.night[3], 0.4)))));

  // ------------------------------------------------------------------
  // CROWNS: the street-tree crowns of the place, [{x, y, rx, ry, base}]
  // (centre, radii, the trunk's foot). place.crowns when the street module
  // registers them; until then the street module's current layout, mirrored
  // here (crown centre = foot - height + ry). Leaves and petals detach from
  // points well inside them; fireflies hang in them on summer nights.
  // ------------------------------------------------------------------
  const BOSTON_TREE = (x, base) => ({ x, y: base - 46, rx: 15, ry: 14, base });
  const CROWN_EST = {
    apt1: [BOSTON_TREE(338, 216), BOSTON_TREE(420, 216)],
    apt2: [BOSTON_TREE(26, 209), BOSTON_TREE(452, 216)],
    soho: [{ x: 462, y: 166, rx: 17, ry: 16, base: 216 }],
    bhills: [{ x: 76, y: 197, rx: 13, ry: 11, base: 220 }, { x: 388, y: 197, rx: 13, ry: 11, base: 220 }],
    herndon: [{ x: 406, y: 84, rx: 62, ry: 70, base: 228 }, { x: 28, y: 190, rx: 17, ry: 14, base: 228 }],
  };
  const crownsOf = (pl) => (pl.crowns && pl.crowns.length ? pl.crowns : CROWN_EST[pl.id] || []);
  /** points inside the crowns (3 px grid, 2 px in from the edge): flat [x, y, base, ...] */
  const crownPts = HD.perEdition((ed) => {
    const out = [];
    for (const c of crownsOf(HD.PLACES[ed.place])) {
      const rx = Math.max(2, R(c.rx * 0.72));
      const ry = Math.max(2, R(c.ry * 0.72));
      for (let y = -ry; y <= ry; y += 3)
        for (let x = -rx; x <= rx; x += 3) {
          if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
          if (inTitle(c.x + x, c.y + y)) continue;
          out.push(c.x + x, c.y + y, c.base || BASE + 4);
        }
    }
    return out;
  });

  const FADE_IN = 0.3; // s: only the stem pixel shows while a leaf detaches
  const FADE_OUT = 0.5; // s: one darker pixel on the ground before it is gone

  /**
   * One leaf/petal falling from a crown: it detaches from a foliage clump,
   * drifts with the wind, swings like a pendulum (rising a touch at each end
   * of the swing, the swing growing as it leaves the branch), flips at each
   * swing, then lies on the ground for a moment and fades away. It lands
   * around the foot of its tree, a little forward (towards the street).
   */
  function faller(g, t, i, o, seed, set, A) {
    const c = T.cycle(t, i, o.per[i], seed);
    const age = c.age;
    const fall = o.fall;
    const k = ((c.rnd(0) * (A.length / 3)) | 0) * 3;
    const x0 = A[k] + ((c.rnd(12) * 3) | 0) - 1;
    const y0 = A[k + 1] + ((c.rnd(13) * 3) | 0) - 1;
    const d = c.rnd(2);
    const yl = A[k + 2] - 2 + d * o.spread;
    const drift = o.drift0 + c.rnd(3) * o.drift1;
    const amp = o.amp0 + c.rnd(4) * o.amp1;
    const nsw = o.sw0 + c.rnd(5) * o.sw1;
    const ph = c.rnd(6);
    const hue = o.pick ? o.pick[(c.rnd(8) * o.pick.length) | 0] : (c.rnd(8) * set.hues.length) | 0;
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
      const e = HD.smoothstep(0, 0.15, s); // the swing grows as it leaves the branch
      x = x0 + drift * s + amp * e * sw;
      y = y0 + (yl - y0) * s - o.lift * e * sw * sw;
      f = cos(phi) > 0 ? 0 : 1;
      if (spin) f ^= Math.floor(ts * spin) & 1;
      tab = s < 0.05 ? set.dim[hue] : set.hues[hue];
    } else {
      // resting where it landed (the last pose of the fall), then gone
      x = x0 + drift + amp * sin(TAU * (nsw + ph));
      y = yl;
      f = 0;
      tab = (age - fall) / (1 - fall) > 0.55 ? set.rest[hue] : set.dim[hue];
    }
    x = R(x);
    y = R(y);
    if (x < -4 || x > W + 3) return;
    const fr = shape[f];
    if (ts < FADE_IN || tl < FADE_OUT) {
      const p = fr.seed;
      g.rect(x + p[0], y + p[1], 1, 1, (ts < FADE_IN ? set.hues[hue][0] : set.hues[hue].dk)[lightIdx(x, y, 1)]);
      return;
    }
    drawFrame(g, fr, x, y, tab, lightIdx(x, y, 1));
  }

  /** blown in from trees off-screen on the left, gusting across the street */
  function traveller(g, t, i, o, seed, set) {
    const c = T.cycle(t, i, o.per[i], seed);
    const age = c.age;
    const fall = o.fall;
    const y0 = o.y0 + c.rnd(1) * o.yh;
    const d = c.rnd(2);
    const yl = BASE + 2 + d * (GB - 4 - BASE);
    const xl = o.xl0 + c.rnd(0) * o.xl1;
    const hue = o.pick ? o.pick[(c.rnd(8) * o.pick.length) | 0] : (c.rnd(8) * set.hues.length) | 0;
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
      const bob = sin(TAU * (o.bobs * s + ph));
      x = -6 + (xl + 6) * u + o.bobX * bob;
      y = y0 + (yl - y0) * Math.pow(s, 1.7) - o.bobY * bob * (1 - s);
      f = Math.floor(age * c.P * spin * (1.2 - s)) & 1;
      tab = set.hues[hue];
    } else {
      x = xl + o.bobX * sin(TAU * (o.bobs + ph));
      y = yl;
      f = 0;
      tab = (age - fall) / (1 - fall) > 0.55 ? set.rest[hue] : set.dim[hue];
    }
    x = R(x);
    y = R(y);
    const fr = shape[f];
    if ((1 - age) * c.P < FADE_OUT) {
      const p = fr.seed;
      g.rect(x + p[0], y + p[1], 1, 1, set.hues[hue].dk[lightIdx(x, y, 1)]);
      return;
    }
    drawFrame(g, fr, x, y, tab, lightIdx(x, y, 1));
  }

  /**
   * Carried on the breeze right across the frame at mid-height (from trees
   * off-screen to trees off-screen): it bobs, flips and sinks a little, but
   * never lands. Kept below the title-safe sky.
   */
  function drifter(g, t, i, o, seed, set) {
    const c = T.cycle(t, i, o.per[i], seed);
    const s = c.age;
    const ph = c.rnd(6);
    const nb = o.bobs + c.rnd(5) * 1.5;
    const bob = sin(TAU * (nb * s + ph));
    const x = R(-8 + (W + 16) * s + 3 * sin(TAU * (0.5 * nb * s + ph + 0.2)));
    const y = R(o.y0 + c.rnd(1) * o.yh + o.sink * s - o.bobY * bob);
    if (x < -4 || x > W + 3) return;
    const hue = o.pick ? o.pick[(c.rnd(8) * o.pick.length) | 0] : (c.rnd(8) * set.hues.length) | 0;
    const shape = o.shapes[(c.rnd(9) * o.shapes.length) | 0];
    const f = Math.floor(s * c.P * (o.spin0 + c.rnd(11) * o.spin1)) & 1;
    drawFrame(g, shape[f], x, y, set.hues[hue], lightIdx(x, y, 1));
  }

  // ---- leaves ----
  const LEAF_TREE_MAX = 40;
  const LEAF_TREE_PER = 9; // fallers per crown at leaves = 1
  const LEAF_TRAV_N = 22;
  const LEAF_NEAR_N = 3;
  const LEAF_TREE = {
    per: perArr(LEAF_TREE_MAX, 9, 13, 9401),
    fall: 0.84,
    spread: 16,
    drift0: 4,
    drift1: 18,
    amp0: 3,
    amp1: 4,
    sw0: 1.0,
    sw1: 1.2,
    lift: 1.6,
    spinP: 0.35,
    spin0: 3,
    spin1: 3,
    shapes: LEAF_SHAPES,
    pick: LEAF_PICK,
  };
  const LEAF_TRAV = {
    per: perArr(LEAF_TRAV_N, 12, 17, 9402),
    fall: 0.86,
    y0: 118,
    yh: 76,
    xl0: 24,
    xl1: 430,
    bobs: 2.2,
    bobX: 2,
    bobY: 3,
    spin0: 3,
    spin1: 4,
    shapes: LEAF_SHAPES,
    pick: LEAF_PICK,
  };
  // near leaves drift past the camera slowly (~36 px/s) and are on screen
  // about half the time each
  const LEAF_NEAR_P = perArr(LEAF_NEAR_N, 24, 32, 9403);
  const NEAR_ON = 0.5;

  const LEAF_DRIFT_N = 6;
  const LEAF_DRIFT = { per: perArr(LEAF_DRIFT_N, 20, 28, 9404), y0: 84, yh: 96, sink: 18, bobs: 2, bobY: 5, spin0: 2.5, spin1: 3, shapes: LEAF_SHAPES, pick: LEAF_PICK };
  function leavesMid(g, t, k) {
    const set = LEAF[MODE];
    const A = crownPts();
    if (A.length) {
      const nt = Math.min(LEAF_TREE_MAX, R(LEAF_TREE_PER * k * crownCount()));
      for (let i = 0; i < nt; i++) faller(g, t, i, LEAF_TREE, 9401, set, A);
    }
    const nv = R(LEAF_TRAV_N * k);
    for (let i = 0; i < nv; i++) traveller(g, t, i, LEAF_TRAV, 9402, set);
    const nd = R(LEAF_DRIFT_N * k);
    for (let i = 0; i < nd; i++) drifter(g, t, i, LEAF_DRIFT, 9404, set);
  }
  const crownCount = () => crownsOf(HD.place()).length || 1;
  function leavesNear(g, t, k) {
    const tabs = LEAF_NEAR[MODE];
    const n = Math.max(1, R(LEAF_NEAR_N * k));
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, LEAF_NEAR_P[i], 9403);
      const age = c.age;
      // only crosses during the first half of its life, then rests off-screen
      if (age > NEAR_ON) continue;
      const s = age / NEAR_ON;
      const y0 = 100 + c.rnd(1) * 80;
      const ph = c.rnd(6);
      const x = R(-12 + (W + 24) * s + 4 * sin(TAU * (1.5 * s + ph)));
      const y = R(y0 + 46 * s * s + 7 * sin(TAU * (1.5 * s + ph + 0.25)));
      const f = Math.floor(age * c.P * (2.4 + c.rnd(11) * 1.4)) & 3;
      const tab = tabs[(c.rnd(8) * tabs.length) | 0];
      drawFrame(g, LEAF_TUMBLE[f], x, y, tab, lightIdx(x, y, 1));
    }
  }

  // ---- petals (spring blossom) ----
  const PETAL_TREE_MAX = 40;
  const PETAL_TREE_PER = 12;
  const PETAL_TRAV_N = 30;
  const PETAL_TREE = {
    per: perArr(PETAL_TREE_MAX, 10, 15, 9501),
    fall: 0.86,
    spread: 18,
    drift0: 4,
    drift1: 20,
    amp0: 2,
    amp1: 4,
    sw0: 1.4,
    sw1: 1.6,
    lift: 1.2,
    spinP: 0.5,
    spin0: 1.5,
    spin1: 2.5,
    shapes: [PETAL_FULL, PETAL, PETAL, PETAL_SMALL],
  };
  const PETAL_TRAV = {
    per: perArr(PETAL_TRAV_N, 15, 22, 9504),
    fall: 0.9,
    y0: 96,
    yh: 96,
    xl0: 20,
    xl1: 440,
    bobs: 3.2,
    bobX: 3,
    bobY: 4,
    spin0: 1.5,
    spin1: 2.5,
    shapes: [PETAL_FULL, PETAL_FULL, PETAL, PETAL_SMALL],
  };
  const PETAL_DRIFT_N = 18;
  const PETAL_DRIFT = { per: perArr(PETAL_DRIFT_N, 24, 34, 9505), y0: 80, yh: 110, sink: 14, bobs: 2.5, bobY: 6, spin0: 1.5, spin1: 2.5, shapes: [PETAL_FULL, PETAL, PETAL] };
  function petalsMid(g, t, k) {
    const set = PETALS_C[MODE];
    const A = crownPts();
    if (A.length) {
      const nt = Math.min(PETAL_TREE_MAX, R(PETAL_TREE_PER * k * crownCount()));
      for (let i = 0; i < nt; i++) faller(g, t, i, PETAL_TREE, 9501, set, A);
    }
    const nv = R(PETAL_TRAV_N * k);
    for (let i = 0; i < nv; i++) traveller(g, t, i, PETAL_TRAV, 9504, set);
    const nd = R(PETAL_DRIFT_N * k);
    for (let i = 0; i < nd; i++) drifter(g, t, i, PETAL_DRIFT, 9505, set);
  }
  // a couple of petals drifting right past the camera (2x2, soft)
  const PETAL_NEAR_P = perArr(3, 12, 16, 9502);
  function petalsNear(g, t, k) {
    const n = k > 0.5 ? 3 : 1;
    const tab = PETALS_C[MODE].hues[0];
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
  // FIREFLIES: they wander on smooth loop-safe noise, climb a little while
  // they glow (the firefly "J" stroke) and blink slowly (quick rise, long
  // fade, mostly dark). A few rest low and glow softly. They live in the
  // plaza and the yard, never over a building or a cat, and pool their light
  // in a few fixed spots (only the pools' strength changes).
  //
  // Per entry (FF_SETS), on the place's anchors:
  //   midsummer  the apt1 plaza round the fire pit, the friends in the middle
  //   match      the apt1 plaza; at the goal the plaza dims, a cheer of
  //              fireflies lifts out of the tree crowns and flashes ripple
  //              out from the friends across the plaza
  //   home       the apt1 plaza, nobody in it
  //   dc         the herndon lawns; when the candles go out the fireflies
  //              nearest the table come in one by one and hover where the
  //              flames were, and drift off again as the candles are relit
  // Any other entry with fireflies gets the plaza or the yard of its place.
  // Story timing comes from the shared HD.summer helpers.
  // ------------------------------------------------------------------
  // wander per kind: ax/ay [base, random], wx/wy the extra sway, jr the J climb
  const KIND = {
    m: { ax: [6, 6], ay: [3, 2], wx: 2, wy: 1.2, jr: [2, 1.5] },
    h: { ax: [6, 4], ay: [2, 1], wx: 2, wy: 1, jr: [1.5, 0] },
    t: { ax: [2, 1], ay: [1.5, 0.5], wx: 1, wy: 0.6, jr: [1, 0.5] },
    r: { ax: [0, 0], ay: [0, 0], wx: 0, wy: 0, jr: [0, 0] },
  };
  const MIN_GAP = 9; // px between home positions (7 when a group is crowded)
  // groups: [weight, x0, x1, y0, y1, kind]  m in the air, t in the crowns
  //         (the box is unused), h along the back of the yard, r resting low
  // avoid:  [x0, y0, x1, y1] that no firefly's wander may enter
  const APT1 = HD.PLACES.apt1;
  const AP_PZ = APT1.plaza;
  const AP_GROUP = APT1.stages.group;
  const AP_FRIENDS = [AP_GROUP.x0 - 4, AP_GROUP.base - 20, AP_GROUP.x1 + 6, AP_GROUP.base + 3]; // their heads and ears
  const AP_LAMP = [457, 170, 477, 194]; // the street lamp's lantern past the plaza
  const AP_PIT = [APT1.firepit.x - 15, APT1.firepit.base - 30, APT1.firepit.x + 15, APT1.firepit.base + 4];
  const AP_GROUPS = [
    [10, 0, 0, 0, 0, 't'], // in the plaza trees
    [12, AP_PZ.x0 - 2, 476, 164, 202, 'm'], // the plaza air, round the trees and over their heads
    [5, AP_PZ.x1 - 4, 476, 198, 222, 'm'], // the quiet far end of the plaza
  ];
  const HN = HD.PLACES.herndon;
  const HN_TBL = HN.table;
  const HN_PARTY = [HN.stages.party.x0 - 6, HN.stages.back.base - 34, HN.stages.party.x1 + 6, HN.stages.party.base + 6];
  const HN_WALK = [HN.entrance.steps.x0 - 2, HN.porch.floor - 4, HN.entrance.steps.x1 + 2, HN.ground.yard[1] + 4];
  const HN_LAMP = [441, 205, 463, 230]; // the lamp post's lantern by the gate
  const FF_SETS = {
    midsummer: { place: 'apt1', n: 50, seed: 9711, groups: AP_GROUPS, avoid: [AP_FRIENDS, AP_PIT, AP_LAMP] },
    match: { place: 'apt1', n: 42, seed: 9701, groups: AP_GROUPS, avoid: [AP_FRIENDS, AP_LAMP], ripple: true },
    home: {
      place: 'apt1',
      n: 34,
      seed: 9704,
      groups: AP_GROUPS.concat([[7, AP_PZ.x0, AP_PZ.x1, 204, 222, 'm'], [4, AP_PZ.x0, 476, 216, 223, 'r']]),
      avoid: [AP_LAMP],
      visit: true,
    },
    dc: {
      place: 'herndon',
      n: 56,
      seed: 9703,
      groups: [
        [5, 6, 70, 204, 228, 'm'], // the left lawn
        [3, 42, 76, 206, 230, 'm'], // close by the party: these come to the cake
        [3, 152, 180, 208, 232, 'm'], // close by the party, right
        [5, 180, 244, 208, 232, 'm'], // the front lawn, left of the walk
        [4, 274, 334, 208, 232, 'm'], // the front lawn, right of the walk
        [6, 338, 474, 204, 228, 'm'], // the right lawn
        [6, 0, 0, 0, 0, 't'], // in the big oak and the dogwood
        [3, 6, 150, 196, 205, 'h'], // along the trees at the back
        [3, 336, 474, 196, 205, 'h'],
        [6, 8, 470, 216, 232, 'r'], // resting in the grass
      ],
      avoid: [HN_PARTY, HN_WALK, HN_LAMP],
      gather: true,
    },
  };
  /** any other entry with fireflies: the plaza, or a band over the ground */
  function genericSet(ed, pl) {
    const pz = pl.plaza;
    const avoid = [];
    if (ed.fire === 'firepit' && pl.firepit) avoid.push([pl.firepit.x - 15, pl.firepit.base - 30, pl.firepit.x + 15, pl.firepit.base + 4]);
    const groups = pz ? [[8, 0, 0, 0, 0, 't'], [10, pz.x0, pz.x1, 186, 220, 'm']] : [[10, 8, 470, 206, 230, 'm']];
    return { place: pl.id, n: 36, seed: 9790, groups, avoid };
  }

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
  const winFor = (k) => (WIN[k] === undefined ? (WIN[k] = HD.summer && HD.summer[k] ? winOf(HD.summer[k]) : null) : WIN[k]);
  /** signed seconds from `a` to the loop time s, in (-LOOP/2, LOOP/2] */
  function since(s, a) {
    const L = HD.LOOP;
    const r = s - a;
    return r - Math.floor(r / L + 0.5) * L;
  }

  // DC: where the gathered fireflies hover, relative to the middle candle's
  // wick (decor-trips: the cake sits on the table at place.table, three
  // candles about 3 px apart, wicks about 19 px above the table's base):
  // just over each wick, where the little flames were, plus two a touch
  // higher at the sides
  const CAKE_X = HN_TBL.x;
  const WICK_Y = HN_TBL.base - 19;
  const HOVER = [[-6, -5], [-3, -2], [0, -3], [3, -2], [6, -6]]; // sorted by x
  const GATHER_NEAR = 48; // px from the table: only these fireflies come in
  const G_IN = 5; // s to fly in
  const G_OUT = 3.5; // s to drift off
  const G_STAGGER = 0.5; // s between arrivals

  /** true when (x, y) is on a building's face (above its base, below its roofline) */
  const onBuilding = (pl, x, y) => y < BASE && y >= HD.placeTop(x, pl) - 1;

  const storyFlies = HD.perEdition((ed) => {
    if (!(ed.weather.fireflies > 0)) return null;
    const pl = HD.PLACES[ed.place];
    const cfg = FF_SETS[ed.id] && FF_SETS[ed.id].place === pl.id ? FF_SETS[ed.id] : genericSet(ed, pl);
    const rnd = HD.rng(cfg.seed);
    const total = R(cfg.n * ed.weather.fireflies);
    const crowns = crownsOf(pl);
    // the moon disc (sky module), kept clear of tree fireflies
    let moon = null;
    try {
      moon = HD.sky && HD.sky.moon ? HD.sky.moon() : null;
    } catch (e) {
      moon = null;
    }
    let wsum = 0;
    for (const gr of cfg.groups) if (gr[5] !== 't' || crowns.length) wsum += gr[0];
    const flies = [];
    const spaced = (hx, hy, gap) => flies.every((f) => (f.hx - hx) ** 2 + (f.hy - hy) ** 2 >= gap * gap);
    for (const [w, x0, x1, y0, y1, kind] of cfg.groups) {
      if (kind === 't' && !crowns.length) continue;
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
        let ci = -1;
        let ok = false;
        for (let k = 0; k < 48 && !ok; k++) {
          if (kind === 't') {
            // inside a crown, far enough in that the wander stays in the leaves
            ci = (rnd() * crowns.length) | 0;
            const C = crowns[ci];
            const a = TAU * rnd();
            const r = Math.sqrt(rnd());
            hx = C.x + cos(a) * r * Math.max(1, C.rx * 0.7 - ex);
            hy = C.y + sin(a) * r * Math.max(1, C.ry * 0.7 - eu);
          } else {
            hx = x0 + rnd() * (x1 - x0);
            hy = y0 + rnd() * (y1 - y0);
          }
          const box = (a) => hx + ex >= a[0] && hx - ex <= a[2] && hy + ed2 >= a[1] && hy - eu <= a[3];
          let clear = !cfg.avoid.some(box) && hy + ed2 < H - 2 && !(moon && (hx - moon.x) ** 2 + (hy - moon.y) ** 2 < (moon.r + 8) ** 2);
          if (clear && kind !== 't')
            for (const xx of [hx - ex, hx, hx + ex]) if (onBuilding(pl, R(xx), R(hy - eu)) || onBuilding(pl, R(xx), R(hy + ed2))) clear = false;
          const gap = kind === 't' ? 5 : kind === 'r' ? 7 : MIN_GAP;
          ok = clear && spaced(hx, hy, k < 32 ? gap : gap - 2);
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
          crown: ci,
          pw: 7 + rnd() * 6,
          pb: kind === 'r' ? 5.5 + rnd() * 4 : 3.4 + rnd() * 3.6,
          ob: rnd(),
          s: cfg.seed + flies.length * 7,
          zone: 0,
          gather: -1,
        });
      }
    }
    // light pools: one per crown, and one per 64 px of ground; each sits fixed
    // at the middle of its fireflies' homes (only its strength changes)
    const pools = [];
    const poolOf = new Map();
    for (const f of flies) {
      const key = f.tree ? 'c' + f.crown : 'g' + Math.floor(f.hx / 64);
      let p = poolOf.get(key);
      if (!p) {
        p = { n: 0, sx: 0, sy: 0, tree: f.tree };
        poolOf.set(key, p);
        pools.push(p);
      }
      f.zone = pools.indexOf(p);
      p.n++;
      p.sx += f.hx;
      p.sy += f.hy;
    }
    for (const p of pools) {
      p.x = R(p.sx / p.n);
      p.y = R(p.tree ? p.sy / p.n : Math.max(BASE + 8, p.sy / p.n));
      p.r = p.tree ? 26 : 30;
      p.ry = p.tree ? 20 : 18;
    }
    // dc: the fireflies nearest the table come to the cake: three from the
    // left and two from the right, so nobody crosses the party; the left ones
    // take the left places; the nearest comes first
    if (cfg.gather) {
      const tx0 = HN_TBL.x - 17;
      const tx1 = HN_TBL.x + 16;
      const dTable = (f) => Math.hypot(Math.max(0, tx0 - f.hx, f.hx - tx1), Math.max(0, WICK_Y - f.hy, f.hy - HN_TBL.base));
      const side = (left, k) =>
        flies
          .filter((f) => !f.rest && !f.tree && f.hx < CAKE_X === left && dTable(f) <= GATHER_NEAR)
          .sort((a, b) => dTable(a) - dTable(b))
          .slice(0, k);
      const L3 = side(true, 3);
      const R2 = side(false, HOVER.length - L3.length);
      L3.slice()
        .sort((a, b) => a.hx - b.hx)
        .forEach((f, k) => (f.slot = k));
      R2.slice()
        .sort((a, b) => b.hx - a.hx)
        .forEach((f, k) => (f.slot = HOVER.length - 1 - k));
      L3.concat(R2)
        .sort((a, b) => dTable(a) - dTable(b))
        .forEach((f, k) => (f.gather = k));
    }
    // match: the cheer lifts out of the tree crowns; the ripple starts at the friends
    const cheer = [];
    if (cfg.ripple)
      for (const C of crowns)
        for (let k = 0; k < 4; k++)
          cheer.push([C.x + (k - 1.5) * Math.max(3, C.rx * 0.5) + (rnd() * 4 - 2), C.y - C.ry * 0.4 + rnd() * 6, 7 + rnd() * 9, rnd() * 0.9]);
    const st = pl.stages && pl.stages.group;
    const n = flies.length;
    return {
      cfg,
      flies,
      pools,
      cheer,
      cheerPool: cheer.length ? [R(cheer.reduce((a, c) => a + c[0], 0) / cheer.length), R(cheer.reduce((a, c) => a + c[1], 0) / cheer.length) - 6] : null,
      rippleC: st ? [(st.x0 + st.x1) / 2, st.base - 10] : [W / 2, 214],
      X: new Float64Array(n),
      Y: new Float64Array(n),
      E: new Float64Array(n),
      M: new Float64Array(n),
      small: new Uint8Array(n),
      CX: new Float64Array(cheer.length),
      CY: new Float64Array(cheer.length),
      CE: new Float64Array(cheer.length),
      t: NaN,
      gm: 0,
      cheering: false,
    };
  });
  SEA.storyFlies = storyFlies; // for inspection from the tools

  /** the J stroke: climbs while it glows (ph 0..0.56), sinks back while dark; continuous through the wrap */
  const jStroke = (ph) => (ph < 0.56 ? 0.3 - ph / 0.56 : HD.smoothstep(0.56, 1, ph) - 0.7);
  /** blink envelope: quick rise, long fade, mostly dark */
  const blink = (ph) => (ph < 0.14 ? ph / 0.14 : ph < 0.56 ? 1 - (ph - 0.14) / 0.42 : 0);

  // ---- match: the goal ripple ----
  // The plaza dims as the goal goes in, the cheer lifts out of the crowns,
  // then flashes spread out from the friends (~50 px/s, each flash 1.6 s, so
  // a broad ring is lit at once; a second, softer ripple follows) and the
  // usual blinking comes back once both have passed. Times are seconds after
  // HD.summer.goal starts.
  const RIPPLES = [[1.0, 1], [3.4, 0.85]];
  const RIP_SPD = 50;
  const RIP_LEN = 1.6;
  const RIP_Q = 0.35; // the blinking dims to this, never to black
  const RIP_HOLD = [1];
  /** flash (0..1) at goal-time g for (x, y); writes the blink damping to RIP_HOLD[0] */
  function goalRipple(S, g, x, y) {
    RIP_HOLD[0] = 1;
    if (g < -0.8 || g > 16) return 0;
    const d = Math.hypot(x - S.rippleC[0], (y - S.rippleC[1]) * 1.5) / RIP_SPD;
    let w = 0;
    for (const [a, k] of RIPPLES) {
      const u = g - a - d;
      if (u < 0 || u >= RIP_LEN) continue;
      w = Math.max(w, k * (u < 0.2 ? u / 0.2 : u < 0.6 ? 1 : 1 - (u - 0.6) / (RIP_LEN - 0.6)));
    }
    const bk = RIPPLES[RIPPLES.length - 1][0] + d + RIP_LEN; // the last ripple has passed here
    RIP_HOLD[0] = g < 0 ? 1 - (1 - RIP_Q) * HD.smoothstep(-0.8, 0, g) : g < bk ? RIP_Q : RIP_Q + (1 - RIP_Q) * HD.smoothstep(bk, bk + 1.6, g);
    return w;
  }
  /** the cheer fireflies at goal-time g (into S.CX/CY/CE); false when none show */
  function cheerState(t, g, S) {
    if (g < 0 || g > 9) return false;
    let any = false;
    for (let k = 0; k < S.cheer.length; k++) {
      const [cx, cy, rise, dl] = S.cheer[k];
      const a = 0.08 + dl; // they come out one after another
      const u = (g - a) / 1.3; // lifting out of the leaves
      const out = (g - (5.6 + 0.15 * k)) / 1.2; // fading away (all gone before the window ends)
      let e = 0;
      if (u > 0 && out < 1) e = (0.74 + 0.14 * T.wave(t, 1.3 + 0.17 * k, k * 0.31)) * HD.smoothstep(0, 0.45, u) * (1 - HD.smoothstep(0, 1, out));
      const x = cx + 2.5 * (2 * T.noise(t, 2.4 + 0.3 * k, 9840 + k) - 1);
      const y = cy - rise * HD.smoothstep(0, 1, Math.max(0, u)) + 1.2 * (2 * T.noise(t, 2.1 + 0.2 * k, 9850 + k) - 1);
      const w = goalRipple(S, g, x, y);
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
    const bk = W0[1] - W0[0] - 1.2 + 0.4 * q; // lifts off just before the candles are relit
    if (g < bk) return HD.smoothstep(0, 1, (g - a) / G_IN);
    return Math.min(HD.smoothstep(0, 1, (g - a) / G_IN), 1 - HD.smoothstep(0, 1, (g - bk) / G_OUT));
  }

  function storyState(t, S) {
    if (S.t === t) return; // lights() and the mid pass share one evaluation per frame
    S.t = t;
    const s = HD.summer ? HD.summer.sec(t) : t;
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
      let small = f.rest || f.tree ? 1 : 0;
      let m = 0;
      if (f.gather >= 0) {
        m = gatherAmt(s, f.gather);
        if (m > 0) {
          const hv = HOVER[f.slot];
          const tx = CAKE_X + hv[0] + 0.8 * T.wave(t, 2.6 + 0.4 * f.gather, f.ob);
          const ty = WICK_Y + hv[1] + 0.6 * T.wave(t, 2.1 + 0.3 * f.gather, f.ob + 0.25);
          x += (tx - x) * m;
          y += (ty - y) * m - 15 * Math.sin(Math.PI * m); // up and over the party's heads
          // a soft steady glow, like the little flames they stand in for
          const eg = 0.5 + 0.12 * T.wave(t, 1.7 + 0.25 * f.gather, f.ob + 0.5);
          e = e * (1 - m) + eg * m;
          if (m > 0.25) small = 1;
          gm += m;
        }
      }
      if (GW) {
        const w = goalRipple(S, g, x, y);
        e = Math.max(e * RIP_HOLD[0], w);
      }
      if (small && e > 0.66) e = 0.66;
      S.X[i] = x;
      S.Y[i] = y;
      S.E[i] = e;
      S.M[i] = m;
      S.small[i] = small;
    }
    S.gm = gm / HOVER.length;
    S.cheering = GW && S.cheer.length ? cheerState(t, g, S) : false;
  }

  // ---- home: a firefly visits the kid ----
  // family walks her out of the entrance to the door stage, just right of the
  // cat window, and she waits there through HD.summer.kid's 'stay'. A few
  // seconds after she arrives one firefly comes over from the plaza, low
  // along the sidewalk, hovers over her head with a soft steady glow, and
  // drifts back before she goes in.
  const V_AT = 7; // s into her stay
  const V_FLY = 6;
  const V_HOLD = 14;
  function visitState(t) {
    const v = HD.summer && HD.summer.kid ? HD.summer.kid(t) : null;
    if (!v || !v.here || v.phase !== 'stay') return null;
    const v2 = HD.summer.kid(t + 0.05);
    const dur = v2.phase === 'stay' && v2.u > v.u ? 0.05 / (v2.u - v.u) : 60;
    const el = v.u * dur;
    if (el < V_AT || el > V_AT + 2 * V_FLY + V_HOLD || V_AT + 2 * V_FLY + V_HOLD > dur - 3) return null;
    const pl = HD.place();
    const cw = pl.catWindow;
    const st = (pl.stages && pl.stages.door) || { base: 222 };
    const pz = pl.plaza;
    if (!cw || !pz) return null;
    // beside her head, against the dark sidewalk (not the bright shop glass)
    const tx = cw.x + cw.w + 10 + 1.2 * T.wave(t, 3.1, 0.2);
    const ty = st.base - 12 + 0.9 * T.wave(t, 2.3, 0.6);
    const sx = pz.x0 + 4;
    const sy = st.base - 9;
    const u = el - V_AT;
    let m;
    let e;
    if (u < V_FLY) {
      m = HD.smoothstep(0, 1, u / V_FLY);
      e = 0.3 + 0.35 * HD.smoothstep(0, 0.4, u / V_FLY);
    } else if (u < V_FLY + V_HOLD) {
      m = 1;
      e = 0.62 + 0.1 * T.wave(t, 1.9, 0.3);
    } else {
      m = 1 - HD.smoothstep(0, 1, (u - V_FLY - V_HOLD) / V_FLY);
      e = 0.3 + 0.35 * m;
    }
    // low along the sidewalk, bobbing up and down on the way
    const x = sx + (tx - sx) * m;
    const y = sy + (ty - sy) * m + 3 * Math.sin(Math.PI * 3 * m);
    return [x, y, e];
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
  /** a small firefly (resting, in the leaves, or over the cake): a tight glow, never the big bloom */
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

  function storyFireflies(g, t, S) {
    storyState(t, S);
    const F = S.flies;
    // resting and tree ones first (they sit among leaves and grass), then the flying ones
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < F.length; i++) {
        if ((S.small[i] && S.M[i] === 0 ? 0 : 1) !== pass) continue;
        const e = S.E[i];
        if (e < 0.12) continue;
        (S.small[i] ? flySmall : flyPx)(g, R(S.X[i]), R(S.Y[i]), e);
      }
    if (S.cheering)
      for (let k = 0; k < S.cheer.length; k++) if (S.CE[k] >= 0.12) flyPx(g, R(S.CX[k]), R(S.CY[k]), S.CE[k]);
    if (S.cfg.visit) {
      const p = visitState(t);
      if (p) flyPx(g, R(p[0]), R(p[1]), p[2]);
    }
  }

  // Pool strength in 4 flat steps, so a pool changes only now and then
  // (the pools never move; with 5 bands a moving pool crawls every frame).
  const POOL_I = 0.12;
  const steps4 = (k) => Math.round(4 * HD.clamp(k, 0, 1)) / 4;
  const poolK = (sum) => steps4(1 - Math.exp(-0.4 * sum));
  const SZ_S = new Float64Array(32);
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
    for (let z = 0; z < pools.length && z < SZ_S.length; z++) {
      const p = pools[z];
      const k = poolK(SZ_S[z]);
      if (k > 0) L.add({ x: p.x, y: p.y, r: p.r, ry: p.ry, color: HD.LIGHT.firefly, i: POOL_I * k, bands: 5, pow: 2.2 });
    }
    // match: the cheer lights the crowns it lifts out of
    if (S.cheering) {
      let sum = 0;
      for (let k = 0; k < S.cheer.length; k++) sum += S.CE[k];
      const k = poolK(sum);
      if (k > 0) L.add({ x: S.cheerPool[0], y: S.cheerPool[1], r: 40, ry: 22, color: HD.LIGHT.firefly, i: POOL_I * k, bands: 5, pow: 2.2 });
    }
    // home: the visiting firefly lights the kid a little
    if (S.cfg.visit) {
      const p = visitState(t);
      const k = p ? steps4(p[2] / 0.68) : 0;
      if (k > 0) L.add({ x: R(p[0] / 2) * 2, y: R(p[1] / 2) * 2 + 3, r: 16, ry: 12, color: HD.LIGHT.firefly, i: 0.09 * k, bands: 4, pow: 2 });
    }
    // dc: the fireflies over the cake keep a little light on the party while the candles are out
    const gk = steps4(S.gm);
    if (gk > 0) L.add({ x: CAKE_X, y: WICK_Y - 4, r: 30, ry: 22, color: HD.LIGHT.firefly, i: 0.085 * gk, bands: 5, pow: 2 });
  }

  // ------------------------------------------------------------------
  // GULLS over the marina by day: white bodies, pale grey wings with black
  // tips and a yellow bill, flapping in short bursts and gliding between.
  // Soarers wheel slowly over the bay and the promenade, crossers fly the
  // length of the frame now and then, far ones wheel tiny behind the towers
  // (bg), and once a minute one big gull glides close past the camera.
  // Sprites face right (flipped for the left); the anchor is the body.
  // ------------------------------------------------------------------
  // W white, w shaded white, g grey wing, d dark grey, k black tip, y bill
  const GULL_ROWS = {
    // mid gull, ~14 px span, seen from a little below: the classic "M"
    mid: {
      glide: ['..ggw...wgg...', '.g...wWWw..g..', 'k.....WWWy..k.', '..............'],
      up: ['k...........k.', '.g.........g..', '..gg.....gg...', '....gwWwg.....', '.....WWWy.....', '..............'],
      mid: ['..............', 'kgggwwWwwgggk.', '.....WWWy.....', '..............'],
      down: ['..............', '.....wWWw.....', '...ggwWWWygg..', '..g.......g...', '.k.........k..', '..............'],
    },
    // far gull, ~7 px: a soft "m" that blinks to a "v" and a line
    far: {
      glide: ['.d...d.', 'd.dwd.d', '.......'],
      up: ['d.....d', '.d.w.d.', '..ddd..'],
      mid: ['.......', 'dddwddd', '.......'],
      down: ['..ddd..', '.d.w.d.', 'd.....d'],
    },
    // perched gull, side-on, facing left: resting, looking back, calling, stretching a wing
    perch: {
      rest: ['..WW....', '.yWWW...', '...WWgg.', '...wWggk', '....wgk.', '....d.d.'],
      look: ['...WW...', '...WWWy.', '..WWWgg.', '..wWWggk', '...wwgk.', '....d.d.'],
      call: ['.yWW....', 'y.WWW...', '...WWgg.', '...wWggk', '....wgk.', '....d.d.'],
      stretch: ['..WW.g..', '.yWWggg.', '...WWgggk', '...wWgg.', '....wgk.', '....d.d.'],
    },
    // near gull, ~24 px span: long arched wings, a white body with a grey back and a yellow bill
    near: {
      glide: [
        '....gggw.......wggg....',
        '..gggggww.....wwggggg..',
        '.kgg.....wwWWww.....ggk',
        'k.........WWWWWWy......k',
        '...........ddd.........',
      ],
      up: [
        'k.....................k',
        '.kg..................gk.',
        '..ggg..............ggg..',
        '....ggg..........ggg....',
        '......ggww.....wwgg.....',
        '........wwWWWWWww.......',
        '..........WWWWWy........',
        '...........ddd..........',
      ],
      mid: [
        '.......................',
        'kkgggggggwwWWwwgggggggkk',
        '..........WWWWWy........',
        '...........ddd..........',
      ],
      down: [
        '.......................',
        '.........wWWWWw.........',
        '......ggwwWWWWWyw.......',
        '....ggg...ddd....ggg....',
        '..ggg..............ggg..',
        '.kg..................gk.',
        'k.....................k.',
      ],
    },
  };
  const GULL_C = byMode((m) => {
    const base = { W: '#f6f8fa', w: '#d6dde6', g: '#98a3b2', d: '#687484', k: '#23262e', y: '#f0b838' };
    if (m === 'day') return base;
    const tint = m === 'golden' ? ['#ffc890', 0.28] : m === 'dusk' ? ['#9a7aa6', 0.35] : ['#3a4870', 0.6];
    const o = {};
    for (const k in base) o[k] = k === 'k' || k === 'y' ? base[k] : mix(base[k], tint[0], tint[1]);
    return o;
  });
  /** bake every frame of every gull kind per light mode: GULL[mode][kind][frame] = { img, flip } */
  const GULL = {};
  function gullSprites(mode) {
    let o = GULL[mode];
    if (o) return o;
    o = {};
    const pal = GULL_C[mode];
    for (const kind in GULL_ROWS) {
      const K = GULL_ROWS[kind];
      o[kind] = {};
      for (const fr in K) {
        const rows = K[fr];
        // anchor every frame on the bill (far gulls: the white body pixel; a
        // perched gull: its feet), so the body holds still while the wings beat
        let ax = 0;
        let ay = 0;
        rows.forEach((r, y) => {
          const i = r.indexOf('y') >= 0 ? r.indexOf('y') - 2 : r.indexOf('w');
          if (i >= 0 && (r.indexOf('y') >= 0 || !ay)) {
            ax = i;
            ay = y;
          }
        });
        if (kind === 'perch') {
          ay = rows.length - 1;
          ax = rows[ay].indexOf('d');
        }
        const img = HD.sprite(rows, pal);
        // the mirrored copy for flying left (sprite flips go through the
        // canvas transform; a baked mirror keeps the hot path plain)
        const flip = HD.bake(img.width, img.height, (g, c) => {
          const cx = c.getContext('2d');
          cx.translate(img.width, 0);
          cx.scale(-1, 1);
          cx.drawImage(img, 0, 0);
        });
        o[kind][fr] = { img, flip, w: img.width, ax, ay };
      }
    }
    GULL[mode] = o;
    return o;
  }
  const FLAP = ['up', 'mid', 'down', 'mid'];
  /** frame name: a flap burst cycles the wing frames at ~7 fps, else it glides */
  function gullFrame(t, flapping, seed) {
    if (!flapping) return 'glide';
    return FLAP[(Math.floor(T.step(t + 0.031, 7) * 7 + 1e-6) + seed * 2) & 3];
  }
  function drawGull(g, spr, kind, fr, x, y, left) {
    const f = spr[kind][fr];
    g.sprite(left ? f.flip : f.img, R(x) - (left ? f.w - 1 - f.ax : f.ax), R(y) - f.ay);
  }
  // soarers: [cx, cy, rx, ry, period, drift x, drift y, seed]
  // (clear of the title-safe sky, the sun and the towers' tops)
  const SOAR = [
    [96, 128, 34, 8, 23, 18, 10, 1],
    [372, 104, 40, 11, 27, 22, 12, 2],
    [300, 247, 34, 4, 19, 26, 2, 3],
    [452, 174, 22, 6, 17, 10, 6, 4],
  ];
  // far gulls wheel behind the towers: [cx, cy, rx, ry, period, seed]
  const FAR_GULLS = [
    [60, 168, 18, 4, 14, 11],
    [118, 150, 12, 3, 11, 12],
    [356, 150, 16, 4, 16, 13],
    [430, 140, 14, 3, 12, 14],
    [402, 162, 10, 3, 9, 15],
  ];
  const CROSS_N = 3;
  const CROSS_P = perArr(CROSS_N, 34, 46, 9901);
  function gullsOn() {
    const w = HD.edition.weather;
    return w.gulls > 0 && HD.light().day > 0;
  }
  function gullsFar(g, t) {
    const spr = gullSprites(MODE);
    for (const [cx, cy, rx, ry, pd, sd] of FAR_GULLS) {
      const th = TAU * T.phase(t, pd, hash(sd, 1, 9910));
      const x = cx + rx * cos(th) + 6 * (2 * T.noise(t, 31, sd) - 1);
      const y = cy + ry * sin(th) + 3 * (2 * T.noise(t, 23, sd + 50) - 1);
      const left = sin(th) > 0;
      const flapping = T.noise(t, 4.5, sd + 70) > 0.55;
      drawGull(g, spr, 'far', gullFrame(t, flapping, sd), x, y, left);
    }
  }
  function gullsMid(g, t) {
    const spr = gullSprites(MODE);
    for (const [cx, cy, rx, ry, pd, dx, dy, sd] of SOAR) {
      const th = TAU * T.phase(t, pd, hash(sd, 2, 9920));
      const x = cx + rx * cos(th) + dx * (2 * T.noise(t, 41, sd) - 1);
      const y = cy + ry * sin(th) + dy * (2 * T.noise(t, 37, sd + 50) - 1);
      const left = sin(th) > 0; // dx/dth = -rx sin(th)
      // flap in bursts, and always while climbing the near side of the circle
      const flapping = T.noise(t, 5.5, sd + 70) > 0.6 || cos(th) < -0.55;
      drawGull(g, spr, 'mid', gullFrame(t, flapping, sd), x, y, left);
    }
    for (let i = 0; i < CROSS_N; i++) {
      const c = T.cycle(t, i, CROSS_P[i], 9901);
      if (c.age > 0.42) continue;
      const s = c.age / 0.42;
      const toLeft = c.rnd(0) < 0.5;
      const y0 = 88 + c.rnd(1) * 84; // below the title-safe sky all the way across
      const x = toLeft ? W + 14 - (W + 28) * s : -14 + (W + 28) * s;
      const y = y0 + 6 * sin(TAU * (1.3 * s + c.rnd(2))) - 10 * s;
      const flapping = T.noise(t, 4.2, 9930 + i) > 0.5;
      drawGull(g, spr, 'mid', gullFrame(t, flapping, i + 5), x, y, toLeft);
    }
  }
  // perched: two on the marina podium's parapet, on the clear stretches in
  // front of the tower glass (between the palms), the left one looking left,
  // the right one right. [fraction along the podium's top, faces right]
  const PERCH = { marina: [[0.12, false], [0.7, true]] };
  const perches = HD.perEdition((ed) => {
    const pl = HD.PLACES[ed.place];
    const spots = PERCH[pl.id];
    if (!spots) return [];
    // the podium: the widest silhouette block that stands on the ground
    let pod = null;
    for (const r of pl.silhouette) if (r[3] >= BASE && (!pod || r[2] - r[0] > pod[2] - pod[0])) pod = r;
    if (!pod) return [];
    return spots.map(([f, right], k) => [R(pod[0] + (pod[2] - pod[0]) * f), pod[1] - 1, right, k]);
  });
  /** idle: mostly resting, now and then a look back, a call or a wing stretch */
  function perchFrame(t, k) {
    const c = T.cycle(t, k, 8 + 3 * k, 9960);
    const a = c.age * c.P;
    const ev = c.rnd(1);
    const at = 1.5 + c.rnd(2) * (c.P - 4);
    const len = ev < 0.3 ? 0.8 : ev < 0.5 ? 1.1 : 2.6;
    if (a < at || a > at + len) return 'rest';
    if (ev < 0.3) return Math.floor((a - at) * 5) & 1 ? 'call' : 'rest';
    return ev < 0.5 ? 'stretch' : 'look';
  }
  function gullsPerched(g, t) {
    const spr = gullSprites(MODE);
    for (const [x, y, right, k] of perches()) drawGull(g, spr, 'perch', perchFrame(t, k), x, y, right);
  }
  const NEAR_GULL_P = 64;
  function gullsNear(g, t) {
    const c = T.cycle(t, 0, NEAR_GULL_P, 9954);
    if (c.age > 0.24) return;
    const spr = gullSprites(MODE);
    const s = c.age / 0.24;
    // glides in from the right, high, dipping a little and flapping twice
    const x = W + 24 - (W + 48) * s;
    const y = 86 + 14 * Math.sin(Math.PI * s) + 3 * sin(TAU * (2 * s + c.rnd(1)));
    const flapping = (s > 0.18 && s < 0.3) || (s > 0.66 && s < 0.76);
    drawGull(g, spr, 'near', gullFrame(t, flapping, 3), x, y, true);
  }

  // ------------------------------------------------------------------
  // hooks
  // ------------------------------------------------------------------
  // particles queue their pixels per colour (weather.js: SEA.Q) and are
  // flushed before the glowing fireflies and the gull sprites go on top
  SEA.far = function (g, t) {
    syncLight();
    const ed = HD.edition;
    const w = ed.weather;
    const Q = SEA.Q;
    if (w.snow > 0) {
      snowFar(Q, t, w.snow, ed.sky === 'clear');
      SEA.flushQ(g);
    }
    if (gullsOn()) gullsFar(g, t);
  };
  SEA.mid = function (g, t) {
    syncLight();
    const ed = HD.edition;
    const w = ed.weather;
    const Q = SEA.Q;
    if (w.snow > 0) snowMid(Q, t, w.snow, ed.sky === 'clear');
    if (w.leaves > 0) leavesMid(Q, t, w.leaves);
    if (w.petals > 0) petalsMid(Q, t, w.petals);
    SEA.flushQ(g);
    if (w.fireflies > 0) {
      const S = storyFlies();
      if (S) storyFireflies(g, t, S);
    }
    if (gullsOn()) {
      gullsPerched(g, t);
      gullsMid(g, t);
    }
  };
  SEA.near = function (g, t) {
    syncLight();
    const ed = HD.edition;
    const w = ed.weather;
    const Q = SEA.Q;
    if (w.snow > 0) snowNear(Q, t, w.snow, ed.sky === 'clear');
    if (w.leaves > 0) leavesNear(Q, t, w.leaves);
    if (w.petals > 0.3) petalsNear(Q, t, w.petals);
    SEA.flushQ(g);
    if (gullsOn()) gullsNear(g, t);
  };
  SEA.lights = function (t, L) {
    const w = HD.edition.weather;
    if (!(w.fireflies > 0)) return;
    const S = storyFlies();
    if (S) storyLights(t, L, S);
  };
})();
