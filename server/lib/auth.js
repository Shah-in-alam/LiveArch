'use strict';

/**
 * auth.js — request-level helpers for reading the caller's token/account.
 *
 * A token may arrive either as `Authorization: Bearer <token>` (preferred, used
 * by `livearch login`) or, for viewer links, as a `?token=` query param.
 */

const { resolveToken } = require('./accounts');

/** Extract a bearer token from the Authorization header, or '' if absent. */
function bearer(req) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : '';
}

/** The token from header first, then a ?token= query param (for viewer URLs). */
function tokenFrom(req) {
  const b = bearer(req);
  if (b) return b;
  try { return new URL(req.url).searchParams.get('token') || ''; } catch { return ''; }
}

/** Resolve the authenticated account for a request, or null (async). */
async function account(req) {
  return resolveToken(bearer(req));
}

module.exports = { bearer, tokenFrom, account };
