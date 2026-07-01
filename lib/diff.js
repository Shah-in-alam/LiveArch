'use strict';

/**
 * diff.js — compare two architecture graphs (e.g. two git branches).
 */

/**
 * Diff two arch objects.
 * @returns {{addedNodes, removedNodes, addedEdges, removedEdges, baseName, headName, counts}}
 */
function diffArch(base, head) {
  const baseNodes = new Map((base.nodes || []).map((n) => [n.id, n]));
  const headNodes = new Map((head.nodes || []).map((n) => [n.id, n]));

  const addedNodes = [...headNodes.values()].filter((n) => !baseNodes.has(n.id));
  const removedNodes = [...baseNodes.values()].filter((n) => !headNodes.has(n.id));

  const edgeKey = (e) => e.from + '→' + e.to;
  const baseEdges = new Map((base.edges || []).map((e) => [edgeKey(e), e]));
  const headEdges = new Map((head.edges || []).map((e) => [edgeKey(e), e]));

  const addedEdges = [...headEdges.entries()].filter(([k]) => !baseEdges.has(k)).map(([, e]) => e);
  const removedEdges = [...baseEdges.entries()].filter(([k]) => !headEdges.has(k)).map(([, e]) => e);

  return {
    baseName: base.name,
    headName: head.name,
    addedNodes, removedNodes, addedEdges, removedEdges,
    counts: {
      base: { nodes: base.nodes.length, edges: base.edges.length },
      head: { nodes: head.nodes.length, edges: head.edges.length },
    },
  };
}

/** Human-readable diff report. `labels` maps id → label for edge endpoints. */
function formatDiff(diff, baseRef, headRef) {
  const lines = [];
  const l = (n) => (n.icon ? n.icon + ' ' : '') + n.label + (n.file ? '  (' + n.file + ')' : '');
  lines.push(`⬡  Architecture diff: ${baseRef} → ${headRef}`);
  lines.push(`   nodes ${diff.counts.base.nodes} → ${diff.counts.head.nodes}` +
    `   edges ${diff.counts.base.edges} → ${diff.counts.head.edges}`);
  lines.push('');
  if (!diff.addedNodes.length && !diff.removedNodes.length && !diff.addedEdges.length && !diff.removedEdges.length) {
    lines.push('✓ No architectural changes.');
    return lines.join('\n');
  }
  if (diff.addedNodes.length) {
    lines.push(`＋ Added nodes (${diff.addedNodes.length}):`);
    for (const n of diff.addedNodes) lines.push('   + ' + l(n));
    lines.push('');
  }
  if (diff.removedNodes.length) {
    lines.push(`－ Removed nodes (${diff.removedNodes.length}):`);
    for (const n of diff.removedNodes) lines.push('   - ' + l(n));
    lines.push('');
  }
  if (diff.addedEdges.length) lines.push(`＋ ${diff.addedEdges.length} new connection(s)`);
  if (diff.removedEdges.length) lines.push(`－ ${diff.removedEdges.length} removed connection(s)`);
  return lines.join('\n').trimEnd();
}

module.exports = { diffArch, formatDiff };
