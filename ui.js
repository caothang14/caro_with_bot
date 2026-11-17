/* UI for Cờ Caro (chặn 2 đầu) – depends on Caro (engine.js), ChessClock (clock.js), CaroBots (bots/registry.js + manifest). */
(async function () {
  'use strict';
  // Version tag of this page's files (index.html loads us as ui.js?v=…): bot files are loaded with the same tag, so
  // a browser never mixes a cached old file with new ones after an update
  const VERSION = (() => {
    try { return new URL(document.currentScript.src).searchParams.get('v') || ''; } catch (e) { return ''; }
  })();
  const $ = (id) => document.getElementById(id);
  {
    // "Cập nhật": the ?v= tag is YYYYMMDD-HHMM (Vietnam time), set by npm run bump
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(VERSION);
    $('version').textContent = m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : 'bản chạy thử (không có mã phiên bản)';
  }
  const C = window.Caro;
  const Bots = window.CaroBots;
  const MIN_BOT_DELAY_MS = 300;   // so a human can follow the bot's move

  const loadScript = (src) => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Không nạp được ${src}`));
    document.head.appendChild(el);
  });
  for (const f of window.CaroBotManifest || []) {
    try { await loadScript(`bots/${f}${VERSION ? `?v=${VERSION}` : ''}`); } catch (err) { console.error(err); }
  }
  // Bots think in a Web Worker (bots/worker.js) so the page stays responsive; main-thread fallback otherwise
  const botHost = window.CaroBotWorker ? window.CaroBotWorker.create() : null;
  if (botHost) botHost.start();

  const NAME = { 1: 'X', 2: 'O' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Settings ----------
  const SETTINGS_KEY = 'caro.settings';
  // defaults: vs computer, the human plays X (moves first), 5 min + 3 s per move
  // rule: 'block2' = chặn 2 đầu (a five blocked at both ends by the opponent does not win), 'free' = any five wins
  const settings = { mode: 'computer', humanSide: '1', level: 'level-2', tc: '5+3', rule: 'block2' };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch (e) { /* no storage */ }
  const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } };
  if (!['block2', 'free'].includes(settings.rule)) settings.rule = 'block2';
  const RULE_TEXT = {
    block2: 'Luật chặn 2 đầu: 5 quân liên tiếp (ngang, dọc, chéo) là thắng, trừ khi bị quân đối phương chặn cả hai đầu.',
    free: 'Luật tự do: 5 quân liên tiếp (ngang, dọc, chéo) trở lên là thắng, kể cả khi bị chặn hai đầu.',
  };
  const newState = () => C.createGame({ rules: { blockedBothEnds: settings.rule === 'block2' } });
  const levels = Bots.levels();
  if (!levels.some((l) => l.id === settings.level)) settings.level = levels.length > 1 ? levels[1].id : (levels[0] || {}).id;
  for (const l of levels) {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = l.levelName;
    $('level').appendChild(o);
  }

  // ---------- Game state ----------
  let state = newState();
  let players = { 1: 'human', 2: 'human' };   // 'human' or a bot spec
  let thinkId = 0, botThinking = false, resigned = null, confirmResign = false;
  // "Đi lại" (against mis-taps on the small board): positions + clock times after every move, and whether the one
  // allowed take-back is available (it is re-armed by the next human move)
  let history = [state], clockSnaps = [], canUndo = false;
  let clock = null;
  const ClockSide = { 1: 'r', 2: 'b' };   // ChessClock sides

  // ---------- Clock ----------
  function newClock() {
    if (clock) clock.stop();
    const [min, inc] = (settings.tc || '0+0').split('+').map(Number);
    clock = new window.ChessClock({
      initialMs: min * 60000, incrementMs: inc * 1000,
      onTick: renderClocks,
      onTimeout: (side) => { cancelBot(); resigned = { winner: side === 'r' ? 2 : 1, reason: 'timeout' }; render(); },
    });
    $('tcNote').hidden = true;
  }
  function renderClocks() {
    $('clocks').classList.toggle('off', !clock.enabled);
    if (!clock.enabled) return;
    for (const side of [1, 2]) {
      const el = side === 1 ? $('clockX') : $('clockO'), k = ClockSide[side];
      el.querySelector('.time').textContent = window.ChessClock.format(clock.remaining[k]);
      el.classList.toggle('active', clock.active === k);
      el.classList.toggle('paused', clock.paused);
      el.classList.toggle('low', clock.remaining[k] < 20000);
      el.classList.toggle('flagged', clock.flagged === k);
    }
    const pauseBtn = $('pause');
    pauseBtn.disabled = !(clock.running || clock.paused);
    pauseBtn.textContent = clock.paused ? 'Tiếp tục' : 'Tạm dừng';
  }
  const isBot = (side) => players[side] !== 'human';
  const humanSides = () => [1, 2].filter((s) => !isBot(s));

  // ---------- Board ----------
  const boardEl = $('board');
  function buildBoard() {
    const n = state.size;
    boardEl.style.setProperty('--n', n);
    boardEl.innerHTML = '';
    const mid = (n / 2) | 0;
    for (let i = 0; i < n * n; i++) {
      const c = document.createElement('div');
      const x = i % n, y = (i / n) | 0;
      c.className = 'cell' + (x === n - 1 ? ' edge-r' : '') + (y === n - 1 ? ' edge-b' : '') + (x === mid && y === mid ? ' center' : '');
      c.dataset.i = i;
      boardEl.appendChild(c);
    }
    $('sizeLabel').textContent = `${n}×${n}`;
  }
  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) onSquare(+cell.dataset.i);
  });

  function result() {
    return resigned || state.result;
  }

  function render() {
    const n = state.size, cells = boardEl.children;
    const res = result();
    const win = new Set(res && res.line ? res.line : []);
    const last = state.moves[state.moves.length - 1];
    for (let i = 0; i < n * n; i++) {
      const v = state.board[i], el = cells[i];
      const want = v ? NAME[v] : '';
      if (el.textContent !== want) el.textContent = want;
      el.classList.toggle('x', v === 1);
      el.classList.toggle('o', v === 2);
      el.classList.toggle('last', i === last && !win.size);
      el.classList.toggle('win', win.has(i));
    }
    boardEl.classList.toggle('locked', !!res || botThinking || isBot(state.turn) || clock.paused);
    // status
    const st = $('status');
    st.className = 'status';
    const vsComputer = settings.mode === 'computer';
    const who = (side) => (vsComputer ? (isBot(side) ? 'Máy' : 'Bạn') : NAME[side]);
    if (res) {
      if (res.winner == null) st.textContent = res.reason === 'full' ? 'Hoà – bàn cờ đã kín.' : 'Hoà.';
      else {
        st.classList.add(res.winner === 1 ? 'x' : 'o');
        const how = res.reason === 'resign' ? ' (đối phương chịu thua)' : res.reason === 'timeout' ? ' (đối phương hết giờ)' : '';
        st.textContent = vsComputer ? `${isBot(res.winner) ? 'Máy thắng' : 'Bạn thắng'} (${NAME[res.winner]})${how}!` : `${NAME[res.winner]} thắng${how}!`;
      }
    } else {
      st.classList.add(state.turn === 1 ? 'x' : 'o');
      st.innerHTML = '';
      st.append(`Lượt ${NAME[state.turn]}${vsComputer ? ` (${who(state.turn)})` : ''}`);
      if (clock.paused) st.append(' – đang tạm dừng');
      else if (botThinking) { st.append(' – máy đang nghĩ'); const sp = document.createElement('span'); sp.className = 'spinner'; st.appendChild(sp); }
    }
    $('moveCount').textContent = state.moves.length;
    $('lastMove').textContent = last != null ? ` · nước cuối: ${NAME[state.board[last]]} ${C.squareName(last, n)}` : '';
    $('resign').disabled = !!res || !humanSides().length || state.moves.length < 1;
    $('undo').disabled = !undoAllowed();
    $('confirmBar').hidden = !confirmResign;
    $('modeComputer').hidden = settings.mode !== 'computer';
    // the rule of the game on the board (a changed setting applies at "Ván mới")
    $('ruleText').textContent = RULE_TEXT[state.rules.blockedBothEnds ? 'block2' : 'free'];
    for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.mode === settings.mode);
    renderClocks();
    const lv = Bots.get(settings.level);
    $('levelDesc').textContent = lv ? lv.description : '';
  }

  // ---------- Moves ----------
  function onSquare(i) {
    if (result() || botThinking || isBot(state.turn) || clock.paused || !C.isLegal(state, i)) return;
    play(i);
  }

  function play(i) {
    const mover = state.turn;
    state = C.makeMove(state, i);
    confirmResign = false;
    // the clock starts after the first move; the mover gets the increment
    if (state.result) clock.stop(); else clock.press(ClockSide[mover]);
    history.push(state);
    clockSnaps.push(clock.snapshot());
    if (!isBot(mover)) canUndo = true;
    render();
    maybeBotMove();
  }

  // ---------- Take back ("Đi lại") ----------
  /** One take-back per human move; also after the game ended (five / resignation – not after a timeout). */
  function undoAllowed() {
    if (!canUndo || !humanSides().length) return false;
    const res = result();
    if (res && (res.reason === 'timeout' || res.reason === 'bot-error')) return false;
    return history.length > 1 || (res && res.reason === 'resign');
  }

  function undo() {
    if (!undoAllowed()) return;
    cancelBot();
    confirmResign = false;
    canUndo = false;
    if (resigned && resigned.reason === 'resign') {
      // just resigned: take the resignation back, the game goes on from the same position
      resigned = null;
    } else {
      // vs computer: take back the human's last move and the bot's reply (if any); two players: the last move
      history.pop(); clockSnaps.pop();
      while (history.length > 1 && isBot(history[history.length - 1].turn)) { history.pop(); clockSnaps.pop(); }
      state = history[history.length - 1];
      resigned = null;
    }
    // clock: the times after the last remaining move; it only runs once a move has been played
    const snap = clockSnaps.length ? clockSnaps[clockSnaps.length - 1] : { r: clock.initialMs, b: clock.initialMs };
    clock.restore(snap, state.moves.length ? ClockSide[state.turn] : null);
    render();
    maybeBotMove();
  }

  async function maybeBotMove() {
    const side = state.turn;
    if (result() || !isBot(side) || botThinking) return;
    const my = ++thinkId;
    const s = state;
    botThinking = true;
    render();
    const spec = players[side];
    // time budget: ~1/30 of the remaining time + most of the increment (the bot caps it at its own maxTimeMs)
    const budget = clock.enabled ? Math.max(100, Math.min(2000, clock.remaining[ClockSide[side]] / 30 + clock.incrementMs * 0.8)) : 2000;
    const ctx = { side, ply: s.moves.length, random: Math.random, now: () => performance.now(), timeBudgetMs: budget, history: s.moves.slice() };
    const t0 = performance.now();
    try {
      const local = () => Bots.resolve(spec).chooseMove(C.cloneState(s), C, ctx);
      const out = botHost ? await botHost.run('move', spec, C.cloneState(s), ctx, local) : await local();
      await sleep(Math.max(0, MIN_BOT_DELAY_MS - (performance.now() - t0)));
      while (clock.paused && my === thinkId) await sleep(200);
      if (my !== thinkId || state !== s || result()) return;      // cancelled meanwhile (new game, mode change…)
      botThinking = false;
      if (!C.isLegal(state, out.move)) { console.error('Bot played an illegal move', out); resigned = { winner: 3 - side, reason: 'bot-error' }; render(); return; }
      play(out.move);
    } catch (err) {
      if (my !== thinkId || (err && err.cancelled)) return;
      botThinking = false;
      console.error('Bot error:', err);
      resigned = { winner: 3 - side, reason: 'bot-error' };
      render();
    }
  }

  function cancelBot() {
    thinkId++;
    if (botThinking && botHost) botHost.cancel();
    botThinking = false;
  }

  // ---------- Game setup ----------
  function playersFor() {
    if (settings.mode === 'two') return { 1: 'human', 2: 'human' };
    const human = settings.humanSide === 'random' ? (Math.random() < 0.5 ? 1 : 2) : +settings.humanSide;
    return human === 1 ? { 1: 'human', 2: settings.level } : { 1: settings.level, 2: 'human' };
  }

  function newGame() {
    cancelBot();
    state = newState();
    history = [state]; clockSnaps = []; canUndo = false;
    resigned = null;
    $('ruleNote').hidden = true;
    confirmResign = false;
    players = playersFor();
    newClock();
    $('modeNote').hidden = true;
    buildBoard();
    render();
    maybeBotMove();
  }

  /** Settings changed: before the first move apply at once, otherwise at "Ván mới" (the level applies at once). */
  function onSettingsChange(levelOnly) {
    saveSettings();
    if (!state.moves.length || result()) { newGame(); return; }
    if (levelOnly && settings.mode === 'computer') {
      for (const side of [1, 2]) if (isBot(side)) players[side] = settings.level;
      render();
      return;
    }
    $('modeNote').hidden = false;
    render();
  }

  for (const b of document.querySelectorAll('.tab')) {
    b.addEventListener('click', () => { settings.mode = b.dataset.mode; onSettingsChange(false); });
  }
  $('humanSide').value = settings.humanSide;
  $('level').value = settings.level;
  $('humanSide').addEventListener('change', () => { settings.humanSide = $('humanSide').value; onSettingsChange(false); });
  $('level').addEventListener('change', () => { settings.level = $('level').value; onSettingsChange(true); });
  $('newGame').addEventListener('click', newGame);
  $('resign').addEventListener('click', () => { confirmResign = true; render(); });
  $('confirmNo').addEventListener('click', () => { confirmResign = false; render(); });
  $('confirmYes').addEventListener('click', () => {
    confirmResign = false;
    cancelBot();
    // vs computer: the human resigns; two players: the side to move resigns
    const loser = settings.mode === 'computer' ? humanSides()[0] : state.turn;
    resigned = { winner: 3 - loser, reason: 'resign' };
    clock.stop();
    render();
  });
  $('undo').addEventListener('click', undo);
  $('pause').addEventListener('click', () => {
    if (clock.paused) clock.resume(); else clock.pause();
    render();
  });
  $('rule').value = settings.rule;
  $('rule').addEventListener('change', () => {
    settings.rule = $('rule').value;
    saveSettings();
    if (!state.moves.length || result()) newGame();
    else { $('ruleNote').hidden = false; render(); }
  });
  $('timeControl').value = settings.tc;
  $('timeControl').addEventListener('change', () => {
    settings.tc = $('timeControl').value;
    saveSettings();
    if (!state.moves.length || result()) newGame();
    else $('tcNote').hidden = false;
  });

  // Small API for tests: current state, play a move, load a state
  window.CaroUI = {
    current: () => state,
    play: (i) => onSquare(i),
    load: (s) => { cancelBot(); state = C.cloneState(s); history = [state]; clockSnaps = []; canUndo = false; resigned = null; buildBoard(); render(); maybeBotMove(); },
    undo: () => undo(),
    players: () => ({ ...players }),
  };

  newGame();
})();
