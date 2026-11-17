// Run: node test/bots.test.js – bots: forced wins/defences, VCF, legality, levels, Web Worker source
const assert = require('assert');
const vm = require('vm');
const C = require('../engine');
const bots = require('../bots');
require('../bots/worker');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** 15×15 board from a list of [x, y, 'X'|'O']; turn given explicitly. */
function setup(stones, turn, size = 15) {
  const s = C.createGame({ rules: { size } });
  for (const [x, y, p] of stones) s.board[y * size + x] = p === 'X' ? 1 : 2;
  s.turn = turn === 'X' ? 1 : 2;
  s.moves = stones.map(([x, y]) => y * size + x);
  return s;
}
const ctx = (s) => ({ side: s.turn, random: () => 0.5, now: () => performance.now(), timeBudgetMs: 1000 });
const play = async (spec, s) => bots.resolve(spec).chooseMove(C.cloneState(s), C, ctx(s));
const at = (s, m) => [m % s.size, (m / s.size) | 0];

test('every registered bot plays a legal move, the first move is the centre', async () => {
  for (const b of bots.list()) {
    const s0 = C.createGame();
    const r0 = await play(b.id, s0);
    assert.strictEqual(r0.move, 10 * 21 + 10, b.id);
    const s1 = C.makeMove(C.makeMove(s0, r0.move), 10 * 21 + 11);
    const r1 = await play(b.id, s1);
    assert.ok(C.isLegal(s1, r1.move), b.id);
  }
});

test('wins at once when it can (search, greedy)', async () => {
  const s = setup([[3, 7, 'X'], [4, 7, 'X'], [5, 7, 'X'], [6, 7, 'X'], [3, 8, 'O'], [4, 8, 'O'], [5, 8, 'O'], [9, 9, 'O']], 'X');
  for (const spec of ['search:depth=2', 'greedy', 'level-2']) {
    const r = await play(spec, s);
    assert.ok([[2, 7], [7, 7]].some(([x, y]) => at(s, r.move)[0] === x && at(s, r.move)[1] === y), spec);
  }
});

test('blocks a four – including from the far end under "chặn 2 đầu"', async () => {
  // O threatens O(3..6,7) + 7,7 = five; its other end (2,7) is already X → X can also stop it by… only (7,7) here
  const s = setup([[3, 7, 'O'], [4, 7, 'O'], [5, 7, 'O'], [6, 7, 'O'], [2, 7, 'X'], [6, 6, 'X'], [9, 9, 'X']], 'X');
  const r = await play('search:depth=2', s);
  assert.deepStrictEqual(at(s, r.move), [7, 7]);
  // O _ O O O O _ X pattern: O has a four whose completion at (2,5) makes a five ending next to X at (8,5)?
  // here the five O(3..7,5)+(2,5) has ends (1,5) = X and (8,5) = empty → X may block at (2,5) or make (8,5)... see below
  const t = setup([[3, 5, 'O'], [4, 5, 'O'], [5, 5, 'O'], [6, 5, 'O'], [1, 5, 'X'], [7, 5, 'X'], [10, 10, 'X']], 'X');
  // O's only win: (2,5) → five 2..6 with ends (1,5)=X and (7,5)=X → blocked both ends → NOT a win. So no threat at all.
  const pos = new bots.lib.position.Position(t);
  assert.deepStrictEqual(pos.winSquares(2), []);
});

test('stops a five by playing beyond its end (chặn 2 đầu) when that is the only defence', async () => {
  // O: (4..7,6) four, open on both sides at (3,6) and (8,6); X stone at (2,6) and (9,6)?  Then completing at (3,6) gives
  // five 3..7 with ends (2,6)=X, (8,6)=empty → wins; completing at (8,6) gives 4..8 with ends (3,6)=empty,(9,6)=X → wins.
  // X can stop both: a stone on (3,6) also blocks the far end of the five 4..8? ends would be (3,6)=X and (9,6)=X → yes.
  const s = setup([[4, 6, 'O'], [5, 6, 'O'], [6, 6, 'O'], [7, 6, 'O'], [2, 6, 'X'], [9, 6, 'X'], [11, 11, 'X'], [12, 1, 'O']], 'X');
  const pos = new bots.lib.position.Position(s);
  assert.strictEqual(pos.winSquares(2).length, 2);
  const r = await play('search:depth=2', s);
  assert.ok([[3, 6], [8, 6]].some(([x, y]) => at(s, r.move)[0] === x && at(s, r.move)[1] === y), `played ${at(s, r.move)}`);
  const after = C.makeMove(s, r.move);
  const pos2 = new bots.lib.position.Position(after);
  assert.deepStrictEqual(pos2.winSquares(2), [], 'O has no winning square left');
});

test('sees a forced win: a move making two fours at once (depth 1)', async () => {
  // X three (5..7,5) blocked on the left by O, X three (8,6..8) blocked below by O: (8,5) makes two fours whose
  // winning squares (9,5) and (8,4) are on different lines → O cannot stop both
  const s = setup([
    [5, 5, 'X'], [6, 5, 'X'], [7, 5, 'X'], [8, 6, 'X'], [8, 7, 'X'], [8, 8, 'X'],
    [4, 5, 'O'], [8, 9, 'O'], [12, 12, 'O'], [1, 1, 'O'], [13, 1, 'O'], [1, 13, 'O'],
  ], 'X');
  const r = await play('search:depth=1', s);
  assert.deepStrictEqual(at(s, r.move), [8, 5]);
  assert.ok(r.info.score > 1e6, `score ${r.info.score}`);
});

test('finds a VCF (consecutive fours) through quiescence', async () => {
  // X (6,3) = four on row 3 (O must answer at (7,3) or, under chặn 2 đầu, (8,3)); that stone also turns column 6 into
  // X_XXO, so X (6,4) then makes two fours at once (column + row 4) → win. Found at depth 1 by the fours-only quiescence.
  const s = setup([
    [3, 3, 'X'], [4, 3, 'X'], [5, 3, 'X'], [6, 5, 'X'], [6, 6, 'X'], [7, 4, 'X'], [8, 4, 'X'], [9, 4, 'X'],
    [2, 3, 'O'], [6, 7, 'O'], [10, 4, 'O'], [0, 14, 'O'], [14, 0, 'O'], [14, 14, 'O'], [0, 0, 'O'], [14, 7, 'O'],
  ], 'X');
  assert.deepStrictEqual(new bots.lib.position.Position(s).winSquares(1), [], 'no immediate win');
  const r = await play('search:depth=1', s);
  assert.ok(r.info.score > 1e6, `score ${r.info.score}`);
});

test('search beats greedy and greedy beats random (short match)', async () => {
  const { playGame } = require('../arena/match');
  let searchWins = 0, greedyWins = 0;
  for (let seed = 1; seed <= 2; seed++) {
    for (const [x, o] of [['search:maxTimeMs=150', 'greedy'], ['greedy', 'search:maxTimeMs=150']]) {
      const r = await playGame({ C, bots, seed, x, o, moveTimeMs: 150 });
      if (r.result.winner && (r.result.winner === 1 ? x : o).startsWith('search')) searchWins++;
    }
    const g = await playGame({ C, bots, seed, x: 'random', o: 'greedy' });
    if (g.result.winner === 2) greedyWins++;
  }
  assert.ok(searchWins >= 3, `search won ${searchWins}/4`);
  assert.strictEqual(greedyWins, 2);
});

test('difficulty levels 1..3 exist', () => {
  assert.deepStrictEqual(bots.levels().map((b) => b.id), ['level-1', 'level-2', 'level-3']);
});

/** Runs the worker source in a fresh VM context (like a real Web Worker built from a Blob). */
function fakeWorker() {
  const out = [];
  const ctx = vm.createContext({ performance, console, postMessage: (m) => out.push(JSON.parse(JSON.stringify(m))) });
  vm.runInContext('globalThis.self = globalThis;', ctx);
  vm.runInContext(globalThis.CaroBotWorker.buildSource(globalThis.CaroSources), ctx);
  return { out, send: async (msg) => { const n = out.length; await ctx.onmessage({ data: JSON.parse(JSON.stringify(msg)) }); return out.slice(n); } };
}
test('the Web Worker source has every bot and plays the same move as the main thread', async () => {
  const w = fakeWorker();
  for (const b of bots.list()) assert.ok(w.out[0].bots.includes(b.id), b.id);
  let s = C.createGame();
  for (const m of [220, 221, 199, 241]) s = C.makeMove(s, m);
  const c = { side: s.turn, ply: 4, timeBudgetMs: 1000, history: [] };
  const [res] = await w.send({ id: 1, type: 'move', spec: 'search:depth=3', state: s, ctx: c });
  assert.ok(res.ok, res.error);
  const local = await play('search:depth=3', s);
  assert.strictEqual(res.result.move, local.move);
  assert.strictEqual(res.result.info.nodes, local.info.nodes);
});

(async () => {
  for (const [n, fn] of tests) { await fn(); console.log('✓', n); }
  console.log(`\n${tests.length} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
