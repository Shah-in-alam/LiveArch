'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { analyse, classifyFile, parseImports, detectCustomHook, parseRoutes, parsePrismaModels } = require('../lib/analyser');
const template = require('../lib/template');

// Build a throwaway fixture project on disk.
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-'));
  const write = (rel, content) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  };

  write('package.json', JSON.stringify({
    name: 'fixture-app',
    dependencies: { react: '^18.0.0', express: '^4.19.0', pg: '^8.0.0' },
    devDependencies: { vite: '^5.0.0', vitest: '^1.0.0' },
  }));
  const files = [
    write('src/main.jsx', 'import App from "./App.jsx";'),
    write('src/App.jsx', 'import Shop from "./components/Shop.jsx";\nexport default function App() {}'),
    write('src/components/Shop.jsx', 'import { wines } from "../data/wines.js";\nexport default function Shop() {}'),
    write('src/pages/Home.jsx', 'export default function Home() {}'),
    write('src/api/users.js', 'app.get("/users", () => {});\nrouter.post("/users", () => {});\nfastify.delete("/users/:id", () => {});'),
    write('src/services/db.js', 'module.exports = {};'),
    write('src/data/wines.js', 'export const wines = [];'),
    // custom hook by filename convention
    write('src/utils/useToggle.js', 'export function useToggle(){ return [true]; }'),
    // custom hook by content (generic component file that actually defines a hook)
    write('src/i18n.jsx', 'export function useLang(){ return "en"; }'),
    write('public/logo.svg', '<svg></svg>'),
    write('src/App.test.jsx', 'test("x", () => {});'),
  ];
  return { root, files };
}

test('classifyFile maps directories to node types', () => {
  assert.equal(classifyFile('src/components/Shop.jsx').type, 'component');
  assert.equal(classifyFile('src/pages/Home.jsx').type, 'page');
  assert.equal(classifyFile('src/api/users.js').type, 'route');
  assert.equal(classifyFile('src/services/db.js').type, 'service');
  assert.equal(classifyFile('src/data/wines.js').type, 'data');
  assert.equal(classifyFile('src/main.jsx').type, 'entry');
  assert.equal(classifyFile('src/App.test.jsx').type, 'test');
});

test('analyse detects tech stack from package.json', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  const ids = arch.nodes.map((n) => n.id);
  assert.ok(ids.includes('dep-react'), 'react detected');
  assert.ok(ids.includes('dep-express'), 'express detected');
  assert.ok(ids.includes('dep-pg'), 'postgres detected');
  assert.ok(ids.includes('dep-vite'), 'vite detected');
  assert.equal(arch.name, 'fixture-app');
  assert.equal(arch.fileCount, files.length);
});

test('analyse builds nodes and edges', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  assert.ok(arch.nodes.length >= 8, 'has nodes');
  assert.ok(arch.edges.length > 0, 'has edges');
  // entry should bootstrap the framework
  const bootstraps = arch.edges.find((e) => e.label === 'bootstraps');
  assert.ok(bootstraps, 'entry → framework edge exists');
});

test('parseImports extracts relative specifiers only', () => {
  const { root } = makeFixture();
  const specs = parseImports(path.join(root, 'src/App.jsx'));
  assert.ok(specs.includes('./components/Shop.jsx'), 'relative import captured');
  // bare package imports (e.g. "react") must be excluded
  assert.ok(!specs.some((s) => !s.startsWith('.') && !s.startsWith('/')), 'no bare specifiers');
});

test('analyse builds REAL edges from import statements (v0.2)', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  const importEdges = arch.edges.filter((e) => e.label === 'imports');
  assert.ok(importEdges.length >= 3, 'has import edges');

  const find = (label) => arch.nodes.find((n) => n.label === label);
  // App.jsx is an entry node (label = filename); Shop/wines are component/data (label = basename).
  const app = find('App.jsx'), shop = find('Shop'), wines = find('wines');
  const has = (a, b) => arch.edges.some((e) => e.from === a.id && e.to === b.id && e.label === 'imports');

  assert.ok(has(app, shop), 'App → Shop import edge');
  assert.ok(has(shop, wines), 'Shop → wines import edge');
});

test('detects custom hooks by filename and by content', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  const toggle = arch.nodes.find((n) => n.label === 'useToggle');
  const lang = arch.nodes.find((n) => n.label === 'i18n');

  assert.ok(toggle && toggle.type === 'hook', 'useToggle.js detected as hook by filename');
  assert.ok(lang && lang.type === 'hook', 'i18n.jsx detected as hook by exported useLang');
  assert.equal(lang.icon, '🪝');

  // a plain component must NOT be misclassified as a hook
  const shop = arch.nodes.find((n) => n.label === 'Shop');
  assert.equal(shop.type, 'component');
});

test('detectCustomHook recognises hook definitions, not hook usage', () => {
  const { root } = makeFixture();
  assert.equal(detectCustomHook(path.join(root, 'src/utils/useToggle.js')), true);
  // Shop.jsx imports/uses things but defines no hook
  assert.equal(detectCustomHook(path.join(root, 'src/components/Shop.jsx')), false);
});

test('parseRoutes extracts Express/Fastify endpoints', () => {
  const { root } = makeFixture();
  const routes = parseRoutes(path.join(root, 'src/api/users.js'));
  const keys = routes.map((r) => r.method + ' ' + r.route);
  assert.ok(keys.includes('GET /users'), 'app.get detected');
  assert.ok(keys.includes('POST /users'), 'router.post detected');
  assert.ok(keys.includes('DELETE /users/:id'), 'fastify.delete detected');
});

test('endpoint nodes are opt-in (off by default, on with {endpoints:true})', () => {
  const { root, files } = makeFixture();

  // default: no individual HTTP endpoint nodes
  const off = analyse(root, files);
  assert.equal(off.nodes.filter((n) => n.label.includes('/')).length, 0, 'no endpoints by default');

  // opt-in
  const on = analyse(root, files, { endpoints: true });
  const endpoints = on.nodes.filter((n) => n.type === 'route' && n.label.includes('/'));
  assert.ok(endpoints.length >= 3, 'endpoints appear with {endpoints:true}');
  const get = on.nodes.find((n) => n.label === 'GET /users');
  assert.ok(get && get.layer === 'backend', 'endpoint in backend layer');
  const file = on.nodes.find((n) => n.label === 'users');
  assert.ok(on.edges.some((e) => e.from === file.id && e.to === get.id && e.label === 'defines'),
    'file → endpoint "defines" edge');
});

test('test files and config files are excluded by default (opt-in)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-tc-'));
  const w = (rel, c) => { const a = path.join(root, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, c); return a; };
  w('package.json', JSON.stringify({ name: 'app', dependencies: { react: '^18' } }));
  const files = [
    w('src/components/Button.jsx', 'export default function Button(){}'),
    w('src/components/Button.test.jsx', 'test("x",()=>{})'),
    w('.env', 'SECRET=1'),
    w('.env.local', 'X=2'),
  ];

  const off = analyse(root, files);
  assert.ok(!off.nodes.some((n) => n.type === 'test'), 'no test nodes by default');
  assert.ok(!off.nodes.some((n) => n.type === 'config'), 'no config nodes by default');
  assert.ok(off.nodes.some((n) => n.label === 'Button'), 'real component still present');

  const on = analyse(root, files, { tests: true, config: true });
  assert.ok(on.nodes.some((n) => n.type === 'test'), 'test nodes appear with {tests:true}');
  assert.ok(on.nodes.some((n) => n.type === 'config'), 'config nodes appear with {config:true}');
});

test('database migrations and non-code files are excluded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-mig-'));
  const w = (rel, c) => { const a = path.join(root, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, c); return a; };
  w('package.json', JSON.stringify({ name: 'app', dependencies: { express: '^4' } }));
  const files = [
    w('src/api/users.js', 'app.get("/x",()=>{})'),
    w('src/db/migrations/001_init.sql', 'CREATE TABLE t();'),
    w('src/db/migrate.ts', 'export function migrate(){}'),
    w('src/api/package-lock.json', '{}'),
  ];
  const arch = analyse(root, files);
  assert.ok(!arch.nodes.some((n) => /001_init|migrate/.test(n.label)), 'no migration nodes');
  assert.ok(!arch.nodes.some((n) => n.label === 'package-lock'), 'no lockfile node');
  assert.ok(arch.nodes.some((n) => n.label === 'users'), 'real route file still present');
});

test('scans workspace package.json files in a monorepo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-mono-'));
  const w = (rel, obj) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(obj));
    return abs;
  };
  // root only knows about turbo — the real stack lives in workspaces
  w('package.json', { name: 'mono', workspaces: ['apps/*', 'packages/*'], devDependencies: { turbo: '^2' } });
  w('apps/api/package.json', { name: 'api', dependencies: { express: '^4', pg: '^8' } });
  w('apps/web/package.json', { name: 'web', dependencies: { react: '^18' }, devDependencies: { vite: '^5' } });
  w('packages/shared/package.json', { name: 'shared', dependencies: { redis: '^4' } });

  const files = [path.join(root, 'package.json')];
  const arch = analyse(root, files);
  const ids = arch.nodes.map((n) => n.id);
  assert.ok(ids.includes('dep-express'), 'express from apps/api detected');
  assert.ok(ids.includes('dep-pg'), 'postgres from apps/api detected');
  assert.ok(ids.includes('dep-react'), 'react from apps/web detected');
  assert.ok(ids.includes('dep-redis'), 'redis from packages/shared detected');
});

test('detects Prisma models from schema.prisma', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-prisma-'));
  const w = (rel, c) => { const a = path.join(root, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, c); return a; };
  w('package.json', JSON.stringify({ name: 'app', dependencies: { '@prisma/client': '^5' } }));
  const schema = w('prisma/schema.prisma', 'datasource db { provider = "postgresql" }\nmodel User {\n id Int @id\n}\nmodel Post {\n id Int @id\n}\n');

  assert.deepEqual(parsePrismaModels(schema).sort(), ['Post', 'User']);
  const arch = analyse(root, [path.join(root, 'package.json'), schema]);
  const models = arch.nodes.filter((n) => n.type === 'model');
  assert.ok(models.some((n) => n.label === 'User') && models.some((n) => n.label === 'Post'), 'model nodes created');
  assert.ok(arch.edges.some((e) => e.from === 'dep-prisma' && e.to === 'model-User' && e.label === 'defines'),
    'prisma → model edge');
});

test('detects Python tech stack + classifies .py files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-py-'));
  const w = (rel, c) => { const a = path.join(root, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, c); return a; };
  w('package.json', JSON.stringify({ name: 'mono', workspaces: ['py'] }));
  const files = [
    path.join(root, 'package.json'),
    w('py/requirements.txt', 'fastapi>=0.100\nsqlalchemy==2.0\npsycopg2-binary\nredis'),
    w('py/app/main.py', 'app = FastAPI()'),
    w('py/app/models.py', 'class User: pass'),
    w('py/app/middleware.py', 'def mw(): pass'),
    w('py/app/detector.py', 'def detect(): pass'),
    w('py/app/__init__.py', ''),
  ];
  const arch = analyse(root, files);
  const ids = arch.nodes.map((n) => n.id);
  assert.ok(ids.includes('dep-fastapi'), 'FastAPI detected');
  assert.ok(ids.includes('dep-sqlalchemy'), 'SQLAlchemy detected');
  assert.ok(ids.includes('dep-pg'), 'psycopg → PostgreSQL detected');
  assert.ok(ids.includes('dep-python'), 'Python language node');

  const byLabel = (l) => arch.nodes.find((n) => n.label === l);
  assert.equal(byLabel('main.py').type, 'entry', 'main.py is entry');
  assert.equal(byLabel('models').type, 'model', 'models.py is model');
  assert.equal(byLabel('middleware').type, 'middleware', 'middleware.py is middleware');
  assert.equal(byLabel('detector').type, 'module', 'detector.py is a module');
  assert.ok(!arch.nodes.some((n) => n.file && n.file.endsWith('__init__.py')), '__init__.py skipped');
});

test('detects Go tech stack + classifies .go files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-go-'));
  const w = (rel, c) => { const a = path.join(root, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, c); return a; };
  const files = [
    w('go.mod', 'module example.com/app\ngo 1.22\nrequire (\n github.com/gin-gonic/gin v1.9.1\n gorm.io/gorm v1.25.0\n github.com/redis/go-redis/v9 v9.0.0\n)'),
    w('cmd/server/main.go', 'package main\nfunc main(){}'),
    w('handlers/user.go', 'package handlers'),
    w('models/user.go', 'package models'),
    w('user_test.go', 'package main'),
  ];
  const arch = analyse(root, files);
  const ids = arch.nodes.map((n) => n.id);
  assert.ok(ids.includes('dep-gin'), 'Gin detected');
  assert.ok(ids.includes('dep-gorm'), 'GORM detected');
  assert.ok(ids.includes('dep-redis'), 'Redis detected');
  assert.ok(ids.includes('dep-go'), 'Go language node');

  const byFile = (suffix) => arch.nodes.find((n) => n.file && n.file.endsWith(suffix));
  assert.equal(byFile('cmd/server/main.go').type, 'entry', 'main.go under cmd/ is entry');
  assert.equal(byFile('handlers/user.go').type, 'route', 'handlers/*.go is route');
  assert.equal(byFile('models/user.go').type, 'model', 'models/*.go is model');
  assert.ok(!arch.nodes.some((n) => n.file && n.file.endsWith('user_test.go')), '_test.go excluded by default');
});

test('detects Rust tech stack + classifies .rs files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-rs-'));
  const w = (rel, c) => { const a = path.join(root, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, c); return a; };
  const files = [
    w('Cargo.toml', '[package]\nname = "app"\n[dependencies]\naxum = "0.7"\ntokio = { version = "1", features = ["full"] }\nsqlx = "0.7"\nserde = "1"'),
    w('src/main.rs', 'fn main() {}'),
    w('src/models/user.rs', 'pub struct User;'),
    w('src/handlers.rs', 'pub fn handle() {}'),
    w('tests/it.rs', '#[test] fn t() {}'),
  ];
  const arch = analyse(root, files);
  const ids = arch.nodes.map((n) => n.id);
  assert.ok(ids.includes('dep-axum'), 'Axum detected');
  assert.ok(ids.includes('dep-sqlx'), 'SQLx detected');
  assert.ok(ids.includes('dep-tokio'), 'Tokio detected');
  assert.ok(ids.includes('dep-rust'), 'Rust language node');

  const byFile = (suffix) => arch.nodes.find((n) => n.file && n.file.endsWith(suffix));
  assert.equal(byFile('src/main.rs').type, 'entry', 'main.rs is entry');
  assert.equal(byFile('src/models/user.rs').type, 'model', 'models/*.rs is model');
  assert.equal(byFile('src/handlers.rs').type, 'route', 'handlers.rs is route');
  assert.ok(!arch.nodes.some((n) => n.file && n.file.endsWith('tests/it.rs')), 'tests/*.rs excluded by default');
});

test('AI reviewer builds a prompt and parses suggestions (mocked client)', async () => {
  const { review } = require('../lib/ai/reviewer');
  const { buildUserPrompt, summariseArch } = require('../lib/ai/prompts');
  const { root, files } = makeFixture();
  const arch = analyse(root, files);

  // prompt building is pure — no network
  const prompt = buildUserPrompt(arch);
  assert.match(prompt, /Nodes:/);
  assert.ok(summariseArch(arch).nodes.length > 0);

  // inject a fake client so no real API call happens
  let captured;
  const fakeClient = {
    messages: {
      create: async (params) => {
        captured = params;
        return { content: [
          { type: 'thinking', thinking: 'x' },
          { type: 'text', text: JSON.stringify({ suggestions: [
            { severity: 'warning', node: 'file-src/components/Shop.jsx', message: 'Too many connections', suggestion: 'Split it' },
          ] }) },
        ] };
      },
    },
  };
  const out = await review(arch, { client: fakeClient });
  assert.equal(captured.model, 'claude-opus-4-8', 'defaults to opus-4-8');
  assert.deepEqual(captured.thinking, { type: 'adaptive' });
  assert.ok(captured.output_config.format.type === 'json_schema', 'uses structured outputs');
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'warning');
});

test('AI reviewer errors clearly without an API key', async () => {
  const { review, ReviewError } = require('../lib/ai/reviewer');
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await review({ name: 'x', nodes: [], edges: [], fileCount: 0 });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ReviewError);
    assert.equal(e.code, 'NO_API_KEY');
  } finally {
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('heuristic Preview review produces suggestions from the graph', () => {
  const { heuristicReview } = require('../lib/ai/heuristics');
  // backend + routes but no auth and no database → two info suggestions
  const arch = {
    name: 'api', fileCount: 5,
    nodes: [
      { id: 'dep-express', label: 'Express', type: 'backend' },
      { id: 'file-a', label: 'a', type: 'route' },
    ],
    edges: [{ from: 'file-a', to: 'dep-express', label: 'handled by' }],
  };
  const out = heuristicReview(arch);
  assert.ok(out.length >= 2, 'produces suggestions');
  assert.ok(out.some((s) => /authentication/i.test(s.message)), 'flags missing auth');
  assert.ok(out.some((s) => /database/i.test(s.message)), 'flags missing database');

  // a healthy tiny graph → no false positives
  const healthy = { name: 'x', fileCount: 1, nodes: [{ id: 'dep-react', label: 'React', type: 'framework' }], edges: [] };
  assert.equal(heuristicReview(healthy).length, 0);
});

test('heuristics detect circular dependencies and payments-without-auth', () => {
  const { heuristicReview, findImportCycle } = require('../lib/ai/heuristics');

  // A → B → C → A cycle via import edges
  const nodes = [
    { id: 'a', label: 'A', type: 'component' },
    { id: 'b', label: 'B', type: 'component' },
    { id: 'c', label: 'C', type: 'component' },
  ];
  const edges = [
    { from: 'a', to: 'b', label: 'imports' },
    { from: 'b', to: 'c', label: 'imports' },
    { from: 'c', to: 'a', label: 'imports' },
  ];
  const cyc = findImportCycle(nodes, edges);
  assert.ok(cyc && cyc.length === 3, 'finds a 3-node cycle');
  assert.ok(heuristicReview({ name: 'x', fileCount: 3, nodes, edges })
    .some((s) => /Circular dependency/.test(s.message)), 'reports the cycle');

  // stripe without auth → warning
  const pay = heuristicReview({ name: 'p', fileCount: 1,
    nodes: [{ id: 'dep-stripe', label: 'Stripe', type: 'external' }], edges: [] });
  assert.ok(pay.some((s) => s.severity === 'warning' && /Payment/.test(s.message)));
});

test('diffArch reports added/removed nodes and edges', () => {
  const { diffArch, formatDiff } = require('../lib/diff');
  const base = {
    name: 'app',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b', label: 'x' }],
  };
  const head = {
    name: 'app',
    nodes: [{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }],
    edges: [{ from: 'a', to: 'c', label: 'y' }],
  };
  const d = diffArch(base, head);
  assert.deepEqual(d.addedNodes.map((n) => n.id), ['c']);
  assert.deepEqual(d.removedNodes.map((n) => n.id), ['b']);
  assert.equal(d.addedEdges.length, 1);
  assert.equal(d.removedEdges.length, 1);
  assert.match(formatDiff(d, 'main', 'feature'), /Added nodes/);
});

test('badgeSvg produces a valid SVG with the node count', () => {
  const { badgeSvg, badgeMarkdown } = require('../lib/badge');
  const svg = badgeSvg({ nodes: [1, 2, 3] });
  assert.match(svg, /^<svg /);
  assert.match(svg, /3 nodes/);
  assert.match(svg, /architecture/);
  assert.match(badgeMarkdown('docs/b.svg'), /!\[Architecture\]\(docs\/b\.svg\)/);
});

test('hosted store round-trips a snapshot and renders a snapshot viewer', async () => {
  const { store } = freshHosted('livearch-store-');
  const { renderViewer } = require('../server/lib/render');

  const { root, files } = makeFixture();
  const arch = analyse(root, files);

  const saved = await store.saveSnapshot('me', 'my-repo', arch);
  assert.deepEqual(saved, { handle: 'me', slug: 'my-repo' });
  const snap = await store.getSnapshot('me', 'my-repo');
  assert.equal(snap.arch.name, arch.name);
  assert.ok(snap.updatedAt > 0);
  assert.equal(await store.getSnapshot('nope', 'nope'), null);

  // path-traversal / invalid segments rejected
  await assert.rejects(() => store.saveSnapshot('../evil', 'x', arch));

  const html = renderViewer(snap);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /const SNAPSHOT = true/);

  // hosted viewer with handle/slug wires up the SSE live stream
  const liveHtml = renderViewer(snap, { handle: 'me', slug: 'my-repo' });
  assert.match(liveHtml, /\/api\/stream\/me\/my-repo/);
  assert.match(liveHtml, /new EventSource/);
  delete process.env.LIVEARCH_DATA_DIR;
});

test('project access control: ownership + private visibility', async () => {
  const { projects } = freshHosted('livearch-acl-');

  // first write with a token → creates an owned project (public by default)
  const a = await projects.authorizeWrite('me', 'app', 'owner-tok');
  assert.equal(a.created, true);
  assert.equal(a.meta.visibility, 'public');
  assert.ok(await projects.canRead('me', 'app', ''), 'public readable by anyone');

  // a different token cannot write to an owned project
  await assert.rejects(() => projects.authorizeWrite('me', 'app', 'other-tok'), (e) => e.code === 'FORBIDDEN');
  // the owner can, and can flip it private
  await projects.authorizeWrite('me', 'app', 'owner-tok', { private: true });
  assert.equal(await projects.canRead('me', 'app', ''), false, 'private not readable anon');
  assert.equal(await projects.canRead('me', 'app', 'other-tok'), false, 'private not readable by non-owner');
  assert.equal(await projects.canRead('me', 'app', 'owner-tok'), true, 'private readable by owner');

  // a project with no metadata (legacy/open) is readable
  assert.ok(await projects.canRead('nobody', 'nothing', ''));
  delete process.env.LIVEARCH_DATA_DIR;
});

// Fresh-require the hosted modules against a temp data dir (they cache their
// backend selection + DATA_DIR at require time, so clear the cache after
// setting the env). Also clears segments/pg so a pg test can re-select cleanly.
function freshHosted(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.LIVEARCH_DATA_DIR = dir;
  for (const m of ['../server/lib/segments', '../server/lib/pg', '../server/lib/store', '../server/lib/accounts', '../server/lib/projects']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* not loaded */ }
  }
  return {
    store: require('../server/lib/store'),
    accounts: require('../server/lib/accounts'),
    projects: require('../server/lib/projects'),
  };
}

// Backend-agnostic behaviour, exercised against both the filesystem and
// Postgres (pg-mem) backends below.
async function accountFlow({ accounts, projects }) {
  const { account, token } = await accounts.createAccount({ handle: 'alice', email: 'a@b.com' });
  assert.equal(account.handle, 'alice');
  assert.ok(token.startsWith('la_'), 'token is a secret string');
  assert.equal((await accounts.resolveToken(token)).id, account.id, 'token resolves to account');
  assert.equal(await accounts.getHandleOwner('alice'), account.id, 'handle claimed');

  // validation
  await assert.rejects(() => accounts.createAccount({ handle: 'alice' }), (e) => e.code === 'HANDLE_TAKEN');
  await assert.rejects(() => accounts.createAccount({ handle: 'Bad Handle!' }), (e) => e.code === 'BAD_HANDLE');
  await assert.rejects(() => accounts.createAccount({ handle: 'carol', email: 'nope' }), (e) => e.code === 'BAD_EMAIL');

  // account owns every project under its handle
  const w = await projects.authorizeWrite('alice', 'app', token);
  assert.equal(w.created, true);
  assert.equal(w.meta.ownerAccountId, account.id);

  // a different account cannot write under alice's handle
  const bob = await accounts.createAccount({ handle: 'bob' });
  await assert.rejects(() => projects.authorizeWrite('alice', 'app', bob.token), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => projects.authorizeWrite('alice', 'other', bob.token), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => projects.authorizeWrite('alice', 'app', ''), (e) => e.code === 'FORBIDDEN', 'anon rejected on owned handle');

  // private account project: readable only by the owning account's token
  // (private requires a paid plan — upgrade first).
  await accounts.setPlan(account.id, 'pro');
  await projects.authorizeWrite('alice', 'app', token, { private: true });
  assert.equal(await projects.canRead('alice', 'app', ''), false);
  assert.equal(await projects.canRead('alice', 'app', bob.token), false);
  assert.equal(await projects.canRead('alice', 'app', token), true);

  // token management: issue a second, then revoke it
  const t2 = await accounts.issueToken(account.id, 'ci');
  assert.ok((await accounts.listTokens(account.id)).length >= 2);
  assert.equal((await accounts.resolveToken(t2)).id, account.id);
  assert.equal(await accounts.revokeToken(account.id, accounts.hash(t2)), true);
  assert.equal(await accounts.resolveToken(t2), null, 'revoked token no longer resolves');
  // cannot revoke another account's token
  assert.equal(await accounts.revokeToken(bob.account.id, accounts.hash(token)), false);
}

async function historyFlow({ store }) {
  for (let i = 0; i < store.HISTORY_MAX + 5; i++) {
    await store.appendHistory('me', 'app', { name: 'app', nodes: [{ id: 'n' + i }], edges: [] });
  }
  const hist = await store.getHistory('me', 'app');
  assert.equal(hist.length, store.HISTORY_MAX, 'capped at HISTORY_MAX');
  assert.equal(hist[0].arch.nodes[0].id, 'n' + (store.HISTORY_MAX + 4), 'newest first');
  assert.ok(hist[0].at >= hist[1].at, 'timestamps descending');
  assert.deepEqual(await store.getHistory('nobody', 'x'), []);

  // per-plan history depth: cap to a smaller depth
  for (let i = 0; i < 10; i++) {
    await store.appendHistory('me', 'small', { name: 'x', nodes: [{ id: 'h' + i }], edges: [] }, 5);
  }
  assert.equal((await store.getHistory('me', 'small')).length, 5, 'history capped to the given depth');

  // branch is recorded on each history entry (default 'main', or as given)
  await store.appendHistory('me', 'br', { name: 'x', nodes: [], edges: [] });            // default main
  await store.appendHistory('me', 'br', { name: 'x', nodes: [], edges: [] }, 20, 'dev');  // branch dev
  const brHist = await store.getHistory('me', 'br');
  assert.equal(brHist[0].branch, 'dev', 'newest entry keeps its branch');
  assert.equal(brHist[1].branch, 'main', 'default branch is main');
}

async function planFlow({ accounts, projects, store }) {
  const { account, token } = await accounts.createAccount({ handle: 'alice' });
  assert.equal(account.plan, 'free', 'new accounts start on Free');

  // Free plan: private projects are blocked.
  await assert.rejects(() => projects.authorizeWrite('alice', 'secret', token, { private: true }), (e) => e.code === 'PLAN_REQUIRED');

  // Free plan: up to 3 hosted projects.
  await projects.authorizeWrite('alice', 'p1', token);
  await projects.authorizeWrite('alice', 'p2', token);
  await projects.authorizeWrite('alice', 'p3', token);
  assert.equal(await accounts.countProjects(account.id), 3);
  await assert.rejects(() => projects.authorizeWrite('alice', 'p4', token), (e) => e.code === 'PLAN_LIMIT');

  // Upgrade to Pro lifts both gates.
  const up = await accounts.setPlan(account.id, 'pro');
  assert.equal(up.plan, 'pro');
  const w = await projects.authorizeWrite('alice', 'p4', token, { private: true });
  assert.equal(w.meta.visibility, 'private', 'Pro can create private projects');
  assert.ok((await accounts.countProjects(account.id)) >= 4, 'Pro is not capped at 3');

  // Unknown plan rejected.
  await assert.rejects(() => accounts.setPlan(account.id, 'ultra'), (e) => e.code === 'BAD_PLAN');
}

async function teamFlow({ accounts, projects }) {
  // A Team-plan owner with a private project.
  const { account: owner, token: ownerTok } = await accounts.createAccount({ handle: 'org' });
  await accounts.setPlan(owner.id, 'team');
  await projects.authorizeWrite('org', 'app', ownerTok, { private: true });

  const dev = await accounts.createAccount({ handle: 'dev' });
  const guest = await accounts.createAccount({ handle: 'guest' });

  // Before membership: outsiders can't write or read the private project.
  await assert.rejects(() => projects.authorizeWrite('org', 'app', dev.token), (e) => e.code === 'FORBIDDEN');
  assert.equal(await projects.canRead('org', 'app', dev.token), false);

  // Owner invites dev (write) and guest (viewer).
  await projects.addMember('org', 'app', { accountId: dev.account.id, handle: 'dev' }, 'member');
  await projects.addMember('org', 'app', { accountId: guest.account.id, handle: 'guest' }, 'viewer');
  assert.equal(await projects.getMemberRole('org', 'app', dev.account.id), 'member');
  assert.equal((await projects.listMembers('org', 'app')).length, 2);

  // Member can push to the existing project and read it.
  const w = await projects.authorizeWrite('org', 'app', dev.token);
  assert.equal(w.created, false);
  assert.equal(w.role, 'member');
  assert.equal(await projects.canRead('org', 'app', dev.token), true);

  // Viewer can read the private project but cannot write.
  assert.equal(await projects.canRead('org', 'app', guest.token), true);
  await assert.rejects(() => projects.authorizeWrite('org', 'app', guest.token), (e) => e.code === 'FORBIDDEN');

  // A member cannot create a NEW project under the owner's handle.
  await assert.rejects(() => projects.authorizeWrite('org', 'brand-new', dev.token), (e) => e.code === 'FORBIDDEN');

  // Removing dev revokes access.
  assert.equal(await projects.removeMember('org', 'app', dev.account.id), true);
  await assert.rejects(() => projects.authorizeWrite('org', 'app', dev.token), (e) => e.code === 'FORBIDDEN');
  assert.equal(await projects.canRead('org', 'app', dev.token), false);
}

test('accounts: register, tokens, and handle ownership (filesystem)', async () => {
  await accountFlow(freshHosted('livearch-acct-'));
  delete process.env.LIVEARCH_DATA_DIR;
});

test('snapshot history is newest-first and capped (filesystem)', async () => {
  await historyFlow(freshHosted('livearch-hist-'));
  delete process.env.LIVEARCH_DATA_DIR;
});

test('plan gating: private + project limits + upgrade (filesystem)', async () => {
  await planFlow(freshHosted('livearch-plan-'));
  delete process.env.LIVEARCH_DATA_DIR;
});

test('team membership + roles (filesystem)', async () => {
  await teamFlow(freshHosted('livearch-team-'));
  delete process.env.LIVEARCH_DATA_DIR;
});

// Require the hosted modules with DATABASE_URL set (→ Postgres backend) and an
// injected in-memory Postgres (pg-mem), so the exact same SQL runs the flows.
function freshHostedPg() {
  const { newDb } = require('pg-mem');
  const pool = new (newDb().adapters.createPg().Pool)();
  process.env.DATABASE_URL = 'postgres://pg-mem/test';
  for (const m of ['../server/lib/segments', '../server/lib/pg', '../server/lib/store', '../server/lib/accounts', '../server/lib/projects']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* not loaded */ }
  }
  const pg = require('../server/lib/pg');
  pg.setPool(pool);
  return {
    pg,
    store: require('../server/lib/store'),
    accounts: require('../server/lib/accounts'),
    projects: require('../server/lib/projects'),
  };
}

test('Postgres backend runs the account + ownership flow (pg-mem)', async () => {
  const mods = freshHostedPg();
  assert.equal(mods.store.usePg, true, 'store selected the Postgres backend');
  await mods.pg.init();
  await accountFlow(mods);
  delete process.env.DATABASE_URL;
});

test('Postgres backend runs the snapshot history flow (pg-mem)', async () => {
  const mods = freshHostedPg();
  await mods.pg.init();
  await historyFlow(mods);
  delete process.env.DATABASE_URL;
});

test('Postgres backend runs the plan gating flow (pg-mem)', async () => {
  const mods = freshHostedPg();
  await mods.pg.init();
  await planFlow(mods);
  delete process.env.DATABASE_URL;
});

test('Postgres backend runs the team membership flow (pg-mem)', async () => {
  const mods = freshHostedPg();
  await mods.pg.init();
  await teamFlow(mods);
  delete process.env.DATABASE_URL;
});

test('server-side diff: selects snapshots by branch, revision, or default', () => {
  const { resolveArchs, computeDiff } = require('../server/lib/diffs');
  const arch = (ids) => ({ name: 'p', nodes: ids.map((id) => ({ id, label: id })), edges: [] });
  // newest-first history across two branches
  const history = [
    { arch: arch(['a', 'b', 'c']), at: 300, branch: 'feature' },
    { arch: arch(['a', 'b']),      at: 200, branch: 'main' },
    { arch: arch(['a']),           at: 100, branch: 'main' },
  ];

  // default: latest vs previous push
  let r = resolveArchs(history, {});
  assert.equal(r.headLabel, 'latest');
  assert.equal(r.baseLabel, 'previous');
  assert.deepEqual(r.headArch.nodes.map((n) => n.id), ['a', 'b', 'c']);

  // branch diff: main → feature
  r = resolveArchs(history, { base: 'main', head: 'feature' });
  assert.equal(r.baseLabel, 'main');
  assert.equal(r.headLabel, 'feature');

  // computeDiff: feature adds node "c" vs main
  const d = computeDiff(history, { base: 'main', head: 'feature' });
  assert.deepEqual(d.addedNodes.map((n) => n.id), ['c']);
  assert.match(d.text, /Architecture diff: main → feature/);

  // revision diff: 2 pushes back
  r = resolveArchs(history, { steps: 2 });
  assert.deepEqual(r.baseArch.nodes.map((n) => n.id), ['a']);

  // unknown branch and empty history error out
  assert.throws(() => resolveArchs(history, { base: 'nope', head: 'feature' }), (e) => e.code === 'REF_NOT_FOUND');
  assert.throws(() => resolveArchs([], {}), (e) => e.code === 'NO_DATA');
});

test('billing: mode selection and Stripe webhook → plan mapping', () => {
  delete require.cache[require.resolve('../server/lib/billing')];
  const billing = require('../server/lib/billing');

  // mode() follows LIVEARCH_BILLING
  delete process.env.LIVEARCH_BILLING;
  assert.equal(billing.mode(), 'direct', 'default is direct (instant upgrade)');
  process.env.LIVEARCH_BILLING = 'stripe';
  assert.equal(billing.mode(), 'stripe');
  delete process.env.LIVEARCH_BILLING;

  // checkout.session.completed → the purchased plan (via metadata or client_reference_id)
  assert.deepEqual(
    billing.planChangeForEvent({ type: 'checkout.session.completed', data: { object: { metadata: { accountId: 'a1', plan: 'pro' } } } }),
    { accountId: 'a1', plan: 'pro' }
  );
  assert.deepEqual(
    billing.planChangeForEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'a2', metadata: { plan: 'team' } } } }),
    { accountId: 'a2', plan: 'team' }
  );
  // subscription cancelled → downgrade to free
  assert.deepEqual(
    billing.planChangeForEvent({ type: 'customer.subscription.deleted', data: { object: { metadata: { accountId: 'a3' } } } }),
    { accountId: 'a3', plan: 'free' }
  );
  // unknown plan or unrelated event → no change
  assert.equal(billing.planChangeForEvent({ type: 'checkout.session.completed', data: { object: { metadata: { accountId: 'a4', plan: 'ultra' } } } }), null);
  assert.equal(billing.planChangeForEvent({ type: 'invoice.paid', data: { object: {} } }), null);
  assert.equal(billing.planChangeForEvent(null), null);
});

test('pub/sub bus delivers published updates to subscribers', () => {
  const { publish, subscribe } = require('../server/lib/bus');
  const got = [];
  const unsub = subscribe('me/repo', (d) => got.push(d));
  publish('me/repo', { arch: { name: 'a' } });
  publish('other/repo', { arch: { name: 'x' } }); // different key — ignored
  assert.equal(got.length, 1);
  assert.equal(got[0].arch.name, 'a');
  unsub();
  publish('me/repo', { arch: { name: 'b' } }); // after unsub — ignored
  assert.equal(got.length, 1);
});

test('template.render produces self-contained HTML with baked-in ARCH', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  const html = template.render(arch, { port: 7842 });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /let ARCH = /);
  assert.match(html, /ws:\/\/localhost/);
  assert.ok(html.includes('fixture-app'), 'project name baked in');
});

test('template.render includes the diagram export (PNG/SVG) controls', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  const html = template.render(arch, { port: 7842 });
  assert.ok(html.includes('id="btnExport"'), 'export button present');
  assert.ok(html.includes('data-fmt="png"'), 'PNG option present');
  assert.ok(html.includes('data-fmt="svg"'), 'SVG option present');
  assert.match(html, /function buildExportSvg/);
  assert.match(html, /XMLSerializer/);
  assert.match(html, /function exportPng/);
  assert.match(html, /function exportSvg/);
});

test('template.render wires one-click GitHub issue links when repo is known', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  arch.repo = { owner: 'acme', name: 'widgets', url: 'https://github.com/acme/widgets' };
  const html = template.render(arch, { port: 7842 });
  assert.match(html, /function issueUrl/);
  assert.ok(html.includes('ARCH.repo ?'), 'issue link is gated on ARCH.repo');
  assert.ok(html.includes('/issues/new?title='), 'builds a prefilled new-issue URL');
  assert.ok(html.includes('github.com/acme/widgets'), 'repo baked into ARCH');
});
