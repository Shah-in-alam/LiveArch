'use strict';

/**
 * accounts.js — user accounts, scoped API tokens, and handle ownership
 * (Phase 3 of docs/BACKEND-DESIGN.md).
 *
 * Two backends behind one async API: Postgres (Neon) when DATABASE_URL is set
 * (see pg.js), else a filesystem store under DATA_DIR. The filesystem layout
 * mirrors the Postgres data model (users / api_tokens / handle → owner), so
 * swapping backends is a drop-in — routes and CLI don't change.
 *
 * Filesystem layout under DATA_DIR:
 *   _accounts/<id>.json        { id, handle, email, provider, providerId, createdAt }
 *   _tokens/<tokenHash>.json   { accountId, name, createdAt, lastUsedAt }
 *   _handles/<handle>.json     { ownerAccountId, createdAt }
 *
 * A token is a random secret shown once; only its SHA-256 hash is stored. A
 * handle is claimed by the first account that registers it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeSeg } = require('./segments');
const { isPlan, DEFAULT_PLAN } = require('./plans');
const { DATA_DIR } = require('./store');

const ACCOUNTS_DIR = path.join(DATA_DIR, '_accounts');
const TOKENS_DIR = path.join(DATA_DIR, '_tokens');
const HANDLES_DIR = path.join(DATA_DIR, '_handles');

function hash(token) {
  return token ? crypto.createHash('sha256').update(String(token)).digest('hex') : null;
}
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}
function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function handleFile(handle) {
  const h = safeSeg(handle);
  return h ? path.join(HANDLES_DIR, h + '.json') : null;
}

// --- filesystem backend (async) ------------------------------------------
async function getHandleOwnerFs(handle) {
  const f = handleFile(handle);
  if (!f) return null;
  const rec = readJSON(f);
  return rec && rec.ownerAccountId ? rec.ownerAccountId : null;
}
async function getAccountFs(accountId) {
  if (!accountId) return null;
  return readJSON(path.join(ACCOUNTS_DIR, accountId + '.json'));
}
async function issueTokenFs(accountId, name = 'default') {
  const token = 'la_' + crypto.randomBytes(24).toString('hex');
  writeJSON(path.join(TOKENS_DIR, hash(token) + '.json'), {
    accountId, name: String(name).slice(0, 60), createdAt: Date.now(), lastUsedAt: null,
  });
  return token;
}
async function resolveTokenFs(token) {
  if (!token) return null;
  const f = path.join(TOKENS_DIR, hash(token) + '.json');
  const rec = readJSON(f);
  if (!rec) return null;
  rec.lastUsedAt = Date.now();
  try { writeJSON(f, rec); } catch { /* best-effort */ }
  return getAccountFs(rec.accountId);
}
async function listTokensFs(accountId) {
  let names;
  try { names = fs.readdirSync(TOKENS_DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const rec = readJSON(path.join(TOKENS_DIR, n));
    if (rec && rec.accountId === accountId) {
      out.push({ tokenHash: n.replace(/\.json$/, ''), name: rec.name, createdAt: rec.createdAt, lastUsedAt: rec.lastUsedAt });
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}
async function revokeTokenFs(accountId, tokenHash) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash || '')) return false;
  const f = path.join(TOKENS_DIR, tokenHash + '.json');
  const rec = readJSON(f);
  if (!rec || rec.accountId !== accountId) return false;
  try { fs.rmSync(f); return true; } catch { return false; }
}
async function createAccountFs({ handle, email, provider = 'token', providerId = null }) {
  const h = safeSeg(handle);
  if (!h) { const e = new Error('handle must be 1–64 chars: a–z, 0–9, . _ -'); e.code = 'BAD_HANDLE'; throw e; }
  if (email !== undefined && email !== null && email !== '' && !validEmail(email)) {
    const e = new Error('invalid email'); e.code = 'BAD_EMAIL'; throw e;
  }
  if (await getHandleOwnerFs(h)) { const e = new Error(`handle "${h}" is already taken`); e.code = 'HANDLE_TAKEN'; throw e; }
  const id = crypto.randomBytes(12).toString('hex');
  const account = { id, handle: h, email: email || null, provider, providerId, plan: DEFAULT_PLAN, createdAt: Date.now() };
  writeJSON(path.join(ACCOUNTS_DIR, id + '.json'), account);
  writeJSON(handleFile(h), { ownerAccountId: id, createdAt: Date.now() });
  const token = await issueTokenFs(id, 'cli');
  return { account, token };
}
async function setPlanFs(accountId, plan) {
  if (!isPlan(plan)) { const e = new Error('unknown plan: ' + plan); e.code = 'BAD_PLAN'; throw e; }
  const f = path.join(ACCOUNTS_DIR, accountId + '.json');
  const acc = readJSON(f);
  if (!acc) return null;
  acc.plan = plan;
  writeJSON(f, acc);
  return acc;
}
/** Count projects owned by an account (its handle dir's *.meta.json files). */
async function countProjectsFs(accountId) {
  const acc = await getAccountFs(accountId);
  if (!acc) return 0;
  const dir = path.join(DATA_DIR, acc.handle);
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    if (!name.endsWith('.meta.json')) continue;
    const meta = readJSON(path.join(dir, name));
    if (meta && meta.ownerAccountId === accountId) n++;
  }
  return n;
}
async function findByProviderFs(provider, providerId) {
  let names;
  try { names = fs.readdirSync(ACCOUNTS_DIR); } catch { return null; }
  for (const n of names) {
    const acc = readJSON(path.join(ACCOUNTS_DIR, n));
    if (acc && acc.provider === provider && acc.providerId != null && String(acc.providerId) === String(providerId)) return acc;
  }
  return null;
}

// --- backend selection ----------------------------------------------------
const usePg = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
let api;
if (usePg) {
  const pg = require('./pg');
  api = {
    createAccount: pg.createAccount, resolveToken: pg.resolveToken, getAccount: pg.getAccount,
    getHandleOwner: pg.getHandleOwner, issueToken: pg.issueToken, listTokens: pg.listTokens,
    revokeToken: pg.revokeToken, findByProvider: pg.findByProvider,
    setPlan: pg.setPlan, countProjects: pg.countProjects,
  };
} else {
  api = {
    createAccount: createAccountFs, resolveToken: resolveTokenFs, getAccount: getAccountFs,
    getHandleOwner: getHandleOwnerFs, issueToken: issueTokenFs, listTokens: listTokensFs,
    revokeToken: revokeTokenFs, findByProvider: findByProviderFs,
    setPlan: setPlanFs, countProjects: countProjectsFs,
  };
}

module.exports = {
  ...api, hash, validEmail, usePg,
  ACCOUNTS_DIR, TOKENS_DIR, HANDLES_DIR,
};
