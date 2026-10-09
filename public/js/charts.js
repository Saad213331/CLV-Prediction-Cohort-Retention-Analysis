// Chhoti si SVG chart library (koi external package nahi)
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
  const fmt = (n) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n * 100) / 100));
  const tip = () => document.getElementById('tip');

  function el(name, attrs = {}, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function hover(node, html) {
    const t = tip();
    node.addEventListener('mousemove', (e) => { t.hidden = false; t.innerHTML = html; t.style.left = e.clientX + 14 + 'px'; t.style.top = e.clientY + 14 + 'px'; });
    node.addEventListener('mouseleave', () => (t.hidden = true));
  }
  const mount = (host, w, h) => { host.innerHTML = ''; return el('svg', { viewBox: `0 0 ${w} ${h}` }, host); };
  function ticks(max, n = 4) { const out = []; for (let i = 0; i <= n; i++) out.push((max / n) * i); return out; }

  // Horizontal bars: items = [{label, value}]
  function hbar(host, items, { color = COLORS[0], valueFmt = fmt } = {}) {
    const rowH = 26, left = 150, W = 520, H = items.length * rowH + 6;
    const svg = mount(host, W, H);
    const max = Math.max(...items.map((i) => i.value), 1);
    items.forEach((it, i) => {
      const y = i * rowH + 3, bw = ((W - left - 52) * it.value) / max;
      const t = el('text', { x: left - 8, y: y + 15, 'text-anchor': 'end' }, svg);
      t.textContent = it.label.length > 22 ? it.label.slice(0, 21) + '…' : it.label;
      const r = el('rect', { x: left, y, width: Math.max(bw, 1), height: rowH - 8, rx: 4, fill: color }, svg);
      const v = el('text', { x: left + bw + 6, y: y + 15 }, svg); v.textContent = valueFmt(it.value);
      hover(r, `<b>${it.label}</b><br>${it.value.toLocaleString()}`);
    });
  }

  // Vertical columns: items = [{label, value}]
  function columns(host, items, { color = COLORS[0], xlabel = (s) => s } = {}) {
    const W = 520, H = 230, L = 40, B = 28, T = 8, R = 6;
    const svg = mount(host, W, H);
    const max = Math.max(...items.map((i) => i.value), 1);
    ticks(max).forEach((tv) => {
      const y = T + (H - T - B) * (1 - tv / max);
      el('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: 'var(--line)' }, svg);
      const t = el('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }, svg); t.textContent = fmt(tv);
    });
    const bw = (W - L - R) / items.length;
    items.forEach((it, i) => {
      const h = ((H - T - B) * it.value) / max;
      const r = el('rect', { x: L + i * bw + bw * 0.12, y: H - B - h, width: bw * 0.76, height: Math.max(h, 0), rx: 3, fill: color }, svg);
      hover(r, `<b>${it.label}</b><br>${it.value.toLocaleString()}`);
      if (items.length <= 12 || i % 2 === 0) { const t = el('text', { x: L + i * bw + bw / 2, y: H - 10, 'text-anchor': 'middle' }, svg); t.textContent = xlabel(it.label); }
    });
  }

  // Line chart with 2 axes: series=[{name, values, color}], labels=[...]
  function lines(host, labels, series) {
    const W = 1000, H = 260, L = 48, R = 52, T = 10, B = 28;
    const svg = mount(host, W, H);
    const iw = W - L - R, ih = H - T - B;
    const x = (i) => L + (labels.length < 2 ? iw / 2 : (iw * i) / (labels.length - 1));
    series.forEach((s, si) => {
      const max = Math.max(...s.values, 1);
      s._y = (v) => T + ih * (1 - v / max);
      if (si === 0) ticks(max).forEach((tv) => {
        el('line', { x1: L, x2: W - R, y1: s._y(tv), y2: s._y(tv), stroke: 'var(--line)' }, svg);
        const t = el('text', { x: L - 6, y: s._y(tv) + 4, 'text-anchor': 'end' }, svg); t.textContent = fmt(tv);
      });
      if (si === 1) ticks(max).forEach((tv) => { const t = el('text', { x: W - R + 6, y: s._y(tv) + 4, fill: s.color }, svg); t.textContent = fmt(tv); });
    });
    const step = Math.ceil(labels.length / 12);
    labels.forEach((l, i) => { if (i % step === 0) { const t = el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, svg); t.textContent = l; } });
    series.forEach((s) => {
      const pts = s.values.map((v, i) => `${x(i)},${s._y(v)}`).join(' ');
      el('polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, svg);
    });
    // hover overlay per x position
    const bw = iw / Math.max(labels.length - 1, 1);
    const guide = el('line', { y1: T, y2: H - B, stroke: 'var(--muted)', 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
    labels.forEach((l, i) => {
      const r = el('rect', { x: x(i) - bw / 2, y: T, width: bw, height: ih, fill: 'transparent' }, svg);
      hover(r, `<b>${l}</b>` + series.map((s) => `<br>${s.name}: ${s.values[i].toLocaleString()}`).join(''));
      r.addEventListener('mouseenter', () => { guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('visibility', 'visible'); });
      r.addEventListener('mouseleave', () => guide.setAttribute('visibility', 'hidden'));
    });
    const lg = document.createElement('div'); lg.className = 'legend';
    lg.innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    host.appendChild(lg);
  }

  // Donut: items=[{label,value}]
  function donut(host, items) {
    const W = 220, H = 220, cx = 110, cy = 110, R = 90, r = 56;
    const svg = mount(host, W, H);
    const total = items.reduce((t, i) => t + i.value, 0) || 1;
    let a = -Math.PI / 2;
    items.forEach((it, i) => {
      const da = (it.value / total) * Math.PI * 2 * 0.9999;
      const p = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
      const [x1, y1] = p(R, a), [x2, y2] = p(R, a + da), [x3, y3] = p(r, a + da), [x4, y4] = p(r, a);
      const large = da > Math.PI ? 1 : 0;
      const path = el('path', { d: `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large} 0 ${x4},${y4}Z`, fill: COLORS[i % COLORS.length] }, svg);
      hover(path, `<b>${it.label}</b><br>${it.value.toLocaleString()} (${((it.value / total) * 100).toFixed(1)}%)`);
      a += (it.value / total) * Math.PI * 2;
    });
    const t = el('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', style: 'font-size:15px;font-weight:600;fill:var(--ink)' }, svg);
    t.textContent = fmt(total);
    svg.style.maxWidth = '220px'; svg.style.margin = '0 auto';
    const lg = document.createElement('div'); lg.className = 'legend'; lg.style.justifyContent = 'center';
    lg.innerHTML = items.map((it, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${it.label} · ${((it.value / total) * 100).toFixed(1)}%</span>`).join('');
    host.appendChild(lg);
  }
  return { hbar, columns, lines, donut, fmt, COLORS };
})();
