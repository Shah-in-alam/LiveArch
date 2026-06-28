'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { analyse, classifyFile, parseImports } = require('../lib/analyser');
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
    write('src/api/users.js', 'app.get("/users", () => {});'),
    write('src/services/db.js', 'module.exports = {};'),
    write('src/data/wines.js', 'export const wines = [];'),
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

test('template.render produces self-contained HTML with baked-in ARCH', () => {
  const { root, files } = makeFixture();
  const arch = analyse(root, files);
  const html = template.render(arch, { port: 7842 });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /let ARCH = /);
  assert.match(html, /ws:\/\/localhost/);
  assert.ok(html.includes('fixture-app'), 'project name baked in');
});
