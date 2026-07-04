'use strict';

/**
 * projects.js — project ownership, visibility, and access control (Phase 3).
 *
 * Two ownership models, checked in order:
 *
 *  1. Account handle ownership (accounts.js). Once an account claims a `handle`
 *     (via `livearch login`), only that account's tokens may write any project
 *     under it. Private projects are readable only by the owning account.
 *
 *  2. Legacy per-project token (kept for anonymous local dev and back-compat):
 *     a project's `<slug>.meta.json` records the SHA-256 hash of the first
 *     token that wrote it; later writes need the same token. No token → open.
 *
 * The raw token is never persisted — only its hash.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, safeSeg } = require('./store');
const accounts = require('./accounts');

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
  const existed = !!getMeta(handle, slug);
  const handleOwner = accounts.getHandleOwner(handle); // account id, or null

  // 1. Account handle ownership takes precedence once a handle is claimed.
  if (handleOwner) {
    const account = accounts.resolveToken(token);
    if (!account || account.id !== handleOwner) {
      const e = new Error('this handle belongs to another account');
      e.code = 'FORBIDDEN';
      throw e;
    }
    const meta = getMeta(handle, slug) || { createdAt: Date.now() };
    meta.ownerAccountId = handleOwner;
    if (opts.private !== undefined) meta.visibility = opts.private ? 'private' : 'public';
    else if (!meta.visibility) meta.visibility = 'public';
    saveMeta(handle, slug, meta);
    return { created: !existed, meta, account };
  }

  // 2. Legacy per-project token model (anonymous dev / unclaimed handles).
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
  // private: account-owned projects are readable by the owning account;
  // legacy projects by the matching owner-token hash.
  if (meta.ownerAccountId) {
    const account = accounts.resolveToken(token);
    return !!(account && account.id === meta.ownerAccountId);
  }
  return !!(meta.ownerHash && meta.ownerHash === hash(token));
}

module.exports = { getMeta, saveMeta, authorizeWrite, canRead, hash };
