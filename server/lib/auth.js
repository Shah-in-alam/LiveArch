'use strict';

/**
 * auth.js — minimal ingest auth for the MVP.
 *
 * If LIVEARCH_INGEST_TOKEN is set, ingest requests must present it. If it is
 * unset (local dev), ingest is open. Production would replace this with scoped
 * per-user tokens resolved to a project (see docs/BACKEND-DESIGN.md).
 */
function checkToken(token) {
  const expected = process.env.LIVEARCH_INGEST_TOKEN;
  if (!expected) return true; // dev: no token required
  return token === expected;
}

module.exports = { checkToken };
