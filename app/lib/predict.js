// Live prediction engine: notebook se export hue LightGBM trees (data/model_live.json) Node me chalte hain.
// Koi npm package ya Python ki zaroorat nahi.
const fs = require('fs');
const path = require('path');

let M = null;
let loadError = null;
let IDX = {};
try {
  M = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'model_live.json'), 'utf8'));
  IDX = Object.fromEntries(M.features.map((f, i) => [f, i]));
} catch (e) {
  loadError = e.code === 'ENOENT'
    ? 'data/model_live.json nahi mili. Notebook ka last cell (Live Prediction Export) chalayein aur file data/ folder me copy karein.'
    : e.message;
}

const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const need = () => { if (!M) throw httpError(503, loadError); };

function toVector(input) {
  const x = new Array(M.features.length).fill(0);
  for (const f of M.fields) {
    let v = input[f.key] === undefined ? f.default : input[f.key];   // missing field = typical value
    if (typeof v === 'boolean') v = v ? 1 : 0;
    const n = Number(v);
    if (v === '' || v == null || !Number.isFinite(n)) throw httpError(400, `"${f.label}" ek valid number honi chahiye`);
    const c = Math.min(f.max, Math.max(f.min, n));
    x[IDX[f.key]] = f.kind === 'binary' ? (c >= 0.5 ? 1 : 0) : c;
  }
  for (const g of M.groups) {
    const choice = String(input[g.key] ?? g.default);
    if (!g.options.includes(choice)) throw httpError(400, `Unknown ${g.label}: ${choice}`);
    const col = g.columns[choice];
    if (col) x[IDX[col]] = 1;
  }
  return x;
}

const walk = (n, x) => { while (Array.isArray(n)) n = x[n[0]] <= n[1] ? n[2] : n[3]; return n; };
const scale = (x, s) => x.map((v, i) => (v - s.mean[i]) / s.scale[i]);
const sum = (trees, x) => trees.reduce((a, t) => a + walk(t, x), 0);

function pRepeat(x) {
  const raw = 1 / (1 + Math.exp(-sum(M.clf_trees, scale(x, M.scaler))));
  const adj = M.use_adjust ? (raw * M.prior) / (raw * M.prior + (1 - raw) * (1 - M.prior)) : raw;
  return { raw, adj };
}
const spend = (x) => Math.max(0, Math.expm1(sum(M.reg_trees, scale(x, M.scaler_reg))));
const segment = (s) => (s > M.cutoffs.p95 ? 'Platinum' : s > M.cutoffs.p80 ? 'Gold' : s > M.cutoffs.p50 ? 'Silver' : 'Bronze');

function run(input) {
  need();
  const x = toVector(input);
  const p = pRepeat(x);
  const s = spend(x);
  const score = p.adj * s;
  // Drivers: har cheez ko typical (median/mode) value se badal kar dekhein ke probability kitni badalti hai
  const drivers = [
    ...M.fields.map((f) => ({ key: f.key, label: f.label, alt: { ...input, [f.key]: f.default } })),
    ...M.groups.map((g) => ({ key: g.key, label: g.label, alt: { ...input, [g.key]: g.default } })),
  ].map((d) => ({ key: d.key, label: d.label, delta: p.adj - pRepeat(toVector(d.alt)).adj }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
  return {
    p_repeat: p.adj, p_raw: p.raw, flagged: p.raw >= M.card.threshold, pred_spend: s, score,
    segment: segment(score), base_rate: M.prior, lift: p.adj / M.prior, drivers,
  };
}

function meta() {
  need();
  const defaults = {};
  M.fields.forEach((f) => { defaults[f.key] = f.default; });
  M.groups.forEach((g) => { defaults[g.key] = g.default; });
  return { mode: M.mode, fields: M.fields, groups: M.groups, defaults, cutoffs: M.cutoffs, card: M.card, prior: M.prior };
}
const model = () => { need(); return { card: M.card, tables: M.tables, mode: M.mode }; };
const sample = () => { need(); return M.samples[Math.floor(Math.random() * M.samples.length)]; };

function selfCheck() {   // Python predictions se Node predictions match karta hai
  if (!M) return { ok: false, msg: 'Live predictions OFF: ' + loadError };
  let worst = 0;
  for (const c of M.check) {
    const x = toVector(c.input);
    worst = Math.max(worst, Math.abs(pRepeat(x).raw - c.p_raw), Math.abs(spend(x) - c.spend) / 100);
  }
  return worst < 1e-4
    ? { ok: true, msg: `Live predictions ON (model check OK, max diff ${worst.toExponential(1)})` }
    : { ok: false, msg: `WARNING: Node aur Python predictions match nahi kar rahe (diff ${worst}). Export cell dobara chalayein.` };
}

module.exports = { run, meta, model, sample, selfCheck };
