'use strict';

/**
 * store.js — snapshot storage for the hosted server.
 *
 * Two backends, chosen at load time:
 *   - Postgres (Neon) when DATABASE_URL is set — see pg.js.
 *   - Filesystem JSON under DATA_DIR otherwise (great for `next dev` and small
 *     self-hosting).
 *
 * Both expose the same async API, so routes/CLI don't care which is active.
 * The filesystem layout is Postgres-shaped, so swapping backends changes
 * nothing else — see docs/BACKEND-DESIGN.md.
 */

const fs = require('fs');
const path = require('path');
const { safeSeg } = require('./segments');

// Anchor to the process CWD (the server root under `next dev`/`next start`),
// not __dirname: Next.js bundles these modules, so __dirname points into
// .next/ and can differ between route bundles — which would split the store
// across directories. CWD is shared by every route. Override with LIVEARCH_DATA_DIR.
const DATA_DIR = process.env.LIVEARCH_DATA_DIR || path.join(process.cwd(), '.data');
const HISTORY_MAX = 50; // global hard cap; per-plan depth is applied on top
const usePg = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);

function fileFor(handle, slug) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return null;
  return path.join(DATA_DIR, h, s + '.json');
}
function historyFile(handle, slug) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return null;
  return path.join(DATA_DIR, h, s + '.history.json');
}

// --- filesystem backend (async wrappers over sync fs) --------------------

/** Persist the latest snapshot for handle/slug. Returns { handle, slug }. */
async function saveSnapshotFs(handle, slug, arch) {
  const f = fileFor(handle, slug);
  if (!f) throw new Error('invalid handle/slug');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ arch, updatedAt: Date.now() }));
  return { handle: safeSeg(handle), slug: safeSeg(slug) };
}

/** Read the latest snapshot for handle/slug, or null. */
async function getSnapshotFs(handle, slug) {
  const f = fileFor(handle, slug);
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

/** Append a snapshot to the rolling history (newest first, capped per plan). */
async function appendHistoryFs(handle, slug, arch, maxDepth) {
  const f = historyFile(handle, slug);
  if (!f) return;
  const cap = Math.min(Number.isFinite(maxDepth) && maxDepth > 0 ? maxDepth : HISTORY_MAX, HISTORY_MAX);
  let list = [];
  try { list = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* new / corrupt */ }
  if (!Array.isArray(list)) list = [];
  list.unshift({ arch, at: Date.now() });
  if (list.length > cap) list.length = cap;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(list));
  } catch { /* best-effort */ }
}

/** Read the project's snapshot history (newest first), or []. */
async function getHistoryFs(handle, slug) {
  const f = historyFile(handle, slug);
  if (!f) return [];
  try {
    const list = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// --- backend selection ----------------------------------------------------
let api;
if (usePg) {
  const pg = require('./pg');
  api = {
    saveSnapshot: pg.saveSnapshot, getSnapshot: pg.getSnapshot,
    appendHistory: pg.appendHistory, getHistory: pg.getHistory,
  };
} else {
  api = {
    saveSnapshot: saveSnapshotFs, getSnapshot: getSnapshotFs,
    appendHistory: appendHistoryFs, getHistory: getHistoryFs,
  };
}

module.exports = { ...api, HISTORY_MAX, DATA_DIR, safeSeg, usePg };
