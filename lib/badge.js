'use strict';

/**
 * badge.js — generate a self-contained SVG badge summarising the architecture,
 * embeddable in a README (shields.io-style).
 */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * @param {object} arch  arch object from analyser.analyse().
 * @param {object} [opts]
 * @param {string} [opts.label='architecture']
 * @param {string} [opts.color='#5b8def']
 * @returns {string} SVG markup.
 */
function badgeSvg(arch, opts = {}) {
  const label = opts.label || 'architecture';
  const color = opts.color || '#5b8def';
  const value = arch.nodes.length + ' nodes';
  // rough width estimate (6.2px/char + padding)
  const lw = Math.round(label.length * 6.4 + 24);
  const vw = Math.round(value.length * 6.4 + 22);
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#333"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${esc(color)}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14">⬡ ${esc(label)}</text>
    <text x="${lw + vw / 2}" y="14">${esc(value)}</text>
  </g>
</svg>`;
}

/** Markdown snippet embedding the badge (path relative to the README). */
function badgeMarkdown(file = 'docs/architecture-badge.svg') {
  return `![Architecture](${file})`;
}

module.exports = { badgeSvg, badgeMarkdown };
