'use strict';

/**
 * plans.js — account plan tiers and their limits (Phase 3 monetisation).
 *
 * Dependency-free so every backend can import it without a cycle. Limits are
 * enforced server-side at the write path (see projects.authorizeWrite and the
 * ingest route); the CLI surfaces them and prompts an upgrade.
 */

const PLANS = {
  free: { name: 'free', label: 'Free', price: 0,  maxProjects: 3,        historyDepth: 5,  privateProjects: false, teams: false },
  pro:  { name: 'pro',  label: 'Pro',  price: 9,  maxProjects: Infinity, historyDepth: 20, privateProjects: true,  teams: false },
  team: { name: 'team', label: 'Team', price: 29, maxProjects: Infinity, historyDepth: 50, privateProjects: true,  teams: true },
};

const DEFAULT_PLAN = 'free';

/** The limits object for an account (defaults to Free for unknown/legacy). */
function planFor(account) {
  const name = (account && account.plan) || DEFAULT_PLAN;
  return PLANS[name] || PLANS[DEFAULT_PLAN];
}

/** Is `name` a real plan id? */
function isPlan(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(PLANS, name);
}

module.exports = { PLANS, DEFAULT_PLAN, planFor, isPlan };
