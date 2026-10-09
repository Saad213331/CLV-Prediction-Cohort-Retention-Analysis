// Live prediction engine: Python se export hue trees (data/model_live.json) ko Node me chalata hai.
// Koi npm package ya Python runtime ki zaroorat nahi.
const fs = require('fs');
const path = require('path');

let M = null;
let loadError = null;
try {
  M = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'model_live.json'), 'utf8'));
  // XGBoost float32 me compare karta hai, is liye thresholds ko bhi float32 bana lete hain
  const f32 = (n) => (Array.isArray(n) ? [n[0], Math.fround(n[1]), f32(n[2]), f32(n[3])] : n);
  M.xgb_trees = M.xgb_trees.map(f32);
} catch (e) {
  loadError = e.code === 'ENOENT'
    ? 'data/model_live.json nahi mili. Pehle chalayein: python ml/train_model.py'
    : e.message;
}

const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const requireModel = () => { if (!M) throw httpError(503, loadError); };

const LIMITS = {   // hard limits (inke bahar value ghalat hai)
  avg_order_value: [0, 100000], avg_price: [0, 100000], avg_freight_ratio: [0, 100],
  avg_delivery_days: [0, 365], late_rate: [0, 1], avg_review: [1, 5],
  n_categories: [1, 20], weekend_rate: [0, 1], recency_days: [0, 1000],
};

function toVector(input) {
  const v = {};
  for (const k of M.numeric) {
    const x = Number(input[k]);
    if (input[k] === '' || input[k] == null || !Number.isFinite(x)) throw httpError(400, `"${k}" ek valid number honi chahiye`);
    const [lo, hi] = LIMITS[k];
    v[k] = Math.min(hi, Math.max(lo, x));
  }
  const st = String(input.state), pay = String(input.payment);
  if (!M.categories.state.options.includes(st)) throw httpError(400, `Unknown state "${st}"`);
  if (!M.categories.payment.options.includes(pay)) throw httpError(400, `Unknown payment "${pay}"`);
  return M.features.map((f) => {
    if (f in v) return v[f];
    if (f.startsWith('top_state_')) return f === 'top_state_' + st ? 1 : 0;
    return f === 'top_payment_' + pay ? 1 : 0;
  });
}

const walkLgb = (n, x) => { while (Array.isArray(n)) n = x[n[0]] <= n[1] ? n[2] : n[3]; return n; };
const walkXgb = (n, x) => { while (Array.isArray(n)) n = Math.fround(x[n[0]]) < n[1] ? n[2] : n[3]; return n; };
const scale = (x, s) => x.map((v, i) => (v - s.mean[i]) / s.scale[i]);

function pRepeat(x) {
  const xs = scale(x, M.scaler);
  let raw = 0;
  for (const t of M.lgb_trees) raw += walkLgb(t, xs);
  const p = 1 / (1 + Math.exp(-raw));
  return { raw: p, adj: (p * M.prior) / (p * M.prior + (1 - p) * (1 - M.prior)) };
}

function spend(x) {
  const xs = scale(x, M.scaler_reg);
  let s = M.xgb_base;
  for (const t of M.xgb_trees) s += walkXgb(t, xs);
  return Math.max(0, s);
}

const segment = (score) => {
  const c = M.cutoffs;
  return score > c.p95 ? 'Platinum' : score > c.p80 ? 'Gold' : score > c.p50 ? 'Silver' : 'Bronze';
};

function run(input) {
  requireModel();
  const x = toVector(input);
  const p = pRepeat(x).adj;
  const s = spend(x);
  const score = p * s;

  // "Drivers": har feature ko typical (median) value se badal kar dekhein ke probability kitni badalti hai
  const groups = [...M.numeric.map((k) => [k, [k]]),
    ['state', M.dummy_cols.filter((c) => c.startsWith('top_state_'))],
    ['payment', M.dummy_cols.filter((c) => c.startsWith('top_payment_'))]];
  const typical = M.features.map((f) => {
    if (M.numeric.includes(f)) return M.defaults[f];
    if (f.startsWith('top_state_')) return f === 'top_state_' + M.defaults.state ? 1 : 0;
    return f === 'top_payment_' + M.defaults.payment ? 1 : 0;
  });
  const drivers = groups.map(([name, cols]) => {
    const alt = x.slice();
    cols.forEach((c) => { const i = M.features.indexOf(c); alt[i] = typical[i]; });
    return { feature: name, delta: p - pRepeat(alt).adj };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);

  return {
    p_repeat: p, pred_spend: s, score, segment: segment(score),
    base_rate: M.prior, lift: p / M.prior, drivers,
  };
}

function meta() {
  requireModel();
  return {
    numeric: M.numeric, categories: M.categories, defaults: M.defaults, stats: M.stats,
    cutoffs: M.cutoffs, card: M.card, prior: M.prior,
  };
}

function sample() {
  requireModel();
  return M.samples[Math.floor(Math.random() * M.samples.length)];
}

function selfCheck() {   // Python ke predictions se match karta hai
  if (!M) return { ok: false, msg: 'Live predictions OFF: ' + loadError };
  let worst = 0;
  for (const c of M.check) {
    const x = toVector(c.input);
    worst = Math.max(worst, Math.abs(pRepeat(x).raw - c.p_raw), Math.abs(spend(x) - c.spend) / 100);
  }
  return worst < 1e-4
    ? { ok: true, msg: `Live predictions ON (model check OK, max diff ${worst.toExponential(1)})` }
    : { ok: false, msg: `WARNING: Node aur Python predictions match nahi kar rahe (diff ${worst}). train_model.py dobara chalayein.` };
}

module.exports = { run, meta, sample, selfCheck, get ready() { return !!M; } };
