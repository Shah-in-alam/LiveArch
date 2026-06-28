#!/usr/bin/env node
'use strict';

/**
 * livearch — CLI entry point.
 *
 * Orchestrates everything:
 *   - chokidar watches the project (350ms debounce)
 *   - analyser builds the arch graph
 *   - template writes .visualarch.html to disk
 *   - express serves the diagram at http://localhost:<port>
 *   - ws pushes live updates to connected browsers
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const chokidar = require('chokidar');
const express = require('express');
const { WebSocketServer } = require('ws');

const { analyse, IGNORE_DIRS } = require('../lib/analyser');
const template = require('../lib/template');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { path: process.cwd(), port: 7842, output: '.visualarch.html', ignore: [], open: true, watch: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--port') opts.port = parseInt(argv[++i], 10) || opts.port;
    else if (a === '--output') opts.output = argv[++i];
    else if (a === '--ignore') opts.ignore.push(argv[++i]);
    else if (a === '--no-open') opts.open = false;
    else if (a === '--no-watch') opts.watch = false;
    else if (!a.startsWith('-')) rest.push(a);
  }
  if (rest[0]) opts.path = path.resolve(rest[0]);
  return opts;
}

const HELP = `
⬡  LiveArch — real-time architecture diagrams that live inside your repo

Usage:  livearch [path] [options]

Arguments:
  path                  Path to watch (default: current directory)

Options:
  --port <number>       WebSocket/HTTP port (default: 7842)
  --output <filename>   Output filename (default: .visualarch.html)
  --ignore <glob>       Additional ignore pattern (repeatable)
  --no-open             Don't print the open hint
  --no-watch            Generate the diagram once and exit (CI mode)
  --help                Show this help
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const WATCH_PATH = opts.path;
  const OUTPUT = path.join(WATCH_PATH, opts.output);
  const trackedFiles = new Set();

  function buildOnce() {
    const arch = analyse(WATCH_PATH, [...trackedFiles]);
    const html = template.render(arch, { port: opts.port });
    fs.writeFileSync(OUTPUT, html);
    return arch;
  }

  // --- CI mode: generate once and exit ---------------------------------
  if (!opts.watch) {
    // Synchronously collect files so we can analyse without a live watcher.
    collectFiles(WATCH_PATH, opts.ignore).forEach((f) => trackedFiles.add(f));
    const arch = buildOnce();
    console.log(`⬡  LiveArch — wrote ${opts.output} (${arch.nodes.length} nodes, ${trackedFiles.size} files)`);
    return;
  }

  // --- HTTP + WebSocket server -----------------------------------------
  const app = express();
  // Serve freshly-rendered HTML so the browser always gets current state.
  // (Rendering in-memory also sidesteps sendFile path quirks on Windows.)
  app.get('/', (_req, res) => {
    const arch = analyse(WATCH_PATH, [...trackedFiles]);
    res.type('html').send(template.render(arch, { port: opts.port }));
  });
  app.get('/arch.json', (_req, res) => res.json(analyse(WATCH_PATH, [...trackedFiles])));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(data);
    }
  }

  wss.on('connection', (ws) => {
    const arch = analyse(WATCH_PATH, [...trackedFiles]);
    ws.send(JSON.stringify({ type: 'init', arch }));
  });

  // --- File watcher (chokidar) -----------------------------------------
  // NOTE: chokidar passes absolute paths to ignore matchers. We must ignore
  // our own output file by its absolute path / basename, otherwise writing
  // it triggers a 'change' event → rebuild → write → infinite loop.
  const ignored = [
    (p) => p.split(path.sep).some((seg) => IGNORE_DIRS.has(seg)),
    (p) => p === OUTPUT || path.basename(p) === opts.output,
    ...opts.ignore,
  ];

  const watcher = chokidar.watch(WATCH_PATH, {
    ignored,
    persistent: true,
    ignoreInitial: false,
    depth: 6,
  });

  let timer = null;
  let pending = null; // { event, file }

  function scheduleRebuild(event, file) {
    pending = { event, file };
    clearTimeout(timer);
    timer = setTimeout(() => {
      const arch = buildOnce();
      const rel = path.relative(WATCH_PATH, pending.file).split(path.sep).join('/');
      broadcast({ type: 'update', arch, event: pending.event, file: rel });
      const sign = pending.event === 'remove' ? '-' : pending.event === 'add' ? '+' : '~';
      console.log(`  ${sign} ${pending.event}: ${rel}  (${arch.nodes.length} nodes)`);
      pending = null;
    }, 350); // debounce
  }

  let ready = false;
  watcher
    .on('add', (f) => { trackedFiles.add(f); if (ready) scheduleRebuild('add', f); })
    .on('change', (f) => { if (ready) scheduleRebuild('change', f); })
    .on('unlink', (f) => { trackedFiles.delete(f); if (ready) scheduleRebuild('remove', f); })
    .on('ready', () => {
      ready = true;
      const arch = buildOnce();
      server.listen(opts.port, () => printBanner(opts, WATCH_PATH, arch, trackedFiles.size));
    });

  // --- Graceful shutdown -----------------------------------------------
  process.on('SIGINT', () => {
    console.log('\n⬡  LiveArch stopped.');
    watcher.close();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function collectFiles(root, extraIgnore = [], depth = 6, prefix = '', out = []) {
  if (depth < 0) return out;
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const rel = prefix ? path.join(prefix, e.name) : e.name;
    if (extraIgnore.includes(rel)) continue;
    if (e.isDirectory()) collectFiles(root, extraIgnore, depth - 1, rel, out);
    else out.push(path.join(root, rel));
  }
  return out;
}

function printBanner(opts, watchPath, arch, fileCount) {
  const line = '─'.repeat(45);
  console.log(`\n⬡  LiveArch`);
  console.log(line);
  console.log(`📁 Watching  : ${watchPath}`);
  console.log(`📄 Diagram   : ${opts.output}  ← open this in your browser`);
  console.log(`🌐 Live URL  : http://localhost:${opts.port}`);
  console.log(line);
  console.log(`✓ ${arch.nodes.length} nodes detected, ${fileCount} files watched\n`);
  console.log(`Diagram auto-updates every time you save a file.`);
  console.log(`Press Ctrl+C to stop.\n`);
}

main();
