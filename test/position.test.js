// Run: node test/position.test.js – threat shapes and the incremental position (bots/lib/position.js)
const assert = require('assert');
const C = require('../engine');
const bots = require('../bots');
const PL = bots.lib.position;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const R = C.DEFAULT_RULES;
const shape = (w) => PL.SHAPE_NAMES[PL.shapeOfString(w, R)];

test('shapes under "chặn 2 đầu" (centre = the move; X own, O opponent, _ empty, # outside)', () => {
  const cases = {
    '_XXX_XXX_': 'five', '__XX_XX__': 'five', 'OXXX_O___': 'none',
    '__XX_X___': 'open-four', '_XXX____O': 'open-four',
    'O_XX_X_O_': 'four',          // two winning squares, but blocking one end kills the other five too
    '#XXX_____': 'four', 'X_XX_____': 'four', 'OX_X_X_O_': 'four',
    '__XX_____': 'open-three', '__X__X___': 'open-three',
    'O_XX_____': 'three',         // next to an opponent stone with one gap: not open under this rule
    'O_XX__O__': 'none', '_O_X_X_O_': 'none', 'OXX__XXO_': 'none',
  };
  for (const [w, want] of Object.entries(cases)) assert.strictEqual(shape(w), want, w);
});

/** Random game positions (random moves near the stones). */
function randomStates(games, plies) {
  const out = [];
  for (let g = 0; g < games; g++) {
    const rnd = bots.seededRandom(100 + g);
    // every other game under the free rule (blockedBothEnds off)
    let s = C.createGame({ rules: { size: g % 3 === 0 ? 15 : 21, blockedBothEnds: g % 2 === 0 } });
    const n = s.size;
    s = C.makeMove(s, ((n / 2) | 0) * n + ((n / 2) | 0));
    for (let i = 0; i < plies && !s.result; i++) {
      let m;
      do { const base = s.moves[Math.floor(rnd() * s.moves.length)]; m = base + (Math.floor(rnd() * 5) - 2) * n + Math.floor(rnd() * 5) - 2; }
      while (m < 0 || m >= n * n || s.board[m]);
      s = C.makeMove(s, m);
      if (i % 5 === 0) out.push(s);
    }
  }
  return out;
}
const STATES = randomStates(16, 60);

test('free rule: the shapes ignore blocked ends', () => {
  const F = { ...R, blockedBothEnds: false };
  const sh = (w) => PL.SHAPE_NAMES[PL.shapeOfString(w, F)];
  assert.strictEqual(sh('OXXX_O___'), 'none', 'still only 4 stones – no five possible');
  assert.strictEqual(sh('_OXX_XXO_'), 'five', 'blocked at both ends but wins under the free rule');
  assert.strictEqual(sh('O_XX_X_O_'), 'open-four');
  assert.strictEqual(sh('O_XX_____'), 'open-three');
});

function snapshot(pos) {
  return { board: pos.board.slice(), shapeX: pos.shape[0].slice(), shapeO: pos.shape[1].slice(), scoreX: pos.score[0].slice(),
    scoreO: pos.score[1].slice(), total: pos.total.slice(), fives: pos.fives.slice(), threats: pos.threats.slice(), near: pos.near.slice(), key: pos.key(), turn: pos.turn };
}

test('incremental updates = recomputing from scratch; unmake restores everything', () => {
  for (const s of STATES) {
    if (s.result) continue;
    const pos = new PL.Position(s);
    const before = snapshot(pos);
    const empties = C.legalMoves(s).filter((c) => pos.near[c]).slice(0, 6);
    for (const c of empties) {
      pos.make(c);
      const fresh = new PL.Position({ ...s, board: Array.from(pos.board), turn: pos.turn });
      assert.deepStrictEqual(snapshot(pos), snapshot(fresh), 'after make');
      pos.unmake();
      assert.deepStrictEqual(snapshot(pos), before, 'after unmake');
    }
  }
});

test('every real winning square has a FIVE shape, and winSquares = the engine', () => {
  let wins = 0;
  for (const s of STATES) {
    if (s.result) continue;
    const pos = new PL.Position(s);
    for (const p of [1, 2]) {
      const engine = C.legalMoves(s).filter((c) => C.wouldWin(s.board, s.size, c, p, s.rules));
      assert.deepStrictEqual(pos.winSquares(p), engine);
      for (const c of engine) assert.strictEqual(pos.maxShape(c, p), PL.FIVE);
      wins += engine.length;
    }
  }
  assert.ok(wins > 10, `only ${wins} winning squares in the sample`);
});

test('blockCandidates contains every move that stops a five (brute force)', () => {
  let checked = 0;
  for (const s of STATES) {
    if (s.result) continue;
    const pos = new PL.Position(s);
    for (const p of [1, 2]) {
      const wins = pos.winSquares(p);
      if (!wins.length) continue;
      const cand = [];
      for (const w of wins) pos.blockCandidates(w, p, cand);
      for (const c of C.legalMoves(s)) {
        const b = s.board.slice(); b[c] = 3 - p;
        const stops = wins.every((w) => w === c || !C.wouldWin(b, s.size, w, p, s.rules));
        if (stops) assert.ok(cand.includes(c), `defence ${C.squareName(c, s.size)} missing`);
      }
      checked++;
    }
  }
  assert.ok(checked > 5);
});

(async () => {
  for (const [n, fn] of tests) { await fn(); console.log('✓', n); }
  console.log(`\n${tests.length} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
