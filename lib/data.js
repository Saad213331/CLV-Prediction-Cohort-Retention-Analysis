// CSV load + cleaning (notebook ke steps ka JS version) + aggregations
const fs = require('fs');
const path = require('path');

const CSV = path.join(__dirname, '..', 'data', 'olist_merged.csv');

const num = (v) => (v === '' || v === undefined ? NaN : Number(v));
const date = (v) => (v ? new Date(v.replace(' ', 'T') + 'Z') : null);
const median = (arr) => {
  const a = arr.filter((x) => !isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};


// Chhota CSV parser (quotes support ke saath) - koi package nahi chahiye
function parseCSV(text) {
  const out = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') out.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  const head = out.shift();
  return out.map((r) => { const o = {}; head.forEach((h, i) => (o[h] = r[i] ?? '')); return o; });
}

let rows = [];

function load() {
  const raw = parseCSV(fs.readFileSync(CSV, 'utf8'));
  rows = raw.map((r) => ({
    order_id: r.order_id,
    customer: r.customer_unique_id,
    status: r.order_status,
    purchase: date(r.order_purchase_timestamp),
    delivered: date(r.order_delivered_customer_date),
    estimated: date(r.order_estimated_delivery_date),
    state: r.customer_state,
    city: r.customer_city,
    n_items: num(r.n_items),
    price: num(r.price),
    freight: num(r.freight),
    category: r.main_category,
    payment: num(r.payment_value),
    installments: num(r.installments),
    ptype: r.payment_type,
    review: num(r.review_score),
  }));

  // --- Cleaning (notebook jaisa) ---
  const medReview = median(rows.map((r) => r.review));
  const modeInst = 1;
  for (const r of rows) {
    r.has_review = !isNaN(r.review);
    if (isNaN(r.payment)) r.payment = (isNaN(r.price) ? 0 : r.price) + (isNaN(r.freight) ? 0 : r.freight); // rule-based
    if (isNaN(r.price)) r.price = 0;                 // constant 0
    if (isNaN(r.freight)) r.freight = 0;
    if (isNaN(r.n_items)) r.n_items = 0;
    if (!r.category) r.category = 'unknown';          // constant "unknown"
    if (!r.ptype) r.ptype = 'not_defined';
    if (isNaN(r.installments)) r.installments = modeInst; // mode
    if (!r.has_review) r.review = medReview;          // median
    r.is_delivered = r.delivered !== null;
    r.delivery_days = r.is_delivered ? (r.delivered - r.purchase) / 86400000 : null;
    r.late = r.is_delivered && r.estimated && r.delivered > r.estimated;
    r.ym = r.purchase.toISOString().slice(0, 7);
    r.year = r.purchase.getUTCFullYear();
  }
  // IQR capping (payment_value_capped)
  const s = rows.map((r) => r.payment).sort((a, b) => a - b);
  const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  for (const r of rows) r.payment_capped = Math.min(Math.max(r.payment, lo), hi);
  console.log(`Loaded ${rows.length} orders`);
}

function filtered({ year, state } = {}) {
  return rows.filter((r) => (!year || String(r.year) === String(year)) && (!state || r.state === state));
}
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const sum = (a, f) => a.reduce((t, r) => t + f(r), 0);
const mean = (a) => (a.length ? sum(a, (x) => x) / a.length : 0);

function summary(f) {
  const d = filtered(f);
  const nonCancel = d.filter((r) => r.status !== 'canceled');
  const del = d.filter((r) => r.is_delivered);
  const byCust = new Map();
  for (const r of d) {
    if (!byCust.has(r.customer)) byCust.set(r.customer, { t: new Set(), rev: 0 });
    const c = byCust.get(r.customer);
    c.t.add(+r.purchase);
    if (r.status !== 'canceled') c.rev += r.payment_capped;
  }
  const custs = [...byCust.values()];
  const repeat = custs.filter((c) => c.t.size > 1).length;
  const revs = custs.map((c) => c.rev).sort((a, b) => b - a);
  const totRev = sum(revs, (x) => x);
  const top10 = sum(revs.slice(0, Math.floor(revs.length * 0.1)), (x) => x);
  return {
    orders: d.length,
    customers: custs.length,
    revenue: round(sum(nonCancel, (r) => r.payment)),
    avg_order_value: round(nonCancel.length ? sum(nonCancel, (r) => r.payment) / nonCancel.length : 0),
    repeat_customers: repeat,
    repeat_rate: round(custs.length ? (repeat / custs.length) * 100 : 0),
    avg_revenue_per_customer: round(mean(revs)),
    top10_share: round(totRev ? (top10 / totRev) * 100 : 0),
    delivered_rate: round(d.length ? (del.length / d.length) * 100 : 0),
    avg_delivery_days: round(mean(del.map((r) => r.delivery_days))),
    late_rate: round(del.length ? (del.filter((r) => r.late).length / del.length) * 100 : 0),
    avg_review: round(mean(d.filter((r) => r.has_review).map((r) => r.review))),
    low_review_rate: round(d.length ? (d.filter((r) => r.has_review && r.review <= 2).length / d.length) * 100 : 0),
  };
}

function groupBy(d, keyFn) {
  const m = new Map();
  for (const r of d) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function monthly(f) {
  const d = filtered(f);
  return [...groupBy(d, (r) => r.ym)]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([ym, g]) => ({ month: ym, orders: g.length, revenue: round(sum(g.filter((r) => r.status !== 'canceled'), (r) => r.payment)) }))
    // 2016 ke bohat kam mahine / 2018-09,10 ke adhoore data ko bhi dikhate hain, user filter se chun sakta hai
    ;
}

function categories(f, limit = 12) {
  const d = filtered(f).filter((r) => r.category !== 'unknown');
  return [...groupBy(d, (r) => r.category)]
    .map(([c, g]) => ({ category: c, orders: g.length, revenue: round(sum(g, (r) => r.payment)), avg_review: round(mean(g.filter((r) => r.has_review).map((r) => r.review))) }))
    .sort((a, b) => b.orders - a.orders).slice(0, limit);
}

function states(f) {
  const d = filtered({ year: f.year });
  return [...groupBy(d, (r) => r.state)]
    .map(([s, g]) => ({ state: s, orders: g.length, revenue: round(sum(g, (r) => r.payment)), avg_delivery_days: round(mean(g.filter((r) => r.is_delivered).map((r) => r.delivery_days))) }))
    .sort((a, b) => b.orders - a.orders);
}

function payments(f) {
  const d = filtered(f);
  return [...groupBy(d, (r) => r.ptype)].map(([t, g]) => ({ type: t, orders: g.length, revenue: round(sum(g, (r) => r.payment)) })).sort((a, b) => b.orders - a.orders);
}

function reviews(f) {
  const d = filtered(f).filter((r) => r.has_review);
  const out = [1, 2, 3, 4, 5].map((s) => ({ score: s, count: d.filter((r) => Math.round(r.review) === s).length }));
  return out;
}

function delivery(f) {
  const d = filtered(f).filter((r) => r.is_delivered && r.delivery_days >= 0 && r.delivery_days <= 60);
  const buckets = [];
  for (let i = 0; i < 60; i += 5) {
    buckets.push({ range: `${i}-${i + 5}`, count: d.filter((r) => r.delivery_days >= i && r.delivery_days < i + 5).length });
  }
  const status = [...groupBy(filtered(f), (r) => r.status)].map(([s, g]) => ({ status: s, count: g.length })).sort((a, b) => b.count - a.count);
  return { buckets, status };
}

function orders({ page = 1, size = 15, status, state, category, q, year, sort = 'purchase', dir = 'desc' }) {
  let d = filtered({ year, state });
  if (status) d = d.filter((r) => r.status === status);
  if (category) d = d.filter((r) => r.category === category);
  if (q) { const s = q.toLowerCase(); d = d.filter((r) => r.order_id.includes(s) || r.city.toLowerCase().includes(s)); }
  const allowed = { purchase: (r) => +r.purchase, payment: (r) => r.payment, review: (r) => r.review, delivery_days: (r) => r.delivery_days ?? -1 };
  const key = allowed[sort] || allowed.purchase;
  d = [...d].sort((a, b) => (dir === 'asc' ? key(a) - key(b) : key(b) - key(a)));
  const total = d.length;
  page = Math.max(1, +page); size = Math.min(100, Math.max(1, +size));
  const data = d.slice((page - 1) * size, page * size).map((r) => ({
    order_id: r.order_id, status: r.status, purchase: r.purchase.toISOString().slice(0, 16).replace('T', ' '),
    city: r.city, state: r.state, category: r.category, payment: round(r.payment), ptype: r.ptype,
    review: r.has_review ? r.review : null, delivery_days: r.delivery_days === null ? null : round(r.delivery_days, 1),
  }));
  return { total, page, pages: Math.ceil(total / size), data };
}

function filterOptions() {
  const uniq = (f) => [...new Set(rows.map(f))].sort();
  return { years: uniq((r) => r.year), states: uniq((r) => r.state), statuses: uniq((r) => r.status), categories: uniq((r) => r.category) };
}

module.exports = { load, summary, monthly, categories, states, payments, reviews, delivery, orders, filterOptions };
