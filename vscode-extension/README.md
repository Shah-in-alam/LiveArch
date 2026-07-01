# ⬡ LiveArch for VS Code

Live, auto-updating architecture diagram for your project — right inside VS Code. No terminal required.

## Features

- **Auto-analysis** — the status bar shows `⬡ N nodes` as soon as you open a project.
- **Split-panel diagram** — click the status bar (or run **LiveArch: Open Diagram**) to open the diagram beside your code.
- **Live updates** — save any file and the diagram updates in place; new nodes flash.
- **Double-click a node → opens the file** in the editor. *(This is the thing the CLI can't do.)*
- Same engine as the [LiveArch CLI](../README.md): tech-stack detection (with brand logos), components, hooks, routes, Prisma models, Python support, monorepo workspaces.

## Usage

1. Open a JavaScript/TypeScript/Python project folder.
2. Click **⬡ N nodes** in the status bar, or run **LiveArch: Open Diagram** from the Command Palette.
3. Edit and save files — watch the diagram update. Double-click any node to jump to its file.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `livearch.debounce` | `350` | Debounce (ms) before re-analysing after a change. |
| `livearch.maxFiles` | `5000` | Maximum number of files to scan. |

## Development

```bash
cd vscode-extension
# open this folder in VS Code and press F5 to launch an Extension Development Host
```

The extension reuses `../lib` in development. `npm run vscode:prepublish` (via `bundle-lib.js`) copies `lib/` into the extension so the packaged `.vsix` is self-contained.

## Commands

- **LiveArch: Open Diagram** (`livearch.openDiagram`)
- **LiveArch: Refresh** (`livearch.refresh`)

## License

MIT
