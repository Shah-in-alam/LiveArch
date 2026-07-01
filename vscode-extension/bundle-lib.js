'use strict';

/**
 * Copies the shared core (../lib) into ./lib so the packaged .vsix is
 * self-contained. Run automatically by `vscode:prepublish`.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'lib');
const dest = path.join(__dirname, 'lib');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (f.endsWith('.js') || f.endsWith('.json')) {
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
}
console.log('Bundled shared lib into vscode-extension/lib');
