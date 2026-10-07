/*
 * fire-seasons.js — fireworks and sparklers (Purrfect Year v2).
 *
 *   bg    z 9   fireworks: rockets rise from behind the far city, bursts in
 *               the place's open sky (peony, chrysanthemum, ring, willow,
 *               crackle), a soft banded sky glow per burst. The backdrop
 *               (bg z 10-19) and the buildings are drawn over them, so a far
 *               burst may dip behind the distant skyline
 *   scene z 41  sparkler planter and sticks (tag sparklers)
 *   scene z 45  sparkler burning cores (emissive)
 *   fx    z 36  sparkler fizz: short radiating, forking sparks + halo
 *   lights      one aggregated, coloured flash light per sky pocket for the
 *               live bursts, one small white-gold light per sparkler
 *
 * Shows. Every edition with fireworks > 0 gets a fixed choreography for the
 * whole loop, generated once from its own seed (diwali, newyear, lunar, nyc):
 * launches follow flurries and lulls, at most 3-4 shells are up at once, and
 * colours are dealt from HD.edition.fireworkColors in shuffled groups (never
 * the same colour twice in a row). An edition tagged goal-fireworks (match)
 * gets only a little cheer of three bursts during HD.summer.goal. A shell
 * launched near the end of the loop wraps to its start, so shows loop
 * seamlessly.
 *
 * Placement. Each place has its own sky pockets (PLACE_SKY): New Year's Eve,
 * Diwali and Lunar New Year at apt1 burst over the river in the wide open
 * sky right of the building and, smaller and farther, low over the cinema
 * block on the left; July 4th in soho goes off over the Manhattan skyline on
 * both sides of the hotel tower. Every burst is lifted clear of the
 * building silhouette read from HD.placeTop(x) (the building modules
 * register the exact skyline, neighbours included), kept out of the
 * title-safe sky (HD.layout.titleSafe) and off the moon, and its lower edge
 * stays above the far city (near bursts) so it never reads as a roof or a
 * tower exploding. The show is cached per edition and rebuilt if the place's
 * registered skyline changes. New Year's Eve keeps the sky clear for the
 * brand's logo firework (HD.brand.logoWindow) and answers it with a fan
 * salvo: midnight.
 *
 * Bursts are drawn as clean balls: a solid flash that swells and clears from
 * the inside out into the stars (no dithered flash, no centre cross: they
 * read as glyphs), coloured comet heads with fading tails; a peony may carry
 * a filled pistil of a second colour (a dense inner ball, never a second
 * rim, which reads as an eye or a letter).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const SAFE = HD.layout.titleSafe;
  const MOON = HD.layout.moon;
  const R = Math.round;
  const TAU = Math.PI * 2;
  const tick = (t, fps) => HD._fire.tick(t, fps);

  // ------------------------------------------------------------------
  // colour ramps: 0 = dim ember sinking into the sky ... 6 = white-hot
  // ------------------------------------------------------------------
  const mix = HD.color.mix;
  const SKY = P.night[2];
  const RAMPS = {};
  for (const k in P.firework) {
    const f = P.firework[k];
    RAMPS[k] = [mix(f[0], SKY, 0.5), f[0], mix(f[0], f[1], 0.5), f[1], mix(f[1], f[2], 0.45), f[2], mix(f[2], '#ffffff', 0.6)];
  }
  {
    // a blue whose dim end stays visible on the navy sky instead of sinking into it
    const f = P.firework.blue;
    const b0 = mix(f[1], SKY, 0.35);
    RAMPS.blue = [mix(b0, SKY, 0.35), b0, mix(b0, f[1], 0.5), f[1], mix(f[1], f[2], 0.45), f[2], mix(f[2], '#ffffff', 0.6)];
    // violet the same way
    const v = P.firework.violet;
    const v0 = mix(v[1], SKY, 0.4);
    RAMPS.violet = [mix(v0, SKY, 0.35), v0, mix(v0, v[1], 0.5), v[1], mix(v[1], v[2], 0.45), v[2], mix(v[2], '#ffffff', 0.6)];
  }
  // glitter willow: gold that leans to amber and red as it cools
  RAMPS.willow = [mix(P.fire[2], SKY, 0.5), P.fire[3], P.fire[5], P.amber[5], P.gold[5], P.gold[6], '#fff8e0'];
  // silver-white glitter (July 4th willows: an amber willow reads as an
  // orange jellyfish in a red, white and blue show)
  {
    const n = P.night;
    RAMPS.silver = [mix(n[7], SKY, 0.3), n[8], n[10], n[11], n[12], '#eef2fb', '#ffffff'];
  }
  // rocket comet tail
  const TAIL = [mix(P.fire[2], SKY, 0.4), P.fire[4], P.fire[6], P.amber[6], P.amber[8]];

  // ------------------------------------------------------------------
  // the open sky of each place: where bursts go
  //   rise      y the rockets start from (hidden behind the far city)
  //   horizon   the lowest y a near burst's lower edge may reach (it stays
  //             above the far city); far bursts may sink to farHorizon
  //   zones     sky pockets: [x0, x1] holds the whole burst, [y0, y1] the
  //             burst centre band, w the share of the show, rk the size
  //             scale (small = far away), noWillow keeps long trails out
  //   clips     per light group, where the bursts' flash relights the scene
  // ------------------------------------------------------------------
  const PLACE_SKY = {
    // Boston, apt1: over the river right of the building (wide open sky
    // above the plaza and the far city), small and far over the cinema
    // block on the left (under the title-safe sky), and now and then a
    // small high one over the roof
    apt1: {
      rise: 198,
      riverRise: 150,
      horizon: 128,
      farHorizon: 140,
      zones: [
        { x0: 328, x1: 478, y0: 12, y1: 100, w: 0.62, rk: 1, front: true },
        { x0: 4, x1: 142, y0: 76, y1: 98, w: 0.24, rk: 0.62 },
        { x0: 176, x1: 322, y0: 8, y1: 26, w: 0.14, rk: 0.52, noWillow: true },
      ],
    },
    // New York, soho: over the Manhattan skyline right of the hotel tower
    // (the big pocket) and left of it, low under the title-safe sky
    soho: {
      rise: 198,
      horizon: 116,
      farHorizon: 134,
      zones: [
        { x0: 282, x1: 478, y0: 10, y1: 96, w: 0.64, rk: 1 },
        { x0: 4, x1: 190, y0: 76, y1: 100, w: 0.36, rk: 0.72 },
      ],
    },
  };
  // anywhere else: a generic sky above the place's silhouette
  const DEFAULT_SKY = {
    rise: 198,
    horizon: 130,
    farHorizon: 150,
    zones: [{ x0: 4, x1: 478, y0: 10, y1: 110, w: 1, rk: 1 }],
  };

  // ------------------------------------------------------------------
  // show settings per edition
  //   mix       burst type weights; rate launches/s at a flurry's peak
  //   R         [base, var] star radius (scaled by depth and the zone)
  //   colors    used when the edition gives no fireworkColors
  //   pistil    chance a peony carries a filled pistil of a second colour
  //   willow    ramp of the willows
  //   gold      for a tricolour show: gold on about one shell in this many
  //   triple    July 4th: after each anniversary heart, a red-white-blue
  //             triple sweeps across the left sky ([zone, x, height 0..1, colour])
  //   salvo     New Year's Eve: a fan of four shells right after the logo
  //             firework (midnight) and again half a loop later
  // ------------------------------------------------------------------
  const TYPE_LIFE = { peony: 2.7, chrys: 3.1, ring: 2.5, willow: 4.6, crackle: 3.0 };
  const DRAG = { peony: 0.3, chrys: 0.36, ring: 0.28, willow: 0.5, crackle: 0.26 };
  const GRAV = { peony: 8, chrys: 7, ring: 5, willow: 15, crackle: 6 };
  const SHOW_CFG = {
    diwali: {
      mix: { peony: 3.2, chrys: 2.6, ring: 1.4, willow: 1.2, crackle: 1.6 },
      R: [14, 10],
      pistil: 0.3,
      willow: 'willow',
    },
    newyear: {
      mix: { peony: 3.2, chrys: 2.4, ring: 1.6, willow: 1.3, crackle: 1.5 },
      R: [14, 11],
      flurry: [24, 18],
      lull: [3, 3],
      colors: ['gold', 'white', 'gold', 'violet', 'white', 'blue'],
      pistil: 0.25,
      willow: 'willow',
      salvo: true,
      logoQuiet: true,
    },
    lunar: {
      mix: { peony: 4, chrys: 3, ring: 0.8, willow: 1, crackle: 2.2 },
      R: [14, 10],
      pistil: 0.3,
      willow: 'willow',
    },
    nyc: {
      mix: { peony: 5, chrys: 1.3, ring: 1.8, willow: 0.4, crackle: 0.45 },
      rate: 1,
      cap: 4,
      R: [12, 10],
      palette: ['red', 'white', 'blue'],
      gold: 10,
      pistil: 0,
      willow: 'silver',
      glow: { white: [0.74, 0.8, 1] },
      triple: [
        [1, 30, 0.5, 'red'],
        [1, 96, 0.1, 'white'],
        [1, 160, 0.45, 'blue'],
      ],
      tripleFallback: [66.5, 186.5],
      quiet: [6, 10],
    },
  };
  const DEFAULT_CFG = { mix: { peony: 3, chrys: 2, ring: 1.5, willow: 1.2, crackle: 1.5 }, R: [12, 9], pistil: 0.25, willow: 'willow' };
  // the Match Night goal cheer: [launch offset in the goal window (s), type,
  // x, y, star radius, colour, opts]. Red and gold for the jersey, a white
  // starburst between them; high over the plaza where her friends cheer
  const GOAL = {
    apt1: [
      [0.3, 'peony', 356, 76, 15, 'gold', { nk: 0.9 }],
      [1.05, 'peony', 450, 64, 15, 'red', { nk: 0.9 }],
      [1.85, 'chrys', 378, 24, 13, 'white', { nk: 0.9, fill: true, thin: true, sag: 1.25 }],
    ],
    fallback: [[150, 158]],
  };

  // ------------------------------------------------------------------
  // placement
  // ------------------------------------------------------------------
  function expand(tau, k) {
    return 1 - Math.exp(-tau / k);
  }
  function droop(tau, G) {
    return (G * tau * tau) / (1 + 0.7 * tau);
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  function pickType(types, u) {
    for (const t of types) if (u < t[1]) return t[0];
    return 'peony';
  }

  /** column tops of the place's buildings (OPEN where the sky runs down to the street) */
  const OPEN = 1e4;
  function columnTops(pl) {
    const top = new Float32Array(HD.W);
    for (let x = 0; x < HD.W; x++) {
      const y = HD.placeTop(x, pl);
      top[x] = y >= 999 ? OPEN : y;
    }
    return top;
  }

  /** column tops of the far city behind the place (HD.backdrops.top answers for HD.edition), or null */
  function backdropTops(ed) {
    if (!HD.backdrops || !HD.backdrops.top) return null;
    const prev = HD.edition;
    try {
      HD.edition = ed;
      const top = new Float32Array(HD.W);
      for (let x = 0; x < HD.W; x++) {
        const y = HD.backdrops.top(x);
        top[x] = y >= 999 ? OPEN : y;
      }
      return top;
    } catch (e) {
      return null;
    } finally {
      HD.edition = prev;
    }
  }

  // the part of a burst that must clear the roofs: half width, lower half
  // height and the centre's sag under gravity around mid-life
  function footprint(sh) {
    const Rr = sh.R;
    let hw = Rr;
    let vb = 0.9 * Rr;
    let drop = droop(0.5 * sh.life, GRAV[sh.type] * (sh.sag || 1) * 1.15);
    if (sh.type === 'ring') {
      const c = Math.cos(sh.rot);
      const s = Math.sin(sh.rot);
      hw = Rr * Math.hypot(c, sh.tilt * s);
      vb = Rr * Math.hypot(s, sh.tilt * c);
    } else if (sh.type === 'willow') {
      // the trails hang: count most of their fall
      vb = 0.75 * Rr;
      drop = droop(0.7 * sh.life, GRAV.willow) - 0.2 * Rr;
    } else if (sh.type === 'crackle') {
      hw += 4;
      vb += 4;
    }
    return [hw + 2, vb, drop];
  }
  /** the lowest burst centre (largest y) at bx that keeps the footprint clear of roofs and the far city */
  function byLimit(s, bx, fp, far, front) {
    const hw = fp[0];
    let lim = (far ? s.sky.farHorizon : s.sky.horizon) - fp[1] - fp[2];
    const top = s.top;
    // a near burst behind the far city may dip only a third of its radius
    // behind the distant skyline (HD.backdrops.top); one in front of it
    // (over the river) and a far one need not
    const bt = !far && !front ? s.btop : null;
    const dip = 0.35 * (hw - 2);
    for (let x = Math.max(0, Math.floor(bx - hw)); x <= Math.min(HD.W - 1, Math.ceil(bx + hw)); x++) {
      const u = (x - bx) / hw;
      const k = 1 - u * u;
      if (k <= 0) continue;
      const tp = top[x];
      if (tp < OPEN) {
        const y = tp - 4 - fp[2] - fp[1] * Math.sqrt(k);
        if (y < lim) lim = y;
      }
      if (bt && bt[x] < OPEN) {
        const y = bt[x] + dip - fp[2] - fp[1] * Math.sqrt(k);
        if (y < lim) lim = y;
      }
    }
    return lim;
  }

  /**
   * Place a burst: pick one of the place's sky pockets (or opt.zone), take
   * that pocket's size, then try candidate spots: lifted clear of the roofs
   * and the far city, outside the title-safe sky, off the moon, and spread away from the bursts that share the sky with it. Falls
   * back to the other pockets, then to a smaller shell. Records the pocket
   * in sh.zone (the scene light is aggregated per pocket).
   */
  function placeShell(sh, s, rnd, others, opt) {
    const zs = s.sky.zones;
    let zi = opt && opt.zone !== undefined ? opt.zone : -1;
    if (zi < 0) {
      const u = rnd();
      let acc = 0;
      zi = zs.length - 1;
      for (let i = 0; i < zs.length; i++)
        if (u < (acc += zs[i].w)) {
          zi = i;
          break;
        }
    }
    const R0 = sh.R;
    for (let zt = 0; zt < zs.length; zt++) {
      const zIdx = (zi + zt) % zs.length;
      const z = zs[zIdx];
      if (z.noWillow && sh.type === 'willow') continue;
      sh.R = R0 * z.rk;
      const far = sh.far || z.rk < 0.7;
      for (let tries = 0; tries < 4; tries++) {
        const Rr = sh.R;
        const fp = footprint(sh);
        const xMin = z.x0 + fp[0];
        const xMax = z.x1 - fp[0];
        const yMin = z.y0 + Rr * 0.9;
        const yMax = Math.max(yMin, z.y1 - Rr * 0.2);
        let best = null;
        let bestScore = Infinity;
        if (xMax > xMin)
          for (let c = 0; c < 24; c++) {
            const bx = opt && opt.tx !== undefined ? Math.min(xMax, Math.max(xMin, opt.tx + (rnd() - 0.5) * 10)) : xMin + rnd() * (xMax - xMin);
            const yk = opt && opt.ty !== undefined ? clamp01(opt.ty + (rnd() - 0.5) * 0.1) : clamp01((1 - sh.depth) * 0.42 + rnd() * 0.5);
            let by = yMin + yk * (yMax - yMin);
            const lim = byLimit(s, bx, fp, far, !!z.front);
            if (lim < yMin) continue; // no room above the roofs here
            let score = rnd() * 0.4;
            if (by > lim) {
              score += (by - lim) * 0.03;
              by = lim;
            }
            if (bx - fp[0] < SAFE.x1 + 6 && by - Rr < SAFE.y1 + 6) continue; // title-safe sky stays calm
            if (s.moon && Math.hypot(bx - s.moon.x, by - s.moon.y) < Rr * 0.4 + s.moon.r + 3) continue; // no burst centred on the moon
            for (const o of others) {
              const need = (Rr + o.R) * 0.95;
              const d = Math.hypot(bx - o.bx, by - o.by);
              if (d < need) score += ((need - d) / need) * 4;
              score += 0.8 * Math.max(0, 1 - d / 100);
            }
            if (score < bestScore) {
              bestScore = score;
              best = [bx, by];
            }
          }
        if (best) {
          sh.bx = best[0];
          sh.by = best[1];
          sh.zone = zIdx;
          sh.front = !!z.front;
          if (z.rk < 0.7) sh.far = true;
          return true;
        }
        sh.R *= 0.86;
      }
    }
    return false;
  }

  function edSeed(id) {
    let h = 7;
    for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
    return h;
  }

  /** [start, end) windows (loop seconds) where fn(t) >= 0, or null */
  function windowsOf(fn) {
    if (typeof fn !== 'function') return null;
    const L = HD.LOOP;
    const dt = 0.05;
    const out = [];
    let a = -1;
    for (let k = 0, n = Math.round(L / dt); k <= n; k++) {
      const t = Math.min(L, k * dt);
      const on = k < n && fn(t) >= 0;
      if (on && a < 0) a = t;
      else if (!on && a >= 0) {
        out.push([a, t]);
        a = -1;
      }
    }
    return out.length ? out : null;
  }

  // ------------------------------------------------------------------
  // building a show
  // ------------------------------------------------------------------
  const GLOW = {
    gold: [1, 0.62, 0.22],
    red: [1, 0.26, 0.16],
    green: [0.26, 1, 0.42],
    blue: [0.26, 0.46, 1],
    violet: [0.62, 0.3, 1],
    magenta: [1, 0.26, 0.66],
    white: [1, 0.78, 0.5], // white shells glow warm
    willow: [1, 0.56, 0.2],
    silver: [0.74, 0.8, 1],
  };

  /**
   * The moon disc of an edition {x, y, r} or null: the sky module's own
   * (HD.sky.moon() answers for HD.edition, so it is asked with the edition
   * swapped in for a moment), else the shared layout anchor.
   */
  function moonFor(ed) {
    if (!ed.moon || ed.moon === 'none') return null;
    if (HD.sky && HD.sky.moon) {
      const prev = HD.edition;
      try {
        HD.edition = ed;
        const m = HD.sky.moon();
        if (m) return { x: m.x, y: m.y, r: m.r };
      } catch (e) {
        // fall back to the layout anchor
      } finally {
        HD.edition = prev;
      }
    }
    return { x: MOON.x, y: MOON.y, r: ed.moon === 'crescent' ? 10 : MOON.r };
  }

  function emptyShow(ed, pl) {
    return {
      f: 0,
      list: [],
      sky: PLACE_SKY[pl.id] || DEFAULT_SKY,
      top: columnTops(pl),
      btop: backdropTops(ed),
      moon: moonFor(ed),
      glow: GLOW,
      lightK: 1,
      salvos: [],
      skyline: pl.skyline,
    };
  }

  /** the Match Night goal cheer: three small bursts inside HD.summer.goal */
  function buildGoalShow(ed, pl) {
    const s = emptyShow(ed, pl);
    s.lightK = 2;
    s.glow = Object.assign({}, GLOW, { white: GLOW.silver });
    const spots = GOAL[pl.id];
    if (!spots) return s;
    const wins = windowsOf(HD.summer && HD.summer.goal) || GOAL.fallback;
    const seed = edSeed(ed.id);
    let idx = 0;
    for (const [a] of wins)
      for (const [dt, type, x, y, Rr, col, o] of spots) {
        const k = idx++;
        const op = o || {};
        s.list.push({
          type,
          t0: a + dt,
          rise: 0.8,
          life: TYPE_LIFE[type] * 0.78,
          seed: (Math.imul(seed, 131) + k * 977 + 17) | 0,
          depth: 0.5,
          far: false,
          nk: op.nk || 0.8,
          fill: !!op.fill,
          thin: !!op.thin,
          sag: op.sag || 1,
          R: Rr,
          col,
          col2: null,
          tilt: 0.5,
          rot: 0,
          sway: (HD.hash(seed, k, 5) - 0.5) * 6,
          bx: x,
          by: y,
          zone: 0,
          front: !!s.sky.zones[0].front,
          tau: 0,
        });
      }
    s.list.sort((p, q) => p.t0 - q.t0);
    return s;
  }

  function buildShow(ed, pl) {
    const f = clamp01(ed.fireworks || 0);
    if (!f) return ed.tagSet && ed.tagSet.has('goal-fireworks') ? buildGoalShow(ed, pl) : emptyShow(ed, pl);
    const cfg = SHOW_CFG[ed.id] || DEFAULT_CFG;
    const s = emptyShow(ed, pl);
    s.f = f;
    if (cfg.glow) s.glow = Object.assign({}, GLOW, cfg.glow);
    const types = [];
    let sum = 0;
    for (const k of ['peony', 'chrys', 'ring', 'willow', 'crackle']) {
      sum += cfg.mix[k];
      types.push([k, sum]);
    }
    for (const t of types) t[1] /= sum;
    const size = 0.84 + 0.3 * f;
    const colors = ed.fireworkColors && ed.fireworkColors.length ? ed.fireworkColors : cfg.colors || ['gold', 'white'];
    const L = HD.LOOP;
    const seed = edSeed(ed.id);
    const rnd = HD.rng(6060 ^ seed);
    const list = s.list;
    const cap = cfg.cap || (f >= 0.9 ? 5 : 4);
    const brk = (sh) => sh.t0 + sh.rise;
    const total = (sh) => sh.rise + sh.life;
    const wrap = (d) => d - Math.floor(d / L) * L;
    const liveAt = (sh, p) => wrap(p - sh.t0) < total(sh);
    const countAt = (p) => {
      let n = 0;
      for (const o of list) if (liveAt(o, p)) n++;
      return n;
    };
    // bursts sharing the sky with sh (overlapping bright phases, or close in time)
    const near = (sh) => {
      const out = [];
      const b = brk(sh);
      for (const o of list) {
        const d = wrap(brk(o) - b);
        if (Math.min(d, L - d) < 7) out.push(o);
      }
      return out;
    };
    let idx = 0;
    const shell = (t0, type) => {
      const depth = rnd();
      const rise = 1.15 + rnd() * 0.6;
      const life = TYPE_LIFE[type] * (0.92 + 0.16 * rnd());
      return {
        type,
        t0,
        rise,
        life,
        seed: (Math.imul(seed, 131) + idx++ * 977 + 17) | 0,
        depth,
        far: depth < 0.2,
        R: (type === 'willow' ? cfg.R[0] + 5 + 4 * depth : cfg.R[0] + cfg.R[1] * depth) * size * (type === 'crackle' ? 0.85 : 1),
        col: type === 'willow' ? cfg.willow : null,
        col2: null,
        pistil: type === 'peony' && rnd() < (cfg.pistil || 0),
        fixed: false,
        tilt: 0.35 + 0.45 * rnd(),
        rot: (rnd() - 0.5) * 1.2,
        sway: (rnd() - 0.5) * 14,
        bx: 0,
        by: 0,
        zone: 0,
        tau: 0,
      };
    };

    // quiet windows: the brand's logo firework (New Year's Eve) and the
    // July 4th triple stand alone
    const quietWins = [];
    const logo = cfg.logoQuiet && ed.tagSet && ed.tagSet.has('logo-firework') && HD.brand && HD.brand.logoWindow;
    if (logo) quietWins.push([logo[0] - 3.5, logo[1] + 0.5]);
    // New Year's Eve salvo: a fan of four shells right after the logo (or a
    // quarter into the loop without one), and again half a loop later
    const salvoAt = cfg.salvo ? (logo ? [logo[1] + 0.6, wrap(logo[1] + 0.6 + L / 2)] : [L * 0.25, L * 0.75]) : [];
    s.salvos = salvoAt.slice();
    const pal = cfg.palette || colors;
    for (const ts of salvoAt) {
      const ringFirst = rnd() < 0.5;
      const c0 = pal[Math.floor(rnd() * pal.length) % pal.length];
      let c1 = pal[Math.floor(rnd() * pal.length) % pal.length];
      if (c1 === c0) c1 = pal[(pal.indexOf(c0) + 1) % pal.length];
      const mine = [];
      const z = s.sky.zones[0];
      for (let k = 0; k < 4; k++) {
        const type = (k + (ringFirst ? 0 : 1)) % 2 === 0 ? 'ring' : 'peony';
        const sh = shell(ts + k * 0.5, type);
        sh.rise = 1.3;
        sh.life = TYPE_LIFE[type];
        sh.depth = 0.55;
        sh.far = false;
        sh.R = (cfg.R[0] + cfg.R[1] * 0.4) * size * (0.92 + 0.16 * rnd());
        sh.col = k & 1 ? c1 : c0;
        sh.pistil = type === 'peony';
        sh.col2 = type === 'peony' ? (k & 1 ? c0 : c1) : null;
        sh.fixed = true;
        sh.tilt = 0.3 + 0.45 * rnd();
        sh.rot = (rnd() - 0.5) * 1.1;
        sh.sway = (k - 1.5) * 8;
        const ty = k & 1 ? 0.55 + 0.15 * rnd() : 0.08 + 0.15 * rnd();
        const tx = z.x0 + 20 + ((k + 0.5) / 4) * (z.x1 - z.x0 - 40);
        if (placeShell(sh, s, rnd, mine, { zone: 0, tx, ty })) {
          mine.push(sh);
          list.push(sh);
        }
      }
      quietWins.push([ts - 3, ts + 8]);
    }
    // the July 4th triple, launched as each anniversary heart finishes rising
    if (cfg.triple) {
      const hw = windowsOf(HD.summer && HD.summer.heart);
      const tripleAt = hw ? hw.map((w) => w[1] + 0.4) : cfg.tripleFallback;
      for (const ts of tripleAt) {
        const mine = [];
        cfg.triple.forEach(([zone, tx, ty, col], k) => {
          const sh = shell(ts + k * 0.6, 'peony');
          sh.rise = 1.3;
          sh.life = TYPE_LIFE.peony * 1.05;
          sh.depth = 0.6;
          sh.far = false;
          sh.pistil = false;
          sh.R = (cfg.R[0] + cfg.R[1] * 0.6) * size;
          sh.col = col;
          sh.fixed = true;
          sh.sway = (k - 1) * 6;
          if (placeShell(sh, s, rnd, mine, { zone, tx, ty })) {
            mine.push(sh);
            list.push(sh);
          }
        });
        quietWins.push([ts - cfg.quiet[0], ts + cfg.quiet[1]]);
      }
    }
    const quiet = (t) => {
      for (const [a, b] of quietWins) {
        const d = wrap(t - a);
        if (d < b - a) return true;
      }
      return false;
    };
    // density envelope: flurries that swell and fade, separated by lulls of
    // ~8-14 s, tiling the loop exactly (so the show loops seamlessly)
    const segs = [];
    let acc = 0;
    const FL = cfg.flurry || [20, 20];
    const LU = cfg.lull || [4, 4];
    while (acc < L) {
      const fl = FL[0] + FL[1] * rnd();
      const lu = LU[0] + LU[1] * rnd();
      segs.push(fl, lu);
      acc += fl + lu;
    }
    const ends = [];
    let cum = 0;
    for (const d of segs) ends.push((cum += (d * L) / acc));
    const segOff = rnd() * L;
    const buildUp = (t) => {
      for (const ts of salvoAt) {
        const d = wrap(ts - t);
        if (d > 3 && d < 18) return true;
      }
      return false;
    };
    const env = (t) => {
      if (buildUp(t)) return 0.9;
      const u = wrap(t - segOff);
      let a0 = 0;
      for (let i = 0; i < ends.length; i++) {
        if (u < ends[i]) {
          if (i & 1) return 0.02; // lull
          const x = (u - a0) / (ends[i] - a0);
          return 0.5 + 0.5 * Math.sin(Math.PI * x);
        }
        a0 = ends[i];
      }
      return 0.02;
    };
    const rateMax = cfg.rate || (28 + 52 * f) / 60;
    let t = rnd() * 2;
    for (let guard = 0; guard < 5000; guard++) {
      t += -Math.log(1 - rnd() * 0.999) / rateMax;
      if (t >= L) break;
      if (rnd() > env(t) || quiet(t)) continue;
      const sh = shell(t, pickType(types, rnd()));
      // the burst must not still be bright when a quiet window opens
      let ok = countAt(t) < cap && !quiet(t + sh.rise + 1.2);
      for (let i = 0; ok && i < list.length; i++) {
        const o = list[i];
        const db = wrap(brk(o) - brk(sh));
        if (Math.min(db, L - db) < 0.4) ok = false;
        else if (wrap(o.t0 - t) < total(sh) && countAt(o.t0) >= cap) ok = false;
      }
      if (!ok) continue;
      if (placeShell(sh, s, rnd, near(sh), null)) list.push(sh);
    }
    // no lull longer than maxIdle (outside the quiet windows): a lone shell
    // goes up in the middle of any longer one
    const maxIdle = f >= 0.9 ? 14 : 16;
    for (let guard = 0; guard < 24; guard++) {
      const iv = [];
      for (const o of list) {
        const e = o.t0 + total(o);
        if (e <= L) iv.push([o.t0, e]);
        else iv.push([o.t0, L], [0, e - L]);
      }
      iv.sort((p, q) => p[0] - q[0]);
      let gs = 0;
      let gl = 0;
      let end = iv.length ? iv[iv.length - 1][1] - L : 0;
      for (const [a0, a1] of iv) {
        if (a0 - end > gl && !quiet(end + (a0 - end) * 0.5)) {
          gl = a0 - end;
          gs = end;
        }
        if (a1 > end) end = a1;
      }
      if (iv.length && iv[0][0] + L - end > gl && !quiet(end + (iv[0][0] + L - end) * 0.5)) {
        gl = iv[0][0] + L - end;
        gs = end;
      }
      if (gl <= maxIdle) break;
      const sh = shell(wrap(gs + gl * 0.5 - 1.5), pickType(types, rnd()));
      if (placeShell(sh, s, rnd, near(sh), null)) list.push(sh);
      else break;
    }
    list.sort((a, b) => a.t0 - b.t0);
    dealColors(s, cfg, pal, seed);
    return s;
  }

  /**
   * Deal colours in launch order: the palette goes round in seeded groups (a
   * fresh shuffle per group, never the same colour twice in a row), gold now
   * and then in a tricolour show; pistils take the next colour of the bag.
   */
  function dealColors(s, cfg, pal, seed) {
    const crnd = HD.rng(seed ^ 0x2c5e);
    let bag = [];
    let last = null;
    let sinceGold = 0;
    const uniq = [...new Set(pal)];
    const deal = () => {
      const g3 = pal.slice();
      for (let i = g3.length - 1; i > 0; i--) {
        const j = Math.floor(crnd() * (i + 1));
        const tmp = g3[i];
        g3[i] = g3[j];
        g3[j] = tmp;
      }
      return g3;
    };
    for (const sh of s.list) {
      if (sh.fixed || sh.col) {
        if (sh.pistil && !sh.col2) sh.col2 = uniq.find((c) => c !== sh.col && c !== 'white') || null;
        last = sh.col;
        continue;
      }
      sinceGold++;
      if (cfg.gold && sinceGold > cfg.gold - 2 && crnd() < 0.34) {
        sh.col = 'gold';
        sinceGold = 0;
        last = 'gold';
        continue;
      }
      if (!bag.length) bag = deal();
      let i = bag.findIndex((c) => c !== last);
      if (i < 0) {
        bag = bag.concat(deal());
        i = bag.findIndex((c) => c !== last);
      }
      sh.col = bag.splice(i, 1)[0];
      last = sh.col;
      if (sh.pistil) {
        // a pistil in a contrasting colour from the same palette
        const alt = uniq.filter((c) => c !== sh.col);
        sh.col2 = alt.length ? alt[Math.floor(crnd() * alt.length)] : null;
        if (!sh.col2) sh.pistil = false;
      }
    }
  }

  // built once per edition (~10 ms), prewarmed in init() so a live edition
  // switch never hitches; rebuilt if the place registers a new skyline
  const SHOWS = new Map();
  function showFor(ed) {
    const pl = HD.PLACES[ed.place] || HD.place();
    let s = SHOWS.get(ed.id);
    if (!s || s.skyline !== pl.skyline) SHOWS.set(ed.id, (s = buildShow(ed, pl)));
    return s;
  }
  const show = () => showFor(HD.edition);

  // live shells at t (tau = time since launch), shared by lights() and the draw pass
  const LIVE = [];
  let liveT = NaN;
  let liveS = null;
  function liveShells(t, s) {
    if (t === liveT && s === liveS) return LIVE;
    liveT = t;
    liveS = s;
    LIVE.length = 0;
    const L = HD.LOOP;
    const tt = ((t % L) + L) % L;
    for (const sh of s.list) {
      let d = tt - sh.t0;
      if (d < 0) d += L;
      if (d < sh.rise + sh.life) {
        sh.tau = d;
        LIVE.push(sh);
      }
    }
    return LIVE;
  }

  // ------------------------------------------------------------------
  // burst drawing
  // ------------------------------------------------------------------
  function drawRocket(g, sh, t, riseY) {
    const u = Math.min(1, sh.tau / sh.rise);
    const x0 = sh.bx + sh.sway;
    const ease = (v) => 1 - (1 - v) * (1 - v);
    const pos = (v) => {
      const e = ease(Math.max(0, v));
      return [x0 + (sh.bx - x0) * e, riseY + (sh.by - riseY) * e];
    };
    const tk = tick(t, 15);
    // sparkly tail: older samples dimmer, a few blink out
    for (let k = 6; k >= 1; k--) {
      const v = u - k * 0.028;
      if (v < 0) continue;
      if (k > 2 && HD.hash(sh.seed, k, tk) < 0.35) continue;
      const [x, y] = pos(v);
      const lv = Math.max(0, 4 - Math.ceil(k * 0.7));
      g.px(R(x), R(y), TAIL[lv]);
    }
    const [hx, hy] = pos(u);
    g.px(R(hx), R(hy), TAIL[4]);
    if (u < 0.85) g.px(R(hx), R(hy) + 1, TAIL[2]);
  }

  // a comet streak from (x0,y0) (tail) to (x1,y1) (head, not drawn: heads go
  // in a second pass so no tail ever paints over a brighter head). The tail
  // fades `fade` levels; levels below minL are skipped
  function streak(g, x0, y0, x1, y1, rp, lv, fade, minL) {
    x0 = R(x0);
    y0 = R(y0);
    x1 = R(x1);
    y1 = R(y1);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s < n; s++) {
      const u = s / n;
      const l = lv - Math.ceil((1 - u) * fade);
      if (l < minL) continue;
      g.px(R(x0 + (x1 - x0) * u), R(y0 + (y1 - y0) * u), rp[l]);
    }
  }

  // head brightness over a star's life u (0..1)
  function headLvl(u) {
    return u < 0.09 ? 6 : u < 0.3 ? 5 : u < 0.52 ? 4 : u < 0.7 ? 3 : u < 0.83 ? 2 : u < 0.93 ? 1 : 0;
  }

  // second-pass head list: x, y, colour, and an optional trailing direction
  // for the fat 2x2 heads of fresh near stars
  const HX = new Int16Array(512);
  const HY = new Int16Array(512);
  const HC = new Array(512);
  const HC2 = new Array(512);
  const HTX = new Int8Array(512);
  const HTY = new Int8Array(512);
  let HN = 0;
  function head(x, y, c, c2, tx, ty) {
    if (HN >= 512) return;
    HX[HN] = R(x);
    HY[HN] = R(y);
    HC[HN] = c;
    HC2[HN] = c2;
    HTX[HN] = tx;
    HTY[HN] = ty;
    HN++;
  }
  function flushHeads(g) {
    for (let i = 0; i < HN; i++) {
      if (!HC2[i]) continue;
      const x = HX[i];
      const y = HY[i];
      g.px(x + HTX[i], y, HC2[i]);
      g.px(x, y + HTY[i], HC2[i]);
      g.px(x + HTX[i], y + HTY[i], HC2[i]);
    }
    for (let i = 0; i < HN; i++) g.px(HX[i], HY[i], HC[i]);
    HN = 0;
  }

  function drawBurst(g, sh, t) {
    const tb = sh.tau - sh.rise;
    const type = sh.type;
    const ramp = RAMPS[sh.col] || RAMPS.gold;
    const ramp2 = sh.pistil && sh.col2 ? RAMPS[sh.col2] : null;
    const k = DRAG[type];
    const G = GRAV[type] * (sh.sag || 1);
    const Rr = sh.R;
    const dim = sh.far ? 1 : 0;
    const tk = tick(t, 12);
    const cx = sh.bx;
    const cy = sh.by;
    const cr = Math.cos(sh.rot);
    const sr = Math.sin(sh.rot);
    const rot0 = HD.hash(sh.seed, 3, 9) * TAU;
    // the spokes stay as bright as the flash while the flash is up
    const minL = tb < 0.35 ? 3 - dim : tb < 0.9 ? 2 : 0;
    HN = 0;

    // break: a solid white-hot ball while it swells, then it collapses to a
    // small core as the spokes fly out of it (no ring, no hole: an O or a
    // dark glyph inside the brightest moment reads as a letter)
    // (drawn after the stars, so no dim tail pixel ever marks the ball)
    const flash = () => {
      if (tb >= 0.17) return;
      const rb = Math.max(1, expand(Math.min(tb, 0.08), k) * Rr * 0.75);
      if (tb < 0.08) {
        g.circle(cx, cy, rb, ramp[5 - dim]);
        if (rb > 2) g.circle(cx, cy, rb * 0.5, ramp[6 - dim]);
      } else g.circle(cx, cy, Math.max(1.3, rb * (1 - (tb - 0.08) / 0.11)), ramp[5 - dim]);
    };

    // shells: [count, radius scale, ramp, life scale, filled]
    const shells = [];
    const nk = (sh.far ? 0.7 : 1) * (sh.nk || 1);
    if (type === 'ring') shells.push([Math.round((24 + Rr * 0.6) * nk), 1, ramp, 1, false]);
    else if (type === 'willow') shells.push([Math.round((20 + Rr * 0.5) * nk), 1, ramp, 1, false]);
    else if (type === 'crackle') shells.push([Math.round((18 + Rr * 0.6) * nk), 1, ramp, 0.5, false]);
    else {
      shells.push([Math.round((22 + Rr * 0.8) * nk), 1, ramp, 1, !!sh.fill]);
      // the pistil: a dense filled inner ball of a second colour
      if (ramp2) shells.push([Math.round((20 + Rr * 0.6) * nk), 0.4, ramp2, 0.7, true]);
    }
    // the chrysanthemum's trail only starts once the stars have left the core
    const tC = -k * Math.log(0.8);

    for (let si = 0; si < shells.length; si++) {
      const [n, rs, rp, ls, filled] = shells[si];
      const inner = si > 0;
      for (let j = 0; j < n; j++) {
        const h1 = HD.hash(sh.seed, j, 21 + si);
        const h2 = HD.hash(sh.seed, j, 31 + si);
        const h3 = HD.hash(sh.seed, j, 41 + si);
        // staggered burn-out: the shell disintegrates instead of fading as one dotted ring
        const lifeJ = sh.life * ls * (type === 'ring' ? 0.8 + 0.2 * h3 : 0.6 + 0.4 * h3);
        if (tb > lifeJ) continue;
        let a = ((j + (h1 - 0.5) * 0.5) / n) * TAU + rot0 + si * 0.5;
        if (type === 'willow') a += (HD.hash(sh.seed, j, 61) - 0.5) * 0.45; // no straight spokes
        let dx;
        let dy;
        let back = 0;
        if (type === 'ring') {
          const ex = Math.cos(a);
          const ey = Math.sin(a) * sh.tilt;
          dx = ex * cr - ey * sr;
          dy = ex * sr + ey * cr;
          back = Math.sin(a) < -0.2 ? 1 : 0;
        } else if (inner) {
          // the pistil: an even Fibonacci lattice over the sphere, so the
          // inner ball reads as a sprinkle of sparks, never a squiggle
          const z = 1 - (2 * (j + 0.5)) / n;
          const rr = Math.sqrt(1 - z * z);
          const ga = j * 2.39996 + rot0;
          dx = rr * Math.cos(ga);
          dy = rr * Math.sin(ga);
        } else {
          // rim-weighted sphere (|z| < 0.55) so the burst reads as a clean
          // ball; a filled shell samples the whole sphere instead
          const z = filled ? (2 * h2 - 1) * 0.92 : (h2 - 0.5) * 1.5;
          const rr = Math.sqrt(1 - z * z);
          dx = rr * Math.cos(a);
          dy = rr * Math.sin(a);
          back = !inner && z < -0.45 ? 1 : 0;
          if (type === 'willow') dy = dy * 0.75 - 0.2;
        }
        let sp = Rr * rs * (0.93 + 0.12 * h3);
        // late rings and peonies loosen: per-star speed and sag spread grows with time
        let Gj = G;
        if (type === 'ring' || type === 'peony') {
          const h4 = HD.hash(sh.seed, j, 71 + si);
          const loose = Math.min(1, tb / 1.2);
          sp *= 1 + (h4 - 0.5) * 0.16 * loose;
          Gj = G * (0.8 + 0.4 * HD.hash(sh.seed, j, 81 + si));
        }
        const u = tb / lifeJ;
        let lv = headLvl(u) - dim - back;
        if (lv < 0) continue;
        // dying stars sputter out (tiny dim pixels only, never a flash)
        if (u > 0.72 && type !== 'willow' && type !== 'crackle' && HD.hash(sh.seed, j * 8 + si, tk, 5) < (u - 0.72) * 1.8) continue;
        // glitter: late willow / crackle stars twinkle
        const glit = u > 0.55 && (type === 'willow' || type === 'crackle') && HD.hash(sh.seed, j * 8 + si, tk) < 0.28;
        const e = expand(tb, k);
        const hx = cx + dx * sp * e;
        const hy = cy + dy * sp * e + droop(tb, Gj);
        if (type === 'willow') {
          // long hanging trail: a polyline through earlier positions, fading
          // as it hangs; it never reaches back into the core
          let px = hx;
          let py = hy;
          for (let q = 1; q <= 7; q++) {
            const tq = tb - q * 0.14;
            if (tq < 0.12) break;
            const eq = expand(tq, k);
            const qx = cx + dx * sp * eq;
            const qy = cy + dy * sp * eq + droop(tq, G);
            const l = lv - 1 - (q >> 1);
            if (l < minL) break;
            streak(g, qx, qy, px, py, rp, l, 1, minL);
            g.px(R(px), R(py), rp[l]);
            px = qx;
            py = qy;
          }
          if (!glit) head(hx, hy, rp[Math.min(6, lv + 1)], null, 0, 0);
          continue;
        }
        // comet streak: long spokes while fast, then a short falling tail as
        // the star slows and sags under gravity
        // peonies and crackles throw long radial spokes while they are fast
        // (the classic starburst): a young spoke runs bright from the flash,
        // then its inner end leaves the centre (dim inner ends would gather
        // into a grey blob there) and it fades towards the middle; later the
        // star keeps a short falling tail. Rings keep short dashes,
        // chrysanthemums long trails.
        if (!glit) {
          if (inner) {
            // pistil stars are plain sparks
          } else if (type !== 'ring' && type !== 'chrys' && tb < 0.9) {
            const fIn = tb < 0.5 ? clamp01((tb - 0.14) / 0.26) * 0.38 : 0.38 + ((tb - 0.5) / 0.4) * 0.5;
            const fade = 1 + Math.round(3 * clamp01((tb - 0.16) / 0.3));
            streak(g, cx + (hx - cx) * fIn, cy + (hy - cy) * fIn, hx, hy, rp, Math.min(6, lv), fade, minL);
          } else {
            const dt = type === 'chrys' ? 0.3 : type === 'ring' ? 0.08 : 0.15;
            let t0 = Math.max(0, tb - dt);
            if (type === 'chrys') t0 = Math.max(t0, tC);
            if (t0 < tb) {
              const e0 = expand(t0, k);
              streak(g, cx + dx * sp * e0, cy + dy * sp * e0 + droop(t0, Gj), hx, hy, rp, Math.min(type === 'chrys' ? 5 : 6, lv), 3, minL);
            }
          }
        }
        if (glit) continue;
        if (lv >= 5 && !dim && !back && !inner && type !== 'crackle' && type !== 'chrys' && !sh.thin) {
          // fresh, near stars: a fat 2x2 head, its dimmer pixels on the
          // trailing side (no perpendicular arms: never a glyph)
          const vy = (dy * sp * Math.exp(-tb / k)) / k + (2 * Gj * tb) / (1 + 0.7 * tb);
          head(hx, hy, rp[lv], lv === 6 ? rp[4] : rp[3], dx >= 0 ? -1 : 1, vy >= 0 ? -1 : 1);
        } else head(hx, hy, rp[lv], null, 0, 0);
      }
    }
    flushHeads(g);
    flash();

    // crackle: once the gold stars burn out, each pops into a few tiny white flashes
    if (type === 'crackle') {
      const n = Math.round(16 + Rr * 0.5);
      const W = RAMPS.white;
      for (let j = 0; j < n; j++) {
        const h1 = HD.hash(sh.seed, j, 21);
        const h2 = HD.hash(sh.seed, j, 31);
        const h3 = HD.hash(sh.seed, j, 41);
        const t0 = sh.life * 0.5 * (0.8 + 0.2 * h3) * 0.85;
        if (tb < t0) continue;
        const a = ((j + (h1 - 0.5) * 0.5) / n) * TAU + rot0;
        const z = (h2 - 0.5) * 1.1;
        const rr = Math.sqrt(1 - z * z);
        const e = expand(t0, k);
        const sp = Rr * (0.93 + 0.12 * h3);
        const sx = cx + rr * Math.cos(a) * sp * e;
        const sy = cy + rr * Math.sin(a) * sp * e + droop(tb, G);
        for (let m = 0; m < 3; m++) {
          const at = t0 + HD.hash(sh.seed, j, 40 + m) * (sh.life - t0 - 0.2);
          const dtm = tb - at;
          if (dtm < 0 || dtm > 0.2) continue;
          const ox = R(sx + (HD.hash(sh.seed, j, 50 + m) - 0.5) * 8);
          const oy = R(sy + (HD.hash(sh.seed, j, 60 + m) - 0.5) * 8);
          const lvp = dtm < 0.08 ? 6 : dtm < 0.14 ? 4 : 2;
          if (dtm < 0.08) {
            // a tiny round pop: 2x2, brightest corner first
            g.px(ox + 1, oy, W[3]);
            g.px(ox, oy + 1, W[3]);
            g.px(ox + 1, oy + 1, W[2]);
          }
          g.px(ox, oy, W[lvp - dim]);
        }
      }
    }
  }

  // glow profile of a burst (0..1): quick attack, soft decay
  function flashOf(sh) {
    const tb = sh.tau - sh.rise;
    if (tb < 0) return 0;
    const a = tb < 0.1 ? tb / 0.1 : Math.exp(-(tb - 0.1) / 0.65);
    return a * (sh.far ? 0.55 : 1) * (sh.type === 'willow' ? 0.8 : 1);
  }
  // scene light profile: a slower swell and fade, so the street never pops
  function lightOf(sh) {
    const tb = sh.tau - sh.rise;
    if (tb < 0) return 0;
    let a;
    if (tb < 0.3) {
      const u = tb / 0.3;
      a = u * u * (3 - 2 * u);
    } else a = Math.exp(-(tb - 0.3) / 0.75);
    return a * (sh.far ? 0.55 : 1) * (sh.type === 'willow' ? 0.8 : 1);
  }

  function drawFireworks(g, t, front) {
    const s = show();
    if (!s.list.length) return;
    const all = liveShells(t, s);
    if (!all.length) return;
    const glow = s.glow;
    // glows first (additive, behind every burst of this layer)
    for (const sh of all) {
      if (!!sh.front !== front) continue;
      const fl = flashOf(sh);
      if (fl <= 0.02) continue;
      const col = glow[sh.col] || glow.gold;
      const rad = Math.max(10, Math.round((sh.R * 1.1) / 4) * 4);
      HD.glow(g, sh.bx, sh.by, rad, col, 0.15 * fl);
    }
    for (const sh of all) {
      if (!!sh.front !== front) continue;
      if (sh.tau < sh.rise) drawRocket(g, sh, t, front && s.sky.riverRise ? s.sky.riverRise : s.sky.rise);
      else drawBurst(g, sh, t);
    }
  }

  // one aggregated coloured light per sky pocket for the live bursts, each at
  // its own weighted centre with its own cap, so a burst on one side never
  // drags a pool of light across a facade where no burst is
  const AGG = [new Float64Array(6), new Float64Array(6), new Float64Array(6)]; // w, x, y, r, g, b
  const LIGHT_CLIP = { x0: 0, y0: 0, x1: HD.W - 1, y1: HD.H - 1 };
  function fireworkLights(t, L) {
    const s = show();
    if (!s.list.length) return;
    const list = liveShells(t, s);
    if (!list.length) return;
    const LF = HD.LIGHT.firework;
    for (const a of AGG) a.fill(0);
    for (const sh of list) {
      const fl = lightOf(sh) * (sh.R / 24) * s.lightK;
      if (fl <= 0.01) continue;
      const col = LF[sh.col] || (sh.col === 'silver' ? LF.white : LF.gold);
      const a = AGG[Math.min(2, sh.zone || 0)];
      a[0] += fl;
      a[1] += sh.bx * fl;
      a[2] += sh.by * fl;
      a[3] += col[0] * fl;
      a[4] += col[1] * fl;
      a[5] += col[2] * fl;
    }
    for (const a of AGG) {
      const [w, x, y, r, gc, b] = a;
      if (w < 0.05) continue;
      L.add({
        x: R(x / w),
        y: R(y / w) + 80,
        r: 150,
        ry: 100,
        color: [r / w, gc / w, b / w],
        i: Math.min(0.15, 0.11 * w),
        bands: 4,
        pow: 1.25,
        clip: LIGHT_CLIP,
      });
    }
  }

  // ------------------------------------------------------------------
  // sparklers, stuck in a low planter at the edge of the plaza
  // ------------------------------------------------------------------
  // per place: the planter (centre x, ground line, half width) and the
  // sticks' x offsets; a stick burns ~80 s, then a fresh one is lit
  const PLANTERS = {
    apt1: { x: 452, base: 211, hw: 9, sticks: [-4, 5] },
  };
  const SPK_P = 80;
  const SPK_LEN = 11;
  const SPK_LIGHT = [1, 0.82, 0.5];
  const SPK_CORE = ['#fffdf2', '#fff2b0', '#f7d969', '#f0a830', '#e4571a', '#9a2610'];
  const SPK_PLACE = 1;
  const SPK_GONE = 1.4;
  const PL_H = 5; // planter height

  function planter() {
    if (!HD.tag('sparklers')) return null;
    return PLANTERS[HD.place().id] || null;
  }

  // one sparkler's life: a fresh stick is pushed into the soil (1 s), lit,
  // fizzes down to the handle, dies to an ember, and the spent stub is
  // pulled out a moment before the next one is placed
  function sparklerState(t, pt, k) {
    const c = T.cycle(t, k, SPK_P, 5150 + k);
    const tau = c.age * c.P;
    const lean = [-0.14, 0.16, 0.04][k % 3];
    let fizz;
    const lit = tau - SPK_PLACE;
    if (lit < 0) fizz = 0;
    else if (lit < 1.2) fizz = lit / 1.2;
    else if (tau < c.P - 5) fizz = 1;
    else if (tau < c.P - 3) fizz = (c.P - 3 - tau) / 2;
    else fizz = 0;
    const prog = Math.min(1, Math.max(0, lit / (c.P - 4 - SPK_PLACE)));
    const len = SPK_LEN - (k % 2 === 1 ? 2 : 0);
    const bLen = len - prog * (len - 4); // burn point height along the stick
    const x = pt.x + pt.sticks[k];
    const base = pt.base - PL_H + 1; // soil line
    return {
      x,
      base,
      lean,
      len,
      bLen,
      fizz,
      gone: tau >= c.P - SPK_GONE,
      ember: tau >= c.P - 5 && tau < c.P - SPK_GONE ? Math.max(0, 1 - (tau - (c.P - 5)) / (5 - SPK_GONE)) : 0,
      bx: x + lean * bLen,
      by: base - bLen,
    };
  }

  // the planter is static: baked per place and snow state
  const PLANTER_ART = new Map();
  const PL_TOP = 4; // headroom above the rim for sprigs and snow
  function drawPlanter(g, pt) {
    const snow = !!(HD.edition.weather && HD.edition.weather.snow > 0);
    const key = pt.x + '|' + pt.base + '|' + snow;
    let art = PLANTER_ART.get(key);
    if (!art) {
      const loc = { x: pt.hw, base: PL_TOP + PL_H, hw: pt.hw };
      PLANTER_ART.set(key, (art = HD.bake(2 * pt.hw + 1, PL_TOP + PL_H, (gg) => paintPlanter(gg, loc, snow))));
    }
    g.sprite(art, pt.x - pt.hw, pt.base - PL_H - PL_TOP);
  }

  function paintPlanter(g, pt, snow) {
    const x0 = pt.x - pt.hw;
    const x1 = pt.x + pt.hw;
    const top = pt.base - PL_H;
    // a low cast-stone box: lit rim, face, a darker foot
    g.hline(x0, x1, top, P.stone[5]);
    g.rect(x0, top + 1, x1 - x0 + 1, PL_H - 2, P.stone[4]);
    g.hline(x0, x1, pt.base - 1, P.stone[3]);
    g.px(x0, top + 1, P.stone[3]);
    g.px(x1, top + 1, P.stone[3]);
    // soil inside the rim, a few low evergreen sprigs at the ends
    g.hline(x0 + 1, x1 - 1, top, P.soil[4]);
    const leaf = [P.leaf[3], P.leaf[4], P.leaf[5]];
    for (const [dx, h] of [
      [1, 2],
      [2, 3],
      [3, 2],
      [-3, 2],
      [-2, 3],
      [-1, 1],
    ]) {
      const x = dx > 0 ? x0 + dx : x1 + dx + 1;
      for (let i = 1; i <= h; i++) g.px(x, top - i + 1, leaf[Math.min(2, h - i)]);
    }
    // a dusting of snow on the rim and the sprigs
    if (snow) {
      g.hline(x0, x1, top - 1, P.snow[6]);
      g.px(x0 + 2, top - 3, P.snow[7]);
      g.px(x1 - 1, top - 3, P.snow[7]);
      g.hline(x0 + 1, x0 + 3, top - 2, P.snow[5]);
      g.hline(x1 - 2, x1, top - 2, P.snow[5]);
    }
  }

  function drawSparklerSticks(g, t) {
    const pt = planter();
    if (!pt) return;
    drawPlanter(g, pt);
    for (let k = 0; k < pt.sticks.length; k++) {
      const st = sparklerState(t, pt, k);
      if (st.gone) continue;
      // dark wire: bare handle, grey coating below the burn point, burnt above
      for (let h = 0; h <= st.len; h++) {
        const x = R(st.x + st.lean * h);
        const y = st.base - h;
        let c;
        if (h < 3) c = P.stone[4];
        else if (h < st.bLen) c = h % 3 === 0 ? P.stone[5] : P.stone[4];
        else c = P.stone[1];
        g.px(x, y, c);
      }
    }
  }

  function drawSparklerCores(g, t) {
    const pt = planter();
    if (!pt) return;
    for (let k = 0; k < pt.sticks.length; k++) {
      const st = sparklerState(t, pt, k);
      if (st.gone) continue;
      const x = R(st.bx);
      const y = R(st.by);
      if (st.fizz > 0) {
        g.em.px(x, y, SPK_CORE[0]);
        g.em.px(x, y + 1, SPK_CORE[2]);
      } else if (st.ember > 0) {
        g.em.px(x, y, st.ember > 0.5 ? SPK_CORE[4] : SPK_CORE[5]);
      }
    }
  }

  function drawSparklerFizz(g, t) {
    const pt = planter();
    if (!pt) return;
    const ts = T.step(t, 15);
    const tk = tick(t, 15);
    for (let k = 0; k < pt.sticks.length; k++) {
      const st = sparklerState(t, pt, k);
      if (st.fizz <= 0) continue;
      const x0 = R(st.bx);
      const y0 = R(st.by);
      const fl = T.flicker(ts, 300 + k, 2);
      HD.glow(g, x0, y0, 7, SPK_LIGHT, (0.12 + 0.08 * fl) * st.fizz);
      const nRay = Math.round((4 + 3 * fl) * st.fizz);
      for (let j = 0; j < nRay; j++) {
        const h0 = HD.hash(k, tk, j, 1);
        const h1 = HD.hash(k, tk, j, 2);
        const h2 = HD.hash(k, tk, j, 3);
        const a = h0 * TAU;
        const len = (1.5 + h1 * 2.8) * (0.6 + 0.4 * st.fizz);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        let lx = x0;
        let ly = y0;
        const steps = Math.max(2, Math.round(len));
        for (let s = 1; s <= steps; s++) {
          const px = R(x0 + ca * s);
          const py = R(y0 + sa * s);
          const u = s / steps;
          g.px(px, py, SPK_CORE[u < 0.34 ? 1 : u < 0.67 ? 2 : 3]);
          lx = px;
          ly = py;
        }
        // forked tips: the classic sparkler star
        if (h2 < 0.35 && len > 3) {
          const b1 = a + 0.75;
          const b2 = a - 0.75;
          g.px(R(lx + Math.cos(b1)), R(ly + Math.sin(b1)), SPK_CORE[3]);
          g.px(R(lx + Math.cos(b2)), R(ly + Math.sin(b2)), SPK_CORE[3]);
                  }
      }
      // a few heavier sparks drop and cool
      for (let j = 0; j < 2; j++) {
        const c = T.cycle(t, k * 8 + j, 0.7 + HD.hash(k, j, 77) * 0.4, 7373);
        const tau = c.age * c.P;
        const ang = -Math.PI / 2 + (c.rnd(0) - 0.5) * 2.6;
        const v = 9 + c.rnd(1) * 9;
        const x = R(x0 + Math.cos(ang) * v * tau);
        const y = R(y0 + Math.sin(ang) * v * tau + 0.5 * 60 * tau * tau);
        if (y > st.base) continue;
        g.px(x, y, SPK_CORE[Math.min(5, 2 + Math.floor(c.age * 4))]);
      }
    }
  }

  function sparklerLights(t, L) {
    const pt = planter();
    if (!pt) return;
    const ts = T.step(t, 15);
    for (let k = 0; k < pt.sticks.length; k++) {
      const st = sparklerState(t, pt, k);
      const fl = T.flicker(ts, 300 + k, 2);
      const i = 0.15 * st.fizz * (0.8 + 0.35 * fl) + 0.03 * st.ember;
      if (i <= 0.01) continue;
      L.add({ x: R(st.bx), y: R(st.by), r: 20, color: SPK_LIGHT, i, bands: 4, pow: 1.8 });
    }
  }

  /**
   * For other modules: the current show (list of shells with bx, by, R, col,
   * type, far, tau), the live shells at t, a burst's sky-flash profile, and
   * the salvo times (New Year's Eve: the first is right after the logo, at
   * midnight).
   */
  HD._fireworks = {
    show,
    liveShells,
    flashOf,
    salvos: () => show().salvos,
  };

  // ------------------------------------------------------------------
  // module (registered under the same name so --only/--skip fire covers it)
  // ------------------------------------------------------------------
  HD.module('fire', {
    init() {
      for (const ed of HD.EDITIONS) if (ed.fireworks > 0 || (ed.tagSet && ed.tagSet.has('goal-fireworks'))) showFor(ed);
    },
    lights(t, L) {
      fireworkLights(t, L);
      sparklerLights(t, L);
    },
    passes: [
      // behind the far city (over a skyline), and in front of it (over the
      // river between the building and the far shore)
      { layer: 'bg', z: 9, id: 'fireworks', draw: (g, t) => drawFireworks(g, t, false) },
      { layer: 'bg', z: 19.5, id: 'fireworks-river', draw: (g, t) => drawFireworks(g, t, true) },
      { layer: 'scene', z: 41, id: 'sparkler-sticks', draw: drawSparklerSticks },
      { layer: 'scene', z: 45, id: 'sparkler-cores', draw: drawSparklerCores },
      { layer: 'fx', z: 36, id: 'sparklers', draw: drawSparklerFizz },
    ],
  });
})();
