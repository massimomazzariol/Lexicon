// Dueling-bandit model selector - picks which installed models to run so the best
// ones get used most and weak ones almost never, WITHOUT running every model every
// time. Fully dynamic: the "arms" are whatever models are installed (discovered at
// runtime), with a uniform prior, so a newly-pulled model is explored automatically.
// No model names are hardcoded anywhere.
//
// Why this shape: our LLM judge gives PREFERENCE feedback (it picks the best value
// per field), not absolute scores - that is a *dueling* bandit. We use Thompson
// sampling over each model's Beta(wins+1, losses+1) posterior. To keep the AMD GPU
// from thrashing (one model load per run, not per word), the committee is sampled
// ONCE per run; exploration happens across runs. References: Successive Rejects /
// SySRs (best-arm identification) and Feel-Good Thompson Sampling for contextual
// dueling bandits (LLM routing, 2025).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const STATE_PATH = resolve(process.cwd(), 'authoring/.cache/model-bandit.json');

export function loadBandit() {
  if (!existsSync(STATE_PATH)) return { version: 1, updated: null, models: {} };
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    s.models ??= {};
    return s;
  } catch { return { version: 1, updated: null, models: {} }; }
}

export function saveBandit(state) {
  state.updated = new Date().toISOString();
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

const stat = (state, m) => (state.models[m] ??= { wins: 0, trials: 0, cats: {} });

/**
 * Thompson-sample a committee of `k` models from `models` (their current Beta
 * posteriors). New/uncertain models have a wide posterior → naturally explored.
 * Returns { committee: string[], picks: [{model, theta, wins, trials, isNew}] }.
 */
export function selectCommittee(models, state, k) {
  const k2 = Math.max(1, Math.min(k, models.length));
  const picks = models.map((m) => {
    const s = state.models[m] ?? { wins: 0, trials: 0 };
    const a = s.wins + 1, b = (s.trials - s.wins) + 1; // Beta(wins+1, losses+1)
    return { model: m, theta: betaSample(a, b), wins: s.wins, trials: s.trials, isNew: !s.trials };
  });
  picks.sort((x, y) => y.theta - x.theta);
  return { committee: picks.slice(0, k2).map((p) => p.model), picks };
}

/**
 * Record dueling outcomes. Each duel: { cat, participants: string[], winner: string|null }.
 * Only genuine comparisons (≥2 participants) update the bandit. The winner gets a
 * win + trial; the losers get a trial. A duel everyone lost (winner null → judge
 * rejected all) still counts as trials, penalising models that produced rejects.
 */
export function recordDuels(state, duels) {
  state.models ??= {};
  for (const d of duels) {
    if (!d.participants || d.participants.length < 2) continue; // need a real duel
    for (const m of d.participants) {
      const s = stat(state, m);
      s.trials++;
      const c = (s.cats[d.cat] ??= { wins: 0, trials: 0 });
      c.trials++;
      if (m === d.winner) { s.wins++; c.wins++; }
    }
  }
}

/** Posterior-mean ranking over the given (currently installed) models.
 *  Proven models (≥1 trial) first by win-rate; never-tested models sink to the
 *  bottom (they sit at the 50% prior, which would otherwise float above real losers). */
export function ranking(state, models) {
  return models
    .map((m) => {
      const s = state.models[m] ?? { wins: 0, trials: 0, cats: {} };
      return { model: m, wins: s.wins, trials: s.trials, rate: (s.wins + 1) / (s.trials + 2), cats: s.cats || {} };
    })
    .sort((a, b) => {
      if ((a.trials === 0) !== (b.trials === 0)) return a.trials === 0 ? 1 : -1;
      return b.rate - a.rate;
    });
}

export function formatRanking(rows) {
  if (!rows.length) return '(no models)';
  return rows
    .map((r) => {
      const pct = Math.round(r.rate * 100);
      const conf = r.trials === 0 ? 'unproven' : `${r.wins}/${r.trials}`;
      return `  ${r.model.padEnd(26)} ${String(pct).padStart(3)}%  (${conf})`;
    })
    .join('\n');
}

// --- Beta sampler via two Gamma draws (Marsaglia & Tsang). a,b are integers ≥1 here. ---
function betaSample(a, b) {
  const x = gammaSample(a), y = gammaSample(b);
  return x + y === 0 ? 0.5 : x / (x + y);
}
function gammaSample(k) {
  if (k < 1) return gammaSample(1 + k) * Math.pow(Math.random() || 1e-12, 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = gaussian(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
