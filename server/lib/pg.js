'use strict';

/**
 * pg.js — Postgres backend for the hosted server (Neon-ready).
 *
 * Activated when DATABASE_URL is set; otherwise the filesystem backend is used
 * (see store.js / accounts.js / projects.js, which dispatch to this module).
 * All functions are async and mirror the filesystem API 1:1, so the routes and
 * CLI are backend-agnostic.
 *
 * Driver: `@neondatabase/serverless` (Pool is node-postgres compatible). The
 * code only depends on the `pool.query(text, params) → { rows }` contract, so
 * tests inject an in-memory Postgres (pg-mem) via setPool().
 */

const crypto = require('crypto');
const { safeSeg } = require('./segments');

const HISTORY_MAX = 20;

let _pool = null;

/** Override the pool (used by tests to inject pg-mem). */
function setPool(pool) { _pool = pool; }

/** Lazily create the Neon pool from DATABASE_URL (never at module load). */
function getPool() {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Lazy require so the driver is only needed when Postgres is actually used.
  const { Pool } = require('@neondatabase/serverless');
  _pool = new Pool({ connectionString: url });
  return _pool;
}

function q(text, params) {
  return getPool().query(text, params);
}

let _inited = null;
/** Create tables if missing. Idempotent; runs once per process. */
async function init() {
  if (_inited) return _inited;
  _inited = (async () => {
    await q(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      handle TEXT UNIQUE NOT NULL,
      email TEXT,
      provider TEXT NOT NULL DEFAULT 'token',
      provider_id TEXT,
      created_at BIGINT NOT NULL
    )`);
    await q(`CREATE TABLE IF NOT EXISTS api_tokens (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT,
      created_at BIGINT NOT NULL,
      last_used_at BIGINT
    )`);
    await q(`CREATE TABLE IF NOT EXISTS projects (
      handle TEXT NOT NULL,
      slug TEXT NOT NULL,
      owner_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      owner_hash TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      created_at BIGINT NOT NULL,
      PRIMARY KEY (handle, slug)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS snapshots (
      handle TEXT NOT NULL,
      slug TEXT NOT NULL,
      arch JSONB NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (handle, slug)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS snapshot_history (
      id BIGSERIAL PRIMARY KEY,
      handle TEXT NOT NULL,
      slug TEXT NOT NULL,
      arch JSONB NOT NULL,
      at BIGINT NOT NULL
    )`);
    await q(`CREATE INDEX IF NOT EXISTS idx_history_project ON snapshot_history (handle, slug, at DESC)`);
  })();
  return _inited;
}

function hash(token) {
  return token ? crypto.createHash('sha256').update(String(token)).digest('hex') : null;
}
function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function rowToAccount(r) {
  return r ? { id: r.id, handle: r.handle, email: r.email, provider: r.provider, providerId: r.provider_id, createdAt: Number(r.created_at) } : null;
}

// --- snapshots ------------------------------------------------------------
async function saveSnapshot(handle, slug, arch) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) throw new Error('invalid handle/slug');
  await init();
  await q(
    `INSERT INTO snapshots (handle, slug, arch, updated_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (handle, slug) DO UPDATE SET arch = EXCLUDED.arch, updated_at = EXCLUDED.updated_at`,
    [h, s, JSON.stringify(arch), Date.now()]
  );
  return { handle: h, slug: s };
}

async function getSnapshot(handle, slug) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return null;
  await init();
  const { rows } = await q(`SELECT arch, updated_at FROM snapshots WHERE handle=$1 AND slug=$2`, [h, s]);
  if (!rows.length) return null;
  const arch = typeof rows[0].arch === 'string' ? JSON.parse(rows[0].arch) : rows[0].arch;
  return { arch, updatedAt: Number(rows[0].updated_at) };
}

async function appendHistory(handle, slug, arch) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return;
  await init();
  await q(`INSERT INTO snapshot_history (handle, slug, arch, at) VALUES ($1,$2,$3,$4)`,
    [h, s, JSON.stringify(arch), Date.now()]);
  // Trim to the newest HISTORY_MAX for this project.
  await q(
    `DELETE FROM snapshot_history WHERE handle=$1 AND slug=$2 AND id NOT IN (
       SELECT id FROM snapshot_history WHERE handle=$1 AND slug=$2 ORDER BY at DESC, id DESC LIMIT $3
     )`,
    [h, s, HISTORY_MAX]
  );
}

async function getHistory(handle, slug) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return [];
  await init();
  const { rows } = await q(
    `SELECT arch, at FROM snapshot_history WHERE handle=$1 AND slug=$2 ORDER BY at DESC, id DESC LIMIT $3`,
    [h, s, HISTORY_MAX]
  );
  return rows.map((r) => ({ arch: typeof r.arch === 'string' ? JSON.parse(r.arch) : r.arch, at: Number(r.at) }));
}

// --- accounts & tokens ----------------------------------------------------
async function issueToken(accountId, name = 'default') {
  await init();
  const token = 'la_' + crypto.randomBytes(24).toString('hex');
  await q(`INSERT INTO api_tokens (token_hash, account_id, name, created_at, last_used_at) VALUES ($1,$2,$3,$4,NULL)`,
    [hash(token), accountId, String(name).slice(0, 60), Date.now()]);
  return token;
}

async function getAccount(accountId) {
  if (!accountId) return null;
  await init();
  const { rows } = await q(`SELECT * FROM accounts WHERE id=$1`, [accountId]);
  return rowToAccount(rows[0]);
}

async function resolveToken(token) {
  if (!token) return null;
  await init();
  const { rows } = await q(
    `SELECT a.* FROM api_tokens t JOIN accounts a ON a.id = t.account_id WHERE t.token_hash=$1`,
    [hash(token)]
  );
  if (!rows.length) return null;
  await q(`UPDATE api_tokens SET last_used_at=$1 WHERE token_hash=$2`, [Date.now(), hash(token)]);
  return rowToAccount(rows[0]);
}

async function getHandleOwner(handle) {
  const h = safeSeg(handle);
  if (!h) return null;
  await init();
  const { rows } = await q(`SELECT id FROM accounts WHERE handle=$1`, [h]);
  return rows.length ? rows[0].id : null;
}

async function listTokens(accountId) {
  await init();
  const { rows } = await q(
    `SELECT token_hash, name, created_at, last_used_at FROM api_tokens WHERE account_id=$1 ORDER BY created_at ASC`,
    [accountId]
  );
  return rows.map((r) => ({ tokenHash: r.token_hash, name: r.name, createdAt: Number(r.created_at), lastUsedAt: r.last_used_at == null ? null : Number(r.last_used_at) }));
}

async function revokeToken(accountId, tokenHash) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash || '')) return false;
  await init();
  const { rows } = await q(`DELETE FROM api_tokens WHERE token_hash=$1 AND account_id=$2 RETURNING token_hash`, [tokenHash, accountId]);
  return rows.length > 0;
}

async function createAccount({ handle, email, provider = 'token', providerId = null }) {
  const h = safeSeg(handle);
  if (!h) { const e = new Error('handle must be 1–64 chars: a–z, 0–9, . _ -'); e.code = 'BAD_HANDLE'; throw e; }
  if (email !== undefined && email !== null && email !== '' && !validEmail(email)) {
    const e = new Error('invalid email'); e.code = 'BAD_EMAIL'; throw e;
  }
  await init();
  if (await getHandleOwner(h)) { const e = new Error(`handle "${h}" is already taken`); e.code = 'HANDLE_TAKEN'; throw e; }
  const id = crypto.randomBytes(12).toString('hex');
  const createdAt = Date.now();
  await q(`INSERT INTO accounts (id, handle, email, provider, provider_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, h, email || null, provider, providerId, createdAt]);
  const token = await issueToken(id, 'cli');
  return { account: { id, handle: h, email: email || null, provider, providerId, createdAt }, token };
}

async function findByProvider(provider, providerId) {
  if (providerId == null) return null;
  await init();
  const { rows } = await q(`SELECT * FROM accounts WHERE provider=$1 AND provider_id=$2`, [provider, String(providerId)]);
  return rowToAccount(rows[0]);
}

// --- project meta & access control ---------------------------------------
async function getMeta(handle, slug) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return null;
  await init();
  const { rows } = await q(`SELECT owner_account_id, owner_hash, visibility, created_at FROM projects WHERE handle=$1 AND slug=$2`, [h, s]);
  if (!rows.length) return null;
  const r = rows[0];
  const meta = { visibility: r.visibility, createdAt: Number(r.created_at) };
  if (r.owner_account_id) meta.ownerAccountId = r.owner_account_id;
  if (r.owner_hash) meta.ownerHash = r.owner_hash;
  return meta;
}

async function saveMeta(handle, slug, meta) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) throw new Error('invalid handle/slug');
  await init();
  await q(
    `INSERT INTO projects (handle, slug, owner_account_id, owner_hash, visibility, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (handle, slug) DO UPDATE SET
       owner_account_id = EXCLUDED.owner_account_id,
       owner_hash = EXCLUDED.owner_hash,
       visibility = EXCLUDED.visibility`,
    [h, s, meta.ownerAccountId || null, meta.ownerHash || null, meta.visibility || 'public', meta.createdAt || Date.now()]
  );
}

async function authorizeWrite(handle, slug, token, opts = {}) {
  await init();
  const existed = !!(await getMeta(handle, slug));
  const handleOwner = await getHandleOwner(handle);

  if (handleOwner) {
    const account = await resolveToken(token);
    if (!account || account.id !== handleOwner) {
      const e = new Error('this handle belongs to another account'); e.code = 'FORBIDDEN'; throw e;
    }
    const meta = (await getMeta(handle, slug)) || { createdAt: Date.now() };
    meta.ownerAccountId = handleOwner;
    if (opts.private !== undefined) meta.visibility = opts.private ? 'private' : 'public';
    else if (!meta.visibility) meta.visibility = 'public';
    await saveMeta(handle, slug, meta);
    return { created: !existed, meta, account };
  }

  let meta = await getMeta(handle, slug);
  if (!meta) {
    meta = { ownerHash: hash(token), visibility: opts.private ? 'private' : 'public', createdAt: Date.now() };
    await saveMeta(handle, slug, meta);
    return { created: true, meta };
  }
  if (meta.ownerHash && meta.ownerHash !== hash(token)) {
    const e = new Error('you are not the owner of this project'); e.code = 'FORBIDDEN'; throw e;
  }
  if (opts.private !== undefined) meta.visibility = opts.private ? 'private' : 'public';
  await saveMeta(handle, slug, meta);
  return { created: false, meta };
}

async function canRead(handle, slug, token) {
  await init();
  const meta = await getMeta(handle, slug);
  if (!meta) return true;
  if (meta.visibility === 'public') return true;
  if (meta.ownerAccountId) {
    const account = await resolveToken(token);
    return !!(account && account.id === meta.ownerAccountId);
  }
  return !!(meta.ownerHash && meta.ownerHash === hash(token));
}

module.exports = {
  setPool, getPool, init, HISTORY_MAX, hash, safeSeg,
  saveSnapshot, getSnapshot, appendHistory, getHistory,
  createAccount, resolveToken, getAccount, getHandleOwner,
  issueToken, listTokens, revokeToken, findByProvider, validEmail,
  getMeta, saveMeta, authorizeWrite, canRead,
};
