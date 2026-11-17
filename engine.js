/*
 * Cờ caro (Gomoku) – rules engine, "chặn 2 đầu" variant.
 * Pure logic, no DOM. Works in the browser (window.Caro) and in Node (require('./engine')).
 *
 * Board: size × size (default 21 × 21), square index = y * size + x. Cell values: 0 empty, 1 = X, 2 = O.
 * X moves first.
 *
 * Rules (DEFAULT_RULES, all configurable):
 *   - A line of 5 or more stones of one player (horizontal, vertical, diagonal) wins …
 *   - … unless BOTH ends of the line are blocked by the opponent's stones ("chặn 2 đầu" – blockedBothEnds).
 *     The board edge does not count as a block (edgeBlocks: false).
 *   - Lines longer than 5 also win (overline: true).
 *   - Board full without a winner → draw.
 *
 * The state is a plain object (cloneable into a Web Worker): makeMove returns a NEW state.
 */
(function (factory) {
  // The factory is also kept as source text for the bot Web Worker (bots/worker.js).
  (globalThis.CaroSources = globalThis.CaroSources || []).push({ name: 'engine.js', factory });
  factory(globalThis);
})(function (root) {
  'use strict';

  const X = 1, O = 2;
  const DEFAULT_RULES = {
    size: 21,
    blockedBothEnds: true,   // a five blocked at both ends by the opponent does not win
    edgeBlocks: false,       // the board edge counts as a block
    overline: true,          // 6+ in a row wins
  };
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const opp = (p) => 3 - p;

  function createGame(opts = {}) {
    const rules = { ...DEFAULT_RULES, ...(opts.rules || {}) };
    const n = rules.size;
    return {
      rules,
      size: n,
      board: new Array(n * n).fill(0),
      turn: X,
      moves: [],          // square indices in play order
      result: null,       // { winner: 1 | 2 | null, reason: 'five' | 'full' | …, line?: [squares] }
    };
  }

  const cloneState = (s) => ({ ...s, rules: { ...s.rules }, board: s.board.slice(), moves: s.moves.slice(), result: s.result ? { ...s.result } : null });

  /**
   * If the stone of `player` on square `sq` (already placed on `board`) completes a winning line, returns the
   * squares of that line, else null.
   */
  function winningLine(board, size, sq, player, rules = DEFAULT_RULES) {
    const x0 = sq % size, y0 = (sq / size) | 0;
    const o = opp(player);
    for (const [dx, dy] of DIRS) {
      let a = 0, b = 0;   // stones before / after sq along the direction
      while (true) {
        const x = x0 - (a + 1) * dx, y = y0 - (a + 1) * dy;
        if (x < 0 || x >= size || y < 0 || y >= size || board[y * size + x] !== player) break;
        a++;
      }
      while (true) {
        const x = x0 + (b + 1) * dx, y = y0 + (b + 1) * dy;
        if (x < 0 || x >= size || y < 0 || y >= size || board[y * size + x] !== player) break;
        b++;
      }
      const len = a + b + 1;
      if (len < 5 || (!rules.overline && len > 5)) continue;
      if (rules.blockedBothEnds) {
        const blocked = (x, y) => (x < 0 || x >= size || y < 0 || y >= size ? !!rules.edgeBlocks : board[y * size + x] === o);
        if (blocked(x0 - (a + 1) * dx, y0 - (a + 1) * dy) && blocked(x0 + (b + 1) * dx, y0 + (b + 1) * dy)) continue;
      }
      const line = [];
      for (let k = -a; k <= b; k++) line.push((y0 + k * dy) * size + x0 + k * dx);
      return line;
    }
    return null;
  }

  /** Would playing `player` on the empty square `sq` win? (board not modified) */
  function wouldWin(board, size, sq, player, rules = DEFAULT_RULES) {
    if (board[sq]) return false;
    board[sq] = player;
    const w = winningLine(board, size, sq, player, rules);
    board[sq] = 0;
    return !!w;
  }

  function isLegal(state, sq) {
    return !state.result && Number.isInteger(sq) && sq >= 0 && sq < state.board.length && state.board[sq] === 0;
  }

  /** All empty squares (every empty square is a legal move). */
  function legalMoves(state) {
    if (state.result) return [];
    const out = [];
    for (let i = 0; i < state.board.length; i++) if (!state.board[i]) out.push(i);
    return out;
  }

  /** Plays the side to move on square sq. Returns a NEW state. */
  function makeMove(state, sq) {
    if (state.result) throw new Error('Game is over');
    if (!isLegal(state, sq)) throw new Error('Illegal move');
    const s = cloneState(state);
    const p = s.turn;
    s.board[sq] = p;
    s.moves.push(sq);
    s.turn = opp(p);
    const line = winningLine(s.board, s.size, sq, p, s.rules);
    if (line) s.result = { winner: p, reason: 'five', line };
    else if (s.moves.length === s.board.length) s.result = { winner: null, reason: 'full' };
    return s;
  }

  // ---------- Notation ----------
  /** Column letters a, b, … (skipping none), row numbers 1.. from the bottom, like a chess board. */
  const COLS = 'abcdefghijklmnopqrstuvwxyz';
  const squareName = (sq, size) => COLS[sq % size] + (size - ((sq / size) | 0));
  const PLAYER_VI = { 1: 'X', 2: 'O' };

  function toAscii(state) {
    const n = state.size, rows = [];
    for (let y = 0; y < n; y++) {
      let r = String(n - y).padStart(2) + ' ';
      for (let x = 0; x < n; x++) r += ['.', 'X', 'O'][state.board[y * n + x]] + ' ';
      rows.push(r);
    }
    rows.push('   ' + COLS.slice(0, n).split('').join(' '));
    return rows.join('\n');
  }

  const api = {
    X, O, DIRS, DEFAULT_RULES, PLAYER_VI, opp,
    createGame, cloneState, makeMove, isLegal, legalMoves, winningLine, wouldWin,
    squareName, toAscii,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Caro = api;
});
