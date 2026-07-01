'use strict';

/**
 * projects.js — project ownership, visibility, and access control (Phase 3).
 *
 * A project's metadata (owner + visibility) lives next to its snapshot as
 * `<slug>.meta.json`. Ownership is proved by a token whose SHA-256 hash is
 * stored (the raw token is never persisted).
 *
 * Policy:
 *  - First write with a token → creates the project, that token is the owner
 *    (visibility per `--private`, default public).
 *  - First write with NO token → open project (no owner), anyone can write —
 *    convenient for local dev.
 *  - Later writes to an owned project require the owner token, else 403.
 *  - Reads: public → anyone; private → owner token only.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, safeSeg } = require('./store');

function metaFile(handle, slug) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return null;
  return path.join(DATA_DIR, h, s + '.meta.json');
}

function hash(token) {
  return token ? crypto.createHash('sha256').update(String(token)).digest('hex') : null;
}

function getMeta(handle, slug) {
  const f = metaFile(handle, slug);
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function saveMeta(handle, slug, meta) {
  const f = metaFile(handle, slug);
  if (!f) throw new Error('invalid handle/slug');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(meta));
}

/** Authorize (and record) a write. Throws Error{code:'FORBIDDEN'} if not owner. */
function authorizeWrite(handle, slug, token, opts = {}) {
  let meta = getMeta(handle, slug);
  if (!meta) {
    meta = { ownerHash: hash(token), visibility: opts.private ? 'private' : 'public', createdAt: Date.now() };
    saveMeta(handle, slug, meta);
    return { created: true, meta };
  }
  if (meta.ownerHash && meta.ownerHash !== hash(token)) {
    const e = new Error('you are not the owner of this project');
    e.code = 'FORBIDDEN';
    throw e;
  }
  if (opts.private !== undefined) meta.visibility = opts.private ? 'private' : 'public';
  saveMeta(handle, slug, meta);
  return { created: false, meta };
}

/** Can this token read the project? */
function canRead(handle, slug, token) {
  const meta = getMeta(handle, slug);
  if (!meta) return true;                 // no metadata → treat as public/open
  if (meta.visibility === 'public') return true;
  return !!(meta.ownerHash && meta.ownerHash === hash(token));
}

module.exports = { getMeta, saveMeta, authorizeWrite, canRead, hash };
