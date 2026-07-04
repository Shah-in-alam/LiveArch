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
    else if (a === '--demo') opts.demo = true;
    else if (a === '--host') opts.host = argv[++i];
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
        livearch push <handle>/<repo>           Publish the diagram to a hosted server (permanent URL)
        livearch share <handle>/<repo>          Watch + push on every save (hosted viewers update live)

Arguments:
  path                  Path to watch (default: current directory)

Options:
  --port <number>       WebSocket/HTTP port (default: 7842)
  --host <addr>         Bind address (default: all interfaces, for team sharing)
  --output <filename>   Output filename (default: .visualarch.html)
  --ignore <glob>       Additional ignore pattern (repeatable)
  --no-open             Don't print the open hint
  --no-watch            Generate the diagram once and exit (CI mode)
  --routes              Include individual HTTP endpoints as nodes (off by default)
  --tests               Include test files as nodes (off by default)
  --config              Include config files (.env, …) as nodes (off by default)
  --review              Print architecture suggestions and exit (AI with ANTHROPIC_API_KEY, else free Preview)
  --demo                Force the free heuristic Preview (with --review)
  --help                Show this help
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const raw = process.argv.slice(2);
  if (raw[0] === 'diff') return cmdDiff(raw.slice(1));
  if (raw[0] === 'badge') return cmdBadge(raw.slice(1));
  if (raw[0] === 'push') return cmdPush(raw.slice(1));
  if (raw[0] === 'share') return cmdShare(raw.slice(1));

  const opts = parseArgs(raw);
  if (opts.help) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const WATCH_PATH = opts.path;
  const OUTPUT = path.join(WATCH_PATH, opts.output);
  const trackedFiles = new Set();
  // Detect the GitHub repo once so the diagram can offer one-click "Create issue"
  // links for AI-review suggestions. Null for non-GitHub / non-git projects.
  const REPO = detectRepo(WATCH_PATH);

  function analyseProject() {
    const arch = analyse(WATCH_PATH, [...trackedFiles], { endpoints: opts.routes, tests: opts.tests, config: opts.config });
    if (REPO) arch.repo = REPO;
    return arch;
  }

  function buildOnce() {
    const arch = analyseProject();
    const html = template.render(arch, { port: opts.port });
    fs.writeFileSync(OUTPUT, html);
    return arch;
  }

  function currentArch() {
    return analyseProject();
  }

  // --- AI review: one-shot suggestions and exit ------------------------
  if (opts.review) {
    collectFiles(WATCH_PATH, opts.ignore).forEach((f) => trackedFiles.add(f));
    runReview(currentArch(), { demo: opts.demo }).then((code) => process.exit(code));
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
    res.type('html').send(template.render(analyseProject(), { port: opts.port }));
  });
  app.get('/arch.json', (_req, res) => res.json(currentArch()));

  // Architecture review — full AI when ANTHROPIC_API_KEY is set, else a free
  // heuristic Preview. Pass ?demo=1 to force the Preview.
  app.get('/review', async (req, res) => {
    try {
      const result = await getReview(currentArch(), { demo: req.query.demo === '1' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message, code: err.code || 'ERROR' });
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
    ws.send(JSON.stringify({ type: 'init', arch: analyseProject() }));
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
      const done = () => {
        printBanner(opts, WATCH_PATH, arch, trackedFiles.size);
        if (opts.open) openBrowser(`http://localhost:${opts.port}`);
      };
      // Default: bind all interfaces so teammates on your network can view it.
      if (opts.host) server.listen(opts.port, opts.host, done);
      else server.listen(opts.port, done);
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

/**
 * Detect the GitHub owner/repo from `git remote origin`, so the diagram can
 * offer one-click "Create issue" links for AI-review suggestions. Returns
 * { owner, name, url } for a GitHub remote, or null otherwise.
 */
function detectRepo(dir) {
  let remote;
  try {
    remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null; // not a git repo, or no origin
  }
  if (!remote) return null;
  // Match both https and ssh GitHub remotes:
  //   https://github.com/owner/repo(.git)   git@github.com:owner/repo(.git)
  const m = remote.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  const owner = m[1], name = m[2];
  return { owner, name, url: `https://github.com/${owner}/${name}` };
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

/** Publish the current architecture to a hosted LiveArch server (Phase 1). */
async function cmdPush(args) {
  let server = (process.env.LIVEARCH_SERVER || 'http://localhost:3000').replace(/\/$/, '');
  let token = process.env.LIVEARCH_INGEST_TOKEN || '';
  let dir = process.cwd();
  let isPrivate = false;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server') server = args[++i].replace(/\/$/, '');
    else if (args[i] === '--token') token = args[++i];
    else if (args[i] === '--path') dir = path.resolve(args[++i]);
    else if (args[i] === '--private') isPrivate = true;
    else if (!args[i].startsWith('-')) pos.push(args[i]);
  }
  const target = pos[0];
  if (!target || !target.includes('/')) {
    console.error('Usage: livearch push <handle>/<repo> [--server <url>] [--token <t>] [--private]');
    process.exit(1);
  }
  const [handle, slug] = target.split('/');
  const arch = analyseDir(dir);
  try {
    const data = await ingest(server, handle, slug, arch, token, isPrivate);
    let url = `${server}/u/${handle}/${slug}`;
    console.log(`⬡  Pushed ${arch.nodes.length} nodes → ${url}`);
    if (data.visibility === 'private') {
      console.log(`   Private — viewers need the token: ${url}?token=${encodeURIComponent(token)}`);
    }
  } catch (e) {
    console.error(`✗ push failed: ${e.message}`);
    if (/^0/.test(e.message) || /fetch failed|ECONN/.test(e.message)) {
      console.error('  Is the server running?  (cd server && npm run dev)');
    }
    process.exit(1);
  }
}

/** POST an arch to a hosted server's ingest endpoint. Returns the parsed body. */
async function ingest(server, handle, slug, arch, token, isPrivate) {
  const res = await fetch(server + '/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, slug, arch, token, private: !!isPrivate }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${data.error || 'push failed'}`);
  return data;
}

/**
 * Watch the project and push its architecture on every save, so hosted viewers
 * of /u/<handle>/<slug> update live (via the server's SSE stream).
 */
function cmdShare(args) {
  let server = (process.env.LIVEARCH_SERVER || 'http://localhost:3000').replace(/\/$/, '');
  let token = process.env.LIVEARCH_INGEST_TOKEN || '';
  let dir = process.cwd();
  let isPrivate = false;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server') server = args[++i].replace(/\/$/, '');
    else if (args[i] === '--token') token = args[++i];
    else if (args[i] === '--path') dir = path.resolve(args[++i]);
    else if (args[i] === '--private') isPrivate = true;
    else if (!args[i].startsWith('-')) pos.push(args[i]);
  }
  const target = pos[0];
  if (!target || !target.includes('/')) {
    console.error('Usage: livearch share <handle>/<repo> [--server <url>] [--token <t>] [--private]');
    process.exit(1);
  }
  const [handle, slug] = target.split('/');
  const viewer = `${server}/u/${handle}/${slug}` + (isPrivate ? `?token=${encodeURIComponent(token)}` : '');
  const tracked = new Set();
  let pushing = false;
  async function pushNow() {
    if (pushing) return;
    pushing = true;
    try {
      const arch = analyse(dir, [...tracked]);
      await ingest(server, handle, slug, arch, token, isPrivate);
      const t = new Date().toLocaleTimeString();
      console.log(`  ↑ ${t}  pushed ${arch.nodes.length} nodes`);
    } catch (e) {
      console.error(`  ✗ push failed: ${e.message}`);
    } finally {
      pushing = false;
    }
  }

  const watcher = chokidar.watch(dir, {
    ignored: [(p) => p.split(path.sep).some((seg) => IGNORE_DIRS.has(seg))],
    persistent: true, ignoreInitial: false, depth: 6,
  });
  let ready = false, timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { pushNow(); }, 500); };
  watcher
    .on('add', (f) => { tracked.add(f); if (ready) schedule(); })
    .on('change', () => { if (ready) schedule(); })
    .on('unlink', (f) => { tracked.delete(f); if (ready) schedule(); })
    .on('ready', async () => {
      ready = true;
      console.log(`⬡  LiveArch — sharing ${dir}${isPrivate ? '  (private)' : ''}`);
      console.log(`   Viewer : ${viewer}  ← share this (updates live)`);
      console.log(`   Press Ctrl+C to stop.\n`);
      await pushNow();
    });
  process.on('SIGINT', () => { console.log('\n⬡  Stopped sharing.'); watcher.close(); process.exit(0); });
}

/**
 * Get review suggestions. Uses the Claude API when a key is available;
 * otherwise (or with { demo:true }) falls back to the free heuristic Preview.
 * @returns {Promise<{suggestions:object[], preview:boolean}>}
 */
async function getReview(arch, opts = {}) {
  const { heuristicReview } = require('../lib/ai/heuristics');
  const hasKey = !!(opts.apiKey || process.env.ANTHROPIC_API_KEY);
  if (opts.demo || !hasKey) {
    return { suggestions: heuristicReview(arch), preview: true };
  }
  const { review } = require('../lib/ai/reviewer');
  try {
    return { suggestions: await review(arch, opts), preview: false };
  } catch (err) {
    if (err.code === 'NO_API_KEY' || err.code === 'SDK_MISSING') {
      return { suggestions: heuristicReview(arch), preview: true, warn: err.message };
    }
    throw err;
  }
}

/** Run a review and print the suggestions. Returns an exit code. */
async function runReview(arch, opts = {}) {
  console.log(`⬡  LiveArch — reviewing ${arch.name} (${arch.nodes.length} nodes)…\n`);
  try {
    const { suggestions, preview } = await getReview(arch, opts);
    if (preview) {
      console.log('⚡ Preview (free, heuristic). Set ANTHROPIC_API_KEY for the full AI review (LiveArch Pro).\n');
    }
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

/** First non-internal IPv4 address, for network sharing. */
function lanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

function printBanner(opts, watchPath, arch, fileCount) {
  const line = '─'.repeat(45);
  console.log(`\n⬡  LiveArch`);
  console.log(line);
  console.log(`📁 Watching  : ${watchPath}`);
  console.log(`📄 Diagram   : ${opts.output}  ← open this in your browser`);
  console.log(`🌐 Local URL : http://localhost:${opts.port}`);
  const ip = (!opts.host || opts.host === '0.0.0.0' || opts.host === '::') ? lanIp() : null;
  if (ip) console.log(`👥 Network   : http://${ip}:${opts.port}  ← share this with your team (same network)`);
  console.log(line);
  console.log(`✓ ${arch.nodes.length} nodes detected, ${fileCount} files watched\n`);
  console.log(opts.open
    ? `Opening the diagram in your browser…  (use --no-open to disable)`
    : `Open http://localhost:${opts.port} in your browser.`);
  console.log(`Diagram auto-updates every time you save a file.`);
  console.log(`Press Ctrl+C to stop.\n`);
}

main();
