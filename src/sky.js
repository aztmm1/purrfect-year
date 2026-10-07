/*
 * sky (Purrfect Year v2): every sky of the diary, on the unlit bg layer behind
 * the far city (z 0..9). Everything static is baked once per edition
 * (HD.perEdition) and picked at draw time from HD.edition, so switching
 * entries live only selects another cached bake.
 *
 *   z0  the sky: a banded gradient with ordered-dither seams, the banded
 *       warmth around the sun (day, golden hour) or the afterglow (dusk),
 *       the moon and its halo, the baked stars; per frame a few dozen stars
 *       twinkle
 *   z1  the sun: a slow sparkle on its dithered halo ring
 *   z2  a shooting star, once per loop, on clear nights with stars
 *   z3  far clouds: horizon banks, small far cumulus, dusk streaks
 *   z4  the lightning bolt (behind the nearer clouds, so it leaves their base)
 *   z5  mid clouds
 *   z7  near clouds. Clouds are lit around the moon (night) or the low sun
 *       (golden hour) through dithered radial masks, and around a lightning
 *       strike while it flashes
 *   z8  the lightning flash over the whole sky
 * Lights: a strike briefly lights the whole scene in cold blue-white.
 * Cloud layers scroll a whole number of tiles per loop; layers that reach the
 * top of the frame only sway a few pixels, so the title-safe corner (top
 * left) never gets a cloud drifting through it.
 *
 * HD.sky (for other modules): moon() and sun() give the current disc
 * {x, y, r}, at(x, y) the baked sky colour behind a point (glass
 * reflections), flash(t) the lightning flash level 0..1, bolt(t) the
 * visible strike {x, y0, y1} or null.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const W = HD.W;
  const H = HD.H;
  const HOR = 206; // building bases: the street-level horizon
  const N = P.night;
  const V = P.violet;
  const AM = P.amber;
  const hex = HD.color.hex;
  const mix = HD.color.mix;
  const bayer = HD.bayer;
  const TS = (HD.layout && HD.layout.titleSafe) || { x0: 8, y0: 8, x1: 170, y1: 70 };

  const idSeed = (s) => {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  };
  const LT = HD.LIGHTING;
  const lightOf = (ed) => LT[ed.light || 'night'] || LT.night;
  const placeOf = (ed) => HD.PLACES[ed.place || 'apt1'];
  /**
   * top of everything standing at column x: the building block and, when the
   * backdrops module says, the far city (999 = open to the ground)
   */
  function openTop(pl, x) {
    let top = HD.placeTop(x, pl);
    if (HD.backdrops && HD.backdrops.top && pl === HD.place()) {
      try {
        const b = HD.backdrops.top(x);
        if (b < top) top = b;
      } catch (e) {
        // the far city is optional: the sky never depends on it
      }
    }
    return top;
  }

  // ------------------------------------------------------------------
  // colour + raster helpers (bake time only)
  // ------------------------------------------------------------------
  const rgb = (c) => (typeof c === 'string' ? hex(c) : c);
  const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const css = (c) => HD.color.css(c[0], c[1], c[2]);

  function Img(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  Img.prototype.set = function (x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const v = rgb(c);
    const i = (y * this.w + x) * 4;
    this.d[i] = v[0];
    this.d[i + 1] = v[1];
    this.d[i + 2] = v[2];
    this.d[i + 3] = 255;
  };
  Img.prototype.get = function (x, y) {
    x = Math.max(0, Math.min(this.w - 1, Math.round(x)));
    y = Math.max(0, Math.min(this.h - 1, Math.round(y)));
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2]];
  };
  Img.prototype.mixAt = function (x, y, c, k) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || k <= 0) return;
    this.set(x, y, lerp3(this.get(x, y), rgb(c), k));
  };
  Img.prototype.canvas = function () {
    const self = this;
    return HD.bake(this.w, this.h, (g, cv) => {
      const ctx = cv.getContext('2d');
      const id = ctx.createImageData(self.w, self.h);
      id.data.set(self.d);
      ctx.putImageData(id, 0, 0);
    });
  };

  /** tone map (0 = empty, 1..n tones) with x wrap, for tileable cloud layers */
  function Tones(w, h) {
    this.w = w;
    this.h = h;
    this.a = new Uint8Array(w * h);
  }
  Tones.prototype.get = function (x, y) {
    if (y < 0 || y >= this.h) return 0;
    return this.a[y * this.w + (((x % this.w) + this.w) % this.w)];
  };
  Tones.prototype.put = function (x, y, v) {
    if (y < 0 || y >= this.h) return;
    this.a[y * this.w + (((x % this.w) + this.w) % this.w)] = v;
  };
  function tonesToCanvas(tn, pal) {
    const im = new Img(tn.w, tn.h);
    const pr = pal.map(rgb);
    for (let y = 0; y < tn.h; y++)
      for (let x = 0; x < tn.w; x++) {
        const v = tn.a[y * tn.w + x];
        if (v && pr[v - 1]) im.set(x, y, pr[v - 1]);
      }
    return im.canvas();
  }
  /** remove lone pixels so every tone reads as a cluster */
  function tidy(tn, passes, maxTone) {
    const w = tn.w;
    const h = tn.h;
    const nt = (maxTone || 5) + 1;
    for (let p = 0; p < passes; p++) {
      const out = tn.a.slice();
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = tn.get(x, y);
          const n = [tn.get(x - 1, y), tn.get(x + 1, y), tn.get(x, y - 1), tn.get(x, y + 1)];
          let same = 0;
          let filled = 0;
          for (const q of n) {
            if (q === v) same++;
            if (q) filled++;
          }
          if (same > 0) continue;
          if (v && filled === 0) {
            out[y * w + x] = 0;
            continue;
          }
          const cnt = new Array(nt).fill(0);
          for (const q of n) cnt[q]++;
          let best = 0;
          for (let k = 1; k < nt; k++) if (cnt[k] > cnt[best] || (best === 0 && cnt[k] > 0 && cnt[k] >= cnt[0])) best = k;
          if (!v && filled < 3) continue; // small notches in a silhouette are fine
          out[y * w + x] = best;
        }
      tn.a = out;
    }
  }

  // ------------------------------------------------------------------
  // the classic night cloud painter (Rainy Hollow): a union of puffs shaded
  // as ONE silhouette: rim + lit band on the upper right (moon side), a dark
  // band along the underside, inner lumps on "front" puffs.
  // tones 1 shadow, 2 base, 3 light, 4 rim. puffs: [cx, cy, rx, ry, base?, front?]
  // ------------------------------------------------------------------
  function nightCloud(tn, puffs, rim, darkUnder) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of puffs) {
      x0 = Math.min(x0, Math.floor(p[0] - p[2] - 2));
      x1 = Math.max(x1, Math.ceil(p[0] + p[2] + 2));
      y0 = Math.min(y0, Math.floor(p[1] - p[3] - 2));
      y1 = Math.max(y1, Math.ceil(p[1] + p[3] + 2));
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const inP = (p, x, y) => {
      if (p[4] !== undefined && y > p[4]) return false;
      const dx = (x - p[0]) / p[2];
      const dy = (y - p[1]) / p[3];
      return dx * dx + dy * dy <= 1;
    };
    const m = new Uint8Array(bw * bh);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) for (const p of puffs) if (inP(p, x, y)) m[(y - y0) * bw + (x - x0)] = 1;
    const M = (x, y) => (x < x0 || x > x1 || y < y0 || y > y1 ? 0 : m[(y - y0) * bw + (x - x0)]);
    const under = darkUnder || 3;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!M(x, y)) continue;
        let v = 2;
        if (!M(x, y + under) || !M(x - 1, y + under - 1)) v = 1;
        if (!M(x + 1, y - 2) || !M(x + 2, y - 1)) v = 3;
        if (rim && (!M(x, y - 1) || !M(x + 1, y - 1))) v = 4;
        tn.put(x, y, v);
      }
    for (const p of puffs) {
      if (!p[5]) continue;
      for (let y = Math.floor(p[1] - p[3]); y <= p[1] - p[3] * 0.25; y++)
        for (let x = Math.floor(p[0] + p[2] * 0.1); x <= Math.ceil(p[0] + p[2] * 0.85); x++) {
          if (!inP(p, x, y) || inP(p, x + 1, y - 1)) continue;
          if (!M(x + 1, y - 1)) continue;
          tn.put(x, y, 3);
        }
    }
  }

  // ------------------------------------------------------------------
  // the soft-cloud painter (day, golden hour, dusk, moonlit nights): a cloud
  // is a list of puffs [cx, cy, rx, ry, base?] painted back to front; every
  // pixel belongs to the front-most puff covering it and is shaded as a
  // point on that puff's ball, lit from L = [x, y, z] (toward the light;
  // z toward the viewer). So each lobe gets its own lit cap and shaded
  // underside, and the creases between lobes come for free. Flat-based
  // clouds darken their bottom row (day and night only: at golden hour and
  // dusk the light comes from below).
  // tones 1 belly, 2 shade, 3 body, 4 lit, 5 rim
  // ------------------------------------------------------------------
  function puffCloud(tn, puffs, o) {
    const L = o.L;
    const th = o.t || [-0.42, -0.06, 0.4, 0.72];
    const dith = o.dith === undefined ? 0.12 : o.dith;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of puffs) {
      x0 = Math.min(x0, Math.floor(p[0] - p[2] - 1));
      x1 = Math.max(x1, Math.ceil(p[0] + p[2] + 1));
      y0 = Math.min(y0, Math.floor(p[1] - p[3] - 1));
      y1 = Math.max(y1, Math.ceil(p[1] + p[3] + 1));
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const own = new Int16Array(bw * bh).fill(-1);
    let top = Infinity;
    let base = -Infinity;
    puffs.forEach((p, i) => {
      for (let y = Math.floor(p[1] - p[3]); y <= Math.ceil(p[1] + p[3]); y++) {
        if (p[4] !== undefined && y > p[4]) continue;
        for (let x = Math.floor(p[0] - p[2]); x <= Math.ceil(p[0] + p[2]); x++) {
          const dx = (x - p[0]) / p[2];
          const dy = (y - p[1]) / p[3];
          if (dx * dx + dy * dy > 1) continue;
          own[(y - y0) * bw + (x - x0)] = i;
          if (y < top) top = y;
          if (y > base) base = y;
        }
      }
    });
    if (base < top) return;
    if (o.side) {
      // side light (low sun, afterglow): shade the whole silhouette by how far
      // each pixel is from the edge facing the light and from the far edge
      const M = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && own[(y - y0) * bw + (x - x0)] >= 0;
      const reach = (x, y, dx, dy, cap) => {
        for (let k = 1; k <= cap; k++) if (!M(Math.round(x + dx * k), Math.round(y + dy * k))) return k;
        return cap + 1;
      };
      const [sx, sy] = o.side;
      const litW = o.litW || 2;
      const shW = o.shW || 3;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (!M(x, y)) continue;
          const dl = reach(x, y, sx, sy, 6);
          const da = reach(x, y, -sx, -sy, 6);
          const b = bayer(x + 1, y + 2) - 0.5;
          let v = 3;
          if (da <= 1) v = 1;
          else if (da / shW + b * 0.6 < 1) v = 2;
          if (dl <= 1) v = 5;
          else if (dl / litW + b * 0.6 < 1) v = 4;
          tn.put(x, y, v);
        }
      return;
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = own[(y - y0) * bw + (x - x0)];
        if (i < 0) continue;
        const p = puffs[i];
        const nx = (x - p[0]) / p[2];
        const ny = (y - p[1]) / p[3];
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        let d = nx * L[0] + ny * L[1] + nz * L[2];
        // the lower part of a cloud sits in its own shade (skylight from above)
        if (o.vert) d -= o.vert * ((y - top) / Math.max(1, base - top) - 0.4);
        d += (bayer(x, y) - 0.5) * dith;
        let v = d > th[3] ? 5 : d > th[2] ? 4 : d > th[1] ? 3 : d > th[0] ? 2 : 1;
        if (o.flatBase) {
          if (y >= base) v = 1;
          else if (y >= base - 1) v = Math.min(v, 2);
        }
        tn.put(x, y, v);
      }
  }

  /**
   * puffs of one cloud, back to front. kind 'heap': a fair-weather cumulus
   * (a flat base, a dome of round lobes, a crown); 'flat': a small flat
   * humilis; 'strato': a long lumpy band (stratocumulus or a thin streak)
   */
  function cumulus(rng, cx, yb, cw, ch, kind) {
    const puffs = [];
    const L = cx - cw / 2;
    if (kind === 'strato') {
      // tapered ends, a lumpy top and a soft, uneven underside
      const n = Math.max(3, Math.round(cw / 10));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const hump = Math.pow(Math.sin(Math.PI * u), 0.8);
        const r = Math.max(1, ch * (0.3 + 0.7 * hump) * (0.75 + 0.45 * rng()));
        puffs.push([L + u * cw + (rng() - 0.5) * 4, yb - r + (rng() - 0.5) * ch * 0.9, Math.max(r * 1.7, (cw / n) * (0.75 + 0.4 * rng())), r]);
      }
      // nearer lobes in front: paint the lower ones last
      puffs.sort((a, b) => a[1] - b[1]);
      return puffs;
    }
    // a core behind everything so the lobes never leave pinholes
    puffs.push([cx, yb - ch * (kind === 'flat' ? 0.25 : 0.38), cw * 0.36, ch * (kind === 'flat' ? 0.3 : 0.36), yb]);
    // the dome: round lobes rising toward an off-centre peak (behind)
    if (kind !== 'flat') {
      const peak = 0.38 + rng() * 0.26;
      const m = Math.max(2, Math.round(cw / 12));
      for (let j = 0; j < m; j++) {
        const u = 0.14 + 0.72 * ((j + 0.5) / m) + (rng() - 0.5) * 0.05;
        const d = Math.abs(u - peak);
        const r = Math.max(1.8, ch * (0.36 - d * 0.42) * (0.9 + 0.25 * rng()));
        const lift = ch * (0.52 - d * 0.75);
        puffs.push([L + u * cw, yb - Math.max(r * 0.9, lift + r * 0.4), r * (1.08 + rng() * 0.16), r, yb]);
      }
      const cr = Math.max(1.8, ch * (0.24 + 0.06 * rng()));
      puffs.push([L + peak * cw + (rng() - 0.5) * 4, yb - ch + cr, cr * 1.1, cr, yb]);
      // the higher lobes behind, the lower ones in front (the core stays first)
      const core = puffs.shift();
      puffs.sort((a, b) => a[1] - b[1]);
      puffs.unshift(core);
    }
    // the base: wide flat lobes along the bottom, in front of everything
    const n = Math.max(2, Math.round(cw / 15));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const hump = Math.pow(Math.sin(Math.PI * u), 0.5);
      const r = Math.max(1.6, ch * (kind === 'flat' ? 0.5 : 0.3) * (0.55 + 0.45 * hump) * (0.9 + 0.2 * rng()));
      puffs.push([L + u * cw + (rng() - 0.5) * 3, yb - r * 0.4, (cw / n) * (0.62 + 0.12 * rng()), r, yb]);
    }
    return puffs;
  }

  // ------------------------------------------------------------------
  // gradients, glows, sun and moon (bake time)
  // ------------------------------------------------------------------
  function stopAt(stops, y) {
    if (y <= stops[0][0]) return rgb(stops[0][1]);
    for (let i = 1; i < stops.length; i++)
      if (y <= stops[i][0]) {
        const a = stops[i - 1];
        const b = stops[i];
        return lerp3(rgb(a[1]), rgb(b[1]), (y - a[0]) / (b[0] - a[0]));
      }
    return rgb(stops[stops.length - 1][1]);
  }
  /** band colours, edges and dithered seam widths of a look */
  function gradOf(lk) {
    let edges;
    let cols;
    if (lk.bands) {
      edges = lk.edges;
      cols = lk.bands.map(rgb);
    } else {
      const n = lk.n || 12;
      const y1 = lk.y1 || HOR;
      edges = [];
      for (let i = 1; i < n; i++) edges.push(Math.round(y1 * Math.pow(i / n, lk.pow || 0.9)));
      cols = [];
      for (let i = 0; i < n; i++) {
        const a = i ? edges[i - 1] : 0;
        const b = i < n - 1 ? edges[i] : y1;
        cols.push(stopAt(lk.stops, a + (b - a) * (i / (n - 1))));
      }
    }
    const seams = edges.map((e, j) => {
      const up = e - (j ? edges[j - 1] : 0);
      const dn = (j + 1 < edges.length ? edges[j + 1] : HOR) - e;
      return Math.max(1, Math.min(lk.seam || 5, Math.floor(Math.min(up, dn) * 0.4)));
    });
    return { edges, cols, seams };
  }
  function bandIdx(x, y, G) {
    const b = bayer(x, y);
    const e = G.edges;
    let n = 0;
    for (let j = 0; j < e.length; j++) {
      const sm = G.seams[j];
      if ((y - e[j] + sm + 0.5) / (2 * sm + 1) > b) n++;
    }
    return n;
  }
  /**
   * banded radial glow mixed into the image: {x, y, rx, ry, c, k: [[d, k]...],
   * dpx} (d = normalised distance, k = mix toward c; dpx = dithered seam width)
   */
  function paintGlow(im, gl) {
    const R = gl.k[gl.k.length - 1][0];
    const dn = (gl.dpx || 6) / Math.min(gl.rx, gl.ry);
    const xa = Math.max(0, Math.floor(gl.x - gl.rx * R - 2));
    const xb = Math.min(im.w - 1, Math.ceil(gl.x + gl.rx * R + 2));
    const ya = Math.max(0, Math.floor(gl.y - gl.ry * R - 2));
    const yb = Math.min(im.h - 1, Math.ceil(gl.y + gl.ry * R + 2));
    const c = rgb(gl.c);
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const dx = (x - gl.x) / gl.rx;
        const dy = (y - gl.y) / gl.ry;
        const d = Math.sqrt(dx * dx + dy * dy) + (bayer(x + 3, y + 5) - 0.5) * dn;
        if (d >= R) continue;
        let k = 0;
        for (const b of gl.k)
          if (d < b[0]) {
            k = b[1];
            break;
          }
        im.mixAt(x, y, c, k);
      }
  }

  /**
   * The moon disc: limb darkening, crater clusters, a brighter cap on the
   * lit side. Crater layout is authored for r = 16 and scales with r.
   * ramp = 5 colours dark -> light.
   */
  function paintMoon(im, mx, my, r, ramp) {
    const k = r / 16;
    const rr = r * r + r * 0.6;
    const inD = (dx, dy) => dx * dx + dy * dy <= rr;
    const craters = [
      [-5, -4, 3.6, 2.6],
      [-8, -1, 1.6, 2.2],
      [3, 3, 4.6, 3.1],
      [6, 0, 1.6, 1.2],
      [-2, 8, 3, 1.8],
      [7, -7, 1.6, 1.3],
      [-9, 6, 1.4, 1.4],
    ];
    const dark = [
      [-6, -4],
      [-5, -4],
      [2, 3],
      [3, 3],
      [3, 4],
      [-2, 8],
    ];
    const ri = Math.ceil(r);
    for (let dy = -ri - 1; dy <= ri + 1; dy++)
      for (let dx = -ri - 1; dx <= ri + 1; dx++) {
        if (!inD(dx, dy)) continue;
        let c = ramp[3];
        if (inD(dx - 3 * k, dy + 3 * k) && (dx - 4 * k) * (dx - 4 * k) + (dy + 4 * k) * (dy + 4 * k) < 46 * k * k) c = ramp[4];
        for (const q of craters) {
          const ex = (dx - q[0] * k) / Math.max(1, q[2] * k);
          const ey = (dy - q[1] * k) / Math.max(1, q[3] * k);
          if (ex * ex + ey * ey <= 1) c = ramp[2];
        }
        if (!inD(dx - 1.5, dy + 1.5)) c = ramp[2];
        if (!inD(dx - 0.7, dy + 0.7) && dx < 0 && dy > 0) c = ramp[1];
        im.set(mx + dx, my + dy, c);
      }
    if (r >= 10) for (const q of dark) im.set(mx + Math.round(q[0] * k), my + Math.round(q[1] * k), ramp[1]);
    im.set(mx + Math.round(-3 * k), my + Math.round(-2 * k), ramp[4]);
    im.set(mx + Math.round(6 * k), my + Math.round(5 * k), ramp[4]);
  }
  /**
   * A crescent: the shadow disc sits offset by (sx, sy) * r; the dark limb
   * barely shows (earthshine); the lit limb faces away from the offset.
   */
  function paintCrescent(im, mx, my, r, sx, sy, ramp) {
    const rr = r * r + r * 0.6;
    const inD = (dx, dy) => dx * dx + dy * dy <= rr;
    const ox = sx * r;
    const oy = sy * r;
    const inS = (dx, dy) => (dx - ox) * (dx - ox) + (dy - oy) * (dy - oy) <= rr * 0.98;
    const nx = -Math.sign(sx) || 1; // outward toward the lit limb
    const ny = -Math.sign(sy) || 1;
    for (let dy = -r - 1; dy <= r + 1; dy++)
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        if (!inD(dx, dy)) continue;
        const x = mx + dx;
        const y = my + dy;
        if (inS(dx, dy)) {
          im.mixAt(x, y, ramp[1], 0.2);
          continue;
        }
        let c = ramp[3];
        if (!inD(dx + nx * 1.2, dy + ny * 0.6) || !inD(dx + nx * 0.6, dy + ny * 1.2)) c = ramp[4];
        else if (inS(dx - nx * 1.3, dy - ny * 0.8)) c = ramp[2];
        im.set(x, y, c);
      }
    const k = r / 14;
    im.set(mx + Math.round(nx * 6 * k), my + Math.round(ny * 4 * k), ramp[2]);
    im.set(mx + Math.round(nx * 7 * k), my + Math.round(ny * 3 * k), ramp[2]);
  }

  // ------------------------------------------------------------------
  // Looks: the per-edition colour script. Light mode, sky type, moon and
  // stars come from the edition; this table picks the colours.
  // ------------------------------------------------------------------
  const NE = [26, 52, 78, 102, 124, 146, 168]; // night band edges
  const WINTER_DECK = {
    top: mix(mix(V[5], P.stone[6], 0.5), V[1], 0.42),
    hor: mix(mix(V[5], P.stone[6], 0.6), P.snow[4], 0.2),
    belly: mix(V[2], N[2], 0.35),
  };
  const WINTER_GLOW = mix(mix(P.snow[5], V[6], 0.3), AM[4], 0.12);
  const DAY_SUN = { core: '#fffef4', rim: '#fff3bf', glow: '#fff8de' };
  const LOOKS = {
    // ---- nights (rich and cold; warm only where the city glows) ----
    diwali: {
      // new-moon indigo, the horizon warmed by thousands of little lamps
      bands: [mix(N[0], N[1], 0.5), mix(N[1], V[0], 0.5), mix(N[2], V[1], 0.5), mix(N[3], V[2], 0.5), mix(N[3], V[3], 0.5), mix(V[3], AM[1], 0.2), mix(V[4], AM[2], 0.24), mix(V[4], AM[2], 0.36)],
      edges: NE,
    },
    rainy: {
      // the classic Rainy Hollow overcast
      bands: [N[1], mix(N[1], N[2], 0.5), N[2], mix(N[3], V[1], 0.5), mix(N[4], V[2], 0.5), mix(N[4], V[3], 0.6), mix(N[5], V[4], 0.5), mix(N[6], V[4], 0.55)],
      edges: NE,
    },
    snowdeck: {
      // a heavy lilac snow sky, softly lit from below by the city
      bands: [13, 39, 65, 90, 113, 135, 157, 187].map((cy) => {
        const d = Math.min(1, Math.max(0, (cy - 20) / 150));
        return mix(mix(WINTER_DECK.top, WINTER_DECK.hor, Math.pow(d, 0.85)), WINTER_GLOW, 0.1 + 0.24 * d * d);
      }),
      edges: NE,
    },
    newyear: {
      // crisp, deep navy midnight
      bands: [N[0], N[1], mix(N[1], N[2], 0.6), N[2], mix(N[3], V[1], 0.3), mix(N[4], V[2], 0.3), mix(N[5], V[3], 0.3), mix(mix(N[6], V[3], 0.3), AM[2], 0.08)],
      edges: NE,
    },
    lunar: {
      // a clear frosty night, a faint rosy glow of lanterns on the horizon
      bands: [N[1], mix(N[1], N[2], 0.5), N[2], mix(N[3], V[1], 0.35), mix(N[4], V[2], 0.35), mix(mix(N[4], V[3], 0.45), P.red[2], 0.2), mix(N[5], P.red[2], 0.38), mix(N[6], P.red[3], 0.42)],
      edges: NE,
    },
    match: {
      // a warm summer night, a little amber where the streets light the haze
      bands: [N[1], mix(N[1], N[2], 0.5), N[2], mix(N[3], V[1], 0.3), mix(N[4], V[2], 0.32), mix(N[5], V[3], 0.3), mix(mix(N[6], V[3], 0.35), AM[2], 0.14), mix(mix(N[6], V[4], 0.35), AM[3], 0.2)],
      edges: NE,
    },
    nyc: {
      // the big city: a deep blue-violet sky over a purple sodium glow
      stops: [[0, '#070a1c'], [40, '#0e1232'], [80, '#151a46'], [112, '#1d1c4b'], [140, '#2a2252'], [166, '#3b2a58'], [190, '#4a3159'], [206, '#553659']],
      n: 10,
      pow: 0.85,
      seam: 5,
    },
    // ---- dusks: twilight into rose and peach, the afterglow on the left ----
    midsummer: {
      // the shortest night: a long blue twilight over a thin rose-peach horizon
      stops: [[0, '#17204a'], [34, '#24336b'], [60, '#394582'], [82, '#5b538c'], [102, '#8a6290'], [122, '#b8718c'], [144, '#dc8e86'], [168, '#eeaa82'], [206, '#f6c58c']],
      n: 15,
      pow: 0.82,
      seam: 4,
      after: '#ffb97e',
    },
    dc: {
      // a warm Virginia evening: deep blue, violet, rose, a peach glow
      stops: [[0, '#0f1328'], [40, '#1b2140'], [82, '#2d2a55'], [112, '#423768'], [142, '#764a74'], [170, '#b5676c'], [196, '#e49c60'], [206, '#eeae6c']],
      n: 15,
      pow: 0.82,
      seam: 4,
      after: '#ffb066',
    },
    home: {
      // late August: the summer sky turning pink
      stops: [[0, '#292d5e'], [36, '#3b3a77'], [70, '#5b4789'], [98, '#865492'], [122, '#b0618f'], [146, '#d4718b'], [168, '#eb8c86'], [188, '#f6a987'], [206, '#f9bf8c']],
      n: 15,
      pow: 0.82,
      seam: 4,
      after: '#ffb488',
    },
    // ---- golden hour: amber-peach, the low sun on the right ----
    golden: {
      stops: [[0, '#7184b6'], [38, '#8892be'], [74, '#aa9fc2'], [106, '#cfa9b5'], [134, '#e8b69f'], [160, '#f4c28d'], [186, '#f9d08a'], [206, '#fbda95']],
      n: 15,
      pow: 0.88,
      seam: 4,
    },
    // ---- days: deep blue overhead, pale at the horizon ----
    easter: {
      // a fresh spring morning in Boston
      stops: [[0, '#2a69bb'], [40, '#377dca'], [82, '#4f95d6'], [118, '#6eabe0'], [148, '#94c3ea'], [176, '#b9d8f1'], [206, '#d5e8f5']],
      n: 15,
      pow: 0.92,
      seam: 4,
    },
    la: {
      // a hot dry afternoon: hard blue above, a pale smog haze at the horizon
      stops: [[0, '#3976c8'], [45, '#518ed5'], [90, '#71a9e2'], [126, '#95bfe8'], [152, '#b2cfea'], [176, '#cfdce3'], [196, '#e2e1d8'], [206, '#e9e2cf']],
      n: 15,
      pow: 0.92,
      seam: 4,
    },
    sandiego: {
      // a bright marine blue, very pale over the bay
      stops: [[0, '#2a71c3'], [50, '#3d88d3'], [96, '#55a1df'], [132, '#86c0ea'], [162, '#b8def4'], [190, '#d5ecf8'], [206, '#e1f1f7']],
      n: 15,
      pow: 0.92,
      seam: 4,
    },
  };
  function lookOf(ed) {
    const m = lightOf(ed).mode;
    if (m === 'day') return LOOKS[ed.id] || LOOKS.easter;
    if (m === 'golden') return LOOKS.golden;
    if (m === 'dusk') return LOOKS[ed.id] || LOOKS.midsummer;
    if (ed.sky === 'overcast') return ed.weather && ed.weather.snow >= 0.5 ? LOOKS.snowdeck : LOOKS.rainy;
    return LOOKS[ed.id] || LOOKS.match;
  }

  // where the moon sits per place (open sky upper right, clear of the towers)
  const MOON_AT = { apt1: [410, 40], apt2: [420, 32], soho: [404, 38], bhills: [404, 36], marina: [404, 36], herndon: [326, 38] };
  // the pale harvest moon rises low in the east (left) at golden hour
  const HARVEST_AT = { apt1: [66, 86], apt2: [84, 88] };
  // a young crescent hangs low in the west (left) in the afterglow
  const DUSK_CRESCENT_AT = { apt1: [124, 86], apt2: [104, 88] };
  function moonOf(ed) {
    const kind = ed.moon;
    if (!kind || kind === 'none') return null;
    const pl = placeOf(ed);
    const m = lightOf(ed).mode;
    if (kind === 'harvest' && (m === 'golden' || m === 'day')) {
      const a = HARVEST_AT[pl.id] || [72, 94];
      return { x: a[0], y: a[1], r: 14, kind, pale: true };
    }
    if (kind === 'crescent' && m === 'dusk') {
      const a = DUSK_CRESCENT_AT[pl.id] || [120, 88];
      return { x: a[0], y: a[1], r: 8, kind, low: true };
    }
    const a = MOON_AT[pl.id] || [404, 40];
    const r = pl.id === 'herndon' ? 9 : kind === 'harvest' ? 16 : kind === 'crescent' ? 10 : 12;
    return { x: a[0], y: a[1], r, kind };
  }
  function sunOf(ed) {
    const lt = lightOf(ed);
    if (!lt.sun || (lt.mode !== 'day' && lt.mode !== 'golden')) return null;
    return { x: lt.sun.x, y: lt.sun.y, r: lt.mode === 'golden' ? 9 : 6, golden: lt.mode === 'golden' };
  }

  // ------------------------------------------------------------------
  // Stars: clusters + scattered, a few twinkle per frame
  // ------------------------------------------------------------------
  function genStars(ed, im, moon, mode) {
    const dens = ed.stars || 0;
    const tw = [];
    if (dens <= 0 || mode === 'day' || mode === 'golden') return tw;
    const pl = placeOf(ed);
    const rng = HD.rng(idSeed(ed.id) ^ 0x51a2);
    const clusters = [];
    for (let i = 0; i < 11; i++) clusters.push([16 + rng() * 448, 10 + rng() * 100, 9 + rng() * 16]);
    const occ = new Uint8Array(W * HOR);
    const free = (x, y, sp) => {
      for (let yy = y - sp; yy <= y + sp; yy++)
        for (let xx = x - sp; xx <= x + sp; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < HOR && occ[yy * W + xx]) return false;
      return true;
    };
    const dusk = mode === 'dusk';
    const want = Math.round(dens * (dusk ? 120 : 230));
    let made = 0;
    for (let k = 0; k < want * 8 && made < want; k++) {
      let x;
      let y;
      const r0 = rng();
      if (r0 < 0.62) {
        const c = clusters[(rng() * clusters.length) | 0];
        const gs = () => (rng() + rng() + rng() - 1.5) * 1.2;
        x = c[0] + gs() * c[2];
        y = c[1] + gs() * c[2] * 0.7;
      } else {
        x = rng() * W;
        y = Math.pow(rng(), 1.3) * 150;
      }
      x = Math.round(x);
      y = Math.round(y);
      if (x < 2 || x >= W - 2 || y < 2 || y > 150) continue;
      if (y > 92 && rng() < (y - 92) / 44) continue; // the horizon glow swallows the faint ones
      if (dusk && y > 12 + rng() * 56) continue; // twilight: only the first stars, high up
      if (y > openTop(pl, x) - 5 || y > openTop(pl, x - 1) - 5 || y > openTop(pl, x + 1) - 5) continue; // never a "roof light"
      if (x >= TS.x0 && x <= TS.x1 && y >= TS.y0 && y <= TS.y1 && rng() < 0.72) continue; // a calm title corner
      if (moon) {
        const dx = x - moon.x;
        const dy = y - moon.y;
        if (dx * dx + dy * dy < (moon.r + 12) * (moon.r + 12)) continue;
      }
      const rc = rng();
      let cls = rc < 0.62 ? 0 : rc < 0.9 ? 1 : rc < 0.978 ? 2 : 3;
      if (x >= TS.x0 - 3 && x <= TS.x1 + 3 && y >= TS.y0 - 3 && y <= TS.y1 + 3) cls = Math.min(cls, rc < 0.8 ? 0 : 1); // only faint ones behind a title
      if (!free(x, y, cls >= 2 ? 3 : 1)) continue;
      occ[y * W + x] = 1;
      made++;
      const tint = rng();
      const band = im.get(x, y);
      const base = rgb(tint < 0.18 ? mix(P.moon[3], AM[7], 0.4) : tint > 0.84 ? mix(P.moon[2], P.spirit[3], 0.35) : P.moon[2]);
      const kk = dusk ? 0.75 : 1;
      const s = {
        x,
        y,
        cls,
        per: 5 + rng() * 10,
        seed: (rng() * 1e6) | 0,
        c0: css(lerp3(band, base, 0.34 * kk)),
        c1: css(lerp3(band, base, 0.62 * kk)),
        c2: css(lerp3(band, rgb(P.moon[4]), 0.92 * kk)),
        arm: css(lerp3(band, base, 0.36 * kk)),
        arm2: css(lerp3(band, base, 0.16 * kk)),
      };
      const twinkles = rng() < (cls === 0 ? 0.08 : cls === 1 ? 0.4 : 0.85);
      if (twinkles) {
        tw.push(s);
        if (cls >= 2) im.set(x, y, s.c1); // the steady core stays in the bake
        continue;
      }
      if (cls === 0) im.set(x, y, s.c0);
      else if (cls === 1) im.set(x, y, s.c1);
      else {
        im.set(x, y, s.c2);
        im.set(x - 1, y, s.arm);
        im.set(x + 1, y, s.arm);
        im.set(x, y - 1, s.arm);
        im.set(x, y + 1, s.arm);
      }
    }
    return tw;
  }
  function drawTwinkles(g, t, list) {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const v = T.noise(t, s.per, s.seed);
      if (s.cls === 0) {
        if (v > 0.32) g.px(s.x, s.y, s.c0);
      } else if (s.cls === 1) {
        g.px(s.x, s.y, v < 0.3 ? s.c0 : v < 0.72 ? s.c1 : s.c2);
      } else {
        g.px(s.x, s.y, v < 0.28 ? s.c1 : s.c2);
        if (v > (s.cls === 3 ? 0.22 : 0.48)) {
          g.px(s.x - 1, s.y, s.arm);
          g.px(s.x + 1, s.y, s.arm);
          g.px(s.x, s.y - 1, s.arm);
          g.px(s.x, s.y + 1, s.arm);
        }
        if (s.cls === 3 && v > 0.68) {
          g.px(s.x - 2, s.y, s.arm2);
          g.px(s.x + 2, s.y, s.arm2);
          g.px(s.x, s.y - 2, s.arm2);
          g.px(s.x, s.y + 2, s.arm2);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // the sky bake
  // ------------------------------------------------------------------
  function paintSunInto(im, s) {
    const core = rgb(s.golden ? '#fff4d2' : DAY_SUN.core);
    const rim = rgb(s.golden ? '#ffd98e' : DAY_SUN.rim);
    const r = s.r;
    const rr = r * r + r * 0.6;
    const r2 = (r + 1) * (r + 1) + (r + 1) * 0.6;
    const ri = Math.ceil(r) + 3;
    for (let dy = -ri; dy <= ri; dy++)
      for (let dx = -ri; dx <= ri; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= rr) im.set(s.x + dx, s.y + dy, core);
        else if (d2 <= r2) im.set(s.x + dx, s.y + dy, rim);
        else if (d2 <= (r + 2.4) * (r + 2.4) && bayer(s.x + dx, s.y + dy) < 0.5) im.mixAt(s.x + dx, s.y + dy, rim, 0.6);
      }
  }

  function paintMoonInto(im, m, mode) {
    if (m.pale) {
      // a daytime moon: pale cream, the maria tinted by the sky behind it
      const sky = im.get(m.x, m.y);
      const cream = rgb('#fff9ee');
      const ramp = [0.42, 0.56, 0.7, 0.84, 0.94].map((k) => lerp3(sky, cream, k));
      paintGlow(im, { x: m.x, y: m.y, rx: m.r + 9, ry: m.r + 9, c: '#fff4e6', k: [[0.72, 0.1], [1, 0.05]], dpx: 3 });
      paintMoon(im, m.x, m.y, m.r, ramp);
      return;
    }
    const dusk = mode === 'dusk';
    const s = m.r / 16;
    if (m.kind === 'harvest') {
      paintGlow(im, { x: m.x, y: m.y, rx: 84 * s, ry: 84 * s, c: mix(AM[4], V[5], 0.3), k: [[30 / 84, 0.26], [40 / 84, 0.16], [56 / 84, 0.09], [1, 0.04]], dpx: 5 });
      paintMoon(im, m.x, m.y, m.r, [mix(AM[2], V[4], 0.35), mix(AM[3], AM[4], 0.55), mix(AM[5], AM[4], 0.35), mix(AM[6], AM[5], 0.3), mix(AM[7], AM[6], 0.35)]);
      return;
    }
    const ramp = P.moon;
    if (m.kind === 'crescent') {
      const R = m.low ? 3.2 : 3;
      paintGlow(im, { x: m.x, y: m.y, rx: m.r * R, ry: m.r * R, c: m.low ? '#ffe6cc' : ramp[0], k: [[0.45, dusk ? 0.1 : 0.12], [0.67, dusk ? 0.06 : 0.065], [1, 0.03]], dpx: 4 });
      if (m.low) paintCrescent(im, m.x, m.y, m.r, 0.42, -0.3, [mix(ramp[1], '#f0b090', 0.3), mix(ramp[1], '#f6c8a8', 0.3), mix(ramp[2], '#fbe0c8', 0.3), mix(ramp[3], '#fff0dc', 0.25), '#fffaf0']);
      else paintCrescent(im, m.x, m.y, m.r, -0.46, -0.25, ramp);
      return;
    }
    // full moon
    const R = 64 * s;
    paintGlow(im, { x: m.x, y: m.y, rx: R, ry: R, c: ramp[0], k: [[23 / 64, dusk ? 0.16 : 0.22], [31 / 64, dusk ? 0.1 : 0.14], [44 / 64, dusk ? 0.05 : 0.08], [1, dusk ? 0.02 : 0.035]], dpx: 5 });
    paintMoon(im, m.x, m.y, m.r, ramp);
  }

  let baking = null; // the gradient being baked (HD.sky.at answers from it meanwhile)
  function bakeSky(ed) {
    try {
      return bakeSkyInner(ed);
    } finally {
      baking = null;
    }
  }
  function bakeSkyInner(ed) {
    const lt = lightOf(ed);
    const mode = lt.mode;
    const lk = lookOf(ed);
    const G = gradOf(lk);
    baking = G;
    const im = new Img(W, H);
    const cols = G.cols;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) im.set(x, y, cols[bandIdx(x, y, G)]);
    const moon = moonOf(ed);
    const sun = sunOf(ed);
    if (mode === 'day' && sun) {
      // the sky whitens around the sun
      paintGlow(im, { x: sun.x, y: sun.y, rx: 64, ry: 60, c: DAY_SUN.glow, k: [[0.15, 0.62], [0.24, 0.4], [0.36, 0.24], [0.54, 0.12], [0.78, 0.05], [1, 0.02]], dpx: 5 });
    }
    if (mode === 'golden' && sun) {
      // a wide amber bloom around the low sun, a cooler lavender east
      paintGlow(im, { x: -40, y: 150, rx: 300, ry: 150, c: '#9d93c0', k: [[0.55, 0.16], [0.8, 0.09], [1, 0.04]], dpx: 10 });
      paintGlow(im, { x: sun.x, y: sun.y, rx: 250, ry: 150, c: '#ffd88c', k: [[0.12, 0.62], [0.22, 0.44], [0.34, 0.3], [0.5, 0.19], [0.7, 0.1], [1, 0.04]], dpx: 9 });
      paintGlow(im, { x: sun.x, y: sun.y, rx: 44, ry: 40, c: '#fff1c4', k: [[0.4, 0.6], [0.62, 0.38], [0.85, 0.2], [1, 0.08]], dpx: 5 });
    }
    if (mode === 'dusk') {
      // the afterglow where the sun has just set (lower left)
      const s = lt.sun || { x: 40, y: 196 };
      paintGlow(im, { x: s.x, y: s.y + 26, rx: 300, ry: 120, c: lk.after || '#ffb47e', k: [[0.32, 0.36], [0.5, 0.25], [0.68, 0.15], [0.86, 0.07], [1, 0.03]], dpx: 8 });
    }
    if (moon) paintMoonInto(im, moon, mode);
    if (sun) paintSunInto(im, sun);
    const twinkles = genStars(ed, im, moon, mode);
    return { im, cv: im.canvas(), twinkles, moon, sun, shoot: shootPath(ed, moon) };
  }
  const skyArt = HD.perEdition(bakeSky);

  // ------------------------------------------------------------------
  // the sun's sparkle (per frame): soft rays turning slowly on a ring
  // ------------------------------------------------------------------
  let sunRing = null;
  function drawSun(g, t, art) {
    const s = art.sun;
    if (!s) return;
    const key = s.x + ',' + s.y + ',' + s.r;
    if (!sunRing || sunRing.key !== key) {
      const pts = [];
      const R = s.r + 3.6;
      for (let dy = -Math.ceil(R) - 1; dy <= Math.ceil(R) + 1; dy++)
        for (let dx = -Math.ceil(R) - 1; dx <= Math.ceil(R) + 1; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R - 0.7 && d <= R + 0.7) pts.push([s.x + dx, s.y + dy, Math.atan2(dy, dx) / (Math.PI * 2) + 1]);
        }
      sunRing = { key, pts };
    }
    const c = s.golden ? '#fff0c0' : '#fffbe8';
    const ph = T.phase(t, 24);
    for (const p of sunRing.pts) {
      const a = (p[2] + ph) % 0.125;
      if (a < 0.03 && bayer(p[0], p[1]) < 0.6) g.px(p[0], p[1], c);
    }
  }

  // ------------------------------------------------------------------
  // Shooting star: once per loop, ~1 s, clear nights with stars
  // ------------------------------------------------------------------
  const SHOOT_DUR = 1.1;
  function shootPath(ed, moon) {
    if (lightOf(ed).mode !== 'night' || ed.sky !== 'clear' || !(ed.stars >= 0.5)) return null;
    const pl = placeOf(ed);
    const rng = HD.rng(idSeed(ed.id) ^ 0x3c7);
    const ok = (x, y) => y > 3 && y < openTop(pl, x) - 8 && !(x >= TS.x0 - 4 && x <= TS.x1 + 4 && y <= TS.y1 + 4) && !(moon && Math.hypot(x - moon.x, y - moon.y) < moon.r + 10);
    for (let k = 0; k < 200; k++) {
      const x = 190 + rng() * 270;
      const y = 8 + rng() * 40;
      const ang = 0.45 + rng() * 0.35; // heading down-left
      const dx = -Math.cos(ang);
      const dy = Math.sin(ang);
      const len = 40 + rng() * 16;
      let good = true;
      for (let s = -12; s <= len; s += 2) if (!ok(x + dx * s, y + dy * s)) good = false;
      if (good) return { x, y, dx, dy, len, at: 0.12 + rng() * 0.76 };
    }
    return null;
  }
  function drawShootingStar(g, t, art) {
    const sh = art.shoot;
    if (!sh) return;
    const s = (T.phase(t, HD.LOOP) - sh.at) * HD.LOOP;
    if (s < 0 || s > SHOOT_DUR) return;
    const u = s / SHOOT_DUR;
    const ease = 1 - (1 - u) * (1 - u);
    const hx = sh.x + sh.dx * sh.len * ease;
    const hy = sh.y + sh.dy * sh.len * ease;
    const tail = Math.round(12 * Math.min(1, u * 4) * (u > 0.75 ? 1 - (u - 0.75) * 2.4 : 1));
    const bright = u < 0.8;
    for (let k = tail; k >= 0; k--) {
      const x = Math.round(hx - sh.dx * k);
      const y = Math.round(hy - sh.dy * k);
      const band = art.im.get(x, y);
      let c;
      if (k === 0) {
        if (!bright) continue;
        c = rgb(P.moon[4]);
      } else if (k <= 2) c = lerp3(band, rgb(P.moon[3]), bright ? 0.85 : 0.5);
      else if (k <= 6) c = lerp3(band, rgb(P.moon[2]), 0.5);
      else {
        if ((k & 1) === 1) continue;
        c = lerp3(band, rgb(P.moon[1]), 0.32);
      }
      g.px(x, y, css(c));
    }
  }

  // ------------------------------------------------------------------
  // Cloud layers
  // ------------------------------------------------------------------
  // dithered radial mask (white inside), Bayer in screen space (ox, oy)
  function radialMask(w, h, cx, cy, R, soft, ox, oy, sq) {
    const im = new Img(w, h);
    const yk = sq || 1.15;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = (y - cy) * yk;
        const d = Math.sqrt(dx * dx + dy * dy) + (bayer(x + ox, y + oy) - 0.5) * soft;
        if (d < R) im.set(x, y, '#ffffff');
      }
    return im.canvas();
  }
  /** mask box for a lit level around (cx, cy), aligned to the 8 px Bayer grid */
  function litMask(cx, cy, R, soft, sq) {
    const ex = Math.ceil(R + soft / 2) + 1;
    const ey = Math.ceil(ex / (sq || 1.15)) + 1;
    const x = Math.max(0, ((cx - ex) >> 3) << 3);
    const y = Math.max(0, ((cy - ey) >> 3) << 3);
    const w = Math.min(W, cx + ex + 1) - x;
    const h = Math.min(HOR, cy + ey + 1) - y;
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h, cv: radialMask(w, h, cx - x, cy - y, R, soft, x, y, sq) };
  }
  let tmp = null;
  let tctx = null;
  function masked(ctx, tile, Ly, off, m, ox, oy) {
    const y0 = Math.max(m.y, Ly.y);
    const y1 = Math.min(m.y + m.h, Ly.y + Ly.h);
    if (y1 <= y0) return;
    const h = y1 - y0;
    if (!tmp || tmp.width < m.w || tmp.height < h) {
      tmp = HD.canvas(Math.max(m.w, tmp ? tmp.width : 0), Math.max(h, tmp ? tmp.height : 0), true);
      tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = false;
    }
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, m.w, h);
    let sx = (((off - m.x) % Ly.w) + Ly.w) % Ly.w;
    if (sx > 0) sx -= Ly.w;
    for (; sx < m.w; sx += Ly.w) tctx.drawImage(tile, sx, Ly.y - y0);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(m.cv, 0, m.y - y0);
    tctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp, 0, 0, m.w, h, m.x - (ox || 0), y0 - (oy || 0), m.w, h);
  }
  /**
   * the light overlay of a layer (all lit levels composited) depends only on
   * the layer's scroll offset, which changes a few times a second: rebuild it
   * when the offset moves, blit it every frame
   */
  function litOverlay(L, off) {
    if (!L.ov) {
      let x0 = W;
      let y0 = H;
      let x1 = 0;
      let y1 = 0;
      for (const m of L.masks) {
        x0 = Math.min(x0, m.x);
        y0 = Math.min(y0, Math.max(m.y, L.Ly.y));
        x1 = Math.max(x1, m.x + m.w);
        y1 = Math.max(y1, Math.min(m.y + m.h, L.Ly.y + L.Ly.h));
      }
      if (x1 <= x0 || y1 <= y0) return null;
      L.ov = { cv: HD.canvas(x1 - x0, y1 - y0, true), x: x0, y: y0, off: null };
    }
    const O = L.ov;
    if (O.off !== off) {
      const c = O.cv.getContext('2d');
      c.clearRect(0, 0, O.cv.width, O.cv.height);
      for (let i = 0; i < L.lit.length; i++) if (occupied(L.occ[i], L.Ly, off, L.masks[i])) masked(c, L.lit[i], L.Ly, off, L.masks[i], O.x, O.y);
      O.off = off;
    }
    return O;
  }
  /** prefix sums of tile columns holding cloud within the rows mask m covers */
  function columnOcc(Ly, m) {
    const tn = Ly.tn;
    const y0 = Math.max(m.y, Ly.y) - Ly.y;
    const y1 = Math.min(m.y + m.h, Ly.y + tn.h) - Ly.y;
    const pre = new Uint16Array(tn.w + 1);
    for (let x = 0; x < tn.w; x++) {
      let any = 0;
      for (let y = y0; y < y1 && !any; y++) if (tn.a[y * tn.w + x]) any = 1;
      pre[x + 1] = pre[x] + any;
    }
    return pre;
  }
  function occupied(pre, Ly, off, m) {
    const w = Ly.w;
    const c0 = (((m.x - off) % w) + w) % w;
    const c1 = c0 + Math.min(m.w, w);
    return c1 <= w ? pre[c1] > pre[c0] : pre[w] > pre[c0] || pre[c1 - w] > 0;
  }
  const shadePal = (pal, tgt, ks) => pal.map((c, i) => mix(c, tgt, ks[Math.min(i, ks.length - 1)]));

  // ---- night overcast (Rainy Hollow): far stratus, mid clumps, near ceiling
  function genOvNear(rng, w, h) {
    const tn = new Tones(w, h);
    const mass = [];
    for (let x = -20; x < w + 20; x += 20 + rng() * 12) mass.push([x, 1 + rng() * 4, 18 + rng() * 10, 9 + rng() * 4, undefined, rng() < 0.35]);
    nightCloud(tn, mass, false, 3);
    const groups = [];
    for (let i = 0; i < 9; i++) {
      const gx = (i + rng() * 0.6) * (w / 9);
      const deep = rng() < 0.4;
      const g = [];
      const n = 2 + Math.floor(rng() * 3);
      for (let j = 0; j < n; j++) {
        const ry = 3 + rng() * (deep ? 5 : 3);
        g.push([gx + j * (7 + rng() * 6), 12 + rng() * 5 + (deep ? 6 : 0) - ry * 0.3, ry * (1.5 + rng() * 0.8), ry, undefined, j > 0]);
      }
      groups.push(g);
    }
    groups.sort((a, b) => a[0][1] - b[0][1]);
    for (const g of groups) nightCloud(tn, g, true, 2);
    tidy(tn, 2, 4);
    return tn;
  }
  function genOvMid(rng, w, h) {
    const tn = new Tones(w, h);
    const clumps = [
      [20, 96, 44],
      [175, 64, 72],
      [300, 112, 50],
      [458, 80, 80],
    ];
    for (const c of clumps) {
      const x0 = c[0] + rng() * 20;
      const cw = c[1];
      const yb = c[2];
      const back = [];
      const nb = Math.max(3, Math.round(cw / 16));
      for (let i = 0; i < nb; i++) {
        const u = (i + 0.5) / nb;
        const hump = Math.sin(Math.PI * u);
        const ry = 3 + hump * 5 + rng() * 2;
        back.push([x0 + cw * (0.1 + 0.75 * u), yb - 7 - hump * 7 - rng() * 3, ry * 1.7, ry, yb - 4, false]);
      }
      nightCloud(tn, back, true, 2);
      const body = [];
      const n = Math.max(4, Math.round(cw / 12));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const hump = Math.sin(Math.PI * Math.pow(u, 0.8));
        const ry = 3 + hump * 7 + rng() * 2.5;
        body.push([x0 + u * cw + (rng() - 0.5) * 5, yb - ry * 0.55 - rng() * 2, ry * (1.3 + rng() * 0.5), ry, yb + (rng() < 0.3 ? 2 : 0), rng() < 0.4]);
      }
      nightCloud(tn, body, true, 3);
      const sx = x0 + (rng() < 0.5 ? cw * 0.8 : -cw * 0.15) + rng() * 8;
      nightCloud(tn, [[sx, yb + 1, 14 + rng() * 12, 2, yb + 1, false]], true, 1);
    }
    tidy(tn, 2, 4);
    return tn;
  }
  function genOvFar(rng, w, h) {
    const tn = new Tones(w, h);
    const rows = [
      [10, [1.5, 2.5], [14, 30], 6],
      [24, [2.5, 4], [22, 40], 7],
      [36, [3, 5], [26, 46], 6],
      [50, [3, 5], [30, 50], 6],
    ];
    for (const r of rows) {
      for (let i = 0; i < r[3]; i++) {
        const cx = (i + rng() * 0.7) * (w / r[3]);
        const ry = r[1][0] + rng() * (r[1][1] - r[1][0]);
        const rx = r[2][0] + rng() * (r[2][1] - r[2][0]);
        const base = Math.round(r[0] + rng() * 4);
        const bank = [[cx, base - ry * 0.4, rx, ry, base, false]];
        if (ry > 2.6) {
          const nl = 1 + Math.floor(rng() * 3);
          for (let j = 0; j < nl; j++) {
            const lr = ry * (0.7 + rng() * 0.6);
            bank.push([cx + (rng() - 0.5) * rx, base - ry * 0.6 - lr * 0.5, lr * (1.6 + rng()), lr, base, true]);
          }
        }
        nightCloud(tn, bank, true, 2);
      }
    }
    tidy(tn, 2, 4);
    return tn;
  }
  let ovGeo = null;
  function overcastGeo() {
    if (ovGeo) return ovGeo;
    const rng = HD.rng(7331);
    const s = () => HD.rng(Math.floor(rng() * 1e9));
    const far = { y: 100, w: 480, h: 64, k: 1, sub: 0 };
    const mid = { y: 30, w: 600, h: 90, k: 1, sub: 0.5 };
    const near = { y: 0, w: 480, h: 50, k: 2, sub: 0.25 };
    far.tn = genOvFar(s(), far.w, far.h);
    mid.tn = genOvMid(s(), mid.w, mid.h);
    near.tn = genOvNear(s(), near.w, near.h);
    ovGeo = { far, mid, near };
    return ovGeo;
  }
  const OV_PAL = {
    far: [mix(N[3], V[2], 0.55), mix(N[4], V[2], 0.55), mix(N[4], V[3], 0.6), mix(N[5], V[4], 0.55)],
    mid: [mix(N[2], N[3], 0.4), mix(N[3], V[2], 0.3), mix(N[4], V[2], 0.35), mix(N[5], V[3], 0.35)],
    near: [mix(N[1], N[2], 0.35), mix(N[2], V[1], 0.3), mix(N[3], V[1], 0.35), mix(N[3], V[2], 0.45)],
  };

  // ---- the snow deck (overcast + snow): heavy undulating masses, no outlines
  function deckMass(tn, puffs, tb, bd, hang) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of puffs) {
      x0 = Math.min(x0, Math.floor(p[0] - p[2] - 1));
      x1 = Math.max(x1, Math.ceil(p[0] + p[2] + 1));
      y0 = Math.min(y0, Math.floor(p[1] - p[3] - 1));
      y1 = Math.max(y1, Math.ceil(p[1] + p[3] + 1));
    }
    if (hang) y0 = 0;
    y0 = Math.max(y0, 0);
    y1 = Math.min(y1, tn.h - 1);
    const inM = (x, y) => {
      for (const p of puffs) {
        const dx = (x - p[0]) / p[2];
        const dy = (y - p[1]) / p[3];
        if (dx * dx + (hang && dy < 0 ? 0 : dy * dy) <= 1) return true;
      }
      return false;
    };
    for (let x = x0; x <= x1; x++) {
      let d = -1;
      for (let y = y1; y >= y0; y--) {
        if (!inM(x, y)) {
          d = -1;
          continue;
        }
        d++;
        const q = d / bd + (bayer(x, y) - 0.5) * 0.4;
        tn.put(x, y, tb + (q < 0.34 ? 1 : q < 1 ? 2 : 3));
      }
    }
  }
  function genDeck(seed, w, h, rows) {
    const tn = new Tones(w, h);
    const hs = (a, b, c) => HD.hash(seed, a, b, c);
    const masses = [];
    rows.forEach((r, ri) => {
      let x = hs(ri, 0, 1) * 60;
      const xEnd = x + w;
      for (let i = 0; x < xEnd; i++) {
        const rx = r.rx[0] + hs(ri, i, 2) * (r.rx[1] - r.rx[0]);
        const ry = r.ry[0] + hs(ri, i, 3) * (r.ry[1] - r.ry[0]);
        const yb = r.y + (hs(ri, i, 4) - 0.5) * 12;
        const cx = x + rx;
        const n = 3 + Math.floor(hs(ri, i, 5) * 3);
        const puffs = [];
        for (let j = 0; j < n; j++) {
          const u = j / (n - 1);
          const hump = 0.5 + 0.5 * Math.sin(Math.PI * (0.08 + 0.84 * u));
          const pr = ry * hump * (0.75 + 0.45 * hs(ri, i, 10 + j));
          const px = cx + (u - 0.5) * rx * 1.35 + (hs(ri, i, 20 + j) - 0.5) * 10;
          const prx = rx * (0.3 + 0.24 * hs(ri, i, 30 + j));
          const sag = (hs(ri, i, 40 + j) - 0.35) * ry * 0.7;
          puffs.push([px, yb - pr + sag, prx, pr]);
        }
        masses.push({ yb, puffs, tb: ri * 3, bd: r.belly, hang: !!r.ceiling });
        x += 2 * rx * (r.step[0] + hs(ri, i, 6) * (r.step[1] - r.step[0]));
      }
    });
    masses.sort((a, b) => b.yb - a.yb);
    for (const m of masses) deckMass(tn, m.puffs, m.tb, m.bd, m.hang);
    return tn;
  }
  const DECK_ROWS = {
    near: [
      { y: 21, rx: [60, 90], ry: [14, 18], step: [0.42, 0.62], belly: 8, depth: 0, ceiling: true },
      { y: 37, rx: [52, 90], ry: [10, 14], step: [0.48, 0.72], belly: 7, depth: 0.1 },
      { y: 54, rx: [46, 84], ry: [8, 12], step: [0.5, 0.8], belly: 6, depth: 0.2 },
    ],
    mid: [
      { y: 70, rx: [44, 84], ry: [8, 11], step: [0.5, 0.8], belly: 6, depth: 0.3 },
      { y: 87, rx: [42, 78], ry: [7, 10], step: [0.55, 0.9], belly: 5, depth: 0.42 },
      { y: 103, rx: [40, 70], ry: [6, 8], step: [0.6, 1.0], belly: 4, depth: 0.54 },
      { y: 118, rx: [34, 60], ry: [5, 7], step: [0.7, 1.15], belly: 3, depth: 0.66 },
      { y: 132, rx: [28, 50], ry: [4, 6], step: [0.8, 1.35], belly: 3, depth: 0.78 },
      { y: 145, rx: [22, 40], ry: [3, 4], step: [1.0, 1.7], belly: 2, depth: 0.89 },
      { y: 157, rx: [18, 34], ry: [2, 3], step: [1.1, 1.9], belly: 2, depth: 1 },
    ],
  };
  let deckGeo = null;
  function deckLayers() {
    if (deckGeo) return deckGeo;
    const local = (rows, y0) => rows.map((r) => Object.assign({}, r, { y: r.y - y0 }));
    deckGeo = {
      near: { y: 0, w: 480, h: 70, k: 2, sub: 0.25, rows: DECK_ROWS.near, tn: genDeck(7717, 480, 70, local(DECK_ROWS.near, 0)) },
      mid: { y: 28, w: 600, h: 140, k: 1, sub: 0.5, rows: DECK_ROWS.mid, tn: genDeck(9151, 600, 140, local(DECK_ROWS.mid, 28)) },
    };
    return deckGeo;
  }
  function deckPalette(rows, dk) {
    const pal = [];
    for (const r of rows) {
      const body = mix(dk.top, dk.hor, Math.pow(r.depth, 0.85));
      pal.push(mix(body, dk.belly, 0.46 + 0.16 * r.depth), mix(body, dk.belly, 0.2 + 0.1 * r.depth), body);
    }
    return pal;
  }

  // ---- daylight and golden-hour cumulus, dusk streaks
  /** palettes [belly, shade, body, lit, rim] per light mode */
  const CU_PAL = {
    day: ['#8aa1c2', '#a9bdd7', '#cfdcec', '#e9f0f8', '#ffffff'],
    golden: ['#7d6a93', '#a1809f', '#cf979a', '#f2b384', '#ffdb96'],
    dusk: ['#3b3366', '#584478', '#7c5584', '#d47f88', '#f8b68a'],
    night: [mix(N[1], N[2], 0.4), mix(N[2], V[1], 0.3), mix(N[3], V[1], 0.35), mix(N[4], V[2], 0.4), mix(N[5], V[3], 0.4)],
  };
  /** the light clouds are shaded with: [x, y, z] toward the light (z = toward the viewer) */
  const norm3 = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const CLOUD_LIGHT = {
    day: { L: norm3([0.32, -0.85, 0.42]), t: [-0.34, 0.02, 0.4, 0.68], vert: 0.4, flatBase: true },
    golden: { side: [1, 0.55], litW: 2, shW: 3 },
    dusk: { side: [-0.45, 1], litW: 1, shW: 2 },
    night: { L: norm3([0.4, -0.7, 0.55]), vert: 0.3, flatBase: true },
  };
  /** a cloud field for one layer: specs [cx, yb, cw, ch, kind] in screen y */
  function cuLayer(specs, Ly, mode, seed) {
    const tn = new Tones(Ly.w, Ly.h);
    const rng = HD.rng(seed);
    const o = CLOUD_LIGHT[mode] || CLOUD_LIGHT.night;
    // far (high base) first, so nearer (lower base) clouds overlap them
    const sorted = specs.slice().sort((a, b) => a[1] - b[1]);
    for (const s of sorted) puffCloud(tn, cumulus(rng, s[0], s[1] - Ly.y, s[2], s[3], s[4] || 'heap'), o);
    tidy(tn, 1, 5);
    return tn;
  }
  /** cloud specs per sky type and light mode: { far, mid, near } */
  function cuSpecs(ed, mode) {
    const rng = HD.rng(idSeed(ed.id) ^ 0x7c1);
    const r = (a, b) => a + rng() * (b - a);
    const out = { far: [], mid: [], near: [] };
    const broken = ed.sky === 'broken';
    if (mode === 'golden') {
      // far: long flat banks low over the city
      for (let i = 0; i < 7; i++) out.far.push([(i + r(0, 0.6)) * (480 / 7), r(132, 154), r(44, 90), r(3, 5), 'strato']);
      // mid: broken stratocumulus, low enough to pass under the rising moon
      for (const x of [20, 110, 200, 290, 370, 450, 540]) if (broken || rng() < 0.5) out.mid.push([x + r(-14, 14), r(118, 132), r(40, 76), r(6, 10), rng() < 0.35 ? 'heap' : 'strato']);
      // high: long golden streaks on the right half only (they only sway)
      out.near.push([300, 36, 84, 4, 'strato'], [398, 22, 62, 3.2, 'strato'], [436, 60, 70, 4.5, 'strato'], [262, 62, 46, 3, 'strato']);
      return out;
    }
    if (mode === 'day') {
      // far: small flat cumulus over the horizon
      for (let i = 0; i < 7; i++) out.far.push([(i + r(0, 0.7)) * 69, r(132, 156), r(16, 30), r(6, 9), rng() < 0.5 ? 'heap' : 'flat']);
      // mid: fair-weather cumulus, their crowns below the title corner
      for (const x of [40, 165, 290, 410, 530]) if (broken || rng() < 0.9) out.mid.push([x + r(-16, 16), r(108, 118), r(42, 66), r(15, 20), 'heap']);
      // high: a few small ones that only sway, clear of the sun and the title corner
      out.near.push([258, 38, 46, 13, 'heap'], [336, 20, 26, 9, 'heap'], [444, 30, 22, 8, 'heap']);
      return out;
    }
    if (mode === 'dusk') {
      // thin streaks lit from below by the afterglow
      for (let i = 0; i < 8; i++) out.far.push([(i + r(0, 0.7)) * 60, r(132, 168), r(40, 86), r(2, 3.5), 'strato']);
      for (let i = 0; i < 4; i++) out.mid.push([(i + r(0, 0.6)) * 150, r(86, 112), r(36, 64), r(1.6, 2.6), 'strato']);
      return out;
    }
    // night fair / broken (no current entry; kept so every sky type works)
    for (let i = 0; i < 6; i++) out.mid.push([(i + r(0, 0.6)) * 100, r(100, 118), r(36, 60), r(10, 14), 'heap']);
    return out;
  }

  /** one drawable layer: tone map + palette + optional lit variants */
  function makeLayer(Ly, pal, lit) {
    const L = { Ly, cv: tonesToCanvas(Ly.tn, pal), pal, lit: null, masks: null, occ: null, flash: null };
    if (lit && lit.masks.length) {
      L.masks = lit.masks;
      L.lit = lit.pals.slice(0, lit.masks.length).map((pp) => tonesToCanvas(Ly.tn, pp(pal)));
      L.occ = lit.masks.map((m) => columnOcc(Ly, m));
    }
    return L;
  }
  /** the pale horizon colour clouds fade toward with distance */
  function hazeOf(ed) {
    const lk = lookOf(ed);
    if (lk.stops) return css(stopAt(lk.stops, 150));
    return lk.bands[lk.bands.length - 2];
  }

  function bakeClouds(ed) {
    const mode = lightOf(ed).mode;
    const moon = moonOf(ed);
    const sun = sunOf(ed);
    const sky = ed.sky || 'clear';
    const out = { far: null, mid: null, near: null, strikes: null };
    // moonlight on night clouds: masks + palette shifts, brightest nearest the moon
    const moonLit = (ks, tg, rr) =>
      moon && !moon.pale
        ? {
            masks: rr.map((r) => litMask(moon.x, moon.y, r[0] * (moon.r / 16), r[1])).filter(Boolean),
            pals: ks.map((k, i) => (pal) => shadePal(pal, tg[i], k)),
          }
        : null;
    if (sky === 'overcast') {
      if (ed.weather && ed.weather.snow >= 0.5) {
        const D = deckLayers();
        out.mid = makeLayer(D.mid, deckPalette(D.mid.rows, WINTER_DECK));
        out.near = makeLayer(D.near, deckPalette(D.near.rows, WINTER_DECK));
      } else {
        const G = overcastGeo();
        const lit = moonLit(
          [
            [0.05, 0.09, 0.16, 0.32],
            [0.1, 0.17, 0.3, 0.55],
            [0.2, 0.3, 0.48, 0.8],
          ],
          [P.moon[0], P.moon[0], P.moon[1]],
          [
            [64, 10],
            [40, 7],
            [22, 4],
          ]
        );
        for (const id of ['far', 'mid', 'near']) out[id] = makeLayer(G[id], OV_PAL[id], lit);
      }
    } else if (sky === 'fair' || sky === 'broken' || (sky === 'dusk' && mode === 'dusk')) {
      const specs = cuSpecs(ed, mode);
      const pal = CU_PAL[mode] || CU_PAL.night;
      const seed = idSeed(ed.id);
      const far = { y: 100, w: 480, h: 76, k: 1, sub: 0 };
      const mid = { y: 70, w: 600, h: 70, k: 1, sub: 0.5 };
      const near = { y: 0, w: 480, h: 64, k: 0, osc: 12, sub: 0 };
      let lit = null;
      if (mode === 'golden' && sun) {
        // the clouds nearest the low sun burn brightest
        lit = {
          masks: [litMask(sun.x, sun.y, 150, 22, 0.8), litMask(sun.x, sun.y, 86, 14, 0.8)].filter(Boolean),
          pals: [
            (p) => [mix(p[0], '#b7849a', 0.3), mix(p[1], '#d0909a', 0.35), mix(p[2], '#eaa58e', 0.4), mix(p[3], '#ffcf8c', 0.45), mix(p[4], '#fff0b8', 0.5)],
            (p) => [mix(p[0], '#d0909a', 0.45), mix(p[1], '#eaa58e', 0.5), mix(p[2], '#f7bd88', 0.55), mix(p[3], '#ffe0a0', 0.6), mix(p[4], '#fff8d8', 0.7)],
          ],
        };
      } else if (mode === 'night') lit = moonLit([[0.1, 0.17, 0.3, 0.55, 0.6]], [P.moon[1]], [[40, 7]]);
      const hz = hazeOf(ed);
      const hazed = (p, k) => p.map((c) => mix(c, hz, k));
      if (specs.far.length) {
        far.tn = cuLayer(specs.far, far, mode, seed ^ 0x11);
        out.far = makeLayer(far, hazed(pal, mode === 'golden' ? 0.22 : mode === 'dusk' ? 0.12 : 0.3), lit);
      }
      if (specs.mid.length) {
        mid.tn = cuLayer(specs.mid, mid, mode, seed ^ 0x22);
        out.mid = makeLayer(mid, hazed(pal, mode === 'golden' ? 0.06 : mode === 'dusk' ? 0.04 : 0.08), lit);
      }
      if (specs.near.length) {
        near.tn = cuLayer(specs.near, near, mode, seed ^ 0x33);
        out.near = makeLayer(near, pal, lit);
      }
    }
    // lightning: lit variants of every layer around each strike
    const st = strikesOf(ed, out);
    if (st) {
      out.strikes = st;
      for (const id of ['far', 'mid', 'near']) {
        const L = out[id];
        if (!L) continue;
        L.flash = st.map((s) => {
          const masks = [litMask(s.x, s.y0, 120, 24), litMask(s.x, s.y0, 64, 12)].filter(Boolean);
          return {
            masks,
            cv: [0.42, 0.68].map((k) => tonesToCanvas(L.Ly.tn, L.pal.map((c, i) => mix(c, FLASH_COL, Math.min(1, k * (0.55 + 0.15 * i)))))),
            occ: masks.map((m) => columnOcc(L.Ly, m)),
          };
        });
      }
    }
    return out;
  }
  const cloudArt = HD.perEdition(bakeClouds);

  const layerOff = (t, Ly) => {
    if (Ly.osc) return Math.round(Ly.osc * T.wave(t, HD.LOOP, 0.15));
    return Math.floor(T.phase(t, HD.LOOP / Ly.k) * Ly.w + (Ly.sub || 0) + 1e-6) % Ly.w;
  };
  function drawClouds(g, t, id) {
    const all = cloudArt();
    const L = all && all[id];
    if (!L) return;
    const ctx = g.ctx;
    const Ly = L.Ly;
    const off = layerOff(t, Ly);
    if (Ly.osc) ctx.drawImage(L.cv, off, Ly.y);
    else for (let x = off - Ly.w; x < W; x += Ly.w) ctx.drawImage(L.cv, x, Ly.y);
    if (L.lit) {
      const O = litOverlay(L, off);
      if (O) ctx.drawImage(O.cv, O.x, O.y);
    }
    if (L.flash) {
      const f = flashState(t, all.strikes);
      if (f && f.lv > 0.12) {
        const F = L.flash[f.i];
        const lv = f.lv > 0.55 ? 2 : 1;
        for (let j = 0; j < lv && j < F.masks.length; j++) if (occupied(F.occ[j], Ly, off, F.masks[j])) masked(ctx, F.cv[j], Ly, off, F.masks[j]);
      }
    }
  }

  // ------------------------------------------------------------------
  // Lightning: twice a loop a forked bolt drops from the cloud base, the
  // clouds around it light up and the whole scene flashes cold blue-white
  // ------------------------------------------------------------------
  const FLASH_COL = mix(N[10], V[6], 0.3);
  const STRIKE_AT = [0.27, 0.71];
  function strikesOf(ed, layers) {
    if (!(ed.weather && ed.weather.lightning > 0)) return null;
    const pl = placeOf(ed);
    const moon = moonOf(ed);
    const rng = HD.rng(idSeed(ed.id) ^ 0xb017);
    const mid = layers && layers.mid;
    const out = [];
    // one strike over open sky on the right, one on the left below the title corner
    const sides = [
      [326, 474, 44],
      [12, 140, TS.y1 + 6],
    ];
    STRIKE_AT.forEach((at, si) => {
      const sd = sides[si % 2];
      // where the mid clouds hang at strike time: a bolt leaves a cloud base
      const off = mid ? layerOff(at * HD.LOOP, mid.Ly) : 0;
      const baseAt = (x) => {
        if (!mid) return -1;
        const tn = mid.Ly.tn;
        const tx = x - off;
        for (let y = Math.min(tn.h - 1, 104 - mid.Ly.y); y >= sd[2] - mid.Ly.y; y--) if (tn.get(tx, y)) return y + mid.Ly.y + 1;
        return -1;
      };
      let best = null;
      let bestScore = -Infinity;
      for (let x = sd[0]; x <= sd[1]; x += 2) {
        // the open sky below must reach low, past the far towers
        let open = Infinity;
        for (let dx = -3; dx <= 3; dx++) open = Math.min(open, openTop(pl, x + dx));
        const yb = baseAt(x);
        let score = Math.min(open, 190) * 2 + (yb > 0 ? 160 - Math.abs(yb - (sd[2] + 14)) * 2 : 0) + HD.hash(x, si, 41, idSeed(ed.id)) * 40;
        if (moon && Math.abs(x - moon.x) < moon.r + 16) score -= 2000;
        if (score > bestScore) {
          bestScore = score;
          best = { x, yb, open };
        }
      }
      const x0 = best.x;
      const y0 = best.yb > 0 ? best.yb : sd[2] + Math.round(rng() * 8);
      const y1 = Math.min(204, Math.max(y0 + 30, best.open + 10));
      // the main channel: a jagged walk downward with a slight lean
      const lean = rng() < 0.5 ? -0.3 : 0.3;
      const pts = [[x0, y0]];
      let x = x0;
      let y = y0;
      while (y < y1) {
        y += 3 + Math.floor(rng() * 6);
        x += Math.round((rng() - 0.5) * 7 + lean * 3);
        pts.push([x, Math.min(y, y1)]);
      }
      // two short forks from the upper half
      const forks = [];
      for (let f = 0; f < 2; f++) {
        const k = 1 + Math.floor(rng() * Math.max(1, Math.floor(pts.length / 2)));
        const fp = [pts[Math.min(k, pts.length - 1)].slice()];
        let fx = fp[0][0];
        let fy = fp[0][1];
        const dir = f === 0 ? -1 : 1;
        const n = 2 + Math.floor(rng() * 3);
        for (let j = 0; j < n; j++) {
          fy += 3 + Math.floor(rng() * 4);
          fx += dir * (2 + Math.floor(rng() * 4));
          fp.push([fx, fy]);
        }
        forks.push(fp);
      }
      out.push({ at, x: x0, y0, y1, pts, forks });
    });
    return out;
  }
  /** strike envelope: three pulses in ~0.6 s; returns {i, lv 0..1, s} or null */
  function flashState(t, strikes) {
    if (!strikes || !HD.flag('lightning', true)) return null;
    const u = T.phase(t, HD.LOOP);
    for (let i = 0; i < strikes.length; i++) {
      const s = (u - strikes[i].at) * HD.LOOP;
      if (s < 0 || s > 0.66) continue;
      const pulse = (at, amp, dur) => {
        const q = s - at;
        return q < 0 ? 0 : amp * Math.exp(-q / dur);
      };
      const lv = Math.max(pulse(0, 1, 0.05), pulse(0.15, 0.55, 0.04), pulse(0.31, 0.85, 0.09));
      return { i, lv, s };
    }
    return null;
  }
  const BOLT = { core: '#f6f3ff', hot: '#cfc8ff', glow: mix(N[8], V[6], 0.5), fork: mix(N[10], V[6], 0.35) };
  function drawBolt(g, t) {
    const all = cloudArt();
    const st = all && all.strikes;
    const f = flashState(t, st);
    if (!f || f.lv < 0.14) return;
    const S = st[f.i];
    const strong = f.lv > 0.5;
    const pts = S.pts;
    const half = Math.ceil(pts.length * 0.55);
    // a soft cold glow beside the channel (every other pixel), only while it burns bright
    if (strong) {
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1];
        const b = pts[k];
        const n = Math.max(1, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        for (let j = 0; j <= n; j++) {
          const x = Math.round(a[0] + ((b[0] - a[0]) * j) / n);
          const y = Math.round(a[1] + ((b[1] - a[1]) * j) / n);
          if ((x + y) & 1) {
            g.px(x - 1, y, BOLT.glow);
            g.px(x + (k < half ? 2 : 1), y, BOLT.glow);
          }
        }
      }
    }
    for (const fp of S.forks) for (let k = 1; k < fp.length; k++) g.line(fp[k - 1][0], fp[k - 1][1], fp[k][0], fp[k][1], strong ? BOLT.fork : BOLT.glow);
    // the channel: two pixels wide where it leaves the cloud, one below
    const c = strong ? BOLT.core : BOLT.hot;
    for (let k = 1; k < pts.length; k++) {
      g.line(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], c);
      if (strong && k < half) g.line(pts[k - 1][0] + 1, pts[k - 1][1], pts[k][0] + 1, pts[k][1], BOLT.hot);
    }
  }
  function drawFlash(g, t) {
    const all = cloudArt();
    const f = flashState(t, all && all.strikes);
    if (!f || f.lv < 0.08) return;
    // the whole sky lifts a few steps toward cold lilac
    const k = f.lv > 0.6 ? 1 : f.lv > 0.3 ? 0.6 : 0.3;
    const ctx = g.ctx;
    ctx.globalCompositeOperation = 'lighter';
    g.reset();
    g.rect(0, 0, W, HOR, HD.color.css(30 * k, 30 * k, 52 * k));
    ctx.globalCompositeOperation = 'source-over';
    g.reset();
  }

  // ------------------------------------------------------------------
  // module
  // ------------------------------------------------------------------
  HD.module('sky', {
    lights(t, L) {
      const all = cloudArt();
      const f = flashState(t, all && all.strikes);
      if (!f || f.lv < 0.08) return;
      const S = all.strikes[f.i];
      L.add({ x: S.x, y: 20, r: 340, ry: 240, color: [0.5, 0.58, 0.95], i: 0.55 * f.lv, bands: 4, pow: 0.75, day: true });
    },
    passes: [
      {
        layer: 'bg',
        z: 0,
        id: 'sky',
        draw(g, t) {
          const art = skyArt();
          g.ctx.drawImage(art.cv, 0, 0);
          drawTwinkles(g, t, art.twinkles);
        },
      },
      { layer: 'bg', z: 1, id: 'sun', draw: (g, t) => drawSun(g, t, skyArt()) },
      { layer: 'bg', z: 2, id: 'shooting-star', draw: (g, t) => drawShootingStar(g, t, skyArt()) },
      { layer: 'bg', z: 3, id: 'clouds-far', draw: (g, t) => drawClouds(g, t, 'far') },
      { layer: 'bg', z: 4, id: 'lightning-bolt', draw: drawBolt },
      { layer: 'bg', z: 5, id: 'clouds-mid', draw: (g, t) => drawClouds(g, t, 'mid') },
      { layer: 'bg', z: 7, id: 'clouds-near', draw: (g, t) => drawClouds(g, t, 'near') },
      { layer: 'bg', z: 8, id: 'lightning-flash', draw: drawFlash },
    ],
  });

  // ------------------------------------------------------------------
  // what other modules may ask of the sky
  // ------------------------------------------------------------------
  HD.sky = {
    /** the moon disc of the current entry {x, y, r, kind} or null */
    moon: () => skyArt().moon,
    /** this entry's shooting star {x, y, dx, dy, len, at (loop fraction)} or null */
    shootingStar: () => skyArt().shoot,
    /** the visible sun disc {x, y, r} (day, golden hour) or null */
    sun: () => skyArt().sun,
    /** baked sky colour (no clouds) behind (x, y) as '#rrggbb' */
    at(x, y) {
      if (baking) return css(baking.cols[bandIdx(Math.round(x), Math.round(y), baking)]);
      return css(skyArt().im.get(x, y));
    },
    /** lightning flash level 0..1 at time t (0 most of the loop) */
    flash(t) {
      const f = flashState(t, cloudArt().strikes);
      return f ? Math.min(1, f.lv) : 0;
    },
    /** the visible lightning bolt {x, y0, y1} at t, or null */
    bolt(t) {
      const all = cloudArt();
      const f = flashState(t, all.strikes);
      if (!f || f.lv < 0.14) return null;
      const S = all.strikes[f.i];
      return { x: S.x, y0: S.y0, y1: S.y1 };
    },
  };
})();
