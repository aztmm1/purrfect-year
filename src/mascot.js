/*
 * The series cat: the same black cat, with the same sprite and animation, in
 * every entry of the diary (he is the one who never changes). Buildings draw
 * him in their cat window with HD.mascot.draw(g, t, x, y), where (x, y) is
 * the top-left of his head; he is 9 px wide and 12 px tall, and his tail
 * curls up to 3 px past his right side. Draw him on the scene layer, in the
 * window, before anything that should cover him (a balcony rail, a frame).
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;

  const HEAD = {
    front: ['.K.....K.', '.KK...KK.', '.KKKKKKK.', '.KeKKKeK.', '.KKKKKKK.', '..KKKKK..'],
    twitch: ['.......K.', 'KKK...KK.', '.KKKKKKK.', '.KeKKKeK.', '.KKKKKKK.', '..KKKKK..'],
    side: ['..K..K...', '..KK.KK..', '..KKKKKK.', '..KKKKKKK', '..KKKKKK.', '...KKKK..'],
  };
  const BODY = ['..KKKKK..', '.KKKKKKK.', '.KKKKKKKK', 'KKKKKKKKK', 'KKKKKKKKK', 'KKKKKKKKK'];
  const C = P.violet[0];
  const EYE = HD.color.mix(P.amber[7], P.spirit[3], 0.45);

  let body = null;
  let heads = null;
  function bake() {
    const map = { K: C, e: C };
    body = HD.sprite(BODY, map);
    heads = {};
    for (const k in HEAD) heads[k] = HD.sprite(HEAD[k], map);
  }

  /** draw the series cat with his head's top-left at (bx, by) */
  function draw(g, t, bx, by) {
    if (!body) bake();
    const ts = T.step(t, 12);
    // head pose: now and then he turns to watch something on the right
    const look = T.noise(ts, 17, 303);
    const side = look > 0.7;
    // ear twitch: short, every ~9 s
    const ec = T.cycle(ts, 0, 9.3, 305);
    const eAge = ec.age * ec.P;
    const eAt = 1 + ec.rnd(1) * (ec.P - 2);
    const twitch = !side && eAge > eAt && eAge < eAt + 0.25;
    // blink: every ~5 s, sometimes a double blink
    const bc = T.cycle(ts, 1, 5.1, 307);
    const bAge = bc.age * bc.P;
    const bAt = 0.5 + bc.rnd(1) * (bc.P - 1.2);
    const dbl = bc.rnd(2) < 0.3;
    const blink = (bAge > bAt && bAge < bAt + 0.15) || (dbl && bAge > bAt + 0.3 && bAge < bAt + 0.42);
    g.reset();
    g.sprite(body, bx, by + 6);
    g.sprite(heads[side ? 'side' : twitch ? 'twitch' : 'front'], bx, by);
    if (!side && !blink) {
      g.px(bx + 2, by + 3, EYE);
      g.px(bx + 6, by + 3, EYE);
    }
    // tail: a tapered curl rising from the right haunch, slowly swishing
    const sw = T.wave(ts, 7.3);
    const fl = T.wave(ts, 2.45, 0.2) * 0.5 + 0.5;
    let x = bx + 8.6;
    let y = by + 10.4;
    let ang = 0.25;
    const curl = 0.27 + 0.09 * sw;
    for (let k = 0; k < 9; k++) {
      const rx = Math.round(x);
      const ry = Math.round(y);
      g.px(rx, ry, C);
      if (k < 7) {
        // 2px thick: widen across the direction of travel
        if (Math.abs(Math.sin(ang)) > Math.abs(Math.cos(ang))) g.px(rx - (Math.cos(ang) > 0 ? 1 : -1), ry, C);
        else g.px(rx, ry + 1, C);
      }
      ang += curl + (k > 5 ? 0.22 * fl : 0);
      x += Math.cos(ang);
      y -= Math.sin(ang);
    }
  }

  HD.mascot = { draw, w: 9, h: 12, color: C, eye: EYE };
})();
