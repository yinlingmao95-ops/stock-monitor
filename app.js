/* 市场监控 Market Monitor — static, client-side only */
(() => {
'use strict';

// ---------- Config ----------
const PASS_HASH = '615ed7fb1504b0c724a296d7a69e6c7b2f9ea2c57c1d8206c5afdf392ebdfd25'; // sha256 of password
const AUTH_KEY = 'mm_auth_v1';
const WATCH = [
  { s: 'AAPL',  name: '苹果 Apple',      group: 'Mag 7' },
  { s: 'MSFT',  name: '微软 Microsoft',  group: 'Mag 7' },
  { s: 'GOOGL', name: '谷歌 Alphabet',   group: 'Mag 7' },
  { s: 'AMZN',  name: '亚马逊 Amazon',   group: 'Mag 7' },
  { s: 'NVDA',  name: '英伟达 NVIDIA',   group: 'Mag 7' },
  { s: 'META',  name: 'Meta Platforms',  group: 'Mag 7' },
  { s: 'TSLA',  name: '特斯拉 Tesla',    group: 'Mag 7' },
  { s: '^TNX',  name: '美国10年期国债收益率', group: 'US 10Y', unit: '%', yield: true },
  { s: 'BZ=F',  name: '布伦特原油 Brent', group: 'Brent', unit: '$' },
];
const EXTRA = ['^VIX', 'SPY']; // used by gauges only
const ALL = WATCH.map(w => w.s).concat(EXTRA);
const MAG7 = WATCH.filter(w => w.group === 'Mag 7').map(w => w.s);
const SNAPSHOT_URL = 'data/market.json';
const LIVE_REFRESH_MS = 5 * 60 * 1000;
const yahoo = (host, sym) => `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`;
// Live sources tried in order (Yahoo has no CORS headers, so proxies are usually required on github.io)
const LIVE_SOURCES = [
  { name: 'Yahoo',        url: s => yahoo('query1', s) },
  { name: 'corsproxy.io', url: s => 'https://corsproxy.io/?url=' + encodeURIComponent(yahoo('query1', s)) },
  { name: 'allorigins',   url: s => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(yahoo('query2', s)) },
  { name: 'codetabs',     url: s => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(yahoo('query1', s)) },
];

const $ = id => document.getElementById(id);
const state = { quotes: {}, metrics: {}, sort: 'default', snapshotTime: null, liveSource: null, lastError: null, current: null, range: 126 };

// ---------- SHA-256 (fallback when crypto.subtle unavailable, e.g. file://) ----------
function sha256Fallback(ascii) {
  const rr = (v, a) => (v >>> a) | (v << (32 - a));
  const mp = Math.pow, maxWord = mp(2, 32); let result = '', words = [], asciiBitLength = ascii.length * 8;
  const hash = [], k = []; let primeCounter = 0; const isComposite = {};
  for (let c = 2; primeCounter < 64; c++) { if (!isComposite[c]) { for (let i = 0; i < 313; i += c) isComposite[i] = c;
      if (primeCounter < 8) hash[primeCounter] = (mp(c, .5) * maxWord) | 0; k[primeCounter++] = (mp(c, 1 / 3) * maxWord) | 0; } }
  ascii += '\x80'; while (ascii.length % 64 - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) { const j = ascii.charCodeAt(i); words[i >> 2] |= j << ((3 - i) % 4) * 8; }
  words[words.length] = ((asciiBitLength / maxWord) | 0); words[words.length] = (asciiBitLength);
  for (let j = 0; j < words.length;) { const w = words.slice(j, j += 16), oldHash = hash.slice(0); let h = hash.slice(0);
    for (let i = 0; i < 64; i++) { const w15 = w[i - 15], w2 = w[i - 2]; const a = h[0], e = h[4];
      const temp1 = h[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & h[5]) ^ ((~e) & h[6])) + k[i] +
        (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
      const temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & h[1]) ^ (a & h[2]) ^ (h[1] & h[2]));
      h = [(temp1 + temp2) | 0].concat(h); h[4] = (h[4] + temp1) | 0; h.length = 8; }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0; }
  for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) { const b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
  return result;
}
async function sha256(str) {
  if (window.crypto && crypto.subtle && window.isSecureContext) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Fallback(unescape(encodeURIComponent(str)));
}

// ---------- Gate ----------
function initGate() {
  if (localStorage.getItem(AUTH_KEY) === PASS_HASH) return unlock();
  $('gateForm').addEventListener('submit', async e => {
    e.preventDefault();
    const h = await sha256($('gatePwd').value.trim());
    if (h === PASS_HASH) { localStorage.setItem(AUTH_KEY, h); unlock(); }
    else { $('gateErr').textContent = '密码错误 Wrong password'; const c = $('gateForm'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); $('gatePwd').select(); }
  });
}
function unlock() { $('gate').hidden = true; $('app').hidden = false; startApp(); }

// ---------- Data ----------
function parseYahoo(j, sym) {
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) throw new Error('bad payload');
  const q = res.indicators.quote[0], candles = [];
  res.timestamp.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].some(v => v == null)) return;
    candles.push([t, o, h, l, c, q.volume ? (q.volume[i] || 0) : 0]);
  });
  return { symbol: sym, currency: res.meta.currency, price: res.meta.regularMarketPrice, marketTime: res.meta.regularMarketTime, candles };
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]); }

async function fetchLiveSymbol(sym, preferIdx) {
  const order = LIVE_SOURCES.map((_, i) => i);
  if (preferIdx != null) { order.splice(order.indexOf(preferIdx), 1); order.unshift(preferIdx); }
  let lastErr;
  for (const i of order) {
    try {
      const r = await withTimeout(fetch(LIVE_SOURCES[i].url(sym), { cache: 'no-store' }), 7000);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { data: parseYahoo(await r.json(), sym), src: i };
    } catch (e) { lastErr = `${LIVE_SOURCES[i].name}: ${e.message}`; }
  }
  throw new Error(lastErr || 'all sources failed');
}

async function loadSnapshot() {
  try {
    const r = await fetch(SNAPSHOT_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    state.snapshotTime = j.generated;
    for (const [s, q] of Object.entries(j.quotes || {})) state.quotes[s] = q;
    try { localStorage.setItem('mm_cache', JSON.stringify({ t: Date.now(), quotes: state.quotes })); } catch (_) {}
    return true;
  } catch (e) {
    state.lastError = '快照加载失败 snapshot: ' + e.message;
    // offline fallback: last cached data in localStorage
    try { const c = JSON.parse(localStorage.getItem('mm_cache') || 'null'); if (c) { state.quotes = c.quotes; state.snapshotTime = new Date(c.t).toISOString() + ' (本地缓存)'; return true; } } catch (_) {}
    return false;
  }
}

async function loadLive() {
  setStatus('正在获取实时数据…');
  let okCount = 0, prefer = null, errs = [];
  // Probe one symbol first; if every live source fails (typical CORS/proxy block), skip the rest quickly.
  try { const r = await fetchLiveSymbol(ALL[0]); prefer = r.src; }
  catch (e) { state.lastError = '实时数据不可用（CORS/代理受限），显示快照数据。' + e.message; return 0; }
  // fetch in small batches to be gentle on proxies
  const batches = [];
  for (let i = 0; i < ALL.length; i += 4) batches.push(ALL.slice(i, i + 4));
  for (const b of batches) {
    const rs = await Promise.allSettled(b.map(s => fetchLiveSymbol(s, prefer)));
    rs.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        const old = state.quotes[b[i]], nw = r.value.data;
        const oldLast = old && old.candles.length ? old.candles[old.candles.length - 1][0] : 0;
        const newLast = nw.candles.length ? nw.candles[nw.candles.length - 1][0] : 0;
        if (newLast >= oldLast && nw.candles.length > 30) state.quotes[b[i]] = nw;
        okCount++; prefer = r.value.src; state.liveSource = LIVE_SOURCES[r.value.src].name;
      } else errs.push(b[i] + ' ' + r.reason.message);
    });
  }
  if (okCount) {
    state.lastError = errs.length ? `${errs.length} 个品种实时失败` : null;
    try { localStorage.setItem('mm_cache', JSON.stringify({ t: Date.now(), quotes: state.quotes })); } catch (_) {}
  } else state.lastError = '实时数据获取失败（CORS/代理不可用），显示快照数据。' + (errs[0] ? ' ' + errs[0] : '');
  return okCount;
}

// ---------- Metrics ----------
function pctFromBack(closes, back) {
  const n = closes.length; if (n < 2) return null;
  const idx = Math.max(0, n - 1 - back);
  return closes[idx] ? (closes[n - 1] / closes[idx] - 1) * 100 : null;
}
function computeMetrics() {
  state.metrics = {};
  for (const s of ALL) {
    const q = state.quotes[s]; if (!q || !q.candles || q.candles.length < 2) continue;
    const closes = q.candles.map(c => c[4]);
    const n = closes.length, last = closes[n - 1];
    state.metrics[s] = {
      last, prev: closes[n - 2],
      d1: pctFromBack(closes, 1), m1: pctFromBack(closes, 21), y1: n > 252 ? pctFromBack(closes, 252) : pctFromBack(closes, n - 1),
      chg: last - closes[n - 2], time: q.candles[n - 1][0],
    };
  }
}

// ---------- Formatting ----------
const fmtPct = v => v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%';
const cls = v => v == null ? 'flat' : v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : 'flat';
const fmtNum = (v, d = 2) => v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = t => { const d = new Date(t * 1000); return d.toISOString().slice(0, 10); };
function fmtPrice(w, v) { if (v == null) return '—'; if (w.yield) return v.toFixed(3) + '%'; return (w.unit === '$' ? '$' : '') + fmtNum(v); }
function setStatus(t, kind) { const el = $('status'); el.textContent = t; el.className = 'status' + (kind ? ' ' + kind : ''); el.title = t; }

// ---------- Gauges (SVG) ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function arc(cx, cy, r, a0, a1) { const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; }
function gaugeSVG(o) {
  // o: {min,max,zones:[[from,to,color]],ticks, tach, id}
  const S = -135, E = 135, cx = 100, cy = 100, r = o.tach ? 86 : 80;
  const toDeg = v => S + (clamp(v, o.min, o.max) - o.min) / (o.max - o.min) * (E - S);
  let s = `<svg viewBox="0 0 200 ${o.tach ? 185 : 170}"><defs>
    <linearGradient id="ng${o.id}" x1="0" x2="1"><stop offset="0" stop-color="#a88bff"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
    <radialGradient id="face${o.id}"><stop offset="0" stop-color="#231c55"/><stop offset="1" stop-color="#110e28"/></radialGradient></defs>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="url(#face${o.id})" stroke="#2c2760" stroke-width="2"/>`;
  s += `<path d="${arc(cx, cy, r, S, E)}" stroke="#2a2550" stroke-width="${o.tach ? 10 : 9}" fill="none" stroke-linecap="round"/>`;
  (o.zones || []).forEach(z => { s += `<path d="${arc(cx, cy, r, toDeg(z[0]), toDeg(z[1]))}" stroke="${z[2]}" stroke-width="${o.tach ? 10 : 9}" fill="none" opacity=".85"/>`; });
  const nt = o.ticks || 8;
  for (let i = 0; i <= nt * 2; i++) {
    const v = o.min + (o.max - o.min) * i / (nt * 2), d = toDeg(v), major = i % 2 === 0;
    const [x0, y0] = polar(cx, cy, r - 8, d), [x1, y1] = polar(cx, cy, r - (major ? 18 : 13), d);
    s += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${major ? '#cfc8ff' : '#6b65a0'}" stroke-width="${major ? 2 : 1}"/>`;
    if (major && (o.tach || i % 4 === 0)) { const [tx, ty] = polar(cx, cy, r - (o.tach ? 30 : 28), d);
      s += `<text x="${tx}" y="${ty + 3}" fill="#8f8bb8" font-size="${o.tach ? 11 : 9}" text-anchor="middle">${o.tickFmt ? o.tickFmt(v) : Math.round(v)}</text>`; }
  }
  if (o.tach) s += `<text x="100" y="72" fill="#6b65a0" font-size="8" text-anchor="middle">x1000 r/min</text>`;
  s += `<g class="needle" style="transform-origin:100px 100px;transition:transform 1.2s cubic-bezier(.2,1.4,.4,1);transform:rotate(${S}deg)">
        <polygon points="97,104 103,104 100.6,${cy - r + 6} 99.4,${cy - r + 6}" fill="url(#ng${o.id})"/></g>
        <circle cx="100" cy="100" r="${o.tach ? 9 : 7}" fill="#7b5cff" stroke="#fff" stroke-width="2"/>`;
  s += `<text class="gv" x="100" y="${o.tach ? 150 : 140}" fill="#ecebff" font-size="${o.tach ? 20 : 17}" font-weight="700" text-anchor="middle">—</text>`;
  s += `<text class="gs" x="100" y="${o.tach ? 168 : 158}" fill="#8f8bb8" font-size="${o.tach ? 10 : 9.5}" text-anchor="middle"></text></svg>`;
  s += `<div class="g-label">${o.label}</div>`;
  return s;
}
const GAUGES = {
  'g-mag7':  { min: -4, max: 4, ticks: 4, label: 'Mag7 平均 1日%', zones: [[-4, -1.5, '#ef4444'], [-1.5, 1.5, '#7b5cff'], [1.5, 4, '#22c55e']] },
  'g-vix':   { min: 10, max: 45, ticks: 7, label: '恐慌指数 VIX', zones: [[10, 20, '#22c55e'], [20, 30, '#f59e0b'], [30, 45, '#ef4444']] },
  'g-tach':  { min: 0, max: 8, ticks: 8, tach: true, label: '市场动能转速 Momentum', zones: [[0, 2, '#ef4444'], [2, 6, '#4f7cff'], [6.5, 8, '#ef4444']] },
  'g-tnx':   { min: -20, max: 20, ticks: 4, label: '10Y 收益率变动 (bp)', zones: [[-20, -5, '#22c55e'], [-5, 5, '#7b5cff'], [5, 20, '#ef4444']] },
  'g-brent': { min: -6, max: 6, ticks: 4, label: '布伦特 1日%', zones: [[-6, -2, '#ef4444'], [-2, 2, '#7b5cff'], [2, 6, '#22c55e']] },
};
function initGauges() { for (const [id, o] of Object.entries(GAUGES)) $(id).innerHTML = gaugeSVG(Object.assign({ id }, o)); }
function setGauge(id, value, main, sub, color) {
  const o = GAUGES[id], el = $(id); if (!el) return;
  const deg = value == null ? -135 : -135 + (clamp(value, o.min, o.max) - o.min) / (o.max - o.min) * 270;
  requestAnimationFrame(() => { el.querySelector('.needle').style.transform = `rotate(${deg}deg)`; });
  const gv = el.querySelector('.gv'); gv.textContent = main; if (color) gv.setAttribute('fill', color);
  el.querySelector('.gs').textContent = sub || '';
}
const colorOf = v => v == null ? '#ecebff' : v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#ecebff';
function updateGauges() {
  const M = state.metrics;
  const mag = MAG7.map(s => M[s] && M[s].d1).filter(v => v != null);
  const magAvg = mag.length ? mag.reduce((a, b) => a + b, 0) / mag.length : null;
  setGauge('g-mag7', magAvg, fmtPct(magAvg), `上涨 ${mag.filter(v => v > 0).length}/${mag.length}`, colorOf(magAvg));
  const vix = M['^VIX'];
  setGauge('g-vix', vix && vix.last, vix ? vix.last.toFixed(2) : '—', vix ? fmtPct(vix.d1) : '', vix ? (vix.last < 20 ? '#22c55e' : vix.last < 30 ? '#f59e0b' : '#ef4444') : null);
  const tnx = M['^TNX']; const bp = tnx ? (tnx.last - tnx.prev) * 100 : null;
  setGauge('g-tnx', bp, bp == null ? '—' : (bp > 0 ? '+' : '') + bp.toFixed(1) + 'bp', tnx ? '收益率 ' + tnx.last.toFixed(3) + '%' : '', bp == null ? null : bp > 0 ? '#ef4444' : '#22c55e');
  const br = M['BZ=F'];
  setGauge('g-brent', br && br.d1, br ? fmtPct(br.d1) : '—', br ? '$' + br.last.toFixed(2) : '', colorOf(br && br.d1));
  // Tachometer: composite momentum = 4k rpm baseline + SPY move + breadth of watchlist
  const spy = M['SPY'];
  const list = WATCH.map(w => M[w.s] && M[w.s].d1).filter(v => v != null);
  const breadth = list.length ? list.filter(v => v > 0).length / list.length : 0.5;
  const rpm = spy ? clamp(4 + 1.2 * spy.d1 + (breadth - 0.5) * 3 + (magAvg || 0) * 0.5, 0, 8) : null;
  setGauge('g-tach', rpm, rpm == null ? '—' : Math.round(rpm * 1000) + ' rpm',
    spy ? `SPY ${fmtPct(spy.d1)} · 上涨 ${list.filter(v => v > 0).length}/${list.length}` : '', rpm == null ? null : rpm >= 6.5 ? '#22c55e' : rpm <= 2 ? '#ef4444' : '#a88bff');
}

// ---------- List ----------
function renderList() {
  const M = state.metrics;
  let items = WATCH.filter(w => M[w.s]);
  if (state.sort !== 'default') items = items.slice().sort((a, b) => (M[b.s][state.sort] ?? -1e9) - (M[a.s][state.sort] ?? -1e9));
  const ext = {};
  for (const k of ['d1', 'm1', 'y1']) {
    const vals = items.map(w => M[w.s][k]).filter(v => v != null);
    ext[k] = { max: Math.max(...vals), min: Math.min(...vals) };
  }
  const cell = (w, k) => {
    const v = M[w.s][k]; let h = '';
    if (v != null && v === ext[k].max && v > 0) h = ' hl-up';
    if (v != null && v === ext[k].min && v < 0) h = ' hl-down';
    return `<div class="num"><span class="pct ${cls(v)}${h}">${fmtPct(v)}</span></div>`;
  };
  $('list').innerHTML = items.map(w => {
    const m = M[w.s];
    const rowCls = m.d1 === ext.d1.max && m.d1 > 0 ? ' top-up' : m.d1 === ext.d1.min && m.d1 < 0 ? ' top-down' : '';
    const sub = w.yield ? `${w.s} · ${(m.chg * 100 > 0 ? '+' : '')}${(m.chg * 100).toFixed(1)}bp` : `${w.s} · ${w.group}`;
    return `<div class="row item${rowCls}" data-s="${w.s}">
      <div class="name"><b>${w.name}</b><span>${sub}</span></div>
      <div class="num">${fmtPrice(w, m.last)}</div>${cell(w, 'd1')}${cell(w, 'm1')}${cell(w, 'y1')}</div>`;
  }).join('') || `<div class="row muted">暂无数据 No data. ${state.lastError || ''}</div>`;
}

// ---------- 龙虎榜 ----------
function renderLHB() {
  const M = state.metrics;
  const items = WATCH.filter(w => M[w.s] && M[w.s].d1 != null).map(w => ({ w, v: M[w.s].d1 }));
  const maxAbs = Math.max(0.01, ...items.map(i => Math.abs(i.v)));
  const line = (i, n, color) => `<div class="lhb-item" data-s="${i.w.s}">
      <div style="flex:1"><span class="rank r${n}">${n}</span><b>${i.w.s}</b> <span class="muted small">${i.w.name}</span>
      <div class="bar" style="width:${Math.abs(i.v) / maxAbs * 100}%;background:${color}"></div></div>
      <span class="pct ${cls(i.v)}">${fmtPct(i.v)}</span></div>`;
  const ups = items.filter(i => i.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
  const downs = items.filter(i => i.v < 0).sort((a, b) => a.v - b.v).slice(0, 5);
  $('lhbUp').innerHTML = ups.map((i, n) => line(i, n + 1, '#22c55e')).join('') || '<div class="muted small">今日无上涨品种</div>';
  $('lhbDown').innerHTML = downs.map((i, n) => line(i, n + 1, '#ef4444')).join('') || '<div class="muted small">今日无下跌品种</div>';
  $('lhbAbs').innerHTML = items.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).map((i, n) => line(i, n + 1, i.v >= 0 ? '#22c55e' : '#ef4444')).join('');
  const t = Math.max(0, ...WATCH.map(w => M[w.s] ? M[w.s].time : 0));
  $('lhbDate').textContent = t ? '交易日 ' + fmtDate(t) : '';
}

function renderAll() {
  computeMetrics(); updateGauges(); renderList(); renderLHB();
  const parts = [];
  if (state.snapshotTime) parts.push('快照 Snapshot: ' + state.snapshotTime);
  if (state.liveSource) parts.push('实时源 Live: ' + state.liveSource);
  if (state.lastError) parts.push('⚠ ' + state.lastError);
  $('dataInfo').textContent = parts.join(' · ');
  if (state.current) openDetail(state.current, true);
}

// ---------- Detail / K-line ----------
let chart = null;
function dailyBars(sym) {
  const q = state.quotes[sym]; const seen = new Map();
  q.candles.forEach(c => seen.set(fmtDate(c[0]), c)); // dedupe by date, keep last
  return [...seen.entries()].map(([d, c]) => ({ time: d, open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
}
function openDetail(sym, refreshOnly) {
  const w = WATCH.find(x => x.s === sym); const m = state.metrics[sym]; if (!w || !m) return;
  state.current = sym; $('modal').hidden = false;
  if (!refreshOnly) document.body.style.overflow = 'hidden';
  const bars = dailyBars(sym), n = bars.length;
  $('mTitle').innerHTML = `${w.name} <span class="${cls(m.d1)}" style="font-size:16px">${fmtPrice(w, m.last)} ${fmtPct(m.d1)}</span>`;
  $('mSub').textContent = `${sym} · ${w.group} · 最近交易日 ${fmtDate(m.time)}`;
  const hi52 = Math.max(...bars.slice(-252).map(b => b.high)), lo52 = Math.min(...bars.slice(-252).map(b => b.low));
  const pctBack = k => n > k ? (bars[n - 1].close / bars[n - 1 - k].close - 1) * 100 : null;
  const stats = [['1日', fmtPct(m.d1), m.d1], ['5日', fmtPct(pctBack(5)), pctBack(5)], ['1月', fmtPct(m.m1), m.m1], ['3月', fmtPct(pctBack(63)), pctBack(63)],
    ['1年', fmtPct(m.y1), m.y1], ['52周高', fmtPrice(w, hi52)], ['52周低', fmtPrice(w, lo52)], ['开/高/低', `${fmtNum(bars[n - 1].open)} / ${fmtNum(bars[n - 1].high)} / ${fmtNum(bars[n - 1].low)}`]];
  $('mStats').innerHTML = stats.map(s => `<div class="stat${s[0] === '开/高/低' ? ' wide' : ''}"><div class="k">${s[0]}</div><div class="v ${s[2] !== undefined ? cls(s[2]) : ''}">${s[1]}</div></div>`).join('');
  // daily change list (newest first)
  const daily = [];
  for (let i = n - 1; i > 0 && daily.length < 30; i--) daily.push({ d: bars[i].time, v: (bars[i].close / bars[i - 1].close - 1) * 100 });
  $('mDaily').innerHTML = daily.map(x => `<div class="d"><span class="muted">${x.d.slice(5)}</span><span class="${cls(x.v)}">${fmtPct(x.v)}</span></div>`).join('');
  drawChart(bars, w);
}
function drawChart(bars, w) {
  const el = $('chart'); el.innerHTML = '';
  if (chart) { try { chart.remove(); } catch (_) {} chart = null; }
  if (!window.LightweightCharts) return drawFallbackChart(el, bars);
  chart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#0f0d24' }, textColor: '#8f8bb8', fontFamily: 'inherit' },
    grid: { vertLines: { color: '#1d1940' }, horzLines: { color: '#1d1940' } },
    rightPriceScale: { borderColor: '#2c2760' }, timeScale: { borderColor: '#2c2760' },
    crosshair: { mode: 0 },
  });
  const cs = chart.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    priceFormat: { type: 'price', precision: w.yield ? 3 : 2, minMove: w.yield ? 0.001 : 0.01 } });
  cs.setData(bars.map(({ volume, ...b }) => b));
  if (bars.some(b => b.volume)) {
    const vs = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
    vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vs.setData(bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? '#22c55e55' : '#ef444455' })));
  }
  // MA20 line
  const ma = []; for (let i = 19; i < bars.length; i++) { let s = 0; for (let j = i - 19; j <= i; j++) s += bars[j].close; ma.push({ time: bars[i].time, value: s / 20 }); }
  chart.addLineSeries({ color: '#a88bff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(ma);
  setRange();
}
function setRange() {
  if (!chart || !state.current) return;
  const n = dailyBars(state.current).length, r = Math.min(state.range, n);
  chart.timeScale().setVisibleLogicalRange({ from: n - r - 0.5, to: n + 1 });
}
function drawFallbackChart(el, allBars) {
  const bars = allBars.slice(-Math.min(state.range, allBars.length));
  const c = document.createElement('canvas'); const W = el.clientWidth || 800, H = el.clientHeight || 360, dpr = devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; el.appendChild(c);
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const hi = Math.max(...bars.map(b => b.high)), lo = Math.min(...bars.map(b => b.low)), pad = 20;
  const y = v => pad + (hi - v) / (hi - lo || 1) * (H - 2 * pad), bw = (W - 60) / bars.length;
  g.fillStyle = '#8f8bb8'; g.font = '11px sans-serif'; g.fillText(hi.toFixed(2), W - 55, pad); g.fillText(lo.toFixed(2), W - 55, H - pad);
  bars.forEach((b, i) => { const x = i * bw + bw / 2, col = b.close >= b.open ? '#22c55e' : '#ef4444'; g.strokeStyle = g.fillStyle = col;
    g.beginPath(); g.moveTo(x, y(b.high)); g.lineTo(x, y(b.low)); g.stroke();
    g.fillRect(x - Math.max(1, bw * 0.35), Math.min(y(b.open), y(b.close)), Math.max(2, bw * 0.7), Math.max(1, Math.abs(y(b.open) - y(b.close)))); });
}
function closeDetail() { $('modal').hidden = true; state.current = null; document.body.style.overflow = ''; if (chart) { try { chart.remove(); } catch (_) {} chart = null; } }

// ---------- Boot ----------
let started = false, timer = null;
async function refresh(liveOnly) {
  $('refreshBtn').disabled = true;
  if (!liveOnly) { await loadSnapshot(); if (Object.keys(state.quotes).length) { renderAll(); setStatus('快照数据 · 获取实时中…'); } }
  const ok = await loadLive();
  renderAll();
  if (ok) setStatus(`实时 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · ${state.liveSource}`, 'ok');
  else if (Object.keys(state.quotes).length) setStatus('快照数据 ' + (state.snapshotTime || ''), state.lastError ? 'err' : '');
  else setStatus('数据加载失败 ' + (state.lastError || ''), 'err');
  $('refreshBtn').disabled = false;
}
function startApp() {
  if (started) return; started = true;
  initGauges();
  $('list').addEventListener('click', e => { const r = e.target.closest('.row.item'); if (r) openDetail(r.dataset.s); });
  document.querySelector('.lhb').parentElement.addEventListener('click', e => { const r = e.target.closest('.lhb-item'); if (r) openDetail(r.dataset.s); });
  $('sortSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
    state.sort = b.dataset.sort; [...$('sortSeg').children].forEach(x => x.classList.toggle('active', x === b)); renderList(); });
  $('rangeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
    state.range = +b.dataset.r; [...$('rangeSeg').children].forEach(x => x.classList.toggle('active', x === b));
    if (window.LightweightCharts) setRange(); else if (state.current) drawChart(dailyBars(state.current), WATCH.find(w => w.s === state.current)); });
  $('mClose').addEventListener('click', closeDetail);
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
  $('refreshBtn').addEventListener('click', () => refresh(false));
  $('lockBtn').addEventListener('click', () => { localStorage.removeItem(AUTH_KEY); location.reload(); });
  refresh(false);
  timer = setInterval(() => { if (!document.hidden) refresh(true); }, LIVE_REFRESH_MS);
}

initGate();
})();
