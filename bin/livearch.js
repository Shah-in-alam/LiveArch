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
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const chokidar = require('chokidar');
const express = require('express');
const { WebSocketServer } = require('ws');

const { analyse, IGNORE_DIRS } = require('../lib/analyser');
const template = require('../lib/template');
const { diffArch, formatDiff } = require('../lib/diff');
const { badgeSvg, badgeMarkdown } = require('../lib/badge');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { path: process.cwd(), port: 7842, output: '.visualarch.html', ignore: [], open: true, watch: true, routes: false, tests: false, config: false, review: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--port') opts.port = parseInt(argv[++i], 10) || opts.port;
    else if (a === '--output') opts.output = argv[++i];
    else if (a === '--ignore') opts.ignore.push(argv[++i]);
    else if (a === '--no-open') opts.open = false;
    else if (a === '--no-watch') opts.watch = false;
    else if (a === '--routes' || a === '--endpoints') opts.routes = true;
    else if (a === '--tests') opts.tests = true;
    else if (a === '--config') opts.config = true;
    else if (a === '--review') opts.review = true;
    else if (!a.startsWith('-')) rest.push(a);
  }
  if (rest[0]) opts.path = path.resolve(rest[0]);
  return opts;
}

const HELP = `
⬡  LiveArch — real-time architecture diagrams that live inside your repo

Usage:  livearch [path] [options]
        livearch diff <base-ref> [head-ref]     Compare architecture between two git refs
        livearch badge [path] [--output file]   Write an SVG architecture badge for your README

Arguments:
  path                  Path to watch (default: current directory)

Options:
  --port <number>       WebSocket/HTTP port (default: 7842)
  --output <filename>   Output filename (default: .visualarch.html)
  --ignore <glob>       Additional ignore pattern (repeatable)
  --no-open             Don't print the open hint
  --no-watch            Generate the diagram once and exit (CI mode)
  --routes              Include individual HTTP endpoints as nodes (off by default)
  --tests               Include test files as nodes (off by default)
  --config              Include config files (.env, …) as nodes (off by default)
  --review              Print AI architecture suggestions and exit (needs ANTHROPIC_API_KEY)
  --help                Show this help
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const raw = process.argv.slice(2);
  if (raw[0] === 'diff') return cmdDiff(raw.slice(1));
  if (raw[0] === 'badge') return cmdBadge(raw.slice(1));

  const opts = parseArgs(raw);
  if (opts.help) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const WATCH_PATH = opts.path;
  const OUTPUT = path.join(WATCH_PATH, opts.output);
  const trackedFiles = new Set();

  function buildOnce() {
    const arch = analyse(WATCH_PATH, [...trackedFiles], { endpoints: opts.routes, tests: opts.tests, config: opts.config });
    const html = template.render(arch, { port: opts.port });
    fs.writeFileSync(OUTPUT, html);
    return arch;
  }

  function currentArch() {
    return analyse(WATCH_PATH, [...trackedFiles], { endpoints: opts.routes, tests: opts.tests, config: opts.config });
  }

  // --- AI review: one-shot suggestions and exit ------------------------
  if (opts.review) {
    collectFiles(WATCH_PATH, opts.ignore).forEach((f) => trackedFiles.add(f));
    runReview(currentArch()).then((code) => process.exit(code));
    return;
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
    const arch = analyse(WATCH_PATH, [...trackedFiles], { endpoints: opts.routes, tests: opts.tests, config: opts.config });
    res.type('html').send(template.render(arch, { port: opts.port }));
  });
  app.get('/arch.json', (_req, res) => res.json(currentArch()));

  // AI architecture review (LiveArch Pro) — returns suggestions JSON.
  app.get('/review', async (_req, res) => {
    try {
      const { review } = require('../lib/ai/reviewer');
      const suggestions = await review(currentArch());
      res.json({ suggestions });
    } catch (err) {
      res.status(err.code === 'NO_API_KEY' ? 402 : 500)
        .json({ error: err.message, code: err.code || 'ERROR' });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(data);
    }
  }

  wss.on('connection', (ws) => {
    const arch = analyse(WATCH_PATH, [...trackedFiles], { endpoints: opts.routes, tests: opts.tests, config: opts.config });
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
      server.listen(opts.port, () => {
        printBanner(opts, WATCH_PATH, arch, trackedFiles.size);
        if (opts.open) openBrowser(`http://localhost:${opts.port}`);
      });
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
/**
 * Open a URL in the default browser, cross-platform. Best-effort: failures are
 * swallowed so a headless/CI environment never crashes the watcher.
 */
function openBrowser(url) {
  try {
    let cmd, args;
    if (process.platform === 'win32') {
      // `start` is a cmd builtin; empty "" is the (ignored) window title.
      cmd = 'cmd'; args = ['/c', 'start', '', url];
    } else if (process.platform === 'darwin') {
      cmd = 'open'; args = [url];
    } else {
      cmd = 'xdg-open'; args = [url];
    }
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // ignore (e.g. xdg-open missing)
    child.unref();
  } catch {
    /* best-effort: never block startup on browser launch */
  }
}

// ---------------------------------------------------------------------------
// Subcommands: diff (branch vs branch) and badge (README SVG)
// ---------------------------------------------------------------------------
/** Analyse a working directory directly. */
function analyseDir(dir) {
  const files = collectFiles(dir);
  return analyse(dir, files);
}

/** Analyse a git ref by checking it out into a throwaway worktree. */
function analyseRef(root, ref) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-diff-'));
  try {
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', tmp, ref], { cwd: root, stdio: 'pipe' });
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`git could not check out "${ref}" (is this a git repo, and is the ref valid?)`);
  }
  try {
    return analyseDir(tmp);
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', tmp], { cwd: root, stdio: 'pipe' }); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function cmdDiff(args) {
  const pos = args.filter((a) => !a.startsWith('-'));
  const base = pos[0];
  const head = pos[1]; // optional — defaults to the working tree
  if (!base) {
    console.error('Usage: livearch diff <base-ref> [head-ref]');
    console.error('  e.g. livearch diff main            (compare main → working tree)');
    console.error('       livearch diff main feature/x  (compare two refs)');
    process.exit(1);
  }
  const root = process.cwd();
  try {
    const baseArch = analyseRef(root, base);
    const headArch = head ? analyseRef(root, head) : analyseDir(root);
    const diff = diffArch(baseArch, headArch);
    console.log(formatDiff(diff, base, head || 'working tree'));
  } catch (e) {
    console.error('✗ ' + e.message);
    process.exit(1);
  }
}

function cmdBadge(args) {
  let output = 'docs/architecture-badge.svg';
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output') output = args[++i];
    else if (!args[i].startsWith('-')) pos.push(args[i]);
  }
  const root = pos[0] ? path.resolve(pos[0]) : process.cwd();
  const arch = analyseDir(root);
  const svg = badgeSvg(arch);
  const outPath = path.resolve(root, output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svg);
  console.log(`⬡  Wrote badge: ${output}  (${arch.nodes.length} nodes)`);
  console.log(`   Embed in your README:  ${badgeMarkdown(output)}`);
}

/** Run an AI review and print the suggestions. Returns an exit code. */
async function runReview(arch) {
  const { review } = require('../lib/ai/reviewer');
  console.log(`⬡  LiveArch — AI review of ${arch.name} (${arch.nodes.length} nodes)…\n`);
  try {
    const suggestions = await review(arch);
    if (!suggestions.length) {
      console.log('✓ No architectural concerns found.');
      return 0;
    }
    for (const s of suggestions) {
      const icon = s.severity === 'warning' ? '⚠' : 'ℹ';
      const where = s.node ? ` [${s.node}]` : '';
      console.log(`${icon}${where} ${s.message}`);
      if (s.suggestion) console.log(`    → ${s.suggestion}`);
    }
    return 0;
  } catch (err) {
    console.error(`✗ Review failed: ${err.message}`);
    if (err.code === 'NO_API_KEY') console.error('  Set ANTHROPIC_API_KEY (LiveArch Pro).');
    if (err.code === 'SDK_MISSING') console.error('  Run: npm install @anthropic-ai/sdk');
    return 1;
  }
}

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
  console.log(opts.open
    ? `Opening the diagram in your browser…  (use --no-open to disable)`
    : `Open http://localhost:${opts.port} in your browser.`);
  console.log(`Diagram auto-updates every time you save a file.`);
  console.log(`Press Ctrl+C to stop.\n`);
}

main();
