/*
 * Places: the six buildings of Purrfect Year and the anchors every module
 * agrees on (480x270 art space, y grows downward). An edition names its place
 * (edition.place); modules read HD.place() at draw time.
 *
 * Street-level stage, shared by every place unless it says otherwise:
 *   y   0 .. 206  sky, backdrop and the building (its base stands on y 206)
 *   y 206 .. 226  sidewalk (where the cats stand; feet at about y 220-224)
 *   y 226 .. 229  curb
 *   y 229 .. 270  street
 *
 * Anchors are contracts: a module may refine its own drawing by a pixel or
 * two, but the anchors themselves stay where they are, because other modules
 * (cats, decorations, weather, fireworks, lights, the sign) depend on them.
 *
 *   building   {x0, x1, top}: footprint and highest point (used as a default
 *              silhouette until the building module registers its own)
 *   catWindow  {x, y, w, h}: glass of the window the black cat sits in
 *   mascot     {x, y}: top-left of the series cat's head when he sits in it
 *              (HD.mascot.draw; 9 px wide, 12 px tall plus the tail)
 *   partner    {x, base}: where his wife sits beside him in that window
 *   entrance   {x0, x1, y0, y1}: the doors (the niece and visitors use it)
 *   sign       {x, y, w, h}: where the small AZTMM plaque or sign goes
 *   stages     named standing areas {x0, x1, base} for groups of cats
 *   puddles    engine puddle reflections when it rains (none otherwise)
 */
(function () {
  'use strict';
  const HD = (window.HD = window.HD || {});

  const STREET = { kind: 'street', sidewalk: [206, 226], curb: [226, 229], road: [229, 270] };

  const PLACES = {
    // Boston, apartment 1: a five-storey brick and metal-panel building with
    // shops on the ground floor, balconies in the recessed centre bay and a
    // silver corner tower; a plaza with street trees on its right
    apt1: {
      id: 'apt1',
      city: 'boston',
      ground: STREET,
      building: { x0: 145, x1: 326, top: 40 },
      silhouette: [
        [0, 112, 145, 206], // left neighbour block (cinema and toy-brick shops)
        [145, 52, 279, 206],
        [272, 40, 326, 206],
      ],
      floors: { retail: [172, 206], band: [166, 172], f2: [140, 166], f3: [114, 140], f4: [88, 114], f5: [60, 88] },
      catWindow: { x: 203, y: 118, w: 37, h: 20 }, // floor-3 sliding door of the centre bay
      mascot: { x: 222, y: 124 }, // sits on the sill, base y 136, behind the balcony rail
      partner: { x: 208, base: 136 },
      balcony: { x0: 198, x1: 244, rail: 130, slab: 137, above: 111 },
      entrance: { x0: 212, x1: 230, y0: 186, y1: 206, canopy: { x0: 194, x1: 248, y: 168 } },
      sign: { x: 204, y: 188, w: 6, h: 5 },
      plaza: { x0: 330, x1: 440, base: 222, trees: [338, 420], bench: [368, 386] },
      firepit: { x: 400, base: 222 },
      stages: {
        door: { x0: 206, x1: 236, base: 222 }, // in front of the lobby
        family: { x0: 160, x1: 250, base: 222 },
        group: { x0: 330, x1: 432, base: 223 }, // her friends in the plaza
      },
      puddles: [
        { x: 180, y: 218, rx: 16, ry: 2, mirror: 206, k: 0.5 },
        { x: 300, y: 244, rx: 26, ry: 3, mirror: 206, k: 0.55 },
        { x: 104, y: 252, rx: 20, ry: 2, mirror: 206, k: 0.5 },
      ],
    },

    // Boston, apartment 2: an eight-storey block, rust terra cotta in the
    // middle, a white corner tower on the left, a charcoal gateway corner with
    // the glowing lobby on the right; a small corner plaza on the far left
    apt2: {
      id: 'apt2',
      city: 'boston',
      ground: STREET,
      building: { x0: 138, x1: 338, top: 44 },
      silhouette: [
        [138, 50, 176, 206],
        [176, 57, 300, 206],
        [300, 44, 338, 206],
      ],
      catWindow: { x: 205, y: 131, w: 15, h: 16 }, // his one window, alone
      mascot: { x: 208, y: 134 },
      partner: null,
      balcony: null,
      terrace: { x0: 184, x1: 262, y: 166 }, // railed podium terrace (optional decor)
      entrance: { x0: 315, x1: 322, y0: 186, y1: 206, lobby: { x0: 302, x1: 336 }, canopy: { x0: 300, x1: 338, y: 166 } },
      sign: { x: 297, y: 189, w: 5, h: 5 },
      plaza: { x0: 20, x1: 136, base: 222, trees: [26] },
      firepit: { x: 103, base: 218 },
      stages: {
        door: { x0: 306, x1: 334, base: 222 },
        passby: { x0: 150, x1: 330, base: 223 }, // she and her friends walk past
        group: { x0: 30, x1: 132, base: 223 },
      },
      puddles: [
        { x: 250, y: 218, rx: 18, ry: 2, mirror: 206, k: 0.5 },
        { x: 170, y: 246, rx: 28, ry: 3, mirror: 206, k: 0.55 },
        { x: 400, y: 254, rx: 22, ry: 2, mirror: 206, k: 0.5 },
      ],
    },

    // New York, SoHo: a slim 20-storey hotel tower between cast-iron lofts
    // with shopfronts and fire escapes; cobbled street
    soho: {
      id: 'soho',
      city: 'nyc',
      ground: Object.assign({}, STREET, { road: [229, 270], cobbles: true }),
      building: { x0: 194, x1: 278, top: 22 },
      silhouette: [
        [194, 30, 278, 206],
        [243, 22, 248, 30],
      ],
      catWindow: { x: 250, y: 98, w: 24, h: 8 }, // their room, empty while they sit outside
      mascot: null,
      partner: null,
      entrance: { x0: 224, x1: 236, y0: 190, y1: 206, canopy: { x0: 212, x1: 249, y: 183 } },
      sign: { x: 199, y: 192, w: 5, h: 4 },
      bench: { x0: 244, x1: 274, seat: 214 },
      stages: { bench: { x0: 248, x1: 272, base: 214 }, family: { x0: 240, x1: 290, base: 222 } },
      puddles: [],
    },

    // Los Angeles, Beverly Hills: a white 12-storey hotel slab with a flat
    // porte-cochere, tall palms, low pastel shopfronts either side
    bhills: {
      id: 'bhills',
      city: 'la',
      ground: Object.assign({}, STREET, { redCurb: true }),
      building: { x0: 150, x1: 319, top: 25 },
      silhouette: [
        [150, 40, 319, 206],
        [212, 31, 249, 40],
      ],
      catWindow: { x: 275, y: 81, w: 9, h: 7 },
      mascot: null,
      partner: null,
      entrance: { x0: 225, x1: 236, y0: 191, y1: 206, canopy: { x0: 186, x1: 275, y: 175, h: 11, columns: [192, 268] } },
      sign: { x: 242, y: 193, w: 5, h: 5 },
      stages: { family: { x0: 198, x1: 262, base: 224 } },
      puddles: [],
    },

    // San Diego: twin curved mirror-glass towers on a cream podium, the
    // waterfront promenade, and the marina in front instead of a street
    marina: {
      id: 'marina',
      city: 'sandiego',
      ground: { kind: 'promenade', sidewalk: [206, 228], seawall: [228, 234], water: [234, 270], docks: [258, 262] },
      building: { x0: 138, x1: 332, top: 33 },
      silhouette: [
        [152, 33, 230, 184],
        [240, 38, 318, 184],
        [138, 184, 332, 206],
      ],
      catWindow: { x: 194, y: 115, w: 10, h: 7 },
      mascot: null,
      partner: null,
      entrance: { x0: 228, x1: 244, y0: 191, y1: 206, canopy: { x0: 220, x1: 252, y: 187 } },
      sign: { x: 208, y: 192, w: 9, h: 6 },
      castle: { x: 352, base: 224 }, // the toy-brick castle on the promenade
      stages: { family: { x0: 150, x1: 226, base: 222 } },
      puddles: [],
    },

    // Herndon, Virginia: a two-storey Queen Anne Victorian with a steep
    // front gable, a wraparound porch, a front lawn and a picket fence
    herndon: {
      id: 'herndon',
      city: 'herndon',
      ground: { kind: 'lawn', yard: [206, 234], fence: { base: 234, runs: [[0, 78], [336, 476]], gates: [80, 332] }, sidewalk: [236, 248], curb: [248, 251], road: [251, 270] },
      building: { x0: 164, x1: 328, top: 60 },
      silhouette: [
        [164, 125, 238, 206],
        [182, 92, 220, 125], // the steep gable (approximate; the module registers the exact outline)
        [195, 66, 207, 92],
        [233, 128, 309, 206],
        [250, 93, 292, 128],
        [280, 73, 288, 93], // chimney
        [232, 150, 328, 206], // porch
      ],
      catWindow: { x: 208, y: 134, w: 11, h: 21 },
      mascot: null,
      partner: null,
      porch: { x0: 232, x1: 328, floor: 196, roof: 150, posts: [236, 265, 296, 323] },
      entrance: { x0: 251, x1: 267, y0: 170, y1: 196, steps: { x0: 246, x1: 272, y0: 198, y1: 205 }, walk: { x0: 251, x1: 268 } },
      sign: { x: 243, y: 176, w: 6, h: 5 },
      table: { x: 112, base: 229 },
      stages: {
        party: { x0: 80, x1: 150, base: 229 },
        back: { x0: 84, x1: 136, base: 220 },
      },
      puddles: [],
    },
  };
  for (const id in PLACES) PLACES[id].skyline = null; // building modules may register an exact Int16Array(480) of top y per column

  HD.PLACES = PLACES;
  /** the place of the current edition */
  HD.place = () => PLACES[(HD.edition && HD.edition.place) || 'apt1'];

  /** top y of the building silhouette at column x (999 = open sky down to the ground) */
  HD.placeTop = function (x, place) {
    const p = place || HD.place();
    x = Math.round(x);
    if (p.skyline) return x >= 0 && x < p.skyline.length ? p.skyline[x] : 999;
    let top = 999;
    for (const r of p.silhouette) if (x >= r[0] && x <= r[2] && r[1] < top) top = r[1];
    return top;
  };
})();
