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
// Generated from the master tech table (see scripts that build dep-map.json /
// brand-icons.json). Each entry: matched npm package names → node definition.
// ---------------------------------------------------------------------------
const DEP_MAP = require('./dep-map.json');
// Python dependency map (matched from requirements.txt / pyproject.toml / setup.py).
const PY_DEP_MAP = require('./py-dep-map.json');
// Go dependency map (matched from go.mod) and Rust (matched from Cargo.toml).
const GO_DEP_MAP = require('./go-dep-map.json');
const RUST_DEP_MAP = require('./rust-dep-map.json');

// Folders/files always ignored when walking the tree.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache',
  '.vercel', '.turbo', 'out', '.svelte-kit', '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache',
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
 * Classify a Python source file. Returns a node or null (skip).
 */
function classifyPython(rel, file, name, inDir) {
  if (file === '__init__.py') return null; // package marker, not architecture
  const nid = `file-${rel}`;
  if (/^(main|app|manage|wsgi|asgi|__main__)$/.test(name)) {
    return { id: nid, label: file, icon: '🐍', type: 'entry', layer: LAYER.ENTRY, file: rel };
  }
  if (/^(settings|config)$/.test(name)) {
    return { id: nid, label: name, icon: '🔑', type: 'config', layer: LAYER.TOOLING, file: rel };
  }
  if (name === 'models' || inDir('models')) {
    return { id: nid, label: name, icon: '📐', type: 'model', layer: LAYER.DATA, file: rel };
  }
  if (name === 'urls' || name === 'routes' || /router/i.test(name) || inDir('routes') || inDir('routers') || inDir('api')) {
    return { id: nid, label: name, icon: '⚡', type: 'route', layer: LAYER.BACKEND, file: rel };
  }
  if (name === 'middleware' || inDir('middleware')) {
    return { id: nid, label: name, icon: '🔀', type: 'middleware', layer: LAYER.BACKEND, file: rel };
  }
  if (/_service$/.test(name) || inDir('services') || inDir('views')) {
    return { id: nid, label: name, icon: '⚙', type: 'service', layer: LAYER.BACKEND, file: rel };
  }
  // generic Python module
  return { id: nid, label: name, icon: '🐍', type: 'module', layer: LAYER.BACKEND, file: rel };
}

/** Classify a Go source file (.go) by convention. Always returns a node. */
function classifyGo(rel, file, name, inDir) {
  const nid = `file-${rel}`;
  // *_test.go is Go's built-in test convention — treat as a test artefact.
  if (/_test$/.test(name)) {
    return { id: nid, label: name, icon: '🧪', type: 'test', layer: LAYER.TOOLING, file: rel };
  }
  // main.go, or anything under cmd/, is a program entry point.
  if (name === 'main' || inDir('cmd')) {
    return { id: nid, label: file, icon: '🐹', type: 'entry', layer: LAYER.ENTRY, file: rel };
  }
  if (name === 'config' || name === 'settings' || inDir('config')) {
    return { id: nid, label: name, icon: '🔑', type: 'config', layer: LAYER.TOOLING, file: rel };
  }
  if (/handler|controller/i.test(name) || inDir('handlers') || inDir('controllers') || inDir('routes') || inDir('api')) {
    return { id: nid, label: name, icon: '⚡', type: 'route', layer: LAYER.BACKEND, file: rel };
  }
  if (name === 'middleware' || inDir('middleware')) {
    return { id: nid, label: name, icon: '🔀', type: 'middleware', layer: LAYER.BACKEND, file: rel };
  }
  if (/service$/i.test(name) || inDir('services') || inDir('service') || inDir('internal')) {
    return { id: nid, label: name, icon: '⚙', type: 'service', layer: LAYER.BACKEND, file: rel };
  }
  if (/repository|repo$/i.test(name) || inDir('repository') || inDir('store') || inDir('models') || inDir('model') || inDir('entity')) {
    return { id: nid, label: name, icon: '📐', type: 'model', layer: LAYER.DATA, file: rel };
  }
  // generic Go module
  return { id: nid, label: name, icon: '🐹', type: 'module', layer: LAYER.BACKEND, file: rel };
}

/** Classify a Rust source file (.rs) by convention. Always returns a node. */
function classifyRust(rel, file, name, inDir) {
  const nid = `file-${rel}`;
  // Rust test convention: files under tests/ or a *_test.rs name.
  if (inDir('tests') || /_tests?$/.test(name)) {
    return { id: nid, label: name, icon: '🧪', type: 'test', layer: LAYER.TOOLING, file: rel };
  }
  // main.rs (binary root) and src/bin/* are entry points.
  if (name === 'main' || inDir('bin')) {
    return { id: nid, label: file, icon: '🦀', type: 'entry', layer: LAYER.ENTRY, file: rel };
  }
  // lib.rs is the crate root — a library entry point.
  if (name === 'lib') {
    return { id: nid, label: file, icon: '🦀', type: 'entry', layer: LAYER.ENTRY, file: rel };
  }
  if (name === 'config' || name === 'settings' || inDir('config')) {
    return { id: nid, label: name, icon: '🔑', type: 'config', layer: LAYER.TOOLING, file: rel };
  }
  if (/handler|controller|route/i.test(name) || inDir('handlers') || inDir('controllers') || inDir('routes') || inDir('api')) {
    return { id: nid, label: name, icon: '⚡', type: 'route', layer: LAYER.BACKEND, file: rel };
  }
  if (name === 'middleware' || inDir('middleware')) {
    return { id: nid, label: name, icon: '🔀', type: 'middleware', layer: LAYER.BACKEND, file: rel };
  }
  if (/service$/i.test(name) || inDir('services') || inDir('service')) {
    return { id: nid, label: name, icon: '⚙', type: 'service', layer: LAYER.BACKEND, file: rel };
  }
  if (/repository|repo$/i.test(name) || inDir('models') || inDir('model') || inDir('entity') || inDir('schema')) {
    return { id: nid, label: name, icon: '📐', type: 'model', layer: LAYER.DATA, file: rel };
  }
  // mod.rs is a module aggregator — label it by its folder so it isn't just "mod".
  const label = name === 'mod' ? (path.posix.dirname(rel).split('/').pop() || name) : name;
  return { id: nid, label, icon: '🦀', type: 'module', layer: LAYER.BACKEND, file: rel };
}

/**
 * Route path for a Next.js App Router file: the segments under the `app`
 * directory, joined as a URL (`/`, `/dashboard`, `/api/users`). Route groups
 * like `(marketing)` don't affect the URL, so they're dropped.
 */
function appRoutePath(rel) {
  const dirs = path.posix.dirname(rel).split('/');
  const i = dirs.lastIndexOf('app');
  const segs = (i === -1 ? [] : dirs.slice(i + 1)).filter((s) => !/^\(.*\)$/.test(s));
  return '/' + segs.join('/');
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

  // Database migrations are an operational artefact, not architecture — skip.
  if (inDir('migrations') || inDir('migration') || /^(?:\d+[-_])?.*\bmigrat(?:e|ion)\b/i.test(name)) {
    return null;
  }

  // Next.js App Router conventions (app/** or src/app/**). Without these,
  // `app/**/page.tsx`, `layout.*`, and `route.*` fall through to the generic
  // "component" bucket, so App-Router projects come out mis-classified. Label
  // by route (`/`, `/dashboard`) — every segment's file is literally named
  // `page.tsx`, so labelling by filename shows "page" over and over.
  if (isCode && inDir('app')) {
    const route = appRoutePath(rel);
    if (/^route$/i.test(name)) {
      return { id: `file-${rel}`, label: route, icon: '⚡', type: 'route', layer: LAYER.BACKEND, file: rel };
    }
    if (/^(page|layout|template|loading|error|not-found|default)$/i.test(name)) {
      // `page` is the route itself; layout/error/etc. stay distinct from a
      // sibling page at the same route.
      const label = /^page$/i.test(name) ? route : (route === '/' ? name : route + ' ' + name);
      return { id: `file-${rel}`, label, icon: '📄', type: 'page', layer: LAYER.COMPONENT, file: rel };
    }
  }

  // Python / Go / Rust source files have their own conventions.
  if (ext === '.py') return classifyPython(rel, file, name, inDir);
  if (ext === '.go') return classifyGo(rel, file, name, inDir);
  if (ext === '.rs') return classifyRust(rel, file, name, inDir);

  // Directory-based classification (code constructs require an actual code file,
  // so lockfiles / .sql / .json under a matching folder don't become nodes).
  if (isCode && inDir('components')) {
    return { id: `file-${rel}`, label: name, icon: '🧩', type: 'component', layer: LAYER.COMPONENT, file: rel };
  }
  if (isCode && (inDir('pages') || inDir('views'))) {
    return { id: `file-${rel}`, label: name, icon: '📄', type: 'page', layer: LAYER.COMPONENT, file: rel };
  }
  if (isCode && inDir('hooks')) {
    return { id: `file-${rel}`, label: name, icon: '🪝', type: 'hook', layer: LAYER.COMPONENT, file: rel };
  }
  if (isCode && (inDir('context') || inDir('store'))) {
    return { id: `file-${rel}`, label: name, icon: '🔄', type: 'state', layer: LAYER.COMPONENT, file: rel };
  }
  if (isCode && (inDir('routes') || inDir('api'))) {
    return { id: `file-${rel}`, label: name, icon: '⚡', type: 'route', layer: LAYER.BACKEND, file: rel };
  }
  if (isCode && inDir('middleware')) {
    return { id: `file-${rel}`, label: name, icon: '🔀', type: 'middleware', layer: LAYER.BACKEND, file: rel };
  }
  if (isCode && inDir('services')) {
    return { id: `file-${rel}`, label: name, icon: '⚙', type: 'service', layer: LAYER.BACKEND, file: rel };
  }
  if (isCode && (inDir('models') || inDir('schema'))) {
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

  // NestJS filename conventions. Nest keys off the filename *suffix* inside
  // feature folders (users/users.controller.ts), so without this these files
  // fall into the generic "module" bucket. Runs after directory rules (an
  // explicit services/ dir still wins) and before the generic fallbacks.
  if (isCode) {
    if (/\.dto$/i.test(name)) return null; // DTOs are numerous data shapes — skip to avoid noise
    const nest = name.match(/\.(controller|resolver|gateway|service|repository|module|guard|interceptor|pipe|filter|middleware|entity)$/i);
    if (nest) {
      const kind = nest[1].toLowerCase();
      const label = name.slice(0, name.length - nest[0].length) || name; // strip ".<suffix>"
      const NEST = {
        controller: ['route', LAYER.BACKEND, '⚡'],
        resolver: ['route', LAYER.BACKEND, '⚡'],
        gateway: ['route', LAYER.BACKEND, '⚡'],
        service: ['service', LAYER.BACKEND, '⚙'],
        repository: ['service', LAYER.BACKEND, '⚙'],
        module: ['module', LAYER.BACKEND, '📦'],
        guard: ['middleware', LAYER.BACKEND, '🔀'],
        interceptor: ['middleware', LAYER.BACKEND, '🔀'],
        pipe: ['middleware', LAYER.BACKEND, '🔀'],
        filter: ['middleware', LAYER.BACKEND, '🔀'],
        middleware: ['middleware', LAYER.BACKEND, '🔀'],
        entity: ['model', LAYER.DATA, '📐'],
      };
      const [type, layer, icon] = NEST[kind];
      return { id: `file-${rel}`, label, icon, type, layer, file: rel };
    }
  }

  // Generic UI component fallback for top-level UI files.
  if (['.jsx', '.tsx', '.vue', '.svelte'].includes(ext)) {
    return { id: `file-${rel}`, label: name, icon: '🧩', type: 'component', layer: LAYER.COMPONENT, file: rel };
  }

  // Generic source module: any other code file is still part of the
  // architecture. Without this, library-shaped projects (lib/, bin/, utils/…)
  // would show almost nothing. Connected via real import edges.
  if (isCode) {
    return { id: `file-${rel}`, label: name, icon: '📦', type: 'module', layer: LAYER.BACKEND, file: rel };
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

/**
 * Extract import specifiers from a source file. Returns [] on any error.
 *
 * By default only relative specifiers (`./x`, `../x`, `/x`) are kept — bare
 * package imports (`react`) are not part of the file graph. When `aliases`
 * (from {@link loadAliases}) is passed, specifiers that match a configured
 * TS/JS path alias (e.g. `@/lib/x`) are kept too, so they can be resolved to
 * real files by {@link resolveImport}.
 */
function parseImports(absPath, aliases = null) {
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
      if (s.startsWith('.') || s.startsWith('/')) specs.add(s); // relative
      else if (aliases && matchesAlias(s, aliases)) specs.add(s); // path alias
    }
  }
  return [...specs];
}

/** Resolve a `target` rel path (no extension assumed) against the set of known
 *  files, trying the path as-is, then with each code extension, then /index. */
function resolveToKnown(target, relSet) {
  target = target.replace(/^\.\//, '');
  if (relSet.has(target)) return target;
  for (const ext of CODE_EXT) {
    if (relSet.has(target + ext)) return target + ext;
  }
  for (const ext of CODE_EXT) {
    if (relSet.has(target + '/index' + ext)) return target + '/index' + ext;
  }
  return null;
}

/**
 * Resolve an import specifier (from importerRel) to a known rel path, or null.
 * Handles relative specifiers and, when `aliases` is given, TS/JS path aliases
 * such as `@/lib/x` (see {@link loadAliases}).
 */
function resolveImport(importerRel, spec, relSet, aliases = null) {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const baseDir = path.posix.dirname(importerRel);
    const target = path.posix.normalize(path.posix.join(baseDir, spec));
    return resolveToKnown(target, relSet);
  }
  if (aliases) {
    for (const cand of aliasCandidates(spec, aliases)) {
      const r = resolveToKnown(cand, relSet);
      if (r) return r;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// TS/JS path aliases (tsconfig.json / jsconfig.json `compilerOptions.paths`).
// Without this, alias imports like `@/lib/x` — the default in Next.js and most
// TS setups — are dropped, so those projects come out under-connected.
// ---------------------------------------------------------------------------

/** Parse JSON that may contain comments / trailing commas (tsconfig is JSONC). */
function parseJsonc(text) {
  try { return JSON.parse(text); } catch { /* fall through to tolerant parse */ }
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')     // block comments
      .replace(/(^|[^:"'])\/\/.*$/gm, '$1') // line comments (keep http:// etc.)
      .replace(/,(\s*[}\]])/g, '$1');       // trailing commas
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

/**
 * Load path-alias config from tsconfig.json / jsconfig.json at the project
 * root. Returns { baseDir, paths:[{ prefix, suffix, hasStar, targets }] } or
 * null when none is configured. `baseDir` is `compilerOptions.baseUrl`
 * (default '.') as a POSIX rel path; each target keeps its own prefix/suffix
 * around the `*` wildcard so a captured segment can be substituted.
 */
function loadAliases(root) {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    let raw;
    try { raw = fs.readFileSync(path.join(root, name), 'utf8'); } catch { continue; }
    const json = parseJsonc(raw);
    const co = json && json.compilerOptions;
    if (!co || !co.paths || typeof co.paths !== 'object') continue;

    const baseDir = path.posix
      .normalize(String(co.baseUrl || '.').split(path.sep).join('/'))
      .replace(/^\.$/, '');
    const paths = [];
    for (const [pattern, targets] of Object.entries(co.paths)) {
      if (!Array.isArray(targets) || targets.length === 0) continue;
      const [pPrefix, pSuffix = ''] = pattern.split('*');
      paths.push({
        prefix: pPrefix,
        suffix: pSuffix,
        hasStar: pattern.includes('*'),
        targets: targets.map((t) => {
          const [tPrefix, tSuffix = ''] = String(t).split('*');
          return { prefix: tPrefix, suffix: tSuffix };
        }),
      });
    }
    if (paths.length) return { baseDir, paths };
  }
  return null;
}

/** Candidate rel paths (root-relative, no extension guaranteed) for an alias spec. */
function aliasCandidates(spec, aliases) {
  const out = [];
  for (const p of aliases.paths) {
    let capture;
    if (p.hasStar) {
      if (spec.length < p.prefix.length + p.suffix.length) continue;
      if (!spec.startsWith(p.prefix) || !spec.endsWith(p.suffix)) continue;
      capture = spec.slice(p.prefix.length, spec.length - p.suffix.length);
    } else {
      if (spec !== p.prefix) continue;
      capture = '';
    }
    for (const t of p.targets) {
      const sub = p.hasStar ? t.prefix + capture + t.suffix : t.prefix;
      out.push(
        path.posix.normalize(path.posix.join(aliases.baseDir, sub)).replace(/^\.\//, ''),
      );
    }
  }
  return out;
}

/** True if `spec` matches any configured alias pattern. */
function matchesAlias(spec, aliases) {
  return aliasCandidates(spec, aliases).length > 0;
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

// NestJS routes are decorator-based, not call-based, so ROUTE_RE misses them.
// `@Controller('base')` sets the prefix; `@Get('sub')` / `@Post()` / … add the
// method + path. `@Controller()` / no decorator → base is '' (resolves at root).
const NEST_CONTROLLER_RE = /@Controller\(\s*['"`]([^'"`]*)['"`]\s*\)/;
const NEST_METHOD_RE = /@(Get|Post|Put|Patch|Delete|Options|Head|All)\(\s*(?:['"`]([^'"`]+)['"`])?\s*\)/gi;

/** Extract HTTP routes from a NestJS controller file. Returns [{method, route}]. */
function parseNestRoutes(absPath) {
  if (!CODE_EXT.includes(path.extname(absPath))) return [];
  let src;
  try {
    if (fs.statSync(absPath).size > MAX_READ) return [];
    src = fs.readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const cm = src.match(NEST_CONTROLLER_RE);
  const base = cm ? cm[1] : '';
  const out = [];
  const seen = new Set();
  NEST_METHOD_RE.lastIndex = 0;
  let m;
  while ((m = NEST_METHOD_RE.exec(src))) {
    const method = m[1].toUpperCase();
    const sub = m[2] || '';
    const route = '/' + (base + '/' + sub).split('/').filter(Boolean).join('/');
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

    // Express/Fastify call routes, plus NestJS decorator routes on controllers.
    const routes = parseRoutes(abs);
    if (/\.controller\.[jt]s$/i.test(rel)) {
      for (const r of parseNestRoutes(abs)) {
        if (!routes.some((x) => x.method === r.method && x.route === r.route)) routes.push(r);
      }
    }
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
      if (fromId) edges.push({ from: fromId, to: id, label: 'defines', provenance: 'import' });
    }
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Python dependency detection (requirements.txt / pyproject.toml / setup.py).
// ---------------------------------------------------------------------------
const PY_MANIFEST = /(^|\/)(requirements[^/]*\.txt|pyproject\.toml|setup\.py|setup\.cfg|Pipfile)$/i;

/**
 * Detect Python tech-stack nodes from manifest files among the tracked files,
 * and a Python language node if any .py file is present.
 */
function scanPython(root, files) {
  let text = '';
  let hasPy = false;
  for (const abs of files) {
    let rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..')) continue;
    rel = rel.split(path.sep).join('/');
    if (rel.split('/').some((seg) => IGNORE_DIRS.has(seg))) continue;
    if (rel.endsWith('.py')) hasPy = true;
    if (PY_MANIFEST.test(rel)) {
      try { if (fs.statSync(abs).size <= MAX_READ) text += '\n' + fs.readFileSync(abs, 'utf8'); } catch { /* ignore */ }
    }
  }
  if (!text && !hasPy) return [];

  const nodes = [];
  const seen = new Set();
  for (const entry of PY_DEP_MAP) {
    const hit = entry.match.some((m) => new RegExp('(^|[^A-Za-z0-9_.-])' + escapeRe(m) + '($|[^A-Za-z0-9_-])', 'i').test(text));
    if (hit && !seen.has(entry.id)) {
      seen.add(entry.id);
      nodes.push({ id: entry.id, label: entry.label, icon: entry.icon, type: entry.type, layer: entry.layer, file: 'python' });
    }
  }
  // Python language node whenever the project contains Python source.
  if (hasPy && !seen.has('dep-python')) {
    const py = PY_DEP_MAP.find((e) => e.id === 'dep-python');
    if (py) nodes.push({ id: py.id, label: py.label, icon: py.icon, type: py.type, layer: py.layer, file: 'python' });
  }
  return nodes;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------------------------------------------------------------------------
// Go (go.mod) and Rust (Cargo.toml) dependency detection.
// ---------------------------------------------------------------------------
const GO_MANIFEST = /(^|\/)go\.mod$/i;
const RUST_MANIFEST = /(^|\/)Cargo\.toml$/i;

/**
 * Generic language dep-scan: read the given manifest(s) among the tracked
 * files, match dependency names, and always emit a language node when the
 * project contains source files of that extension. Mirrors scanPython.
 */
function scanLangDeps(root, files, { manifestRe, srcExt, depMap, langId, langFile }) {
  let text = '';
  let hasSrc = false;
  for (const abs of files) {
    let rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..')) continue;
    rel = rel.split(path.sep).join('/');
    if (rel.split('/').some((seg) => IGNORE_DIRS.has(seg))) continue;
    if (rel.endsWith(srcExt)) hasSrc = true;
    if (manifestRe.test(rel)) {
      try { if (fs.statSync(abs).size <= MAX_READ) text += '\n' + fs.readFileSync(abs, 'utf8'); } catch { /* ignore */ }
    }
  }
  if (!text && !hasSrc) return [];

  const nodes = [];
  const seen = new Set();
  for (const entry of depMap) {
    if (!entry.match.length) continue; // language node handled below
    const hit = entry.match.some((m) => new RegExp('(^|[^A-Za-z0-9_.-])' + escapeRe(m) + '($|[^A-Za-z0-9_-])', 'i').test(text));
    if (hit && !seen.has(entry.id)) {
      seen.add(entry.id);
      nodes.push({ id: entry.id, label: entry.label, icon: entry.icon, type: entry.type, layer: entry.layer, file: langFile });
    }
  }
  // Language node whenever the project contains source of this language.
  if (hasSrc && !seen.has(langId)) {
    const lang = depMap.find((e) => e.id === langId);
    if (lang) nodes.push({ id: lang.id, label: lang.label, icon: lang.icon, type: lang.type, layer: lang.layer, file: langFile });
  }
  return nodes;
}

/** Go tech-stack nodes from go.mod, plus a Go language node for any .go file. */
function scanGo(root, files) {
  return scanLangDeps(root, files, { manifestRe: GO_MANIFEST, srcExt: '.go', depMap: GO_DEP_MAP, langId: 'dep-go', langFile: 'go' });
}

/** Rust tech-stack nodes from Cargo.toml, plus a Rust language node for any .rs file. */
function scanRust(root, files) {
  return scanLangDeps(root, files, { manifestRe: RUST_MANIFEST, srcExt: '.rs', depMap: RUST_DEP_MAP, langId: 'dep-rust', langFile: 'rust' });
}

// ---------------------------------------------------------------------------
// Prisma model detection (schema.prisma → model nodes).
// ---------------------------------------------------------------------------
const PRISMA_MODEL_RE = /^\s*model\s+(\w+)\s*\{/gm;

/** Extract model names from a Prisma schema file. */
function parsePrismaModels(absPath) {
  let src;
  try {
    if (fs.statSync(absPath).size > MAX_READ) return [];
    src = fs.readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  PRISMA_MODEL_RE.lastIndex = 0;
  let m;
  while ((m = PRISMA_MODEL_RE.exec(src))) out.push(m[1]);
  return out;
}

/** Build model nodes (+ edge to the Prisma node) from schema.prisma files. */
function buildPrismaGraph(root, files) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  for (const abs of files) {
    if (path.basename(abs) !== 'schema.prisma') continue;
    let rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..')) continue;
    rel = rel.split(path.sep).join('/');
    for (const model of parsePrismaModels(abs)) {
      const id = 'model-' + model;
      if (seen.has(id)) continue;
      seen.add(id);
      nodes.push({ id, label: model, icon: '📐', type: 'model', layer: LAYER.DATA, file: rel });
      edges.push({ from: 'dep-prisma', to: id, label: 'defines', provenance: 'import' });
    }
  }
  return { nodes, edges };
}

/** Build real edges from actual import/require statements. */
function buildImportEdges(root, files, relToId) {
  const relSet = new Set(relToId.keys());
  const aliases = loadAliases(root); // tsconfig/jsconfig `paths` (may be null)
  const edges = [];
  const seen = new Set();

  for (const abs of files) {
    let rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..')) continue;
    rel = rel.split(path.sep).join('/');
    const fromId = relToId.get(rel);
    if (!fromId) continue;

    for (const spec of parseImports(abs, aliases)) {
      const targetRel = resolveImport(rel, spec, relSet, aliases);
      if (!targetRel) continue;
      const toId = relToId.get(targetRel);
      if (!toId || toId === fromId) continue;
      const key = fromId + '→' + toId;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: fromId, to: toId, label: 'imports', provenance: 'import' });
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

  // Logical connections are heuristic guesses (framework → every component,
  // etc.), not observed imports — tag them `inferred` so the UI can show them
  // dashed and honestly distinguish them from real import edges.
  const link = (from, to, label) => {
    if (!from || !to || from.id === to.id) return;
    edges.push({ from: from.id, to: to.id, label, provenance: 'inferred' });
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
function analyse(root, files = [], opts = {}) {
  const { name, nodes: depNodes } = scanPackageJson(root);
  let { nodes: fileNodes, relToId } = scanFiles(root, files);

  // Test files and config files (.env, …) are operational detail, not
  // architecture — excluded by default. Enable with { tests:true }/{ config:true }
  // (CLI: --tests / --config). Dangling edges to dropped nodes are removed
  // automatically by the nodeIds filter below.
  if (!opts.tests) fileNodes = fileNodes.filter((n) => n.type !== 'test');
  if (!opts.config) fileNodes = fileNodes.filter((n) => n.type !== 'config');

  // Individual HTTP endpoint nodes (GET /x …) are opt-in — they add a lot of
  // operational detail that most architecture views don't want. Enable with
  // { endpoints: true } (CLI: --routes).
  const routeGraph = opts.endpoints
    ? buildRouteGraph(root, files, relToId)
    : { nodes: [], edges: [] };

  // Python / Go / Rust tech stacks (manifests) and Prisma models.
  const pyNodes = scanPython(root, files);
  const goNodes = scanGo(root, files);
  const rustNodes = scanRust(root, files);
  const prismaGraph = buildPrismaGraph(root, files);

  // Merge — dependency nodes win on id collision (richer metadata).
  const byId = new Map();
  for (const n of fileNodes) byId.set(n.id, n);
  for (const n of routeGraph.nodes) byId.set(n.id, n);
  for (const n of prismaGraph.nodes) byId.set(n.id, n);
  for (const n of depNodes) byId.set(n.id, n);
  for (const n of pyNodes) byId.set(n.id, n);
  for (const n of goNodes) byId.set(n.id, n);
  for (const n of rustNodes) byId.set(n.id, n);
  const nodes = [...byId.values()];
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Real import edges (v0.2) take priority over logical guesses.
  const importEdges = buildImportEdges(root, files, relToId)
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const logicalEdges = buildEdges(nodes);
  const routeEdges = routeGraph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const prismaEdges = prismaGraph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  // Combine, deduping by from→to (later sources win if both exist).
  const edgeMap = new Map();
  for (const e of logicalEdges) edgeMap.set(e.from + '→' + e.to, e);
  for (const e of importEdges) edgeMap.set(e.from + '→' + e.to, e);
  for (const e of routeEdges) edgeMap.set(e.from + '→' + e.to, e);
  for (const e of prismaEdges) edgeMap.set(e.from + '→' + e.to, e);
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
  analyse, classifyFile, parseImports, resolveImport, loadAliases, detectCustomHook, parseRoutes, parseNestRoutes,
  parsePrismaModels, scanPython, scanGo, scanRust,
  LAYER, LAYER_ORDER, LAYER_LABELS, IGNORE_DIRS,
};
