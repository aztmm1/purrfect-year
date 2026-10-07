/*
 * Editions — the Purrfect Year series. Same cottage, same black cat in the
 * upper-right window, fourteen entries across 2026 on a Boston calendar.
 *
 * Every module reads HD.edition at DRAW time (never only at init), so the page
 * can switch editions live. Cache edition-specific art with HD.perEdition().
 *
 * Pick an edition with ?edition=<id> or #<id>. In the live page with neither,
 * the edition whose dates contain today is chosen (HD.todayMD, set by the page);
 * tools/export default to 'halloween'.
 */
(function () {
  'use strict';
  const HD = (window.HD = window.HD || {});

  // Field reference (what each module switches on):
  //  light    'night' (default) | 'dusk' | 'golden' | 'day'  time of day; see HD.light() below
  //  puddles  false = dry ground, no puddle reflections (engine)
  //  sky      'overcast' | 'broken' | 'clear' | 'fair' | 'dusk'  (bg; by day 'clear' is blue sky, 'fair' adds cumulus)
  //  stars    0..1 density of visible stars           (bg)
  //  moon     'full' | 'harvest' | 'crescent' | 'none'(bg)
  //  weather  { rain, snow, leaves, petals, fireflies }  intensities 0..1 (weather)
  //  ground   'wet-autumn' | 'leafy' | 'dry-autumn' | 'snow' | 'thin-snow' | 'spring' | 'summer' (ground)
  //  tree     'bare' | 'autumn' | 'blossom' | 'plum' | 'summer' | 'snowy'  (props)
  //  fire     'campfire' | 'bonfire' | 'none'         (fire)
  //  fireworks 0..1 how busy the sky is               (fire module owns fireworks)
  //  tags     decorations / yard sets, see SEASONS.md for who draws each
  const EDITIONS = [
    {
      id: 'lunar',
      name: 'Red Lanterns',
      festival: 'Lunar New Year',
      season: 'winter',
      when: 'late January - mid March',
      dates: [[1, 20], [3, 14]],
      blurb: 'Red lanterns glow in the snowy tree, plum blossoms bloom in the window and distant fireworks welcome the new year.',
      sky: 'clear',
      stars: 0.8,
      moon: 'none',
      weather: { rain: 0, snow: 0.3, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'thin-snow',
      tree: 'snowy',
      fire: 'none',
      fireworks: 0.45,
      fireworkColors: ['red', 'gold', 'gold', 'white'],
      tags: ['roof-snow-light', 'red-lanterns', 'red-banners', 'firecrackers', 'tree-red-lanterns', 'garden', 'tangerines', 'paper-cuts', 'plum-vase', 'secret-hibernating-frog'],
    },
    {
      id: 'spring',
      name: 'Blossom Morning',
      festival: 'Easter',
      season: 'spring',
      when: 'mid March - May',
      dates: [[3, 15], [5, 20]],
      blurb: 'A sunny Easter morning: a breeze shakes petals from the cherry tree onto hidden painted eggs.',
      light: 'day',
      sky: 'fair',
      stars: 0,
      moon: 'none',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0.8, fireflies: 0 },
      ground: 'spring',
      tree: 'blossom',
      fire: 'none',
      fireworks: 0,
      tags: ['window-boxes', 'flower-wreath', 'seedlings', 'eggs', 'flower-beds', 'garden', 'birdhouse', 'frog', 'secret-rabbit-burrow'],
    },
    {
      id: 'summer',
      name: 'Firefly Midsummer',
      festival: 'Midsummer',
      season: 'summer',
      when: 'late May - June 10',
      dates: [[5, 21], [6, 10]],
      blurb: 'The shortest night: a midsummer bonfire at late dusk, paper lanterns and a meadow full of fireflies.',
      light: 'dusk',
      sky: 'clear',
      stars: 0.6,
      moon: 'full',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 1 },
      ground: 'summer',
      tree: 'summer',
      fire: 'bonfire',
      fireworks: 0,
      tags: ['window-boxes', 'flower-garland', 'open-windows', 'paper-lantern-string', 'flower-beds', 'hammock', 'garden', 'lily-pond', 'secret-ant-colony'],
    },
    // ---- Summer Story chapters (SUMMER.md) ----
    {
      id: 'match', name: 'Match Night', festival: 'Football summer', season: 'summer', story: true,
      when: 'June 11 - July 3', dates: [[6, 11], [7, 3]],
      blurb: 'Flags out for the big match: a glowing TV, a cozy pub sign and a cheer when the goal goes in.',
      sky: 'clear', stars: 0.6, moon: 'crescent', backdrop: 'boston',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0.6 },
      ground: 'summer', tree: 'summer', fire: 'none', fireworks: 0,
      tags: ['cat-away', 'flags-matchday', 'saltire-banner', 'tv-match', 'pub-sign', 'football', 'us-flag-pole', 'window-boxes', 'garden', 'family-match', 'secret-ant-colony'],
    },
    {
      id: 'nyc', name: 'Anniversary in New York', festival: 'Fourth of July', season: 'summer', story: true,
      when: 'July 4 - 7', dates: [[7, 4], [7, 7]],
      blurb: 'An anniversary on the Fourth: pizza, lemonade and fireworks over the New York skyline.',
      sky: 'clear', stars: 0.4, moon: 'none', backdrop: 'nyc',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0.3 },
      ground: 'summer', tree: 'summer', fire: 'none', fireworks: 0.8,
      fireworkColors: ['red', 'white', 'blue', 'red', 'white', 'blue', 'gold'],
      tags: ['cat-away', 'anniversary-bench', 'us-flag-pole', 'bunting-usa', 'propliner', 'garden', 'family-nyc', 'secret-ant-colony'],
    },
    {
      id: 'la', name: 'West Coast', festival: 'Summer trip', season: 'summer', story: true,
      when: 'July 8 - 15', dates: [[7, 8], [7, 15]],
      blurb: 'A hot, dry Los Angeles afternoon under palm trees and a clear blue sky.',
      light: 'day', sky: 'clear', stars: 0, moon: 'none', backdrop: 'la', puddles: false,
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'summer', tree: 'summer', fire: 'none', fireworks: 0,
      tags: ['cat-away', 'plaza-lights', 'patio-heater', 'garden', 'family-trip', 'secret-ant-colony'],
    },
    {
      id: 'sandiego', name: 'Zoo, Bricks & Bay', festival: 'Summer trip', season: 'summer', story: true,
      when: 'July 16 - 31', dates: [[7, 16], [7, 31]],
      blurb: 'A sunny day by the bay: giraffes over the fence, a toy-brick castle and a little rider on your shoulders.',
      light: 'day', sky: 'fair', stars: 0, moon: 'none', backdrop: 'sandiego',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'summer', tree: 'summer', fire: 'none', fireworks: 0,
      tags: ['cat-away', 'giraffes', 'brick-castle', 'brick-cat', 'boat', 'garden', 'family-trip', 'shoulder-ride', 'secret-ant-colony'],
    },
    {
      id: 'dc', name: 'Birthday in DC', festival: 'A birthday', season: 'summer', story: true,
      when: 'August 1 - 24', dates: [[8, 1], [8, 24]],
      blurb: 'A warm summer evening and a birthday cake under the Capitol dome: candles, balloons and the whole family.',
      light: 'dusk', sky: 'clear', stars: 0.4, moon: 'full', backdrop: 'dc',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0.7 },
      ground: 'summer', tree: 'summer', fire: 'none', fireworks: 0,
      tags: ['cat-away', 'birthday-table', 'balloons', 'bunting-party', 'garden', 'family-birthday', 'secret-ant-colony'],
    },
    {
      id: 'home', name: 'Home to Boston', festival: 'End of summer', season: 'summer', story: true,
      when: 'August 25 - 31', dates: [[8, 25], [8, 31]],
      blurb: 'Back home under the Boston skyline as the summer sky turns pink.',
      light: 'dusk', sky: 'dusk', stars: 0.3, moon: 'crescent', backdrop: 'boston',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0.8 },
      ground: 'summer', tree: 'summer', fire: 'none', fireworks: 0,
      tags: ['us-flag-pole', 'window-boxes', 'garden', 'family-home', 'secret-ant-colony'],
    },
    {
      id: 'harvest',
      name: 'Golden Harvest',
      festival: 'Harvest, Mid-Autumn & Thanksgiving',
      season: 'autumn',
      when: 'September and Thanksgiving week',
      dates: [[[9, 1], [9, 30]], [[11, 21], [11, 30]]],
      blurb: 'A golden late afternoon: the harvest moon rising over hay bales, lanterns and leaves tumbling on the breeze.',
      light: 'golden',
      sky: 'broken',
      stars: 0,
      moon: 'harvest',
      weather: { rain: 0, snow: 0, leaves: 0.8, petals: 0, fireflies: 0 },
      ground: 'leafy',
      tree: 'autumn',
      fire: 'campfire',
      fireworks: 0,
      tags: ['harvest-lanterns', 'paper-lantern-string', 'corn-bundles', 'leaf-wreath', 'pie-sill', 'hay-bales', 'scarecrow', 'pumpkin-patch', 'harvest-pumpkins', 'crows', 'secret-squirrel-stash'],
    },
    {
      id: 'halloween',
      name: 'Rainy Hollow',
      festival: 'Halloween',
      season: 'autumn',
      when: 'October',
      dates: [[10, 1], [10, 31]],
      blurb: 'A cold rainy night, a crackling campfire and jack-o\'-lanterns flickering by the porch.',
      sky: 'overcast',
      stars: 0,
      moon: 'full',
      weather: { rain: 1, snow: 0, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'wet-autumn',
      tree: 'bare',
      fire: 'campfire',
      fireworks: 0,
      tags: ['graveyard', 'jackolanterns', 'pumpkin-patch', 'crows', 'bats', 'lightning', 'secret-coffin'],
    },
    {
      id: 'lights',
      name: 'Festival of Lights',
      festival: 'Diwali',
      season: 'autumn',
      when: 'November 1 - 20',
      dates: [[11, 1], [11, 20]],
      blurb: 'Rows of little clay lamps, marigold garlands, a rangoli by the door and fireworks far away.',
      sky: 'clear',
      stars: 0.9,
      moon: 'none',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'dry-autumn',
      tree: 'autumn',
      fire: 'none',
      fireworks: 0.6,
      fireworkColors: ['gold', 'magenta', 'green', 'gold', 'blue', 'white'],
      tags: ['diyas-house', 'diyas-yard', 'marigolds', 'string-lights-gold', 'tree-fairy-lights', 'rangoli', 'garden', 'secret-clay-pot'],
    },
    {
      id: 'winter',
      name: 'Snowed In',
      festival: 'Christmas & Hanukkah',
      season: 'winter',
      when: 'December 1 - 30',
      dates: [[12, 1], [12, 30]],
      blurb: 'Deep snow, icicles and twinkling lights, with a menorah and a decorated tree in the windows.',
      sky: 'overcast',
      stars: 0,
      moon: 'none',
      weather: { rain: 0, snow: 1, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'snow',
      tree: 'snowy',
      fire: 'none',
      fireworks: 0,
      tags: ['roof-snow', 'icicles', 'wreath', 'string-lights-color', 'xmas-tree', 'menorah', 'snowman', 'sled', 'garden', 'frozen-puddles', 'secret-hedgehog'],
    },
    {
      id: 'newyear',
      name: 'Midnight Fireworks',
      festival: "New Year's Eve",
      season: 'winter',
      when: 'New Year’s Eve - January 19',
      dates: [[12, 31], [1, 19]],
      blurb: 'Fireworks burst over the snowy hills while sparklers fizz and the fire pit keeps everyone warm.',
      sky: 'clear',
      stars: 0.7,
      moon: 'crescent',
      weather: { rain: 0, snow: 0.25, leaves: 0, petals: 0, fireflies: 0 },
      ground: 'thin-snow',
      tree: 'snowy',
      fire: 'campfire',
      fireworks: 1,
      fireworkColors: ['gold', 'white', 'red', 'blue', 'violet', 'green', 'gold'],
      tags: ['roof-snow-light', 'string-lights-gold', 'tree-fairy-lights', 'party-windows', 'bunting', 'snowman', 'sparklers', 'garden', 'frozen-puddles', 'secret-time-capsule'],
    },
  ];
  for (const e of EDITIONS) e.tagSet = new Set(e.tags);

  /*
   * Time of day. day: 0 night .. 1 full daylight (modules switch window glow,
   * lamps, fireflies, sky and shadows on it). fill: the uniform daylight added
   * to the lightmap (1 - AMBIENT reveals the true albedo; golden is warmer and
   * lower). dim: how strongly placed lights still show (1 at night). sun: where
   * the sun is (bg draws it; shadows fall away from it).
   */
  const LIGHTING = {
    night: { mode: 'night', day: 0, fill: [0, 0, 0], dim: 1, sun: null },
    dusk: { mode: 'dusk', day: 0.3, fill: [0.2, 0.15, 0.17], dim: 0.9, sun: { x: 40, y: 196 } },
    golden: { mode: 'golden', day: 0.75, fill: [0.66, 0.5, 0.32], dim: 0.5, sun: { x: 452, y: 128 } },
    day: { mode: 'day', day: 1, fill: [0.72, 0.66, 0.5], dim: 0.25, sun: { x: 404, y: 40 } },
  };
  HD.LIGHTING = LIGHTING;
  /** lighting of the current edition */
  HD.light = () => LIGHTING[HD.edition.light || 'night'] || LIGHTING.night;
  HD.EDITIONS = EDITIONS;
  const byId = new Map(EDITIONS.map((e) => [e.id, e]));
  HD.editionById = (id) => byId.get(id);

  function inRange(md, range) {
    if (Array.isArray(range[0][0])) return range.some((r) => inRange(md, r)); // several windows
    const v = md[0] * 100 + md[1];
    const a = range[0][0] * 100 + range[0][1];
    const b = range[1][0] * 100 + range[1][1];
    return a <= b ? v >= a && v <= b : v >= a || v <= b; // ranges may wrap the new year
  }

  function initialId() {
    const p = new URLSearchParams(location.search);
    const q = p.get('edition');
    if (q && byId.has(q)) return q;
    const h = (location.hash || '').replace('#', '');
    if (h && byId.has(h)) return h;
    const exportMode = p.has('export') && p.get('export') !== '0';
    if (!exportMode && HD.todayMD) {
      const hit = EDITIONS.find((e) => inRange(HD.todayMD, e.dates));
      if (hit) return hit.id;
    }
    return 'halloween';
  }

  HD.edition = byId.get(initialId());
  /** true if the current edition carries decoration/yard tag `t` */
  HD.tag = (t) => HD.edition.tagSet.has(t);

  const listeners = [];
  /** subscribe to edition changes (UI only; drawing just reads HD.edition) */
  HD.onEdition = (fn) => listeners.push(fn);
  /** switch edition live */
  HD.setEdition = function (id) {
    const e = byId.get(id);
    if (!e || e === HD.edition) return;
    HD.edition = e;
    for (const fn of listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error(err);
      }
    }
  };

  /**
   * Lazily build and cache something per edition:
   *   const art = HD.perEdition((ed) => HD.bake(...));   ...   g.sprite(art(), x, y)
   */
  HD.perEdition = function (build) {
    const cache = new Map();
    return function () {
      const e = HD.edition;
      let v = cache.get(e.id);
      if (v === undefined) {
        v = build(e);
        cache.set(e.id, v);
      }
      return v;
    };
  };
})();
