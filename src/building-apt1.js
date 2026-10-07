/*
 * building-apt1: the five-storey brick and metal-panel apartment block of
 * place apt1, plus its left neighbour on the same block (a cinema box with a
 * blank marquee blade and a primary-coloured toy-brick shopfront).
 *
 * Bays, left to right: a narrow charcoal end bay, the espresso-brick bay with
 * silver "popped" window surrounds, the recessed charcoal centre bay with
 * stacked black-railed balconies (the cat window is the floor-3 sliding door),
 * a mauve bay with cast-stone sills, and the silver metal-panel corner tower
 * with its projecting cornice. A continuous retail floor runs underneath: a
 * cafe, the lobby with its canopy, a florist and a glazed corner bookshop.
 *
 * Static art is baked once per edition (HD.perEdition) into two layers, plain
 * pixels (relit by lamps and daylight) and emissive pixels (lit windows and
 * shop interiors), so a frame costs two blits plus the animated bits: the cat
 * window room and its cats behind the balcony rail, TV flicker, windows that
 * switch on and off, marquee bulbs, the lobby doors and tag contents.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const CL = HD.color;
  const PL = HD.PLACES.apt1;
  const BAL = PL.balcony;
  const CW = PL.catWindow;
  const ENT = PL.entrance;
  const here = () => !!HD.edition && HD.edition.place === 'apt1';
  const tagOf = (ed, t) => !!(ed && ed.tagSet && ed.tagSet.has(t));

  // bake region (x 0..BW-1, y OY..OY+BH-1)
  const OY = 28;
  const BW = 332;
  const BH = 182;

  const AM = P.amber; // emissive interior ramp: 0 deepest .. 8 white-hot

  // ------------------------------------------------------------------
  // colour: materials are given by their daylight albedo and painted for
  // the light mode (night: cool and dim; otherwise albedo x ambient so the
  // engine's daylight fill reveals the albedo). c.d(hex) gives the colour to
  // paint so that it DISPLAYS as hex after this mode's daylight relight
  // (glass reflections, shop interiors by day).
  // ------------------------------------------------------------------
  const AMB = HD.AMBIENT;
  const NIGHT_K = [0.4, 0.42, 0.53];
  function colours(mode) {
    const L = HD.LIGHTING[mode] || HD.LIGHTING.night;
    const f = L.day > 0 ? L.fill : [0, 0, 0];
    const mul = [1 + f[0] / AMB[0], 1 + f[1] / AMB[1], 1 + f[2] / AMB[2]];
    const k = mode === 'night' ? NIGHT_K : AMB;
    const cm = new Map();
    const cd = new Map();
    return {
      mode,
      lit: mode === 'night' || mode === 'dusk',
      m(a) {
        let v = cm.get(a);
        if (!v) {
          const c = CL.hex(a);
          v = CL.css(c[0] * k[0], c[1] * k[1], c[2] * k[2]);
          cm.set(a, v);
        }
        return v;
      },
      d(h) {
        let v = cd.get(h);
        if (!v) {
          const c = CL.hex(h);
          v = CL.css(c[0] / mul[0], c[1] / mul[1], c[2] / mul[2]);
          cd.set(h, v);
        }
        return v;
      },
      r(arr) {
        return arr.map((a) => this.m(a));
      },
    };
  }

  // daylight albedos, dark -> light
  const MAT = {
    esp: ['#4a2d29', '#5a3832', '#68423b', '#7a4f46'], // mortar, shade, base, light
    char: ['#353338', '#403e43', '#4a474c', '#5a5659'],
    charSpk: ['#6c6664', '#2a282d'],
    mauve: ['#5c3f47', '#6e4f58', '#7d5c65', '#906b74'],
    panel: ['#5c606a', '#868a94', '#a2a7b0', '#c2c6ce'], // joint, shade, base, light
    pop: ['#7a7e87', '#b2b6bd', '#d6d9de'], // shade, base, highlight
    almond: ['#958c78', '#cdc4b0'],
    stone: ['#837456', '#bba886', '#d8c9a6'],
    steel: ['#16171c', '#22242a', '#3a3d45'],
    slab: ['#504d48', '#85807a', '#a7a29a'],
    band: ['#2a2c32', '#3d4047', '#5a5e66'],
    roof: ['#24262b', '#323439', '#45484e'],
    cor: ['#3c4048', '#7e828a', '#aab0b8', '#d0d3d8'], // underside, body, top, highlight
    cin: ['#322c37', '#3f3846', '#4c4555', '#5c5466'],
    pier: ['#2c2a2e', '#3a373c', '#4a464c'],
    toyRed: ['#6e161d', '#a8222b', '#cc3636'],
    toyYel: ['#9a7216', '#d4a226', '#f0c648'],
    toyBlue: ['#1c3a74', '#2a56a6', '#4474c8'],
    teal: ['#1c505a', '#286e7a', '#3a8892'],
    mustard: ['#86601a', '#b88626', '#d4a23a'],
    blade: ['#5a1a1e', '#8a2a2a', '#a83a34'],
  };

  // ------------------------------------------------------------------
  // bake painter: two canvases, plain and emissive. Drawing on one clears
  // the same pixels on the other (last write wins), so the emissive layer
  // can sit behind window bars drawn later with plain pixels.
  // ------------------------------------------------------------------
  function painter(w, h, ox, oy) {
    const body = HD.canvas(w, h, true);
    const glow = HD.canvas(w, h, true);
    const bx = body.getContext('2d');
    const gx = glow.getContext('2d');
    bx.setTransform(1, 0, 0, 1, -ox, -oy);
    gx.setTransform(1, 0, 0, 1, -ox, -oy);
    const used = { body: false, glow: false };
    // the "mask" of each gfx erases the other canvas
    const eraser = (ctx, mine) => ({
      fillStyle: '#fff',
      fillRect(x, y, a, b) {
        used[mine] = true;
        ctx.clearRect(x, y, a, b);
      },
      drawImage(...a) {
        used[mine] = true;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(...a);
        ctx.globalCompositeOperation = 'source-over';
      },
      save() {
        ctx.save();
      },
      restore() {
        ctx.restore();
      },
      translate(a, b) {
        ctx.translate(a, b);
      },
      scale(a, b) {
        ctx.scale(a, b);
      },
    });
    const g = HD.makeGfx(bx, eraser(gx, 'body'));
    g.em = HD.makeGfx(gx, eraser(bx, 'glow'));
    return { g, body, glow, used, ox, oy };
  }
  function split(p) {
    return { body: p.used.body ? p.body : null, glow: p.used.glow ? p.glow : null, x: p.ox, y: p.oy };
  }
  /** bake a small two-layer sprite of region (x, y, w, h) with fn(g) */
  function bake2(x, y, w, h, fn) {
    const p = painter(w, h, x, y);
    fn(p.g);
    return split(p);
  }
  function blit2(g, s) {
    if (!s) return;
    if (s.body) g.sprite(s.body, s.x, s.y);
    if (s.glow) g.em.sprite(s.glow, s.x, s.y);
  }

  // ------------------------------------------------------------------
  // geometry (art pixels; see places.js apt1 anchors)
  // ------------------------------------------------------------------
  const FL = [
    { n: 2, y0: 140, y1: 166 },
    { n: 3, y0: 114, y1: 140 },
    { n: 4, y0: 88, y1: 114 },
    { n: 5, y0: 60, y1: 88 },
  ];
  const slabY = (f) => f.y1 - 3; // balcony slab top (3 px thick)
  const railY = (f) => f.y1 - 10; // handrail (7 px above the slab)
  const DOOR = { x: 203, w: 37, stile: 220 }; // centre-bay sliding doors (all floors)

  function brickWall(g, x0, y0, x1, y1, r, seed, spk) {
    // r = painted [mortar, shade, base, light]; x1, y1 exclusive
    g.rect(x0, y0, x1 - x0, y1 - y0, r[2]);
    for (let y = y0; y < y1; y++) {
      const course = Math.floor(y / 3);
      const row = y - course * 3;
      if (row === 2) {
        g.hline(x0, x1 - 1, y, r[0]);
        continue;
      }
      const off = (course & 1) * 3;
      for (let bx = x0 - ((((x0 - off) % 6) + 6) % 6); bx < x1; bx += 6) {
        const hv = HD.hash(bx, course, seed);
        const c = hv < 0.12 ? r[3] : hv < 0.22 ? r[1] : null;
        const a = Math.max(x0, bx + 1);
        const b = Math.min(x1 - 1, bx + 5);
        if (c && b >= a) g.hline(a, b, y, c);
        if (bx >= x0 && row === 0) g.px(bx, y, r[0]);
      }
    }
    if (spk) {
      const n = ((x1 - x0) * (y1 - y0)) / 22;
      for (let k = 0; k < n; k++) {
        const x = x0 + Math.floor(HD.hash(k, seed, 5) * (x1 - x0));
        const y = y0 + Math.floor(HD.hash(k, seed, 6) * (y1 - y0));
        if (y % 3 === 2) continue;
        g.px(x, y, HD.hash(k, seed, 7) < 0.5 ? spk[0] : spk[1]);
      }
    }
  }

  // ------------------------------------------------------------------
  // glass
  // ------------------------------------------------------------------
  /** lit interior of a punched window (emissive): flat bands, no noise */
  function litSmall(g, x, y, w, h, look, s, c) {
    const e = g.em;
    const left = s < 0.5;
    if (c.mode === 'golden') {
      // late-afternoon interiors: one lamp in a dim room
      e.rect(x, y, w, h, AM[2]);
      e.rect(x, y + h - 3, w, 3, AM[1]);
      const lx = left ? x + 1 : x + w - 4;
      e.rect(lx - 1, y + 2, 5, 6, AM[3]);
      e.rect(lx, y + 3, 3, 2, AM[7]);
      e.vline(lx + 1, y + 5, y + h - 1, AM[1]);
      return;
    }
    switch (look) {
      case 'curtain': {
        // curtains drawn, lamp light glowing through the fabric
        e.rect(x, y, w, h, AM[4]);
        for (let i = x + 1; i < x + w; i += 3) e.vline(i, y + 1, y + h - 1, AM[3]);
        e.vline(x + (w >> 1), y + 1, y + h - 1, AM[6]);
        e.hline(x, x + w - 1, y, AM[2]);
        break;
      }
      case 'blind': {
        e.rect(x, y, w, h, AM[5]);
        const bh = 3 + Math.floor(s * 5);
        e.rect(x, y, w, bh, AM[4]);
        for (let yy = y + 1; yy < y + bh; yy += 2) e.hline(x, x + w - 1, yy, AM[3]);
        e.hline(x, x + w - 1, y + bh, AM[2]);
        e.rect(x, y + bh + 1, w, 3, AM[6]);
        e.rect(x, y + h - 2, w, 2, AM[4]);
        break;
      }
      case 'lamp': {
        // a dim room and one bright lamp
        e.rect(x, y, w, h, AM[3]);
        e.rect(x, y + h - 3, w, 3, AM[2]);
        const lx = left ? x + 1 : x + w - 4;
        e.rect(lx - 1, y + 2, 5, 7, AM[4]);
        e.rect(lx, y + 3, 3, 2, AM[8]);
        e.hline(lx, lx + 2, y + 5, AM[6]);
        e.vline(lx + 1, y + 6, y + h - 1, AM[1]);
        break;
      }
      case 'cool': {
        // a white-lit kitchen: wall cabinets and a counter
        e.rect(x, y, w, h, '#e6d8b6');
        e.rect(x, y, w, 3, '#bfa984');
        e.hline(x, x + w - 1, y + 3, '#a8916c');
        e.rect(x, y + h - 4, w, 4, '#a08a68');
        e.hline(x, x + w - 1, y + h - 4, '#f4e8c8');
        break;
      }
      case 'dim': {
        e.rect(x, y, w, h, AM[2]);
        e.rect(x, y + (h >> 1), w, h - (h >> 1) - 2, AM[3]);
        break;
      }
      default: {
        // 'warm' and 'plant': a lamp-lit wall, brighter near the lamp
        e.rect(x, y, w, h, AM[5]);
        e.hline(x, x + w - 1, y, AM[4]);
        e.rect(x, y + h - 2, w, 2, AM[4]);
        const gx = left ? x + w - 5 : x + 1;
        e.rect(gx, y + 2, 4, 5, AM[6]);
        e.rect(gx + 1, y + 7, 2, 2, AM[6]);
        if (look === 'plant') {
          const px = left ? x + 1 : x + w - 4;
          e.rect(px, y + h - 3, 3, 3, AM[1]);
          e.px(px + 1, y + h - 4, AM[1]);
          e.px(px + 1, y + h - 5, AM[1]);
          e.px(px, y + h - 6, AM[1]);
          e.px(px + 2, y + h - 6, AM[1]);
          e.px(px - 1, y + h - 5, AM[2]);
          e.px(px + 3, y + h - 5, AM[2]);
          e.px(px + 2, y + h - 7, AM[2]);
        } else if (s > 0.25 && s < 0.75) {
          const cx = left ? x : x + w - 2;
          e.rect(cx, y + 1, 2, h - 1, AM[3]);
          e.vline(left ? cx + 1 : cx, y + 1, y + h - 1, AM[4]);
        }
      }
    }
  }

  // sky reflections by mode (displayed colours): top, upper, lower, room
  const REFL = {
    dusk: ['#a07ea6', '#7a5c8c', '#54426c', '#2c2644'],
    golden: ['#f4d098', '#dcaa7c', '#a87868', '#4c3c44'],
    day: ['#d0e4f4', '#a4c6e6', '#7298c8', '#3e4c64'],
  };
  // curtains and blinds seen through the glass by day (albedo)
  const FABRIC = ['#e2d6bc', '#c0684c', '#8090a8', '#d4c08e', '#9a6a7a'];
  /** unlit glass (plain pixels): dark at night, the sky by day */
  function darkGlass(g, c, x, y, w, h, s) {
    if (c.mode === 'night') {
      g.rect(x, y, w, h, '#0d1225');
      g.hline(x, x + w - 1, y, '#141a32');
      if (s < 0.45) {
        g.px(x + 1, y + 1, '#1c2645');
        g.px(x + 2, y + 1, '#1c2645');
        g.px(x + 1, y + 2, '#1c2645');
      } else if (s < 0.7) {
        g.rect(x, y + 1, 2, h - 1, '#16131f');
        g.rect(x + w - 2, y + 1, 2, h - 1, '#16131f');
      } else if (s < 0.85) {
        for (let yy = y + 1; yy < y + Math.min(h, 7); yy += 2) g.hline(x, x + w - 1, yy, '#121629');
      }
      return;
    }
    const R = REFL[c.mode];
    const mixd = (a, b, k) => c.d(CL.mix(a, b, k));
    const h1 = Math.max(1, Math.round(h * 0.22));
    const h2 = Math.round(h * 0.62);
    g.rect(x, y, w, h, c.d(R[2]));
    g.rect(x, y, w, h2, c.d(R[1]));
    g.rect(x, y, w, h1, c.d(R[0]));
    g.hline(x, x + w - 1, y + h - 1, c.d(R[3]));
    // what shows of the room behind the reflection
    const k = Math.floor(s * 5);
    const fab = FABRIC[Math.floor(HD.hash(x, y, 5) * FABRIC.length)];
    if (k === 0 || k === 4) {
      // curtains at the sides (one side for k 4)
      const fc = mixd(fab, R[1], 0.35);
      const fd = mixd(fab, R[2], 0.5);
      g.rect(x, y + h1, 2, h - h1 - 1, fc);
      g.vline(x + 1, y + h1, y + h - 2, fd);
      if (k === 0) {
        g.rect(x + w - 2, y + h1, 2, h - h1 - 1, fc);
        g.vline(x + w - 2, y + h1, y + h - 2, fd);
      }
    } else if (k === 1) {
      // a blind pulled half down
      const bh = Math.round(h * 0.42);
      g.rect(x, y, w, bh, mixd('#ece6da', R[0], 0.3));
      for (let yy = y + 1; yy < y + bh; yy += 2) g.hline(x, x + w - 1, yy, mixd('#ece6da', R[1], 0.45));
      g.hline(x, x + w - 1, y + bh, mixd('#8a8478', R[2], 0.3));
    } else if (k === 2) {
      // a plant on the sill
      const px = x + (s < 0.5 ? 1 : w - 4);
      const lf = mixd('#3a6a3a', R[2], 0.3);
      g.rect(px, y + h - 3, 3, 2, mixd('#a86a48', R[2], 0.3));
      g.rect(px - 1, y + h - 6, 5, 3, lf);
      g.px(px + 1, y + h - 7, lf);
    } else {
      g.rect(x, y + h - 4, w, 3, c.d(R[3]));
    }
    // a diagonal sheen on about half the panes
    if (HD.hash(x, y, 6) < 0.5) {
      const hi = c.d(c.mode === 'day' ? '#eef4fa' : c.mode === 'golden' ? '#ffe6b8' : '#c8a2c4');
      const o = Math.floor(HD.hash(x, y, 7) * w);
      for (let i = 0; i < Math.min(h, w + 2); i++) {
        const xx = x + o + 2 - i;
        if (xx >= x && xx < x + w) g.px(xx, y + i, hi);
        if (xx + 1 >= x && xx + 1 < x + w) g.px(xx + 1, y + i, hi);
      }
    }
  }
  /** a hot spot of low sun caught by the glass (emissive) */
  function sunGlint(g, x, y, w, h, s) {
    const gx = x + 1 + Math.floor(s * (w - 3));
    const gy = y + 1 + Math.floor(HD.hash(x, y, 77) * Math.max(1, h * 0.4));
    g.em.rect(gx, gy, 2, 2, '#fff2c8');
    g.em.px(gx - 1, gy, '#ffd890');
    g.em.px(gx + 2, gy + 1, '#ffd890');
    g.em.px(gx, gy + 2, '#ffd890');
    g.em.px(gx + 1, gy - 1, '#ffd890');
  }

  function fillGlass(g, c, win) {
    const { x, y, w, h } = win;
    if (win.state === 'lit') litSmall(g, x, y, w, h, win.look, win.s, c);
    else if (win.state === 'tv') {
      g.em.rect(x, y, w, h, '#0f1828');
      g.em.rect(x, y + 1, w, h - 4, '#142438');
    } else darkGlass(g, c, x, y, w, h, win.s);
    if (c.mode === 'golden' && win.glint && win.state !== 'lit') sunGlint(g, x, y, w, h, win.s);
  }

  // ------------------------------------------------------------------
  // windows by frame type
  // ------------------------------------------------------------------
  function popWindow(g, c, win) {
    const { x, y, w, h } = win;
    const s = c.r(MAT.pop);
    const fr = c.m(MAT.almond[1]);
    // silver composite box: 2 px head, 1 px jambs, 2 px apron
    g.rect(x - 2, y - 3, w + 4, h + 6, s[1]);
    g.hline(x - 2, x + w + 1, y - 3, s[2]);
    g.vline(x - 2, y - 2, y + h + 1, s[2]);
    g.vline(x + w + 1, y - 2, y + h + 2, c.mode === 'golden' ? c.m('#f0e2c8') : s[0]);
    g.hline(x - 2, x + w + 1, y + h + 2, s[0]);
    g.rect(x - 1, y - 1, w + 2, h + 2, fr);
    fillGlass(g, c, win);
    g.vline(x + (w >> 1), y, y + h - 1, fr);
    g.hline(x, x + w - 1, y + 4, fr);
    // reveal: the box projects, so the glass top row sits in its shadow
    if (win.state === 'dark') g.hline(x, x + w - 1, y, c.mode === 'night' ? '#0a0e1d' : c.d(REFL[c.mode][2]));
  }
  function plainWindow(g, c, win, bayR) {
    const { x, y, w, h } = win;
    const fr = c.m(MAT.almond[1]);
    const st = c.r(MAT.stone);
    g.rect(x - 1, y - 1, w + 2, h + 2, fr);
    fillGlass(g, c, win);
    g.hline(x, x + w - 1, y + 4, fr);
    // cast-stone header and sill
    g.hline(x - 1, x + w, y - 2, st[1]);
    g.hline(x - 1, x + w, y - 3, st[0]);
    g.hline(x - 1, x + w, y + h + 1, st[2]);
    g.hline(x - 1, x + w, y + h + 2, st[0]);
    g.hline(x - 1, x + w, y + h + 3, bayR[0]); // shadow under the sill
  }
  function towerWindow(g, c, win) {
    const { x, y, w, h } = win;
    const fr = c.m('#30333a');
    g.rect(x - 1, y - 1, w + 2, h + 2, fr);
    fillGlass(g, c, win);
    g.vline(x + 5, y, y + h - 1, fr);
    g.hline(x, x + w - 1, y + 5, fr);
    if (h > 25) g.hline(x, x + w - 1, y + 21, fr);
  }
  function doorWindow(g, c, win) {
    const { x, y, w, h } = win;
    const fr = c.m(MAT.almond[1]);
    g.rect(x - 1, y - 1, w + 2, h + 1, fr);
    if (win.state === 'lit' || win.state === 'tv') wideRoom(g, c, win);
    else darkGlass(g, c, x, y, w, h, win.s);
    if (c.mode === 'golden' && win.glint && win.state !== 'lit') sunGlint(g, x, y, w, h, win.s);
    g.vline(DOOR.stile, y, y + h - 1, fr);
  }

  /** a neighbour's lit living room behind a balcony door (emissive) */
  function wideRoom(g, c, win) {
    const { x, y, w, h, s } = win;
    const e = g.em;
    if (win.state === 'tv') {
      e.rect(x, y, w, h, '#0f1828');
      e.rect(x + 3, y + 1, w - 6, h - 6, '#142438');
      e.rect(x + 7, y + h - 6, 14, 4, '#0a101c');
      e.hline(x + 7, x + 20, y + h - 6, '#1a2a3e');
      return;
    }
    const gold = c.mode === 'golden';
    // ramp: 0 deepest, 1 dark, 2 shade, 3 mid, 4 wall, 5 light
    const A = gold ? [AM[0], AM[1], AM[2], AM[2], AM[3], AM[5]] : [AM[1], AM[2], AM[3], AM[3], AM[4], AM[6]];
    e.rect(x, y, w, h, A[4]);
    e.hline(x, x + w - 1, y, A[3]);
    e.rect(x, y + h - 3, w, 3, A[3]);
    e.hline(x, x + w - 1, y + h - 3, A[2]);
    const k = Math.floor(s * 4);
    if (k === 0) {
      // a sofa back and a floor lamp
      e.rect(x + 23, y + 1, 9, 9, A[5]);
      e.rect(x + 26, y + 3, 3, 2, AM[8]);
      e.vline(x + 27, y + 5, y + h - 3, A[0]);
      e.rect(x + 5, y + h - 7, 14, 4, A[1]);
      e.hline(x + 5, x + 18, y + h - 7, A[2]);
    } else if (k === 1) {
      // a bookcase and a plant
      e.rect(x + 22, y + 2, 10, h - 5, A[1]);
      const SP = ['#b0502c', '#5a6a8a', '#d09040', '#7a8a4a', '#c87a5a'];
      for (let yy = y + 3; yy < y + h - 4; yy += 4)
        for (let xx = x + 23; xx < x + 31; xx++) if (HD.hash(xx, yy, 3) < 0.75) e.vline(xx, yy, yy + 2, gold ? A[2] : SP[(xx + yy) % SP.length]);
      e.rect(x + 7, y + h - 6, 3, 3, A[1]);
      e.rect(x + 6, y + h - 9, 5, 3, A[0]);
      e.px(x + 8, y + h - 10, A[0]);
    } else if (k === 2) {
      // a pendant lamp over a dining table
      e.vline(x + 18, y, y + 3, A[0]);
      e.rect(x + 13, y + 5, 11, 5, A[5]);
      e.rect(x + 16, y + 4, 5, 2, AM[8]);
      e.rect(x + 12, y + h - 7, 13, 1, A[0]);
      e.vline(x + 13, y + h - 6, y + h - 3, A[0]);
      e.vline(x + 23, y + h - 6, y + h - 3, A[0]);
    } else {
      // a framed picture and a tall plant
      e.rect(x + 10, y + 4, 8, 6, A[1]);
      e.rect(x + 11, y + 5, 6, 4, gold ? A[3] : '#3a6a7a');
      e.px(x + 15, y + 6, '#a8d0d4');
      e.rect(x + 26, y + h - 6, 4, 3, A[1]);
      for (let i = 0; i < 7; i++) e.px(x + 25 + ((i * 3) % 6), y + h - 8 - (i % 4), A[0]);
    }
    // curtains at the sides
    for (const cx of [x, x + w - 3]) {
      e.rect(cx, y, 3, h, A[2]);
      e.vline(cx + 1, y + 1, y + h - 1, A[3]);
    }
  }

  // ------------------------------------------------------------------
  // window layout and per-edition state
  // ------------------------------------------------------------------
  function layoutWindows() {
    const out = [];
    for (const f of FL) {
      out.push({ bay: 'L0', x: 151, y: f.y0 + 6, w: 9, h: 14, frame: 'plain', f: f.n });
      for (const x of [168, 183]) out.push({ bay: 'L', x, y: f.y0 + 6, w: 9, h: 14, frame: 'pop', f: f.n });
      for (const x of [251, 264]) out.push({ bay: 'R', x, y: f.y0 + 6, w: 9, h: 14, frame: 'plain', f: f.n });
      const tall = f.n === 5;
      for (const x of [280, 294, 308]) out.push({ bay: 'T', x, y: tall ? 48 : f.y0 + 4, w: 10, h: tall ? 35 : 19, frame: 'tower', f: f.n });
      if (f.n !== 3) out.push({ bay: 'M', x: DOOR.x, y: f.y0 + 4, w: DOOR.w, h: slabY(f) - (f.y0 + 4), frame: 'door', f: f.n });
    }
    return out;
  }
  const LOOKS = ['warm', 'warm', 'curtain', 'blind', 'lamp', 'plant', 'cool', 'dim', 'warm', 'curtain'];

  function assignWindows(env) {
    const { ed, c } = env;
    const wins = layoutWindows();
    const idx = env.idx;
    let thr = 0;
    if (c.mode === 'night') thr = ed.season === 'winter' ? 0.42 : ed.season === 'autumn' ? 0.39 : 0.36;
    else if (c.mode === 'dusk') thr = 0.36;
    else if (c.mode === 'golden') thr = 0.1;
    const tvBand = c.mode === 'night' ? (tagOf(ed, 'tv-match') ? 0.2 : 0.07) : c.mode === 'dusk' ? 0.04 : 0;
    for (const w of wins) {
      const h0 = HD.hash(w.x, w.y, 11);
      const h1 = HD.hash(w.x, w.y, 12, idx);
      const v = 0.68 * h0 + 0.32 * h1 + (w.bay === 'T' ? 0.05 : w.bay === 'M' ? 0.1 : 0);
      w.s = HD.hash(w.x, w.y, 13, idx);
      w.look = LOOKS[Math.floor(HD.hash(w.x, w.y, 14) * LOOKS.length)];
      w.state = v < thr ? 'lit' : v < thr + tvBand ? 'tv' : 'dark';
      w.glint = (w.bay === 'T' || w.bay === 'R') && HD.hash(w.x, w.y, 15, idx) < 0.35;
    }
    // keep the cat window the brightest unit of the centre bay: at most one
    // neighbour's balcony door lit (two at dusk), the rest dark
    const doors = wins.filter((w) => w.frame === 'door' && w.state === 'lit');
    doors.sort((a, b) => HD.hash(a.y, idx, 16) - HD.hash(b.y, idx, 16));
    doors.slice(c.mode === 'dusk' ? 2 : 1).forEach((w) => (w.state = 'dark'));
    return wins;
  }

  // ------------------------------------------------------------------
  // seasonal touches in a few neighbours' windows, and window boxes
  // ------------------------------------------------------------------
  const BOX_FLOWERS = {
    spring: ['#e85a7a', '#f0c030', '#f6f0e0', '#d84a6a'],
    summer: ['#d83a3a', '#f05a8a', '#e8e0f0', '#c82a3a'],
    autumn: ['#e07a1a', '#f0b030', '#b84a1a', '#e8a020'],
  };
  function seasonalWindows(g, env) {
    const { ed, c } = env;
    const lit = env.wins.filter((w) => w.state === 'lit' && w.frame !== 'door' && w.look !== 'curtain' && w.look !== 'blind');
    const pick = (n, seed) => lit.slice().sort((a, b) => HD.hash(a.x, a.y, seed) - HD.hash(b.x, b.y, seed)).slice(0, n);
    const e = g.em;
    if (ed.id === 'diwali') {
      for (const w of pick(3, 1)) {
        // a string of little gold lights across the top and a diya on the sill
        e.hline(w.x, w.x + w.w - 1, w.y + 1, AM[2]);
        for (let x = w.x + (w.x & 1); x < w.x + w.w; x += 2) e.px(x, w.y + 2, '#ffe28a');
        e.hline(w.x + 1, w.x + 3, w.y + w.h - 2, AM[1]);
        e.px(w.x + 2, w.y + w.h - 3, '#fff2b0');
        e.px(w.x + 2, w.y + w.h - 4, '#ffb040');
      }
    } else if (ed.id === 'halloween25') {
      for (const w of pick(2, 2)) {
        // a carved pumpkin on the sill
        const px = w.x + w.w - 5;
        const py = w.y + w.h - 4;
        e.rect(px, py, 4, 3, '#a8401a');
        e.hline(px, px + 3, py, '#c85a22');
        e.px(px + 1, py + 1, '#ffd070');
        e.px(px + 2, py + 1, '#ffd070');
        e.px(px + 1, py - 1, '#2a3a12');
      }
    } else if (ed.id === 'christmas') {
      for (const w of pick(3, 3)) {
        // a small tree with coloured lights
        const tx = w.x + 2 + (HD.hash(w.x, w.y, 4) < 0.5 ? 0 : w.w - 6);
        const by = w.y + w.h - 2;
        const G = ['#1a4a26', '#225a30'];
        for (let r = 0; r < 7; r++) {
          const hw = r < 2 ? 0 : r < 4 ? 1 : 2;
          e.hline(tx - hw, tx + hw, by - 7 + r, G[r & 1]);
        }
        e.px(tx, by, AM[1]);
        e.px(tx, by - 8, '#fff2b0');
        const B = ['#ff5a4a', '#ffe28a', '#5a9aff', '#5ae07a'];
        for (let k = 0; k < 4; k++) e.px(tx + [-1, 1, 0, -2][k], by - [3, 4, 6, 1][k], B[(k + w.x) % 4]);
      }
    } else if (ed.id === 'lunar') {
      for (const w of pick(3, 5)) {
        // a red paper lantern hanging in the window
        const lx = w.x + (w.w >> 1) - 1;
        e.vline(lx + 1, w.y, w.y + 1, AM[1]);
        e.hline(lx, lx + 2, w.y + 2, '#e0b636');
        e.rect(lx - 1, w.y + 3, 5, 4, '#c4262f');
        e.vline(lx + 1, w.y + 3, w.y + 6, '#ff6b5a');
        e.hline(lx, lx + 2, w.y + 7, '#e0b636');
        e.px(lx + 1, w.y + 8, '#e0b636');
      }
    }
    // window boxes on the plain windows from spring to autumn
    const fl = BOX_FLOWERS[ed.season];
    if (!fl) return;
    for (const w of env.wins) {
      if (w.frame !== 'plain' || w.f === 5 || HD.hash(w.x, w.y, 9) > 0.5) continue;
      const by = w.y + w.h;
      g.rect(w.x - 1, by - 1, w.w + 2, 2, c.m('#5a4436'));
      g.hline(w.x - 1, w.x + w.w, by - 1, c.m('#7a5c48'));
      for (let x = w.x; x < w.x + w.w; x++) {
        const hv = HD.hash(x, by, 10);
        g.px(x, by - 2, c.m(hv < 0.5 ? '#3a6a32' : '#4a7a3a'));
        if (hv < 0.6) g.px(x, by - 3 - (hv < 0.2 ? 1 : 0), c.m(fl[Math.floor(hv * 40) % fl.length]));
      }
    }
  }

  // ------------------------------------------------------------------
  // the left neighbour: cinema box, blank marquee blade, toy-brick shop
  // ------------------------------------------------------------------
  const BLADE = { x0: 92, x1: 101, y0: 94, y1: 157 };
  function drawNeighbour(g, env) {
    const c = env.c;
    const cn = c.r(MAT.cin);
    // cinema box
    g.rect(0, 112, 148, 60, cn[2]);
    for (let x = 4; x < 148; x += 12) {
      g.vline(x, 116, 165, cn[3]);
      g.vline(x + 1, 116, 165, cn[0]);
    }
    g.hline(0, 147, 112, c.m('#7a7282'));
    g.hline(0, 147, 113, cn[3]);
    g.hline(0, 147, 114, cn[1]);
    g.hline(0, 147, 115, cn[0]);
    g.hline(0, 147, 140, cn[1]);
    // tall stair slits (faint glow at night)
    for (const x of [9, 21, 33, 45]) {
      const y0 = 121;
      const y1 = 158;
      g.rect(x - 1, y0 - 1, 5, y1 - y0 + 2, cn[0]);
      if (c.lit) {
        // a dim stairwell: landings and a light on some of them
        g.em.rect(x, y0, 3, y1 - y0, '#161c2e');
        for (let y = y0 + 5; y < y1; y += 9) {
          g.em.hline(x, x + 2, y, '#2a3046');
          if (HD.hash(x, y, 8) < 0.3) g.em.px(x + 1, y - 2, AM[3]);
        }
      } else darkGlass(g, c, x, y0, 3, y1 - y0, 0.3);
    }
    // a big lightbox poster (abstract: night sky over hills, no text)
    {
      const x = 112;
      const y = 122;
      const w = 22;
      const h = 34;
      g.rect(x - 2, y - 2, w + 4, h + 4, c.m(MAT.steel[1]));
      g.hline(x - 2, x + w + 1, y - 2, c.m(MAT.steel[2]));
      const e = c.lit || c.mode === 'golden' ? g.em : g;
      const col = (hx) => (e === g ? c.d(hx) : hx);
      e.rect(x, y, w, h, col('#1c2a5a'));
      e.rect(x, y + 12, w, 10, col('#2a3c78'));
      e.dither(x, y + 10, w, 3, col('#2a3c78'), 0.5);
      e.rect(x, y + 20, w, 6, col('#5a3c7a'));
      e.circle(x + 15, y + 8, 3.2, col('#ffe7aa'));
      e.circle(x + 16, y + 7, 2.4, col('#1c2a5a'));
      e.poly(
        [
          [x, y + 34],
          [x, y + 26],
          [x + 6, y + 22],
          [x + 12, y + 27],
          [x + 17, y + 24],
          [x + 22, y + 27],
          [x + 22, y + 34],
        ],
        col('#140f24'),
      );
      for (let k = 0; k < 6; k++) e.px(x + 2 + ((k * 7) % 19), y + 2 + ((k * 5) % 9), col('#d2def0'));
      e.rect(x + 3, y + 29, 16, 2, col('#c97436'));
    }
    // the marquee blade (blank), with a steel strut to the roof
    {
      const b = c.r(MAT.blade);
      const { x0, x1, y0, y1 } = BLADE;
      for (const by of [y0 + 6, y1 - 6]) {
        g.hline(x1 + 1, x1 + 3, by, c.m(MAT.steel[2]));
        g.hline(x1 + 1, x1 + 3, by + 1, c.m(MAT.steel[0]));
      }
      g.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, c.m(MAT.steel[1]));
      g.rect(x0 + 2, y0 + 2, x1 - x0 - 3, y1 - y0 - 3, b[1]);
      g.vline(x0 + 2, y0 + 2, y1 - 2, b[2]);
      g.vline(x1 - 2, y0 + 2, y1 - 2, b[0]);
      // stepped crown and a pointed foot
      g.rect(x0 - 1, y0 - 2, x1 - x0 + 3, 2, c.m(MAT.steel[2]));
      g.rect(x0 + 2, y0 - 4, x1 - x0 - 3, 2, b[2]);
      g.rect(x0 + 3, y1 + 1, x1 - x0 - 5, 2, c.m(MAT.steel[1]));
      // inlaid diamonds (decoration, not lettering)
      const gold = c.m('#c9a050');
      for (let y = y0 + 8; y < y1 - 6; y += 10) {
        const cx = (x0 + x1) >> 1;
        g.px(cx, y, gold);
        g.px(cx + 1, y, gold);
        g.px(cx, y + 1, gold);
        g.px(cx + 1, y + 1, gold);
        g.px(cx - 1, y + 1, b[2]);
        g.px(cx + 2, y, b[2]);
      }
      // bulb sockets (bulbs drawn per frame when lit)
      for (const p of bladeBulbs()) g.px(p[0], p[1], c.lit || c.mode === 'golden' ? AM[2] : c.m('#d8c8a0'));
    }
    // band
    g.rect(0, 166, 148, 6, c.m(MAT.band[1]));
    g.hline(0, 147, 166, c.m(MAT.band[2]));
    g.hline(0, 147, 171, c.m(MAT.band[0]));
    g.rect(144, 172, 4, 34, c.m(MAT.pier[1])); // party-wall pier
    g.vline(147, 172, 205, c.m(MAT.pier[0]));
    // ground floor: cinema entrance
    {
      const pr = c.r(MAT.pier);
      g.rect(0, 172, 53, 34, pr[1]);
      // marquee canopy
      g.rect(0, 172, 53, 4, c.m(MAT.steel[1]));
      g.hline(0, 52, 172, c.m(MAT.steel[2]));
      for (const p of canopyBulbs()) g.px(p[0], p[1], c.lit || c.mode === 'golden' ? AM[2] : c.m('#d8c8a0'));
      // two poster cases
      for (const [x, k] of [
        [3, 0],
        [40, 1],
      ]) {
        g.rect(x - 1, 180, 11, 20, c.m(MAT.steel[2]));
        const e = c.lit || c.mode === 'golden' ? g.em : g;
        const col = (hx) => (e === g ? c.d(hx) : hx);
        if (k === 0) {
          e.rect(x, 181, 9, 18, col('#c84a3a'));
          e.rect(x, 191, 9, 8, col('#5a1a3a'));
          e.circle(x + 4, 187, 2.2, col('#ffd070'));
          e.rect(x + 1, 196, 7, 1, col('#ffe7aa'));
        } else {
          e.rect(x, 181, 9, 18, col('#2a6a7a'));
          e.rect(x, 189, 9, 10, col('#1a3a4a'));
          e.poly(
            [
              [x, 199],
              [x + 4, 190],
              [x + 8, 199],
            ],
            col('#d8e8e0'),
          );
          e.rect(x + 1, 196, 7, 1, col('#ffe7aa'));
        }
      }
      // glass doors to a warm lobby
      g.rect(15, 178, 22, 28, c.m(MAT.steel[0]));
      shopInterior(g, c, 16, 179, 20, 27, 'cinema');
      g.vline(26, 179, 205, c.m(MAT.steel[0]));
      g.vline(20, 192, 197, c.m(MAT.steel[2]));
      g.vline(32, 192, 197, c.m(MAT.steel[2]));
    }
    // toy-brick shop: red portal, yellow band with studs, blue piers
    {
      const rd = c.r(MAT.toyRed);
      const yl = c.r(MAT.toyYel);
      const bl = c.r(MAT.toyBlue);
      g.rect(53, 167, 91, 39, rd[1]);
      g.hline(53, 143, 205, rd[0]);
      g.rect(53, 167, 91, 5, yl[1]);
      g.hline(53, 143, 167, yl[2]);
      g.hline(53, 143, 171, yl[0]);
      for (let x = 55; x < 142; x += 6) {
        g.hline(x + 1, x + 3, 165, yl[1]);
        g.hline(x, x + 4, 166, yl[1]);
        g.px(x + 1, 165, yl[2]);
      }
      g.rect(53, 172, 4, 34, bl[1]);
      g.vline(53, 172, 205, bl[2]);
      g.rect(140, 172, 4, 34, bl[1]);
      g.vline(143, 172, 205, bl[0]);
      g.rect(57, 173, 83, 33, c.m(MAT.steel[0]));
      shopInterior(g, c, 58, 174, 82, 32, 'toys');
      for (let x = 74; x < 140; x += 16) g.vline(x, 174, 205, c.m(MAT.steel[0]));
      g.hline(58, 139, 185, c.m(MAT.steel[0]));
      // a giant toy-brick stack by the door
      giantBrick(g, c, 124, 201, 16, MAT.toyRed);
      giantBrick(g, c, 128, 196, 10, MAT.toyBlue);
      giantBrick(g, c, 130, 191, 6, MAT.toyYel);
    }
  }
  function giantBrick(g, c, x, y, w, mat) {
    const r = c.r(mat);
    g.rect(x, y, w, 5, r[1]);
    g.hline(x, x + w - 1, y, r[2]);
    g.vline(x + w - 1, y + 1, y + 4, r[0]);
    for (let s = x + 1; s < x + w - 2; s += 4) {
      g.rect(s, y - 2, 2, 2, r[1]);
      g.px(s, y - 2, r[2]);
    }
  }
  function bladeBulbs() {
    const out = [];
    for (let y = BLADE.y0 + 2; y <= BLADE.y1 - 2; y += 3) {
      out.push([BLADE.x0 + 1, y]);
      out.push([BLADE.x1 - 1, y]);
    }
    return out;
  }
  function canopyBulbs() {
    const out = [];
    for (let x = 2; x < 52; x += 3) out.push([x, 175]);
    return out;
  }

  // ------------------------------------------------------------------
  // shop interiors (emissive at dusk and night, dimmer at golden hour,
  // plain by day with reflections)
  // ------------------------------------------------------------------
  function shopPal(c, closed) {
    if (closed && c.mode === 'night')
      return { e: 0, closed: 1, wall: '#17141c', wall2: '#1d1922', hi: '#2a2430', lamp: AM[4], mid: '#121017', dark: '#0d0b11', deep: '#09080c' };
    if (c.lit) return { e: 1, wall: AM[4], wall2: AM[5], hi: AM[6], lamp: AM[8], mid: AM[3], dark: AM[2], deep: AM[1] };
    if (c.mode === 'golden') return { e: 1, wall: AM[3], wall2: AM[4], hi: AM[5], lamp: AM[7], mid: AM[2], dark: AM[1], deep: AM[0] };
    return {
      e: 0,
      wall: c.d('#6e5e50'),
      wall2: c.d('#7e6c5c'),
      hi: c.d('#a89884'),
      lamp: '#fff0c8',
      mid: c.d('#55473c'),
      dark: c.d('#342c28'),
      deep: c.d('#241e1c'),
    };
  }
  const GOODS = ['#d8443c', '#f0b030', '#3a8ad0', '#4aa860', '#d86aa0', '#f2efe4', '#8a5ad0', '#f07a30'];
  function shopInterior(g, c, x, y, w, h, kind, closed) {
    const s = shopPal(c, closed);
    const e = s.e ? g.em : g;
    const gc = (hx) => (s.closed ? CL.mix(hx, '#0e0b12', 0.72) : s.e ? hx : c.d(hx)); // goods colour
    e.rect(x, y, w, h, s.wall);
    e.rect(x, y + 1, w, Math.round(h * 0.42), s.wall2); // the lamp-lit upper zone
    e.hline(x, x + w - 1, y, s.mid);
    e.rect(x, y + h - 3, w, 3, s.mid);
    if (kind === 'cafe') {
      e.rect(x, y + h - 10, w, 1, s.dark); // back counter
      e.rect(x, y + h - 9, w, 3, s.mid);
      for (const px of [x + 5, x + 15, x + 25, x + 35]) {
        if (px >= x + w - 1) continue;
        e.vline(px, y, y + 2, s.dark);
        e.rect(px - 1, y + 3, 3, 1, s.lamp);
        e.rect(px - 2, y + 4, 5, 2, s.hi);
      }
      // tables and seated diners (cat silhouettes)
      for (const [dx, face] of [
        [6, 1],
        [19, -1],
        [31, 1],
      ]) {
        if (dx > w - 6) continue;
        const tx = x + dx;
        const ty = y + h - 6;
        e.rect(tx, ty, 6, 1, s.deep);
        e.vline(tx + 2, ty + 1, y + h - 1, s.deep);
        e.px(tx + 1, ty - 1, gc('#f2efe4'));
        const cx = tx + (face > 0 ? -3 : 6);
        e.rect(cx, ty - 4, 3, 6, s.deep);
        e.rect(cx, ty - 7, 3, 3, s.deep);
        e.px(cx, ty - 8, s.deep);
        e.px(cx + 2, ty - 8, s.deep);
      }
    } else if (kind === 'florist') {
      for (const px of [x + 4, x + 12]) {
        e.vline(px, y, y + 3, s.dark);
        e.rect(px - 1, y + 4, 3, 2, gc('#4a8a3a'));
        e.px(px - 2, y + 6, gc('#3a7a30'));
        e.px(px + 2, y + 7, gc('#3a7a30'));
        e.px(px, y + 7, gc('#3a7a30'));
      }
      // buckets of flowers
      for (let bx = x + 1; bx < x + w - 3; bx += 4) {
        const k = Math.floor(HD.hash(bx, 3, 9) * GOODS.length);
        e.rect(bx, y + h - 6, 3, 4, s.dark);
        e.hline(bx, bx + 2, y + h - 6, s.mid);
        for (let j = 0; j < 4; j++) e.px(bx + (j % 3), y + h - 8 - (j >> 1), gc(GOODS[(k + j) % GOODS.length]));
        e.px(bx + 1, y + h - 7, gc('#3a7a30'));
      }
      e.rect(x + w - 8, y + 9, 6, 1, s.dark);
      for (let i = 0; i < 3; i++) e.px(x + w - 7 + i * 2, y + 8, gc(GOODS[(i * 3) % GOODS.length]));
    } else if (kind === 'books') {
      // shelves of coloured spines on the back wall, a display table in front
      for (let sy = y + 3; sy < y + h - 9; sy += 5) {
        e.hline(x + 1, x + w - 2, sy + 4, s.dark);
        for (let bx = x + 1; bx < x + w - 1; bx++) {
          const hv = HD.hash(bx, sy, 21);
          if (hv < 0.15) continue;
          const hh = hv < 0.5 ? 3 : 4;
          e.vline(bx, sy + 4 - hh, sy + 3, gc(GOODS[Math.floor(hv * 97) % GOODS.length]));
        }
      }
      e.rect(x + 6, y + h - 6, w - 12, 2, s.dark);
      e.vline(x + 7, y + h - 4, y + h - 1, s.deep);
      e.vline(x + w - 8, y + h - 4, y + h - 1, s.deep);
      for (let bx = x + 8; bx < x + w - 9; bx += 5) {
        e.rect(bx, y + h - 8, 3, 2, gc(GOODS[(bx * 7) % GOODS.length]));
        e.hline(bx, bx + 2, y + h - 9, gc('#f2efe4'));
      }
      for (const px of [x + 10, x + 30]) {
        e.vline(px, y, y + 1, s.dark);
        e.rect(px - 1, y + 2, 3, 1, s.lamp);
      }
    } else if (kind === 'toys') {
      // bright toy shop: shelves of coloured brick boxes and a brick tower
      e.rect(x, y, w, h, s.e ? s.wall2 : c.d('#8a7a64'));
      e.rect(x, y, w, Math.round(h * 0.4), s.e ? s.hi : c.d('#9a8a74'));
      const TB = ['#d23a3a', '#2a62c0', '#e8b42a', '#2c9a4c', '#f0f0e8', '#e05a2a'];
      for (let sy = y + 4; sy < y + h - 8; sy += 7) {
        e.hline(x + 1, x + w - 2, sy + 5, s.dark);
        for (let bx = x + 2; bx < x + w - 5; bx += 6) {
          const k = Math.floor(HD.hash(bx, sy, 31) * TB.length);
          if (HD.hash(bx, sy, 32) < 0.2) continue;
          e.rect(bx, sy + 1, 5, 4, gc(TB[k]));
          e.hline(bx, bx + 4, sy + 1, gc(TB[(k + 2) % TB.length]));
        }
      }
      // tower of bricks in the window
      const tx = x + 30;
      for (let i = 0; i < 6; i++) {
        const k = i % TB.length;
        e.rect(tx + (i & 1), y + h - 4 - i * 4, 8, 4, gc(TB[k]));
        e.hline(tx + (i & 1), tx + (i & 1) + 7, y + h - 4 - i * 4, gc(TB[(k + 3) % TB.length]));
      }
      e.rect(x, y + h - 3, w, 3, s.e ? AM[4] : c.d('#5a4a3c'));
    } else if (kind === 'cinema') {
      e.rect(x, y + h - 9, w, 1, s.dark);
      e.rect(x + 3, y + h - 8, w - 6, 5, s.mid);
      e.rect(x + 2, y + 2, w - 4, 4, gc('#c84a3a'));
      e.rect(x + 3, y + 3, w - 6, 2, s.e ? AM[7] : c.d('#e8c8a0'));
    } else if (kind === 'lobby') {
      e.rect(x, y, w, h, s.e ? AM[6] : c.d('#8a7e6e'));
      e.rect(x, y, w, 9, s.e ? AM[7] : c.d('#9a8e7e'));
      e.rect(x, y + h - 2, w, 2, s.e ? AM[4] : c.d('#6a5e50'));
    }
    if (c.mode === 'golden') {
      g.rect(x, y, w, 2, c.d('#f0c890'));
      for (let k = 2; k < h; k++) {
        const xx = x + Math.round(w * 0.6) - k;
        for (let d = 0; d < 2; d++) if (xx + d >= x && xx + d < x + w) g.px(xx + d, y + k, c.d('#e8b888'));
      }
    }
    if (s.closed) {
      // closed for the night: one display light left on, a dark reflection
      g.em.rect(x + (w >> 1) - 2, y + 2, 5, 1, s.lamp);
      g.em.rect(x + (w >> 1) - 3, y + 3, 7, 1, AM[2]);
      g.hline(x, x + w - 1, y, '#232a40');
      for (let k = 0; k < Math.min(w, h); k++) if (k % 2 === 0) g.px(x + w - 1 - k, y + 1 + k, '#1c2236');
    } else if (!s.e) {
      // daylight: the sky caught at the top of the glass, broad soft sheens
      g.rect(x, y, w, 2, c.d('#b4c6d8'));
      for (let i = 8; i < w + h; i += 23) {
        for (let k = 2; k < h; k++) {
          const xx = x + i - k;
          for (let d = 0; d < 2; d++) if (xx + d >= x && xx + d < x + w) g.px(xx + d, y + k, c.d('#a4b4c4'));
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // the apartment block
  // ------------------------------------------------------------------
  const BAY = { L0: [148, 163], L: [163, 196], M: [196, 246], R: [246, 276], T: [276, 323] };
  function drawBlock(g, env) {
    const c = env.c;
    const ch = c.r(MAT.char);
    const spk = c.r(MAT.charSpk);
    const es = c.r(MAT.esp);
    const mv = c.r(MAT.mauve);
    brickWall(g, BAY.L0[0], 56, BAY.L0[1], 166, ch, 10, spk);
    brickWall(g, BAY.L[0], 56, BAY.L[1], 166, es, 11);
    brickWall(g, BAY.M[0], 56, BAY.M[1], 166, ch, 12, spk);
    brickWall(g, BAY.R[0], 56, BAY.R[1], 166, mv, 13);
    // bay joints: the end bay and the mauve bay step forward a little
    g.vline(BAY.L[0], 56, 165, ch[0]);
    g.vline(BAY.R[1] - 1, 56, 165, mv[0]);
    // recess: deep shadow on its left return, a lit edge on its right
    g.rect(BAY.M[0], 56, 2, 110, c.m('#1c1b20'));
    g.vline(BAY.M[0] + 2, 56, 165, ch[0]);
    g.vline(BAY.M[1] - 1, 56, 165, c.m('#2a282e'));
    g.rect(BAY.M[0], 56, 50, 2, c.m('#1c1b20'));
    // a soft shadow under the cornice on every bay
    g.hline(148, 275, 56, c.m('#1e1c22'));
    g.hline(148, 275, 57, c.m('#2a272d'));
    // corner tower: silver metal panels
    const pn = c.r(MAT.panel);
    g.rect(276, 44, 47, 122, pn[2]);
    for (let y = 44; y < 166; y++) {
      const rel = (y - 44) % 13;
      if (rel === 0) g.hline(276, 322, y, pn[0]);
      else if (rel === 1) g.hline(276, 322, y, pn[3]);
    }
    for (const x of [291, 305]) g.vline(x, 44, 165, pn[1]);
    g.vline(276, 44, 165, pn[3]);
    g.vline(277, 44, 165, c.m('#9a9ea6'));
    g.vline(322, 44, 165, pn[1]);
    // the mauve bay's return against the tower
    g.vline(275, 56, 165, c.m('#1e1c22'));
    if (c.mode === 'night') {
      // cold rim of moon and city glow on the tower's right edge
      g.vline(322, 44, 165, '#5670a3');
      for (let y = 45; y < 166; y += 2) g.px(321, y, '#41558a');
    } else if (c.mode === 'golden') {
      // the low sun rakes the tower's right edge
      g.vline(322, 44, 165, c.d('#fff0d0'));
      g.vline(321, 44, 165, c.d('#f4d6a8'));
    }
  }

  function drawWindows(g, env) {
    const c = env.c;
    const mv = c.r(MAT.mauve);
    const ch = c.r(MAT.char);
    for (const w of env.wins) {
      if (w.frame === 'pop') popWindow(g, c, w);
      else if (w.frame === 'plain') plainWindow(g, c, w, w.bay === 'R' ? mv : ch);
      else if (w.frame === 'tower') towerWindow(g, c, w);
      else if (w.frame === 'door') doorWindow(g, c, w);
    }
    // the cat window's frame (its room is drawn per frame)
    const fr = c.m(MAT.almond[1]);
    g.rect(CW.x - 1, CW.y - 1, CW.w + 2, CW.h + 1, fr);
    // tower spandrel panels between ribbon windows get a deeper joint
    const pn = c.r(MAT.panel);
    for (const f of FL) if (f.n < 5) g.hline(277, 321, f.y0 + 1, pn[0]);
  }

  function balcony(g, c, f, withRail) {
    const sy = slabY(f);
    const ry = railY(f);
    const sl = c.r(MAT.slab);
    g.rect(BAL.x0, sy, BAL.x1 - BAL.x0 + 1, 3, sl[1]);
    g.hline(BAL.x0, BAL.x1, sy, sl[2]);
    g.hline(BAL.x0, BAL.x1, sy + 2, sl[0]);
    // shadow under the slab on the wall and glass below
    if (f.n > 2) g.hline(BAL.x0 - 1, BAL.x1 + 1, sy + 3, c.m('#141318'));
    if (withRail) rail(g, c, ry, sy);
  }
  function rail(g, c, ry, sy) {
    const st = c.r(MAT.steel);
    g.hline(BAL.x0, BAL.x1, ry, st[2]);
    for (let x = BAL.x0; x <= BAL.x1; x += 3) g.vline(x, ry + 1, sy - 1, st[0]);
    g.vline(BAL.x1, ry, sy - 1, st[1]);
    g.vline(BAL.x0, ry, sy - 1, st[1]);
  }

  function drawRoof(g, env) {
    const c = env.c;
    const co = c.r(MAT.cor);
    const rf = c.r(MAT.roof);
    // low screens around the rooftop plant
    for (const [x0, x1, y] of [
      [170, 199, 47],
      [226, 249, 48],
    ]) {
      g.rect(x0, y, x1 - x0 + 1, 52 - y, rf[1]);
      g.hline(x0, x1, y, rf[2]);
      for (let x = x0 + 2; x < x1; x += 3) g.vline(x, y + 1, 51, rf[0]);
    }
    // main cornice: a thin cantilevered blade
    g.rect(145, 52, 135, 4, co[1]);
    g.hline(145, 279, 52, co[3]);
    g.hline(145, 279, 53, co[2]);
    g.hline(145, 279, 55, co[0]);
    // tower cornice, deeper
    g.rect(272, 40, 55, 4, co[1]);
    g.hline(272, 326, 40, co[3]);
    g.hline(272, 326, 41, co[2]);
    g.hline(272, 326, 43, co[0]);
    g.hline(276, 322, 44, c.m('#3a3d44'));
    if (c.mode === 'night') {
      g.px(326, 40, '#a3b8d8');
      g.px(326, 41, '#7790bd');
      g.px(279, 52, '#7790bd');
    }
  }

  function drawRetail(g, env) {
    const c = env.c;
    const bd = c.r(MAT.band);
    const st = c.r(MAT.steel);
    const pr = c.r(MAT.pier);
    // the datum band above the shops
    g.rect(148, 166, 175, 6, bd[1]);
    g.hline(148, 322, 166, bd[2]);
    g.hline(148, 322, 171, bd[0]);
    // piers behind everything
    g.rect(148, 172, 175, 34, pr[1]);
    // --- cafe (teal awning)
    g.rect(150, 175, 46, 31, st[0]);
    shopInterior(g, c, 152, 177, 42, 29, 'cafe');
    for (const x of [162, 172, 182]) g.vline(x, 177, 205, st[0]);
    g.vline(183, 177, 205, st[1]);
    g.hline(184, 193, 191, st[2]);
    awning(g, c, 148, 196, MAT.teal);
    // --- lobby
    lobby(g, c, env);
    // --- florist (mustard awning)
    g.rect(247, 175, 29, 31, st[0]);
    shopInterior(g, c, 249, 177, 25, 29, 'florist', env.floristClosed);
    g.vline(265, 177, 205, st[0]);
    g.hline(267, 272, 191, st[2]);
    awning(g, c, 246, 276, MAT.mustard);
    // --- corner bookshop, glazed full height with a slim steel canopy
    g.rect(277, 172, 46, 34, st[0]);
    shopInterior(g, c, 279, 175, 42, 31, 'books');
    for (const x of [289, 299, 309]) g.vline(x, 175, 205, st[0]);
    g.hline(279, 320, 184, st[0]);
    g.rect(276, 172, 47, 2, st[2]);
    g.hline(276, 322, 172, c.m(MAT.cor[2]));
    // blank fabric blade sign at the corner (muted red)
    const rd = c.r(['#5a1c1c', '#8a2c2a', '#a83a34']);
    g.rect(322, 160, 2, 1, st[2]);
    g.rect(322, 172, 2, 1, st[2]);
    g.rect(324, 159, 5, 15, rd[1]);
    g.vline(324, 159, 173, rd[2]);
    g.vline(328, 159, 173, rd[0]);
    g.hline(324, 328, 159, rd[2]);
    g.hline(325, 327, 174, rd[0]);
    // a rain-garden planter at the tower base
    g.rect(300, 203, 21, 3, c.m('#2c2a28'));
    g.hline(300, 320, 203, c.m('#55524c'));
    const lf = env.ed.season === 'winter' ? c.m('#6a5a48') : env.ed.season === 'autumn' ? c.m('#a8642a') : c.m('#4a7a3a');
    for (let x = 301; x < 320; x += 2) g.px(x, 202 - (x % 3 === 0 ? 1 : 0), lf);
  }

  function awning(g, c, x0, x1, mat) {
    const a = c.r(mat);
    for (let y = 172; y < 177; y++) {
      g.hline(x0, x1 - 1, y, a[1]);
      for (let x = x0; x < x1; x += 4) g.hline(x, x + 1, y, a[0]);
    }
    g.hline(x0, x1 - 1, 172, a[2]);
    for (let x = x0; x < x1; x += 4) g.px(x, 172, a[1]);
    // scalloped valance
    for (let x = x0; x < x1; x++) {
      g.px(x, 177, a[(x - x0) % 4 < 2 ? 0 : 1]);
      if ((x - x0) % 4 === 1 || (x - x0) % 4 === 2) g.px(x, 178, a[0]);
    }
  }

  function lobby(g, c, env) {
    const st = c.r(MAT.steel);
    const bd = c.r(MAT.band);
    // metal frame and the left pier (left plain for the plaque)
    g.rect(198, 172, 47, 34, bd[1]);
    g.vline(198, 172, 205, bd[2]);
    g.rect(199, 174, 12, 32, c.m('#3a3436'));
    g.vline(199, 174, 205, c.m('#4a4446'));
    // transom over the doors and the tall sidelight: a lofty lit lobby
    g.rect(211, 173, 33, 33, st[0]);
    shopInterior(g, c, 212, 174, 31, 32, 'lobby');
    const s = shopPal(c);
    const e = s.e ? g.em : g;
    // a stair rising behind the sidelight: a stepped mass with a handrail
    const stc = s.e ? AM[4] : c.d('#5a4c42');
    const trc = s.e ? AM[7] : c.d('#8a7a6a');
    for (let k = 0; k < 5; k++) {
      const sx = 233 + k * 2;
      const sy = 202 - k * 4;
      e.rect(sx, sy, 243 - sx, 206 - sy, stc);
      e.hline(sx, Math.min(242, sx + 1), sy, trc);
    }
    for (let k = 0; k < 9; k++) e.px(233 + k, 197 - k * 2, s.e ? AM[2] : c.d('#2a2422'));
    for (const hx of [235, 239]) e.vline(hx, 196 - (hx - 233) * 2, 199 - (hx - 233) * 2, s.e ? AM[2] : c.d('#2a2422'));
    // pendant lights
    for (const px of [217, 225]) {
      e.vline(px, 174, 176, s.e ? AM[3] : c.d('#3a302a'));
      g.em.rect(px - 1, 177, 3, 1, c.mode === 'day' ? '#fff0c8' : AM[8]);
      if (s.e) e.rect(px - 2, 178, 5, 2, AM[7]);
    }
    // planter
    e.rect(238, 200, 4, 5, s.e ? AM[1] : c.d('#3a3430'));
    for (let i = 0; i < 4; i++) e.px(237 + i * 2, 198 - (i & 1), s.e ? AM[2] : c.d('#3a6a3a'));
    // door frame: two glass leaves (redrawn when they slide open)
    g.hline(212, 230, 185, st[1]);
    g.rect(211, 185, 21, 21, st[0]);
    lobbyDoors(g, c, 0);
    g.vline(231, 174, 205, st[0]);
    // the canopy
    const co = c.r(MAT.cor);
    g.rect(ENT.canopy.x0, 168, ENT.canopy.x1 - ENT.canopy.x0 + 1, 4, co[1]);
    g.hline(ENT.canopy.x0, ENT.canopy.x1, 168, co[3]);
    g.hline(ENT.canopy.x0, ENT.canopy.x1, 169, co[2]);
    g.hline(ENT.canopy.x0, ENT.canopy.x1, 171, co[0]);
    for (const x of [205, 237]) g.vline(x, 172, 173, st[1]);
    for (const x of [204, 221, 238]) g.em.px(x, 171, c.lit ? AM[8] : c.mode === 'golden' ? AM[7] : '#fff0c8');
  }
  /** the two lobby door leaves, slid open by `o` px each */
  function lobbyDoors(g, c, o) {
    const st = c.r(MAT.steel);
    const s = shopPal(c);
    const e = s.e ? g.em : g;
    const glass = s.e ? AM[6] : c.d('#8a8070');
    const bright = s.e ? AM[7] : c.d('#9a9080');
    // opening between the leaves shows the lobby
    if (o > 0) {
      e.rect(221 - o, 186, 2 * o + 1, 20, bright);
      e.hline(221 - o, 221 + o, 205, s.e ? AM[4] : c.d('#5a5048'));
    }
    // left leaf 212..220, right leaf 222..230 (each slides away from the middle)
    for (const [x0, dir] of [
      [212, -1],
      [222, 1],
    ]) {
      const x = x0 + dir * o;
      const vis0 = Math.max(x, 212);
      const vis1 = Math.min(x + 8, 230);
      if (vis1 < vis0) continue;
      e.rect(vis0, 186, vis1 - vis0 + 1, 20, glass);
      e.rect(vis0, 186, vis1 - vis0 + 1, 3, bright);
      g.rect(vis0, 203, vis1 - vis0 + 1, 3, st[1]); // kick plate
      const edge = dir < 0 ? x + 8 : x;
      if (edge >= 212 && edge <= 230) g.vline(edge, 186, 205, st[0]);
      const bar = dir < 0 ? x + 6 : x + 2;
      if (bar >= 212 && bar <= 230) g.vline(bar, 193, 198, st[2]);
    }
    g.vline(211, 185, 205, st[0]);
  }

  // ------------------------------------------------------------------
  // snow on ledges (christmas heavy, new year and lunar light)
  // ------------------------------------------------------------------
  function snowLine(g, x0, x1, y, amt, seed) {
    const S = P.snow;
    for (let x = x0; x <= x1; x++) {
      const h = HD.hash(x, y, seed);
      if (amt < 0.6 && h > amt * 2.2) continue;
      g.px(x, y - 1, S[7]);
      if (amt >= 0.6 && h < 0.45) g.px(x, y - 2, S[6]);
      if (amt >= 0.6 && h > 0.93) g.px(x, y, S[5]);
    }
  }
  function drawSnow(g, env) {
    const a = env.snow;
    snowLine(g, 0, 147, 112, a, 1);
    snowLine(g, BLADE.x0 - 1, BLADE.x1 + 1, BLADE.y0 - 2, Math.max(a, 0.7), 2);
    snowLine(g, 145, 279, 52, a, 3);
    snowLine(g, 272, 326, 40, a, 4);
    snowLine(g, 170, 199, 47, a, 5);
    snowLine(g, 226, 249, 48, a, 6);
    snowLine(g, 148, 322, 166, a * 0.8, 7);
    snowLine(g, ENT.canopy.x0, ENT.canopy.x1, 168, a, 8);
    snowLine(g, 148, 195, 172, a, 9);
    snowLine(g, 246, 275, 172, a, 10);
    snowLine(g, 53, 143, 165, a * 0.8, 11);
    for (const w of env.wins) {
      if (w.frame === 'pop') snowLine(g, w.x - 2, w.x + w.w + 1, w.y - 3, a, w.x + w.y);
      else if (w.frame === 'plain') snowLine(g, w.x - 1, w.x + w.w, w.y + w.h + 1, a, w.x + w.y);
    }
    for (const f of FL) if (f.n !== 3) snowLine(g, BAL.x0, BAL.x1, railY(f), a, 40 + f.n);
  }

  // ------------------------------------------------------------------
  // the cat window room (37 x 20 at the anchor), baked per edition
  // ------------------------------------------------------------------
  function roomPal(c) {
    if (c.mode === 'day') {
      return {
        e: 0,
        wall: c.d('#b89a7c'),
        wall2: c.d('#c8aa8a'),
        shade: c.d('#9a7e66'),
        glow: c.d('#d0b494'),
        dark: c.d('#7a5a48'),
        deep: c.d('#4a3428'),
        floor: c.d('#6a4834'),
        curtain: c.d('#a85a3a'),
        curtain2: c.d('#c87048'),
        lamp: c.d('#e8dcc0'),
        pic: c.d('#4a7a8a'),
        hi: c.d('#d8c0a0'),
      };
    }
    const gold = c.mode === 'golden';
    return {
      e: 1,
      wall: gold ? AM[4] : AM[5],
      wall2: gold ? AM[5] : AM[6],
      shade: gold ? AM[3] : AM[4],
      glow: gold ? AM[6] : AM[7],
      dark: gold ? AM[2] : AM[3],
      deep: gold ? AM[1] : AM[2],
      floor: gold ? AM[2] : AM[3],
      curtain: gold ? AM[2] : AM[3],
      curtain2: gold ? AM[3] : AM[4],
      lamp: AM[8],
      pic: '#2b5868',
      hi: AM[7],
    };
  }
  function bakeRoom(env) {
    const { c, ed } = env;
    const cast = ed.cast || {};
    const x0 = CW.x;
    const y0 = CW.y;
    const W = CW.w;
    const H = CW.h;
    const tag = (t) => tagOf(ed, t);
    return bake2(x0, y0, W, H, (g) => {
      const r = roomPal(c);
      const e = r.e ? g.em : g;
      const tv = tag('tv-match');
      // back wall: lamp-lit, in flat steps brighter toward the lamp
      const lx = x0 + 31;
      const wall = tv ? r.shade : r.wall;
      e.rect(x0, y0, W, H, wall);
      e.rect(x0, y0, 10, H, tv ? r.dark : r.shade);
      e.rect(lx - 7, y0 + 1, 13, 12, tv ? r.wall : r.wall2);
      e.rect(lx - 6, y0 + 13, 11, 1, tv ? r.wall : r.wall2);
      if (!tv) e.rect(lx - 4, y0 + 2, 8, 6, r.glow);
      e.hline(x0, x0 + W - 1, y0, r.dark);
      // floor and a rug
      e.rect(x0, y0 + H - 4, W, 4, r.floor);
      e.hline(x0 + 6, x0 + W - 6, y0 + H - 3, r.e ? '#8a2e1c' : c.d('#8a3a2a'));
      e.hline(x0 + 6, x0 + W - 6, y0 + H - 2, r.e ? '#a8401e' : c.d('#a84a32'));
      // framed picture over the sofa line
      e.rect(x0 + 12, y0 + 2, 7, 5, r.deep);
      e.rect(x0 + 13, y0 + 3, 5, 3, r.pic);
      e.px(x0 + 16, y0 + 3, r.e ? '#86c8d4' : c.d('#9ac8d0'));
      // floor lamp on the right
      e.rect(lx - 1, y0 + 3, 4, 3, r.lamp);
      e.hline(lx - 1, lx + 2, y0 + 5, r.e ? AM[6] : r.hi);
      e.vline(lx + 1, y0 + 6, y0 + H - 2, r.deep);
      e.hline(lx, lx + 2, y0 + H - 2, r.deep);
      // curtains at both edges
      for (const cx of [x0, x0 + W - 3]) {
        e.rect(cx, y0, 3, H, r.curtain);
        e.vline(cx + 1, y0 + 1, y0 + H - 1, r.curtain2);
      }
      e.hline(x0, x0 + W - 1, y0, r.deep); // curtain rod
      // alone at home: a small table on the left with a seasonal piece
      if (cast.window === 'alone') sideTable(e, g, c, r, env);
      if (cast.window === 'together' && tag('pumpkins-balcony')) {
        // a small carved pumpkin by the lamp (its face flickers per frame)
        e.rect(lx - 4, y0 + H - 6, 4, 3, r.e ? '#c4581c' : c.d('#c86a2a'));
        e.hline(lx - 4, lx - 1, y0 + H - 6, r.e ? '#e07a2a' : c.d('#e08a3a'));
        e.px(lx - 3, y0 + H - 7, r.e ? '#3a5a1a' : c.d('#4a6a2a'));
      }
      if (ed.id === 'home') {
        // a suitcase just set down by the door
        e.rect(lx - 6, y0 + H - 9, 6, 7, r.e ? '#5a2a3a' : c.d('#6a3a4a'));
        e.hline(lx - 6, lx - 1, y0 + H - 9, r.e ? '#7a3a4a' : c.d('#8a4a5a'));
        e.hline(lx - 5, lx - 2, y0 + H - 11, r.deep);
        e.px(lx - 5, y0 + H - 10, r.deep);
        e.px(lx - 2, y0 + H - 10, r.deep);
      }
      if (ed.id === 'diwali') {
        // a marigold garland across the top of the door, inside
        for (let x = x0 + 3; x < x0 + W - 3; x++) {
          const k = (x - x0) % 6;
          const yy = y0 + 1 + (k === 2 || k === 3 ? 1 : 0);
          e.px(x, yy, k % 2 ? '#f39a24' : '#d27213');
          if (k === 3) e.px(x, yy + 1, '#ffc04a');
        }
      }
      if (tv) {
        // TV on a low cabinet on the left (the screen is drawn per frame)
        e.rect(x0 + 2, y0 + 12, 16, 6, r.deep);
        e.hline(x0 + 2, x0 + 17, y0 + 12, r.dark);
        g.rect(x0 + 2, y0 + 2, 15, 10, '#08080c');
      }
      if (ed.weather && ed.weather.rain > 0) {
        // raindrops on the glass
        for (let k = 0; k < 14; k++) {
          const dx = Math.floor(HD.hash(k, 3, 61) * (W - 6)) + 3;
          const dy = Math.floor(HD.hash(k, 4, 61) * (H - 8)) + 1;
          if (dx > 17 && dx < 30 && dy > 4) continue;
          e.px(x0 + dx, y0 + dy, r.e ? AM[7] : c.d('#d8e4ee'));
          if (HD.hash(k, 5, 61) < 0.5) e.px(x0 + dx, y0 + dy + 1, r.e ? AM[4] : c.d('#9ab0c4'));
        }
      }
    });
  }
  function sideTable(e, g, c, r, env) {
    const { ed } = env;
    const x0 = CW.x;
    const y0 = CW.y;
    const ty = y0 + 10; // table top
    const tag = (t) => tagOf(ed, t);
    const em = r.e;
    const col = (hx) => (em ? hx : c.d(hx));
    if (tag('menorah-window')) {
      // a menorah on a low console: eight candles and the raised shamash
      e.rect(x0 + 3, ty + 2, 15, 1, r.deep);
      e.vline(x0 + 4, ty + 3, y0 + 18, r.deep);
      e.vline(x0 + 16, ty + 3, y0 + 18, r.deep);
      const br = '#7a5a1a';
      e.hline(x0 + 2, x0 + 16, ty, col(br));
      e.vline(x0 + 9, ty, ty + 1, col(br));
      e.hline(x0 + 7, x0 + 11, ty + 1, col(br));
      for (let i = 0; i < 8; i++) {
        const cx = x0 + 2 + i * 2;
        e.vline(cx, ty - 3, ty - 1, col(i % 2 ? '#e8ecf6' : '#6a8ad8'));
      }
      e.vline(x0 + 9, ty - 5, ty - 1, col('#e8ecf6'));
      return;
    }
    // table
    e.rect(x0 + 4, ty + 1, 11, 1, r.deep);
    e.hline(x0 + 4, x0 + 14, ty, r.dark);
    e.vline(x0 + 5, ty + 2, y0 + 18, r.deep);
    e.vline(x0 + 13, ty + 2, y0 + 18, r.deep);
    const vx = x0 + 9;
    if (tag('plum-vase')) {
      // a porcelain vase of red plum blossom
      e.rect(vx - 1, ty - 4, 3, 4, col('#d8dcea'));
      e.px(vx - 2, ty - 2, col('#d8dcea'));
      e.px(vx + 2, ty - 2, col('#d8dcea'));
      e.px(vx, ty - 3, col('#3a5aa8'));
      const B = r.deep;
      e.line(vx, ty - 5, vx - 4, ty - 9, B);
      e.line(vx, ty - 5, vx + 3, ty - 9, B);
      e.line(vx - 2, ty - 7, vx - 5, ty - 7, B);
      for (const [dx, dy] of [
        [-4, -9],
        [-5, -7],
        [-3, -8],
        [3, -9],
        [2, -8],
        [-1, -6],
        [1, -6],
        [4, -10],
        [-6, -8],
      ])
        e.px(vx + dx, ty + dy, col(dx % 2 ? '#e8506a' : '#ff8a98'));
    } else if (ed.id === 'newyear') {
      // a bottle on ice and one glass
      e.rect(vx - 2, ty - 3, 4, 3, col('#c8d0e0'));
      e.rect(vx - 1, ty - 7, 2, 5, col('#1e4a2a'));
      e.px(vx - 1, ty - 8, col('#e0b636'));
      e.px(vx, ty - 8, col('#e0b636'));
      e.vline(vx + 4, ty - 4, ty - 1, col('#e8eef8'));
      e.px(vx + 4, ty - 4, col('#f7d969'));
    } else if (ed.season === 'spring') {
      // tulips
      e.rect(vx - 1, ty - 3, 3, 3, col('#e8e0d0'));
      for (const [dx, k] of [
        [-2, 0],
        [0, 1],
        [2, 2],
      ]) {
        e.vline(vx + Math.round(dx * 0.5), ty - 6, ty - 4, col('#4a8a3a'));
        e.rect(vx + dx, ty - 8, 1, 2, col(['#e85a7a', '#f0c030', '#d84a5a'][k]));
      }
    } else if (ed.season === 'autumn') {
      // a pie and a candle
      e.rect(vx - 3, ty - 2, 6, 2, col('#c8823a'));
      e.hline(vx - 2, vx + 1, ty - 3, col('#e0a050'));
      e.vline(vx + 4, ty - 4, ty - 1, col('#f2efe4'));
    } else {
      // a jar of wild flowers
      e.rect(vx - 1, ty - 3, 3, 3, col('#a8c8d0'));
      for (let i = 0; i < 5; i++) e.px(vx - 2 + i, ty - 5 - (i & 1), col(GOODS[(i * 3 + 1) % GOODS.length]));
      e.vline(vx, ty - 4, ty - 3, col('#4a8a3a'));
    }
  }

  /** things in front of the cats: the meeting stile, the balcony rail */
  function bakeFront(env) {
    const c = env.c;
    const f3 = FL[1];
    return bake2(BAL.x0, CW.y - 1, BAL.x1 - BAL.x0 + 1, slabY(f3) - CW.y + 1, (g) => {
      const fr = c.m(MAT.almond[1]);
      g.vline(DOOR.stile, CW.y, slabY(f3) - 1, fr);
      if (tagOf(env.ed, 'tv-match')) g.vline(DOOR.stile + 1, CW.y, slabY(f3) - 1, c.m(MAT.almond[0])); // the left leaf slid open behind it
      if (c.mode === 'day' || c.mode === 'golden') {
        // a faint sheen on the glass
        const hi = c.d(c.mode === 'day' ? '#e8f0f8' : '#ffe8c0');
        for (let i = 0; i < 6; i++) {
          g.px(DOOR.stile + 16 - i, CW.y + i, hi);
          g.px(DOOR.stile + 3 - i, CW.y + 2 + i, hi);
        }
      }
      rail(g, c, railY(f3), slabY(f3));
      if (env.snow > 0) snowLine(g, BAL.x0, BAL.x1, railY(f3), env.snow, 43);
    });
  }

  // ------------------------------------------------------------------
  // per-edition setup
  // ------------------------------------------------------------------
  function build(ed) {
    const L = HD.LIGHTING[ed.light] || HD.LIGHTING.night;
    const c = colours(L.mode);
    const env = { ed, c, mode: L.mode, idx: Math.max(0, HD.EDITIONS.indexOf(ed)), snow: (ed.weather && ed.weather.snow) || 0 };
    env.wins = assignWindows(env);
    // the florist shuts early on a few nights (a darker shopfront breaks the row)
    env.floristClosed = L.mode === 'night' && ['halloween25', 'newyear', 'lunar'].includes(ed.id);
    const p = painter(BW, BH, 0, OY);
    const g = p.g;
    drawNeighbour(g, env);
    drawBlock(g, env);
    drawWindows(g, env);
    seasonalWindows(g, env);
    for (const f of FL) balcony(g, c, f, f.n !== 3);
    drawRoof(g, env);
    drawRetail(g, env);
    if (env.snow > 0) drawSnow(g, env);
    const out = { env, layers: split(p), room: bakeRoom(env), front: bakeFront(env) };
    out.bulbs = c.lit || c.mode === 'golden' ? bakeBulbs() : null;
    out.doors = [1, 2, 3, 4, 5].map((o) => bake2(211, 185, 21, 21, (gg) => lobbyDoors(gg, c, o)));
    out.toggles = env.toggles = c.lit ? makeToggles(env) : [];
    for (const w of env.wins) w.panes = panesOf(w);
    out.tvs = env.wins.filter((w) => w.state === 'tv');
    out.lights = staticLights(env);
    out.shades = shadePolys(env);
    out.walkers = c.lit ? makeWalkers(env) : [];
    out.party = tagOf(ed, 'party-windows') ? env.wins.filter((w) => w.state === 'lit' && w.frame !== 'door').slice(0, 4) : [];
    return out;
  }
  const art = HD.perEdition(build);

  /** chasing marquee bulbs: three frames */
  function bakeBulbs() {
    const pts = bladeBulbs().concat(canopyBulbs());
    const frames = [];
    for (let f = 0; f < 3; f++) {
      frames.push(
        bake2(0, BLADE.y0, BLADE.x1 + 2, 176 - BLADE.y0, (g) => {
          for (const p of pts) {
            const k = p[1] === 175 ? Math.floor(p[0] / 3) : Math.floor((p[1] - BLADE.y0) / 3);
            g.em.px(p[0], p[1], (k + f) % 3 === 0 ? AM[8] : AM[5]);
          }
        }),
      );
    }
    return frames;
  }

  /** neighbours who walk past their lit window now and then */
  function makeWalkers(env) {
    const busy = new Set((env.toggles || []).map((tg) => tg.w));
    const cand = env.wins.filter((w) => w.state === 'lit' && w.frame !== 'door' && !busy.has(w) && (w.look === 'warm' || w.look === 'cool' || w.look === 'plant'));
    cand.sort((a, b) => HD.hash(a.x, a.y, 81, env.idx) - HD.hash(b.x, b.y, 81, env.idx));
    return cand.slice(0, 2).map((w, i) => {
      const a = 25 + HD.hash(w.x, w.y, 82, env.idx) * 70 + i * 40;
      return { w, at: [a, a + 110], dur: 3.2, dir: HD.hash(w.x, w.y, 83) < 0.5 ? 1 : -1 };
    });
  }
  // a neighbour seen through the glass: a small figure with cat ears
  const FIG = ['.X.X.', '.XXX.', '.XXX.', '..X..', 'XXXXX', '.XXX.', '.XXX.', '.XXX.'];
  const LEGS = [
    ['.X.X.', '.X.X.'],
    ['..XX.', '.XX..'],
  ];
  function drawWalkers(g, t, A) {
    const s = sec(t);
    for (const k of A.walkers) {
      let u = -1;
      for (const a of k.at) if (s >= a && s < a + k.dur) u = (s - a) / k.dur;
      if (u < 0) continue;
      const w = k.w;
      const fx = Math.round(k.dir > 0 ? w.x - 5 + u * (w.w + 6) : w.x + w.w - 1 - u * (w.w + 6));
      const rows = FIG.concat(LEGS[Math.floor(T.step(t, 6) * 6) & 1]);
      const fy = w.y + w.h - rows.length;
      for (let r = 0; r < rows.length; r++) for (let i = 0; i < 5; i++) if (rows[r][i] === 'X') paneDot(g, w, fx + i, fy + r);
    }
  }
  function paneDot(g, w, x, y) {
    for (const p of w.panes) if (x >= p[0] && x < p[0] + p[2] && y >= p[1] && y < p[1] + p[3]) return g.em.px(x, y, AM[1]);
  }

  /** windows that switch on or off once in the loop (dusk and night) */
  function makeToggles(env) {
    const c = env.c;
    const cand = env.wins.filter((w) => w.frame !== 'door' && w.state !== 'tv');
    const out = [];
    for (let i = 0; i < 40 && out.length < 5; i++) {
      const w = cand[Math.floor(HD.hash(i, env.idx, 71) * cand.length)];
      if (out.some((o) => o.w === w)) continue;
      const a = 12 + HD.hash(w.x, w.y, 72, env.idx) * 170;
      const d = 30 + HD.hash(w.x, w.y, 73, env.idx) * 50;
      const alt = Object.assign({}, w, { state: w.state === 'lit' ? 'dark' : 'lit' });
      const sp = bake2(w.x, w.y, w.w, w.h, (g) => {
        const tower = w.frame === 'tower';
        const fr = tower ? c.m('#30333a') : c.m(MAT.almond[1]);
        fillGlass(g, c, alt);
        if (w.frame === 'pop') {
          g.vline(w.x + (w.w >> 1), w.y, w.y + w.h - 1, fr);
          g.hline(w.x, w.x + w.w - 1, w.y + 4, fr);
          if (alt.state !== 'lit') g.hline(w.x, w.x + w.w - 1, w.y, '#0a0e1d');
        } else if (tower) {
          g.vline(w.x + 5, w.y, w.y + w.h - 1, fr);
          g.hline(w.x, w.x + w.w - 1, w.y + 5, fr);
          if (w.h > 25) g.hline(w.x, w.x + w.w - 1, w.y + 21, fr);
        } else g.hline(w.x, w.x + w.w - 1, w.y + 4, fr);
      });
      out.push({ w, a, b: a + d, sp, on: alt.state === 'lit' });
    }
    return out;
  }

  // ------------------------------------------------------------------
  // lights and daylight shadows
  // ------------------------------------------------------------------
  const WARM = [1.0, 0.64, 0.32];
  const COOLW = [0.9, 0.85, 0.7];
  function staticLights(env) {
    const c = env.c;
    const out = [];
    if (c.mode === 'day') return out;
    const k = c.lit ? 1 : 0.7;
    for (const w of env.wins) {
      if (w.state !== 'lit') continue;
      const door = w.frame === 'door';
      out.push({
        x: w.x + (w.w >> 1),
        y: w.y + (w.h >> 1) + 2,
        r: door ? 22 : 9,
        ry: door ? 13 : 11,
        color: w.look === 'cool' ? COOLW : WARM,
        i: (door ? 0.5 : 0.3) * k,
        bands: 3,
      });
    }
    const shop = (x, r, i) => ({ x, y: 202, r, ry: 20, color: WARM, i: i * k, bands: 4, clip: { x0: 0, y0: 172, x1: 479, y1: 269 } });
    out.push(shop(172, 30, 0.7), shop(221, 30, 0.9), shop(261, 20, env.floristClosed ? 0.12 : 0.55), shop(299, 28, 0.7), shop(98, 46, 0.75), shop(26, 26, 0.55));
    out.push({ x: 221, y: 174, r: 12, ry: 8, color: WARM, i: 0.5 * k, bands: 3, clip: { x0: 0, y0: 172, x1: 479, y1: 269 } });
    out.push({ x: 97, y: 126, r: 16, ry: 36, color: [1, 0.5, 0.36], i: 0.32 * k, bands: 3 });
    out.push({ x: 123, y: 139, r: 18, ry: 22, color: [0.55, 0.62, 1.0], i: 0.18 * k, bands: 3 });
    return out;
  }
  function shadePolys(env) {
    const m = env.c.mode;
    if (m === 'night') return [];
    const out = [];
    const S = (poly, k) => out.push({ poly, k });
    if (m === 'day') {
      S([[145, 56], [279, 56], [277, 59], [143, 59]], 0.45);
      S([[272, 44], [326, 44], [324, 47], [270, 47]], 0.45);
      S([[196, 58], [246, 58], [246, 166], [196, 166]], 0.2);
      S([[239, 58], [246, 58], [246, 166], [237, 166]], 0.4);
      for (const f of FL) {
        const y = slabY(f) + 3;
        S([[198, y], [245, y], [243, y + 4], [196, y + 4]], 0.4);
      }
      S([[194, 172], [249, 172], [246, 178], [191, 178]], 0.5);
      S([[148, 179], [196, 179], [194, 184], [146, 184]], 0.45);
      S([[246, 179], [276, 179], [274, 184], [244, 184]], 0.45);
      S([[0, 116], [145, 116], [144, 118], [0, 118]], 0.35);
      S([[0, 176], [53, 176], [51, 180], [0, 180]], 0.4);
      S([[86, 96], [92, 96], [92, 158], [86, 158]], 0.35);
    } else if (m === 'golden') {
      S([[145, 56], [279, 56], [279, 58], [145, 58]], 0.4);
      S([[272, 44], [326, 44], [326, 46], [272, 46]], 0.4);
      S([[196, 58], [246, 58], [246, 166], [196, 166]], 0.25);
      S([[226, 58], [246, 58], [246, 166], [222, 166]], 0.45);
      for (const f of FL) {
        const y = slabY(f) + 3;
        S([[196, y], [245, y], [245, y + 2], [196, y + 2]], 0.4);
      }
      S([[180, 172], [249, 172], [249, 176], [180, 176]], 0.45);
      S([[132, 179], [196, 179], [196, 182], [132, 182]], 0.4);
      S([[232, 179], [276, 179], [276, 182], [232, 182]], 0.4);
      S([[70, 96], [92, 96], [92, 158], [70, 158]], 0.3);
    } else {
      S([[196, 58], [206, 58], [208, 166], [196, 166]], 0.35);
      S([[145, 56], [279, 56], [281, 59], [147, 59]], 0.35);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // per-frame
  // ------------------------------------------------------------------
  const sec = (t) => ((t % HD.LOOP) + HD.LOOP) % HD.LOOP;

  function drawTV(g, t) {
    // the match on his TV: a striped pitch, little players and the ball
    const x = CW.x + 3;
    const y = CW.y + 3;
    const w = 13;
    const h = 8;
    const e = g.em;
    const goal = HD.summer ? HD.summer.goal(t) : -1;
    const ts = T.step(t, 8);
    const flash = goal >= 0 && goal < 0.25 && Math.floor(ts * 8) % 2 === 0;
    if (flash) {
      e.rect(x, y, w, h, '#e8fff0');
      return;
    }
    for (let i = 0; i < w; i++) e.vline(x + i, y, y + h - 1, (i >> 1) & 1 ? '#2a9a4a' : '#36b058');
    e.vline(x + 6, y, y + h - 1, '#c8f0d0');
    e.px(x + 5, y + 3, '#c8f0d0');
    e.px(x + 7, y + 4, '#c8f0d0');
    e.vline(x, y + 2, y + 5, '#c8f0d0');
    e.vline(x + w - 1, y + 2, y + 5, '#c8f0d0');
    const bx = x + 1 + Math.round(T.noise(ts, 3.1, 501) * (w - 3));
    const by = y + 1 + Math.round(T.noise(ts, 2.3, 502) * (h - 3));
    for (let k = 0; k < 6; k++) {
      const px = x + Math.round(HD.clamp(bx - x + (T.noise(ts, 2.7, 510 + k) - 0.5) * 9, 0, w - 1));
      const py = y + Math.round(HD.clamp(by - y + (T.noise(ts, 2.9, 520 + k) - 0.5) * 6, 0, h - 1));
      e.px(px, py, k < 3 ? '#e8303a' : '#f2f2ff');
    }
    e.px(bx, by, '#ffffff');
    if (goal >= 0) {
      // the replay: a bright frame around the picture
      e.hline(x, x + w - 1, y, '#f7ff9a');
      e.hline(x, x + w - 1, y + h - 1, '#f7ff9a');
    }
  }

  function drawRoom(g, t, A) {
    const ed = HD.edition;
    const cast = ed.cast || {};
    const c = A.env.c;
    blit2(g, A.room);
    const tag = (s) => HD.tag(s);
    if (tag('tv-match')) drawTV(g, t);
    if (tag('menorah-window') && cast.window === 'alone') {
      const ty = CW.y + 10;
      for (let i = 0; i < 8; i++) HD.festive.flame(g, CW.x + 2 + i * 2, ty - 3, t, 900 + i, 1);
      HD.festive.flame(g, CW.x + 9, ty - 5, t, 909, 1);
    }
    if (cast.window === 'together' && tag('pumpkins-balcony') && c.mode !== 'day') {
      const f = T.flicker(T.step(t, 10), 931, 1.2);
      g.em.px(CW.x + 28, CW.y + CW.h - 5, f > 0.4 ? '#ffd070' : '#f0a040');
    }
    if (cast.window === 'together' || cast.window === 'alone') {
      if (cast.window === 'together' && HD.drawPartner && PL.partner) HD.drawPartner(g, t, PL.partner.x, PL.partner.base);
      HD.mascot.draw(g, t, PL.mascot.x, PL.mascot.y);
    }
    if (tag('tv-match')) {
      // the open door's curtain stirs in the breeze
      const b = HD.summer ? HD.summer.breeze(t) : 0;
      const e = c.lit ? g.em : g;
      const sway = Math.max(0, Math.round(1 + b * 1.5));
      e.rect(CW.x, CW.y + 1, 3 + sway, 9, AM[3]);
      e.vline(CW.x + 1, CW.y + 1, CW.y + 10 + sway, AM[4]);
    }
    // match night: he stands on the balcony, drawn here so the rail covers him
    if (cast.party === 'match' && HD.drawBalcony) HD.drawBalcony(g, t);
    blit2(g, A.front);
  }

  /** glass panes of a window between its bars, as [x, y, w, h] */
  function panesOf(w) {
    const bars = [];
    const trans = [];
    if (w.frame === 'pop') {
      bars.push(w.x + (w.w >> 1));
      trans.push(w.y + 4);
    } else if (w.frame === 'tower') {
      bars.push(w.x + 5);
      trans.push(w.y + 5);
      if (w.h > 25) trans.push(w.y + 21);
    } else if (w.frame === 'plain') trans.push(w.y + 4);
    else if (w.frame === 'door') bars.push(DOOR.stile);
    const xs = [w.x - 1].concat(bars, [w.x + w.w]);
    const ys = [w.y - 1].concat(trans, [w.y + w.h]);
    const out = [];
    for (let j = 0; j + 1 < ys.length; j++)
      for (let i = 0; i + 1 < xs.length; i++) {
        const px = xs[i] + 1;
        const py = ys[j] + 1;
        const pw = xs[i + 1] - px;
        const ph = ys[j + 1] - py;
        if (pw > 0 && ph > 0) out.push([px, py, pw, ph]);
      }
    return out;
  }

  const TVC = ['#142438', '#1a3048', '#213c58', '#2c4e6a', '#6a9ab0'];
  function drawTVWindows(g, t, A) {
    const goal = HD.summer && HD.tag('tv-match') ? HD.summer.goal(t) : -1;
    const ts = T.step(t, 6);
    for (const w of A.tvs) {
      const n = T.noise(ts, 1.3, w.x * 7 + w.y);
      let lv = n < 0.35 ? 1 : n < 0.62 ? 2 : n < 0.86 ? 3 : 2;
      if (goal >= 0 && goal < 0.5) lv = 4;
      const col = TVC[lv];
      const yb = w.frame === 'door' ? w.y + w.h - 7 : w.y + w.h - 3; // keep the sofa / sill dark
      const x0 = w.frame === 'door' ? w.x + 3 : w.x;
      const x1 = w.frame === 'door' ? w.x + w.w - 4 : w.x + w.w - 1;
      for (const p of w.panes) {
        const ax = Math.max(p[0], x0);
        const bx = Math.min(p[0] + p[2] - 1, x1);
        const ay = Math.max(p[1], w.y + 1);
        const by = Math.min(p[1] + p[3] - 1, yb);
        if (bx >= ax && by >= ay) g.em.rect(ax, ay, bx - ax + 1, by - ay + 1, col);
      }
    }
  }

  // party light colours, pre-mixed with the warm room light
  const PARTY = ['#ff4aa8', '#4a8aff', '#f7d969', '#3ae06a', '#b05aff'].map((c) => [CL.mix(c, AM[5], 0.35), CL.mix(c, AM[3], 0.45)]);
  function drawParty(g, t, A) {
    // coloured party light changing slowly in a few windows, with a dancer
    const ts = T.step(t, 4);
    A.party.forEach((w, i) => {
      const k = Math.floor(T.phase(ts, 6, i * 0.23) * PARTY.length);
      const col = PARTY[(k + i) % PARTY.length];
      for (const p of w.panes) {
        g.em.rect(p[0], p[1], p[2], p[3], col[0]);
        g.em.hline(p[0], p[0] + p[2] - 1, p[1], col[1]);
      }
      g.em.rect(w.x, w.y + w.h - 2, w.w, 2, col[1]);
      // a bobbing silhouette
      const bob = T.wave(ts, 0.75, i * 0.3) > 0 ? 1 : 0;
      const sx = w.x + 2 + (i % 3);
      const sy = w.y + w.h - 9 + bob;
      g.em.rect(sx, sy + 3, 3, 6 - bob, AM[1]);
      g.em.rect(sx, sy, 3, 3, AM[1]);
      g.em.px(sx, sy - 1, AM[1]);
      g.em.px(sx + 2, sy - 1, AM[1]);
    });
  }

  /** is a switching window in its other state at loop second s (wraps the seam) */
  const toggled = (tg, s) => (s >= tg.a && s < tg.b) || (s + HD.LOOP >= tg.a && s + HD.LOOP < tg.b);

  function doorOpen(t) {
    // the lobby doors slide open as the niece comes out and goes back in
    const n = HD.summer.niece(t);
    if (!n.here) return 0;
    const P0 = 0.014;
    let o = 0;
    if (n.phase === 'in' && n.u < 0.35) o = n.u < 0.07 ? Math.ceil(n.u / P0) : n.u > 0.28 ? Math.ceil((0.35 - n.u) / P0) : 5;
    else if (n.phase === 'out' && n.u > 0.65) o = n.u > 0.93 ? Math.ceil((1 - n.u) / P0) : n.u < 0.72 ? Math.ceil((n.u - 0.65) / P0) : 5;
    return Math.max(0, Math.min(5, o));
  }

  function draw(g, t) {
    if (!here()) return;
    const A = art();
    blit2(g, A.layers);
    const s = sec(t);
    for (const tg of A.toggles) if (toggled(tg, s)) blit2(g, tg.sp);
    if (A.tvs.length) drawTVWindows(g, t, A);
    if (A.party.length) drawParty(g, t, A);
    if (A.walkers.length) drawWalkers(g, t, A);
    if (A.bulbs) blit2(g, A.bulbs[Math.floor(T.phase(t, 1.5, 0.013) * 3) % 3]);
    if (HD.edition.cast && HD.edition.cast.niece && HD.summer) {
      const o = doorOpen(t);
      if (o > 0) blit2(g, A.doors[o - 1]);
    }
    drawRoom(g, t, A);
  }

  function lights(t, L) {
    if (!here()) return;
    const A = art();
    const c = A.env.c;
    const s = sec(t);
    for (const l of A.lights) L.add(l);
    for (const tg of A.toggles) {
      if (!tg.on || !toggled(tg, s)) continue;
      L.add({ x: tg.w.x + (tg.w.w >> 1), y: tg.w.y + (tg.w.h >> 1) + 2, r: 9, ry: 11, color: WARM, i: 0.3, bands: 3 });
    }
    // the cat window: the room lamp lights the balcony and the cats
    const ed = HD.edition;
    const win = ed.cast && ed.cast.window;
    if (c.mode !== 'day' && win && win !== 'none') {
      L.add({ x: CW.x + 24, y: CW.y + 10, r: 26, ry: 16, color: WARM, i: c.lit ? 0.75 : 0.6, bands: 4 });
    }
    if (HD.tag('tv-match')) {
      const f = T.noise(T.step(t, 6), 1.3, 77);
      const goal = HD.summer ? HD.summer.goal(t) : -1;
      L.add({ x: CW.x + 10, y: CW.y + 10, r: 22, ry: 14, color: [0.45, 1.0, 0.6], i: goal >= 0 && goal < 0.25 ? 0.9 : 0.3 + 0.25 * f, bands: 3 });
    }
    if (HD.tag('menorah-window')) L.add({ x: CW.x + 9, y: CW.y + 6, r: 10, color: HD.LIGHT.candle, i: 0.35, bands: 3 });
    for (const w of A.tvs) {
      const n = T.noise(T.step(t, 6), 1.3, w.x * 7 + w.y);
      L.add({ x: w.x + (w.w >> 1), y: w.y + (w.h >> 1), r: w.frame === 'door' ? 16 : 8, color: [0.4, 0.7, 1.0], i: 0.12 + 0.14 * n, bands: 3 });
    }
    for (const sh of A.shades) L.shade(sh);
    // a lightning flash washes the facade with cold light for an instant
    if (ed.weather && ed.weather.lightning > 0 && HD.sky && HD.sky.flash) {
      const f = HD.sky.flash(t);
      if (f > 0.05) L.add({ x: 200, y: 110, r: 190, ry: 110, color: [0.55, 0.65, 1.0], i: 0.85 * f, bands: 3, pow: 0.6, clip: { x0: 0, y0: 36, x1: 330, y1: 206 } });
    }
  }

  // ------------------------------------------------------------------
  // contracts for other modules: exact skyline, rain ledges, drip points
  // ------------------------------------------------------------------
  (function register() {
    const sky = new Int16Array(480).fill(999);
    const set = (x0, x1, y) => {
      for (let x = x0; x <= x1; x++) if (x >= 0 && x < 480 && y < sky[x]) sky[x] = y;
    };
    set(0, 147, 112);
    set(BLADE.x0 - 1, BLADE.x1 + 1, BLADE.y0 - 4);
    set(145, 279, 52);
    set(170, 199, 47);
    set(226, 249, 48);
    set(272, 326, 40);
    set(322, 328, 159);
    PL.skyline = sky;
    PL.surfaces = [
      [0, 112, 147, 112],
      [BLADE.x0 - 1, BLADE.y0 - 2, BLADE.x1 + 1, BLADE.y0 - 2],
      [145, 52, 279, 52],
      [272, 40, 326, 40],
      [170, 47, 199, 47],
      [226, 48, 249, 48],
      [ENT.canopy.x0, 168, ENT.canopy.x1, 168],
      [148, 172, 195, 172],
      [246, 172, 275, 172],
      [53, 165, 143, 165],
      [0, 172, 52, 172],
      [148, 166, 322, 166],
    ].concat(FL.map((f) => [BAL.x0, railY(f), BAL.x1, railY(f)]));
    const drips = [
      { x: 145, y: 56 },
      { x: 279, y: 56 },
      { x: 272, y: 44 },
      { x: 326, y: 44 },
      { x: ENT.canopy.x0, y: 172 },
      { x: 207, y: 172 },
      { x: 221, y: 172 },
      { x: 235, y: 172 },
      { x: ENT.canopy.x1, y: 172 },
      { x: 150, y: 179 },
      { x: 166, y: 179 },
      { x: 182, y: 179 },
      { x: 195, y: 179 },
      { x: 248, y: 179 },
      { x: 262, y: 179 },
      { x: 275, y: 179 },
      { x: 0, y: 176 },
      { x: 52, y: 176 },
      { x: 92, y: 158 },
      { x: 101, y: 158 },
      { x: 326, y: 175 },
    ];
    for (const f of FL) {
      drips.push({ x: BAL.x0, y: slabY(f) + 3 });
      drips.push({ x: BAL.x1, y: slabY(f) + 3 });
    }
    PL.drips = drips;
  })();

  HD.module('building-apt1', {
    lights,
    passes: [{ layer: 'scene', z: 26, id: 'block', draw }],
  });
})();
