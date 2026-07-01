'use strict';

/**
 * heuristics.js — a free, offline "Preview" of the AI architecture review.
 *
 * Produces suggestions from the architecture graph using rules (no LLM). The
 * full Pro review (lib/ai/reviewer.js) sends the graph to Claude for far
 * richer, context-aware analysis; this preview lets users see the experience
 * without an API key.
 */

/** Find one dependency cycle among import edges, or null. Returns id[] path. */
function findImportCycle(nodes, edges) {
  const adj = new Map();
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (e.label !== 'imports') continue;
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const parent = new Map();
  let cycle = null;

  function dfs(u) {
    color.set(u, GRAY);
    for (const v of adj.get(u) || []) {
      if (cycle) return;
      const c = color.get(v) || WHITE;
      if (c === WHITE) { parent.set(v, u); dfs(v); }
      else if (c === GRAY) {
        // back edge u→v: walk parents from u back to v (each node once)
        const path = [];
        let p = u;
        while (p !== v) { path.push(p); p = parent.get(p); }
        path.push(v);
        cycle = path.reverse(); // v … u  (no repeated node)
        return;
      }
    }
    color.set(u, BLACK);
  }
  for (const n of nodes) {
    if (cycle) break;
    if ((color.get(n.id) || WHITE) === WHITE) dfs(n.id);
  }
  return cycle;
}

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
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const label = (id) => (byId.get(id) ? byId.get(id).label : id);
  const has = (t) => (byType[t] || []).length > 0;

  // Connection counts (total, in, out).
  const deg = {}, indeg = {};
  for (const n of nodes) { deg[n.id] = 0; indeg[n.id] = 0; }
  for (const e of edges) {
    if (deg[e.from] != null) deg[e.from]++;
    if (deg[e.to] != null) { deg[e.to]++; indeg[e.to]++; }
  }

  // 1) Over-connected component — likely doing too much.
  const components = nodes.filter((n) => n.type === 'component' || n.type === 'page');
  const busiest = components.slice().sort((a, b) => deg[b.id] - deg[a.id])[0];
  if (busiest && deg[busiest.id] >= 6) {
    out.push({
      severity: 'warning', node: busiest.id,
      message: `${busiest.label} has ${deg[busiest.id]} connections — it may be doing too much.`,
      suggestion: `Consider splitting ${busiest.label} into smaller, focused components.`,
    });
  }

  // 2) Circular dependency among imports.
  const cycle = findImportCycle(nodes, edges);
  if (cycle && cycle.length >= 2) {
    const path = cycle.map(label);
    // show as A → B → … → A
    const shown = path.concat(path[0]).join(' → ');
    out.push({
      severity: 'warning', node: cycle[0],
      message: `Circular dependency: ${shown}.`,
      suggestion: 'Break the cycle — extract the shared piece into its own module, or invert a dependency.',
    });
  }

  // 3) A "hub" module many others depend on — high-risk to change.
  const hub = nodes.slice().sort((a, b) => indeg[b.id] - indeg[a.id])[0];
  if (hub && indeg[hub.id] >= 8) {
    out.push({
      severity: 'info', node: hub.id,
      message: `${hub.label} is depended on by ${indeg[hub.id]} modules — a change here is high-risk.`,
      suggestion: 'Keep its interface stable and well-tested; avoid unrelated changes.',
    });
  }

  // auth detection — a real auth dep, or a component/file that mentions auth.
  const authIds = new Set(['dep-auth', 'dep-clerk', 'dep-auth0']);
  const hasAuth = nodes.some((n) => authIds.has(n.id) || /\bauth|login|session|jwt\b/i.test((n.label || '') + ' ' + (n.file || '')));

  // 4) No authentication layer despite a backend/API.
  if (!hasAuth && (has('backend') || has('route'))) {
    out.push({
      severity: 'info', node: '',
      message: 'No authentication layer detected, but there is a backend/API.',
      suggestion: 'If these routes need protection, add auth (JWT, Clerk, Auth0, …).',
    });
  }

  // 5) Payments present but no authentication — a security smell.
  const hasPayments = nodes.some((n) => n.id === 'dep-stripe' || n.id === 'dep-paypal');
  if (hasPayments && !hasAuth) {
    out.push({
      severity: 'warning', node: '',
      message: 'Payment integration detected without any authentication layer.',
      suggestion: 'Payment endpoints should sit behind authentication — add an auth layer.',
    });
  }

  // 6) Backend present but no database.
  if ((has('backend') || has('route')) && !has('database')) {
    out.push({
      severity: 'info', node: '',
      message: 'Backend/API present but no database was detected.',
      suggestion: 'If the API persists data, wire in a database (Postgres, Prisma, …) so it appears here.',
    });
  }

  // 7) An ORM is present but no models/schema were found.
  const hasOrm = nodes.some((n) => ['dep-prisma', 'dep-sequelize', 'dep-typeorm', 'dep-drizzle', 'dep-mongo'].includes(n.id));
  if (hasOrm && !has('model')) {
    out.push({
      severity: 'info', node: '',
      message: 'A database ORM is present but no data models/schema were detected.',
      suggestion: 'Add your models (e.g. schema.prisma or a models/ folder) so the data layer is visible.',
    });
  }

  // 8) Multiple frontend framework FAMILIES — a migration/tech-debt signal.
  //    (Next.js is React, Nuxt is Vue — those pairs are normal, not a smell.)
  const FAMILY = { 'dep-react': 'React', 'dep-next': 'React', 'dep-vue': 'Vue', 'dep-nuxt': 'Vue', 'dep-angular': 'Angular', 'dep-svelte': 'Svelte' };
  const families = new Set((byType.framework || []).map((n) => FAMILY[n.id]).filter(Boolean));
  if (families.size >= 2) {
    out.push({
      severity: 'warning', node: '',
      message: `Multiple frontend frameworks detected (${[...families].join(', ')}).`,
      suggestion: 'Two frameworks usually means an in-progress migration or accidental duplication — consolidate if you can.',
    });
  }

  // 9) Many components but no central state management.
  const compCount = (byType.component || []).length;
  if (compCount >= 15 && !has('state')) {
    out.push({
      severity: 'info', node: '',
      message: `${compCount} components but no central state management.`,
      suggestion: 'For shared state across this many components, consider Redux, Zustand, or React Context.',
    });
  }

  // 10) Isolated nodes — not connected to anything.
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

module.exports = { heuristicReview, findImportCycle };
