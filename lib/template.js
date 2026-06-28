'use strict';

/**
 * template.js — generates the self-contained .visualarch.html file.
 *
 * The output has everything inlined (CSS + JS) and the architecture data
 * baked in as `const ARCH = {...}`. A WebSocket client connects to the
 * watcher for live updates and degrades gracefully when it is offline.
 *
 * The diagram is laid out as a classic top-to-bottom architecture view:
 * colored layer bands (Entry → Framework → Components → Backend → Data →
 * External → Tooling), node cards grouped per band, and labeled directional
 * arrows showing how the layers connect.
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
    --bg: #0a0e14; --panel: #11161f; --border: #232b38; --line: #3a4456;
    --text: #e6edf3; --muted: #8b98ad; --accent: #58a6ff; --green: #3fb950;
    --red: #f85149; --flash: #2ea04355;
    /* per-layer accent colours */
    --c-entry: #f0883e; --c-framework: #58a6ff; --c-component: #a371f7;
    --c-backend: #2ea043; --c-data: #db61a2; --c-external: #e3b341; --c-tooling: #56d4dd;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
    background: radial-gradient(1200px 700px at 50% -200px, #131a26 0%, var(--bg) 60%);
    color: var(--text); overflow: hidden;
    background-image:
      linear-gradient(rgba(58,68,86,.18) 1px, transparent 1px),
      linear-gradient(90deg, rgba(58,68,86,.18) 1px, transparent 1px);
    background-size: 30px 30px;
  }
  header {
    display: flex; align-items: center; gap: 14px; padding: 12px 22px;
    border-bottom: 1px solid var(--border); background: rgba(10,14,20,.88);
    backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 30;
  }
  header h1 { font-size: 16px; font-weight: 700; letter-spacing: .3px; }
  header .meta { color: var(--muted); font-size: 12px; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; margin-left: 18px; }
  .legend span { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); }
  .legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .status { display: flex; align-items: center; gap: 6px; margin-left: auto; font-size: 12px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--red); transition: background .3s; }
  .dot.live { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .toolbar { display: flex; gap: 8px; }
  .toolbar button {
    background: var(--panel); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: inherit;
  }
  .toolbar button:hover { border-color: var(--accent); }
  .toolbar button.off { opacity: .5; }

  #stage { position: relative; height: calc(100vh - 50px); overflow: auto; padding: 34px 30px 60px; }
  #edges { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1; overflow: visible; }

  .layer {
    position: relative; z-index: 2; border: 1px solid var(--border);
    border-left: 4px solid var(--lc, var(--line));
    border-radius: 12px; background: linear-gradient(180deg, rgba(17,22,31,.82), rgba(17,22,31,.55));
    margin: 0 auto 30px; max-width: 1180px; padding: 0 0 18px;
    box-shadow: 0 8px 30px rgba(0,0,0,.35);
  }
  .layer-head {
    display: flex; align-items: center; gap: 10px; padding: 12px 18px 10px;
    border-bottom: 1px dashed var(--border); margin-bottom: 14px;
  }
  .layer-head .lh-icon { font-size: 16px; }
  .layer-head .lh-name { font-size: 12.5px; letter-spacing: .8px; text-transform: uppercase; color: var(--lc, var(--text)); font-weight: 700; }
  .layer-head .lh-count { margin-left: auto; font-size: 11px; color: var(--muted); background: rgba(255,255,255,.04); border: 1px solid var(--border); padding: 2px 8px; border-radius: 20px; }
  .nodes { display: flex; flex-wrap: wrap; gap: 12px; padding: 0 18px; }
  .layer.component .nodes, .layer.backend .nodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }

  .node {
    display: flex; align-items: center; gap: 9px; background: #0d1219;
    border: 1px solid var(--line); border-radius: 9px; padding: 9px 11px;
    cursor: pointer; transition: transform .12s, border-color .12s, box-shadow .12s;
    min-width: 130px; position: relative;
  }
  .node::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: var(--lc, var(--line)); }
  .node:hover { transform: translateY(-2px); border-color: var(--lc, var(--accent)); box-shadow: 0 6px 18px rgba(0,0,0,.5); }
  .node.selected { border-color: var(--lc, var(--accent)); box-shadow: 0 0 0 2px var(--lc, var(--accent)) inset; }
  .node.dim { opacity: .2; }
  .node .icon { font-size: 18px; flex: 0 0 auto; }
  .node .body { min-width: 0; }
  .node .label { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .node .tag { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; }
  .node .deg { position: absolute; top: -7px; right: -7px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 9px; background: var(--lc, var(--line)); color: #0a0e14; font-size: 10px; font-weight: 700; display: none; align-items: center; justify-content: center; }
  .node.has-deg .deg { display: flex; }
  @keyframes flash {
    0% { background: var(--flash); border-color: var(--green); box-shadow: 0 0 0 3px var(--flash); }
    100% { background: #0d1219; border-color: var(--line); box-shadow: none; }
  }
  .node.flash { animation: flash 1.6s ease-out; }

  #panel {
    position: fixed; right: 0; top: 50px; width: 330px; height: calc(100vh - 50px);
    background: var(--panel); border-left: 1px solid var(--border); padding: 22px;
    transform: translateX(100%); transition: transform .2s; z-index: 40; overflow-y: auto;
  }
  #panel.open { transform: translateX(0); }
  #panel h2 { font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  #panel .ptype { color: var(--muted); font-size: 12px; margin-bottom: 16px; }
  #panel .row { font-size: 12px; margin-bottom: 10px; word-break: break-all; }
  #panel .row b { color: var(--muted); display: block; margin-bottom: 3px; font-weight: 400; }
  #panel ul { list-style: none; margin-top: 4px; }
  #panel li { font-size: 12px; padding: 5px 0; border-bottom: 1px solid var(--border); }
  #panel .close { position: absolute; top: 16px; right: 18px; cursor: pointer; color: var(--muted); font-size: 18px; }

  #toast {
    position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%) translateY(90px);
    background: var(--panel); border: 1px solid var(--green); color: var(--text);
    padding: 10px 18px; border-radius: 8px; font-size: 13px; z-index: 50;
    transition: transform .25s; box-shadow: 0 6px 22px rgba(0,0,0,.55);
  }
  #toast.show { transform: translateX(-50%) translateY(0); }
  .edge-label { font: 10px ui-monospace, monospace; fill: var(--muted); }
  .edge-label.active { fill: var(--accent); font-weight: 700; }
</style>
</head>
<body>
<header>
  <h1>⬡ LiveArch</h1>
  <span class="meta" id="meta"></span>
  <div class="legend" id="legend"></div>
  <div class="toolbar">
    <button id="toggleEdges">Arrows: on</button>
    <button id="toggleLabels">Labels: on</button>
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

const LAYER_COLORS = {
  entry: '#f0883e', framework: '#58a6ff', component: '#a371f7',
  backend: '#2ea043', data: '#db61a2', external: '#e3b341', tooling: '#56d4dd',
};

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
    const color = LAYER_COLORS[layerId] || 'var(--line)';

    const box = document.createElement('div');
    box.className = 'layer ' + layerId;
    box.style.setProperty('--lc', color);

    const head = document.createElement('div');
    head.className = 'layer-head';
    const full = labels[layerId] || layerId;
    const icon = full.split(' ')[0];
    const name = full.replace(/^\\S+\\s*/, '');
    head.innerHTML = '<span class="lh-icon">' + icon + '</span>' +
      '<span class="lh-name">' + esc(name) + '</span>' +
      '<span class="lh-count">' + nodes.length + ' node' + (nodes.length > 1 ? 's' : '') + '</span>';
    box.appendChild(head);

    const wrap = document.createElement('div');
    wrap.className = 'nodes';
    for (const n of nodes) {
      const deg = degree(n.id);
      const el = document.createElement('div');
      el.className = 'node' + (deg ? ' has-deg' : '');
      el.id = 'n-' + cssId(n.id);
      el.dataset.id = n.id;
      el.style.setProperty('--lc', color);
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

function drawEdges() {
  const svg = $('edges');
  svg.innerHTML = '';
  if (!showEdges) return;
  const stage = $('stage');
  const sb = stage.getBoundingClientRect();
  svg.setAttribute('width', stage.scrollWidth);
  svg.setAttribute('height', stage.scrollHeight);

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML =
    '<marker id="ah" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">' +
    '<path d="M0,0 L7,3 L0,6 Z" fill="#4a5568"/></marker>' +
    '<marker id="ah-on" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto">' +
    '<path d="M0,0 L7,3 L0,6 Z" fill="#58a6ff"/></marker>';
  svg.appendChild(defs);

  for (const e of ARCH.edges) {
    const a = document.getElementById('n-' + cssId(e.from));
    const b = document.getElementById('n-' + cssId(e.to));
    if (!a || !b) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x1 = ra.left - sb.left + stage.scrollLeft + ra.width / 2;
    const y1 = ra.bottom - sb.top + stage.scrollTop;
    const x2 = rb.left - sb.left + stage.scrollLeft + rb.width / 2;
    const y2 = rb.top - sb.top + stage.scrollTop;
    const my = (y1 + y2) / 2;
    const active = selectedId && (e.from === selectedId || e.to === selectedId);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + my + ' ' + x2 + ',' + my + ' ' + x2 + ',' + y2);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', active ? '#58a6ff' : '#3a4456');
    path.setAttribute('stroke-width', active ? '2' : '1.4');
    path.setAttribute('stroke-dasharray', '5 4');
    path.setAttribute('marker-end', active ? 'url(#ah-on)' : 'url(#ah)');
    if (selectedId && !active) path.setAttribute('opacity', '.12');
    svg.appendChild(path);

    if (showLabels && e.label && (!selectedId || active)) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', (x1 + x2) / 2);
      t.setAttribute('y', my - 3);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'edge-label' + (active ? ' active' : ''));
      t.textContent = e.label;
      svg.appendChild(t);
    }
  }
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
