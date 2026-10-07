/*
 * Editions: the sixteen entries of the Purrfect Year diary, from Diwali 2025
 * to Halloween 2026, in story order. The same black cat appears in every
 * entry; the place (see src/places.js), the time of day, the weather and the
 * people around him change.
 *
 * Every module reads HD.edition at DRAW time (never only at init), so the page
 * can switch editions live. Cache edition-specific art with HD.perEdition().
 *
 * Pick an edition with ?edition=<id> or #<id>. In the live page with neither,
 * the entry whose dates contain today (Boston time) is chosen (HD.todayMD, set
 * by the page); tools and exports default to 'halloween'.
 */
(function () {
  'use strict';
  const HD = (window.HD = window.HD || {});

  // Field reference (what each module switches on):
  //  place    'apt1' | 'apt2' | 'soho' | 'bhills' | 'marina' | 'herndon'  (src/places.js; buildings, street, backdrops)
  //  light    'night' | 'dusk' | 'golden' | 'day'   time of day; see HD.light() below
  //  sky      'clear' | 'fair' | 'broken' | 'overcast' | 'dusk'  (sky; by day 'clear' is blue, 'fair' adds cumulus)
  //  stars    0..1 density of visible stars;  moon 'full' | 'harvest' | 'crescent' | 'none'
  //  weather  { rain, snow, leaves, petals, fireflies, gulls, lightning }  intensities 0..1 (weather)
  //  season   'winter' | 'spring' | 'summer' | 'autumn'  (street trees, planters, ground cover)
  //  fire     'firepit' | 'none'   a courtyard fire pit (fire)
  //  fireworks 0..1 how busy the sky is, fireworkColors (fire)
  //  cast     who is where (family):
  //             window: 'together' (him + his wife in the cat window) | 'alone' (him) | 'empty'
  //             out: 'none' | 'friends' (she and her friends celebrate in the plaza) | 'passby' (they walk past)
  //             party: 'none' | 'match' (he is on his balcony) | 'bench' (the couple on a bench)
  //                    | 'trip' (him, the niece, his sister and her husband) | 'birthday' (plus his dad)
  //             niece: true = the niece visits (comes and goes)
  //  tags     decorations (decor modules)
  //  puddles  false = dry ground (engine)
  const W = (a, b) => [a, b];
  const EDITIONS = [
    {
      id: 'diwali', name: 'Festival of Lights', festival: 'Diwali', year: 2025, when: 'October 20, 2025',
      dates: [[W([10, 15], [10, 27]), W([11, 4], [11, 19])]],
      blurb: 'Diyas on the balcony and a rangoli in the plaza: the two of them at home together.',
      place: 'apt1', light: 'night', sky: 'clear', stars: 0.7, moon: 'none', season: 'autumn',
      weather: { rain: 0, snow: 0, leaves: 0.2, petals: 0, fireflies: 0, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 0.5, fireworkColors: ['gold', 'magenta', 'green', 'gold', 'white'],
      cast: { window: 'together', out: 'none', party: 'none', niece: false },
      tags: ['diyas-balcony', 'rangoli-plaza', 'string-lights-gold', 'marigolds', 'sparklers'],
    },
    {
      id: 'halloween25', name: 'Rainy Hollow', festival: 'Halloween', year: 2025, when: 'October 31, 2025',
      dates: null,
      blurb: 'A cold rainy Halloween: pumpkins on the balcony and the two of them at the window.',
      place: 'apt1', light: 'night', sky: 'overcast', stars: 0, moon: 'full', season: 'autumn',
      weather: { rain: 1, snow: 0, leaves: 0.3, petals: 0, fireflies: 0, gulls: 0, lightning: 1 },
      fire: 'none', fireworks: 0,
      cast: { window: 'together', out: 'none', party: 'none', niece: false },
      tags: ['pumpkins-balcony', 'jackolanterns-plaza', 'trick-or-treat', 'cobwebs'],
    },
    {
      id: 'thanksgiving', name: 'Thanksgiving', festival: 'Thanksgiving', year: 2025, when: 'November 27, 2025',
      dates: [W([11, 20], [11, 30])],
      blurb: 'A golden late afternoon: she and her friends with warm mugs by the fire pit, he at the window.',
      place: 'apt1', light: 'golden', sky: 'broken', stars: 0, moon: 'harvest', season: 'autumn',
      weather: { rain: 0, snow: 0, leaves: 0.8, petals: 0, fireflies: 0, gulls: 0, lightning: 0 },
      fire: 'firepit', fireworks: 0,
      cast: { window: 'alone', out: 'friends', party: 'none', niece: false },
      tags: ['harvest-planters', 'leaf-garland', 'plaid-blankets', 'warm-mugs'],
    },
    {
      id: 'christmas', name: 'Snowfall', festival: 'Christmas & Hanukkah', year: 2025, when: 'December 2025',
      dates: [W([12, 1], [12, 30])],
      blurb: 'Snow on the balconies, a tree in the plaza and carols going by.',
      place: 'apt1', light: 'night', sky: 'overcast', stars: 0, moon: 'none', season: 'winter',
      weather: { rain: 0, snow: 1, leaves: 0, petals: 0, fireflies: 0, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 0,
      cast: { window: 'alone', out: 'friends', party: 'none', niece: false },
      tags: ['wreath-balcony', 'string-lights-color', 'plaza-xmas-tree', 'menorah-window', 'snowman-plaza', 'carolers'],
    },
    {
      id: 'newyear', name: 'Midnight', festival: "New Year's Eve", year: 2025, when: 'December 31, 2025',
      dates: [W([12, 31], [1, 15])],
      blurb: 'Fireworks over the river at midnight; party hats in the plaza.',
      place: 'apt1', light: 'night', sky: 'clear', stars: 0.6, moon: 'crescent', season: 'winter',
      weather: { rain: 0, snow: 0.25, leaves: 0, petals: 0, fireflies: 0, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 1,
      cast: { window: 'alone', out: 'friends', party: 'none', niece: false },
      tags: ['string-lights-gold', 'party-windows', 'sparklers', 'logo-firework'],
    },
    {
      id: 'lunar', name: 'Red Lanterns', festival: 'Lunar New Year', year: 2026, when: 'February 17, 2026',
      dates: [W([1, 16], [3, 14])],
      blurb: 'Red lanterns on the balcony, light snow and fireworks for the new year.',
      place: 'apt1', light: 'night', sky: 'clear', stars: 0.6, moon: 'none', season: 'winter',
      weather: { rain: 0, snow: 0.3, leaves: 0, petals: 0, fireflies: 0, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 0.45, fireworkColors: ['red', 'gold', 'gold', 'white'],
      cast: { window: 'alone', out: 'friends', party: 'none', niece: false },
      tags: ['red-lanterns-balcony', 'red-banners', 'tangerines', 'plaza-lanterns', 'plum-vase'],
    },
    {
      id: 'easter', name: 'Blossom Morning', festival: 'Easter', year: 2026, when: 'April 5, 2026',
      dates: [W([3, 15], [5, 20])],
      blurb: 'A sunny Easter morning: blossom on the street trees and an egg hunt in the plaza.',
      place: 'apt1', light: 'day', sky: 'fair', stars: 0, moon: 'none', season: 'spring',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0.8, fireflies: 0, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 0,
      cast: { window: 'alone', out: 'friends', party: 'none', niece: false },
      tags: ['flower-boxes-balcony', 'eggs-plaza', 'egg-basket'],
    },
    {
      id: 'midsummer', name: 'Firefly Midsummer', festival: 'Midsummer', year: 2026, when: 'June 2026',
      dates: [W([5, 21], [6, 10])],
      blurb: 'The shortest night: flower crowns round the fire pit and fireflies in the plaza.',
      place: 'apt1', light: 'dusk', sky: 'clear', stars: 0.6, moon: 'full', season: 'summer',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 1, gulls: 0, lightning: 0 },
      fire: 'firepit', fireworks: 0,
      cast: { window: 'alone', out: 'friends', party: 'none', niece: false },
      tags: ['flower-garland-balcony', 'paper-lantern-string', 'flower-crowns'],
    },
    {
      id: 'match', name: 'Match Night', festival: 'Football summer', year: 2026, when: 'June - July 2026',
      dates: [W([6, 11], [7, 3])],
      blurb: 'Flags on the balconies, the match on TV and a cheer when the goal goes in.',
      place: 'apt1', light: 'night', sky: 'clear', stars: 0.6, moon: 'crescent', season: 'summer',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0.6, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 0,
      cast: { window: 'empty', out: 'friends', party: 'match', niece: true },
      tags: ['flags-matchday', 'saltire-banner', 'tv-match', 'pub-sign', 'football', 'goal-fireworks'],
    },
    {
      id: 'nyc', name: 'Anniversary in New York', festival: 'Fourth of July', year: 2026, when: 'July 4, 2026',
      dates: [W([7, 4], [7, 7])],
      blurb: 'An anniversary on the Fourth: shopping bags, a bench in SoHo and fireworks over the skyline.',
      place: 'soho', light: 'night', sky: 'clear', stars: 0.3, moon: 'none', season: 'summer',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 0.8, fireworkColors: ['red', 'white', 'blue', 'red', 'white', 'blue', 'gold'],
      cast: { window: 'empty', out: 'none', party: 'bench', niece: false },
      tags: ['bunting-usa', 'shopping-bags', 'heart-lantern'],
    },
    {
      id: 'la', name: 'West Coast', festival: 'Summer trip', year: 2026, when: 'July 2026',
      dates: [W([7, 8], [7, 15])],
      blurb: 'A hot, dry Beverly Hills afternoon under the palms.',
      place: 'bhills', light: 'day', sky: 'clear', stars: 0, moon: 'none', season: 'summer', puddles: false,
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 0,
      cast: { window: 'empty', out: 'none', party: 'trip', niece: true },
      tags: ['valet-stand', 'planters'],
    },
    {
      id: 'sandiego', name: 'Zoo, Bricks & Bay', festival: 'Summer trip', year: 2026, when: 'July 2026',
      dates: [W([7, 16], [7, 31])],
      blurb: 'A sunny day by the marina, a toy-brick castle and a little rider on his shoulders.',
      place: 'marina', light: 'day', sky: 'fair', stars: 0, moon: 'none', season: 'summer',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0, gulls: 1, lightning: 0 },
      fire: 'none', fireworks: 0,
      cast: { window: 'empty', out: 'none', party: 'trip', niece: true, shoulderRide: true },
      tags: ['boats', 'brick-castle', 'giraffe-plush'],
    },
    {
      id: 'dc', name: 'Birthday in Virginia', festival: 'A birthday', year: 2026, when: 'August 2026',
      dates: [W([8, 1], [8, 24])],
      blurb: 'A warm summer evening and a birthday cake in the front yard: candles, balloons and the whole family.',
      place: 'herndon', light: 'dusk', sky: 'clear', stars: 0.4, moon: 'full', season: 'summer',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0.7, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 0,
      cast: { window: 'empty', out: 'none', party: 'birthday', niece: true },
      tags: ['birthday-table', 'balloons', 'bunting-party'],
    },
    {
      id: 'home', name: 'Home to Boston', festival: 'End of summer', year: 2026, when: 'late August 2026',
      dates: [W([8, 25], [8, 31])],
      blurb: 'Back home as the summer sky turns pink: the two of them in the window, the niece drops by.',
      place: 'apt1', light: 'dusk', sky: 'dusk', stars: 0.3, moon: 'crescent', season: 'summer',
      weather: { rain: 0, snow: 0, leaves: 0, petals: 0, fireflies: 0.8, gulls: 0, lightning: 0 },
      fire: 'none', fireworks: 0,
      cast: { window: 'together', out: 'none', party: 'none', niece: true },
      tags: ['flower-boxes-balcony'],
    },
    {
      id: 'harvest', name: 'Golden Harvest', festival: 'Harvest & Mid-Autumn', year: 2026, when: 'September 2026',
      dates: [W([9, 1], [10, 14])],
      blurb: 'A golden late afternoon at a new address: one lit window, leaves tumbling, the harvest moon rising.',
      place: 'apt2', light: 'golden', sky: 'broken', stars: 0, moon: 'harvest', season: 'autumn',
      weather: { rain: 0, snow: 0, leaves: 0.8, petals: 0, fireflies: 0, gulls: 0, lightning: 0 },
      fire: 'firepit', fireworks: 0,
      cast: { window: 'alone', out: 'passby', party: 'none', niece: false },
      tags: ['harvest-planters', 'mooncakes-sill'],
    },
    {
      id: 'halloween', name: 'Rainy Hollow', festival: 'Halloween', year: 2026, when: 'October 31, 2026',
      dates: [W([10, 28], [11, 3])],
      blurb: 'Halloween again, a year on: rain on a new window, and he watches the costumes go by.',
      place: 'apt2', light: 'night', sky: 'overcast', stars: 0, moon: 'full', season: 'autumn',
      weather: { rain: 1, snow: 0, leaves: 0.3, petals: 0, fireflies: 0, gulls: 0, lightning: 1 },
      fire: 'none', fireworks: 0,
      cast: { window: 'alone', out: 'passby', party: 'none', niece: false },
      tags: ['pumpkins-lobby', 'jackolanterns-plaza', 'trick-or-treat', 'costumes'],
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
    if (!range) return false; // reachable from the picker only
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
