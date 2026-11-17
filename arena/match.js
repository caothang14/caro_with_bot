/*
 * Plays one game between 2 bots (Node or browser – no DOM dependency).
 *
 *   const rec = await playGame({ C, bots, seed: 1, x: 'search', o: 'greedy' });
 *
 * opts: seed (bots get a seeded ctx.random derived from it), x / o (bot specs; X moves first),
 *       moveTimeMs (time budget per move, default 1000), openingMoves (number of random opening moves near the centre,
 *       derived from the seed – gives varied games between deterministic bots; default 2), rules.
 * Returns { seed, x, o, result, moves, plies, stats, finalAscii }.
 */
(function (root) {
  'use strict';
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  async function playGame(opts) {
    const { C, bots, seed = 1, x, o, moveTimeMs = 1000, openingMoves = 2, rules } = opts;
    const players = { 1: bots.resolve(x), 2: bots.resolve(o) };
    const randoms = { 1: bots.seededRandom(seed ^ 0x9e3779b9), 2: bots.seededRandom(seed ^ 0x85ebca6b) };
    const stats = { 1: { moves: 0, timeMs: 0, maxMs: 0, depthSum: 0, nodes: 0 }, 2: { moves: 0, timeMs: 0, maxMs: 0, depthSum: 0, nodes: 0 } };
    let s = C.createGame({ rules });
    // random opening: the centre, then squares within 2 of it (same for both colour assignments of a seed)
    const rnd = bots.seededRandom(seed * 7919 + 13);
    const n = s.size, mid = (n / 2) | 0;
    for (let i = 0; i < openingMoves && !s.result; i++) {
      let sq;
      if (i === 0) sq = mid * n + mid;
      else do { sq = (mid + Math.floor(rnd() * 5) - 2) * n + mid + Math.floor(rnd() * 5) - 2; } while (s.board[sq]);
      s = C.makeMove(s, sq);
    }
    while (!s.result) {
      const side = s.turn;
      const t0 = now();
      const ctx = { side, ply: s.moves.length, random: randoms[side], now, timeBudgetMs: moveTimeMs, deadline: t0 + moveTimeMs, history: s.moves.slice() };
      let out;
      try {
        out = await players[side].chooseMove(C.cloneState(s), C, ctx);
      } catch (err) {
        return { seed, x, o, result: { winner: 3 - side, reason: 'bot-error', detail: String(err && err.stack || err) }, moves: s.moves, plies: s.moves.length, stats };
      }
      const ms = now() - t0, st = stats[side];
      st.moves++; st.timeMs += ms; st.maxMs = Math.max(st.maxMs, ms); st.depthSum += out.info.depth || 0; st.nodes += out.info.nodes || 0;
      if (!C.isLegal(s, out.move)) {
        return { seed, x, o, result: { winner: 3 - side, reason: 'illegal-move', detail: String(out.move) }, moves: s.moves, plies: s.moves.length, stats };
      }
      s = C.makeMove(s, out.move);
    }
    return { seed, x, o, result: s.result, moves: s.moves, plies: s.moves.length, stats, finalAscii: C.toAscii(s) };
  }

  const api = { playGame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CaroMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
