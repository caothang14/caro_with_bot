/*
 * Search bot: negamax alpha-beta + iterative deepening on the fast position (lib/position.js), with:
 *   - forced moves: a side that can win at once wins; a side facing a four only considers the moves that really stop
 *     it (under "chặn 2 đầu" an end stone can stop a five too) – none left = lost;
 *   - threat-aware move lists: facing an open three / four-three, only counter-fours and squares on the threat;
 *     otherwise the `width` best squares by attack + defence score;
 *   - quiescence = VCF: at the leaves the side to move keeps playing fours (each one forces the reply) up to qPly;
 *   - transposition table, CPU budget per move (maxNodes + predictStop, like the cotuong bot's eco mode).
 *
 * Params (override with a spec, e.g. 'search:depth=4' or 'search:maxTimeMs=500'):
 *   depth        > 0: fixed depth (reproducible); 0: time-based
 *   maxDepth     depth cap of the time-based search
 *   maxTimeMs    time cap per move (ms)
 *   maxNodes     node budget per move (also a hard cap), 0 = none
 *   predictStop  do not start an iteration predicted not to finish within the time / node budget
 *   width, rootWidth   number of candidate squares searched at inner nodes / at the root (quiet positions)
 *   defense      weight of the opponent's square score when ordering moves (attack + defense × opponent)
 *   evalOpp      weight of the opponent's total in the evaluation (side to move: own total − evalOpp × opponent's)
 *   qPly         maximum length of the VCF (fours) sequence in quiescence (plies)
 *   randomness   > 0: pick at random among root moves scoring at most this much below the best (difficulty levels)
 */
CaroBots.module(function (root) {
  'use strict';
  const Bots = root.CaroBots;

  const INF = 1e9;
  const WIN = 1e7;
  const MATE_ZONE = WIN - 1000;
  const TIMEOUT = { timeout: true };
  const EXACT = 0, LOWER = 1, UPPER = 2;

  function createSearcher(state, ctx) {
    const PL = Bots.lib.position;
    const p = ctx.params;
    const pos = new PL.Position(state);
    const TT = new Map();
    let nodes = 0, deadline = Infinity, nodeLimit = Infinity;
    const history = new Int32Array(pos.nn);

    function checkTime() {
      if ((++nodes & 255) === 0 && (ctx.now() > deadline || nodes > nodeLimit)) throw TIMEOUT;
    }

    const evaluate = () => {
      const me = pos.turn - 1;
      return pos.total[me] - p.evalOpp * pos.total[1 - me];
    };

    /**
     * Moves that stop all of `op`'s winning squares `wins`: the squares on the lines through them (a stone on a
     * winning square, or on the far end of the five, under "chặn 2 đầu"), kept only if no winning square is left.
     */
    function defenses(wins, op) {
      const cand = [];
      for (const w of wins) pos.blockCandidates(w, op, cand);
      const out = [];
      for (const c of cand) {
        pos.make(c);
        let ok = true;
        for (const w2 of wins) if (w2 !== c && pos.exactWin(w2, op)) { ok = false; break; }
        pos.unmake();
        if (ok) out.push(c);
      }
      return out;
    }

    /** Ordered candidate moves for the side to move (no immediate win for it; the opponent has no four). */
    function candidates(width, ttMove) {
      const me = pos.turn, op = 3 - me;
      const sm = pos.score[me - 1], so = pos.score[op - 1];
      const threat = pos.threats[op - 1] > 0;
      const list = [];
      for (let c = 0; c < pos.nn; c++) {
        if (pos.board[c] || !pos.near[c]) continue;
        if (threat && !(so[c] >= PL.DEFAULT_WEIGHTS.shape[PL.OPEN_THREE] || pos.makesFour(c, me))) continue;
        list.push(c);
      }
      const key = (c) => (c === ttMove ? 1e12 : sm[c] + p.defense * so[c] + history[c] * 0.01);
      list.sort((a, b) => key(b) - key(a));
      return threat ? list : list.slice(0, width);
    }

    function orderBy(list, ttMove) {
      const me = pos.turn, sm = pos.score[me - 1], so = pos.score[2 - me];
      const key = (c) => (c === ttMove ? 1e12 : sm[c] + p.defense * so[c]);
      return list.sort((a, b) => key(b) - key(a));
    }

    /** VCF quiescence: forced defences, else stand pat or keep making fours. */
    function qsearch(alpha, beta, ply, qply) {
      checkTime();
      const me = pos.turn, op = 3 - me;
      if (pos.winSquares(me).length) return WIN - ply;
      if (pos.stones === pos.nn) return 0;
      const opWins = pos.winSquares(op);
      if (opWins.length) {
        const def = defenses(opWins, op);
        if (!def.length) return -(WIN - ply - 1);
        if (qply >= p.qPly) return evaluate();
        let best = -INF;
        for (const c of orderBy(def)) {
          pos.make(c);
          let v;
          try { v = -qsearch(-beta, -alpha, ply + 1, qply + 1); } finally { pos.unmake(); }
          if (v > best) best = v;
          if (v > alpha) alpha = v;
          if (alpha >= beta) break;
        }
        return best;
      }
      const stand = evaluate();
      if (stand >= beta || qply >= p.qPly) return stand;
      if (stand > alpha) alpha = stand;
      let best = stand;
      const fours = [];
      for (let c = 0; c < pos.nn; c++) if (!pos.board[c] && pos.near[c] && pos.makesFour(c, me)) fours.push(c);
      orderBy(fours);
      for (let i = 0; i < fours.length && i < 8; i++) {
        pos.make(fours[i]);
        let v;
        try { v = -qsearch(-beta, -alpha, ply + 1, qply + 1); } finally { pos.unmake(); }
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    }

    function search(depth, alpha, beta, ply) {
      checkTime();
      const me = pos.turn, op = 3 - me;
      if (pos.winSquares(me).length) return WIN - ply;
      if (pos.stones === pos.nn) return 0;
      const opWins = pos.winSquares(op);
      let moves;
      if (opWins.length) {
        moves = defenses(opWins, op);
        if (!moves.length) return -(WIN - ply - 1);
      }
      if (depth <= 0) return qsearch(alpha, beta, ply, 0);
      const key = pos.key();
      const e = TT.get(key);
      if (e && e.depth >= depth) {
        const v = e.value > MATE_ZONE ? e.value - ply : e.value < -MATE_ZONE ? e.value + ply : e.value;
        if (e.flag === EXACT || (e.flag === LOWER && v >= beta) || (e.flag === UPPER && v <= alpha)) return v;
      }
      const ttMove = e ? e.move : -1;
      moves = moves ? orderBy(moves, ttMove) : candidates(p.width, ttMove);
      const alpha0 = alpha;
      let best = -INF, bestMove = moves[0];
      for (const c of moves) {
        pos.make(c);
        let v;
        try { v = -search(depth - 1, -beta, -alpha, ply + 1); } finally { pos.unmake(); }
        if (v > best) { best = v; bestMove = c; }
        if (v > alpha) alpha = v;
        if (alpha >= beta) { history[c] += depth * depth; break; }
      }
      if (TT.size > 400000) TT.clear();
      const stored = best > MATE_ZONE ? best + ply : best < -MATE_ZONE ? best - ply : best;
      TT.set(key, { depth, value: stored, flag: best >= beta ? LOWER : best <= alpha0 ? UPPER : EXACT, move: bestMove });
      return best;
    }

    /** Root moves: winning move / forced defences / candidates. */
    function rootMoves() {
      const me = pos.turn, op = 3 - me;
      const win = pos.winSquares(me);
      if (win.length) return { forced: win[0], win: true };
      const opWins = pos.winSquares(op);
      if (opWins.length) {
        const def = defenses(opWins, op);
        if (!def.length) return { forced: opWins[0] };       // lost anyway: at least block one
        return { moves: orderBy(def) };
      }
      return { moves: candidates(p.rootWidth, -1) };
    }

    function think(timeMs) {
      const t0 = ctx.now();
      deadline = p.depth > 0 ? Infinity : t0 + timeMs;
      if (p.depth <= 0 && p.maxNodes > 0) nodeLimit = p.maxNodes;
      const n = pos.n;
      if (!pos.stones) return { move: ((n / 2) | 0) * n + ((n / 2) | 0), score: 0, depth: 0, nodes: 0 };
      const rm = rootMoves();
      if (rm.forced != null) return { move: rm.forced, score: rm.win ? WIN - 1 : -(WIN - 2), depth: 0, nodes: 0, forced: true };
      let moves = rm.moves;
      if (moves.length === 1) return { move: moves[0], score: 0, depth: 0, nodes: 0, forced: true };
      let best = { move: moves[0], score: 0, depth: 0 };
      let scores = null, prevIterNodes = 0;
      const maxDepth = p.depth > 0 ? p.depth : p.maxDepth;
      for (let depth = 1; depth <= maxDepth; depth++) {
        const iterNodes0 = nodes, iterT0 = ctx.now();
        let alpha = -INF, iterBest = null, iterScore = -INF;
        const sc = new Map();
        try {
          for (const c of moves) {
            pos.make(c);
            let v;
            try { v = -search(depth - 1, -INF, p.randomness ? INF : -alpha, 1); } finally { pos.unmake(); }   // randomness: exact scores
            sc.set(c, v);
            if (v > iterScore) { iterScore = v; iterBest = c; }
            if (v > alpha) alpha = v;
          }
        } catch (err) {
          if (err !== TIMEOUT) throw err;
          if (iterBest != null && iterBest !== best.move && sc.size > 1) best = { move: iterBest, score: iterScore, depth: depth - 1, partial: true };
          break;
        }
        best = { move: iterBest, score: iterScore, depth };
        scores = sc;
        moves = moves.slice().sort((a, b) => (sc.get(b) ?? -INF) - (sc.get(a) ?? -INF));
        if (Math.abs(iterScore) > MATE_ZONE) break;                   // forced win / loss found
        if (p.depth <= 0) {
          const iterN = nodes - iterNodes0, iterMs = ctx.now() - iterT0;
          let growth = prevIterNodes > 0 ? iterN / prevIterNodes : 4;
          growth = Math.min(12, Math.max(2, growth)) * 1.3;
          prevIterNodes = iterN;
          if (p.maxNodes > 0 && nodes + iterN * growth > p.maxNodes) break;
          const elapsed = ctx.now() - t0;
          if (p.predictStop ? elapsed + iterMs * growth > timeMs : elapsed > timeMs * 0.45) break;
        }
      }
      if (p.randomness > 0 && scores && Math.abs(best.score) < MATE_ZONE) {
        const cands = [...scores].filter(([, s]) => s >= best.score - p.randomness);
        let r = ctx.random() * cands.reduce((a, [, s]) => a + 1 - (best.score - s) / p.randomness + 1e-6, 0);
        for (const [c, s] of cands) {
          if ((r -= 1 - (best.score - s) / p.randomness + 1e-6) <= 0) { best = { ...best, move: c, score: s }; break; }
        }
      }
      return { ...best, nodes };
    }

    return { think, pos };
  }

  Bots.register({
    id: 'search',
    name: 'Bot tìm kiếm',
    description: 'Tính trước nhiều nước (alpha-beta), luôn xét các chuỗi nước bốn liên tục để thắng hoặc chặn kịp.',
    params: {
      depth: 0, maxDepth: 20, maxTimeMs: 1500, maxNodes: 300000, predictStop: true,
      width: 10, rootWidth: 16, defense: 0.9, evalOpp: 1, qPly: 10, randomness: 0,
    },
    chooseMove(state, C, ctx) {
      const timeMs = Math.min(ctx.timeBudgetMs || ctx.params.maxTimeMs, ctx.params.maxTimeMs);
      const r = createSearcher(state, ctx).think(timeMs);
      return { move: r.move, info: { score: Math.round(r.score), depth: r.depth, nodes: r.nodes } };
    },
  });

  Bots.lib.search = { createSearcher, WIN };
});
