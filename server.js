// Zero-dependency server: sirf Node ke built-in modules
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const db = require('./lib/data');
const predict = require('./lib/predict');          // NEW: live predictions
const models = require('./data/models.json');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

console.log('CSV load ho rahi hai... (5-20 second lag sakte hain)');
db.load();
console.log(predict.selfCheck().msg);

const f = (q) => ({ year: q.get('year') || '', state: q.get('state') || '' });
const routes = {
  '/api/options': () => db.filterOptions(),
  '/api/summary': (q) => db.summary(f(q)),
  '/api/monthly': (q) => db.monthly(f(q)),
  '/api/categories': (q) => db.categories(f(q)),
  '/api/states': (q) => db.states(f(q)),
  '/api/payments': (q) => db.payments(f(q)),
  '/api/reviews': (q) => db.reviews(f(q)),
  '/api/delivery': (q) => db.delivery(f(q)),
  '/api/orders': (q) => db.orders(Object.fromEntries(q)),
  '/api/models': () => models,
  '/api/predict/meta': () => predict.meta(),        // NEW
  '/api/predict/sample': () => predict.sample(),    // NEW
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function handle(res, fn) {
  try { sendJson(res, 200, fn()); }
  catch (e) {
    if (!e.status) console.error(e);
    sendJson(res, e.status || 500, { error: e.message });
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // NEW: POST /api/predict  (JSON body: customer features)
  if (req.method === 'POST' && url.pathname === '/api/predict') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
    return req.on('end', () => {
      let input;
      try { input = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON' }); }
      handle(res, () => predict.run(input));
    });
  }

  if (routes[url.pathname]) return handle(res, () => routes[url.pathname](url.searchParams));

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Dashboard chal gaya: http://localhost:${PORT}  |  Live predictions: http://localhost:${PORT}/predict.html`));
