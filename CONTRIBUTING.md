# Contributing to LiveArch

Thanks for your interest in improving LiveArch! Contributions of all sizes are welcome.

## Getting started

```bash
# Clone
git clone https://github.com/Shah-in-alam/LiveArch.git
cd LiveArch

# Install deps
npm install

# Test against any project
cd /path/to/your/project
node /path/to/LiveArch/bin/livearch.js
```

You can also generate the diagram once without the watcher (CI mode):

```bash
node bin/livearch.js --no-watch
```

## Project layout

| Path | Responsibility |
|------|----------------|
| `bin/livearch.js` | CLI entry — chokidar watcher + Express/WS server |
| `lib/analyser.js` | Reads `package.json` + folder structure, builds the arch graph |
| `lib/template.js` | Generates the self-contained `.visualarch.html` |
| `test/` | Node built-in test runner specs |

## Running tests

```bash
npm test
```

## Areas that need help

- More language support (Python, Go, Rust)
- Better `import` parsing to build smarter edges (see Roadmap v0.2)
- VS Code extension
- More tests
- Better CSS framework detection (Tailwind, Bootstrap, etc.)

## Guidelines

- Keep the generated `.visualarch.html` self-contained — no external runtime deps.
- Match the existing code style (CommonJS, vanilla JS, no build step).
- Add or update a test in `test/` when you change analyser behaviour.
- One focused change per pull request.

By contributing you agree your contributions are licensed under the MIT License.
