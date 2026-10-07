# Purrfect Year: art direction and module contract

Purrfect Year plays full-screen for hours as the cover of lofi videos, so every
entry has to stay calm, cozy and readable, with motion that is lively but never
busy. One black cat, the series cat, appears in every entry and never changes.
Around him the place, the season, the weather, the time of day and the people
change from entry to entry.

## The picture

Every entry is a street-level view of one place:

- the sky at the top, then the far city, which sits between the sky and the street
- a building or house whose base stands on the line y 206
- the sidewalk where people stand (feet at about y 220–224)
- the street at the bottom (at the marina, a promenade and the water instead; at
  the house in Herndon, a lawn, a fence and a quiet street)

The focus is the building's lit **cat window** and the people outside it. The
top-left sky (`HD.layout.titleSafe`, x 8–170, y 8–70) stays calm so a title
can sit on it.

The look depends on the time of day:

| light | look |
|---|---|
| night | Strong warm/cold contrast. About 85% of the frame is cold and muted (navy, slate, violet), and the warm pockets (lit windows, lamps, lanterns, fire) keep the saturation. |
| dusk | A twilight gradient into rose and peach, the sun low on the left, the first lights coming on, a cool low mist. |
| golden | A warm low sun from the right, long shadows, gold-lit clouds, dusty haze and soft sun shafts. A pale harvest moon sits low on the left. |
| day | Real, cheerful daylight: deep blue overhead fading to pale at the horizon, the sun high on the right, crisp shadows, window glass that reflects the sky instead of glowing. |

**Nothing readable in the art.** There are no words, names, numbers, logos,
brand marks or trademarked characters anywhere. Shops have blank signs and
colourful goods. Famous skylines appear only as generic shapes (a spire, a glass
tower). National flags are allowed and are drawn accurately. The only mark is
the small AZTMM sign that `brand.js` draws at each place.

## Pixel rules

1. **Native resolution is 480×270.** The display scales by whole numbers only
   (×4 = 1920×1080, ×8 = 3840×2160), nearest neighbour.
2. **Crisp 1-px work.** Draw with the `g.*` pixel API (`px`, `rect`, `hline`,
   `vline`, `line`, `circle`, `ring`, `ellipse`, `poly`, `dither`,
   `ditherCircle`, `sprite`, `blit`) or with `ImageData`. Coordinates are
   rounded. Arcs, paths, `stroke`, gradients, filters, `shadowBlur` and canvas
   text all anti-alias, so none of them are used.
3. **Shading is banded and dithered.** Use flat colour bands, with ordered
   dithering (`HD.bayer`, `g.dither`, `g.ditherCircle`) for soft transitions.
4. **A deliberate palette.** Colours come from the `HD.PAL` ramps in
   `src/palette.js` (each ramp runs dark to light), or from ramps that a module
   defines in its own file.
5. **Bake static art.** `HD.bake(w, h, g => …)` renders into an offscreen canvas
   once, and `HD.sprite(rows, map)` builds a sprite from character rows. Per
   frame, blit the baked art and draw only what moves.
6. **Figures.** The series cat in his window is 9 px wide and 12 px tall plus a
   curled tail (`HD.mascot.draw(g, t, x, y)`, head top-left at `x, y`). Adult cats are about
   12–16 px tall and kittens 8–10 px. Idle animation runs at 6–8 fps: blinks,
   ear flicks, tail swishes, leaning.

## Palette and light

### Night colours and relighting

The scene layer is painted in **night colours**: how a surface looks under the
cold ambient light, which is its true colour (albedo) multiplied by
`HD.AMBIENT = [0.34, 0.38, 0.52]`. The engine then relights every scene pixel:

```
lit = night + night / AMBIENT × light
```

A light reveals the warm albedo hidden in the night colour. Mid-tones with some
texture warm up strongly near a lamp, and very dark colours stay dark. A module
can also write its colours as albedo and multiply them by `HD.AMBIENT` when it
bakes them, so that daylight shows exactly the colours it chose.

**Emissive pixels** (`g.em.px`, `g.em.rect`, …) are drawn into the scene but are
never relit. Flames, bulbs, lantern glass and windows lit at night are emissive.
The warm ramps (`fire`, `amber`, `warmrain`, `bulb`, `firework`, `firefly`) are
for things that give off light.

### Lights

A module adds its lights each frame in its `lights(t, L)` hook:

```js
L.add({ x, y, r, ry, color: HD.LIGHT.lantern, i, bands, dither, pow, clip, halo, day });
```

| field | meaning |
|---|---|
| `x, y, r, ry` | centre and radius (`ry` for an elliptical pool) |
| `color`, `i` | colour multipliers (`HD.LIGHT.*`) and intensity, usually from `HD.time.flicker` |
| `bands`, `dither`, `pow` | flat bands (default 5), the dither width of the seams between bands (0.55), falloff exponent (1.6) |
| `clip` | `{x0, y0, x1, y1}`: keep the light inside a rectangle, for example window light on the sidewalk |
| `halo` | `{r, a, color}`: an additive glow drawn on the fx layer at z 55 |
| `day` | `true` keeps full strength by day; other lights are dimmed |

The fx layer can sample the lightmap with `HD.lights.rgb(x, y)` and
`HD.lights.lum(x, y)`, so rain, snow and smoke pick up nearby light, and
`HD.glow(g, x, y, r, color, alpha)` adds a banded glow.

### Time of day

`edition.light` picks one of four modes, and `HD.light()` returns its settings
(`src/editions.js`):

| mode | `day` | daylight `fill` (r, g, b) | `dim` | `sun` |
|---|---|---|---|---|
| `night` | 0 | none | 1 | none |
| `dusk` | 0.3 | 0.20, 0.15, 0.17 | 0.9 | x 40, y 196 (just down on the left) |
| `golden` | 0.75 | 0.66, 0.50, 0.32 | 0.5 | x 452, y 128 (low on the right) |
| `day` | 1 | 0.72, 0.66, 0.50 | 0.25 | x 404, y 40 (high on the right) |

- **Fill.** By day the whole lightmap starts at the fill, which reveals the
  albedo: a fill of `1 − AMBIENT` shows plain albedo. Golden hour is warmer and
  lower.
- **Dim.** Placed lights are multiplied by `dim` unless they set `day: true`,
  and their halos fade faster (`dim²`).
- **Emissive stays emissive.** Emissive pixels are not relit, so they glow by
  day too. Windows by day are drawn as plain (non-emissive) glass with sky
  reflections and glints.
- **bg and fx are never relit.** The sky, the backdrops, the weather and the
  atmosphere pick their own colours for each light mode.
- `day` (0–1) is the switch modules use for window glow, lamps, fireflies and
  shadows.

### Daylight shadows

```js
L.shade({ poly: [[x, y], …], k });
```

Inside the polygon the daylight fill drops to `fill × (1 − k)`. Shading happens
before the placed lights are added, so a lamp still lights a shaded area.
Overlapping shadows don't darken each other further, and at night (no fill)
shading does nothing. Shadows fall away from `HD.light().sun`: long at golden
hour, short at midday. `street.js` casts the shadows of the buildings, trees and
lamps onto the ground. Any module can shade its own recesses, such as the
underside of a canopy or a balcony.

### Rain on the street

When `edition.weather.rain > 0`, the engine reflects the scene into the
place's `puddles` (fx z 20): each puddle is an ellipse that mirrors the picture
about its `mirror` line with a slow ripple. Entries with `puddles: false` stay
dry.

## Loop rules

- **Every frame is a pure function of `t`** over `HD.LOOP` (240 s; `?loop=`
  accepts 10–3600). Drawing code never uses `Math.random`, `Date`,
  `performance.now`, timers, or state carried from one frame to the next
  (accumulators, particle arrays, simulations). `HD.hash(a, b, c, d)` gives
  per-frame randomness, and `HD.rng(seed)` is only for building art in `init()`.
- **All motion comes from `HD.time`:**
  - `phase(t, period, off)` and `wave(t, period, off)` are oscillators.
  - `noise(t, period, seed)` and `fbm(…)` are smooth loop-safe noise.
  - `flicker(t, seed, speed)` is for fire and candles.
  - `cycle(t, i, period, seed)` gives stateless particle lives: `.age` runs
    0–1, `.rnd(k)` returns per-life randoms and `.prev` points to the previous
    life. The returned object is shared, so read it before calling again.
  - `step(t, fps)` quantises time for sprite frame rates.
- **Periods snap.** Each period is rounded so that a whole number of cycles fits
  the loop. `Math.sin(t * k)` with an arbitrary `k` would break the seam. Linear
  motion (clouds, a passing car or train) moves a whole number of tile widths or
  passes per loop.
- **Shared moments.** `src/summer.js` holds the event windows (in loop seconds)
  that several modules react to together, such as an arrival, a goal cheer or
  candles going out.
- **Live switching.** The page switches entries without reloading or running
  `init()` again. Modules read `HD.edition` and `HD.place()` when they draw, and
  cache per-entry art with `const art = HD.perEdition((ed) => HD.bake(…))`,
  calling `art()` inside `draw`. `HD.tag('wreath-balcony')` tests a decoration
  tag of the current entry.
- **Performance.** A whole frame renders in under 8 ms at 1080p on a normal
  machine, which leaves about 1 ms per module. Buildings bake their static art
  once per entry or light mode and draw only the animated parts each frame.

`node tools/verify.mjs --quick --edition ID` checks the loop, determinism, live
switching and errors, and `node tools/perf.mjs --edition ID` times every pass.

## Frame and layers

```
lights(t, L)  ->  lightmap: daylight fill, shades, then banded pools of placed light
bg passes     ->  main     unlit: sky, far city, far weather
scene passes  ->  scene    night colours, then RELIT by the lightmap (g.em pixels skip it)
fx passes     ->  main     unlit: reflections, sparks, rain, snow, smoke, haze, halos
present       ->  the canvas, scaled by a whole number
```

A module registers itself with:

```js
HD.module('name', {
  init() {},                 // once, before the first frame
  lights(t, L) {},           // L.add(...), L.shade(...)
  passes: [{ layer: 'bg' | 'scene' | 'fx', z, id, draw(g, t) {} }],
});
```

Passes run in z order within each layer, and passes with equal z run in script
load order (the order of the `<script>` tags in `index.html`). The z ranges:

| layer | z | contents |
|---|---|---|
| bg | 0–8 | sky: gradient, moon and stars (0), sun, shooting star, clouds, lightning bolt and flash |
| bg | 9 | fireworks, so they burst behind the far city |
| bg | 10–19 | backdrops: the far city |
| bg | 20–29 | far weather behind the buildings: far rain (22), far snow and gulls (23) |
| scene | 15 | street: the ground under everything that stands on it |
| scene | 23 | street: passing cars |
| scene | 25–34 | buildings, the cat window and the series cat |
| scene | 34.9 | street furniture in front of the facades (trees, lamps, benches, fence), then the AZTMM sign |
| scene | 34.95 | the marina water |
| scene | 34.97 | family: cats behind the decorations |
| scene | 35–44 | decorations, the fire pit, sparkler sticks |
| scene | 45–49 | sparkler cores and the cats outside (balcony, groups, visitors) |
| fx | 20 | engine: puddle reflections |
| fx | 21 | street: wet-road reflections |
| fx | 25–29 | rain ripples and splashes |
| fx | 30–39 | fire sparks and sparkler fizz |
| fx | 40–49 | mid rain and drips, snow, leaves, petals, fireflies, gulls |
| fx | 50–54 | atmosphere: back haze, heat shimmer, low mist, smoke and steam plumes |
| fx | 55 | engine: light halos |
| fx | 56 | brand: the New Year logo firework |
| fx | 58–69 | sun shafts, near mist, the nearest rain and weather (66–67), the vignette last (69) |

A pass that must fall between two others takes a fractional z, such as 34.97
for something drawn after the street furniture and before the decorations.

## Places and anchors

`src/places.js` defines the six places. An entry names its place
(`edition.place`), and modules read `HD.place()` when they draw.

| place | city | ground | entries |
|---|---|---|---|
| `apt1` | Boston | street; a plaza with trees at x 330–440 | diwali, halloween25, thanksgiving, christmas, newyear, lunar, easter, midsummer, match, home |
| `apt2` | Boston | street; a corner plaza at x 20–136 | harvest, halloween |
| `soho` | New York | cobbled street | nyc |
| `bhills` | Los Angeles | street with a red curb | la |
| `marina` | San Diego | promenade y 206–228, seawall 228–234, water 234–270, floating docks 258–262 | sandiego |
| `herndon` | Herndon, Virginia | lawn y 206–234, picket fence at 234, sidewalk 236–248, curb 248–251, road 251–270 | dc |

At the street places: sidewalk y 206–226, curb 226–229, road 229–270.

**Anchors are contracts.** A module may refine its own drawing by a pixel or
two, but the anchors stay where they are, because other modules (cats,
decorations, weather, fireworks, lights, the sign) depend on them.

| anchor | meaning |
|---|---|
| `building` `{x0, x1, top}` | footprint and highest point |
| `silhouette` | rectangles `[x0, y0, x1, y1]` that outline the block until the building module registers `skyline` |
| `catWindow` `{x, y, w, h}` | the glass of the window the series cat sits in |
| `mascot` `{x, y}` | top-left of the series cat's head when he sits in it |
| `partner` `{x, base}` | where a second cat sits when the window is shared |
| `balcony`, `terrace`, `porch` | rail, slab and post positions for decorations and figures |
| `entrance` | the doors, with `canopy`, `lobby`, `steps` or `walk` where the place has them |
| `sign` `{x, y, w, h}` | where the AZTMM sign goes |
| `plaza`, `firepit`, `bench`, `table`, `castle` | places for decorations, the fire pit and props |
| `stages` | named standing areas `{x0, x1, base}` for groups of cats |
| `ground` | the ground bands of the place (street, promenade or lawn) |
| `puddles` | rain reflections: `{x, y, rx, ry, mirror, k}` |

`HD.placeTop(x)` returns the top y of the place's silhouette at column `x` (999
for open sky down to the ground). Fireworks use it to burst only in open sky.
At `init()` each building module registers:

- `place.skyline`: an `Int16Array(480)` with the exact top of the block in each
  column, neighbours included
- `place.surfaces`: ledges `[x0, y0, x1, y1]` where rain splashes
- `place.drips`: `[{x, y}]` canopy and cornice edges where fat drops fall

The weather module falls back to the silhouette when these are missing.

## Who owns what

Each file belongs to one module and changes only with that module. The shared
core (`engine.js`, `palette.js`, `layout.js`, `editions.js`, `places.js`,
`festive.js`, `summer.js`, `mascot.js`) is the contract the modules rely on.

| file | module | owns |
|---|---|---|
| `sky.js` | `sky` | skies for every light mode and sky type, the sun, the moon (full, crescent, harvest), stars, drifting clouds, the occasional shooting star, lightning (a bolt and a flash) |
| `backdrops.js` | `backdrops` | the far city behind each place (Boston, New York, Los Angeles, San Diego, Herndon) in day, golden, dusk and night versions; far window lights only at dusk and night |
| `street.js` | `street` | sidewalks, curbs, roads and crosswalks per place, street lamps (lit at dusk and night), trees by season, snow cover, fallen leaves, the wet sheen in rain, passing cars, cast shadows by day |
| `building-<place>.js` | `building-<place>` | the building and its neighbours on the block; windows for each light mode; the cat window (the lit room, the series cat drawn with `HD.mascot.draw`, a second cat with `HD.drawPartner` when the window is shared, contents chosen by tag); snow on ledges; window lights; `skyline`, `surfaces` and `drips`. The sign anchor is left plain for `brand.js` |
| `decor-boston.js` | `decor-boston` | seasonal decorations at `apt1` and `apt2`, switched by tag: balconies, the plaza, the lobby, the shopfronts |
| `decor-trips.js` | `decor-trips` | props in New York, Los Angeles, San Diego and Herndon: bunting, planters, boats at the docks, a toy-brick castle, a birthday table with a cake and candles, balloons |
| `family.js` | `family` | every cat other than the series cat in his window: groups in the plaza, people walking past, outings and the party, kittens in costume; defines `HD.drawPartner` |
| `fire.js`, `fire-seasons.js` | `fire` | the fire pit (flames, sparks, warm light), fireworks in open sky with each entry's colours, sparklers |
| `weather.js`, `weather-seasons.js` | `weather` | rain, splashes, drips and ripples; snow, leaves, petals, fireflies and gulls, coloured for each light mode |
| `atmosphere.js`, `atmosphere-seasons.js` | `atmosphere` | fire pit smoke, vent and manhole steam, rain mist, haze by light mode, marine haze, heat shimmer, golden sun shafts, the vignette |
| `brand.js` | `brand` | the small AZTMM sign at `place.sign` (a plaque or a hanging blade sign, lit by the scene with a rare glint) and the New Year logo firework |
