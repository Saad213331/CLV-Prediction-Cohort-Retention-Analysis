// Live predictions page: form -> POST /api/predict (debounced) -> result card
const FIELDS = [
  { k: 'avg_order_value', label: 'Average order value (R$)', hint: 'Customer ke orders ki average value', step: 1 },
  { k: 'avg_price', label: 'Average item price (R$)', hint: 'Items ki average price (freight ke baghair)', step: 1 },
  { k: 'avg_freight_ratio', label: 'Freight / price ratio', hint: 'Shipping cost price ka kitna hissa hai', step: 0.01 },
  { k: 'avg_delivery_days', label: 'Average delivery days', hint: 'Order se delivery tak ke din', step: 0.5 },
  { k: 'late_rate', label: 'Late delivery rate (0-1)', hint: '0 = kabhi late nahi, 1 = hamesha late', step: 0.05, fixedMax: 1 },
  { k: 'avg_review', label: 'Average review score (1-5)', hint: 'Single order ho to whole number rakhein', step: 0.25, fixedMin: 1, fixedMax: 5 },
  { k: 'n_categories', label: 'Product categories bought', hint: 'Kitni alag categories se khareeda', step: 1, fixedMin: 1, fixedMax: 6 },
  { k: 'weekend_rate', label: 'Weekend purchase rate (0-1)', hint: 'Weekend par kiye gaye orders ka hissa', step: 0.05, fixedMax: 1 },
  { k: 'recency_days', label: 'Days since last purchase', hint: 'Aakhri order ko kitne din ho gaye', step: 1 },
];
const LABELS = { ...Object.fromEntries(FIELDS.map((f) => [f.k, f.label.replace(/ \(.*\)/, '')])), state: 'State', payment: 'Payment type' };
const $ = (id) => document.getElementById(id);
const money = (v) => 'R$ ' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (v) => (v * 100).toFixed(v < 0.01 ? 2 : 1) + '%';

let META = null, timer = null, reqId = 0;
const state = {};

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (text != null) e.textContent = text;
  return e;
}

function buildForm() {
  const form = $('form');
  form.textContent = '';
  FIELDS.forEach((f) => {
    const s = META.stats[f.k];
    const min = f.fixedMin ?? 0;
    const max = f.fixedMax ?? Math.max(Math.ceil(s.p99 * 1.25), min + 1);
    const wrap = el('div', { class: 'field' });
    const top = el('div', { class: 'field-top' });
    top.append(el('label', { for: 'n-' + f.k }, f.label), el('span', { class: 'hint' }, f.hint));
    const row = el('div', { class: 'field-row' });
    const range = el('input', { type: 'range', id: 'r-' + f.k, min, max, step: f.step });
    const num = el('input', { type: 'number', id: 'n-' + f.k, min, step: f.step });
    const sync = (v, from) => {
      state[f.k] = v;
      if (from !== 'r') range.value = v;
      if (from !== 'n') num.value = v;
      schedule();
    };
    range.addEventListener('input', () => sync(Number(range.value), 'r'));
    num.addEventListener('input', () => { if (num.value !== '') sync(Number(num.value), 'n'); });
    row.append(range, num);
    wrap.append(top, row);
    form.append(wrap);
  });
  const two = el('div', { class: 'two' });
  [['state', 'State'], ['payment', 'Main payment type']].forEach(([k, label]) => {
    const box = el('div');
    box.append(el('label', { for: 's-' + k }, label));
    const sel = el('select', { id: 's-' + k });
    META.categories[k].options.forEach((o) => sel.append(el('option', { value: o }, o)));
    sel.addEventListener('change', () => { state[k] = sel.value; schedule(); });
    box.append(sel);
    two.append(box);
  });
  form.append(two);
}

function fill(values) {
  FIELDS.forEach((f) => {
    const v = Number(values[f.k]);
    state[f.k] = v;
    $('r-' + f.k).value = v;
    $('n-' + f.k).value = v;
  });
  ['state', 'payment'].forEach((k) => { state[k] = values[k]; $('s-' + k).value = values[k]; });
  predict();
}

function schedule() { clearTimeout(timer); timer = setTimeout(predict, 200); }

async function predict() {
  const my = ++reqId;
  try {
    const r = await fetch('/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    const data = await r.json();
    if (my !== reqId) return;           // purana response ignore
    if (!r.ok) throw new Error(data.error || 'Prediction fail');
    show(data);
  } catch (e) {
    $('res').hidden = true;
    $('res-empty').hidden = false;
    $('res-empty').textContent = e.message;
  }
}

function show(d) {
  $('res-empty').hidden = true;
  $('res').hidden = false;
  $('r-p').textContent = pct(d.p_repeat);
  const fg = $('ring-fg');
  fg.style.strokeDashoffset = 314.16 * (1 - Math.min(1, d.p_repeat));
  fg.style.stroke = d.p_repeat >= 0.3 ? 'var(--good)' : d.p_repeat >= 0.08 ? 'var(--warn)' : 'var(--accent)';
  const l = d.lift;
  $('r-lift').textContent = l >= 1 ? `Average customer (${pct(d.base_rate)}) se ${l.toFixed(1)}x zyada` : `Average customer (${pct(d.base_rate)}) se ${(1 / l).toFixed(1)}x kam`;
  $('r-spend').textContent = money(d.pred_spend);
  $('r-score').textContent = 'R$ ' + d.score.toFixed(d.score < 10 ? 2 : 0);
  const seg = $('r-seg');
  seg.textContent = d.segment;
  seg.className = 'seg ' + d.segment;

  const box = $('drivers');
  box.textContent = '';
  const maxAbs = Math.max(...d.drivers.map((x) => Math.abs(x.delta)), 1e-9);
  d.drivers.forEach((x) => {
    const row = el('div', { class: 'drv' });
    const w = (Math.abs(x.delta) / maxAbs) * 50;
    const bar = el('div', { class: 'bar' });
    const fill = el('i');
    fill.style.cssText = `${x.delta >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%;background:var(--${x.delta >= 0 ? 'good' : 'bad'})`;
    bar.append(fill);
    row.append(el('span', {}, LABELS[x.feature] || x.feature), bar,
      el('span', { class: 'val' }, (x.delta >= 0 ? '+' : '') + (x.delta * 100).toFixed(1) + ' pt'));
    box.append(row);
  });
}

function showCard() {
  const c = META.card;
  const items = [['Classifier', c.classifier], ['Test ROC-AUC', c.roc_auc], ['Test PR-AUC', c.pr_auc], ['Precision / Recall', `${c.precision} / ${c.recall}`],
    ['Spend model', c.regressor], ['Spend R2 / MAE', `${c.reg_r2} / R$ ${c.reg_mae}`], ['Customers modelled', c.customers.toLocaleString()],
    ['Repeat rate', c.repeat_rate + '%'], ['Data cut-off', c.split_date]];
  const box = $('model-card');
  items.forEach(([k, v]) => { const d = el('div'); d.append(el('small', {}, k), el('b', {}, String(v))); box.append(d); });
}

async function randomCustomer() {
  try {
    const s = await (await fetch('/api/predict/sample')).json();
    fill(s.input);
    const note = $('sample-note');
    note.hidden = false;
    note.textContent = '';
    note.append(`Held-out customer ${s.id}... | Asal result: `);
    note.append(el('span', { class: 'chip ' + (s.actual_repeat ? 'ok' : 'no') }, s.actual_repeat ? `Repeat (${s.orders} orders, R$ ${s.spent})` : `One-time (R$ ${s.spent})`));
  } catch (e) { $('res-empty').textContent = e.message; }
}

async function init() {
  const r = await fetch('/api/predict/meta');
  const data = await r.json();
  if (!r.ok) {
    $('res-empty').textContent = 'Live predictions available nahi.';
    const b = $('banner');
    b.hidden = false;
    b.textContent = data.error || 'Model load nahi hua';
    return;
  }
  META = data;
  buildForm();
  showCard();
  $('btn-sample').addEventListener('click', randomCustomer);
  $('btn-reset').addEventListener('click', () => { $('sample-note').hidden = true; fill(META.defaults); });
  fill(META.defaults);
}
init().catch((e) => { $('res-empty').textContent = 'Server se connect nahi ho paya: ' + e.message; });
