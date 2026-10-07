/*
 * building-marina (Purrfect Year v2): the marina hotel. Twin curved
 * mirror-glass towers of equal height on a long cream podium, a white
 * entrance canopy between them, clipped hedges with magenta bougainvillea
 * along the podium and slim fan palms. Scene layer z 25..34.
 *
 * Colours are written as the daylight colours we want to SEE and converted
 * at bake time into the engine's night palette (albedo x ambient), so the
 * daylight fill reveals them exactly and the same paint reads as cool, dim
 * glass and stone at night. Emissive pixels (lamps, lit rooms, the sun's
 * sparkle) use their true colours.
 *
 * Static art is baked once per light mode; per frame we only blit it and
 * draw the animated bits: drifting cloud reflections on the glass, a
 * window-washing gondola, a rare sun sparkle on a roof edge, swaying palms
 * and, after dark, rooms switching their lights on and off.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const T = HD.time;
  const R = Math.round;
  const clamp = HD.clamp;
  const PLACE = 'marina';
  const here = () => HD.edition && HD.edition.place === PLACE;
  const mode = () => HD.light().mode;
  const isDark = (m) => m === 'night' || m === 'dusk';

  // ------------------------------------------------------------ geometry
  const SAG = 3; // the concave facade: roof edge and floor lines bow by this much at mid-width
  const EYE = 214; // eye level (the promenade); the bow fades towards it
  const POD = { x0: 138, x1: 331, top: 184, base: 205 };
  const TOWERS = [
    // north tower (left, a touch nearer) and south tower (right, a touch further back)
    {
      k: 0, x0: 152, x1: 229, top: 33, base: 185, shift: 0,
      prof: [[0, 3.0], [0.06, 2.1], [0.2, 2.6], [0.45, 4.2], [0.72, 5.9], [0.9, 7.0], [1, 7.6]],
      glints: [[16, 20, 2.2], [23, 24.2, 2.4], [88, 93, 1.6], [96, 97.2, 2.0]],
    },
    {
      k: 1, x0: 240, x1: 317, top: 38, base: 185, shift: 0.7,
      prof: [[0, 3.0], [0.06, 2.1], [0.2, 2.6], [0.45, 4.2], [0.72, 5.9], [0.9, 7.0], [1, 7.6]],
      glints: [[30, 34, 2.0], [37, 38.2, 2.2], [104, 108, 1.4]],
    },
  ];
  const ENTRANCE = { x0: 220, x1: 252, door0: 228, door1: 244 };
  // fan palms: base (x, y), crown height, lean, size. All stand inside the
  // building footprint (x 138..332), clear of the tower edges, the corner
  // drapes and the brick castle anchor on the promenade (x 337..367).
  const PALMS = [
    { x: 141, base: 205, top: 98, lean: -3, s: 1.1, seed: 1 },
    { x: 148, base: 205, top: 136, lean: 1, s: 0.9, seed: 2 },
    { x: 178, base: 205, top: 156, lean: -1, s: 0.85, seed: 3 },
    { x: 296, base: 205, top: 160, lean: 1, s: 0.85, seed: 4 },
    { x: 321, base: 205, top: 140, lean: -1, s: 0.9, seed: 5 },
    { x: 328, base: 205, top: 102, lean: 3, s: 1.1, seed: 6 },
  ];

  // ------------------------------------------------------------ colour
  const K = [1, 1, 1];
  let kReady = false;
  function setupK() {
    const A = HD.AMBIENT;
    const F = (HD.LIGHTING && HD.LIGHTING.day && HD.LIGHTING.day.fill) || [0.72, 0.66, 0.5];
    for (let i = 0; i < 3; i++) K[i] = A[i] / (A[i] + F[i]);
    kReady = true;
  }
  const pcache = new Map();
  /** daylight display colour -> paint (night) colour */
  function P(hex) {
    if (!kReady) setupK();
    let v = pcache.get(hex);
    if (!v) {
      const c = HD.color.hex(hex);
      v = HD.color.css(c[0] * K[0], c[1] * K[1], c[2] * K[2]);
      pcache.set(hex, v);
    }
    return v;
  }
  const prCache = new Map();
  /** a whole display ramp -> paint ramp (cached per ramp) */
  function PR(a) {
    let v = prCache.get(a);
    if (!v) {
      v = a.map(P);
      prCache.set(a, v);
    }
    return v;
  }

  // display colours (daylight)
  const C = {
    glass: ['#eef8f9', '#cbe9ef', '#a6d6e2', '#86c2d4', '#6aacc3', '#5597b0', '#45829c', '#386e87', '#2d5b71', '#22485b', '#183646', '#112835'],
    cap: ['#f4f7f6', '#d6e0e2', '#aabcc2', '#7e929a', '#5b6d75'],
    pod: ['#fbf8f0', '#efe8d9', '#e3d9c4', '#cfc2a6', '#b5a789', '#958a72'],
    lobby: ['#173341', '#21475a', '#2e5c70', '#447a8e', '#6c9fb1', '#a9cfdb'],
    warm: ['#5a3e2a', '#8a6444', '#b88c5c', '#dcb67e', '#f2d6a2'],
    canopy: ['#ffffff', '#eceae4', '#cdc9c0', '#a8a39a'],
    bronze: ['#2d2a26', '#4a453e', '#6e675c'],
    leaf: ['#173f22', '#215430', '#2e6c3a', '#3f8744', '#58a24f', '#7dbc63', '#a5d27d'],
    // palm fronds, trunk and dead skirt: the same ramps as the street palms
    frond: ['#1c3418', '#24401f', '#365c2a', '#4e7a36', '#6c9a44', '#90b858', '#b4d47a'],
    palmTrunk: ['#5e5040', '#7c6c56', '#9a8a70', '#b4a68a'],
    palmDry: ['#4a3a26', '#5a4630', '#7a6040', '#9a7c50'],
    hedge: ['#1a4626', '#235a30', '#2f6f3a', '#3d8645', '#52a050', '#73b862', '#98cc7c'],
    bloom: ['#5c1238', '#8a1f52', '#b82d6c', '#da4489', '#f06aa6', '#ff9cc6'],
    trunk: ['#5d4c3e', '#7a6754', '#97836b', '#b5a184', '#cdbb9c'],
    skirt: ['#5a4228', '#7a5c36', '#9b7a4a', '#bb9a64', '#d4b884'],
    umbrella: ['#ffffff', '#e6e2da', '#3f8fa6', '#2c6f86'],
    rail: ['#e8f0f2', '#b9cbd1', '#8fb2c0'],
  };
  // emissive (true) colours
  const EM = {
    room: ['#ffd99a', '#ffc97e', '#f4b56a', '#e8a35a', '#ffe7b8', '#f7c27a'],
    roomDim: ['#c98c52', '#b87b45', '#d9a066'],
    tv: '#9fc2ff',
    lamp: ['#fff2c8', '#ffd58a', '#f0a850'],
    lobby: ['#ffe7b0', '#f6c983', '#e2a964', '#b9844c'],
    sun: ['#ffffff', '#fff6d8', '#ffe9a8'],
    gold: ['#ffd27a', '#ffb85a', '#f79a44'],
  };

  // ------------------------------------------------------------ helpers
  const sq = (v) => v * v;
  function profAt(prof, u) {
    for (let i = 1; i < prof.length; i++) {
      if (u <= prof[i][0]) {
        const a = prof[i - 1];
        const b = prof[i];
        const k = (u - a[0]) / (b[0] - a[0]);
        const s = k * k * (3 - 2 * k);
        return a[1] + (b[1] - a[1]) * s;
      }
    }
    return prof[prof.length - 1][1];
  }

  // per tower: sag, roof line, floor lines, tone map (filled at first bake)
  function geom(t) {
    if (t.w) return t;
    const w = t.x1 - t.x0 + 1;
    t.w = w;
    t.sag = (x, y) => SAG * (1 - sq((2 * (x - t.x0)) / (w - 1) - 1)) * Math.max(0, (EYE - y) / (EYE - t.top));
    t.roof = new Int16Array(w);
    for (let i = 0; i < w; i++) t.roof[i] = t.top + R(t.sag(t.x0 + i, t.top));
    t.lines = [];
    for (let fy = t.top + 9; fy < t.base - 1; fy += 7) {
      const a = new Int16Array(w);
      for (let i = 0; i < w; i++) a[i] = fy + R(t.sag(t.x0 + i, fy));
      t.lines.push(a);
    }
    t.tone = new Int8Array(w * 200); // glass ramp index per pixel (rows from t.top - 8)
    return t;
  }
  TOWERS.forEach(geom);

  // ------------------------------------------------------------ towers
  // flat facade y (undo the bow) for reflections that follow the floors
  function glassTone(t, x, y, noGlint) {
    const i = x - t.x0;
    const u = i / (t.w - 1);
    const fy = y - t.sag(x, y);
    const v = (fy - t.top) / (t.base - t.top);
    let tone = profAt(t.prof, u) + t.shift;
    // the top floors catch the bright sky
    if (v < 0.12) tone -= 1.2 * (1 - v / 0.12);
    // the reflected horizon: pale sky just above it, the far shore and the bay below
    const hz = 0.66;
    if (v >= hz) tone += 0.6 + 0.6 * ((v - hz) / (1 - hz));
    if (noGlint) return tone;
    // diagonal sky glints running down to the left
    const d = i + (fy - t.top) * 0.52;
    const fade = clamp(1 - 1.6 * (v - 0.15), 0, 1);
    for (const g of t.glints) if (d >= g[0] && d < g[1]) tone -= g[2] * (g[1] - g[0] > 2 ? fade : clamp(fade * 1.6, 0, 1));
    return tone;
  }

  function bakeTowers(m) {
    const dark = isDark(m);
    const GL = PR(C.glass);
    const CAP = PR(C.cap);
    // at night the mirror glass reflects a dark sky: shift the whole ramp darker
    const nshift = m === 'night' ? 2.6 : m === 'dusk' ? 1.4 : 0;
    // the body glass never goes darker than this; the darkest steps are kept
    // for the narrow end face and the floor lines
    const bodyMax = 8 + Math.ceil(nshift);
    return HD.bake(180, 160, (g) => {
      const OX = 146;
      const OY = 28;
      for (const t of TOWERS) {
        const painted = new Int8Array(t.w * 200); // glass index painted per pixel (this mode)
        const glint = new Uint8Array(t.w * 200);
        for (let i = 0; i < t.w; i++) {
          const x = t.x0 + i;
          const roof = t.roof[i];
          for (let y = roof + 3; y <= t.base; y++) {
            const tone = glassTone(t, x, y) + nshift;
            // flat bands with a checker seam about two pixels wide between them
            const plain = glassTone(t, x, y, true) + nshift;
            const gx = Math.abs(glassTone(t, x + 1, y, true) - glassTone(t, x - 1, y, true)) * 0.5;
            const gy = Math.abs(glassTone(t, x, y + 1, true) - glassTone(t, x, y - 1, true)) * 0.5;
            const isGlint = plain - tone > 0.05;
            const seam = isGlint ? 0 : clamp(Math.max(gx, gy) * 0.9, 0.03, 0.3);
            const fl = Math.floor(tone);
            const fr = tone - fl;
            let idx = fr > 0.5 + seam || (fr > 0.5 - seam && (x + y) & 1) ? fl + 1 : fl;
            idx = clamp(idx, 0, Math.min(bodyMax, GL.length - 1));
            const o = (y - t.top + 8) * t.w + i;
            painted[o] = idx;
            glint[o] = isGlint ? 1 : 0;
            g.px(x - OX, y - OY, GL[idx]);
          }
        }
        // floor lines (thin dark spandrels that bow with the facade): always
        // exactly one step darker than the glass painted under them, and
        // broken for a pixel where a glint crosses so the glints stay clean
        for (const ln of t.lines) {
          for (let i = 1; i < t.w - 2; i++) {
            const x = t.x0 + i;
            const y = ln[i];
            const o = (y - t.top + 8) * t.w + i;
            if (glint[o]) continue;
            const idx = clamp(painted[o] + 1, 2, GL.length - 1);
            painted[o] = idx;
            g.px(x - OX, y - OY, GL[idx]);
          }
        }
        // daylight tones: the cloud reflections and the gondola cables read them
        if (nshift === 0) {
          t.tone.set(painted);
          t.glint = glint;
        }
        // crescent tips: a bright rim on the left, the narrow dark end face on the right
        for (let y = t.top + 1; y <= t.base; y++) {
          g.px(t.x0 - OX, y - OY, GL[clamp(Math.floor((y - t.top) / 60) + (dark ? 3 : 0), 0, 4)]);
          g.px(t.x1 - 1 - OX, y - OY, GL[clamp(8 + (dark ? 2 : 0), 0, GL.length - 1)]);
          g.px(t.x1 - OX, y - OY, GL[clamp(9 + (dark ? 2 : 0), 0, GL.length - 1)]);
        }
        // roof coping following the curve
        for (let i = 0; i < t.w; i++) {
          const x = t.x0 + i;
          const roof = t.roof[i];
          g.px(x - OX, roof - OY, CAP[0]);
          g.px(x - OX, roof + 1 - OY, CAP[1]);
          g.px(x - OX, roof + 2 - OY, CAP[3]);
        }
        g.px(t.x1 - OX, t.roof[t.w - 1] - OY, CAP[2]);
        g.px(t.x1 - OX, t.roof[t.w - 1] + 1 - OY, CAP[3]);
        // a low plant box set back on the roof, showing in the dip of the curve
        const b0 = t.x0 + R(t.w * 0.34);
        const b1 = t.x0 + R(t.w * 0.6);
        for (let x = b0; x <= b1; x++) {
          const roof = t.roof[x - t.x0];
          for (let y = t.top - 1; y < roof; y++) g.px(x - OX, y - OY, y === t.top - 1 ? CAP[1] : x > b1 - 3 ? CAP[3] : CAP[2]);
        }
      }
    });
  }

  // ------------------------------------------------------------ rooms after dark
  // room bays per floor narrow towards the curved edges; some rooms are lit
  const BAYS = 14;
  function bays(t) {
    const out = [];
    let prev = 1;
    for (let k = 1; k <= BAYS; k++) {
      const u = 0.5 - 0.5 * Math.cos((k / BAYS) * Math.PI);
      const i = Math.min(t.w - 3, R(u * (t.w - 1)));
      if (i - prev >= 2) out.push([prev + 1, i - 1]);
      prev = i;
    }
    return out;
  }
  // fill a room's glass (columns i0..i1 of floor f) with one colour
  function roomRect(G, t, f, i0, i1, c) {
    const ln = t.lines[f];
    for (let i = i0; i <= i1; i++) G.vline(t.x0 + i, ln[i] + 2, ln[i] + 5, c);
  }
  function roomColour(h, m) {
    if (h < 0.08) return EM.tv;
    if (h < 0.3) return EM.roomDim[R(h * 10) % EM.roomDim.length];
    const c = EM.room[R(h * 37) % EM.room.length];
    return m === 'dusk' && h > 0.75 ? EM.roomDim[2] : c;
  }
  function bakeRooms(m) {
    const TOGGLES = [];
    const p = m === 'night' ? 0.34 : 0.24;
    const img = HD.bake(480, 270, (g) => {
      for (const t of TOWERS) {
        const bs = bays(t);
        for (let f = 0; f + 1 < t.lines.length; f++) {
          for (let b = 0; b < bs.length; b++) {
            const cw = HD.PLACES.marina.catWindow;
            const yA = t.lines[f][bs[b][0]];
            if (cw && t.x0 + bs[b][1] >= cw.x - 2 && t.x0 + bs[b][0] <= cw.x + cw.w + 1 && yA + 6 >= cw.y - 2 && yA <= cw.y + cw.h + 1) continue;
            const h = HD.hash(t.k, f, b, 551);
            const lit = HD.hash(t.k, f, b, 552) < p;
            // a few rooms switch their lights on or off during the loop
            if (HD.hash(t.k, f, b, 553) < 0.07) {
              const a = HD.hash(t.k, f, b, 554) * HD.LOOP;
              TOGGLES.push({ t, f, i0: bs[b][0], i1: bs[b][1], a, len: 20 + HD.hash(t.k, f, b, 555) * 90, c: roomColour(h, m) });
              continue;
            }
            if (!lit) continue;
            roomRect(g, t, f, bs[b][0], bs[b][1], roomColour(h, m));
            // a drawn curtain shades one side of some rooms
            if (h > 0.6 && bs[b][1] - bs[b][0] >= 2) roomRect(g, t, f, bs[b][1], bs[b][1], EM.roomDim[1]);
          }
        }
      }
    });
    return { img, toggles: TOGGLES };
  }
  function drawToggles(g, t, rooms) {
    const s = HD.summer ? HD.summer.sec(t) : t % HD.LOOP;
    for (const r of rooms.toggles) {
      let u = s - r.a;
      if (u < 0) u += HD.LOOP;
      if (u < r.len) roomRect(g.em, r.t, r.f, r.i0, r.i1, r.c);
    }
  }
  // golden hour: the low sun turns the thin glints gold and lays a warm
  // reflection down the sunward flank of each tower, floor by floor
  function bakeGolden() {
    return HD.bake(480, 270, (g) => {
      for (const t of TOWERS) {
        for (let i = 2; i < t.w - 2; i++) {
          const u = i / (t.w - 1);
          const x = t.x0 + i;
          const du = Math.abs(u - 0.885) / 0.055;
          for (let y = t.roof[i] + 3; y <= t.base; y++) {
            const tone = glassTone(t, x, y);
            const plain = glassTone(t, x, y, true);
            const thin = plain - tone > 1.9;
            if (thin) {
              g.px(x, y, EM.gold[0]);
              continue;
            }
            if (du >= 1) continue;
            // skip the floor lines so the reflection sits in the glass
            let onLine = false;
            for (const ln of t.lines) if (ln[i] === y) onLine = true;
            if (onLine) continue;
            const v = (y - t.top) / (t.base - t.top);
            const reach = 1 - Math.abs(v - 0.48) / 0.3; // fades out above and below
            if (reach <= 0) continue;
            const k = (1 - du * du) * reach;
            if (k > 0.72) g.px(x, y, EM.gold[1]);
            else if (k > 0.4 && (x + y) & 1) g.px(x, y, EM.gold[2]);
          }
        }
      }
    });
  }
  // after dark the lobby glows behind the glass ribbon
  function bakeLobbyLit(m) {
    return HD.bake(480, 270, (g) => {
      const wing = (a, b) => {
        for (let x = a + 1; x < b; x++) {
          if ((x - a) % 7 === 0) continue;
          for (let y = 190; y <= 203; y++) {
            if (y === 194) continue;
            let c = y < 194 ? EM.lobby[3] : y > 200 ? EM.lobby[2] : EM.lobby[1];
            if (x % 14 === 10 && y >= 195 && y <= 196) c = EM.lobby[0];
            if (y >= 201 && HD.hash(x >> 1, 7, 33) < 0.35) c = EM.lobby[3]; // chairs and planters
            if (m === 'dusk' && (x >> 3) % 3 === 0 && y < 194) continue;
            g.px(x, y, c);
          }
        }
      };
      wing(POD.x0 + 4, 203);
      wing(ENTRANCE.x1 + 3, POD.x1 - 4);
      // the doors
      for (let x = ENTRANCE.door0 + 1; x < ENTRANCE.door1; x++) {
        if (x === R((ENTRANCE.door0 + ENTRANCE.door1) / 2) || x === ENTRANCE.door0 + 4 || x === ENTRANCE.door1 - 4) continue;
        for (let y = 192; y <= 205; y++) g.px(x, y, y < 196 ? EM.lobby[2] : EM.lobby[1]);
      }
      // two downlights under the canopy
      g.hline(ENTRANCE.x0 + 6, ENTRANCE.x0 + 7, 190, EM.lobby[0]);
      g.hline(ENTRANCE.x1 - 7, ENTRANCE.x1 - 6, 190, EM.lobby[0]);
    });
  }

  // ------------------------------------------------------------ podium
  function bakePodium(m) {
    const dark = isDark(m);
    const PD = PR(C.pod);
    const LB = PR(C.lobby);
    const WM = PR(C.warm);
    const CN = PR(C.canopy);
    const BZ = PR(C.bronze);
    const RL = PR(C.rail);
    const UM = PR(C.umbrella);
    return HD.bake(200, 32, (g) => {
      const OX = 136;
      const OY = 174;
      const px = (x, y, c) => g.px(x - OX, y - OY, c);
      const rect = (x, y, w, h, c) => g.rect(x - OX, y - OY, w, h, c);
      // pool-deck rail where the podium roof shows, and one umbrella on the
      // deck between the towers (the corners are kept for the palms)
      for (const [a, b] of [
        [POD.x0, TOWERS[0].x0 - 1],
        [TOWERS[0].x1 + 1, TOWERS[1].x0 - 1],
        [TOWERS[1].x1 + 1, POD.x1],
      ]) {
        rect(a, 181, b - a + 1, 1, RL[1]);
        for (let x = a; x <= b; x++) {
          px(x, 182, x & 1 ? RL[0] : RL[2]);
          px(x, 183, RL[2]);
        }
        for (let x = a + 1; x <= b; x += 4) {
          px(x, 182, RL[1]);
          px(x, 183, RL[1]);
        }
      }
      const umbrella = (x, c0, c1) => {
        px(x, 175, c0);
        rect(x - 2, 176, 5, 1, c0);
        rect(x - 3, 177, 7, 1, c1);
        for (let y = 178; y <= 183; y++) px(x, y, PD[4]);
      };
      umbrella(235, UM[2], UM[3]);
      // body
      rect(POD.x0, 184, POD.x1 - POD.x0 + 1, 22, PD[1]);
      rect(POD.x0, 184, POD.x1 - POD.x0 + 1, 1, PD[0]);
      rect(POD.x0, 185, POD.x1 - POD.x0 + 1, 1, PD[1]);
      rect(POD.x0, 186, POD.x1 - POD.x0 + 1, 1, PD[3]);
      rect(POD.x0, 187, POD.x1 - POD.x0 + 1, 1, PD[2]);
      // ribbon of lobby glazing (left and right wings), cream mullions every 7 px
      const wing = (a, b) => {
        for (let x = a; x <= b; x++) {
          for (let y = 190; y <= 203; y++) {
            const v = (y - 190) / 13;
            let idx = v < 0.25 ? 3 : v < 0.45 ? 2 : 1;
            // reflections of the bright promenade and sky: soft diagonal bands
            const d = (x + (y - 190) * 0.8) % 23;
            if (d < 2.2) idx += 1;
            if (dark) idx = 0;
            px(x, y, LB[clamp(idx, 0, LB.length - 1)]);
          }
          // warm interior hints low in the glass: pendant lamps and their glow
          if (!dark && x % 14 === 10) {
            px(x, 195, WM[3]);
            px(x, 196, WM[2]);
            px(x, 197, WM[1]);
          }
        }
        rect(a, 189, b - a + 1, 1, PD[3]);
        rect(a, 194, b - a + 1, 1, PD[2]);
        for (let x = a; x <= b; x += 7) rect(x, 190, 1, 14, PD[1]);
        rect(b, 190, 1, 14, PD[1]);
      };
      wing(POD.x0 + 4, 203);
      wing(ENTRANCE.x1 + 3, POD.x1 - 4);
      // plaque pier (left of the entrance; the sign module places its plaque here)
      rect(204, 188, 16, 16, PD[1]);
      rect(204, 188, 1, 16, PD[2]);
      // entrance portal: recessed, shaded under the canopy
      rect(ENTRANCE.x0, 188, ENTRANCE.x1 - ENTRANCE.x0 + 1, 18, PD[2]);
      rect(ENTRANCE.x0 + 2, 191, ENTRANCE.x1 - ENTRANCE.x0 - 3, 15, PD[3]);
      // doors: four glass leaves in a bronze frame, the warm lobby behind them
      const d0 = ENTRANCE.door0;
      const d1 = ENTRANCE.door1;
      const mid = R((d0 + d1) / 2);
      const HGd = PR(C.hedge);
      rect(d0, 191, d1 - d0 + 1, 15, BZ[1]);
      for (let x = d0 + 1; x < d1; x++) {
        for (let y = 192; y <= 205; y++) {
          let c;
          if (y <= 194) c = dark ? LB[0] : (x + y) % 9 === 0 ? LB[4] : LB[2];
          else if (dark) c = LB[0];
          else c = y >= 202 ? WM[1] : y === 196 ? WM[1] : WM[2];
          px(x, y, c);
        }
      }
      rect(d0, 195, d1 - d0 + 1, 1, BZ[1]);
      if (!dark) {
        // a pendant lamp, a plant and a reception desk inside; a reflection on the glass
        px(mid, 196, WM[3]);
        px(mid - 1, 197, WM[4]);
        px(mid + 1, 197, WM[4]);
        px(mid, 197, WM[4]);
        rect(d0 + 2, 199, 2, 2, HGd[4]);
        px(d0 + 2, 198, HGd[5]);
        rect(d0 + 2, 201, 2, 1, PR(C.bronze)[2]);
        rect(mid + 2, 200, 5, 2, WM[0]);
        rect(mid + 2, 200, 5, 1, WM[3]);
        for (let k = 0; k < 3; k++) px(d1 - 1 - k, 196 + k, LB[4]);
        for (let k = 0; k < 3; k++) px(d0 + 3 - k, 197 + k, LB[3]);
      }
      rect(mid, 192, 1, 14, BZ[1]);
      rect(d0 + 4, 192, 1, 14, BZ[0]);
      rect(d1 - 4, 192, 1, 14, BZ[0]);
      px(mid - 1, 199, BZ[2]);
      px(mid + 1, 199, BZ[2]);
      // potted topiaries flanking the doors
      for (const ux of [ENTRANCE.x0 + 4, ENTRANCE.x1 - 5]) {
        rect(ux - 1, 202, 4, 3, BZ[1]);
        rect(ux - 1, 202, 4, 1, BZ[2]);
        px(ux + 2, 203, BZ[0]);
        px(ux + 2, 204, BZ[0]);
        rect(ux, 201, 2, 1, PR(C.trunk)[1]);
        for (let dy = -2; dy <= 2; dy++) {
          const hw = dy === -2 || dy === 2 ? 1 : 2;
          for (let dx = -hw; dx <= hw - 1; dx++) {
            const lit = dx * 0.6 - dy * 0.8;
            px(ux + 1 + dx, 198 + dy, HGd[lit > 0.8 ? 5 : lit > -0.6 ? 4 : 2]);
          }
        }
      }
      // canopy: a thin white cantilevered slab, its underside in shade
      rect(ENTRANCE.x0, 186, ENTRANCE.x1 - ENTRANCE.x0 + 1, 1, CN[1]);
      rect(ENTRANCE.x0, 187, ENTRANCE.x1 - ENTRANCE.x0 + 1, 2, CN[0]);
      rect(ENTRANCE.x0, 189, ENTRANCE.x1 - ENTRANCE.x0 + 1, 1, CN[2]);
      rect(ENTRANCE.x0 + 1, 190, ENTRANCE.x1 - ENTRANCE.x0 - 1, 1, CN[3]);
      px(ENTRANCE.x0, 189, CN[1]);
      px(ENTRANCE.x1, 189, CN[1]);
      // palm trunks standing in front of the podium throw thin shadows on it by day
      if (!dark) {
        for (const p of PALMS) {
          if (p.x < POD.x0 + 12 || p.x > POD.x1 - 12) continue;
          const sx = p.x - 3;
          for (let y = 186; y <= 203; y++) {
            const onGlass = y >= 190 && (sx < 204 || sx > ENTRANCE.x1) && y !== 194;
            if (!onGlass) px(sx, y, y === 186 ? PD[4] : PD[3]);
          }
        }
      }
      // plinth
      rect(POD.x0, 204, POD.x1 - POD.x0 + 1, 1, PD[3]);
      rect(POD.x0, 205, POD.x1 - POD.x0 + 1, 1, PD[4]);
      rect(ENTRANCE.x0 + 2, 204, ENTRANCE.x1 - ENTRANCE.x0 - 3, 2, BZ[1]);
      // corners
      rect(POD.x0, 184, 1, 22, PD[0]);
      rect(POD.x1, 184, 1, 22, PD[3]);
      // bougainvillea draped over the two podium corners: a clump on the
      // parapet and a few solid strands trailing down the wall, each ending
      // in a small bloom; the palms at the corners stand in front of them
      const HG = PR(C.hedge);
      const BL = PR(C.bloom);
      const drape = (cx, strands) => {
        for (const [sx, len, bx] of strands) {
          for (let k = 0; k < len; k++) {
            const y = 187 + k;
            const h = HD.hash(sx, y, 61);
            px(sx, y, h < 0.22 ? HG[k < 3 ? 3 : 2] : BL[k < 3 ? 4 : h > 0.7 ? 4 : 3]);
          }
          // the bloom at the tip: 2 x 2, lit on top
          const by = 187 + len;
          px(bx, by, BL[4]);
          px(bx + 1, by, BL[bx < sx ? 4 : 3]);
          px(bx, by + 1, BL[2]);
          px(bx + 1, by + 1, BL[2]);
        }
        bloom(px, BL, HG, cx, 185, 4, 2, 31);
      };
      // [strand x, length, bloom left x]
      drape(142, [[139, 12, 138], [144, 9, 144], [146, 5, 145]]);
      drape(328, [[331, 12, 331], [326, 8, 325], [324, 5, 324]]);
      // a few leaves on the shaded (left) side of each drape
      px(138, 190, HG[2]);
      px(138, 193, HG[1]);
      px(143, 189, HG[2]);
      px(323, 188, HG[2]);
      px(323, 190, HG[1]);
    });
  }

  // ------------------------------------------------------------ hedges
  // a shaded clump of bougainvillea bracts (sun from the upper right)
  function bloom(px, BL, HG, cx, cy, rx, ry, seed) {
    for (let dy = -ry - 1; dy <= ry + 1; dy++) {
      for (let dx = -rx - 1; dx <= rx + 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const nx = dx / (rx + 0.5);
        const ny = dy / (ry + 0.5);
        // a lumpy outline
        const lump = 1 + 0.28 * (HD.hash(R(Math.atan2(ny, nx) * 2.2), cx, seed) - 0.5);
        const d = (nx * nx + ny * ny) / (lump * lump);
        if (d > 1) continue;
        const h = HD.hash(x, y, seed);
        if (d > 0.55 && h < 0.3) continue;
        const lit = nx * 0.5 - ny * 0.9;
        if (h < 0.13) {
          px(x, y, HG[lit > 0 ? 4 : 2]); // leaves among the bracts
          continue;
        }
        let idx = lit > 0.45 ? 5 : lit > 0.05 ? 4 : lit > -0.4 ? 3 : 2;
        if (h > 0.8) idx -= 1;
        px(x, y, BL[clamp(idx, 1, BL.length - 1)]);
      }
    }
  }

  function bakeHedges() {
    const HG = PR(C.hedge);
    const BL = PR(C.bloom);
    return HD.bake(250, 40, (g) => {
      const OX = 112;
      const OY = 172;
      const px = (x, y, c) => g.px(x - OX, y - OY, c);
      // clipped hedges in blocks along the podium foot (ending just past the
      // corners, clear of the castle anchor), the doorway kept clear
      const runs = [
        [POD.x0 - 3, ENTRANCE.x0 + 1],
        [ENTRANCE.x1 - 1, POD.x1 + 3],
      ];
      for (const [a, b] of runs) {
        for (let x = a; x <= b; x++) {
          const blk = Math.floor((x - a) / 19);
          const bh = 7 + (HD.hash(blk, a, 5) > 0.6 ? 1 : 0);
          const top = 206 - bh;
          const ex = Math.min(x - a, b - x);
          const tt = top + (ex === 0 ? 2 : ex === 1 ? 1 : 0);
          for (let y = tt; y <= 205; y++) {
            let idx;
            if (y === tt) idx = 5;
            else if (y === tt + 1) idx = 4;
            else if (y >= 204) idx = 1;
            else idx = HD.bayer(x * 3 + 1, y * 5) < 0.3 ? 2 : 3;
            if (ex === 0) idx = Math.max(1, idx - 2);
            px(x, y, HG[idx]);
          }
          if (((x - a) % 19 === 0) && x > a) px(x, top + 2, HG[2]);
        }
      }
      // drifts of magenta bougainvillea growing over the hedge: a few larger
      // masses of different sizes, some rising above the clipped top, some
      // spilling down to the foot, with plain hedge between them
      // [centre x, width, crest y, spills to the foot]
      const DRIFTS = [
        [142, 9, 197, 0],
        [163, 15, 196, 1],
        [190, 10, 199, 0],
        [261, 12, 198, 1],
        [284, 16, 196, 0],
        [306, 8, 200, 1],
        [325, 11, 197, 0],
      ];
      const rng = HD.rng(9071);
      for (const [dc, dw, crest, spill] of DRIFTS) {
        // the body of the drift: overlapping mounds, tallest in the middle
        const n = Math.max(2, R(dw / 4));
        for (let k = 0; k < n; k++) {
          const u = n === 1 ? 0.5 : k / (n - 1);
          const cx = R(dc + (u - 0.5) * (dw - 5) + (rng() - 0.5) * 2);
          const mid = 1 - Math.abs(u - 0.5) * 2;
          const rx = clamp(R(1 + mid * 3 + rng() * 1.4), 1, 5);
          const ry = 2 + (mid > 0.5 && rng() < 0.6 ? 1 : 0);
          const cy = clamp(R(crest + ry + (1 - mid) * 2 + rng()), 197, 203);
          bloom(px, BL, HG, cx, cy, rx, ry, 41 + k);
        }
        if (spill) {
          const sx = R(dc + (rng() - 0.5) * dw * 0.5);
          bloom(px, BL, HG, sx, 203, 2, 2, 43);
          bloom(px, BL, HG, sx + (rng() < 0.5 ? -3 : 3), 204, 1, 1, 44);
        }
      }
      // a couple of lone sprigs in the plain stretches
      for (const [sx, sy] of [[178, 200], [272, 201], [316, 199]]) bloom(px, BL, HG, sx, sy, 1, 1, 47);
    });
  }

  // ------------------------------------------------------------ palms
  // A tall, skinny fan palm. The trunk is one fixed curve (its jogs never
  // move); only its top third follows the sway, by at most one pixel. The
  // crown is a starburst of separate fronds: a 1-px stalk ending in a narrow
  // fan of spiky leaflet tips, upper fronds reaching up, lower ones drooping,
  // sky showing between them, a dark heart and a short brown skirt of dead
  // fronds under the head, like the street palms.
  function bakePalm(p) {
    const TR = PR(C.palmTrunk);
    const SK = PR(C.palmDry);
    const FR = PR(C.frond);
    const H = p.base - p.top;
    const trunks = [];
    for (let sw = -1; sw <= 1; sw++) {
      trunks.push(
        HD.bake(24, H + 4, (g) => {
          const cx = 12;
          for (let y = 0; y <= H; y++) {
            const up = 1 - y / H; // 1 at the crown, 0 at the base
            const xi = R(cx + p.lean * Math.pow(up, 1.6)) + (up > 0.7 ? sw : 0);
            const ring = (y + p.seed) % 4 === 0;
            g.px(xi, y, TR[ring ? 0 : 1]);
            g.px(xi + 1, y, TR[ring ? 2 : 3]);
            if (y > H - 3) g.px(xi - 1, y, TR[0]); // a slightly swollen foot
          }
        })
      );
    }
    // frond directions in degrees (0 = right, 90 = up)
    const DIRS = [-40, 0, 36, 70, 106, 142, 180, 220];
    const crowns = [];
    for (let fl = 0; fl < 2; fl++) {
      crowns.push(
        HD.bake(36, 32, (g) => {
          const cx = 18;
          const cy = 12;
          const rng = HD.rng(p.seed * 31 + 7);
          // the dead skirt hangs under the head, behind the fronds
          for (let i = -2; i <= 2; i++) {
            const len = 2 + R(rng() * 1.6) + (i === 0 ? 1 : 0);
            for (let j = 0; j < len; j++) {
              const x = cx + i + (j > 1 && i ? Math.sign(i) : 0);
              g.px(x, cy + 1 + j, SK[j === len - 1 ? 0 : i > 0 ? 3 : i < 0 ? 1 : 2]);
            }
          }
          const fronds = DIRS.map((d, k) => {
            const a = ((d + (rng() - 0.5) * 14) * Math.PI) / 180 + (fl ? 0.07 * (k % 2 ? 1 : -1) : 0);
            const up = Math.sin(a);
            return { a, L: p.s * (up > 0.3 ? 8.5 + rng() * 1.6 : 7 + rng() * 1.3), up };
          });
          fronds.sort((A, B) => A.up - B.up); // lower fronds first
          for (const f of fronds) {
            const { a, L, up } = f;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            // upper fronds arc out gently, the side and lower ones droop
            const droop = up > 0.6 ? 0.12 : up > -0.2 ? 0.38 : 0.26;
            const P0 = (r) => [cx + r * ca * 1.05, cy - r * sa * 0.85 + (droop * r * r) / L];
            const lit = ca * 0.55 + sa * 0.85; // sun from the upper right
            const base = lit > 0.6 ? 5 : lit > 0.1 ? 4 : lit > -0.4 ? 3 : 2;
            // the stalk
            const r0 = L * 0.48;
            for (let r = 1.5; r < r0; r += 0.5) {
              const q = P0(r);
              g.px(R(q[0]), R(q[1]), FR[Math.max(1, base - 2)]);
            }
            // the fan: three rays of leaflets spreading to spiky tips
            for (let r = r0; r <= L + 0.01; r += 0.4) {
              const q = P0(r);
              const q2 = P0(r + 0.3);
              let tx = q2[0] - q[0];
              let ty = q2[1] - q[1];
              const tn = Math.hypot(tx, ty) || 1;
              tx /= tn;
              ty /= tn;
              // perpendicular, pointing to the upper side of the frond
              let nx = ty;
              let ny = -tx;
              if (ny > 0 || (ny === 0 && nx < 0)) {
                nx = -nx;
                ny = -ny;
              }
              const u = (r - r0) / (L - r0);
              const w = 0.4 + 1.7 * u;
              g.px(R(q[0]), R(q[1]), FR[base]);
              // the side rays split off the midrib and end a little short of
              // it, so each frond finishes in three separate spikes
              if (u > 0.18 && r <= L - 1) {
                g.px(R(q[0] + nx * w), R(q[1] + ny * w), FR[Math.min(6, base + 1)]);
                g.px(R(q[0] - nx * w), R(q[1] - ny * w), FR[Math.max(1, base - 1)]);
              }
            }
            if (lit > 0.3) {
              const q = P0(L);
              g.px(R(q[0]), R(q[1]), FR[6]);
            }
          }
          // the dark heart where the fronds meet the trunk
          g.rect(cx - 1, cy - 1, 3, 2, FR[0]);
          g.px(cx + 1, cy - 1, FR[2]);
          g.px(cx, cy + 1, SK[0]);
        })
      );
    }
    return { trunks, crowns, H };
  }

  // ------------------------------------------------------------ cat window
  // one room on the north tower: curtains drawn back, a plant and a lamp
  // (or the series cat when an entry puts him there)
  function drawCatWindow(g, t, m) {
    const w = HD.PLACES.marina.catWindow; // {x, y, w, h}
    if (!w) return;
    const dark = isDark(m);
    const ed = HD.edition;
    const who = ed.cast ? ed.cast.window : 'empty';
    const GL = PR(C.glass);
    const CAP = PR(C.cap);
    // a slim frame in the curtain-wall colour and a pale sill
    g.rect(w.x - 1, w.y - 1, w.w + 2, w.h + 2, GL[9]);
    g.hline(w.x - 1, w.x + w.w, w.y + w.h, CAP[1]);
    // the room behind the glass: dim and warm by day, glowing at night
    const E = dark ? g.em : g;
    const col = (day, night) => (dark ? night : P(day));
    const wall = col('#6e4f36', '#d89a58');
    const wallD = col('#563c2a', '#b77a42');
    const cur = col('#e9dcc0', '#ffe2ae');
    const curD = col('#bba98a', '#e6b87a');
    E.rect(w.x, w.y, w.w, w.h, wall);
    E.rect(w.x, w.y + w.h - 2, w.w, 2, wallD);
    E.rect(w.x, w.y, 2, w.h, cur);
    E.rect(w.x + w.w - 2, w.y, 2, w.h, cur);
    E.px(w.x + 1, w.y + 2, curD);
    E.px(w.x + 1, w.y + 4, curD);
    E.px(w.x + 2, w.y + 6, curD);
    E.px(w.x + w.w - 2, w.y + 1, curD);
    E.px(w.x + w.w - 2, w.y + 3, curD);
    E.px(w.x + w.w - 3, w.y + 6, curD);
    // the series cat sits here only if the place gives him an anchor (no
    // current entry does: this window is too small for him); otherwise the
    // room keeps its plant and lamp so it is never bare
    const pl = HD.place();
    if ((who === 'alone' || who === 'together') && pl.mascot) {
      HD.mascot.draw(g, t, pl.mascot.x, pl.mascot.y);
      if (who === 'together' && pl.partner && HD.drawPartner) HD.drawPartner(g, t, pl.partner.x, pl.partner.base);
    } else {
      // a potted plant on the sill and a lamp glowing warm on a side table
      const LF = PR(C.leaf);
      g.px(w.x + 3, w.y + 6, P('#c06a40'));
      g.px(w.x + 4, w.y + 6, P('#9a5232'));
      g.px(w.x + 3, w.y + 5, LF[3]);
      g.px(w.x + 4, w.y + 5, LF[2]);
      g.px(w.x + 4, w.y + 4, LF[4]);
      g.px(w.x + 3, w.y + 3, LF[5]);
      g.px(w.x + 2, w.y + 4, LF[4]);
      g.em.px(w.x + 6, w.y + 2, EM.lamp[0]);
      g.em.px(w.x + 7, w.y + 2, EM.lamp[1]);
      g.em.px(w.x + 6, w.y + 3, EM.lamp[1]);
      g.em.px(w.x + 7, w.y + 3, EM.lamp[2]);
      g.em.px(w.x + 5, w.y + 3, dark ? EM.lamp[2] : P('#c89a62'));
      g.px(w.x + 6, w.y + 4, P('#3e3026'));
      g.px(w.x + 6, w.y + 5, P('#3e3026'));
      g.rect(w.x + 5, w.y + 6, 3, 1, P('#4a3a2e'));
    }
    // the glass catches the sky in one corner
    if (!dark) {
      g.px(w.x + w.w - 3, w.y, P(C.glass[2]));
      g.px(w.x + w.w - 2, w.y, P(C.glass[1]));
      g.px(w.x + w.w - 1, w.y, P(C.glass[1]));
      g.px(w.x + w.w - 1, w.y + 1, P(C.glass[2]));
    }
  }

  // ------------------------------------------------------------ art cache
  const arts = new Map();
  function art() {
    const m = mode();
    let a = arts.get(m);
    if (!a) {
      a = {
        towers: bakeTowers(m),
        rooms: isDark(m) ? bakeRooms(m) : null,
        golden: m === 'golden' ? bakeGolden() : null,
        lobby: isDark(m) ? bakeLobbyLit(m) : null,
        podium: bakePodium(m),
        hedges: bakeHedges(),
        palms: PALMS.map(bakePalm),
      };
      arts.set(m, a);
    }
    return a;
  }

  // ------------------------------------------------------------ animated bits
  // cloud reflections drifting across the upper floors
  // each cloud: [floor, row below that floor line, x offset, length]
  const CLOUD_A = [[0, 3, 5, 9], [0, 4, 1, 18], [0, 5, -2, 24], [0, 6, 1, 19], [1, 1, 4, 13], [1, 2, 8, 6]];
  const CLOUD_B = [[0, 4, 3, 8], [0, 5, 0, 14], [0, 6, 2, 11], [1, 1, 5, 6]];
  const REFL = [
    { k: 0, floor: 1, shape: CLOUD_A, off: 0.12 },
    { k: 0, floor: 7, shape: CLOUD_B, off: 0.58 },
    { k: 1, floor: 0, shape: CLOUD_B, off: 0.36 },
    { k: 1, floor: 5, shape: CLOUD_A, off: 0.84 },
  ];
  function drawReflections(g, t) {
    const GL = PR(C.glass);
    for (const r of REFL) {
      const tw = TOWERS[r.k];
      const span = tw.w + 40;
      const xo = tw.x0 - 30 + Math.floor(T.phase(t, HD.LOOP, r.off) * span);
      for (const [fl, dy, dx, len] of r.shape) {
        const ln = tw.lines[r.floor + fl];
        if (!ln) continue;
        const xa = xo + dx;
        const xb = xo + dx + len - 1;
        // runs of equal height and colour become one hline
        let rx0 = 0;
        let ry = -1;
        let rc = null;
        const flush = (xEnd) => {
          if (rc) g.hline(rx0, xEnd, ry, rc);
          rc = null;
        };
        for (let x = xa; x <= xb; x++) {
          const i = x - tw.x0;
          if (i < 2 || i >= tw.w - 3) {
            flush(x - 1);
            continue;
          }
          const y = ln[i] + dy;
          const edge = x === xa || x === xb;
          if (edge && HD.bayer(x, y) > 0.5) {
            flush(x - 1);
            continue;
          }
          const o = (y - tw.top + 8) * tw.w + i;
          const base = tw.tone[o];
          // never stack a cloud on a glint: the glint stays the brightest thing
          if (base <= 2 || (tw.glint && tw.glint[o])) {
            flush(x - 1);
            continue;
          }
          const c = GL[Math.max(3, base - (edge ? 1 : 2))];
          if (c !== rc || y !== ry) {
            flush(x - 1);
            rx0 = x;
            ry = y;
            rc = c;
          }
        }
        flush(xb);
      }
    }
  }

  // a window-washing gondola working its way down the south tower, floor by floor
  function drawGondola(g, t) {
    const tw = TOWERS[1];
    const gx = tw.x0 + 55; // left cable
    const first = 2;
    const floors = 13;
    const s = HD.summer ? HD.summer.sec(t) : t % HD.LOOP;
    const down = 204; // seconds working down; then a steady ride back up
    let f;
    if (s < down) {
      const per = down / floors;
      const k = Math.floor(s / per);
      const u = (s - k * per) / per;
      f = k + (u > 0.82 ? (u - 0.82) / 0.18 : 0); // wash a floor, then lower to the next
    } else f = floors * (1 - (s - down) / (HD.LOOP - down));
    const i = gx - tw.x0;
    const gy = R(tw.lines[first][i] + f * 7) - 2;
    const GL = PR(C.glass);
    const CAP = PR(C.cap);
    const ry = tw.roof[i];
    // davit arm reaching over the parapet
    g.vline(gx + 2, ry - 3, ry - 1, CAP[2]);
    g.hline(gx, gx + 4, ry - 3, CAP[2]);
    // two cables, a shade darker than the glass they cross
    for (const cx of [gx, gx + 4]) {
      const ci = cx - tw.x0;
      let y0 = ry - 2;
      let last = -1;
      for (let y = ry + 3; y <= gy; y++) {
        const idx = y < gy ? clamp(tw.tone[(y - tw.top + 8) * tw.w + ci] + 1, 0, GL.length - 1) : -2;
        if (idx !== last) {
          if (last >= 0) g.vline(cx, y0, y - 1, GL[last]);
          else if (last === -1) g.vline(cx, ry - 2, ry + 2, CAP[2]);
          y0 = y;
          last = idx;
        }
      }
    }
    // the cradle with a worker in a yellow hard hat
    g.rect(gx - 1, gy, 7, 2, CAP[0]);
    g.hline(gx - 1, gx + 5, gy + 1, CAP[2]);
    g.px(gx + 2, gy - 1, P('#35588a'));
    g.px(gx + 2, gy - 2, P('#f2c14e'));
  }

  // a sun sparkle on a roof corner now and then
  function drawSparkle(g, t, m) {
    const c = T.cycle(t, 0, 21, 8803);
    const a = c.age * c.P;
    if (a > 1.4) return;
    const k = Math.sin((a / 1.4) * Math.PI);
    const tw = TOWERS[c.rnd(1) < 0.5 ? 1 : 0];
    const x = tw.x1 - 1;
    const y = tw.roof[tw.w - 2];
    const col = m === 'golden' ? EM.gold : EM.sun;
    g.em.px(x, y, col[0]);
    if (k > 0.35) {
      g.em.px(x - 1, y, col[1]);
      g.em.px(x + 1, y, col[1]);
      g.em.px(x, y - 1, col[1]);
      g.em.px(x, y + 1, col[1]);
    }
    if (k > 0.75) {
      g.em.px(x - 2, y, col[2]);
      g.em.px(x + 2, y, col[2]);
      g.em.px(x, y - 2, col[2]);
      g.em.px(x, y + 2, col[2]);
    }
  }

  // ------------------------------------------------------------ passes
  function drawTowers(g, t) {
    if (!here()) return;
    const m = mode();
    const A = art();
    g.sprite(A.towers, 146, 28);
    if (!isDark(m)) {
      drawReflections(g, t);
      drawGondola(g, t);
    }
    if (A.golden) g.em.sprite(A.golden, 0, 0);
    if (A.rooms) {
      g.em.sprite(A.rooms.img, 0, 0);
      drawToggles(g, t, A.rooms);
    }
    drawCatWindow(g, t, m);
    if (m === 'day' || m === 'golden') drawSparkle(g, t, m);
  }

  function drawPodium(g) {
    if (!here()) return;
    const A = art();
    g.sprite(A.podium, 136, 174);
    if (A.lobby) g.em.sprite(A.lobby, 0, 0);
  }

  function drawPalms(g, t) {
    if (!here()) return;
    const A = art();
    const br = HD.summer ? HD.summer.breeze(t) : 0;
    const ts = T.step(t, 6);
    for (let i = 0; i < PALMS.length; i++) {
      const p = PALMS[i];
      const pa = A.palms[i];
      const amp = p.s > 1 ? 1.4 : 1.0;
      const sw = clamp(R(br * amp + 0.35 * T.wave(t, 9.7, i * 0.17)), -1, 1);
      g.sprite(pa.trunks[sw + 1], p.x - 12, p.top);
      const fl = T.noise(ts, 1.3, 77 + i) > 0.5 ? 1 : 0;
      const topX = R(12 + p.lean) - 12 + p.x + sw;
      g.sprite(pa.crowns[fl], topX - 18, p.top - 12);
    }
  }

  function drawHedges(g) {
    if (!here()) return;
    g.sprite(art().hedges, 112, 172);
  }

  // ------------------------------------------------------------ lights
  // palm shadow polygons, cached per light mode and sway step. They use the
  // street module's daylight projection (a point h px up lands at
  // x + vx * h, base + vy * h) and its shade strength, so they fall the same
  // way as the lamp and street-palm shadows on the promenade.
  const SUNVEC = { day: { vx: -0.34, vy: 0.15, k: 0.4 }, golden: { vx: -1.15, vy: 0.15, k: 0.5 } };
  const shadowCache = new Map();
  function palmShadows(lt, sw) {
    const sv = SUNVEC[lt.mode];
    if (!sv) return [];
    const key = lt.mode + sw;
    let list = shadowCache.get(key);
    if (list) return list;
    list = [];
    const { vx, vy, k } = sv;
    const y0 = 206; // the promenade's top edge, just in front of the palm foot
    for (const p of PALMS) {
      const h = p.base - p.top;
      const x0 = p.x;
      // the crown's shadow centre
      const cxs = p.x + p.lean + sw + vx * h;
      const cys = y0 + vy * h;
      // the trunk: a 2-px stick from the foot to the crown
      list.push({ poly: [[x0, y0], [x0 + 2, y0], [cxs + 1.5, cys], [cxs - 0.5, cys]], k });
      // the heart of the crown: an oval at least 3 px tall
      const core = [];
      for (let j = 0; j < 10; j++) core.push([cxs + Math.cos((j / 10) * T.TAU) * 3.2 * p.s, cys + Math.sin((j / 10) * T.TAU) * 1.9]);
      list.push({ poly: core, k });
      // the fronds: a squashed star of tapering rays, about 2 px thick
      const n = 8;
      for (let j = 0; j < n; j++) {
        const a = ((j + 0.5) / n) * T.TAU + p.seed * 0.7;
        const dx = Math.cos(a);
        const dy = Math.sin(a) * 0.38; // the ground is seen at a low angle
        const l = (6.2 + ((j * 5 + p.seed) % 3) * 0.9) * p.s;
        const dn = Math.hypot(dx, dy);
        // perpendicular in screen space
        const nx = -dy / dn;
        const ny = dx / dn;
        const wb = 1.1; // half thickness at the base
        const wt = 0.7; // half thickness at the tip
        const bx = cxs + dx * 2;
        const by = cys + dy * 2;
        const tx = cxs + dx * l;
        const ty = cys + dy * l;
        list.push({ poly: [[bx + nx * wb, by + ny * wb], [tx + nx * wt, ty + ny * wt], [tx + dx * 0.8, ty + dy * 0.8], [tx - nx * wt, ty - ny * wt], [bx - nx * wb, by - ny * wb]], k });
      }
    }
    shadowCache.set(key, list);
    return list;
  }

  function lights(t, L) {
    if (!here()) return;
    const m = mode();
    // by day the palms lay thin shadows across the promenade, away from the sun
    const lt = HD.light();
    if (lt.sun && lt.day > 0.5) {
      const sw = clamp(R(HD.summer ? HD.summer.breeze(t) : 0), -1, 1);
      for (const sh of palmShadows(lt, sw)) L.shade(sh);
    }
    if (!isDark(m) && m !== 'golden') return;
    const k = m === 'golden' ? 0.5 : 1;
    // the lobby spills warm light onto the promenade
    L.add({ x: 236, y: 206, r: 46, ry: 16, color: HD.LIGHT.lantern, i: 0.75 * k, bands: 4, clip: { x0: 0, y0: 186, x1: 479, y1: 230 } });
    L.add({ x: 236, y: 196, r: 18, ry: 10, color: HD.LIGHT.candle, i: 0.9 * k, halo: { r: 14, a: 0.12 } });
    // palm uplights
    for (const p of PALMS) L.add({ x: p.x + 1, y: p.base - 18, r: 5, ry: 26, color: HD.LIGHT.candle, i: 0.6 * k, bands: 3 });
  }

  // ------------------------------------------------------------ registration
  function register() {
    const pl = HD.PLACES && HD.PLACES[PLACE];
    if (!pl) return;
    const sky = new Int16Array(480).fill(999);
    for (let x = POD.x0; x <= POD.x1; x++) sky[x] = 181;
    for (const tw of TOWERS) {
      for (let i = 0; i < tw.w; i++) sky[tw.x0 + i] = Math.min(sky[tw.x0 + i], tw.roof[i]);
      const b0 = tw.x0 + R(tw.w * 0.34);
      const b1 = tw.x0 + R(tw.w * 0.6);
      for (let x = b0; x <= b1; x++) sky[x] = Math.min(sky[x], tw.top - 1);
    }
    pl.skyline = sky;
    pl.surfaces = [
      [POD.x0, 184, TOWERS[0].x0 - 1, 184],
      [TOWERS[0].x1 + 1, 184, TOWERS[1].x0 - 1, 184],
      [TOWERS[1].x1 + 1, 184, POD.x1, 184],
      [ENTRANCE.x0, 186, ENTRANCE.x1, 186],
      [TOWERS[0].x0, TOWERS[0].top, TOWERS[0].x1, TOWERS[0].top + SAG],
      [TOWERS[1].x0, TOWERS[1].top, TOWERS[1].x1, TOWERS[1].top + SAG],
    ];
    const drips = [];
    for (let x = ENTRANCE.x0 + 2; x < ENTRANCE.x1; x += 6) drips.push({ x, y: 191 });
    for (let x = POD.x0 + 3; x < POD.x1; x += 17) if (x < ENTRANCE.x0 - 2 || x > ENTRANCE.x1 + 2) drips.push({ x, y: 187 });
    pl.drips = drips;
  }

  HD.module('building-marina', {
    init: register,
    lights,
    passes: [
      { layer: 'scene', z: 26, id: 'towers', draw: drawTowers },
      { layer: 'scene', z: 28, id: 'podium', draw: drawPodium },
      { layer: 'scene', z: 30, id: 'palms', draw: drawPalms },
      { layer: 'scene', z: 32, id: 'hedges', draw: drawHedges },
    ],
  });
})();
