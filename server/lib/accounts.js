'use strict';

/**
 * accounts.js — user accounts, scoped API tokens, and handle ownership
 * (Phase 3 of docs/BACKEND-DESIGN.md).
 *
 * This is the filesystem-backed implementation used for local dev and small
 * self-hosting. The shape deliberately mirrors the Postgres data model in the
 * design doc (users / api_tokens / handle → owner), so swapping the storage for
 * Neon Postgres later is a drop-in — the route handlers and CLI don't change.
 *
 * Layout under DATA_DIR:
 *   _accounts/<id>.json        { id, handle, email, provider, createdAt }
 *   _tokens/<tokenHash>.json   { accountId, name, createdAt, lastUsedAt }
 *   _handles/<handle>.json     { ownerAccountId, createdAt }
 *
 * A token is a random secret shown to the user exactly once; only its SHA-256
 * hash is stored. A handle (the `<handle>` in /u/<handle>/<slug>) is claimed by
 * the first account that registers it, and thereafter only that account may
 * write projects under it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, safeSeg } = require('./store');

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

/** Basic email sanity check (storage only — no email is ever sent). */
function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function handleFile(handle) {
  const h = safeSeg(handle);
  return h ? path.join(HANDLES_DIR, h + '.json') : null;
}

/** The account id that owns a handle, or null if unclaimed. */
function getHandleOwner(handle) {
  const f = handleFile(handle);
  if (!f) return null;
  const rec = readJSON(f);
  return rec && rec.ownerAccountId ? rec.ownerAccountId : null;
}

function getAccount(accountId) {
  if (!accountId) return null;
  return readJSON(path.join(ACCOUNTS_DIR, accountId + '.json'));
}

/** Issue a fresh token for an account. Returns the raw token (store the hash). */
function issueToken(accountId, name = 'default') {
  const token = 'la_' + crypto.randomBytes(24).toString('hex');
  writeJSON(path.join(TOKENS_DIR, hash(token) + '.json'), {
    accountId, name: String(name).slice(0, 60), createdAt: Date.now(), lastUsedAt: null,
  });
  return token;
}

/** Resolve a raw token to its account, recording last-used. Null if unknown. */
function resolveToken(token) {
  if (!token) return null;
  const f = path.join(TOKENS_DIR, hash(token) + '.json');
  const rec = readJSON(f);
  if (!rec) return null;
  rec.lastUsedAt = Date.now();
  try { writeJSON(f, rec); } catch { /* best-effort */ }
  return getAccount(rec.accountId);
}

/** List an account's tokens (metadata only — never the secret). */
function listTokens(accountId) {
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

/** Revoke a token by its hash (only if it belongs to the account). */
function revokeToken(accountId, tokenHash) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash || '')) return false;
  const f = path.join(TOKENS_DIR, tokenHash + '.json');
  const rec = readJSON(f);
  if (!rec || rec.accountId !== accountId) return false;
  try { fs.rmSync(f); return true; } catch { return false; }
}

/**
 * Register a new account, claiming `handle`. Returns { account, token }.
 * Throws Error{code} for 'BAD_HANDLE' | 'BAD_EMAIL' | 'HANDLE_TAKEN'.
 */
function createAccount({ handle, email, provider = 'token', providerId = null }) {
  const h = safeSeg(handle);
  if (!h) { const e = new Error('handle must be 1–64 chars: a–z, 0–9, . _ -'); e.code = 'BAD_HANDLE'; throw e; }
  if (email !== undefined && email !== null && email !== '' && !validEmail(email)) {
    const e = new Error('invalid email'); e.code = 'BAD_EMAIL'; throw e;
  }
  if (getHandleOwner(h)) { const e = new Error(`handle "${h}" is already taken`); e.code = 'HANDLE_TAKEN'; throw e; }

  const id = crypto.randomBytes(12).toString('hex');
  const account = { id, handle: h, email: email || null, provider, providerId, createdAt: Date.now() };
  writeJSON(path.join(ACCOUNTS_DIR, id + '.json'), account);
  writeJSON(handleFile(h), { ownerAccountId: id, createdAt: Date.now() });
  const token = issueToken(id, 'cli');
  return { account, token };
}

/** Find an account by an OAuth provider identity (e.g. github:12345). */
function findByProvider(provider, providerId) {
  let names;
  try { names = fs.readdirSync(ACCOUNTS_DIR); } catch { return null; }
  for (const n of names) {
    const acc = readJSON(path.join(ACCOUNTS_DIR, n));
    if (acc && acc.provider === provider && acc.providerId != null && String(acc.providerId) === String(providerId)) return acc;
  }
  return null;
}

module.exports = {
  hash, createAccount, resolveToken, getAccount, getHandleOwner,
  issueToken, listTokens, revokeToken, findByProvider, validEmail,
  ACCOUNTS_DIR, TOKENS_DIR, HANDLES_DIR,
};
