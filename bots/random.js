/* Random bot: any empty square next to the stones (lowest baseline for the arena). */
CaroBots.module(function (root) {
  'use strict';
  root.CaroBots.register({
    id: 'random',
    name: 'Bot ngẫu nhiên',
    description: 'Đánh ngẫu nhiên vào một ô cạnh các quân đã có.',
    hidden: true,
    chooseMove(state, C, ctx) {
      const n = state.size;
      if (!state.moves.length) return ((n / 2) | 0) * n + ((n / 2) | 0);
      const near = C.legalMoves(state).filter((sq) => {
        const x = sq % n, y = (sq / n) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((dx || dy) && xx >= 0 && xx < n && yy >= 0 && yy < n && state.board[yy * n + xx]) return true;
        }
        return false;
      });
      return near[Math.floor(ctx.random() * near.length)];
    },
  });
});
