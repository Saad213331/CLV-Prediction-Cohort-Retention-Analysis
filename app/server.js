// Zero-dependency server: sirf Node ke built-in modules
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const predict = require('./lib/predict');
const customers = require('./lib/customers');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

console.log(predict.selfCheck().msg);

const routes = {
  '/api/meta': () => predict.meta(),
  '/api/model': () => predict.model(),
  '/api/sample': () => predict.sample(),
  '/api/overview': () => customers.overview(),
  '/api/customers': (q) => customers.query(Object.fromEntries(q)),
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function handle(res, fn) {
  try { sendJson(res, 200, fn()); }
  catch (e) { if (!e.status) console.error(e); sendJson(res, e.status || 500, { error: e.message }); }
}

http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url.replace(/^\/+/, '/'), 'http://localhost'); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }

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

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  let file;
  try { file = path.normalize(path.join(PUBLIC, decodeURIComponent(rel))); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Olist CLV app chal gayi: http://localhost:${PORT}`));
