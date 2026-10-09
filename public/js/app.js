const $ = (s) => document.querySelector(s);
const api = (path, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  return fetch(`/api/${path}?${q}`).then((r) => r.json());
};
const money = (n) => 'R$ ' + Charts.fmt(n);
const filters = () => ({ year: $('#f-year').value, state: $('#f-state').value });

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    $('#filters').style.visibility = b.dataset.tab === 'models' ? 'hidden' : 'visible';
    if (b.dataset.tab === 'orders') loadOrders();
    if (b.dataset.tab === 'models') loadModels();
  })
);

// ---------- Overview ----------
async function loadOverview() {
  const f = filters();
  const main = $('#tab-overview'); main.classList.add('loading');
  const [s, monthly, cats, states, pays, revs, del] = await Promise.all([
    api('summary', f), api('monthly', f), api('categories', f), api('states', f), api('payments', f), api('reviews', f), api('delivery', f),
  ]);
  const kpis = [
    ['Orders', s.orders.toLocaleString(), `${s.customers.toLocaleString()} customers`],
    ['Revenue', money(s.revenue), `AOV R$ ${s.avg_order_value}`],
    ['Repeat rate', s.repeat_rate + '%', `${s.repeat_customers.toLocaleString()} repeat customers`],
    ['Avg revenue / customer', 'R$ ' + s.avg_revenue_per_customer, `Top 10% = ${s.top10_share}% of revenue`],
    ['Delivered', s.delivered_rate + '%', `Avg ${s.avg_delivery_days} days`],
    ['Late deliveries', s.late_rate + '%', 'of delivered orders'],
    ['Avg review', s.avg_review + ' / 5', `${s.low_review_rate}% are 1–2★`],
  ];
  $('#kpis').innerHTML = kpis.map(([l, v, sub]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`).join('');

  Charts.lines($('#c-monthly'), monthly.map((m) => m.month), [
    { name: 'Orders', values: monthly.map((m) => m.orders), color: 'var(--c1)' },
    { name: 'Revenue (R$)', values: monthly.map((m) => m.revenue), color: 'var(--c2)' },
  ]);
  Charts.hbar($('#c-cat'), cats.map((c) => ({ label: c.category, value: c.orders })));
  Charts.hbar($('#c-state'), states.slice(0, 10).map((c) => ({ label: c.state, value: c.orders })), { color: 'var(--c3)' });
  Charts.donut($('#c-pay'), pays.map((p) => ({ label: p.type, value: p.orders })));
  Charts.columns($('#c-rev'), revs.map((r) => ({ label: r.score + '★', value: r.count })), { color: 'var(--c4)' });
  Charts.columns($('#c-del'), del.buckets.map((b) => ({ label: b.range, value: b.count })), { color: 'var(--c6)' });
  Charts.donut($('#c-status'), del.status.slice(0, 6).map((x) => ({ label: x.status, value: x.count })));
  main.classList.remove('loading');
}

// ---------- Orders ----------
const O = { page: 1, dir: 'desc', timer: null };
async function loadOrders() {
  const f = filters();
  const res = await api('orders', {
    ...f, page: O.page, size: 15, q: $('#o-q').value, status: $('#o-status').value,
    category: $('#o-cat').value, sort: $('#o-sort').value, dir: O.dir,
  });
  $('#o-table tbody').innerHTML = res.data.map((r) => `<tr>
    <td title="${r.order_id}">${r.order_id.slice(0, 8)}…</td><td>${r.purchase}</td>
    <td><span class="pill ${r.status}">${r.status}</span></td><td>${r.city} (${r.state})</td><td>${r.category}</td>
    <td class="r">${r.payment.toLocaleString()}</td><td>${r.ptype}</td>
    <td class="r">${r.review === null ? '–' : r.review.toFixed(1)}</td><td class="r">${r.delivery_days ?? '–'}</td></tr>`).join('') || '<tr><td colspan="9">No orders found</td></tr>';
  $('#o-info').textContent = `Page ${res.page} / ${res.pages || 1} · ${res.total.toLocaleString()} orders`;
  $('#o-prev').disabled = res.page <= 1;
  $('#o-next').disabled = res.page >= res.pages;
}
const resetOrders = () => { O.page = 1; loadOrders(); };
$('#o-q').addEventListener('input', () => { clearTimeout(O.timer); O.timer = setTimeout(resetOrders, 300); });
['#o-status', '#o-cat', '#o-sort'].forEach((s) => $(s).addEventListener('change', resetOrders));
$('#o-dir').addEventListener('click', () => { O.dir = O.dir === 'desc' ? 'asc' : 'desc'; $('#o-dir').textContent = O.dir === 'desc' ? '↓ Desc' : '↑ Asc'; resetOrders(); });
$('#o-prev').addEventListener('click', () => { O.page--; loadOrders(); });
$('#o-next').addEventListener('click', () => { O.page++; loadOrders(); });

// ---------- Models ----------
let modelsLoaded = false;
async function loadModels() {
  if (modelsLoaded) return; modelsLoaded = true;
  const m = await api('models');
  $('#m-note').innerHTML = `<b>Best classifier:</b> ${m.best_classifier} — test ROC-AUC <b>${m.best_test_auc}</b> &nbsp;·&nbsp; <b>Best regressor:</b> ${m.best_regressor} &nbsp;·&nbsp; Repeat rate ${m.repeat_rate}% (imbalance ${m.imbalance_ratio}) &nbsp;·&nbsp; ${m.modeling_customers.toLocaleString()} customers, time-split at ${m.split_date}`;
  const table = (id, cols, rows) => {
    $(id).innerHTML = `<thead><tr>${cols.map((c, i) => `<th class="${i ? 'r' : ''}">${c}</th>`).join('')}</tr></thead><tbody>` +
      rows.map((r, i) => `<tr class="${i === 0 ? 'best' : ''}">${r.map((v, j) => `<td class="${j ? 'r' : ''}">${v}</td>`).join('')}</tr>`).join('') + '</tbody>';
  };
  table('#m-clf', ['Model', 'Accuracy', 'ROC-AUC', 'PR-AUC', 'Precision', 'Recall', 'F1'], m.classification.map((r) => [r.model, r.accuracy, r.roc_auc, r.pr_auc, r.precision, r.recall, r.f1]));
  table('#m-reg', ['Model', 'MAE', 'RMSE', 'R²'], m.regression.map((r) => [r.model, r.mae, r.rmse, r.r2]));
  Charts.hbar($('#c-fi'), m.feature_importance.map((f) => ({ label: f.feature, value: f.importance })), { color: 'var(--c5)' });
  $('#m-risks').innerHTML = m.risks.map((r) => `<li>${r}</li>`).join('');
}

// ---------- Init ----------
(async function init() {
  const o = await api('options');
  const fill = (sel, arr) => arr.forEach((v) => sel.insertAdjacentHTML('beforeend', `<option>${v}</option>`));
  fill($('#f-year'), o.years); fill($('#f-state'), o.states); fill($('#o-status'), o.statuses); fill($('#o-cat'), o.categories);
  const onFilter = () => { loadOverview(); if ($('#tab-orders').classList.contains('active')) resetOrders(); };
  $('#f-year').addEventListener('change', onFilter); $('#f-state').addEventListener('change', onFilter);
  loadOverview();
})();
