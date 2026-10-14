// Olist CLV front end: Live Prediction + Customers + Model tabs (vanilla JS, koi library nahi)
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => { if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return e;
}
const money = (v) => 'R$ ' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (v) => (v * 100).toFixed(v < 0.01 ? 2 : 1) + '%';
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request fail');
  return d;
};
const niceStep = (span) => [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 10, 50, 100].find((s) => span / s <= 200) || 100;

// ---------- Tabs ----------
const loaded = {};
$$('.tab').forEach((b) => b.addEventListener('click', () => {
  $$('.tab').forEach((t) => t.classList.toggle('active', t === b));
  $$('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + b.dataset.tab; });
  if (!loaded[b.dataset.tab]) { loaded[b.dataset.tab] = true; (b.dataset.tab === 'customers' ? initCustomers : b.dataset.tab === 'model' ? initModel : () => {})(); }
}));
function banner(msg) { const b = $('#banner'); b.hidden = false; b.textContent = msg; }

// ---------- Live Prediction ----------
const SECTIONS = [
  ['Order', ['f_order_value', 'f_price', 'f_freight_ratio', 'f_n_items', 'f_n_categories', 'f_installments']],
  ['Delivery aur review', ['f_delivery_days', 'f_is_late', 'f_review', 'f_has_comment', 'f_comment_len']],
  ['Product aur location', ['f_distance_km', 'f_weight_g', 'f_photos']],
  ['Timing', ['f_is_weekend', 'f_hour', 'days_since_first_order']],
];
const PRESETS = [
  ['Happy first-time buyer', { f_review: 5, f_is_late: 0, f_delivery_days: 6, f_has_comment: 1 }],
  ['Late delivery, unhappy', { f_review: 1, f_is_late: 1, f_delivery_days: 28, f_has_comment: 1 }],
  ['Big-ticket order', { f_order_value: 600, f_price: 540, f_installments: 8, f_n_items: 2 }],
  ['Typical customer', null],
];
let META = null, timer = null, reqId = 0;
const S = {};

function fieldRow(f) {
  const wrap = h('div', { class: 'field' });
  if (f.kind === 'binary') {
    const sel = h('select', { id: 'in-' + f.key }, h('option', { value: 0 }, 'No'), h('option', { value: 1 }, 'Yes'));
    sel.addEventListener('change', () => { S[f.key] = Number(sel.value); schedule(); });
    wrap.append(h('label', { for: 'in-' + f.key }, f.label), h('div', { class: 'field-row' }, sel, h('span')));
    return wrap;
  }
  const smax = Math.min(f.max, Math.max(f.p99 * 1.5, f.default * 2, f.min + 1));
  const sstep = Math.max(f.step, niceStep((smax - f.min) / 1));
  const range = h('input', { type: 'range', id: 'rg-' + f.key, min: f.min, max: smax, step: f.kind === 'int' ? Math.max(1, Math.round(sstep)) : sstep });
  const num = h('input', { type: 'number', id: 'in-' + f.key, min: f.min, max: f.max, step: f.step });
  range.addEventListener('input', () => { num.value = range.value; S[f.key] = Number(range.value); schedule(); });
  num.addEventListener('input', () => { if (num.value !== '') { range.value = num.value; S[f.key] = Number(num.value); schedule(); } });
  wrap.append(h('label', { for: 'in-' + f.key }, f.label), h('div', { class: 'field-row' }, range, num));
  return wrap;
}

function buildForm() {
  const form = $('#form');
  form.textContent = '';
  const used = new Set();
  const byKey = Object.fromEntries(META.fields.map((f) => [f.key, f]));
  const section = (title, fields) => {
    if (!fields.length) return;
    form.append(h('div', { class: 'sec' }, title), ...fields.map(fieldRow));
  };
  SECTIONS.forEach(([title, keys]) => {
    const fs = keys.filter((k) => byKey[k]).map((k) => { used.add(k); return byKey[k]; });
    section(title, fs);
  });
  section('Other', META.fields.filter((f) => !used.has(f.key)));
  form.append(h('div', { class: 'sec' }, 'Customer profile'));
  const two = h('div', { class: 'two' });
  META.groups.forEach((g) => {
    const sel = h('select', { id: 'sel-' + g.key }, g.options.map((o) => h('option', { value: o }, o)));
    sel.addEventListener('change', () => { S[g.key] = sel.value; schedule(); });
    two.append(h('div', {}, h('label', { for: 'sel-' + g.key }, g.label), sel));
  });
  form.append(two);
  $('#presets').textContent = '';
  PRESETS.forEach(([name, vals]) => $('#presets').append(h('button', { class: 'chipbtn', onclick: () => { $('#sample-note').hidden = true; fill({ ...META.defaults, ...(vals || {}) }); } }, name)));
}

function fill(values) {
  META.fields.forEach((f) => {
    const v = Number(values[f.key] ?? f.default);
    S[f.key] = v;
    const n = $('#in-' + f.key), r = $('#rg-' + f.key);
    if (n) n.value = v;
    if (r) r.value = v;
  });
  META.groups.forEach((g) => { S[g.key] = values[g.key] ?? g.default; $('#sel-' + g.key).value = S[g.key]; });
  predict();
}

function schedule() { clearTimeout(timer); timer = setTimeout(predict, 180); }

async function predict() {
  const my = ++reqId;
  try {
    const d = await api('/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S) });
    if (my === reqId) show(d);
  } catch (e) {
    $('#res').hidden = true;
    $('#res-empty').hidden = false;
    $('#res-empty').textContent = e.message;
  }
}

function show(d) {
  $('#res-empty').hidden = true;
  $('#res').hidden = false;
  $('#r-p').textContent = pct(d.p_repeat);
  const fg = $('#ring-fg');
  fg.style.strokeDashoffset = 314.16 * (1 - Math.min(1, d.p_repeat * 4));
  fg.style.stroke = d.lift >= 2 ? 'var(--good)' : d.lift >= 1 ? 'var(--warn)' : 'var(--accent)';
  $('#r-lift').textContent = d.lift >= 1 ? `Average customer (${pct(d.base_rate)}) se ${d.lift.toFixed(1)}x zyada` : `Average customer (${pct(d.base_rate)}) se ${(1 / d.lift).toFixed(1)}x kam`;
  $('#r-flag').textContent = d.flagged ? 'Model flag: repeat hone ke imkaan zyada' : 'Model flag: repeat hone ke imkaan kam';
  $('#r-spend').textContent = money(d.pred_spend);
  $('#r-score').textContent = 'R$ ' + d.score.toFixed(d.score < 10 ? 2 : 0);
  const seg = $('#r-seg');
  seg.textContent = d.segment;
  seg.className = 'seg ' + d.segment;
  const box = $('#drivers');
  box.textContent = '';
  const maxAbs = Math.max(...d.drivers.map((x) => Math.abs(x.delta)), 1e-9);
  d.drivers.forEach((x) => {
    const w = (Math.abs(x.delta) / maxAbs) * 50;
    const fill = h('i');
    fill.style.cssText = `${x.delta >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%;background:var(--${x.delta >= 0 ? 'good' : 'bad'})`;
    box.append(h('div', { class: 'drv' }, h('span', {}, x.label), h('div', { class: 'bar' }, fill),
      h('span', { class: 'val' }, (x.delta >= 0 ? '+' : '') + (x.delta * 100).toFixed(2) + ' pt')));
  });
}

async function randomCustomer() {
  try {
    const s = await api('/api/sample');
    fill(s.input);
    const note = $('#sample-note');
    note.hidden = false;
    note.textContent = '';
    note.append(`Held-out customer ${s.id}... | Asal result: `,
      h('span', { class: 'chip ' + (s.actual_repeat ? 'ok' : 'no') }, s.actual_repeat ? `Repeat (${s.orders} orders, ${money(s.spent)})` : `One-time (${money(s.spent)})`));
  } catch (e) { banner(e.message); }
}

async function initLive() {
  try {
    META = await api('/api/meta');
  } catch (e) { $('#res-empty').textContent = 'Live predictions available nahi.'; banner(e.message); return; }
  buildForm();
  $('#btn-sample').addEventListener('click', randomCustomer);
  $('#btn-reset').addEventListener('click', () => { $('#sample-note').hidden = true; fill(META.defaults); });
  fill(META.defaults);
}

// ---------- Customers ----------
const Q = { page: 1 };
async function initCustomers() {
  try {
    const o = await api('/api/overview');
    const k = $('#kpis');
    k.append(h('div', { class: 'kpi' }, h('small', {}, 'Customers scored'), h('b', {}, o.total.toLocaleString())),
      h('div', { class: 'kpi' }, h('small', {}, 'Repeat rate (window)'), h('b', {}, o.repeat_rate.toFixed(2) + '%')),
      ...o.segments.map((s) => h('div', { class: 'kpi' }, h('small', {}, `${s.segment} customers`),
        h('b', {}, s.customers.toLocaleString()), h('small', {}, `repeat ${s.repeat_rate.toFixed(1)}% | spend ${money(s.avg_spend)}`))));
  } catch (e) { banner(e.message); return; }
  let t;
  const reload = () => { Q.page = 1; loadCustomers(); };
  $('#f-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(reload, 250); });
  ['f-segment', 'f-split', 'f-sort'].forEach((id) => $('#' + id).addEventListener('change', reload));
  $('#prev').addEventListener('click', () => { Q.page--; loadCustomers(); });
  $('#next').addEventListener('click', () => { Q.page++; loadCustomers(); });
  loadCustomers();
}
async function loadCustomers() {
  const p = new URLSearchParams({ page: Q.page, search: $('#f-search').value, segment: $('#f-segment').value, split: $('#f-split').value, sort: $('#f-sort').value });
  try {
    const d = await api('/api/customers?' + p);
    Q.page = d.page;
    const tb = $('#tbody');
    tb.textContent = '';
    d.rows.forEach((r) => tb.append(h('tr', {}, h('td', { class: 'mono' }, r.id.slice(0, 14) + '...'), h('td', { class: 'num' }, r.orders), h('td', { class: 'num' }, money(r.spent)),
      h('td', {}, h('span', { class: 'chip ' + (r.repeat ? 'ok' : 'no') }, r.repeat ? 'Repeat' : 'One-time')), h('td', { class: 'num' }, pct(r.p)),
      h('td', { class: 'num' }, money(r.spend)), h('td', { class: 'num' }, r.score.toFixed(2)), h('td', {}, h('span', { class: 'seg ' + r.segment }, r.segment)), h('td', {}, r.split))));
    if (!d.rows.length) tb.append(h('tr', {}, h('td', { colspan: 9 }, 'Koi customer nahi mila')));
    $('#page-info').textContent = `Page ${d.page} / ${d.pages}  (${d.total.toLocaleString()} customers)`;
    $('#prev').disabled = d.page <= 1;
    $('#next').disabled = d.page >= d.pages;
  } catch (e) { banner(e.message); }
}

// ---------- Model ----------
function hbars(el, items, fmt) {
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  items.forEach((i) => {
    const bar = h('i');
    bar.style.width = (i.value / max) * 100 + '%';
    el.append(h('div', { class: 'hbar' }, h('span', {}, i.label), h('div', { class: 'track' }, bar), h('span', { class: 'val' }, fmt(i.value))));
  });
}
function table(el, rows, cols) {
  el.append(h('table', {}, h('thead', {}, h('tr', {}, cols.map(([, t]) => h('th', { class: t === 'Model' ? '' : 'num' }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, cols.map(([k, t]) => h('td', { class: t === 'Model' ? '' : 'num' }, typeof r[k] === 'number' ? r[k].toFixed(3) : r[k])))))));
}
async function initModel() {
  let m;
  try { m = await api('/api/model'); } catch (e) { banner(e.message); return; }
  const c = m.card, t = c.test;
  [['Feature mode', c.mode], ['Classifier', `${c.classifier} (${c.best_iteration} trees)`], ['Test ROC-AUC', t.roc_auc], ['Test PR-AUC', t.pr_auc],
    ['Precision / Recall', `${t.precision} / ${t.recall}`], ['Threshold', c.threshold], ['Spend model', c.regressor], ['Spend R2 / MAE', `${c.reg_r2} / R$ ${c.reg_mae}`],
    ['Customers', c.customers.toLocaleString()], ['Repeat rate', c.repeat_rate + '%'], ['Imbalance', c.imbalance + ' : 1'], ['Data cut-off', c.split_date]]
    .forEach(([k, v]) => $('#model-card').append(h('div', {}, h('small', {}, k), h('b', {}, String(v)))));
  $('#model-note').textContent = c.mode === 'first_order'
    ? 'Features sirf customer ke pehle order se hain (leak-free). Test AUC kam hai kyunke pehle order se repeat purchase predict karna Olist data me mushkil hai (sirf ~2.7% customers repeat karte hain). Ye model ranking/score ke liye hai, pakki guarantee ke liye nahi.'
    : 'Aggregate mode: late_rate/avg_review jaisi fractional values repeat customers ko leak kar sakti hain, is liye AUC zyada dikh sakta hai.';

  const pts = m.tables.roc.map((p) => `${(p.x * 280 + 30).toFixed(1)},${(270 - p.y * 240).toFixed(1)}`).join(' ');
  $('#roc').innerHTML = `<svg class="roc" viewBox="0 0 320 300"><rect x="30" y="30" width="280" height="240" fill="none" stroke="currentColor" opacity=".25"/>
    <line x1="30" y1="270" x2="310" y2="30" stroke="currentColor" stroke-dasharray="4" opacity=".4"/><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="${pts}"/>
    <text x="30" y="285">False positive rate</text><text x="4" y="22">True positive rate</text><text x="180" y="262">AUC ${t.roc_auc}</text></svg>`;
  const cm = m.tables.confusion;
  $('#cm').append(h('div', { class: 'cmgrid' }, h('span'), h('span', { class: 'hd' }, 'Pred: One-time'), h('span', { class: 'hd' }, 'Pred: Repeat'),
    h('span', { class: 'hd' }, 'Actual: One-time'), h('div', { class: 'cell' }, h('b', {}, cm.tn.toLocaleString()), 'TN'), h('div', { class: 'cell' }, h('b', {}, cm.fp.toLocaleString()), 'FP'),
    h('span', { class: 'hd' }, 'Actual: Repeat'), h('div', { class: 'cell' }, h('b', {}, cm.fn.toLocaleString()), 'FN'), h('div', { class: 'cell' }, h('b', {}, cm.tp.toLocaleString()), 'TP')));
  hbars($('#lift'), m.tables.lift.map((l) => ({ label: `Decile ${l.decile}`, value: l.lift })), (v) => v.toFixed(2) + 'x');
  hbars($('#imp'), m.tables.importance.map((i) => ({ label: i.label, value: i.value })), (v) => v.toFixed(1) + '%');
  table($('#tbl-clf'), m.tables.classifiers, [['model', 'Model'], ['val_auc', 'Val AUC'], ['test_roc_auc', 'Test AUC'], ['test_pr_auc', 'PR-AUC'], ['test_recall', 'Recall']]);
  table($('#tbl-reg'), m.tables.regressors, [['model', 'Model'], ['mae', 'MAE'], ['rmse', 'RMSE'], ['r2', 'R2']]);
}

loaded.live = true;
initLive();
