// Notebook ki scored customers file (clv_scored_customers.csv) memory me load karta hai
const fs = require('fs');
const path = require('path');

let rows = [];
let error = null;
try {
  const text = fs.readFileSync(path.join(__dirname, '..', 'data', 'clv_scored_customers.csv'), 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  rows = lines.slice(1).map((l) => {
    const c = l.split(',');
    return { id: c[ix.customer_unique_id], orders: +c[ix.frequency], spent: +c[ix.monetary], repeat: +c[ix.is_repeat],
      p: +c[ix.p_repeat], spend: +c[ix.predicted_spend], score: +c[ix.clv_score], segment: c[ix.segment], split: c[ix.split] };
  });
} catch (e) {
  error = e.code === 'ENOENT' ? 'data/clv_scored_customers.csv nahi mili (notebook ke clv_outputs folder se copy karein).' : e.message;
}

const SEGS = ['Platinum', 'Gold', 'Silver', 'Bronze'];

function overview() {
  if (error) { const e = new Error(error); e.status = 503; throw e; }
  const segments = SEGS.map((s) => {
    const r = rows.filter((x) => x.segment === s);
    const avg = (k) => (r.length ? r.reduce((a, x) => a + x[k], 0) / r.length : 0);
    return { segment: s, customers: r.length, repeat_rate: avg('repeat') * 100, avg_p: avg('p') * 100, avg_spend: avg('spend'), avg_score: avg('score') };
  });
  return { total: rows.length, repeat_rate: rows.reduce((a, x) => a + x.repeat, 0) / rows.length * 100,
    total_spent: rows.reduce((a, x) => a + x.spent, 0), segments };
}

function query(q) {
  if (error) { const e = new Error(error); e.status = 503; throw e; }
  const search = (q.search || '').toLowerCase().trim();
  const sortKey = ['score', 'p', 'spend', 'spent', 'orders'].includes(q.sort) ? q.sort : 'score';
  const dir = q.dir === 'asc' ? 1 : -1;
  const size = Math.min(50, Math.max(5, parseInt(q.size, 10) || 15));
  let list = rows;
  if (SEGS.includes(q.segment)) list = list.filter((r) => r.segment === q.segment);
  if (q.split === 'train' || q.split === 'test') list = list.filter((r) => r.split === q.split);
  if (search) list = list.filter((r) => r.id.toLowerCase().includes(search));
  list = list.slice().sort((a, b) => (a[sortKey] - b[sortKey]) * dir);
  const pages = Math.max(1, Math.ceil(list.length / size));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  return { total: list.length, page, pages, rows: list.slice((page - 1) * size, page * size) };
}

module.exports = { overview, query };
