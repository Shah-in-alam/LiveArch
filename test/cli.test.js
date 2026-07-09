'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'livearch.js');
const { version } = require('../package.json');

// The CLI must never start the watcher for an informational flag, so every
// invocation here is capped: a hang means the flag fell through to the server.
function runCli(args, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('--version and -v print the package version and exit', () => {
  for (const flag of ['--version', '-v']) {
    const out = runCli([flag]);
    assert.match(out, new RegExp(version.replace(/\./g, '\\.')));
  }
});

test('badge --output reports the path it actually wrote', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livearch-cli-'));
  const project = path.join(root, 'sample');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'App.jsx'), "import './util.js';\nexport default function App(){}\n");
  fs.writeFileSync(path.join(project, 'src', 'util.js'), 'export const x = 1;\n');

  // Scan a directory other than the cwd: the reported path must resolve to the
  // file on disk from where the user is standing, not from the scanned root.
  const out = runCli(['badge', 'sample', '--output', 'badge.svg'], root);
  const reported = out.match(/Wrote badge:\s*(\S+)/)[1];

  assert.ok(fs.existsSync(path.resolve(root, reported)), `reported ${reported} but nothing is there`);
});
