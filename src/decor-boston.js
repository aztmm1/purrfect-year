/*
 * decor-boston (Purrfect Year v2): the seasonal decorations at the two Boston
 * apartments, chosen by the entry's tags. At apt1 they dress his balcony
 * (place.balcony), a few of the neighbours' balconies stacked in the same
 * bay, the lobby canopy, one shopfront and the plaza (place.plaza); at apt2
 * the lobby (place.entrance) and the corner plaza.
 *
 * Art direction:
 *  - every prop is painted from its true daylight colour (albedo); its scene
 *    colour is albedo x ambient (nt), so daylight and golden hour reveal the
 *    real colour and the lamps warm it at night;
 *  - lights (diyas, bulbs, lanterns, carved pumpkins, the tree) glow only at
 *    night and dusk; by day they are drawn unlit, in their pigment colours;
 *  - his cat window stays clear: tall props sit at the balcony ends and
 *    nothing stands in front of a cat's head;
 *  - static art is baked once per entry; only flames, bulbs, lantern sway,
 *    flag flutter, pumpkin faces and a few glints are drawn per frame.
 *
 * Plain pixels drawn over the building's lit (emissive) glass go through
 * front(), which erases the emissive mask under them so the engine relights
 * them like every other prop. Scene layer, z 36.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const F = HD.festive;
  const LIGHT = HD.LIGHT;
  const CO = HD.color;
  const R = Math.round;
  const W = HD.W;
  const H = HD.H;
  const AMB = HD.AMBIENT;
  const clamp = HD.clamp;
  const hash = HD.hash;

  // ------------------------------------------------------------------
  // colour
  // ------------------------------------------------------------------
  const ntCache = new Map();
  /** scene colour of a prop whose daylight colour is `hex` (k > 1 lifts it a little) */
  function nt(hex, k) {
    const kk = k || 1;
    const key = hex + '|' + kk;
    let v = ntCache.get(key);
    if (v) return v;
    const c = CO.hex(hex);
    v = CO.css(c[0] * AMB[0] * kk, c[1] * AMB[1] * kk, c[2] * AMB[2] * kk);
    ntCache.set(key, v);
    return v;
  }
  const mix = CO.mix;
  const isLit = () => HD.light().day < 0.5; // lamps burn at night and dusk only

  // ------------------------------------------------------------------
  // a full-frame paint buffer, cropped to what was painted when baked
  // ------------------------------------------------------------------
  function Layer() {
    this.d = new Uint8ClampedArray(W * H * 4);
    this.x0 = W;
    this.y0 = H;
    this.x1 = -1;
    this.y1 = -1;
  }
  Layer.prototype.set = function (x, y, c) {
    x = R(x);
    y = R(y);
    if (!c || x < 0 || y < 0 || x >= W || y >= H) return;
    const v = CO.hex(c);
    const i = (y * W + x) * 4;
    this.d[i] = v[0];
    this.d[i + 1] = v[1];
    this.d[i + 2] = v[2];
    this.d[i + 3] = 255;
    if (x < this.x0) this.x0 = x;
    if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y;
    if (y > this.y1) this.y1 = y;
  };
  Layer.prototype.has = function (x, y) {
    x = R(x);
    y = R(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    return this.d[(y * W + x) * 4 + 3] !== 0;
  };
  Layer.prototype.rect = function (x, y, w, h, c) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  };
  Layer.prototype.hl = function (x0, x1, y, c) {
    for (let x = x0; x <= x1; x++) this.set(x, y, c);
  };
  Layer.prototype.vl = function (x, y0, y1, c) {
    for (let y = y0; y <= y1; y++) this.set(x, y, c);
  };
  /** ASCII stamp; '.' and ' ' are transparent; a map value may be a function (x, y) -> colour */
  Layer.prototype.stamp = function (rows, x0, y0, map, flip) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[flip ? row.length - 1 - x : x];
        if (ch === '.' || ch === ' ') continue;
        let c = map[ch];
        if (typeof c === 'function') c = c(x0 + x, y0 + y);
        if (c) this.set(x0 + x, y0 + y, c);
      }
    }
  };
  Layer.prototype.bake = function () {
    if (this.x1 < 0) return null;
    const w = this.x1 - this.x0 + 1;
    const h = this.y1 - this.y0 + 1;
    const cv = HD.canvas(w, h, true);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const a = ((this.y0 + y) * W + this.x0) * 4;
      img.data.set(this.d.subarray(a, a + w * 4), y * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    return { img: cv, x: this.x0, y: this.y0 };
  };

  // ------------------------------------------------------------------
  // drawing in front of lit glass: plain pixels erase the emissive mask
  // ------------------------------------------------------------------
  let gF = null;
  let gU = null;
  function front(g) {
    if (!gF) {
      const m = HD.buffers.emissive.getContext('2d');
      const proxy = {
        fillRect: (x, y, w, h) => m.clearRect(x, y, w, h),
        drawImage() {
          m.globalCompositeOperation = 'destination-out';
          m.drawImage.apply(m, arguments);
          m.globalCompositeOperation = 'source-over';
        },
        save: () => m.save(),
        restore: () => m.restore(),
        translate: (a, b) => m.translate(a, b),
        scale: (a, b) => m.scale(a, b),
        fillStyle: '#fff',
      };
      gF = HD.makeGfx(HD.buffers.scene.getContext('2d'), proxy);
      // a twin whose "emissive" calls stay plain: lamps by day
      gU = Object.assign({}, gF);
      gU.em = gF;
    }
    gF.em = g.em;
    return gF;
  }

  // ------------------------------------------------------------------
  // geometry from the place anchors
  // ------------------------------------------------------------------
  /**
   * His balcony and the neighbours' balconies stacked in the same bay. For a
   * floor [top, bottom] the rail sits 10 px above the floor line, the slab
   * 3 px, and things hang from the underside of the slab above (y = top).
   */
  function balconies(pl) {
    const b = pl.balcony;
    if (!b) return null;
    const fl = pl.floors || {};
    const dRail = 140 - b.rail;
    const dSlab = 140 - b.slab;
    const out = { my: { x0: b.x0, x1: b.x1, rail: b.rail, slab: b.slab, hook: b.above + 3 } };
    for (const k of ['f2', 'f4', 'f5']) {
      const f = fl[k];
      if (!f) continue;
      out[k] = { x0: b.x0, x1: b.x1, rail: f[1] - dRail, slab: f[1] - dSlab, hook: f[0] };
    }
    return out;
  }

  // ------------------------------------------------------------------
  // cords: anchors [[x, y, sag], ...] -> one point per column
  // ------------------------------------------------------------------
  function cord(anchors) {
    const pts = [];
    for (let i = 0; i + 1 < anchors.length; i++) {
      const [x0, y0, sag] = anchors[i];
      const [x1, y1] = anchors[i + 1];
      const last = i + 2 === anchors.length;
      for (let x = x0; x < x1 || (last && x === x1); x++) {
        const u = (x - x0) / Math.max(1, x1 - x0);
        pts.push([x, R(y0 + (y1 - y0) * u + (sag || 0) * 4 * u * (1 - u))]);
      }
    }
    return pts;
  }
  /** paint a 1-px wire along cord points, bridging steep steps */
  function wire(L, pts, c) {
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      L.set(x, y, c);
      if (i > 0) {
        const py = pts[i - 1][1];
        if (Math.abs(y - py) > 1) {
          const s = y > py ? 1 : -1;
          for (let yy = py + s; yy !== y; yy += s) L.set(Math.abs(yy - py) <= Math.abs(yy - y) ? x - 1 : x, yy, c);
        }
      }
    }
  }
  const WIRE = nt('#26262c');

  // ------------------------------------------------------------------
  // string lights: the wire is baked; lit bulbs twinkle per frame
  // ------------------------------------------------------------------
  const BULB_GLASS = { red: '#c8302c', green: '#2f9a48', blue: '#3460c8', gold: '#e8b030', pink: '#e070a8', white: '#ecece4', warm: '#f2dca4' };
  const BULB_EM = {
    gold: ['#6a4610', '#f2b244', '#ffe6a2'],
    warm: ['#6a4c22', '#f6cf8a', '#fff4da'],
  };
  const bulbRamp = (col) => BULB_EM[col] || P.bulb[col] || P.bulb.gold;
  /**
   * A string of bulbs along cord anchors. o: {colors, spacing, wire, seed,
   * big (2-px festoon globes), off (first bulb), every, r, i (its light)}
   */
  function bulbString(S, anchors, o) {
    const pts = cord(anchors);
    if (!o.noWire) wire(S.L, pts, o.wire || WIRE);
    const sp = o.spacing || 4;
    const cols = o.colors || ['gold'];
    const bulbs = [];
    for (let i = o.off === undefined ? 2 : o.off, k = 0; i < pts.length - 1; i += sp, k++) {
      const [x, y] = pts[i];
      const col = cols[k % cols.length];
      const b = { x, y: y + 1, col, seed: (o.seed || 0) * 131 + k, big: !!o.big };
      bulbs.push(b);
      if (S.lit) S.bulbs.push(b);
      else {
        const gl = BULB_GLASS[col] || BULB_GLASS.gold;
        S.L.set(x, y + 1, nt(mix(gl, '#ffffff', 0.15), 1.05));
        S.L.set(x, y + 2, nt(gl));
        if (b.big) S.L.set(x + 1, y + 1, nt(gl));
      }
    }
    if (S.lit) S.strings.push({ bulbs, every: o.every || 4, i: o.i || 0.12, r: o.r || 11 });
    return pts;
  }
  function drawBulbs(g, t, list) {
    const e = g.em || g;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const ramp = bulbRamp(b.col);
      const lv = T.noise(t, 2.8, b.seed + 77) < 0.28 ? 1 : 2;
      e.px(b.x, b.y, ramp[lv]);
      e.px(b.x, b.y + 1, ramp[lv - 1]);
      if (b.big) e.px(b.x + 1, b.y, ramp[lv - 1]);
    }
  }
  /** a few aggregated pools of light along each string */
  function stringLights(L, t, S) {
    for (const s of S.strings) {
      const bs = s.bulbs;
      for (let k = s.every >> 1; k < bs.length; k += s.every) {
        const b = bs[k];
        L.add({ x: b.x, y: b.y + 1, r: s.r, color: LIGHT.bulb[b.col] || LIGHT.bulb.gold, i: s.i, bands: 4 });
      }
    }
  }

  // ------------------------------------------------------------------
  // pumpkins, gourds and carved faces
  // ------------------------------------------------------------------
  const PUMPKIN = ['#4a1c08', '#7c300c', '#a84812', '#d0641a', '#ea8428', '#f6a64a'];
  const PUMPKIN_PALE = ['#5a5040', '#8a7e66', '#b4a88e', '#d4cab0', '#e8e0ca', '#f6f2e4'];
  const PUMPKIN_GOLD = ['#5a3a08', '#8a5a10', '#b8841c', '#dca42a', '#f0c448', '#fadc80'];
  const GOURD_GREEN = ['#1c2a12', '#2e4418', '#46621e', '#62802a', '#86a03c', '#a8bc5a'];
  const STEM = ['#2a2412', '#4a4022', '#6e6034'];
  /**
   * A pumpkin sitting on (cx, by) with radii rx, ry.
   * o: {ramp, lobes, k (night lift), lx, ly (towards the light), stem (lean), wet}
   */
  function pumpkin(L, cx, by, rx, ry, o) {
    o = o || {};
    const ramp = (o.ramp || PUMPKIN).map((c) => nt(c, o.k || 1));
    const n = ramp.length;
    const lobes = o.lobes || 5;
    const lx = o.lx === undefined ? -0.5 : o.lx;
    const ly = o.ly === undefined ? -0.8 : o.ly;
    const cy = R(by - ry);
    const iy = Math.ceil(ry);
    const ix = Math.ceil(rx);
    for (let dy = -iy; dy <= iy; dy++) {
      for (let dx = -ix; dx <= ix; dx++) {
        if (cy + dy > by) continue;
        const u = dx / (rx + 0.45);
        const v = dy / (ry + 0.45);
        const d2 = u * u + v * v;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        let s = 0.5 + 0.4 * (u * lx + v * ly) + 0.16 * nz;
        // vertical lobes: lighter crowns, dark creases
        const w = ((Math.asin(clamp(u, -1, 1)) / (Math.PI / 2) + 1) / 2) * lobes;
        const fr = w - Math.floor(w);
        const crown = 1 - Math.abs(fr - 0.5) * 2;
        s += (crown - 0.55) * 0.36;
        if (d2 > 0.8) s -= 0.15;
        if (v > 0.55) s -= 0.1;
        L.set(cx + dx, cy + dy, ramp[clamp(Math.floor(s * n), 0, n - 1)]);
      }
    }
    if (o.stem !== false) {
      const st = STEM.map((c) => nt(c));
      const top = cy - iy;
      L.set(cx, top, ramp[1]);
      L.set(cx, top - 1, st[1]);
      L.set(cx, top - 2, st[2]);
      if (rx >= 4) L.set(cx + (o.stem || 1), top - 2, st[1]);
    }
    if (o.outline) {
      // a dark contour so it reads against bright glass
      const oc = nt('#2a0e04');
      for (let dy = -iy - 1; dy <= iy; dy++)
        for (let dx = -ix - 1; dx <= ix + 1; dx++) {
          const u = dx / (rx + 0.45);
          const v = dy / (ry + 0.45);
          if (u * u + v * v <= 1 || cy + dy > by) continue;
          let near = false;
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const uu = (dx + ax) / (rx + 0.45);
            const vv = (dy + ay) / (ry + 0.45);
            if (uu * uu + vv * vv <= 1 && cy + dy + ay <= by) near = true;
          }
          if (near && !L.has(cx + dx, cy + dy)) L.set(cx + dx, cy + dy, oc);
        }
    }
    if (o.wet) L.set(cx - R(rx * 0.45), cy - R(ry * 0.55), nt('#c4d4ee', 1.15));
  }
  /** carved faces, centred on the pumpkin; e eye, n nose, m mouth */
  const FACES = {
    s: ['e.e', '...', 'mmm'],
    s2: ['e...e', '.....', '.mmm.'],
    m: ['ee.ee', '..n..', 'mmmmm', '.m.m.'],
    l: ['.e...e.', 'eee.eee', '...n...', 'mmmmmmm', '.m.m.m.'],
  };
  /** a jack-o'-lantern: pumpkin + a carved face that glows per frame */
  function jack(S, cx, by, rx, ry, face, seed, o) {
    pumpkin(S.L, cx, by, rx, ry, o);
    const rows = FACES[face];
    const w = rows[0].length;
    const x0 = cx - (w >> 1);
    const y0 = R(by - ry) - (rows.length >> 1);
    const px = [];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < w; x++) if (rows[y][x] !== '.') px.push(x0 + x, y0 + y, rows[y][x] === 'm' ? 1 : 0);
    // the cut rim: dark flesh round the holes
    const rim = nt('#5a2008');
    for (let k = 0; k < px.length; k += 3) {
      const x = px[k];
      const y = px[k + 1];
      if (!S.L.has(x, y - 1) || px.some((v, j) => j % 3 === 0 && v === x && px[j + 1] === y - 1)) continue;
      S.L.set(x, y - 1, rim);
    }
    if (S.lit) S.jacks.push({ px, seed, x: cx, y: R(by - ry), r: rx });
    else for (let k = 0; k < px.length; k += 3) S.L.set(px[k], px[k + 1], nt('#3a1606'));
  }
  const JACK_EM = [P.fire[5], P.fire[6], P.fire[7], P.fire[8], P.fire[9]];
  function drawJacks(g, t, list) {
    const e = g.em || g;
    const ts = T.step(t, 9);
    for (const j of list) {
      const f = T.flicker(ts, j.seed, 1.1);
      const hi = f > 0.62 ? 2 : f > 0.3 ? 1 : 0;
      for (let k = 0; k < j.px.length; k += 3) e.px(j.px[k], j.px[k + 1], JACK_EM[hi + j.px[k + 2] + 1]);
    }
  }

  // ------------------------------------------------------------------
  // flowers, leaves and garlands
  // ------------------------------------------------------------------
  const MARIGOLD = { o: ['#7a2004', '#b84206', '#e66410', '#ff8a22'], y: ['#8a4a06', '#d2780c', '#f8a018', '#ffc444'] };
  const LEAF = ['#1e3a1a', '#2c5424', '#3e6e2e', '#5a8a3a', '#7aa84a'];
  const AUTUMN = ['#b0301a', '#d2621a', '#e09a26', '#8e4418', '#c44a1c', '#e6b43a'];
  const EVERGREEN = ['#0e2a1a', '#163a22', '#22502e', '#2e663a', '#3e7c46'];
  const SNOW = ['#c8d4e6', '#e2eaf4', '#f4f8fc'];

  /** marigold rope along cord points: 2-px beads alternating orange and yellow */
  function marigoldRope(L, pts, k) {
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const r = ((x + 1) >> 1) & 1 ? MARIGOLD.o : MARIGOLD.y;
      const left = (x & 1) === 0;
      L.set(x, y, nt(left ? r[3] : r[2], k));
      L.set(x, y + 1, nt(left ? r[2] : r[1], k));
      if (i > 0 && Math.abs(pts[i - 1][1] - y) > 0) L.set(x, Math.min(y, pts[i - 1][1]), nt(r[2], k));
    }
  }
  /** a hanging marigold strand (2 px wide) from (x, y0) down to y1, ending in a leaf */
  function marigoldStrand(L, x, y0, y1, k, phase) {
    for (let y = y0; y <= y1; y++) {
      const blossom = ((y - y0 + (phase || 0)) >> 1) & 1 ? MARIGOLD.o : MARIGOLD.y;
      const top = ((y - y0) & 1) === 0;
      L.set(x, y, nt(top ? blossom[3] : blossom[2], k));
      L.set(x + 1, y, nt(top ? blossom[2] : blossom[1], k));
    }
    L.set(x, y1 + 1, nt(LEAF[3], k));
    L.set(x + 1, y1 + 1, nt(LEAF[2], k));
    L.set(x, y1 + 2, nt(LEAF[2], k));
  }
  /** a marigold toran: swags between hooks with short pendant strands */
  function toran(L, x0, x1, y, n, sag, k) {
    const anchors = [];
    for (let i = 0; i <= n; i++) anchors.push([R(x0 + ((x1 - x0) * i) / n), y, sag]);
    const pts = cord(anchors);
    marigoldRope(L, pts, k);
    for (let i = 1; i < n; i++) marigoldStrand(L, anchors[i][0], y + 2, y + 3, k, i);
    return pts;
  }

  /** leafy garland (autumn leaves, evergreen or summer greens with flowers) along cord points */
  function garland(L, pts, kind, k, o) {
    o = o || {};
    const k2 = k || 1;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      for (let dy = -1; dy <= 1; dy++) {
        const hh = hash(x, y + dy, 41, kind.length);
        if (dy === -1 && hh < 0.45) continue;
        if (dy === 1 && hh < 0.25) continue;
        let c;
        if (kind === 'autumn') {
          const cell = hash((x + (dy & 1)) >> 1, dy, 43, 2);
          c = AUTUMN[Math.floor(cell * AUTUMN.length)];
          if (dy === 1 && hh < 0.5) c = mix(c, '#3a1a0c', 0.45);
          if (dy === -1) c = mix(c, '#fff0c0', 0.12);
        } else if (kind === 'evergreen') {
          const sh = dy === -1 ? 4 : dy === 0 ? (hh < 0.5 ? 3 : 2) : hh < 0.6 ? 1 : 2;
          c = EVERGREEN[sh];
        } else {
          const sh = dy === -1 ? 4 : dy === 0 ? (hh < 0.5 ? 3 : 2) : 1;
          c = LEAF[sh];
        }
        L.set(x, y + dy, nt(c, k2));
      }
      if (kind === 'summer' && hash(x, 7, 47) < 0.3) {
        const fl = ['#f6f4ee', '#f4d040', '#6a86e0', '#ee90bc', '#a46ad4', '#f6f4ee'];
        const c = fl[Math.floor(hash(x, 8, 47) * fl.length)];
        L.set(x, y - (hash(x, 9, 47) < 0.5 ? 1 : 0), nt(c, k2 * 1.1));
      }
      if (kind === 'evergreen' && o.snow && hash(x, 11, 53) < o.snow) L.set(x, y - 1 - (hash(x, 12, 53) < 0.3 ? 1 : 0), nt(SNOW[hash(x, 13, 53) < 0.5 ? 1 : 2], 1.4));
      if (kind === 'evergreen' && o.berries && hash(x, 14, 53) < 0.12) L.set(x, y + (hash(x, 15, 53) < 0.5 ? 0 : 1), nt('#d02828', 1.2));
    }
  }
  /** a short cluster of leaves dangling from a swag's low point */
  function leafDrop(L, x, y, kind, k) {
    const cols = kind === 'autumn' ? AUTUMN : kind === 'evergreen' ? EVERGREEN.slice(1) : LEAF.slice(1);
    L.set(x, y + 2, nt(cols[1], k));
    L.set(x, y + 3, nt(cols[2], k));
    L.set(x - 1, y + 3, nt(cols[0], k));
    L.set(x, y + 4, nt(cols[3 % cols.length], k));
  }

  // ------------------------------------------------------------------
  // cloth: blankets, banners, bunting, flags
  // ------------------------------------------------------------------
  /** a blanket folded over a rail: x0..x1, the fold on the rail at y, hanging h rows */
  function blanket(L, x0, x1, y, h, scheme, k) {
    const S = scheme === 'tartan' ? { a: '#8a2a24', b: '#2c4a30', c: '#d8b040', d: '#3a1a1a' } : { a: '#b42a26', b: '#26201e', c: '#6a2020', d: '#1a1414' };
    for (let yy = y; yy < y + h; yy++) {
      for (let x = x0; x <= x1; x++) {
        const bx = ((x - x0) >> 1) & 1;
        const by = ((yy - y) >> 1) & 1;
        let c;
        if (scheme === 'tartan') c = bx && by ? S.b : bx || by ? S.a : mix(S.a, S.b, 0.5);
        else c = !bx && !by ? S.a : bx && by ? S.b : S.c;
        if (scheme === 'tartan' && (x - x0) % 5 === 4) c = S.c;
        if (yy === y) c = mix(c, '#ffffff', 0.18); // the fold over the rail
        if (x === x1 || yy === y + 1) c = mix(c, '#000000', 0.3);
        L.set(x, yy, nt(c, k));
      }
    }
    // fringe
    for (let x = x0; x <= x1; x += 2) L.set(x, y + h, nt(mix(S.a, '#000000', 0.2), k));
    // a soft crease
    const cx = R((x0 + x1) / 2);
    for (let yy = y + 2; yy < y + h; yy++) L.set(cx, yy, nt(mix(S.d, S.a, 0.4), k));
  }
  /** a plain vertical banner: gold rod, red cloth, gold hem, a tassel */
  function banner(L, x0, y0, w, h, k) {
    const red = ['#7a1018', '#a8161e', '#c82028', '#de3a36'];
    const gold = ['#8a6418', '#d0a030', '#f2d064'];
    L.hl(x0 - 1, x0 + w, y0, nt(gold[1], k));
    L.set(x0 - 1, y0, nt(gold[0], k));
    for (let y = y0 + 1; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        let c = x === x0 + w - 1 ? red[1] : x === x0 ? red[3] : red[2];
        if (x === x0 + 1 && y > y0 + 1 && y < y0 + h - 1) c = red[3];
        L.set(x, y, nt(c, k));
      }
    }
    L.hl(x0, x0 + w - 1, y0 + h, nt(gold[1], k));
    const tx = x0 + (w >> 1);
    L.set(tx, y0 + h + 1, nt(gold[2], k));
    L.set(tx, y0 + h + 2, nt(red[2], k));
    L.set(tx, y0 + h + 3, nt(red[1], k));
  }
  /** a plain red valance with gold piping, scalloped hem and tassels */
  function valance(L, x0, x1, y, k) {
    const red = ['#7a1018', '#a8161e', '#c82028', '#de3a36'];
    const gold = ['#8a6418', '#d0a030', '#f2d064'];
    for (let x = x0; x <= x1; x++) {
      L.set(x, y, nt(gold[x % 3 === 0 ? 2 : 1], k));
      L.set(x, y + 1, nt(red[2], k));
      L.set(x, y + 2, nt(red[1], k));
      const sc = (x - x0) % 6;
      if (sc > 0 && sc < 5) L.set(x, y + 3, nt(sc === 1 || sc === 4 ? red[0] : red[1], k));
    }
    for (let x = x0; x <= x1; x += 6) {
      L.set(x, y + 3, nt(gold[1], k));
      L.set(x, y + 4, nt(gold[2], k));
      L.set(x, y + 5, nt(red[2], k));
    }
  }
  const PENNANT = ['PPPPp', '.PPp.', '.PPp.', '..p..'];
  /** bunting: pennants every 6 px along a cord */
  function bunting(S, anchors, colors, k, glint) {
    const pts = cord(anchors);
    wire(S.L, pts, nt('#8a8a90'));
    for (let i = 2, n = 0; i + 5 < pts.length; i += 6, n++) {
      const [x, y] = pts[i];
      const yy = Math.max(y, pts[i + 4][1]);
      const c = colors[n % colors.length];
      S.L.stamp(PENNANT, x, yy + 1, { P: nt(c[0], k), p: nt(c[1], k) });
      if (glint && c[2]) S.glints.push({ x: x + 1, y: yy + 1, seed: n * 7 + x });
    }
  }

  // flags: rows of colour keys, each as accurate as its pixel size allows
  function rep(s, n) {
    const o = [];
    for (let i = 0; i < n; i++) o.push(s);
    return o;
  }
  function saltireRows(w, h, th) {
    const n = Math.hypot(w, h);
    const out = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) {
        const d1 = Math.abs(h * (x + 0.5) - w * (y + 0.5)) / n;
        const d2 = Math.abs(h * (x + 0.5) - w * (h - y - 0.5)) / n;
        r += Math.min(d1, d2) < th ? 'W' : 'S';
      }
      out.push(r);
    }
    return out;
  }
  const FLAGS = {
    usa: { rows: ['UUUUURRRRRRRR', 'UVUVUWWWWWWWW', 'UUUUURRRRRRRR', 'UVUVUWWWWWWWW', 'RRRRRRRRRRRRR', 'WWWWWWWWWWWWW', 'RRRRRRRRRRRRR'], map: { U: '#3c3b6e', V: '#c8c8dc', R: '#b22234', W: '#f4f4f4' } },
    ireland: { rows: rep('GGGGWWWWOOOO', 6), map: { G: '#169b62', W: '#f4f4f4', O: '#ff883e' } },
    scotland: { rows: saltireRows(10, 6, 0.62), map: { S: '#005eb8', W: '#f4f4f4' } },
    norway: { rows: ['RRWBWRRRRRR', 'RRWBWRRRRRR', 'WWWBWWWWWWW', 'BBBBBBBBBBB', 'WWWBWWWWWWW', 'RRWBWRRRRRR', 'RRWBWRRRRRR'], map: { R: '#ba0c2f', W: '#f4f4f4', B: '#00205b' } },
    france: { rows: rep('BBBWWWRRR', 6), map: { B: '#002395', W: '#f4f4f4', R: '#ed2939' } },
    germany: { rows: [...rep('KKKKKKKKKK', 2), ...rep('RRRRRRRRRR', 2), ...rep('YYYYYYYYYY', 2)], map: { K: '#141414', R: '#dd0000', Y: '#ffce00' } },
    spain: { rows: [...rep('RRRRRRRRRRRR', 2), ...rep('YYYYYYYYYYYY', 4), ...rep('RRRRRRRRRRRR', 2)], map: { R: '#aa151b', Y: '#f1bf00' } },
    saltire: { rows: saltireRows(20, 12, 1.25), map: { S: '#005eb8', W: '#f4f4f4' } },
  };
  /**
   * Bake a flag in 4 flutter frames. kind 'stick': flies from a pole at its
   * left edge (the far end ripples, the hoist stays); 'drape': hangs from its
   * top edge over a rail (the bottom corners lift a little).
   */
  function flagFrames(name, kind, k) {
    const fl = FLAGS[name];
    const rows = fl.rows;
    const w = rows[0].length;
    const h = rows.length;
    const frames = [];
    for (let f = 0; f < 4; f++) {
      frames.push(
        HD.bake(w + 1, h + 2, (g) => {
          for (let x = 0; x < w; x++) {
            const u = x / (w - 1);
            const ph = (x / w) * 1.6 - f / 4;
            const sw = Math.sin(ph * Math.PI * 2);
            const amp = kind === 'stick' ? u * 1.2 : 0;
            const dy = R(sw * amp);
            const shade = kind === 'stick' ? sw * 0.16 * (0.4 + u) : 0;
            for (let y = 0; y < h; y++) {
              let ch = rows[y][x];
              let c = fl.map[ch];
              if (kind === 'drape') {
                // soft vertical folds; the bottom corners curl a frame at a time
                const fold = Math.sin((x / w) * Math.PI * 3 + 0.4);
                c = fold > 0.55 ? mix(c, '#ffffff', 0.1) : fold < -0.6 ? mix(c, '#000000', 0.22) : c;
                if (y === 0) c = mix(c, '#000000', 0.3);
                if (y === h - 1 && ((f === 1 && x === w - 1) || (f === 3 && x === 0))) continue;
              } else if (shade > 0) c = mix(c, '#ffffff', shade);
              else if (shade < 0) c = mix(c, '#000000', -shade);
              g.px(x, y + 1 + dy, nt(c, k));
            }
          }
        }),
      );
    }
    return { frames, w, h };
  }

  // ------------------------------------------------------------------
  // the per-entry scene: everything static baked into one layer, plus
  // the lists of animated bits
  // ------------------------------------------------------------------
  function newScene(ed) {
    return {
      L: new Layer(),
      lit: ed.light === 'night' || ed.light === 'dusk',
      bulbs: [],
      strings: [],
      diyas: [],
      lanterns: [],
      jacks: [],
      flags: [],
      glints: [],
      spiders: [],
      stars: [],
      glows: [],
      shades: [],
      stat: null,
    };
  }

  // ------------------------------------------------------------------
  // props
  // ------------------------------------------------------------------
  /** a ground contact shadow and, by day, a cast shadow away from the sun */
  function footShadow(S, x0, x1, by, h) {
    const c = nt('#1a1418');
    for (let x = x0; x <= x1; x++) if (!S.L.has(x, by + 1)) S.L.set(x, by + 1, c);
    S.shades.push({ x0, x1, by, h });
  }

  /** dried corn stalks bundled and tied, base centre (cx, by) */
  const CORN = [
    'l.........l',
    '.l..t.t..l.',
    '..l.tTt.l..',
    '...lsTsl...',
    'l..sSsSs..l',
    '.llsSsSsll.',
    '...sSsSsd..',
    '...sSsSsd..',
    '...sSsSsd..',
    '...rRrRrr..',
    '...sSsSsd..',
    '...sSsSsd..',
    '..ssSsSsd..',
    '..sSsSsSd..',
    '.ssSsSsSsd.',
    '.sSsSsSsSd.',
    'ssSsSsSsSsd',
    'sSsSsSsSsdd',
  ];
  function cornShock(S, cx, by, flip) {
    const map = { S: '#e2c88e', s: '#b89458', d: '#7a5a2e', l: '#c4ae6c', t: '#e8d8a0', T: '#f6eac4', r: '#6a4426', R: '#94623a' };
    const m = {};
    for (const k in map) m[k] = nt(map[k], 1.15);
    S.L.stamp(CORN, cx - 5, by - CORN.length + 1, m, flip);
    footShadow(S, cx - 5, cx + 5, by, CORN.length);
  }

  /** a straw bale, top-left (x, y), w x h */
  function hayBale(S, x, by, w, h) {
    const L = S.L;
    const C = ['#6a5226', '#9a7c3e', '#c4a45a', '#dcc07a', '#ecd89c'].map((c) => nt(c, 1.05));
    const y0 = by - h + 1;
    for (let y = y0; y <= by; y++)
      for (let xx = x; xx < x + w; xx++) {
        let i = 2 + (hash(xx >> 1, y, 71) < 0.45 ? 1 : 0);
        if (y === y0) i = 4;
        else if (y === y0 + 1) i = 3;
        if (y === by) i = 1;
        if (xx === x + w - 1) i = Math.min(i, 1);
        if (xx === x) i = Math.max(i - 1, 1);
        if (hash(xx, y, 73) < 0.08) i = 0;
        L.set(xx, y, C[i]);
      }
    const tw = nt('#4a3218', 1.1);
    for (const fx of [x + R(w * 0.28), x + R(w * 0.7)]) L.vl(fx, y0 + 1, by, tw);
    // stray straws
    L.set(x - 1, by, C[3]);
    L.set(x + w, by - 1, C[2]);
    L.set(x + 3, y0 - 1, C[4]);
    footShadow(S, x, x + w - 1, by, h);
  }

  /** a half-barrel planter with a dome of mums */
  const MUMS = { rust: ['#7a2a10', '#b4461a', '#d8682a'], gold: ['#8a6010', '#d6a020', '#f4cc4a'], wine: ['#4a1020', '#7a1e30', '#a83448'], cream: ['#8a7a5a', '#d8ccaa', '#f4ecd2'] };
  function mumPlanter(S, cx, by, w, kinds, barrel) {
    const L = S.L;
    const hw = w >> 1;
    const bh = 5;
    if (barrel) {
      const st = ['#3a2416', '#5a3a22', '#7a5434', '#946a44'].map((c) => nt(c, 1.1));
      const hoop = nt('#2a2a30', 1.2);
      for (let y = by - bh + 1; y <= by; y++) {
        const ww = y === by ? hw - 1 : hw;
        for (let dx = -ww; dx <= ww; dx++) {
          let i = (dx + 20) % 3 === 0 ? 1 : 2;
          if (dx === -ww) i = 3;
          if (dx === ww) i = 0;
          L.set(cx + dx, y, st[i]);
        }
      }
      L.hl(cx - hw, cx + hw, by - bh + 2, hoop);
      L.hl(cx - hw + 1, cx + hw - 1, by - 1, hoop);
      L.hl(cx - hw, cx + hw, by - bh + 1, st[3]);
    } else {
      // a dark steel box planter
      const st = ['#1c1e24', '#2a2d36', '#3c404c', '#525866'].map((c) => nt(c, 1.15));
      for (let y = by - bh + 1; y <= by; y++) for (let dx = -hw; dx <= hw; dx++) L.set(cx + dx, y, st[dx === -hw ? 2 : dx === hw ? 0 : y === by - bh + 1 ? 3 : 1]);
    }
    // the dome of blooms
    const top = by - bh;
    const dh = 4;
    for (let y = top - dh; y <= top; y++) {
      const rel = (y - (top - dh)) / dh;
      const ww = R(hw * (0.55 + 0.5 * Math.sqrt(rel))) + 1;
      for (let dx = -ww; dx <= ww; dx++) {
        if (y === top - dh && Math.abs(dx) > ww - 2) continue;
        const kind = kinds[Math.floor(hash(cx + dx >> 1, y >> 1, 81) * kinds.length)];
        const m = MUMS[kind];
        const hh = hash(cx + dx, y, 83);
        let c = hh < 0.18 ? '#22381e' : m[y === top - dh || (dx < 0 && hh < 0.6) ? 2 : 1];
        if (y === top && hh < 0.5) c = '#1c2e18';
        L.set(cx + dx, y, nt(c, 1.15));
      }
    }
    footShadow(S, cx - hw, cx + hw, by, bh + dh);
  }

  /** a potted tangerine tree (Lunar New Year) */
  function tangerineTree(S, cx, by) {
    const L = S.L;
    const pot = ['#5a1210', '#8a1c18', '#b02a22', '#d04a34'].map((c) => nt(c, 1.15));
    const gold = nt('#e0b030', 1.2);
    for (let y = by - 4; y <= by; y++) {
      const hw = y === by ? 2 : 3;
      for (let dx = -hw; dx <= hw; dx++) L.set(cx + dx, y, pot[dx === -hw ? 3 : dx === hw ? 0 : y === by - 4 ? 3 : 2]);
    }
    L.hl(cx - 3, cx + 3, by - 3, gold);
    const leaf = EVERGREEN.map((c) => nt(mix(c, '#3a6a20', 0.4), 1.2));
    const ccy = by - 10;
    for (let dy = -5; dy <= 4; dy++)
      for (let dx = -5; dx <= 5; dx++) {
        const d = (dx * dx) / 30 + (dy * dy) / 24;
        if (d > 1) continue;
        const hh = hash(cx + dx, ccy + dy, 91);
        if (d > 0.75 && hh < 0.35) continue;
        let i = 2 + (dx < 0 && dy < 0 ? 1 : 0) - (dy > 2 ? 1 : 0) + (hh < 0.3 ? 1 : 0);
        L.set(cx + dx, ccy + dy, leaf[clamp(i, 0, 4)]);
      }
    L.vl(cx, by - 5, by - 5, nt('#4a3020'));
    const fruit = [
      [-3, -3],
      [1, -4],
      [3, -1],
      [-1, 0],
      [-4, 1],
      [2, 2],
      [0, -2],
      [4, -3],
      [-2, 3],
    ];
    for (const [dx, dy] of fruit) {
      L.set(cx + dx, ccy + dy, nt('#f08a1a', 1.25));
      if ((dx + dy) % 2 === 0) L.set(cx + dx, ccy + dy - 1, nt('#ffb84a', 1.25));
    }
    // two plain red envelopes hung on the branches
    for (const [dx, dy] of [
      [-4, -1],
      [3, 1],
    ]) {
      L.set(cx + dx, ccy + dy, nt('#c41e22', 1.3));
      L.set(cx + dx, ccy + dy + 1, nt('#c41e22', 1.3));
      L.set(cx + dx, ccy + dy + 2, nt('#9a161a', 1.3));
    }
    footShadow(S, cx - 3, cx + 3, by, 15);
  }

  /** a flower box hooked over a rail: x0..x1, its top at the rail */
  const FLOWERS = {
    spring: [
      ['#d8302c', '#f05a4a'],
      ['#f2c828', '#fbe46a'],
      ['#ee86ae', '#fbb6d0'],
      ['#8a5ad0', '#b48af0'],
      ['#f6f2e6', '#ffffff'],
    ],
    summer: [
      ['#d42a2a', '#f05050'],
      ['#e8609a', '#f890bc'],
      ['#f4f2ec', '#ffffff'],
      ['#d42a2a', '#f05050'],
      ['#9a64d8', '#c098f0'],
    ],
  };
  function flowerBox(S, x0, x1, rail, season, seed, boxCol) {
    const L = S.L;
    const box = (boxCol || ['#7a3a22', '#a4512e', '#c4683c']).map((c) => nt(c, 1.15));
    for (let x = x0; x <= x1; x++) {
      L.set(x, rail, box[2]);
      L.set(x, rail + 1, box[1]);
      L.set(x, rail + 2, x === x0 || x === x1 ? box[0] : box[1]);
      L.set(x, rail + 3, box[0]);
    }
    const fl = FLOWERS[season] || FLOWERS.spring;
    const k = 1.15;
    for (let x = x0 + 1; x < x1; x++) {
      const hh = hash(x, seed, 101);
      const hgt = season === 'spring' ? 2 + (hh < 0.5 ? 1 : 0) : 1 + (hh < 0.4 ? 1 : 0);
      // stems and leaves
      for (let y = rail - hgt; y < rail; y++) L.set(x, y, nt(LEAF[(x + y) % 2 ? 2 : 3], k));
      const f = fl[Math.floor(hash(x >> 1, seed, 103) * fl.length)];
      if (season === 'spring') {
        if ((x - x0) % 2 === 1) {
          L.set(x, rail - hgt - 1, nt(f[0], k));
          L.set(x, rail - hgt - 2, nt(f[1], k));
        } else L.set(x, rail - hgt, nt(LEAF[4], k));
      } else {
        L.set(x, rail - hgt - 1, nt(hh < 0.5 ? f[1] : f[0], k));
        if (hh < 0.6) L.set(x, rail - hgt, nt(f[0], k));
      }
    }
    // trailing ivy over the front in summer
    if (season === 'summer')
      for (let x = x0 + 1; x < x1; x += 3) {
        const len = 1 + Math.floor(hash(x, seed, 107) * 3);
        for (let k2 = 0; k2 < len; k2++) L.set(x + (k2 === 2 ? 1 : 0), rail + 2 + k2, nt(LEAF[k2 === len - 1 ? 4 : 3], k));
      }
  }

  /** an evergreen wreath with a red bow, centre (cx, cy) */
  function wreath(S, cx, cy, snow) {
    const L = S.L;
    const G = EVERGREEN.map((c) => nt(c, 1.25));
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -5; dx <= 5; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > 4.9 || d < 1.9) continue;
        const hh = hash(cx + dx, cy + dy, 111);
        let i = 2 + (dx + dy < -1 ? 1 : 0) + (hh < 0.3 ? 1 : 0) - (d > 4.2 || d < 2.5 ? 1 : 0);
        if (dx + dy > 3) i -= 1;
        L.set(cx + dx, cy + dy, G[clamp(i, 0, 4)]);
      }
    for (const [dx, dy] of [
      [-3, -2],
      [2, -4],
      [4, 1],
      [-4, 2],
      [3, -2],
    ])
      L.set(cx + dx, cy + dy, nt('#e02a2a', 1.3));
    if (snow) for (let dx = -3; dx <= 3; dx++) if (hash(cx + dx, 5, 113) < 0.7) L.set(cx + dx, cy - 5 + (Math.abs(dx) > 2 ? 1 : 0), nt(SNOW[2], 1.4));
    // the bow
    L.stamp(['RR.RR', 'RrRrR', '.RrR.', 'R...R', 'R...R'], cx - 2, cy + 3, { R: nt('#c41e22', 1.3), r: nt('#801016', 1.3) });
  }

  /** a cobweb in a corner: (x, y) the corner, sx/sy its direction, r its size */
  function cobweb(S, x, y, sx, sy, r) {
    const L = S.L;
    const c = nt('#dde0e8', 1.45);
    const c2 = nt('#a4a8b6', 1.3);
    const ends = [0.1, 0.56, 1.02, 1.47].map((a) => [Math.cos(a), Math.sin(a)]);
    for (const [ux, uy] of ends) for (let k = 1; k <= r; k++) L.set(x + sx * R(ux * k), y + sy * R(uy * k), k & 1 ? c2 : c);
    for (const rr of [r * 0.45, r * 0.9]) {
      for (let i = 0; i + 1 < ends.length; i++) {
        const [ax, ay] = ends[i];
        const [bx, by] = ends[i + 1];
        for (let s2 = 1; s2 < 5; s2++) {
          const u = s2 / 5;
          const sag = 1 - 0.22 * Math.sin(u * Math.PI); // threads sag towards the corner
          L.set(x + sx * R((ax + (bx - ax) * u) * rr * sag), y + sy * R((ay + (by - ay) * u) * rr * sag), c);
        }
      }
    }
  }

  /** the plaza Christmas tree: base centre (cx, by), height h */
  function xmasTree(S, cx, by, h, snow) {
    const L = S.L;
    const top = by - h;
    const footH = 4;
    const coneB = by - footH;
    const ch = coneB - top;
    const maxHW = R(h * 0.32);
    const tiers = 4;
    const G = EVERGREEN.map((c) => nt(c, 1.2));
    const rowsHW = [];
    for (let y = top; y <= coneB; y++) {
      const rel = (y - top) / ch;
      const tr = Math.min(tiers - 1e-6, rel * tiers);
      const ti = Math.floor(tr);
      const tf = tr - ti;
      const bot = (maxHW * (ti + 1)) / tiers + 0.5;
      const tp = ti === 0 ? 0 : bot * 0.5;
      const hw = R(tp + (bot - tp) * Math.pow(tf, 0.85));
      rowsHW.push(hw);
      for (let dx = -hw; dx <= hw; dx++) {
        const u = hw ? dx / hw : 0;
        let s = 0.56 - 0.32 * u + (hash(cx + dx, y, 121) - 0.5) * 0.26;
        if (ti > 0 && tf < 0.2) s -= 0.3; // in the shade of the tier above
        if (Math.abs(dx) === hw && hw > 1) s -= 0.12;
        L.set(cx + dx, y, G[clamp(Math.floor(s * 5), 0, 4)]);
      }
      // drooping tips under each tier
      if (tf > 0.9 || y === coneB) for (let dx = -hw; dx <= hw; dx += 2) if (Math.abs(dx) > 1) L.set(cx + dx, y + 1, G[1]);
    }
    // snow on every upward-facing ledge
    if (snow) {
      for (let i = 1; i < rowsHW.length; i++) {
        const y = top + i;
        const a = rowsHW[i - 1];
        const b = rowsHW[i];
        for (let dx = a + 1; dx <= b; dx++) {
          if (hash(cx + dx, y, 123) < 0.8) L.set(cx + dx, y, nt(SNOW[dx === b ? 1 : 2], 1.35));
          if (hash(cx - dx, y, 125) < 0.8) L.set(cx - dx, y, nt(SNOW[dx === b ? 0 : 1], 1.3));
        }
      }
    }
    // gold tinsel swags and baubles
    const tinsel = nt('#e8c050', 1.35);
    const swags = [0.32, 0.56, 0.8];
    for (const sv of swags) {
      const y0 = top + R(sv * ch);
      const hw = rowsHW[y0 - top];
      for (let dx = -hw + 1; dx <= hw - 1; dx++) {
        const y = y0 + R(((dx + hw) / (2 * hw)) * 3 - 1.5 * Math.sin(((dx + hw) / (2 * hw)) * Math.PI));
        if ((dx & 1) === 0 && L.has(cx + dx, y)) L.set(cx + dx, y, tinsel);
      }
    }
    const baub = ['#d82828', '#e8b830', '#d0d4e0', '#3466d8', '#d82828', '#e8b830'];
    for (let k = 0; k < 14; k++) {
      const rel = 0.2 + 0.75 * hash(k, 1, 127);
      const y = top + R(rel * ch);
      const hw = rowsHW[y - top];
      const dx = R((hash(k, 2, 127) * 2 - 1) * (hw - 1));
      L.set(cx + dx, y, nt(baub[k % baub.length], 1.35));
    }
    // lights in three spiral swags
    const cols = ['red', 'gold', 'blue', 'green', 'gold', 'white'];
    let n = 0;
    for (const sv of [0.22, 0.45, 0.68, 0.9]) {
      const y0 = top + R(sv * ch);
      const hw = rowsHW[Math.min(rowsHW.length - 1, y0 - top)];
      for (let dx = -hw + 1; dx <= hw - 1; dx += 3) {
        const y = y0 - R(((dx + hw) / (2 * hw)) * 3);
        if (!L.has(cx + dx, y + 1)) continue;
        const b = { x: cx + dx, y, col: cols[n % cols.length], seed: 700 + n, tree: true };
        n++;
        if (S.lit) S.bulbs.push(b);
        else L.set(b.x, b.y, nt(BULB_GLASS[b.col]));
      }
    }
    // trunk and a wooden crate stand
    const wd = ['#3a2416', '#5a3a24', '#7a5434'].map((c) => nt(c, 1.1));
    L.vl(cx, coneB + 1, by - 3, wd[0]);
    L.vl(cx - 1, coneB + 1, by - 3, wd[1]);
    const crate = ['#4a2c18', '#6e4428', '#8e5c36'].map((c) => nt(c, 1.15));
    for (let y = by - 2; y <= by; y++) for (let dx = -4; dx <= 4; dx++) L.set(cx + dx, y, crate[y === by - 2 ? 2 : dx === 4 ? 0 : 1]);
    // presents
    present(L, cx - 9, by, 5, 4, '#c42a2a', '#e8c048');
    present(L, cx + 6, by, 6, 3, '#2e5ec8', '#e8e8f0');
    present(L, cx - 4, by + 1, 3, 2, '#2e8a46', '#d82a2a');
    // the star (glows per frame)
    S.stars.push({ x: cx, y: top - 1 });
    footShadow(S, cx - maxHW, cx + maxHW, by, h);
    return { top, coneB, maxHW };
  }
  function present(L, x0, by, w, h, col, rib) {
    for (let y = by - h + 1; y <= by; y++) for (let x = x0; x < x0 + w; x++) L.set(x, y, nt(x === x0 + w - 1 ? mix(col, '#000000', 0.3) : y === by - h + 1 ? mix(col, '#ffffff', 0.2) : col, 1.3));
    const rx = x0 + (w >> 1);
    L.vl(rx, by - h + 1, by, nt(rib, 1.35));
    L.set(rx - 1, by - h, nt(rib, 1.35));
    L.set(rx + 1, by - h, nt(rib, 1.35));
  }

  /** a snowman in a scarf and hat, base centre (cx, by) */
  function snowman(S, cx, by) {
    const L = S.L;
    const SN = P.snow;
    const balls = [
      { y: by - 4, r: 4.4 },
      { y: by - 11, r: 3.3 },
      { y: by - 16, r: 2.6 },
    ];
    for (const b of balls) {
      const ir = Math.ceil(b.r) + 1;
      for (let dy = -ir; dy <= ir; dy++)
        for (let dx = -ir; dx <= ir; dx++) {
          const d = Math.hypot(dx / (b.r + 0.35), dy / (b.r + 0.2));
          if (d > 1) continue;
          const nz = Math.sqrt(Math.max(0, 1 - d * d));
          const v = (-dx / b.r) * 0.5 + (-dy / b.r) * 0.6 + nz * 0.5;
          let c = v > 0.85 ? SN[8] : v > 0.55 ? SN[7] : v > 0.25 ? SN[6] : v > -0.1 ? SN[5] : SN[4];
          if (d > 0.84 && dy > 0) c = SN[3];
          L.set(cx + dx, R(b.y) + dy, c);
        }
    }
    const coal = P.night[0];
    const hy = balls[2].y;
    L.set(cx - 1, hy - 1, coal);
    L.set(cx + 1, hy - 1, coal);
    L.set(cx, hy, nt('#f07a1a', 1.4));
    L.set(cx + 1, hy, nt('#d05a10', 1.4));
    for (const dy of [-1, 1]) L.set(cx, balls[1].y + dy, coal);
    L.set(cx, balls[0].y - 2, coal);
    // stick arms
    const tw = nt('#5a3a24', 1.2);
    for (let k = 0; k < 5; k++) {
      L.set(cx - 4 - k, balls[1].y - k * 0.8, tw);
      L.set(cx + 4 + k, balls[1].y - k * 0.7, tw);
    }
    L.set(cx - 8, balls[1].y - 4.6, tw);
    L.set(cx + 9, balls[1].y - 3.9, tw);
    // the hat
    L.hl(cx - 3, cx + 3, hy - 3, P.night[1]);
    L.rect(cx - 2, hy - 6, 5, 3, P.night[0]);
    L.hl(cx - 2, cx + 2, hy - 4, nt('#c42222', 1.4));
    L.set(cx + 2, hy - 6, P.night[2]);
    // the scarf (its tail flutters per frame)
    const sc = ['#801818', '#c42828', '#e04a3a'].map((c) => nt(c, 1.4));
    L.hl(cx - 2, cx + 2, hy + 3, sc[1]);
    L.set(cx - 2, hy + 3, sc[2]);
    L.set(cx + 2, hy + 3, sc[0]);
    S.scarf = { x: cx + 1, y: hy + 4, c: sc };
    footShadow(S, cx - 4, cx + 4, by, 22);
  }

  /** a rangoli of coloured powder on the pavement, centre (cx, cy) */
  function rangoli(S, cx, cy, rx, ry) {
    const L = S.L;
    const C = P.rangoli.map((c) => nt(c, 1.35));
    const [mag, ora, yel, grn, blu, pur, wht] = C;
    const ax = rx + 0.5;
    const ay = ry + 0.5;
    for (let y = Math.floor(cy - ay); y <= Math.ceil(cy + ay); y++)
      for (let x = Math.floor(cx - ax); x <= Math.ceil(cx + ax); x++) {
        const u = (x - cx) / ax;
        const v = (y - cy) / ay;
        const rr = Math.hypot(u, v);
        if (rr > 1) continue;
        const th = Math.atan2(v, u);
        let c;
        if (rr > 0.82) {
          const k = Math.floor((th / (Math.PI * 2) + 1) * 12 + 0.5) % 2;
          c = k ? ora : mag;
        } else if (rr > 0.68) c = wht;
        else if (rr > 0.36) {
          const pet = 0.36 + 0.32 * (0.3 + 0.7 * Math.abs(Math.cos(th * 4)));
          const k = Math.floor((th / (Math.PI * 2) + 1) * 8 + 0.5) % 2;
          c = rr < pet ? (k ? blu : grn) : yel;
        } else if (rr > 0.18) c = pur;
        else c = rr < 0.09 ? wht : yel;
        L.set(x, y, c);
      }
    // a ring of chalk dots
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      L.set(cx + Math.cos(a) * (rx + 2.4), cy + Math.sin(a) * (ry + 1.3), wht);
    }
  }

  /** a painted egg, 4 x 5, bottom left-centre (x, by) */
  const EGG = ['#f290bc', '#7ab8f0', '#f4d454', '#86dca4', '#b896f0', '#f8a878'];
  function egg(L, x, by, ci, stripe) {
    const c = EGG[ci % EGG.length];
    const st = EGG[(ci + 2) % EGG.length];
    const m = {
      a: nt(mix(c, '#ffffff', 0.55)),
      b: nt(c),
      c: nt(mix(c, '#4a3a5a', 0.35)),
      S: nt(stripe ? st : mix(c, '#ffffff', 0.25)),
      s: nt(stripe ? mix(st, '#4a3a5a', 0.3) : c),
      d: stripe ? nt(mix('#ffffff', c, 0.2)) : nt(c),
    };
    L.stamp(['.ab.', 'abbc', 'SdSs', 'bbbc', '.cc.'], x - 1, by - 4, m);
  }
  /** a wicker basket of eggs with a pink bow, bottom centre (bx, by) */
  function basket(S, bx, by) {
    const L = S.L;
    const wk = ['#5a3a1a', '#8a6232', '#b08a4e', '#cca86a', '#e0c286'].map((c) => nt(c));
    const hw = 5;
    // handle
    for (let k = 0; k <= 12; k++) {
      const a = Math.PI * (k / 12);
      const x = R(bx - Math.cos(a) * (hw - 1));
      const y = R(by - 5 - Math.sin(a) * 6);
      L.set(x, y, wk[k > 6 ? 2 : 3]);
    }
    egg(L, bx - 2, by - 4, 0, true);
    egg(L, bx + 2, by - 5, 1, false);
    for (let y = by - 4; y <= by; y++) {
      const w2 = y === by ? hw - 1 : hw;
      for (let x = bx - w2; x <= bx + w2; x++) {
        let i = (x + (y % 2) * 2) % 4 < 2 ? 2 : 3;
        if (y === by - 4) i = 4;
        if (x === bx + w2) i = 1;
        if (y === by) i = 1;
        L.set(x, y, wk[i]);
      }
    }
    // a pink bow on the handle
    L.stamp(['p.p', '.P.', 'p.p'], bx - 1, by - 12, { p: nt('#f080b0'), P: nt('#d04a88') });
    footShadow(S, bx - hw, bx + hw, by, 11);
  }

  /** an original hanging pub sign: a shamrock and a pint on a green board, (wx, y) = bracket root */
  function pubSign(S, wx, y) {
    const L = S.L;
    const iron = nt('#16161c', 1.2);
    const hi = nt('#6a6a78', 1.3);
    const brass = nt('#d8a840', 1.4);
    // the arm with a lit top edge, a scrolled brace and a brass finial
    for (let k = 0; k <= 17; k++) {
      L.set(wx + k, y, iron);
      if (k > 1 && k % 2 === 0) L.set(wx + k, y - 1, hi);
    }
    for (let k = 0; k <= 4; k++) L.set(wx + k, y + 4 - k, iron);
    L.set(wx + 3, y + 3, iron);
    L.set(wx + 4, y + 3, iron);
    L.set(wx + 18, y, brass);
    L.set(wx + 18, y - 1, brass);
    // gooseneck lamp over the board
    L.vl(wx, y - 5, y - 1, iron);
    L.hl(wx + 1, wx + 4, y - 6, iron);
    L.hl(wx + 5, wx + 8, y - 5, iron);
    L.set(wx + 9, y - 5, iron);
    S.pubLamp = { x: wx + 7, y: y - 4 };
    // chains
    const bx0 = wx + 3;
    L.set(bx0 + 1, y + 1, iron);
    L.set(bx0 + 13, y + 1, iron);
    const by0 = y + 2;
    const bw = 15;
    const bh = 11;
    const frame = ['#7a5a1a', '#c49a34', '#ecc85e'].map((c) => nt(c, 1.4));
    const field = ['#0e2a1c', '#163a26'].map((c) => nt(c, 1.4));
    for (let yy = 0; yy < bh; yy++)
      for (let xx = 0; xx < bw; xx++) {
        const edge = xx === 0 || yy === 0 || xx === bw - 1 || yy === bh - 1;
        L.set(bx0 + xx, by0 + yy, edge ? frame[xx === bw - 1 || yy === bh - 1 ? 0 : yy === 0 ? 2 : 1] : field[(xx + yy) % 5 === 0 ? 0 : 1]);
      }
    // the shamrock
    const gr = { g: nt('#3aa04a', 1.5), G: nt('#6ad06a', 1.5), s: nt('#2a7a36', 1.5) };
    L.stamp(['.gG.Gg.', 'gGGgGGg', '.gggGg.', '..ggg..', 'gG.s.Gg', 'gg.s.gg', '...s...', '..s....'], bx0 + 1, by0 + 1, gr);
    // the pint: amber beer under a white head
    const pt = { w: nt('#f4f0e4', 1.4), b: nt('#c87a1a', 1.5), B: nt('#eaa232', 1.5), d: nt('#8a4a10', 1.5), g: nt('#c8d8e0', 1.4) };
    L.stamp(['wwww', 'wwwg', 'bBBd', 'bBBd', 'bBBd', 'bBBd', '.bd.', '.dd.'], bx0 + 9, by0 + 1, pt);
    S.pub = { x: bx0 + 7, y: by0 + 5 };
    if (!S.lit) L.set(wx + 7, y - 4, nt('#f0e8d0'));
  }

  /** a football: white panels and black patches, bottom centre (x, by) */
  function football(S, x, by) {
    const L = S.L;
    const map = { W: nt('#f4f4f4', 1.5), w: nt('#c8ccd4', 1.5), K: nt('#1a1a1e'), k: nt('#3a3a44', 1.3) };
    L.stamp(['.WWw.', 'WKWkw', 'WWKwk', 'wkwww', '.wkw.'], x - 2, by - 4, map);
    L.set(x - 1, by + 1, nt('#141218'));
    L.set(x, by + 1, nt('#141218'));
    L.set(x + 1, by + 1, nt('#141218'));
  }

  // ------------------------------------------------------------------
  // light sources registered by the layouts
  // ------------------------------------------------------------------
  function diya(S, x, y, seed) {
    if (S.lit) S.diyas.push({ x, y, seed });
    else {
      S.L.hl(x - 1, x + 1, y, nt(P.pumpkin[1]));
      S.L.hl(x - 2, x + 2, y - 1, nt('#a85a30'));
      S.L.hl(x - 2, x + 2, y - 2, nt('#c87040'));
      S.L.set(x + 3, y - 2, nt('#a85a30'));
    }
  }
  function lantern(S, x, y, seed, kind, opts) {
    S.lanterns.push({ x, y, seed, kind, opts: opts || {} });
    // the hook it hangs from
    S.L.set(x, y, nt('#3a3a40'));
  }

  // the low planter wall at the back of each plaza (drawn by the street
  // module; its granite cap at y 204 is a shelf for diyas and pumpkins)
  const BED = { apt1: { x0: 344, x1: 414, cap: 204 }, apt2: { x0: 70, x1: 126, cap: 204 } };

  // ------------------------------------------------------------------
  // apt1 layouts
  // ------------------------------------------------------------------
  function buildApt1(S, ed, pl) {
    const tag = (t) => ed.tagSet.has(t);
    const bal = balconies(pl);
    const B = bal.my;
    const { f2, f4, f5 } = bal;
    const together = ed.cast.window === 'together';
    const snow = ed.weather.snow || 0;
    const wet = ed.weather.rain > 0;
    const cn = pl.entrance.canopy;
    const pz = pl.plaza;
    const [ta, tb] = pz.trees;
    const L = S.L;
    const railCord = (b, n, sag, dy) => {
      const a = [];
      for (let i = 0; i <= n; i++) a.push([R(b.x0 + ((b.x1 - b.x0) * i) / n), b.rail + (dy || 0), sag]);
      return a;
    };
    const diyasOn = tag('diyas-balcony');

    // ---- Diwali: marigolds, diyas, gold lights, a rangoli lit by diyas
    if (tag('marigolds')) {
      const mk = 1.8;
      toran(L, B.x0 + 1, B.x1 - 1, B.hook, 4, 1, mk);
      marigoldStrand(L, B.x0 + 1, B.hook + 2, B.rail - 7, mk, 0);
      marigoldStrand(L, B.x1 - 2, B.hook + 2, B.rail - 7, mk, 1);
      toran(L, cn.x0 + 1, cn.x1 - 1, cn.y + 3, 6, 1, mk);
      if (f4) toran(L, f4.x0 + 1, f4.x1 - 1, f4.hook, 4, 1, mk);
    }
    if (diyasOn) {
      for (const x of [B.x0 + 2, B.x1 - 5]) diya(S, x, B.rail - 1, x);
      if (f2) for (let x = f2.x0 + 3, k = 0; x <= f2.x1 - 4; x += 8, k++) diya(S, x, f2.rail - 1, 40 + k);
      if (f5) for (const x of [f5.x0 + 2, f5.x1 - 5]) diya(S, x, f5.rail - 1, x + 5);
    }
    if (tag('string-lights-gold')) {
      if (diyasOn) bulbString(S, railCord({ x0: B.x0 - 1, x1: B.x1 + 1, rail: B.slab + 2 }, 3, 2), { colors: ['gold'], spacing: 3, seed: 1 });
      else bulbString(S, railCord(B, 3, 2), { colors: ['gold'], spacing: 3, seed: 1 });
      if (f4) bulbString(S, railCord(f4, 2, 2), { colors: ['gold'], spacing: 3, seed: 2 });
      if (f5) bulbString(S, railCord(f5, 3, 2), { colors: ['gold'], spacing: 3, seed: 3 });
      if (f2 && !diyasOn) bulbString(S, railCord(f2, 2, 2), { colors: ['gold'], spacing: 3, seed: 4 });
      // festoon across the plaza
      bulbString(S, [[pl.building.x1 + 1, 175, 2], [ta, 180, 7], [tb, 180, 3], [pz.x1 + 8, 177]], { colors: ['warm'], spacing: 5, big: true, seed: 9, every: 3, r: 15, i: 0.15 });
    }
    const bed = BED.apt1;
    if (diyasOn) for (let x = bed.x0 + 4, k = 0; x <= bed.x1 - 5; x += 10, k++) diya(S, x, bed.cap, 80 + k);
    if (tag('rangoli-plaza')) {
      const cx = R((pz.bench[1] + tb) / 2) + 2;
      const cy = pz.base - 6;
      rangoli(S, cx, cy, 18, 4);
      // six diyas round the rim: two at the ends, two behind, two in front
      for (const [a, i] of [
        [0, 0],
        [Math.PI, 1],
        [-0.8, 2],
        [-2.34, 3],
        [0.62, 4],
        [2.52, 5],
      ])
        diya(S, R(cx - 1 + Math.cos(a) * 23), R(cy + 1 + Math.sin(a) * 6.5), 60 + i);
    }

    // ---- Halloween: pumpkins, carved faces, cobwebs
    if (tag('pumpkins-balcony')) {
      const ol = { wet, outline: true };
      jack(S, B.x1 - 4, B.rail - 1, 4.5, 3.4, 'm', 11, { ...ol, stem: -1 });
      jack(S, B.x0 + 4, B.rail - 1, 3.6, 3, 's2', 12, ol);
      if (f2) {
        jack(S, f2.x0 + 5, f2.rail - 1, 3.6, 3, 's2', 13, ol);
        pumpkin(L, f2.x0 + 11, f2.rail - 1, 2.6, 2.2, { ...ol, lobes: 3 });
      }
      if (f4) jack(S, f4.x1 - 5, f4.rail - 1, 3.4, 2.8, 's2', 14, ol);
    }
    if (tag('cobwebs')) {
      cobweb(S, B.x0, B.hook, 1, 1, 6);
      cobweb(S, B.x1, B.hook, -1, 1, 5);
      if (f5) cobweb(S, f5.x1, f5.hook, -1, 1, 6);
      if (f2) cobweb(S, f2.x0, f2.hook, 1, 1, 5);
      cobweb(S, cn.x0 + 1, cn.y + 4, 1, 1, 6);
      S.spiders.push({ x: cn.x1 - 6, y: cn.y + 4, len: 7, seed: 3 });
    }
    if (tag('jackolanterns-plaza')) {
      hayBale(S, ta + 4, pz.base - 9, 17, 6);
      jack(S, ta + 8, pz.base - 15, 4, 3, 'm', 21, { wet });
      jack(S, ta + 16, pz.base - 15, 3, 2.6, 's', 22, { wet, stem: -1 });
      pumpkin(L, ta + 3, pz.base - 1, 2.8, 2.2, { wet, lobes: 4 });
      jack(S, ta + 10, pz.base, 4.6, 3.4, 'm', 23, { wet });
      jack(S, tb + 9, pz.base - 1, 5, 3.8, 'l', 24, { wet, stem: -1 });
      jack(S, bed.x0 + 30, bed.cap, 3.4, 2.8, 's2', 26, { wet });
      pumpkin(L, bed.x0 + 36, bed.cap, 2.4, 2, { wet, lobes: 3 });
      jack(S, bed.x1 - 12, bed.cap, 3.6, 2.8, 's2', 27, { wet, stem: -1 });
      jack(S, R((pz.bench[0] + pz.bench[1]) / 2), 213, 3, 2.4, 's', 28, { wet });
      jack(S, tb + 2, pz.base - 2, 3, 2.4, 's', 25, { wet });
      pumpkin(L, tb + 15, pz.base, 2.6, 2.1, { wet, lobes: 3 });
    }

    // ---- Thanksgiving: leaves, plaid, corn and mums
    if (tag('leaf-garland')) {
      const a = railCord(B, 3, 2, 1);
      const pts = cord(a);
      garland(L, pts, 'autumn', 1);
      for (let i = 1; i < a.length - 1; i++) leafDrop(L, a[i][0], a[i][1], 'autumn', 1);
      if (f4) garland(L, cord(railCord(f4, 2, 2, 1)), 'autumn', 1);
      garland(L, cord([[cn.x0 + 1, cn.y + 3, 2], [R((cn.x0 + cn.x1) / 2), cn.y + 3, 2], [cn.x1 - 1, cn.y + 3]]), 'autumn', 1);
    }
    if (tag('plaid-blankets')) {
      if (together) blanket(L, B.x0 + 1, B.x0 + 7, B.rail - 1, 9, 'buffalo', 1.2);
      else blanket(L, B.x0 + 1, B.x0 + 11, B.rail - 1, 10, 'buffalo', 1.2);
      if (f2) blanket(L, f2.x1 - 11, f2.x1 - 1, f2.rail - 1, 10, 'tartan', 1.2);

    }
    if (tag('harvest-planters')) {
      cornShock(S, cn.x0 + 4, pl.entrance.y1, false);
      cornShock(S, cn.x1 - 5, pl.entrance.y1, true);
      mumPlanter(S, cn.x1 - 13, pl.entrance.y1, 9, ['rust', 'gold'], false);
      pumpkin(L, cn.x1 - 9, pl.entrance.y1, 2.6, 2.1, { lobes: 3 });
      hayBale(S, ta + 3, pz.base - 8, 16, 6);
      if (tag('plaid-blankets')) blanket(L, ta + 12, ta + 18, pz.base - 14, 5, 'tartan', 1.05);
      pumpkin(L, ta + 7, pz.base - 14, 3.6, 2.8, {});
      pumpkin(L, ta + 13, pz.base - 15, 2.4, 2, { ramp: PUMPKIN_PALE, lobes: 3 });
      pumpkin(L, ta + 21, pz.base - 2, 2.8, 2.2, { ramp: GOURD_GREEN, lobes: 3 });
      pumpkin(L, ta + 1, pz.base - 1, 3, 2.4, { ramp: PUMPKIN_GOLD, lobes: 4 });
      mumPlanter(S, pz.x1 + 14, pz.base - 1, 11, ['wine', 'cream', 'gold'], true);
      mumPlanter(S, bed.x1 - 10, bed.cap, 9, ['gold', 'rust'], false);
    }

    // ---- Christmas & Hanukkah: evergreen, coloured lights, a tree and a snowman
    if (tag('string-lights-color')) {
      const cols = ['red', 'gold', 'green', 'blue', 'gold'];
      const a = railCord(B, 3, 2, 1);
      garland(L, cord(a), 'evergreen', 1.1, { snow: snow * 0.6, berries: true });
      bulbString(S, a, { colors: cols, spacing: 4, seed: 11, noWire: true });
      if (f4) bulbString(S, railCord(f4, 3, 2), { colors: cols, spacing: 4, seed: 12 });
      if (f5) bulbString(S, railCord(f5, 2, 2), { colors: ['white', 'white', 'gold'], spacing: 4, seed: 13 });
      if (f2) bulbString(S, railCord(f2, 3, 2), { colors: ['warm'], spacing: 3, seed: 14 });
      const ca = [[cn.x0 + 1, cn.y + 3, 2], [R((cn.x0 + cn.x1) / 2), cn.y + 3, 2], [cn.x1 - 1, cn.y + 3]];
      garland(L, cord(ca), 'evergreen', 1.1, { snow: snow * 0.5, berries: true });
      bulbString(S, ca, { colors: cols, spacing: 4, seed: 15, noWire: true, off: 3 });
    }
    if (tag('wreath-balcony')) {
      wreath(S, together ? B.x0 + 5 : B.x0 + 9, B.rail + 4, snow > 0);
      if (f2) wreath(S, f2.x1 - 7, f2.rail + 4, snow > 0);
    }
    if (tag('plaza-xmas-tree')) xmasTree(S, R((pz.bench[1] + tb) / 2) + 6, pz.base - 9, 38, snow > 0);
    if (tag('snowman-plaza')) snowman(S, pz.x1 - 3, pz.base - 1);

    // ---- New Year: gold lights and bunting
    if (tag('party-windows')) {
      const cols = [
        ['#ffc838', '#c88a14', 1],
        ['#f4f6fc', '#a8aec4', 1],
        ['#e8304a', '#9a1424'],
        ['#ffc838', '#c88a14', 1],
        ['#f4f6fc', '#a8aec4', 1],
        ['#3a64f0', '#1e2e9a'],
      ];
      bunting(S, railCord({ x0: B.x0 - 1, x1: B.x1 + 1, rail: B.slab + 2 }, 3, 2), cols, 2, true);
      if (f4) bunting(S, railCord({ x0: f4.x0 - 1, x1: f4.x1 + 1, rail: f4.slab + 2 }, 2, 2), cols, 2, true);
      if (f2) bunting(S, railCord({ x0: f2.x0 - 1, x1: f2.x1 + 1, rail: f2.slab + 2 }, 3, 2), cols.slice(1).concat([cols[0]]), 2, true);
    }

    // ---- Lunar New Year: red lanterns, plain red banners, tangerines
    if (tag('red-lanterns-balcony')) {
      lantern(S, B.x0 + 2, B.hook, 31, 'red', { len: 2 });
      lantern(S, B.x1 - 2, B.hook, 32, 'red', { len: 2 });
      if (f4) {
        lantern(S, f4.x0 + 5, f4.hook, 33, 'red', { len: 3, size: 'small' });
        lantern(S, f4.x1 - 5, f4.hook, 34, 'red', { len: 3, size: 'small' });
      }
      if (f5) {
        lantern(S, f5.x0 + 2, f5.hook, 35, 'red', { len: 2 });
        lantern(S, f5.x1 - 2, f5.hook, 36, 'red', { len: 2 });
      }
    }
    if (tag('red-banners')) {
      valance(L, B.x0 - 1, B.x1 + 1, B.slab, 1.35);
      valance(L, cn.x0 + 1, cn.x1 - 1, cn.y + 2, 1.3);
      if (f2) {
        banner(L, f2.x0 + 2, f2.rail - 1, 4, 13, 1.35);
        banner(L, f2.x1 - 5, f2.rail - 1, 4, 13, 1.35);
      }
    }
    if (tag('tangerines')) {
      tangerineTree(S, cn.x0 + 3, pl.entrance.y1);
      tangerineTree(S, cn.x1 - 3, pl.entrance.y1);
    }
    if (tag('plaza-lanterns')) {
      const pts = bulbString(S, [[pl.building.x1 + 1, 176, 2], [ta, 179, 7], [tb, 179]], { colors: [], spacing: 999, noWire: false });
      for (let k = 0; k < 5; k++) {
        const x = R(ta + 8 + ((tb - ta - 16) * k) / 4);
        const p = pts.find((q) => q[0] === x);
        lantern(S, x, p[1] + 1, 50 + k, 'red', { len: 2, size: k % 2 ? 'small' : undefined });
      }
      const x = R((pl.building.x1 + ta) / 2);
      const p = pts.find((q) => q[0] === x);
      lantern(S, x, p[1] + 1, 58, 'red', { len: 2, size: 'small' });
    }

    // ---- Easter: flower boxes, eggs, a basket
    if (tag('flower-boxes-balcony')) {
      const season = ed.season === 'spring' ? 'spring' : 'summer';
      if (together) {
        flowerBox(S, B.x0 + 1, B.x0 + 7, B.rail, season, 1);
        flowerBox(S, B.x1 - 8, B.x1 - 1, B.rail, season, 2);
      } else {
        flowerBox(S, B.x0 + 1, B.x0 + 13, B.rail, season, 1);
        flowerBox(S, B.x1 - 8, B.x1 - 1, B.rail, season, 2);
      }
      if (f4) {
        flowerBox(S, f4.x0 + 2, f4.x0 + 16, f4.rail, season, 3, ['#3a5a7a', '#4a7096', '#6a8cb0']);
        flowerBox(S, f4.x1 - 16, f4.x1 - 2, f4.rail, season, 4, ['#3a5a7a', '#4a7096', '#6a8cb0']);
      }
      if (f2) flowerBox(S, f2.x0 + 3, f2.x1 - 3, f2.rail, season, 5, ['#8a8a84', '#b4b4ac', '#d4d4cc']);
      if (f5) flowerBox(S, f5.x1 - 15, f5.x1 - 2, f5.rail, season, 6);
    }
    if (tag('eggs-plaza')) {
      const spots = [
        [pz.x0 - 1, pz.base - 9, 0],
        [ta - 4, pz.base - 1, 1],
        [ta + 6, pz.base - 12, 2],
        [pz.bench[0] - 3, pz.base - 11, 3],
        [pz.bench[1] + 3, pz.base - 12, 4],
        [tb + 7, pz.base - 10, 5],
        [pz.x1 + 2, pz.base - 4, 1],
        [pz.x1 - 6, pz.base + 2, 2],
        [R((ta + pz.bench[0]) / 2), pz.base + 3, 3],
        [R((pz.bench[1] + tb) / 2), pz.base + 3, 0],
      ];
      spots.forEach(([x, y, c], i) => {
        egg(L, x, y, c, i % 2 === 0);
        // a tuft of grass half hiding it
        if (i % 3 !== 2) {
          L.set(x - 2, y, nt(LEAF[3]));
          L.set(x - 2, y - 1, nt(LEAF[4]));
          L.set(x + 3, y, nt(LEAF[2]));
          L.set(x + 3, y - 1, nt(LEAF[3]));
        }
        L.hl(x - 1, x + 2, y + 1, nt('#3a3a3a'));
      });
    }
    if (tag('egg-basket')) basket(S, tb + 10, pz.base - 6);

    // ---- Midsummer: flower garlands and paper lanterns
    if (tag('flower-garland-balcony')) {
      const a = railCord(B, 3, 2, 1);
      garland(L, cord(a), 'summer', 1.2);
      for (let i = 1; i < a.length - 1; i++) leafDrop(L, a[i][0], a[i][1], 'summer', 1.2);
      if (f4) garland(L, cord(railCord(f4, 2, 2, 1)), 'summer', 1.2);
      if (f2) garland(L, cord(railCord(f2, 3, 2, 1)), 'summer', 1.2);
    }
    if (tag('paper-lantern-string')) {
      const pts = bulbString(S, [[pl.building.x1 + 1, 175, 2], [ta, 179, 7], [tb, 179]], { colors: [], spacing: 999 });
      for (let k = 0; k < 6; k++) {
        const x = R(ta + 6 + ((tb - ta - 12) * k) / 5);
        const p = pts.find((q) => q[0] === x);
        lantern(S, x, p[1] + 1, 70 + k, 'paper', { len: 1, size: k % 2 ? 'small' : undefined });
      }
      const x = R((pl.building.x1 + ta) / 2);
      const p = pts.find((q) => q[0] === x);
      lantern(S, x, p[1] + 1, 77, 'paper', { len: 1, size: 'small' });
    }

    // ---- Match Night: flags, a saltire, a pub sign, a football
    if (tag('flags-matchday')) {
      const k = 1.7;
      S.flags.push({ ...flagFrames('spain', 'drape', k), x: B.x0 + 1, y: B.rail - 1, seed: 1 });
      const stick = (b, name, x, seed) => {
        const fr = flagFrames(name, 'stick', k);
        const top = b.rail - 11;
        L.vl(x, top, b.rail - 1, nt('#d8d8d0', 1.3));
        L.set(x, top - 1, nt('#e8c048', 1.4));
        S.flags.push({ ...fr, x: x + 1, y: top - 1, seed });
      };
      if (f4) {
        stick(f4, 'usa', f4.x0 + 2, 2);
        stick(f4, 'ireland', f4.x1 - 15, 3);
      }
      if (f5) {
        stick(f5, 'norway', f5.x0 + 3, 4);
        stick(f5, 'france', f5.x1 - 12, 5);
      }
      if (f2) stick(f2, 'germany', f2.x1 - 13, 6);
    }
    if (tag('saltire-banner') && f2) S.flags.push({ ...flagFrames('saltire', 'drape', 1.6), x: f2.x0 + 4, y: f2.rail - 1, seed: 7 });
    if (tag('pub-sign')) pubSign(S, pl.building.x0 + 4, pl.floors.band[0] + 2);
    if (tag('football')) football(S, pz.x1 - 4, pz.base + 2);
  }

  // ------------------------------------------------------------------
  // apt2 layouts: the lobby and the corner plaza
  // ------------------------------------------------------------------
  function buildApt2(S, ed, pl) {
    const tag = (t) => ed.tagSet.has(t);
    const L = S.L;
    const E = pl.entrance;
    const pz = pl.plaza;
    const wet = ed.weather.rain > 0;
    const by = E.y1 + 1; // just in front of the building line
    if (tag('pumpkins-lobby')) {
      const ol = { wet, outline: true };
      jack(S, E.x0 - 7, by, 4.6, 3.4, 'm', 81, ol);
      pumpkin(L, E.x0 - 1, by, 2.4, 2, { ...ol, lobes: 3 });
      jack(S, E.x1 + 7, by, 4.2, 3.2, 'm', 83, { ...ol, stem: -1 });
      jack(S, E.x1 + 13, by, 3, 2.4, 's', 84, ol);
    }
    if (tag('jackolanterns-plaza')) {
      const fx = pl.firepit ? pl.firepit.x : R((pz.x0 + pz.x1) / 2);
      hayBale(S, fx - 10, pz.base - 6, 19, 6);
      jack(S, fx - 5, pz.base - 12, 4, 3, 'm', 91, { wet });
      jack(S, fx + 4, pz.base - 12, 3.4, 2.8, 's2', 92, { wet, stem: -1 });
      jack(S, fx + 12, pz.base, 4.6, 3.4, 'l', 93, { wet });
      pumpkin(L, fx - 13, pz.base, 2.8, 2.2, { wet, lobes: 3 });
      jack(S, pz.trees[0] + 7, pz.base - 4, 3.6, 2.8, 's2', 94, { wet });
      jack(S, pz.x0 + 46, pz.base, 3, 2.4, 's', 95, { wet });
      pumpkin(L, pz.x0 + 52, pz.base, 2.4, 2, { wet, lobes: 3 });
    }
    if (tag('harvest-planters')) {
      cornShock(S, E.lobby.x0 + 3, E.y1, false);
      cornShock(S, E.lobby.x1 - 3, E.y1, true);
      mumPlanter(S, E.x0 - 6, by, 7, ['rust', 'gold'], false);
      pumpkin(L, E.x0 - 2, by, 2.6, 2.1, { lobes: 3 });
      mumPlanter(S, E.x1 + 7, by, 7, ['wine', 'gold'], false);
      pumpkin(L, E.x1 + 2, by, 2.4, 2, { ramp: PUMPKIN_PALE, lobes: 3 });
      const fx = pl.firepit ? pl.firepit.x : 100;
      hayBale(S, pz.x0 + 18, pz.base - 8, 17, 6);
      pumpkin(L, pz.x0 + 23, pz.base - 14, 3.6, 2.8, {});
      pumpkin(L, pz.x0 + 29, pz.base - 14, 2.4, 2, { ramp: PUMPKIN_GOLD, lobes: 3 });
      pumpkin(L, pz.x0 + 16, pz.base - 1, 3, 2.4, { ramp: PUMPKIN_PALE, lobes: 4 });
      pumpkin(L, pz.x0 + 37, pz.base, 2.6, 2, { ramp: GOURD_GREEN, lobes: 3 });
      mumPlanter(S, fx - 26, pz.base - 1, 11, ['rust', 'gold', 'wine'], true);
      mumPlanter(S, pz.x1 - 6, pz.base - 6, 9, ['gold', 'cream'], true);
    }
  }

  // ------------------------------------------------------------------
  // build once per entry
  // ------------------------------------------------------------------
  const scene = HD.perEdition((ed) => {
    const pl = HD.PLACES[ed.place];
    if (!pl || pl.city !== 'boston') return null;
    const S = newScene(ed);
    if (pl.id === 'apt1') buildApt1(S, ed, pl);
    else if (pl.id === 'apt2') buildApt2(S, ed, pl);
    S.stat = S.L.bake();
    S.L = null;
    if (!S.stat && !S.diyas.length && !S.lanterns.length && !S.flags.length && !S.bulbs.length && !S.jacks.length) return null;
    return S;
  });

  // ------------------------------------------------------------------
  // per frame
  // ------------------------------------------------------------------
  const STAR = ['..a..', '.aba.', 'abcba', '.aba.', '.a.a.'];
  function draw(g, t) {
    const S = scene();
    if (!S) return;
    const gf = front(g);
    if (S.stat) gf.sprite(S.stat.img, S.stat.x, S.stat.y);
    // flags flutter on the shared breeze
    if (S.flags.length) {
      const br = HD.summer ? HD.summer.breeze(t) : 0;
      const ts = T.step(t, 5);
      const goal = HD.summer && HD.tag('goal-fireworks') ? HD.summer.goal(t) : -1;
      for (const f of S.flags) {
        const amt = Math.abs(br) + 0.25 * T.noise(t, 2.3, f.seed * 17) + (goal >= 0 ? 1 : 0);
        const fi = amt < 0.3 ? 0 : Math.floor(T.phase(goal >= 0 ? T.step(t, 10) : ts, goal >= 0 ? 0.6 : 1.6, f.seed * 0.17) * 4);
        gf.sprite(f.frames[fi], f.x, f.y);
      }
    }
    // the dangling spider
    for (const sp of S.spiders) {
      const k = 0.5 + 0.5 * T.wave(t, 11.3, sp.seed * 0.1);
      const len = R(2 + k * sp.len);
      const thread = nt('#d8dae4', 1.4);
      gf.vline(sp.x, sp.y, sp.y + len, thread);
      const y = sp.y + len + 1;
      const sk = nt('#100c12');
      gf.rect(sp.x - 1, y, 3, 2, sk);
      gf.px(sp.x, y + 2, sk);
      gf.px(sp.x - 2, y - 1, sk);
      gf.px(sp.x + 2, y - 1, sk);
      gf.px(sp.x - 2, y + 2, sk);
      gf.px(sp.x + 2, y + 2, sk);
    }
    const gl = S.lit ? gf : gU;
    for (const l of S.lanterns) F.lantern(gl, l.x, l.y, t, l.seed, l.kind, l.opts);
    for (const d of S.diyas) F.diya(gf, d.x, d.y, t, d.seed);
    if (S.scarf) {
      const s = S.scarf;
      const fl = T.noise(T.step(t, 6), 3.3, 919) > 0.55 ? 1 : 0;
      gf.px(s.x, s.y, s.c[1]);
      gf.px(s.x + fl, s.y + 1, s.c[0]);
      gf.px(s.x + 1 + fl, s.y + 2, s.c[1]);
    }
    if (!S.lit) return;
    const e = g.em;
    drawJacks(g, t, S.jacks);
    drawBulbs(g, t, S.bulbs);
    for (const s of S.stars) {
      const pulse = T.wave(t, 4.7) > 0.4;
      const map = { a: P.gold[4], b: pulse ? P.gold[6] : P.gold[5], c: '#fffbe6' };
      for (let y = 0; y < STAR.length; y++) for (let x = 0; x < 5; x++) if (STAR[y][x] !== '.') e.px(s.x - 2 + x, s.y - 4 + y, map[STAR[y][x]]);
    }
    if (S.pubLamp) {
      e.px(S.pubLamp.x, S.pubLamp.y, '#fff2c8');
      e.px(S.pubLamp.x - 1, S.pubLamp.y, P.amber[6]);
    }
    // metallic glints on the gold and silver pennants, now and then
    for (const gt of S.glints) {
      const c = T.cycle(t, gt.seed, 4.5, 4401);
      if (c.age < 0.05 && c.rnd(1) < 0.75) {
        e.px(gt.x, gt.y, '#fffaf0');
        if (c.age < 0.025) e.px(gt.x + 1, gt.y, '#ffe6a0');
      }
    }
  }

  function lights(t, L) {
    const S = scene();
    if (!S) return;
    // shadows of the plaza props by day and at golden hour
    const lt = HD.light();
    if (lt.day > 0 && lt.sun && S.shades.length) {
      const golden = lt.mode === 'golden' || lt.mode === 'dusk';
      for (const s of S.shades) {
        const len = R(s.h * (golden ? 0.9 : 0.35));
        const dir = lt.sun.x > (s.x0 + s.x1) / 2 ? -1 : 1;
        const xa = dir < 0 ? s.x0 - len : s.x0;
        const xb = dir < 0 ? s.x1 : s.x1 + len;
        L.shade({
          poly: [
            [s.x0 + 0.5, s.by + 1.5],
            [s.x1 + 0.5, s.by + 1.5],
            [dir < 0 ? s.x1 - len * 0.4 : xb, s.by - 0.5],
            [dir < 0 ? xa : s.x0 + len * 0.4, s.by - 0.5],
          ],
          k: golden ? 0.42 : 0.35,
        });
      }
    }
    if (!S.lit) return;
    for (const d of S.diyas) F.diyaLight(L, d.x, d.y, t, d.seed, 15, 0.3);
    for (const l of S.lanterns) F.lanternLight(L, l.x, l.y, t, l.seed, l.kind, l.opts);
    stringLights(L, t, S);
    const ts = T.step(t, 9);
    for (const j of S.jacks) {
      const f = T.flicker(ts, j.seed, 1.1);
      L.add({ x: j.x, y: j.y, r: 10 + j.r * 2.2, color: LIGHT.pumpkin, i: (0.2 + 0.05 * j.r) * (0.75 + 0.45 * f), halo: j.r >= 4 ? { r: 7, a: 0.1 } : undefined });
    }
    for (const s of S.stars) {
      L.add({ x: s.x, y: s.y + 14, r: 30, ry: 26, color: [0.95, 0.72, 0.5], i: 0.3, bands: 5 });
      L.add({ x: s.x, y: s.y - 2, r: 8, color: LIGHT.bulb.gold, i: 0.25, halo: { r: 9, a: 0.18 } });
    }
    if (S.pub) L.add({ x: S.pub.x, y: S.pub.y - 2, r: 13, ry: 10, color: LIGHT.lantern, i: 0.42, halo: { x: S.pubLamp.x, y: S.pubLamp.y, r: 5, a: 0.16 } });
  }

  HD.module('decor-boston', {
    lights,
    passes: [{ layer: 'scene', z: 36, id: 'decor', draw }],
  });
})();
