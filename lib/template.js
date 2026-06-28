'use strict';

/**
 * template.js — generates the self-contained .visualarch.html file.
 *
 * Renders an Eraser-style **cloud-architecture diagram**: a light theme with
 * rounded container boxes per layer (icon + UPPERCASE title badge, colored
 * border), clean icon+label node cards with soft shadows, and right-angle
 * (elbow) connectors carrying edge labels.
 *
 * Everything (CSS + JS) is inlined and the arch data is baked in as
 * `const ARCH = {...}`. A WebSocket client gives live updates and degrades
 * gracefully when the watcher is offline. A theme toggle switches light/dark.
 */

/**
 * @param {object} arch  Architecture object from analyser.analyse().
 * @param {object} [opts]
 * @param {number} [opts.port=7842]  WebSocket port the watcher listens on.
 * @returns {string} Complete HTML document.
 */
function render(arch, opts = {}) {
  const port = opts.port || 7842;
  const archJson = JSON.stringify(arch);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>⬡ LiveArch — ${escapeHtml(arch.name)}</title>
<style>
  :root {
    /* light cloud-architecture theme (default) */
    --bg: #f6f7f4; --grid: rgba(60,60,60,.06);
    --panel: #ffffff; --card: #ffffff; --border: #e2e3de;
    --text: #2b2f36; --muted: #8a909b; --accent: #2866c4;
    --line: #aeb4bd; --green: #2e9e54; --red: #e0564b; --flash: #d6f3e0;
    --shadow: 0 6px 18px rgba(20,20,40,.08); --shadow-sm: 0 2px 6px rgba(20,20,40,.07);
  }
  body.dark {
    --bg: #0a0e14; --grid: rgba(120,130,150,.10);
    --panel: #11161f; --card: #0d1219; --border: #232b38;
    --text: #e6edf3; --muted: #8b98ad; --accent: #58a6ff;
    --line: #3a4456; --green: #3fb950; --red: #f85149; --flash: #16351f;
    --shadow: 0 8px 30px rgba(0,0,0,.45); --shadow-sm: 0 2px 8px rgba(0,0,0,.4);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); overflow: hidden;
    background-image:
      radial-gradient(var(--grid) 1.4px, transparent 1.4px);
    background-size: 22px 22px;
  }
  header {
    display: flex; align-items: center; gap: 14px; padding: 11px 22px;
    border-bottom: 1px solid var(--border); background: var(--panel);
    position: sticky; top: 0; z-index: 30; box-shadow: var(--shadow-sm);
  }
  header h1 { font-size: 16px; font-weight: 800; letter-spacing: .3px; }
  header .meta { color: var(--muted); font-size: 12px; }
  .legend { display: flex; gap: 11px; flex-wrap: wrap; margin-left: 16px; }
  .legend span { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); }
  .legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .status { display: flex; align-items: center; gap: 6px; margin-left: auto; font-size: 12px; color: var(--muted); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--red); transition: background .3s; }
  .dot.live { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .toolbar { display: flex; gap: 8px; }
  .toolbar button {
    background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: 7px; padding: 5px 11px; font-size: 12px; cursor: pointer; font-family: inherit; font-weight: 600;
  }
  .toolbar button:hover { border-color: var(--accent); }
  .toolbar button.off { opacity: .5; }

  #stage { position: relative; height: calc(100vh - 50px); overflow: auto; padding: 40px 30px 70px; }
  #edges { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1; overflow: visible; }

  /* layer = top-level cloud-architecture container box */
  .layer {
    position: relative; z-index: 2; border: 1.6px solid var(--lc, var(--line));
    border-radius: 16px; background: var(--panel);
    margin: 24px auto 38px; max-width: 1180px; padding: 30px 20px 22px;
    box-shadow: var(--shadow);
  }
  .layer-badge {
    position: absolute; top: -15px; left: 20px; display: flex; align-items: center; gap: 8px;
    background: var(--lc, var(--line)); color: #fff; padding: 5px 14px; border-radius: 9px;
    font-size: 11.5px; font-weight: 800; letter-spacing: .9px; text-transform: uppercase;
    box-shadow: var(--shadow-sm);
  }
  .layer-badge .lb-icon { font-size: 14px; }
  .layer-badge .lb-count { background: rgba(255,255,255,.28); border-radius: 12px; padding: 1px 7px; font-size: 10px; }
  .nodes { display: flex; flex-wrap: wrap; gap: 14px; }
  .layer.component .nodes, .layer.backend .nodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); }

  .node {
    display: flex; align-items: center; gap: 10px; background: var(--card);
    border: 1px solid var(--border); border-radius: 11px; padding: 11px 13px;
    cursor: pointer; transition: transform .12s, border-color .12s, box-shadow .12s;
    min-width: 140px; position: relative; box-shadow: var(--shadow-sm);
  }
  .node::before { content: ''; position: absolute; left: 0; top: 9px; bottom: 9px; width: 4px; border-radius: 0 3px 3px 0; background: var(--lc, var(--line)); }
  .node:hover { transform: translateY(-2px); border-color: var(--lc, var(--accent)); box-shadow: 0 8px 20px rgba(20,20,40,.14); }
  .node.selected { border-color: var(--lc, var(--accent)); box-shadow: 0 0 0 2.5px var(--lc, var(--accent)); }
  .node.dim { opacity: .25; }
  .node .icon {
    font-size: 17px; flex: 0 0 auto; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
    background: var(--lc-soft, rgba(0,0,0,.04)); border-radius: 9px;
  }
  .node .body { min-width: 0; }
  .node .label { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .node .tag { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; font-weight: 600; }
  .node .deg { position: absolute; top: -8px; right: -8px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 10px; background: var(--lc, var(--line)); color: #fff; font-size: 10px; font-weight: 800; display: none; align-items: center; justify-content: center; box-shadow: var(--shadow-sm); }
  .node.has-deg .deg { display: flex; }
  @keyframes flash {
    0% { background: var(--flash); border-color: var(--green); box-shadow: 0 0 0 4px var(--flash); }
    100% { background: var(--card); border-color: var(--border); box-shadow: var(--shadow-sm); }
  }
  .node.flash { animation: flash 1.6s ease-out; }

  #panel {
    position: fixed; right: 0; top: 50px; width: 330px; height: calc(100vh - 50px);
    background: var(--panel); border-left: 1px solid var(--border); padding: 22px;
    transform: translateX(100%); transition: transform .2s; z-index: 40; overflow-y: auto; box-shadow: -8px 0 24px rgba(20,20,40,.08);
  }
  #panel.open { transform: translateX(0); }
  #panel h2 { font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  #panel .ptype { color: var(--muted); font-size: 12px; margin-bottom: 16px; }
  #panel .row { font-size: 12px; margin-bottom: 10px; word-break: break-all; }
  #panel .row b { color: var(--muted); display: block; margin-bottom: 3px; font-weight: 600; }
  #panel ul { list-style: none; margin-top: 4px; }
  #panel li { font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  #panel .close { position: absolute; top: 16px; right: 18px; cursor: pointer; color: var(--muted); font-size: 18px; }

  #toast {
    position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%) translateY(90px);
    background: var(--panel); border: 1px solid var(--green); color: var(--text);
    padding: 10px 18px; border-radius: 10px; font-size: 13px; z-index: 50;
    transition: transform .25s; box-shadow: var(--shadow); font-weight: 600;
  }
  #toast.show { transform: translateX(-50%) translateY(0); }
  .edge-label { font: 600 10.5px ui-sans-serif, system-ui, sans-serif; fill: var(--text); }
  .edge-label-bg { fill: var(--panel); stroke: var(--border); stroke-width: 1; rx: 5; }
</style>
</head>
<body class="light">
<header>
  <h1>⬡ LiveArch</h1>
  <span class="meta" id="meta"></span>
  <div class="legend" id="legend"></div>
  <div class="toolbar">
    <button id="toggleEdges">Arrows: on</button>
    <button id="toggleLabels">Labels: on</button>
    <button id="toggleTheme">◐ Theme</button>
  </div>
  <div class="status">
    <span class="dot" id="dot"></span>
    <span id="statusText">Connecting…</span>
  </div>
</header>

<div id="stage">
  <svg id="edges"></svg>
  <div id="layers"></div>
</div>

<aside id="panel">
  <span class="close" onclick="closePanel()">✕</span>
  <h2 id="pTitle"></h2>
  <div class="ptype" id="pType"></div>
  <div class="row" id="pFile"></div>
  <div class="row"><b>Connections</b><ul id="pConns"></ul></div>
</aside>

<div id="toast"></div>

<script>
let ARCH = ${archJson};
const PORT = ${port};
let showEdges = true;
let showLabels = true;
let selectedId = null;

// pastel cloud-architecture palette, one colour per layer
const LAYER_COLORS = {
  entry: '#c2772a', framework: '#2866c4', component: '#7c54c9',
  backend: '#2e8b57', data: '#c2417f', external: '#b8860b', tooling: '#1f8a8a',
};
function soft(hex) { // translucent tint of the layer colour for icon chips
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',.12)';
}

const $ = (id) => document.getElementById(id);

function degree(id) {
  let d = 0;
  for (const e of ARCH.edges) if (e.from === id || e.to === id) d++;
  return d;
}

function buildDiagram() {
  const layers = $('layers');
  layers.innerHTML = '';
  const order = (ARCH.layers && ARCH.layers.order) || [];
  const labels = (ARCH.layers && ARCH.layers.labels) || {};

  for (const layerId of order) {
    const nodes = ARCH.nodes.filter((n) => n.layer === layerId);
    if (!nodes.length) continue;
    const color = LAYER_COLORS[layerId] || '#888';

    const box = document.createElement('div');
    box.className = 'layer ' + layerId;
    box.style.setProperty('--lc', color);

    const full = labels[layerId] || layerId;
    const icon = full.split(' ')[0];
    const name = full.replace(/^\\S+\\s*/, '');
    const badge = document.createElement('div');
    badge.className = 'layer-badge';
    badge.innerHTML = '<span class="lb-icon">' + icon + '</span>' + esc(name) +
      '<span class="lb-count">' + nodes.length + '</span>';
    box.appendChild(badge);

    const wrap = document.createElement('div');
    wrap.className = 'nodes';
    for (const n of nodes) {
      const deg = degree(n.id);
      const el = document.createElement('div');
      el.className = 'node' + (deg ? ' has-deg' : '');
      el.id = 'n-' + cssId(n.id);
      el.dataset.id = n.id;
      el.style.setProperty('--lc', color);
      el.style.setProperty('--lc-soft', soft(color));
      el.innerHTML =
        '<span class="icon">' + (n.icon || '•') + '</span>' +
        '<span class="body"><span class="label">' + esc(n.label) + '</span>' +
        '<span class="tag">' + esc(n.type || '') + '</span></span>' +
        '<span class="deg">' + deg + '</span>';
      el.title = (n.type || '') + (n.file ? ' — ' + n.file : '');
      el.onclick = () => selectNode(n.id);
      wrap.appendChild(el);
    }
    box.appendChild(wrap);
    layers.appendChild(box);
  }

  buildLegend(order, labels);
  $('meta').textContent = ARCH.name + ' · ' + ARCH.nodes.length + ' nodes · ' + ARCH.edges.length + ' edges · ' + ARCH.fileCount + ' files';
  requestAnimationFrame(drawEdges);
}

function buildLegend(order, labels) {
  const present = order.filter((l) => ARCH.nodes.some((n) => n.layer === l));
  $('legend').innerHTML = present.map((l) => {
    const full = labels[l] || l;
    const name = full.replace(/^\\S+\\s*/, '');
    return '<span><i style="background:' + (LAYER_COLORS[l] || '#888') + '"></i>' + esc(name) + '</span>';
  }).join('');
}

function cssId(id) { return id.replace(/[^a-zA-Z0-9_-]/g, '_'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

function drawEdges() {
  const svg = $('edges');
  svg.innerHTML = '';
  if (!showEdges) return;
  const stage = $('stage');
  const sb = stage.getBoundingClientRect();
  svg.setAttribute('width', stage.scrollWidth);
  svg.setAttribute('height', stage.scrollHeight);

  const defs = svgEl('defs');
  defs.innerHTML =
    '<marker id="ah" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">' +
    '<path d="M0,0 L7,3 L0,6 Z" fill="#9aa0aa"/></marker>' +
    '<marker id="ah-on" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">' +
    '<path d="M0,0 L7,3 L0,6 Z" fill="#2866c4"/></marker>';
  svg.appendChild(defs);

  const labelLayer = svgEl('g'); // draw labels above lines

  for (const e of ARCH.edges) {
    const a = document.getElementById('n-' + cssId(e.from));
    const b = document.getElementById('n-' + cssId(e.to));
    if (!a || !b) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const ox = stage.scrollLeft - sb.left, oy = stage.scrollTop - sb.top;
    const ax = ra.left + ra.width / 2 + ox, ay = ra.bottom + oy, atop = ra.top + oy;
    const bx = rb.left + rb.width / 2 + ox, by = rb.top + oy, bbot = rb.bottom + oy;
    const active = selectedId && (e.from === selectedId || e.to === selectedId);

    // Elbow (right-angle) connector. Go downward if B is below A, else route up.
    let x1, y1, x2, y2;
    if (by >= ay) { x1 = ax; y1 = ay; x2 = bx; y2 = by; }        // A bottom → B top
    else { x1 = ax; y1 = atop; x2 = bx; y2 = bbot; }              // A top → B bottom
    const midY = (y1 + y2) / 2;
    const d = 'M ' + x1 + ' ' + y1 + ' L ' + x1 + ' ' + midY + ' L ' + x2 + ' ' + midY + ' L ' + x2 + ' ' + y2;

    const path = svgEl('path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', active ? '#2866c4' : '#aeb4bd');
    path.setAttribute('stroke-width', active ? '2' : '1.4');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('marker-end', active ? 'url(#ah-on)' : 'url(#ah)');
    if (selectedId && !active) path.setAttribute('opacity', '.12');
    svg.appendChild(path);

    if (showLabels && e.label && (!selectedId || active)) {
      const lx = (x1 + x2) / 2, ly = midY;
      const w = e.label.length * 6.2 + 12;
      const bg = svgEl('rect');
      bg.setAttribute('x', lx - w / 2); bg.setAttribute('y', ly - 9);
      bg.setAttribute('width', w); bg.setAttribute('height', 18);
      bg.setAttribute('rx', 5); bg.setAttribute('class', 'edge-label-bg');
      if (selectedId && !active) bg.setAttribute('opacity', '.12');
      labelLayer.appendChild(bg);
      const t = svgEl('text');
      t.setAttribute('x', lx); t.setAttribute('y', ly + 4);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'edge-label');
      if (selectedId && !active) t.setAttribute('opacity', '.12');
      t.textContent = e.label;
      labelLayer.appendChild(t);
    }
  }
  svg.appendChild(labelLayer);
}

function selectNode(id) {
  selectedId = id;
  const node = ARCH.nodes.find((n) => n.id === id);
  if (!node) return;
  document.querySelectorAll('.node').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
  const neighbours = new Set([id]);
  for (const e of ARCH.edges) {
    if (e.from === id) neighbours.add(e.to);
    if (e.to === id) neighbours.add(e.from);
  }
  document.querySelectorAll('.node').forEach((el) => el.classList.toggle('dim', !neighbours.has(el.dataset.id)));

  $('pTitle').innerHTML = '<span>' + (node.icon || '') + '</span> ' + esc(node.label);
  $('pType').textContent = node.type + ' · ' + node.layer + ' layer';
  $('pFile').innerHTML = node.file ? '<b>File</b>' + esc(node.file) : '<b>File</b>—';
  const conns = ARCH.edges
    .filter((e) => e.from === id || e.to === id)
    .map((e) => {
      const other = e.from === id ? e.to : e.from;
      const on = ARCH.nodes.find((n) => n.id === other);
      const dir = e.from === id ? '→' : '←';
      return dir + ' ' + (on ? (on.icon || '') + ' ' + on.label : other) + '  (' + e.label + ')';
    });
  $('pConns').innerHTML = conns.length ? conns.map((c) => '<li>' + esc(c) + '</li>').join('') : '<li>No connections</li>';
  $('panel').classList.add('open');
  drawEdges();
}

function closePanel() {
  selectedId = null;
  $('panel').classList.remove('open');
  document.querySelectorAll('.node').forEach((el) => el.classList.remove('selected', 'dim'));
  drawEdges();
}

function flashNode(id) {
  const el = document.getElementById('n-' + cssId(id));
  if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

$('toggleEdges').onclick = () => {
  showEdges = !showEdges;
  $('toggleEdges').textContent = 'Arrows: ' + (showEdges ? 'on' : 'off');
  $('toggleEdges').classList.toggle('off', !showEdges);
  drawEdges();
};
$('toggleLabels').onclick = () => {
  showLabels = !showLabels;
  $('toggleLabels').textContent = 'Labels: ' + (showLabels ? 'on' : 'off');
  $('toggleLabels').classList.toggle('off', !showLabels);
  drawEdges();
};
$('toggleTheme').onclick = () => {
  document.body.classList.toggle('dark');
  document.body.classList.toggle('light');
  requestAnimationFrame(drawEdges);
};

$('stage').addEventListener('scroll', () => requestAnimationFrame(drawEdges));
window.addEventListener('resize', () => requestAnimationFrame(drawEdges));

function setStatus(live, text) {
  $('dot').classList.toggle('live', live);
  $('statusText').textContent = text;
}

function connect() {
  let ws;
  try { ws = new WebSocket('ws://localhost:' + PORT); }
  catch { setStatus(false, 'Not connected — run: npx livearch'); return; }
  ws.onopen = () => setStatus(true, 'Live');
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg.arch) return;
    const prevIds = new Set(ARCH.nodes.map((n) => n.id));
    ARCH = msg.arch;
    buildDiagram();
    if (msg.type === 'update') {
      for (const n of ARCH.nodes) if (!prevIds.has(n.id)) flashNode(n.id);
      if (msg.file) {
        const verb = msg.event === 'remove' ? '➖ Removed' : msg.event === 'add' ? '➕ Added' : '✏ Changed';
        toast(verb + ': ' + msg.file);
      }
    }
  };
  ws.onclose = () => { setStatus(false, 'Not connected — run: npx livearch'); setTimeout(connect, 2000); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

buildDiagram();
connect();
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = { render };
