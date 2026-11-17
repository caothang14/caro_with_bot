/*
 * Fast mutable position + threat shapes for the caro bots: CaroBots.lib.position
 *
 * Shapes. For an empty square c, a player p and a direction d, the SHAPE is what p would make along d by playing c,
 * read from the 9-square window centred on c (4 squares on each side). It is defined through the real win rule
 * (engine.js: five or more, not blocked by the opponent at both ends, board edge does not block), so "chặn 2 đầu"
 * is handled automatically – e.g. OXXXX_O is not a four: completing it gives a five blocked at both ends.
 *
 *   FIVE        playing c wins (a line through c)
 *   OPEN_FOUR   after c, the opponent cannot stop every winning square with one stone (2 winning squares are not
 *               always enough here: in O_XXXX_O blocking one end also blocks the far end of the other five)
 *   FOUR        after c, at least one square would complete a winning line through c, but it can be stopped
 *   OPEN_THREE  after c, some square makes an OPEN_FOUR      THREE   … only a FOUR
 *   OPEN_TWO    after c, some square makes an OPEN_THREE     TWO     … only a THREE
 *
 * The window sees 4 squares on each side; what lies beyond is taken as empty. So a FIVE from the table may in rare
 * cases not be a real win (a long line whose far ends are blocked) – real wins are always confirmed with exactWin().
 * The table (4^8 = 65536 windows per rule set) is filled lazily.
 *
 * Position keeps, for every empty square, its shape in each direction for both players and a combined square score
 * (how strong a move it is for that player); make()/unmake() only recompute the squares on the 4 lines through the
 * move (at most 32 squares). It also keeps a Zobrist key and, per square, how many stones are within 2 squares
 * (candidate moves).
 */
CaroBots.module(function (root) {
  'use strict';

  const NONE = 0, TWO = 1, OPEN_TWO = 2, THREE = 3, OPEN_THREE = 4, FOUR = 5, OPEN_FOUR = 6, FIVE = 7;
  const SHAPE_NAMES = ['none', 'two', 'open-two', 'three', 'open-three', 'four', 'open-four', 'five'];
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  // ── Shape table ────────────────────────────────────────────────────────────────────────────────────
  // window cell codes: 0 empty, 1 own stone, 2 opponent stone, 3 outside the board
  const TABLES = new Map();
  function shapeTable(rules) {
    const key = `${!!rules.blockedBothEnds}${!!rules.edgeBlocks}${!!rules.overline}`;
    let t = TABLES.get(key);
    if (!t) { t = { shapes: new Int8Array(65536).fill(-1), rules }; TABLES.set(key, t); }
    return t;
  }

  /** In window w (own stone on index pos), is there a winning line through pos that also covers the centre (4)? */
  function winCovering(w, pos, rules) {
    let l = pos, r = pos;
    while (l > 0 && w[l - 1] === 1) l--;
    while (r < 8 && w[r + 1] === 1) r++;
    const len = r - l + 1;
    if (len < 5 || (!rules.overline && len > 5) || l > 4 || r < 4) return false;
    if (rules.blockedBothEnds) {
      const blocked = (code) => code === 2 || (rules.edgeBlocks && code === 3);
      const left = l > 0 ? w[l - 1] : 0, right = r < 8 ? w[r + 1] : 0;   // beyond the window: unknown = empty
      if (blocked(left) && blocked(right)) return false;
    }
    return true;
  }
  /** Number of empty squares that would complete a winning line through the centre (own stone on 4). */
  function countWins(w, rules) {
    let n = 0;
    for (let e = 0; e < 9; e++) {
      if (w[e] !== 0) continue;
      w[e] = 1;
      if (winCovering(w, e, rules)) n++;
      w[e] = 0;
    }
    return n;
  }
  /**
   * Own stone on the centre: can the opponent stop every win with ONE stone? Under "chặn 2 đầu" two winning squares
   * are not enough – e.g. O_XXXX_O: blocking one end also blocks the far end of the other five. So a four is "open"
   * only if after any single opponent stone in the window at least one winning square is left.
   */
  function unstoppable(w, rules) {
    if (countWins(w, rules) < 2) return false;
    for (let b = 0; b < 9; b++) {
      if (w[b] !== 0) continue;
      w[b] = 2;
      const left = countWins(w, rules);
      w[b] = 0;
      if (!left) return false;
    }
    return true;
  }
  /** Shape made by playing the centre of window w (w[4] empty). */
  function computeShape(w, rules) {
    w[4] = 1;
    let res = NONE;
    if (winCovering(w, 4, rules)) res = FIVE;
    else if (countWins(w, rules) >= 1) res = unstoppable(w, rules) ? OPEN_FOUR : FOUR;
    else {
      // threes: one more stone makes a four (open three: … makes an unstoppable four)
      for (let e = 0; e < 9 && res < OPEN_THREE; e++) {
        if (w[e] !== 0) continue;
        w[e] = 1;
        if (countWins(w, rules) >= 1) res = unstoppable(w, rules) ? OPEN_THREE : Math.max(res, THREE);
        w[e] = 0;
      }
      if (res === NONE) {
        // twos (cheaper test): two more stones give two winning squares (open two) / one (two)
        for (let e = 0; e < 9 && res < OPEN_TWO; e++) {
          if (w[e] !== 0) continue;
          w[e] = 1;
          for (let f = e + 1; f < 9 && res < OPEN_TWO; f++) {
            if (w[f] !== 0) continue;
            w[f] = 1;
            const c3 = countWins(w, rules);
            w[f] = 0;
            if (c3 >= 2) res = OPEN_TWO; else if (c3 === 1 && res < TWO) res = TWO;
          }
          w[e] = 0;
        }
      }
    }
    w[4] = 0;
    return res;
  }
  const WIN9 = new Int8Array(9);
  /** Shape for pattern code (base 4, offsets -4..-1, +1..+4 → digits 0..7). */
  function shapeOf(table, code) {
    let s = table.shapes[code];
    if (s >= 0) return s;
    let c = code;
    for (let k = 0; k < 8; k++) { WIN9[k < 4 ? k : k + 1] = c & 3; c >>= 2; }
    WIN9[4] = 0;
    s = computeShape(WIN9, table.rules);
    table.shapes[code] = s;
    return s;
  }
  /** Window as a string like "..XX_XO.." → shape (tests / debugging). Chars: _ empty, X own, O opponent, # outside. */
  function shapeOfString(str, rules) {
    const map = { _: 0, '.': 0, X: 1, O: 2, '#': 3 };
    let code = 0, mult = 1;
    for (let k = 0; k < 9; k++) {
      if (k === 4) continue;
      code += map[str[k]] * mult; mult *= 4;
    }
    return shapeOf(shapeTable(rules), code);
  }

  // ── Square score from the 4 shapes ─────────────────────────────────────────────────────────────────
  const DEFAULT_WEIGHTS = {
    shape: [0, 8, 30, 40, 300, 400, 3000, 100000],   // NONE, TWO, OPEN_TWO, THREE, OPEN_THREE, FOUR, OPEN_FOUR, FIVE
    doubleFour: 2500,     // two fours, or a four + an open three, in different directions (as good as an open four)
    doubleThree: 1500,    // two open threes
  };
  const WIN_SCORE_MIN = 100000;   // a square score >= this has a FIVE shape (confirm with exactWin)
  const THREAT = 2000;            // a square scoring this much makes a (nearly) unstoppable threat: open four, four-three, double three

  // ── Zobrist ──
  const ZOB = new Map();
  function zobrist(nn) {
    let z = ZOB.get(nn);
    if (!z) {
      let a = 0x2545f491;
      const r32 = () => { let t = (a = (a + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
      z = { a: new Uint32Array(nn * 2), b: new Uint32Array(nn * 2), turnA: r32(), turnB: r32() };
      for (let i = 0; i < nn * 2; i++) { z.a[i] = r32(); z.b[i] = r32(); }
      ZOB.set(nn, z);
    }
    return z;
  }
  /** NB[(c*4+d)*8 + k]: the 8 squares around c along direction d (offsets -4..-1, +1..+4), -1 outside. */
  const NBS = new Map();
  function neighbours(n) {
    let nb = NBS.get(n);
    if (!nb) {
      nb = new Int16Array(n * n * 32);
      for (let c = 0; c < n * n; c++) {
        const x = c % n, y = (c / n) | 0;
        for (let d = 0; d < 4; d++) {
          let k = 0;
          for (const o of [-4, -3, -2, -1, 1, 2, 3, 4]) {
            const nx = x + o * DIRS[d][0], ny = y + o * DIRS[d][1];
            nb[(c * 4 + d) * 8 + k++] = nx >= 0 && nx < n && ny >= 0 && ny < n ? ny * n + nx : -1;
          }
        }
      }
      NBS.set(n, nb);
    }
    return nb;
  }

  class Position {
    /** state: an engine state (not modified). weights: optional square-score weights. */
    constructor(state, weights = DEFAULT_WEIGHTS) {
      const n = state.size, nn = n * n;
      this.n = n; this.nn = nn;
      this.rules = state.rules;
      this.table = shapeTable(state.rules);
      this.w = weights;
      this.NB = neighbours(n);
      this.Z = zobrist(nn);
      this.board = Int8Array.from(state.board);
      this.turn = state.turn;
      this.stones = 0;
      this.shape = [new Int8Array(nn * 4), new Int8Array(nn * 4)];   // [player - 1][c * 4 + d]
      this.score = [new Int32Array(nn), new Int32Array(nn)];         // [player - 1][c]
      this.total = [0, 0];                                            // sum of square scores per player
      this.fives = [0, 0];                                            // squares with a FIVE shape, per player
      this.threats = [0, 0];                                          // squares scoring >= THREAT, per player
      this.near = new Int16Array(nn);                                 // stones within 2 squares (Chebyshev)
      this.stack = [];
      this.h1 = 0; this.h2 = 0;
      for (let c = 0; c < nn; c++) {
        const v = this.board[c];
        if (!v) continue;
        this.stones++;
        this.addNear(c, 1);
        this.h1 ^= this.Z.a[c * 2 + v - 1]; this.h2 ^= this.Z.b[c * 2 + v - 1];
      }
      if (this.turn === 2) { this.h1 ^= this.Z.turnA; this.h2 ^= this.Z.turnB; }
      for (let c = 0; c < nn; c++) if (!this.board[c]) { for (let d = 0; d < 4; d++) this.computeDir(c, d); this.rescore(c); }
    }

    key() { return (this.h1 >>> 0) * 2097152 + (this.h2 & 0x1fffff); }

    addNear(c, delta) {
      const n = this.n, x = c % n, y = (c / n) | 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= n) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < n && (dx || dy)) this.near[yy * n + xx] += delta;
        }
      }
    }

    /** Recompute the shapes of empty square c along direction d for both players. */
    computeDir(c, d) {
      const b = this.board, NB = this.NB, base = (c * 4 + d) * 8;
      let codeX = 0, codeO = 0, mult = 1;
      for (let k = 0; k < 8; k++) {
        const q = NB[base + k];
        const v = q < 0 ? 3 : b[q];
        // relative codes: X sees X as own (1) and O as opponent (2); O the other way round
        codeX += (v === 3 ? 3 : v) * mult;
        codeO += (v === 3 ? 3 : v === 0 ? 0 : 3 - v) * mult;
        mult *= 4;
      }
      this.shape[0][c * 4 + d] = shapeOf(this.table, codeX);
      this.shape[1][c * 4 + d] = shapeOf(this.table, codeO);
    }

    /** Recompute the combined score of square c for both players (0 when occupied) and update the totals. */
    rescore(c) {
      for (let p = 0; p < 2; p++) {
        let s = 0;
        if (!this.board[c]) {
          const sh = this.shape[p], W = this.w.shape;
          let n4 = 0, n4o = 0, n3o = 0;
          for (let d = 0; d < 4; d++) {
            const v = sh[c * 4 + d];
            s += W[v];
            if (v === FOUR) n4++; else if (v === OPEN_FOUR) n4o++; else if (v === OPEN_THREE) n3o++;
          }
          if (!n4o && (n4 >= 2 || (n4 && n3o))) s += this.w.doubleFour;
          else if (n3o >= 2) s += this.w.doubleThree;
        }
        const old = this.score[p][c];
        if (s !== old) {
          this.total[p] += s - old;
          this.fives[p] += (s >= WIN_SCORE_MIN) - (old >= WIN_SCORE_MIN);
          this.threats[p] += (s >= THREAT) - (old >= THREAT);
          this.score[p][c] = s;
        }
      }
    }

    /** Squares whose window along d contains c: recompute them (shapes + scores). */
    refreshLines(c) {
      const NB = this.NB, b = this.board;
      for (let d = 0; d < 4; d++) {
        const base = (c * 4 + d) * 8;
        for (let k = 0; k < 8; k++) {
          const q = NB[base + k];
          if (q >= 0 && !b[q]) { this.computeDir(q, d); this.rescore(q); }
        }
      }
    }

    /** Plays the side to move on empty square c. */
    make(c) {
      const p = this.turn;
      this.board[c] = p;
      this.stones++;
      for (let d = 0; d < 4; d++) this.shape[0][c * 4 + d] = this.shape[1][c * 4 + d] = 0;
      this.rescore(c);                         // occupied → score 0
      this.addNear(c, 1);
      this.refreshLines(c);
      this.h1 ^= this.Z.a[c * 2 + p - 1] ^ this.Z.turnA; this.h2 ^= this.Z.b[c * 2 + p - 1] ^ this.Z.turnB;
      this.turn = 3 - p;
      this.stack.push(c);
    }

    unmake() {
      const c = this.stack.pop();
      const p = this.board[c];
      this.board[c] = 0;
      this.stones--;
      this.addNear(c, -1);
      for (let d = 0; d < 4; d++) this.computeDir(c, d);
      this.rescore(c);
      this.refreshLines(c);
      this.h1 ^= this.Z.a[c * 2 + p - 1] ^ this.Z.turnA; this.h2 ^= this.Z.b[c * 2 + p - 1] ^ this.Z.turnB;
      this.turn = p;
    }

    /** Would `player` playing empty square c really win (engine rule, whole board)? */
    exactWin(c, player) {
      const n = this.n, b = this.board, x0 = c % n, y0 = (c / n) | 0, o = 3 - player, r = this.rules;
      for (let d = 0; d < 4; d++) {
        const dx = DIRS[d][0], dy = DIRS[d][1];
        let a = 0, bb = 0;
        for (let x = x0 - dx, y = y0 - dy; x >= 0 && x < n && y >= 0 && y < n && b[y * n + x] === player; x -= dx, y -= dy) a++;
        for (let x = x0 + dx, y = y0 + dy; x >= 0 && x < n && y >= 0 && y < n && b[y * n + x] === player; x += dx, y += dy) bb++;
        const len = a + bb + 1;
        if (len < 5 || (!r.overline && len > 5)) continue;
        if (r.blockedBothEnds) {
          const blocked = (x, y) => (x < 0 || x >= n || y < 0 || y >= n ? !!r.edgeBlocks : b[y * n + x] === o);
          if (blocked(x0 - (a + 1) * dx, y0 - (a + 1) * dy) && blocked(x0 + (bb + 1) * dx, y0 + (bb + 1) * dy)) continue;
        }
        return true;
      }
      return false;
    }

    /** Squares where `player` wins at once (confirmed). */
    winSquares(player, out = []) {
      if (!this.fives[player - 1]) return out;
      const sc = this.score[player - 1], nn = this.nn;
      for (let c = 0; c < nn; c++) if (sc[c] >= WIN_SCORE_MIN && this.exactWin(c, player)) out.push(c);
      return out;
    }

    /**
     * Squares that could stop `player`'s win on square w: w itself, and for each winning line through w the empty
     * square just beyond each end (under "chặn 2 đầu" a stone there blocks the five if the other end is blocked).
     */
    blockCandidates(w, player, out) {
      const n = this.n, b = this.board, x0 = w % n, y0 = (w / n) | 0;
      if (!out.includes(w)) out.push(w);
      if (!this.rules.blockedBothEnds) return out;
      for (let d = 0; d < 4; d++) {
        const dx = DIRS[d][0], dy = DIRS[d][1];
        let x = x0 - dx, y = y0 - dy;
        while (x >= 0 && x < n && y >= 0 && y < n && b[y * n + x] === player) { x -= dx; y -= dy; }
        let x2 = x0 + dx, y2 = y0 + dy;
        while (x2 >= 0 && x2 < n && y2 >= 0 && y2 < n && b[y2 * n + x2] === player) { x2 += dx; y2 += dy; }
        if (Math.max(Math.abs(x2 - x), Math.abs(y2 - y)) - 1 < 5) continue;     // not a five in this direction
        for (const [ex, ey] of [[x, y], [x2, y2]]) {
          if (ex < 0 || ex >= n || ey < 0 || ey >= n) continue;
          const e = ey * n + ex;
          if (!b[e] && !out.includes(e)) out.push(e);
        }
      }
      return out;
    }

    /** Does `player` have a FOUR or OPEN_FOUR shape (in any direction) by playing empty square c? */
    makesFour(c, player) {
      const sh = this.shape[player - 1];
      for (let d = 0; d < 4; d++) { const v = sh[c * 4 + d]; if (v === FOUR || v === OPEN_FOUR) return true; }
      return false;
    }

    maxShape(c, player) {
      const sh = this.shape[player - 1];
      let m = 0;
      for (let d = 0; d < 4; d++) if (sh[c * 4 + d] > m) m = sh[c * 4 + d];
      return m;
    }
  }

  const lib = (root.CaroBots.lib = root.CaroBots.lib || {});
  lib.position = {
    Position, shapeTable, shapeOf, shapeOfString, DEFAULT_WEIGHTS, WIN_SCORE_MIN, THREAT,
    NONE, TWO, OPEN_TWO, THREE, OPEN_THREE, FOUR, OPEN_FOUR, FIVE, SHAPE_NAMES,
  };
});
