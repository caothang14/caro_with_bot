# Cờ Caro (Gomoku) – luật chặn 2 đầu hoặc tự do

A local caro (Gomoku) game with bots: plain HTML/CSS/JS, no build, no dependencies. Open `index.html` to play
(works over `file://` too, and on GitHub Pages). The UI is in Vietnamese.

```bash
npm test              # rules, threat shapes, incremental position, bots, Web Worker source
npm run bench         # make/unmake speed + search at fixed depths
npm run bots          # list the bots
npm run arena -- --a search --b greedy -n 40 -j 2 --movetime 500    # bot vs bot, Elo statistics
npm run bump          # new ?v= version tag in index.html – before every deploy (shown as "Cập nhật: …")
```

## Rules (`engine.js`)

- Board 21×21 (configurable: `rules.size`), X moves first. Square index = `y * size + x`; names like `k11` (column
  letter, row number from the bottom).
- 5 or more stones in a row (horizontal, vertical, diagonal) win (`overline: true`) …
- … unless both ends of the line are blocked by the opponent's stones (**chặn 2 đầu**, `blockedBothEnds: true`).
  The board edge does not count as a block (`edgeBlocks: false`).
- Full board without a winner = draw. No undo (same choice as the cotuong-up project).

All three rule switches can be changed in `DEFAULT_RULES` / `createGame({ rules })`; the bots read them from the state.
The UI offers two rules (select "Luật", saved in the settings, applies at "Ván mới"): **Chặn 2 đầu** (default) and
**Tự do** (`blockedBothEnds: false`: any five or more wins, even blocked at both ends). Arena: `--rule free`.

## Game modes (`ui.js`)

- **Đấu với máy** (default): choose your side (default X = you move first, the bot second; or O / random) and the
  level (Dễ / Vừa / Khó). The level applies at once, the side at "Ván mới".
- Clock (`clock.js`, same as cotuong-up): default **5 min + 3 s per move**; also none, 3+2, 10+0, 10+5, 15+10.
  Starts after the first move, running out of time loses, "Tạm dừng" pauses it. The bot's budget is ~1/30 of its
  remaining time + 0.8 × increment, capped at 2 s (and at the bot's own maxTimeMs).
- **Hai người**: two humans on one device.
- "Chịu thua" asks for confirmation. Settings are kept in `localStorage`.
- Bots think in a Web Worker (`bots/worker.js`, built from the source of the bot files so it also works on `file://`).

## Bots

| id | Description |
|---|---|
| `random` (hidden) | Random square next to the stones – lowest baseline |
| `greedy` | 1 ply: best attack + defence square score; wins at once, blocks fours |
| `search` | Main bot (below) |
| `level-1` Dễ | `greedy` with randomness |
| `level-2` Vừa | `search`, depth 3 + VCF, a little randomness |
| `level-3` Khó | `search`, ~1.5 s at most, node budget 300k |

### Threat shapes (`bots/lib/position.js`)

For an empty square, a player and a direction, the **shape** is what the player makes along that line by playing
there, read from the 9-square window (4 on each side): five, open four, four, open three, three, open two, two. The
shapes are defined through the real win rule, so "chặn 2 đầu" is built in:

- `OXXX_O___` (centre = the move) is nothing: the five would be blocked at both ends.
- `O_XX_X_O_` is only a **four**, not an open four: there are two winning squares, but blocking one end also blocks
  the far end of the other five. An **open four** = after any single opponent stone a winning square is left.
- `O_XX_____` is a **three**, not an open three.

The table (4^8 windows) is filled lazily. Each empty square gets a score per player (weights per shape + bonus for a
double four / four-three / double three). A FIVE from the table is always confirmed with `exactWin` (the window cannot
see beyond 4 squares).

`Position` keeps shapes, square scores, totals, a Zobrist key and "stones within 2 squares" (candidate moves) and
updates them incrementally: a move only changes the squares on its 4 lines (≤ 32 squares). make + unmake ≈ 4 µs.

### Search (`bots/search.js`)

Negamax alpha-beta + iterative deepening:

- **Forced moves**: a side that can win wins. A side facing a four only considers the moves that really stop it – the
  winning square itself, or, under chặn 2 đầu, the square just beyond the end of the five (`blockCandidates`, checked
  by brute force in the tests). No defence left = lost.
- **Threats**: when the opponent has an open three / four-three / double three (a square scoring ≥ `THREAT`), only
  counter-fours and the squares on the threat are searched; otherwise the `width` (10) best squares, `rootWidth` (16)
  at the root.
- **Quiescence = VCF**: at the leaves the side to move keeps playing fours (each forces the reply) up to `qPly` plies.
- Transposition table, history ordering, CPU budget per move: `maxNodes` (300k) and `predictStop` (do not start an
  iteration predicted not to finish) – phones stay cool.
- Evaluation: own total square score − `evalOpp` × the opponent's.

Speed (cloud box): ~100 nodes/ms; depth 6 on 3 positions ≈ 0.9 s. In a game the bot usually reaches depth 3–6 in
0.1–1.5 s.

### First measurements (arena, 2 CPUs, 300–500 ms/move)

| Match | Result |
|---|---|
| greedy vs random | 100% |
| search vs greedy | 90% (10 games) |
| search:evalOpp=1.3 / 0.8 vs search | 56% / 58% (24 games – noise) |
| search:width=14,rootWidth=20 vs search | 37.5% (24 games) |

X wins 75–85% of the bot-vs-bot games (first-move advantage) – use many games and both colours (the arena plays each
seed twice with colours swapped, after a short random opening).

## Structure

| File | Role |
|---|---|
| `engine.js` | Rules (browser `window.Caro`, Node `require`) |
| `ui.js`, `index.html`, `style.css` | UI (Vietnamese) |
| `clock.js` | Two-sided clock with increment (copied from cotuong-up) |
| `bots/registry.js`, `bots/manifest.js`, `bots/worker.js` | Bot registry, list of bot files, Web Worker host (same design as cotuong-up) |
| `bots/lib/position.js` | Threat shapes + incremental position |
| `bots/random.js`, `bots/greedy.js`, `bots/search.js`, `bots/levels.js` | Bots and difficulty levels |
| `arena/match.js`, `arena/arena.js`, `arena/bench.js` | One game / parallel arena / benchmarks |
| `test/*.test.js` | engine, position, bots (+ worker source) |
| `scripts/bump-version.js` | Version tag for deploys |
