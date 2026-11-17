#!/usr/bin/env node
/* Benchmarks: make/unmake speed and the search bot at fixed depths on a few positions.  npm run bench */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', 'engine'));
const bots = require(path.join(__dirname, '..', 'bots'));
const PL = bots.lib.position;

// positions: greedy self-play (with a seeded random choice among the best squares) after 6, 14, 24 moves
const positions = [];
for (const [seed, plies] of [[1, 6], [2, 14], [3, 24]]) {
  let s = C.createGame();
  const rnd = bots.seededRandom(seed);
  for (let i = 0; i < plies; i++) {
    const pos = new PL.Position(s);
    let best = -1, bs = -1;
    for (let c = 0; c < pos.nn; c++) if (!pos.board[c] && (pos.near[c] || !s.moves.length)) {
      const v = pos.score[s.turn - 1][c] + 0.9 * pos.score[2 - s.turn][c] + rnd() * 50;
      if (v > bs) { bs = v; best = c; }
    }
    s = C.makeMove(s, s.moves.length ? best : 220);
  }
  positions.push(s);
}
const pos = new PL.Position(positions[2]);
const sq = [];
for (let c = 0; c < pos.nn && sq.length < 20; c++) if (!pos.board[c] && pos.near[c]) sq.push(c);
let t = performance.now();
for (let k = 0; k < 2000; k++) for (const c of sq) { pos.make(c); pos.unmake(); }
console.log(`make+unmake: ${((performance.now() - t) * 1000 / (2000 * sq.length)).toFixed(2)} µs`);
(async () => {
  for (const d of (process.argv[2] || '2,4,6').split(',').map(Number)) {
    t = performance.now();
    let nodes = 0;
    const moves = [];
    for (const s of positions) {
      const r = await bots.resolve(`search:depth=${d}`).chooseMove(C.cloneState(s), C, { side: s.turn, random: () => 0.5, now: () => performance.now() });
      nodes += r.info.nodes; moves.push(C.squareName(r.move, s.size));
    }
    const ms = performance.now() - t;
    console.log(`search depth=${d}: ${ms.toFixed(0).padStart(6)} ms ${String(nodes).padStart(8)} nodes ${(nodes / ms).toFixed(0).padStart(4)} nodes/ms   ${moves.join(' ')}`);
  }
})();
