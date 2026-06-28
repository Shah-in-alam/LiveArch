'use strict';

/**
 * analyser.js — Core intelligence for LiveArch.
 *
 * Runs in two passes:
 *   Pass 1 — read package.json, map dependencies to tech-stack nodes.
 *   Pass 2 — walk the file tree, classify each file into a node.
 * Then builds edges from a logical connection map.
 *
 * Returns an `arch` object: { name, nodes, edges, fileCount, timestamp }.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Layers — displayed top-to-bottom in the diagram.
// ---------------------------------------------------------------------------
const LAYER = {
  ENTRY: 'entry',
  FRAMEWORK: 'framework',
  COMPONENT: 'component',
  BACKEND: 'backend',
  DATA: 'data',
  EXTERNAL: 'external',
  TOOLING: 'tooling',
};

const LAYER_ORDER = [
  LAYER.ENTRY,
  LAYER.FRAMEWORK,
  LAYER.COMPONENT,
  LAYER.BACKEND,
  LAYER.DATA,
  LAYER.EXTERNAL,
  LAYER.TOOLING,
];

const LAYER_LABELS = {
  [LAYER.ENTRY]: '🚀 Entry Points',
  [LAYER.FRAMEWORK]: '⚛ Framework / Frontend',
  [LAYER.COMPONENT]: '🧩 Components',
  [LAYER.BACKEND]: '🚂 Backend / API',
  [LAYER.DATA]: '💾 Data',
  [LAYER.EXTERNAL]: '🌐 External',
  [LAYER.TOOLING]: '⚙ Tooling',
};

// ---------------------------------------------------------------------------
// Dependency → node map (Pass 1).
// Each entry: matched npm package names → node definition.
// ---------------------------------------------------------------------------
const DEP_MAP = [
  { match: ['react', 'react-dom'], id: 'dep-react', label: 'React', icon: '⚛', type: 'framework', layer: LAYER.FRAMEWORK },
  { match: ['next'], id: 'dep-next', label: 'Next.js', icon: '▲', type: 'framework', layer: LAYER.FRAMEWORK },
  { match: ['vue'], id: 'dep-vue', label: 'Vue', icon: '💚', type: 'framework', layer: LAYER.FRAMEWORK },
  { match: ['svelte'], id: 'dep-svelte', label: 'Svelte', icon: '🔥', type: 'framework', layer: LAYER.FRAMEWORK },
  { match: ['express'], id: 'dep-express', label: 'Express', icon: '🚂', type: 'backend', layer: LAYER.BACKEND },
  { match: ['fastify'], id: 'dep-fastify', label: 'Fastify', icon: '⚡', type: 'backend', layer: LAYER.BACKEND },
  { match: ['koa'], id: 'dep-koa', label: 'Koa', icon: '🌊', type: 'backend', layer: LAYER.BACKEND },
  { match: ['@nestjs/core'], id: 'dep-nest', label: 'NestJS', icon: '🐈', type: 'backend', layer: LAYER.BACKEND },
  { match: ['mongoose', 'mongodb'], id: 'dep-mongo', label: 'MongoDB', icon: '🍃', type: 'database', layer: LAYER.DATA },
  { match: ['pg', 'postgres'], id: 'dep-pg', label: 'PostgreSQL', icon: '🐘', type: 'database', layer: LAYER.DATA },
  { match: ['mysql', 'mysql2'], id: 'dep-mysql', label: 'MySQL', icon: '🐬', type: 'database', layer: LAYER.DATA },
  { match: ['prisma', '@prisma/client'], id: 'dep-prisma', label: 'Prisma', icon: '◈', type: 'database', layer: LAYER.DATA },
  { match: ['redis', 'ioredis'], id: 'dep-redis', label: 'Redis', icon: '⚡', type: 'database', layer: LAYER.DATA },
  { match: ['jsonwebtoken', 'passport'], id: 'dep-auth', label: 'Auth / JWT', icon: '🔐', type: 'external', layer: LAYER.EXTERNAL },
  { match: ['socket.io', 'ws'], id: 'dep-ws', label: 'WebSocket', icon: '📡', type: 'external', layer: LAYER.EXTERNAL },
  { match: ['stripe'], id: 'dep-stripe', label: 'Stripe', icon: '💳', type: 'external', layer: LAYER.EXTERNAL },
  { match: ['nodemailer', '@sendgrid/mail'], id: 'dep-email', label: 'Email', icon: '📧', type: 'external', layer: LAYER.EXTERNAL },
  { match: ['aws-sdk', '@aws-sdk/client-s3'], id: 'dep-aws', label: 'AWS / S3', icon: '☁', type: 'external', layer: LAYER.EXTERNAL },
  { match: ['jest', 'vitest'], id: 'dep-test', label: 'Tests', icon: '🧪', type: 'tooling', layer: LAYER.TOOLING },
  { match: ['@reduxjs/toolkit', 'redux'], id: 'dep-redux', label: 'Redux', icon: '🔄', type: 'state', layer: LAYER.COMPONENT },
  { match: ['zustand'], id: 'dep-zustand', label: 'Zustand', icon: '🐻', type: 'state', layer: LAYER.COMPONENT },
  { match: ['vite', '@vitejs/plugin-react'], id: 'dep-vite', label: 'Vite', icon: '⚡', type: 'tooling', layer: LAYER.TOOLING },
  { match: ['webpack'], id: 'dep-webpack', label: 'Webpack', icon: '📦', type: 'tooling', layer: LAYER.TOOLING },
  { match: ['tailwindcss'], id: 'dep-tailwind', label: 'Tailwind', icon: '🎨', type: 'tooling', layer: LAYER.TOOLING },
];

// Folders/files always ignored when walking the tree.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache',
  '.vercel', '.turbo', 'out', '.svelte-kit',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function safeReadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function baseNoExt(file) {
  return path.basename(file).replace(/\.[^.]+$/, '');
}

/**
 * Classify a single file path into a node, or return null to skip it.
 * @param {string} rel POSIX-style path relative to the project root.
 */
function classifyFile(rel) {
  const lower = rel.toLowerCase();
  const file = path.posix.basename(rel);
  const name = baseNoExt(rel);
  const ext = path.posix.extname(rel);
  const dirs = path.posix.dirname(rel).split('/');

  const inDir = (d) => dirs.includes(d);
  const isCode = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.mjs', '.cjs'].includes(ext);

  // Tests
  if (/\.(test|spec)\.[jt]sx?$/.test(file)) {
    return { id: `file-${rel}`, label: name, icon: '🧪', type: 'test', layer: LAYER.TOOLING, file: rel };
  }

  // Tooling / config files
  if (/^vite\.config\.[jt]s$/.test(file)) {
    return { id: 'dep-vite', label: 'Vite', icon: '⚡', type: 'tooling', layer: LAYER.TOOLING, file: rel };
  }
  if (file === 'docker-compose.yml' || file === 'docker-compose.yaml' || file === 'Dockerfile') {
    return { id: `file-${rel}`, label: 'Docker', icon: '🐳', type: 'tooling', layer: LAYER.TOOLING, file: rel };
  }
  if (file === '.env' || /^\.env\./.test(file)) {
    return { id: `file-${rel}`, label: 'Config', icon: '🔑', type: 'config', layer: LAYER.TOOLING, file: rel };
  }
  if (inDir('.github')) {
    return { id: 'group-cicd', label: 'CI/CD', icon: '🤖', type: 'tooling', layer: LAYER.TOOLING, file: rel };
  }

  // Entry points
  if (isCode && /^(main|index|app)$/i.test(name) && (inDir('src') || dirs.length <= 2)) {
    return { id: `file-${rel}`, label: file, icon: '🚀', type: 'entry', layer: LAYER.ENTRY, file: rel };
  }

  // Custom hooks by filename convention (useXxx.*) — wins over folder bucket.
  if (isCode && /^use[A-Z]/.test(name)) {
    return { id: `file-${rel}`, label: name, icon: '🪝', type: 'hook', layer: LAYER.COMPONENT, file: rel };
  }

  // Directory-based classification
  if (inDir('components')) {
    return { id: `file-${rel}`, label: name, icon: '🧩', type: 'component', layer: LAYER.COMPONENT, file: rel };
  }
  if (inDir('pages') || inDir('views')) {
    return { id: `file-${rel}`, label: name, icon: '📄', type: 'page', layer: LAYER.COMPONENT, file: rel };
  }
  if (inDir('hooks')) {
    return { id: `file-${rel}`, label: name, icon: '🪝', type: 'hook', layer: LAYER.COMPONENT, file: rel };
  }
  if (inDir('context') || inDir('store')) {
    return { id: `file-${rel}`, label: name, icon: '🔄', type: 'state', layer: LAYER.COMPONENT, file: rel };
  }
  if (inDir('routes') || inDir('api')) {
    return { id: `file-${rel}`, label: name, icon: '⚡', type: 'route', layer: LAYER.BACKEND, file: rel };
  }
  if (inDir('middleware')) {
    return { id: `file-${rel}`, label: name, icon: '🔀', type: 'middleware', layer: LAYER.BACKEND, file: rel };
  }
  if (inDir('services')) {
    return { id: `file-${rel}`, label: name, icon: '⚙', type: 'service', layer: LAYER.BACKEND, file: rel };
  }
  if (inDir('models') || inDir('schema')) {
    return { id: `file-${rel}`, label: name, icon: '📐', type: 'model', layer: LAYER.DATA, file: rel };
  }
  if (inDir('data')) {
    return { id: `file-${rel}`, label: name, icon: '💾', type: 'data', layer: LAYER.DATA, file: rel };
  }
  if (inDir('prisma')) {
    return { id: 'dep-prisma', label: 'Prisma', icon: '◈', type: 'database', layer: LAYER.DATA, file: rel };
  }
  if (dirs[0] === 'public') {
    return { id: 'group-static', label: 'Static assets', icon: '🖼', type: 'asset', layer: LAYER.DATA, file: rel };
  }

  // Generic component fallback for top-level UI files
  if (['.jsx', '.tsx', '.vue', '.svelte'].includes(ext)) {
    return { id: `file-${rel}`, label: name, icon: '🧩', type: 'component', layer: LAYER.COMPONENT, file: rel };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pass 1 — package.json scan (root + workspace packages for monorepos).
// ---------------------------------------------------------------------------
/**
 * Resolve a monorepo `workspaces` field to a list of package.json paths.
 * Supports the npm/yarn array form and the { packages: [...] } object form,
 * with simple trailing-glob patterns like "apps/*" and "packages/*".
 */
function workspacePkgFiles(root, workspaces) {
  const patterns = Array.isArray(workspaces)
    ? workspaces
    : (workspaces && Array.isArray(workspaces.packages) ? workspaces.packages : []);
  const out = [];
  for (const pat of patterns) {
    if (pat.includes('*')) {
      const base = pat.replace(/\/?\*+.*$/, ''); // "apps/*" -> "apps"
      const dir = path.join(root, base);
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || IGNORE_DIRS.has(e.name)) continue;
        const pj = path.join(dir, e.name, 'package.json');
        if (fs.existsSync(pj)) out.push(pj);
      }
    } else {
      const pj = path.join(root, pat, 'package.json');
      if (fs.existsSync(pj)) out.push(pj);
    }
  }
  return out;
}

function scanPackageJson(root) {
  const rootPkg = safeReadJSON(path.join(root, 'package.json'));
  const nodes = [];
  let name = path.basename(root);

  // Collect every dependency from the root package.json plus, in a monorepo,
  // each workspace package.json — so a Turborepo/yarn-workspaces root whose
  // own package.json only lists `turbo` still surfaces React/Express/etc.
  const deps = {};
  if (rootPkg) {
    if (rootPkg.name) name = rootPkg.name;
    Object.assign(deps, rootPkg.dependencies || {}, rootPkg.devDependencies || {});
    for (const pj of workspacePkgFiles(root, rootPkg.workspaces)) {
      const wp = safeReadJSON(pj);
      if (wp) Object.assign(deps, wp.dependencies || {}, wp.devDependencies || {});
    }
  }

  const keys = Object.keys(deps);
  for (const entry of DEP_MAP) {
    if (entry.match.some((m) => keys.includes(m))) {
      nodes.push({
        id: entry.id,
        label: entry.label,
        icon: entry.icon,
        type: entry.type,
        layer: entry.layer,
        file: 'package.json',
      });
    }
  }

  return { name, nodes };
}

// ---------------------------------------------------------------------------
// Pass 2 — folder/file scan (from a known list of tracked files).
// ---------------------------------------------------------------------------
function scanFiles(root, files) {
  const nodes = [];
  const seen = new Set();
  const relToId = new Map(); // every classified rel path → its node id (for import resolution)

  for (const abs of files) {
    let rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..')) continue;
    rel = rel.split(path.sep).join('/'); // normalise to POSIX

    if (rel.split('/').some((seg) => IGNORE_DIRS.has(seg))) continue;

    const node = classifyFile(rel);
    if (!node) continue;

    // Content-based upgrade: a file classified as a generic component but
    // which actually defines a custom hook (useXxx) is really a hook.
    if (node.type === 'component' && detectCustomHook(abs)) {
      node.type = 'hook';
      node.icon = '🪝';
    }

    relToId.set(rel, node.id);
    if (seen.has(node.id)) continue; // collapse grouped/duplicate ids
    seen.add(node.id);
    nodes.push(node);
  }

  return { nodes, relToId };
}

// ---------------------------------------------------------------------------
// Import parsing (v0.2) — read file content and extract module specifiers.
// ---------------------------------------------------------------------------
const CODE_EXT = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.mjs', '.cjs'];
const MAX_READ = 256 * 1024; // skip very large files

const IMPORT_RE = /import\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

// A file is a custom hook if it defines/exports a `useXxx` function or const.
const HOOK_RE = /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+use[A-Z]\w*|\b(?:export\s+)?const\s+use[A-Z]\w*\s*=/;

/** True if the source file defines a custom React hook (useXxx). */
function detectCustomHook(absPath) {
  if (!CODE_EXT.includes(path.extname(absPath))) return false;
  try {
    if (fs.statSync(absPath).size > MAX_READ) return false;
    return HOOK_RE.test(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return false;
  }
}

/** Extract relative import specifiers from a source file. Returns [] on any error. */
function parseImports(absPath) {
  if (!CODE_EXT.includes(path.extname(absPath))) return [];
  let src;
  try {
    if (fs.statSync(absPath).size > MAX_READ) return [];
    src = fs.readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const specs = new Set();
  for (const re of [IMPORT_RE, REQUIRE_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const s = m[1];
      if (s.startsWith('.') || s.startsWith('/')) specs.add(s); // relative only
    }
  }
  return [...specs];
}

/** Resolve a relative specifier (from importerRel) to a known rel path, or null. */
function resolveImport(importerRel, spec, relSet) {
  const baseDir = path.posix.dirname(importerRel);
  const target = path.posix.normalize(path.posix.join(baseDir, spec)).replace(/^\.\//, '');
  if (relSet.has(target)) return target;
  for (const ext of CODE_EXT) {
    if (relSet.has(target + ext)) return target + ext;
  }
  for (const ext of CODE_EXT) {
    if (relSet.has(target + '/index' + ext)) return target + '/index' + ext;
  }
  return null;
}

// Express/Fastify/Koa route definitions: app.get('/x'), router.post("/y"), etc.
const ROUTE_RE = /\b(?:app|router|fastify|server|api)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*['"\`]([^'"\`]+)['"\`]/gi;

/** Extract HTTP route definitions from a source file. Returns [{method, route}]. */
function parseRoutes(absPath) {
  if (!CODE_EXT.includes(path.extname(absPath))) return [];
  let src;
  try {
    if (fs.statSync(absPath).size > MAX_READ) return [];
    src = fs.readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  ROUTE_RE.lastIndex = 0;
  let m;
  while ((m = ROUTE_RE.exec(src))) {
    const method = m[1].toUpperCase();
    const route = m[2];
    const key = method + ' ' + route;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method, route });
  }
  return out;
}

/**
 * Build endpoint nodes (one per HTTP route) plus edges from the file that
 * defines them. Endpoints live in the Backend layer.
 */
function buildRouteGraph(root, files, relToId) {
  const nodes = [];
  const edges = [];
  const seenNode = new Set();

  for (const abs of files) {
    let rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..')) continue;
    rel = rel.split(path.sep).join('/');
    if (rel.split('/').some((seg) => IGNORE_DIRS.has(seg))) continue;

    const routes = parseRoutes(abs);
    if (!routes.length) continue;
    const fromId = relToId.get(rel);

    for (const { method, route } of routes) {
      const id = 'route-' + method + '-' + route;
      if (!seenNode.has(id)) {
        seenNode.add(id);
        nodes.push({
          id, label: method + ' ' + route, icon: '⚡',
          type: 'route', layer: LAYER.BACKEND, file: rel,
        });
      }
      if (fromId) edges.push({ from: fromId, to: id, label: 'defines' });
    }
  }
  return { nodes, edges };
}

/** Build real edges from actual import/require statements. */
function buildImportEdges(root, files, relToId) {
  const relSet = new Set(relToId.keys());
  const edges = [];
  const seen = new Set();

  for (const abs of files) {
    let rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..')) continue;
    rel = rel.split(path.sep).join('/');
    const fromId = relToId.get(rel);
    if (!fromId) continue;

    for (const spec of parseImports(abs)) {
      const targetRel = resolveImport(rel, spec, relSet);
      if (!targetRel) continue;
      const toId = relToId.get(targetRel);
      if (!toId || toId === fromId) continue;
      const key = fromId + '→' + toId;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: fromId, to: toId, label: 'imports' });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Edge building — logical connections from a node-type map.
// ---------------------------------------------------------------------------
function buildEdges(nodes) {
  const edges = [];
  const byLayer = {};
  const byType = {};
  for (const n of nodes) {
    (byLayer[n.layer] ||= []).push(n);
    (byType[n.type] ||= []).push(n);
  }

  const link = (from, to, label) => {
    if (!from || !to || from.id === to.id) return;
    edges.push({ from: from.id, to: to.id, label });
  };

  const firstFramework = (byType.framework || [])[0];
  const firstBackend = (byType.backend || [])[0];
  const firstBundler = [...(byType.tooling || [])].find((n) => /vite|webpack/i.test(n.label));

  // entry → framework (bootstraps)
  for (const entry of byType.entry || []) link(entry, firstFramework, 'bootstraps');

  // framework → component (renders)
  for (const c of byType.component || []) link(firstFramework, c, 'renders');
  for (const p of byType.page || []) link(firstFramework, p, 'renders');

  // framework → bundler (built by)
  link(firstFramework, firstBundler, 'built by');

  // component → state (reads)
  const firstState = (byType.state || [])[0];
  for (const c of byType.component || []) link(c, firstState, 'reads');

  // page → route (calls)  &  route → service (calls)
  const firstRoute = (byType.route || [])[0];
  for (const p of byType.page || []) link(p, firstRoute, 'calls');
  for (const r of byType.route || []) link(r, firstBackend, 'handled by');
  for (const s of byType.service || []) link(firstBackend, s, 'uses');

  // service → database (reads/writes)
  for (const db of byType.database || []) {
    for (const s of byType.service || []) link(s, db, 'reads/writes');
    if ((byType.service || []).length === 0) link(firstBackend, db, 'reads/writes');
  }

  // backend → external (integrates)
  for (const ext of byType.external || []) link(firstBackend || firstFramework, ext, 'integrates');

  return edges;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Analyse a project and return its architecture graph.
 * @param {string} root Absolute path to the project root.
 * @param {string[]} files Absolute paths of tracked files.
 * @returns {{name:string,nodes:object[],edges:object[],fileCount:number,timestamp:number,layers:object}}
 */
function analyse(root, files = []) {
  const { name, nodes: depNodes } = scanPackageJson(root);
  const { nodes: fileNodes, relToId } = scanFiles(root, files);

  // HTTP endpoint nodes detected from Express/Fastify route definitions (v0.2).
  const routeGraph = buildRouteGraph(root, files, relToId);

  // Merge — dependency nodes win on id collision (richer metadata).
  const byId = new Map();
  for (const n of fileNodes) byId.set(n.id, n);
  for (const n of routeGraph.nodes) byId.set(n.id, n);
  for (const n of depNodes) byId.set(n.id, n);
  const nodes = [...byId.values()];
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Real import edges (v0.2) take priority over logical guesses.
  const importEdges = buildImportEdges(root, files, relToId)
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const logicalEdges = buildEdges(nodes);
  const routeEdges = routeGraph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  // Combine, deduping by from→to (later sources win if both exist).
  const edgeMap = new Map();
  for (const e of logicalEdges) edgeMap.set(e.from + '→' + e.to, e);
  for (const e of importEdges) edgeMap.set(e.from + '→' + e.to, e);
  for (const e of routeEdges) edgeMap.set(e.from + '→' + e.to, e);
  const edges = [...edgeMap.values()];

  return {
    name,
    nodes,
    edges,
    fileCount: files.length,
    timestamp: Date.now(),
    layers: { order: LAYER_ORDER, labels: LAYER_LABELS },
  };
}

module.exports = {
  analyse, classifyFile, parseImports, resolveImport, detectCustomHook, parseRoutes,
  LAYER, LAYER_ORDER, LAYER_LABELS, IGNORE_DIRS,
};
