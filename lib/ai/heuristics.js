'use strict';

/**
 * heuristics.js — a free, offline "Preview" of the AI architecture review.
 *
 * Produces suggestions from the architecture graph using simple rules (no LLM).
 * The full Pro review (lib/ai/reviewer.js) sends the graph to Claude for far
 * richer, context-aware analysis; this preview lets users see the experience
 * without an API key.
 */

/**
 * @param {object} arch  arch object from analyser.analyse().
 * @returns {object[]} suggestions [{severity, node, message, suggestion}]
 */
function heuristicReview(arch) {
  const nodes = arch.nodes || [];
  const edges = arch.edges || [];
  const out = [];
  const byType = {};
  for (const n of nodes) (byType[n.type] ||= []).push(n);
  const has = (t) => (byType[t] || []).length > 0;

  // Node connection counts.
  const deg = {};
  for (const n of nodes) deg[n.id] = 0;
  for (const e of edges) { if (deg[e.from] != null) deg[e.from]++; if (deg[e.to] != null) deg[e.to]++; }

  // 1) Over-connected component — likely doing too much.
  const components = nodes.filter((n) => n.type === 'component' || n.type === 'page');
  const busiest = components.slice().sort((a, b) => deg[b.id] - deg[a.id])[0];
  if (busiest && deg[busiest.id] >= 6) {
    out.push({
      severity: 'warning',
      node: busiest.id,
      message: `${busiest.label} has ${deg[busiest.id]} connections — it may be doing too much.`,
      suggestion: `Consider splitting ${busiest.label} into smaller, focused components.`,
    });
  }

  // 2) No authentication layer despite having a backend/API.
  const authIds = new Set(['dep-auth', 'dep-clerk', 'dep-auth0']);
  const hasAuth = nodes.some((n) => authIds.has(n.id));
  if (!hasAuth && (has('backend') || has('route'))) {
    out.push({
      severity: 'info', node: '',
      message: 'No authentication layer detected, but there is a backend/API.',
      suggestion: 'If these routes need protection, add auth (JWT, Clerk, Auth0, …).',
    });
  }

  // 3) Backend present but no database.
  if ((has('backend') || has('route')) && !has('database')) {
    out.push({
      severity: 'info', node: '',
      message: 'Backend/API present but no database was detected.',
      suggestion: 'If the API persists data, wire in a database (Postgres, Prisma, …) so it appears here.',
    });
  }

  // 4) Many components but no central state management.
  const compCount = (byType.component || []).length;
  const hasState = has('state');
  if (compCount >= 15 && !hasState) {
    out.push({
      severity: 'info', node: '',
      message: `${compCount} components but no central state management.`,
      suggestion: 'For shared state across this many components, consider Redux, Zustand, or React Context.',
    });
  }

  // 5) Isolated nodes — not connected to anything.
  const isolated = nodes.filter((n) => deg[n.id] === 0 && n.type !== 'tooling' && n.type !== 'framework');
  if (isolated.length >= 3) {
    out.push({
      severity: 'info', node: isolated[0].id,
      message: `${isolated.length} nodes have no detected connections (e.g. ${isolated.slice(0, 3).map((n) => n.label).join(', ')}).`,
      suggestion: 'These may be dead code, or use import paths LiveArch cannot resolve yet (aliases).',
    });
  }

  return out;
}

module.exports = { heuristicReview };
