'use strict';

/**
 * diffs.js — pick two snapshots out of a project's history to compare.
 *
 * Pure (no I/O) so the selection logic is unit-tested; the route pairs it with
 * lib/diff.js (diffArch/formatDiff) and the stored history.
 *
 * `history` is newest-first: [{ arch, at, branch }, …].
 * Selection (in priority order):
 *   - { steps: N }            → head = latest, base = N pushes back
 *   - { base, head } branches → latest snapshot of each named branch
 *   - default                 → head = latest, base = previous push
 */
function resolveArchs(history, opts = {}) {
  if (!Array.isArray(history) || history.length === 0) {
    const e = new Error('no snapshots have been published for this project yet'); e.code = 'NO_DATA'; throw e;
  }
  const latest = (branch) => history.find((h) => h.branch === branch);

  // 1. revision diff — N pushes back
  const steps = Number(opts.steps);
  if (Number.isFinite(steps) && steps > 0) {
    if (history.length < 2) { const e = new Error('need at least two snapshots to diff'); e.code = 'NO_DATA'; throw e; }
    const baseIdx = Math.min(steps, history.length - 1);
    return {
      baseArch: history[baseIdx].arch, headArch: history[0].arch,
      baseLabel: `${baseIdx} push${baseIdx === 1 ? '' : 'es'} ago`, headLabel: 'latest',
    };
  }

  // 2. branch diff
  if (opts.base || opts.head) {
    const headEntry = opts.head ? latest(opts.head) : history[0];
    if (!headEntry) { const e = new Error(`no snapshot for branch "${opts.head}"`); e.code = 'REF_NOT_FOUND'; throw e; }
    const baseEntry = opts.base ? latest(opts.base) : history[1];
    if (!baseEntry) {
      const e = new Error(opts.base ? `no snapshot for branch "${opts.base}"` : 'need an earlier snapshot to diff');
      e.code = opts.base ? 'REF_NOT_FOUND' : 'NO_DATA'; throw e;
    }
    return {
      baseArch: baseEntry.arch, headArch: headEntry.arch,
      baseLabel: opts.base || baseEntry.branch, headLabel: opts.head || headEntry.branch,
    };
  }

  // 3. default — latest vs previous push
  if (history.length < 2) { const e = new Error('need at least two snapshots to diff'); e.code = 'NO_DATA'; throw e; }
  return {
    baseArch: history[1].arch, headArch: history[0].arch,
    baseLabel: 'previous', headLabel: 'latest',
  };
}

// Reuse the CLI's diff engine from the parent package's lib (via externalDir),
// so the route only depends on this one server/lib module.
const { diffArch, formatDiff } = require('../../lib/diff');

/**
 * Full server-side diff: pick two snapshots from `history` and diff them.
 * Returns { base, head, diff, text } ready to serialize.
 */
function computeDiff(history, opts = {}) {
  const { baseArch, headArch, baseLabel, headLabel } = resolveArchs(history, opts);
  const diff = diffArch(baseArch, headArch);
  return {
    base: baseLabel,
    head: headLabel,
    counts: diff.counts,
    addedNodes: diff.addedNodes,
    removedNodes: diff.removedNodes,
    addedEdges: diff.addedEdges,
    removedEdges: diff.removedEdges,
    text: formatDiff(diff, baseLabel, headLabel),
  };
}

module.exports = { resolveArchs, computeDiff };
