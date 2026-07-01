'use strict';

/**
 * render.js — turn a stored snapshot into the viewer HTML, reusing the exact
 * same diagram template as the CLI. In hosted mode the viewer subscribes to a
 * Server-Sent Events stream for live updates.
 */

const template = require('../../lib/template');

function renderViewer(snapshot, opts = {}) {
  const arch = snapshot && snapshot.arch;
  if (!arch) return null;
  let streamUrl = null;
  if (opts.handle && opts.slug) {
    streamUrl = `/api/stream/${opts.handle}/${opts.slug}`;
    if (opts.token) streamUrl += '?token=' + encodeURIComponent(opts.token);
  }
  return template.render(arch, { snapshot: true, streamUrl });
}

module.exports = { renderViewer };
