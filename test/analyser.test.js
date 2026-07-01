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

test('template.render produces self-contained HTML with baked-in ARCH', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  const html = template.render(arch, { port: 7842 });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /let ARCH = /);
  assert.match(html, /ws:\/\/localhost/);
  assert.ok(html.includes('fixture-app'), 'project name baked in');
});
