'use strict';

/**
 * template.js — generates the self-contained .visualarch.html file.
 *
 * Renders an eraser.io-style **cloud-architecture diagram**:
 *   - warm light canvas
 *   - top-level container boxes per layer (colored border + UPPERCASE badge)
 *   - nested subsystem sub-boxes (nodes grouped by type) when a layer has
 *     more than one group; otherwise nodes sit directly in the layer box
 *   - clean monochrome line icons (inline SVG, lucide-style) — not emoji
 *   - right-angle (elbow) connectors carrying labels
 *
 * Everything (CSS + JS) is inlined and the arch data is baked in as
 * `const ARCH = {...}`. A WebSocket client gives live updates and degrades
 * gracefully when the watcher is offline. A theme toggle switches light/dark.
 */

// Official brand logos (simple-icons single-path SVGs) keyed by node id,
// baked in so the output stays self-contained/offline.
const BRAND_ICONS = require('./brand-icons.json');

/**
 * @param {object} arch  Architecture object from analyser.analyse().
 * @param {object} [opts]
 * @param {number} [opts.port=7842]  WebSocket port the watcher listens on.
 * @returns {string} Complete HTML document.
 */
function render(arch, opts = {}) {
  const port = opts.port || 7842;
  const archJson = JSON.stringify(arch);
  const brandJson = JSON.stringify(BRAND_ICONS);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>⬡ LiveArch — ${escapeHtml(arch.name)}</title>
<style>
  :root {
    --bg: #fbf9f4; --grid: rgba(120,110,90,.07);
    --panel: #ffffff; --card: #ffffff; --border: #e7e3d8;
    --text: #34302a; --muted: #978f80; --accent: #2b6cb0;
    --line: #b9b3a6; --green: #2e9e54; --red: #d9594e; --flash: #d8f3df;
    --shadow: 0 6px 20px rgba(60,50,30,.09); --shadow-sm: 0 2px 7px rgba(60,50,30,.08);
  }
  body.dark {
    --bg: #0c0f15; --grid: rgba(120,130,150,.10);
    --panel: #141a24; --card: #10151d; --border: #28303d;
    --text: #e6edf3; --muted: #8b98ad; --accent: #58a6ff;
    --line: #3a4456; --green: #3fb950; --red: #f85149; --flash: #16351f;
    --shadow: 0 8px 30px rgba(0,0,0,.5); --shadow-sm: 0 2px 8px rgba(0,0,0,.45);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); overflow: hidden;
    background-image: radial-gradient(var(--grid) 1.3px, transparent 1.3px);
    background-size: 24px 24px;
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

  #stage { position: relative; height: calc(100vh - 50px); overflow: auto; padding: 42px 34px 80px; }
  #edges { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1; overflow: visible; }

  /* level 1 — layer container */
  .layer {
    position: relative; z-index: 2; border: 1.7px solid var(--lc, var(--line));
    border-radius: 18px; background: var(--lc-bg, var(--panel));
    margin: 26px auto 40px; max-width: 1220px; padding: 32px 22px 24px;
    box-shadow: var(--shadow);
  }
  .layer-badge {
    position: absolute; top: -16px; left: 22px; display: flex; align-items: center; gap: 8px;
    background: var(--lc, var(--line)); color: #fff; padding: 6px 15px; border-radius: 10px;
    font-size: 11.5px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;
    box-shadow: var(--shadow-sm);
  }
  .layer-badge svg { width: 15px; height: 15px; }
  .layer-badge .lb-count { background: rgba(255,255,255,.3); border-radius: 12px; padding: 1px 8px; font-size: 10px; }

  /* level 2 — subsystem groups inside a layer */
  .groups { display: flex; flex-wrap: wrap; gap: 22px; }
  .subbox {
    position: relative; border: 1.4px solid var(--lc, var(--line)); border-radius: 14px;
    background: var(--card); padding: 26px 16px 16px; flex: 1 1 auto; min-width: 220px;
    box-shadow: var(--shadow-sm);
  }
  .sub-head {
    position: absolute; top: -12px; left: 16px; display: flex; align-items: center; gap: 6px;
    background: var(--card); color: var(--lc, var(--text)); padding: 2px 10px; border-radius: 8px;
    font-size: 10.5px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase;
    border: 1.2px solid var(--lc, var(--border));
  }
  .sub-head svg { width: 13px; height: 13px; }

  .nodes { display: flex; flex-wrap: wrap; gap: 8px; }

  /* leaf node — icon tile + label, eraser style */
  .node {
    display: flex; flex-direction: column; align-items: center; gap: 7px;
    width: 104px; padding: 9px 6px; border-radius: 12px; cursor: pointer;
    background: transparent; border: 1.4px solid transparent; position: relative;
    transition: background .12s, border-color .12s, transform .12s;
  }
  .node:hover { transform: translateY(-2px); background: var(--lc-soft); border-color: var(--lc, var(--accent)); }
  .node.selected { background: var(--lc-soft); border-color: var(--lc, var(--accent)); box-shadow: 0 0 0 2.5px var(--lc, var(--accent)); }
  .node.related { background: var(--lc-soft); border-color: var(--lc, var(--accent)); }
  .node.dim { opacity: .15; }
  .node .tile {
    width: 46px; height: 46px; display: flex; align-items: center; justify-content: center;
    background: var(--lc-soft); color: var(--lc, var(--accent)); border-radius: 13px;
    border: 1.3px solid var(--lc, var(--line));
  }
  .node .tile svg { width: 24px; height: 24px; }
  /* brand logos carry their own colour — show them on a clean white chip */
  .node .tile.brand { background: #fff; border-color: var(--border); }
  body.dark .node .tile.brand { background: #f4f6fa; }
  .node .label { font-size: 12px; font-weight: 700; text-align: center; line-height: 1.25; max-width: 100%; word-break: break-word; }
  @keyframes flash {
    0% { background: var(--flash); transform: scale(1.06); }
    100% { background: transparent; transform: scale(1); }
  }
  .node.flash { animation: flash 1.6s ease-out; }

  #panel {
    position: fixed; right: 0; top: 50px; width: 330px; height: calc(100vh - 50px);
    background: var(--panel); border-left: 1px solid var(--border); padding: 22px;
    transform: translateX(100%); transition: transform .2s; z-index: 40; overflow-y: auto; box-shadow: -8px 0 24px rgba(60,50,30,.1);
  }
  #panel.open { transform: translateX(0); }
  #panel h2 { font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  #panel h2 svg { width: 18px; height: 18px; }
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
  .edge-label-bg { fill: var(--panel); stroke: var(--border); stroke-width: 1; }
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
const BRAND = ${brandJson};
const PORT = ${port};
let showEdges = true;
let showLabels = true;
let selectedId = null;

const LAYER_COLORS = {
  entry: '#c2772a', framework: '#2b6cb0', component: '#7c54c9',
  backend: '#2e8b57', data: '#c2417f', external: '#b8860b', tooling: '#1f8a8a',
};

// node type -> subsystem group label (level-2 box title)
const GROUP_LABELS = {
  framework: 'Frameworks', backend: 'Services', database: 'Databases',
  component: 'Components', page: 'Pages', hook: 'Hooks', state: 'State',
  route: 'Routes / API', middleware: 'Middleware', model: 'Models',
  data: 'Data', asset: 'Assets', entry: 'Entry', test: 'Tests',
  tooling: 'Build Tools', external: 'Integrations', config: 'Config', service: 'Services',
};
const TYPE_ORDER = ['entry','framework','page','component','hook','state','route','middleware','service','backend','model','database','data','asset','external','config','test','tooling'];

// lucide-style inline line icons, keyed by node type
const ICONS = {
  framework: '<circle cx="12" cy="12" r="2.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/>',
  backend: '<rect x="3" y="4" width="18" height="7" rx="1.6"/><rect x="3" y="13" width="18" height="7" rx="1.6"/><circle cx="7" cy="7.5" r=".6"/><circle cx="7" cy="16.5" r=".6"/>',
  service: '<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  component: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  page: '<path d="M6 2h8l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v5h5"/>',
  hook: '<circle cx="12" cy="5" r="2.4"/><path d="M12 7.4V20"/><path d="M5 13a7 7 0 0 0 14 0"/><path d="M3 13h3M18 13h3"/>',
  state: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 4v5h-5"/>',
  route: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  middleware: '<path d="M3 4h18l-7 9v6l-4 2v-8z"/>',
  model: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>',
  data: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 13h18"/><circle cx="17" cy="15.5" r=".9"/>',
  asset: '<rect x="3" y="3" width="18" height="18" rx="2.4"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/>',
  entry: '<path d="M7 4 19 12 7 20z"/>',
  test: '<path d="M9 3h6M10 3v6l-5.2 9.3A2 2 0 0 0 6.6 21h10.8a2 2 0 0 0 1.8-2.7L14 9V3"/><path d="M8 15h8"/>',
  tooling: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2.1"/><circle cx="15" cy="12" r="2.1"/><circle cx="9" cy="18" r="2.1"/>',
  external: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  config: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8 2.2 2.2-2 2 2 2-2.2 2.2-2-2-2.8 2.8"/>',
};
function iconSvg(type) {
  const inner = ICONS[type] || '<circle cx="12" cy="12" r="8.5"/>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
}
// Resolve a node to its official brand logo, if any (dep-* ids + Docker).
function brandFor(node) {
  return BRAND[node.id] || (node.label === 'Docker' ? BRAND.docker : null);
}
// Icon for a node: brand logo (filled, brand colour) when available, else the
// generic line icon for its type.
function nodeIconSvg(node) {
  const b = brandFor(node);
  if (b) return '<svg viewBox="0 0 24 24" fill="' + b.hex + '"><path d="' + b.d + '"/></svg>';
  return iconSvg(node.type);
}
function soft(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return { soft: 'rgba(' + r + ',' + g + ',' + b + ',.12)', bg: 'rgba(' + r + ',' + g + ',' + b + ',.04)' };
}

const $ = (id) => document.getElementById(id);

function makeNode(n, color) {
  const el = document.createElement('div');
  el.className = 'node';
  el.id = 'n-' + cssId(n.id);
  el.dataset.id = n.id;
  el.style.setProperty('--lc', color);
  el.innerHTML =
    '<span class="tile' + (brandFor(n) ? ' brand' : '') + '">' + nodeIconSvg(n) + '</span>' +
    '<span class="label">' + esc(n.label) + '</span>';
  el.title = (n.type || '') + (n.file ? ' — ' + n.file : '');
  el.onclick = () => selectNode(n.id);
  return el;
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
    const tints = soft(color);

    const box = document.createElement('div');
    box.className = 'layer ' + layerId;
    box.style.setProperty('--lc', color);
    box.style.setProperty('--lc-soft', tints.soft);
    box.style.setProperty('--lc-bg', tints.bg);

    const full = labels[layerId] || layerId;
    const name = full.replace(/^\\S+\\s*/, '');
    const badge = document.createElement('div');
    badge.className = 'layer-badge';
    badge.innerHTML = iconSvg(repType(nodes)) + esc(name) + '<span class="lb-count">' + nodes.length + '</span>';
    box.appendChild(badge);

    // group nodes by type
    const byType = {};
    for (const n of nodes) (byType[n.type] ||= []).push(n);
    const types = [...TYPE_ORDER.filter((t) => byType[t]), ...Object.keys(byType).filter((t) => !TYPE_ORDER.includes(t))];

    if (types.length > 1) {
      // nested subsystem boxes
      const groups = document.createElement('div');
      groups.className = 'groups';
      for (const t of types) {
        const sub = document.createElement('div');
        sub.className = 'subbox';
        sub.style.setProperty('--lc', color);
        sub.style.setProperty('--lc-soft', tints.soft);
        const head = document.createElement('div');
        head.className = 'sub-head';
        head.innerHTML = iconSvg(t) + esc(GROUP_LABELS[t] || t);
        sub.appendChild(head);
        const wrap = document.createElement('div');
        wrap.className = 'nodes';
        for (const n of byType[t]) wrap.appendChild(makeNode(n, color));
        sub.appendChild(wrap);
        groups.appendChild(sub);
      }
      box.appendChild(groups);
    } else {
      // single group → nodes directly in the layer box
      const wrap = document.createElement('div');
      wrap.className = 'nodes';
      for (const n of nodes) wrap.appendChild(makeNode(n, color));
      box.appendChild(wrap);
    }

    layers.appendChild(box);
  }

  buildLegend(order, labels);
  $('meta').textContent = ARCH.name + ' · ' + ARCH.nodes.length + ' nodes · ' + ARCH.edges.length + ' edges · ' + ARCH.fileCount + ' files';
  requestAnimationFrame(drawEdges);
}

function repType(nodes) { // representative icon for a layer badge = most common type
  const c = {}; let best = nodes[0].type, n = 0;
  for (const x of nodes) { c[x.type] = (c[x.type] || 0) + 1; if (c[x.type] > n) { n = c[x.type]; best = x.type; } }
  return best;
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
    '<marker id="ah" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#9aa0aa"/></marker>' +
    '<marker id="ah-on" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#2b6cb0"/></marker>';
  svg.appendChild(defs);
  const labelLayer = svgEl('g');

  for (const e of ARCH.edges) {
    const a = document.getElementById('n-' + cssId(e.from));
    const b = document.getElementById('n-' + cssId(e.to));
    if (!a || !b) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const ox = stage.scrollLeft - sb.left, oy = stage.scrollTop - sb.top;
    const ax = ra.left + ra.width / 2 + ox, ay = ra.bottom + oy, atop = ra.top + oy;
    const bx = rb.left + rb.width / 2 + ox, by = rb.top + oy, bbot = rb.bottom + oy;
    const active = selectedId && (e.from === selectedId || e.to === selectedId);

    let x1, y1, x2, y2;
    if (by >= ay) { x1 = ax; y1 = ay; x2 = bx; y2 = by; }
    else { x1 = ax; y1 = atop; x2 = bx; y2 = bbot; }
    const midY = (y1 + y2) / 2;
    const d = 'M ' + x1 + ' ' + y1 + ' L ' + x1 + ' ' + midY + ' L ' + x2 + ' ' + midY + ' L ' + x2 + ' ' + y2;

    const path = svgEl('path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', active ? '#2b6cb0' : '#b9b3a6');
    path.setAttribute('stroke-width', active ? '2' : '1.4');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('marker-end', active ? 'url(#ah-on)' : 'url(#ah)');
    if (selectedId && !active) path.setAttribute('opacity', '.1');
    svg.appendChild(path);

    if (showLabels && e.label && (!selectedId || active)) {
      const lx = (x1 + x2) / 2, ly = midY;
      const w = e.label.length * 6.2 + 12;
      const bg = svgEl('rect');
      bg.setAttribute('x', lx - w / 2); bg.setAttribute('y', ly - 9);
      bg.setAttribute('width', w); bg.setAttribute('height', 18);
      bg.setAttribute('rx', 5); bg.setAttribute('class', 'edge-label-bg');
      if (selectedId && !active) bg.setAttribute('opacity', '.1');
      labelLayer.appendChild(bg);
      const t = svgEl('text');
      t.setAttribute('x', lx); t.setAttribute('y', ly + 4);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'edge-label');
      if (selectedId && !active) t.setAttribute('opacity', '.1');
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
  const neighbours = new Set();
  for (const e of ARCH.edges) {
    if (e.from === id) neighbours.add(e.to);
    if (e.to === id) neighbours.add(e.from);
  }
  // selected = the clicked node; related = every directly-connected node;
  // everything else is dimmed so the connections stand out clearly.
  document.querySelectorAll('.node').forEach((el) => {
    const nid = el.dataset.id;
    el.classList.toggle('selected', nid === id);
    el.classList.toggle('related', nid !== id && neighbours.has(nid));
    el.classList.toggle('dim', nid !== id && !neighbours.has(nid));
  });

  $('pTitle').innerHTML = '<span class="tile" style="width:26px;height:26px;border:none;background:transparent;color:' + (LAYER_COLORS[node.layer] || '#888') + '">' + nodeIconSvg(node) + '</span> ' + esc(node.label);
  $('pType').textContent = node.type + ' · ' + node.layer + ' layer';
  $('pFile').innerHTML = node.file ? '<b>File</b>' + esc(node.file) : '<b>File</b>—';
  const conns = ARCH.edges
    .filter((e) => e.from === id || e.to === id)
    .map((e) => {
      const other = e.from === id ? e.to : e.from;
      const on = ARCH.nodes.find((n) => n.id === other);
      const dir = e.from === id ? '→' : '←';
      return dir + ' ' + (on ? on.label : other) + '  (' + e.label + ')';
    });
  $('pConns').innerHTML = conns.length ? conns.map((c) => '<li>' + esc(c) + '</li>').join('') : '<li>No connections</li>';
  $('panel').classList.add('open');
  drawEdges();
}

function closePanel() {
  selectedId = null;
  $('panel').classList.remove('open');
  document.querySelectorAll('.node').forEach((el) => el.classList.remove('selected', 'dim', 'related'));
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
