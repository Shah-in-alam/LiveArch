'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { analyse, classifyFile, parseImports, detectCustomHook, parseRoutes } = require('../lib/analyser');
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

test('template.render produces self-contained HTML with baked-in ARCH', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  const html = template.render(arch, { port: 7842 });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /let ARCH = /);
  assert.match(html, /ws:\/\/localhost/);
  assert.ok(html.includes('fixture-app'), 'project name baked in');
});
