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
 *     a project's metadata records the SHA-256 hash of the first token that
 *     wrote it; later writes need the same token. No token → open.
 *
 * Backend is filesystem (`<slug>.meta.json`) or Postgres, selected by
 * DATABASE_URL. The raw token is never persisted — only its hash.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeSeg } = require('./segments');
const { planFor } = require('./plans');
const { DATA_DIR } = require('./store');
const accounts = require('./accounts');

function metaFile(handle, slug) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return null;
  return path.join(DATA_DIR, h, s + '.meta.json');
}
function membersFile(handle, slug) {
  const h = safeSeg(handle), s = safeSeg(slug);
  if (!h || !s) return null;
  return path.join(DATA_DIR, h, s + '.members.json');
}
function hash(token) {
  return token ? crypto.createHash('sha256').update(String(token)).digest('hex') : null;
}
function readMembers(handle, slug) {
  const f = membersFile(handle, slug);
  if (!f) return [];
  try { const l = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; }
}
function writeMembers(handle, slug, list) {
  const f = membersFile(handle, slug);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(list));
}

async function getMemberRoleFs(handle, slug, accountId) {
  if (!accountId) return null;
  const m = readMembers(handle, slug).find((x) => x.accountId === accountId);
  return m ? m.role : null;
}
async function addMemberFs(handle, slug, member, role) {
  const list = readMembers(handle, slug).filter((x) => x.accountId !== member.accountId);
  list.push({ accountId: member.accountId, handle: member.handle, role, addedAt: Date.now() });
  writeMembers(handle, slug, list);
}
async function removeMemberFs(handle, slug, memberAccountId) {
  const list = readMembers(handle, slug);
  const next = list.filter((x) => x.accountId !== memberAccountId);
  if (next.length === list.length) return false;
  writeMembers(handle, slug, next);
  return true;
}
async function listMembersFs(handle, slug) {
  return readMembers(handle, slug).sort((a, b) => a.addedAt - b.addedAt);
}

// --- filesystem backend (async) ------------------------------------------
async function getMetaFs(handle, slug) {
  const f = metaFile(handle, slug);
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
async function saveMetaFs(handle, slug, meta) {
  const f = metaFile(handle, slug);
  if (!f) throw new Error('invalid handle/slug');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(meta));
}

async function authorizeWriteFs(handle, slug, token, opts = {}) {
  const existed = !!(await getMetaFs(handle, slug));
  const handleOwner = await accounts.getHandleOwner(handle);

  // 1. Account handle ownership takes precedence once a handle is claimed.
  if (handleOwner) {
    const account = await accounts.resolveToken(token);
    if (!account) { const e = new Error('this handle belongs to another account'); e.code = 'FORBIDDEN'; throw e; }

    if (account.id === handleOwner) {
      const limits = planFor(account);
      // Plan gate: private projects require a paid plan.
      if (opts.private && !limits.privateProjects) {
        const e = new Error('private projects require the Pro plan — run `livearch upgrade --plan pro`');
        e.code = 'PLAN_REQUIRED'; throw e;
      }
      // Plan gate: cap the number of hosted projects on the Free plan.
      if (!existed && (await accounts.countProjects(account.id)) >= limits.maxProjects) {
        const e = new Error(`the ${limits.label} plan is limited to ${limits.maxProjects} hosted projects — run \`livearch upgrade --plan pro\``);
        e.code = 'PLAN_LIMIT'; throw e;
      }
      const meta = (await getMetaFs(handle, slug)) || { createdAt: Date.now() };
      meta.ownerAccountId = handleOwner;
      if (opts.private !== undefined) meta.visibility = opts.private ? 'private' : 'public';
      else if (!meta.visibility) meta.visibility = 'public';
      await saveMetaFs(handle, slug, meta);
      return { created: !existed, meta, account };
    }

    // Not the owner — a team member with write access may push to an existing project.
    const role = await getMemberRoleFs(handle, slug, account.id);
    if (existed && (role === 'member' || role === 'owner')) {
      const meta = await getMetaFs(handle, slug); // members don't change visibility
      await saveMetaFs(handle, slug, meta);
      return { created: false, meta, account, role };
    }
    const e = new Error('this handle belongs to another account'); e.code = 'FORBIDDEN'; throw e;
  }

  // 2. Legacy per-project token model (anonymous dev / unclaimed handles).
  let meta = await getMetaFs(handle, slug);
  if (!meta) {
    meta = { ownerHash: hash(token), visibility: opts.private ? 'private' : 'public', createdAt: Date.now() };
    await saveMetaFs(handle, slug, meta);
    return { created: true, meta };
  }
  if (meta.ownerHash && meta.ownerHash !== hash(token)) {
    const e = new Error('you are not the owner of this project');
    e.code = 'FORBIDDEN';
    throw e;
  }
  if (opts.private !== undefined) meta.visibility = opts.private ? 'private' : 'public';
  await saveMetaFs(handle, slug, meta);
  return { created: false, meta };
}

async function canReadFs(handle, slug, token) {
  const meta = await getMetaFs(handle, slug);
  if (!meta) return true;                 // no metadata → treat as public/open
  if (meta.visibility === 'public') return true;
  if (meta.ownerAccountId) {
    const account = await accounts.resolveToken(token);
    if (!account) return false;
    if (account.id === meta.ownerAccountId) return true;
    // team members (any role) can read a private project
    return (await getMemberRoleFs(handle, slug, account.id)) != null;
  }
  return !!(meta.ownerHash && meta.ownerHash === hash(token));
}

// --- backend selection ----------------------------------------------------
const usePg = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
let api;
if (usePg) {
  const pg = require('./pg');
  api = {
    getMeta: pg.getMeta, saveMeta: pg.saveMeta, authorizeWrite: pg.authorizeWrite, canRead: pg.canRead,
    getMemberRole: pg.getMemberRole, addMember: pg.addMember, removeMember: pg.removeMember, listMembers: pg.listMembers,
  };
} else {
  api = {
    getMeta: getMetaFs, saveMeta: saveMetaFs, authorizeWrite: authorizeWriteFs, canRead: canReadFs,
    getMemberRole: getMemberRoleFs, addMember: addMemberFs, removeMember: removeMemberFs, listMembers: listMembersFs,
  };
}

module.exports = { ...api, hash, usePg };
