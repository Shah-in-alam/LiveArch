'use strict';

/**
 * LiveArch — VS Code extension entry point.
 *
 * Reuses the same analyser + template as the CLI. It analyses the open
 * workspace, shows the diagram in a WebviewPanel, watches files and pushes
 * live updates via postMessage, and opens a file when a node is
 * double-clicked in the diagram.
 */

const vscode = require('vscode');
const path = require('path');

// Shared core. When packaged, bundle-lib.js copies lib/ next to this file;
// in the dev workspace it resolves to the parent project's lib/.
let analyser, template;
try {
  analyser = require('./lib/analyser');
  template = require('./lib/template');
} catch {
  analyser = require('../lib/analyser');
  template = require('../lib/template');
}

let panel;          // the diagram WebviewPanel (or undefined)
let statusBar;      // status bar item
let debounceTimer;

function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders[0] ? folders[0].uri.fsPath : undefined;
}

async function collectFiles() {
  const max = vscode.workspace.getConfiguration('livearch').get('maxFiles', 5000);
  const uris = await vscode.workspace.findFiles(
    '**/*',
    '**/{node_modules,.git,dist,build,.next,out,coverage,.turbo,.vercel,.svelte-kit,__pycache__,.venv,venv}/**',
    max
  );
  return uris.map((u) => u.fsPath);
}

async function analyseWorkspace() {
  const root = workspaceRoot();
  if (!root) return null;
  return analyser.analyse(root, await collectFiles());
}

async function refresh() {
  const arch = await analyseWorkspace();
  if (!arch) return;
  if (statusBar) {
    statusBar.text = `$(circuit-board) ${arch.nodes.length} nodes`;
    statusBar.tooltip = 'LiveArch — click to open the architecture diagram';
    statusBar.show();
  }
  if (panel) panel.webview.postMessage({ type: 'update', arch });
  return arch;
}

async function openDiagram(context) {
  if (panel) { panel.reveal(vscode.ViewColumn.Beside); return; }
  const root = workspaceRoot();
  if (!root) { vscode.window.showWarningMessage('LiveArch: open a folder/workspace first.'); return; }

  panel = vscode.window.createWebviewPanel(
    'livearch',
    '⬡ LiveArch',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const arch = await analyseWorkspace();
  panel.webview.html = template.render(arch, { port: 0 });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg && msg.type === 'openFile' && msg.file) {
      try {
        const uri = vscode.Uri.file(path.join(root, msg.file));
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      } catch {
        vscode.window.showInformationMessage(`LiveArch: could not open ${msg.file}`);
      }
    }
  }, undefined, context.subscriptions);

  panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
}

function scheduleRefresh() {
  const ms = vscode.workspace.getConfiguration('livearch').get('debounce', 350);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { refresh().catch(() => {}); }, ms);
}

function activate(context) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'livearch.openDiagram';
  statusBar.text = '$(circuit-board) LiveArch';
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('livearch.openDiagram', () => openDiagram(context)),
    vscode.commands.registerCommand('livearch.refresh', () => refresh())
  );

  // Watch every file; debounce re-analysis so rapid saves don't thrash.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  watcher.onDidChange(scheduleRefresh);
  watcher.onDidCreate(scheduleRefresh);
  watcher.onDidDelete(scheduleRefresh);
  context.subscriptions.push(watcher);

  // Initial analysis for the status bar (non-blocking).
  refresh().catch(() => {});
}

function deactivate() {
  clearTimeout(debounceTimer);
}

module.exports = { activate, deactivate };
