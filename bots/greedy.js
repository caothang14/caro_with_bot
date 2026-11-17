/*
 * Greedy bot (1 ply): plays the square with the best attack + defence score (square scores of lib/position.js).
 * Wins at once if it can, blocks a four. `randomness` > 0 picks at random among the best few (difficulty "Dễ").
 */
CaroBots.module(function (root) {
  'use strict';
  const Bots = root.CaroBots;

  Bots.register({
    id: 'greedy',
    name: 'Bot nhìn 1 nước',
    description: 'Chỉ nhìn nước hiện tại: chọn ô vừa tấn công vừa phòng thủ tốt nhất, thắng ngay nếu được, chặn nước bốn.',
    params: { defense: 0.9, randomness: 0, top: 5 },
    chooseMove(state, C, ctx) {
      const PL = Bots.lib.position;
      const n = state.size, p = ctx.params;
      if (!state.moves.length) return ((n / 2) | 0) * n + ((n / 2) | 0);
      const pos = new PL.Position(state);
      const me = pos.turn, op = 3 - me;
      const win = pos.winSquares(me);
      if (win.length) return { move: win[0], info: { score: 1e6 } };
      const block = pos.winSquares(op);
      if (block.length) return { move: block[0], info: { score: -1 } };
      const cands = [];
      for (let c = 0; c < pos.nn; c++) {
        if (pos.board[c] || !pos.near[c]) continue;
        cands.push([c, pos.score[me - 1][c] + p.defense * pos.score[op - 1][c]]);
      }
      cands.sort((a, b) => b[1] - a[1]);
      if (p.randomness > 0) {
        // among the `top` best squares within `randomness` (fraction) of the best score, weighted by score
        const best = cands[0][1];
        const pool = cands.slice(0, p.top).filter(([, s]) => s >= best * (1 - p.randomness));
        let r = ctx.random() * pool.reduce((a, [, s]) => a + s + 1, 0);
        for (const [c, s] of pool) if ((r -= s + 1) <= 0) return { move: c, info: { score: s } };
      }
      return { move: cands[0][0], info: { score: cands[0][1] } };
    },
  });
});
