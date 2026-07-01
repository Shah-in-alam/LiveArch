'use strict';

/**
 * store.js — snapshot storage for the LiveArch hosted MVP.
 *
 * Phase 1 uses a simple filesystem JSON store (one file per project). This
 * works out of the box for `next dev` and small self-hosting. For production
 * on Vercel, swap these two functions for Neon Postgres / Vercel Blob (the
 * rest of the app doesn't care where snapshots live) — see docs/BACKEND-DESIGN.md.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.LIVEARCH_DATA_DIR || path.join(__dirname, '..', '.data');

/** Restrict to safe path segments (no traversal). Returns null if invalid. */
function safeSeg(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  return /^[a-z0-9._-]{1,64}$/.test(v) ? v : null;
}

function fileFor(handle, slug) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return null;
  return path.join(DATA_DIR, h, s + '.json');
}

/** Persist the latest snapshot for handle/slug. Returns { handle, slug }. */
function saveSnapshot(handle, slug, arch) {
  const f = fileFor(handle, slug);
  if (!f) throw new Error('invalid handle/slug');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ arch, updatedAt: Date.now() }));
  return { handle: safeSeg(handle), slug: safeSeg(slug) };
}

/** Read the latest snapshot for handle/slug, or null. */
function getSnapshot(handle, slug) {
  const f = fileFor(handle, slug);
  if (!f) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { saveSnapshot, getSnapshot, DATA_DIR, safeSeg };
