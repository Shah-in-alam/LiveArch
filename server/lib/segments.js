'use strict';

/**
 * segments.js — shared path/id segment validation, used by both the filesystem
 * and Postgres backends. Kept dependency-free so either backend can require it
 * without a cycle.
 */

/** Restrict to a safe segment (handle/slug): 1–64 chars of [a-z0-9._-]. Null if invalid. */
function safeSeg(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().toLowerCase();
  return /^[a-z0-9._-]{1,64}$/.test(v) ? v : null;
}

module.exports = { safeSeg };
