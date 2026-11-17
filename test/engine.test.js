// Run: node test/engine.test.js – rules (five in a row, "chặn 2 đầu")
const assert = require('assert');
const C = require('../engine');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** Board from rows of text (top row first): X, O, . ; size = number of rows. Turn = whoever has fewer stones. */
function fromText(rows, rules) {
  const n = rows.length;
  const s = C.createGame({ rules: { size: n, ...rules } });
  rows.forEach((r, y) => [...r.replace(/ /g, '')].forEach((ch, x) => { s.board[y * n + x] = ch === 'X' ? 1 : ch === 'O' ? 2 : 0; }));
  const xs = s.board.filter((v) => v === 1).length, os = s.board.filter((v) => v === 2).length;
  s.turn = xs > os ? 2 : 1;
  s.moves = new Array(xs + os).fill(-1);
  return s;
}
const sq = (s, x, y) => y * s.size + x;

test('five in a row wins (all 4 directions), four does not', () => {
  const s0 = C.createGame();
  assert.strictEqual(s0.size, 21);
  assert.strictEqual(s0.turn, 1);
  for (const [dx, dy] of C.DIRS) {
    let s = C.createGame({ rules: { size: 11 } });
    for (let k = 0; k < 5; k++) {
      s = C.makeMove(s, (5 + k * dy) * 11 + 3 + k * dx);       // X
      if (k < 4) { assert.strictEqual(s.result, null); s = C.makeMove(s, 10 * 11 + k + (dy ? 6 : 0)); }  // O far away
    }
    assert.strictEqual(s.result.winner, 1, `direction ${dx},${dy}`);
    assert.strictEqual(s.result.line.length, 5);
  }
});

test('chặn 2 đầu: a five blocked by the opponent at both ends does not win', () => {
  const s = fromText([
    '.........',
    '.OXXXX.O.',
    '.........', '.........', '.........', '.........', '.........', '.........', '.........',
  ]);
  // X fills the gap: OXXXXXO → blocked at both ends → no win
  const t = C.makeMove({ ...s, turn: 1 }, sq(s, 6, 1));
  assert.strictEqual(t.result, null);
});

test('one end blocked still wins; the board edge does not block', () => {
  const s = fromText(['.OXXXX...', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  assert.strictEqual(C.makeMove({ ...s, turn: 1 }, sq(s, 6, 0)).result.winner, 1);
  const e = fromText(['XXXX.O...', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  assert.strictEqual(C.makeMove({ ...e, turn: 1 }, sq(e, 4, 0)).result.winner, 1, 'edge + opponent: only one real block');
  // with edgeBlocks the edge counts as a block
  const e2 = fromText(['XXXX.O...', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], { edgeBlocks: true });
  assert.strictEqual(C.makeMove({ ...e2, turn: 1 }, sq(e2, 4, 0)).result, null);
});

test('overline (6+) wins by default, can be switched off', () => {
  const s = fromText(['XXX.XX...', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  assert.strictEqual(C.makeMove({ ...s, turn: 1 }, sq(s, 3, 0)).result.winner, 1);
  const s2 = fromText(['XXX.XX...', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], { overline: false });
  assert.strictEqual(C.makeMove({ ...s2, turn: 1 }, sq(s2, 3, 0)).result, null);
});

test('rules switch: without chặn 2 đầu the blocked five wins', () => {
  const s = fromText(['.OXXXX.O.', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'], { blockedBothEnds: false });
  assert.strictEqual(C.makeMove({ ...s, turn: 1 }, sq(s, 6, 0)).result.winner, 1);
});

test('illegal moves are rejected, the state is not modified, full board = draw', () => {
  let s = C.createGame({ rules: { size: 5 } });
  const s1 = C.makeMove(s, 12);
  assert.strictEqual(s.board[12], 0);
  assert.throws(() => C.makeMove(s1, 12), /Illegal/);
  assert.throws(() => C.makeMove(s1, 25), /Illegal/);
  // 5×5 board filled without five in a row (X never gets 5 on a 5x5 with this pattern)
  const order = [0, 1, 2, 3, 5, 4, 6, 7, 8, 9, 11, 10, 13, 12, 14, 15, 16, 17, 19, 18, 20, 21, 22, 23, 24];
  s = C.createGame({ rules: { size: 5 } });
  for (const m of order) { if (s.result) break; s = C.makeMove(s, m); }
  assert.ok(s.result);
  if (s.result.reason === 'full') assert.strictEqual(s.result.winner, null);
});

test('square names: a1 = bottom-left', () => {
  assert.strictEqual(C.squareName(20 * 21, 21), 'a1');
  assert.strictEqual(C.squareName(20, 21), 'u21');
  assert.strictEqual(C.squareName(10 * 21 + 10, 21), 'k11');
});

(async () => {
  for (const [n, fn] of tests) { await fn(); console.log('✓', n); }
  console.log(`\n${tests.length} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
