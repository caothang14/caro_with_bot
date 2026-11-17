#!/usr/bin/env node
/*
 * Bot vs bot arena.
 *
 *   node arena/arena.js --a search --b greedy -n 40
 *   node arena/arena.js --a search:evalOpp=1.2 --b search -n 60 -j 2 --movetime 500 --seed 101
 *   node arena/arena.js --list
 *
 * Each seed is played twice (same random opening), A as X once and as O once – X has a big advantage in caro.
 */
'use strict';
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'engine'));
const bots = require(path.join(ROOT, 'bots'));
const { playGame } = require('./match');

if (!isMainThread) {
  parentPort.on('message', async (job) => {
    if (job === 'exit') process.exit(0);
    try { parentPort.postMessage({ ok: true, job, rec: await playGame({ C, bots, ...workerData, ...job }) }); }
    catch (err) { parentPort.postMessage({ ok: false, job, error: String(err && err.stack || err) }); }
  });
  return;
}

function parseArgs(argv) {
  const a = { games: 40, seed: 1, movetime: 1000, workers: Math.max(1, os.cpus().length - 1), opening: 2 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], next = () => argv[++i];
    if (k === '--a') a.a = next(); else if (k === '--b') a.b = next();
    else if (k === '--games' || k === '-n') a.games = +next(); else if (k === '--seed') a.seed = +next();
    else if (k === '--movetime') a.movetime = +next(); else if (k === '--workers' || k === '-j') a.workers = +next();
    else if (k === '--opening') a.opening = +next(); else if (k === '--list') a.list = true;
    else if (k === '--verbose' || k === '-v') a.verbose = true;
  }
  return a;
}

function elo(score, n) {
  const p = Math.min(0.999, Math.max(0.001, score / n));
  const d = -400 * Math.log10(1 / p - 1);
  const se = Math.sqrt((p * (1 - p)) / n);
  const los = 0.5 * (1 + erf((p - 0.5) / (se * Math.SQRT2 || 1e-9)));
  return { d, los };
}
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) { for (const b of bots.list()) console.log(`${b.id.padEnd(12)} ${b.hidden ? '(hidden) ' : ''}${b.name} – ${b.description}`); return; }
  if (!args.a || !args.b) { console.log('usage: node arena/arena.js --a <bot> --b <bot> [-n games] [-j workers] [--movetime ms] [--seed s]'); return; }
  const jobs = [];
  for (let i = 0; i < args.games; i++) {
    const aIsX = i % 2 === 0;
    jobs.push({ index: i, seed: args.seed + Math.floor(i / 2), x: aIsX ? args.a : args.b, o: aIsX ? args.b : args.a, aIsX });
  }
  const t0 = Date.now();
  let w = 0, d = 0, l = 0, done = 0, next = 0, xWins = 0;
  const statA = { t: 0, m: 0, depth: 0 }, statB = { t: 0, m: 0, depth: 0 };
  console.log(`A = ${args.a}\nB = ${args.b}\n${args.games} games, ${args.movetime} ms/move, ${args.workers} workers, seed ${args.seed}`);
  await new Promise((resolve) => {
    const n = Math.min(args.workers, jobs.length);
    let finished = 0;
    for (let k = 0; k < n; k++) {
      const worker = new Worker(__filename, { workerData: { moveTimeMs: args.movetime, openingMoves: args.opening } });
      const feed = () => { if (next < jobs.length) worker.postMessage(jobs[next++]); else { worker.postMessage('exit'); } };
      worker.on('message', (msg) => {
        const { job } = msg;
        if (!msg.ok) { console.error(msg.error); l++; }
        else {
          const r = msg.rec.result, aSide = job.aIsX ? 1 : 2;
          if (r.winner === 1) xWins++;
          if (r.winner == null) d++; else if (r.winner === aSide) w++; else l++;
          const sa = msg.rec.stats[aSide], sb = msg.rec.stats[3 - aSide];
          statA.t += sa.timeMs; statA.m += sa.moves; statA.depth += sa.depthSum; statB.t += sb.timeMs; statB.m += sb.moves; statB.depth += sb.depthSum;
          if (args.verbose || r.reason !== 'five') console.log(`  game ${job.index + 1} seed ${job.seed} X=${job.x}: ${r.winner == null ? 'draw' : (r.winner === aSide ? 'A' : 'B') + ' wins'} (${r.reason}${r.detail ? ' ' + r.detail : ''}) in ${msg.rec.plies} moves`);
        }
        done++;
        if (done % Math.max(1, Math.round(jobs.length / 10)) === 0 || done === jobs.length) console.log(`  [${done}/${jobs.length}] A: +${w} =${d} -${l}   ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        feed();
      });
      worker.on('exit', () => { if (++finished === n) resolve(); });
      feed();
    }
  });
  const score = w + d / 2, N = w + d + l, e = elo(score, N);
  console.log(`\nA ${args.a}: +${w} =${d} -${l}  → ${(100 * score / N).toFixed(1)}%  (Elo ${e.d >= 0 ? '+' : ''}${e.d.toFixed(0)}, LOS ${(100 * e.los).toFixed(0)}%)`);
  console.log(`X won ${xWins}/${N} games. Avg per move: A ${(statA.t / statA.m).toFixed(0)} ms depth ${(statA.depth / statA.m).toFixed(1)}, B ${(statB.t / statB.m).toFixed(0)} ms depth ${(statB.depth / statB.m).toFixed(1)}`);
})();
