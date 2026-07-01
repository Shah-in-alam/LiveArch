'use strict';

/**
 * render.js — turn a stored snapshot into the viewer HTML, reusing the exact
 * same diagram template as the CLI (in "snapshot" mode: no live watcher).
 */

const template = require('../../lib/template');

function renderViewer(snapshot) {
  const arch = snapshot && snapshot.arch;
  if (!arch) return null;
  return template.render(arch, { snapshot: true });
}

module.exports = { renderViewer };
