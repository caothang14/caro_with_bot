/*
 * Bot registry – works both in the browser (window.CaroBots) and in Node (globalThis.CaroBots).
 *
 *   CaroBots.register({
 *     id: 'greedy',                       // unique, a-z0-9-
 *     name: 'Bot tham',                   // display name (Vietnamese, shown in the UI)
 *     description: '...',
 *     params: { ... },                    // default params (can be overridden when picking the bot)
 *     chooseMove(state, C, ctx) { ... },  // REQUIRED. Returns a square index or { move, info: { score, depth, nodes } }
 *                                         // May return a Promise (Web Worker, HTTP bot service…)
 *     hidden: true,                       // optional: hide from the UI (reference bot for the arena)
 *   });
 *   CaroBots.variant('search', { id: 'search-fast', name: '…', params: { maxTimeMs: 300 } });
 *   Or pick one quickly with a string: 'search:depth=4,maxTimeMs=500'
 *
 * ctx passed to the bot (created by the host = UI or arena):
 *   side (1 = X, 2 = O), ply, params, random() (seeded in the arena – bots do not use Math.random), now(),
 *   timeBudgetMs, deadline, history (moves so far).
 *
 * Every bot file is wrapped in CaroBots.module(function (root) { ... }); so that it can also run in the bot Web Worker
 * (bots/worker.js) and not freeze the UI. A bot must not modify `state` (the host passes a copy).
 */
(function (factory) {
  // The factory is also kept as source text for the bot Web Worker (bots/worker.js).
  (globalThis.CaroSources = globalThis.CaroSources || []).push({ name: 'bots/registry.js', factory });
  factory(globalThis);
})(function (root) {
  'use strict';
  if (root.CaroBots && root.CaroBots.register) return; // already loaded

  const defs = new Map(); // id -> definition

  function register(def) {
    if (!def || !/^[a-z0-9-]+$/.test(def.id || '')) throw new Error(`Invalid bot id: ${def && def.id}`);
    if (typeof def.chooseMove !== 'function') throw new Error(`Bot ${def.id} is missing chooseMove()`);
    defs.set(def.id, { params: {}, description: '', ...def, name: def.name || def.id });
    return def;
  }

  /** extra fields (e.g. `level`, `levelName`) are kept on the variant; `hidden` and `level` are not inherited. */
  function variant(baseId, { id, name, description, params, hidden, ...extra }) {
    const base = defs.get(baseId);
    if (!base) throw new Error(`No such base bot: ${baseId}`);
    return register({
      ...base, level: undefined, levelName: undefined, ...extra, id, name: name || id,
      description: description || base.description,
      params: { ...base.params, ...params }, baseId, hidden: !!hidden,
    });
  }

  function parseParams(str) {
    const out = {};
    if (!str) return out;
    for (const pair of str.split(',')) {
      const [k, v = 'true'] = pair.split('=').map((x) => x.trim());
      if (!k) continue;
      out[k] = v === 'true' ? true : v === 'false' ? false : isNaN(Number(v)) ? v : Number(v);
    }
    return out;
  }

  /**
   * 'search' or 'search:depth=4' -> a ready-to-use "player":
   * { id, name, params, chooseMove(state, J, ctx), acceptDraw(state, J, ctx) }
   * chooseMove always returns Promise<{ move, info }>.
   */
  function resolve(spec) {
    const [id, query] = String(spec).split(/:(.*)/s);
    const def = defs.get(id);
    if (!def) throw new Error(`No bot "${id}". Available: ${[...defs.keys()].join(', ')}`);
    const params = { ...def.params, ...parseParams(query) };
    return {
      id: spec,
      name: def.name + (query ? ` (${query})` : ''),
      def,
      params,
      async chooseMove(state, J, ctx) {
        const out = await def.chooseMove(state, J, { ...ctx, params });
        // a move is a square index (0 is a valid move)
        if (out && typeof out === 'object') return { move: out.move, info: out.info || {} };
        return { move: Number.isInteger(out) ? out : null, info: {} };
      },
      async acceptDraw(state, J, ctx) {
        return def.acceptDraw ? !!(await def.acceptDraw(state, J, { ...ctx, params })) : false;
      },
    };
  }

  /** Suggested time for one move when a clock is used: ~1/30 of the remaining time + increment. */
  function suggestBudget(clock, fallbackMs = 1000) {
    if (!clock) return fallbackMs;
    const ms = clock.myTimeMs / 30 + clock.incrementMs * 0.8;
    return Math.max(50, Math.min(ms, clock.myTimeMs * 0.5));
  }

  /** Seeded RNG (mulberry32) for ctx.random. */
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      let t = (a = (a + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Wrapper for every file in bots/ (see the template in README): runs `factory(root)` and keeps the
   * factory so its source can be shipped to the bot Web Worker. A bot file that does not use it still
   * works, it just runs on the main thread.
   */
  function defineModule(factory) {
    const doc = root.document;
    const name = (doc && doc.currentScript && doc.currentScript.getAttribute('src')) || 'bot module';
    (root.CaroSources = root.CaroSources || []).push({ name, factory });
    factory(root);
  }

  root.CaroBots = {
    module: defineModule,
    register, variant, resolve, parseParams, suggestBudget, seededRandom,
    list: () => [...defs.values()],
    levels: () => [...defs.values()].filter((d) => d.level).sort((x, y) => x.level - y.level),
    get: (id) => defs.get(id),
    lib: (root.CaroBots && root.CaroBots.lib) || {}, // helpers shared between bots (bots/lib/*)
  };
});
