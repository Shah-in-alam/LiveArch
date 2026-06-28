# LiveArch — Full Architecture & Project Plan

> Complete technical architecture, business plan, monetisation strategy, and roadmap for LiveArch.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [The Problem](#2-the-problem)
3. [The Solution](#3-the-solution)
4. [System Architecture](#4-system-architecture)
5. [File Structure](#5-file-structure)
6. [Technical Deep Dive](#6-technical-deep-dive)
7. [Data Flow](#7-data-flow)
8. [Technology Stack](#8-technology-stack)
9. [Business Model](#9-business-model)
10. [Go-To-Market Strategy](#10-go-to-market-strategy)
11. [Revenue Projections](#11-revenue-projections)
12. [Cost Structure](#12-cost-structure)
13. [Competitive Analysis](#13-competitive-analysis)
14. [Roadmap](#14-roadmap)
15. [VS Code Extension Plan](#15-vs-code-extension-plan)
16. [AI Layer Plan](#16-ai-layer-plan)
17. [Risk Analysis](#17-risk-analysis)
18. [Success Metrics](#18-success-metrics)

---

## 1. Project Overview

**Name:** LiveArch
**Tagline:** Real-time architecture diagrams that live inside your repo
**Type:** Developer tool — npm CLI + VS Code Extension (planned)
**Target users:** Mid-level developers, tech leads, developers inheriting codebases
**Core value:** Zero-effort architecture visibility — no manual input, no paste, no describe

LiveArch sits inside any JavaScript/TypeScript project as a single command. It watches your files and maintains a `.visualarch.html` diagram that updates automatically every time you save a file in your editor.

---

## 2. The Problem

### What developers suffer from today

Every developer on a team has a slightly different mental model of the codebase. When someone new joins, they spend days reading files to understand how things connect. When someone inherits an old project, they have no map.

Existing tools fail in one of three ways:

| Tool | Failure |
|------|---------|
| GitDiagram | Only works from GitHub URL — not live, not local |
| Eraser / InfraSketch | Requires manual text description |
| draw.io / Lucidchart | Manual drag-and-drop — goes stale immediately |
| ByteByteGo | Learning resource only — not your own project |

**The gap:** Nobody has built a tool that watches your actual repo and auto-generates the diagram in real time, living inside the project itself.

### The specific pain points

- New developer joins → spends 2-3 days reading code to understand structure
- Freelancer inherits legacy project → no idea where anything is
- Tech lead explains architecture in Slack → nobody reads it
- Team updates architecture diagram in draw.io → goes stale in a week
- Open source contributor wants to make first PR → can't find the right file

---

## 3. The Solution

LiveArch creates a file called `.visualarch.html` inside any project. This file:

1. Is generated automatically — zero effort from the developer
2. Updates live every time any file is saved in the editor
3. Shows the architecture as a proper diagram — boxes, arrows, layers
4. Works offline — no account, no cloud, no signup
5. Can be committed to the repo so teammates see it on clone

The diagram shows:
- Tech stack detected from `package.json`
- Components detected from file/folder structure
- Architecture layers (Frontend → Backend → Data → External → Tooling)
- Connections between layers shown as arrows

---

## 4. System Architecture

### High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S MACHINE                           │
│                                                                 │
│  ┌──────────────┐    file    ┌─────────────────────────────┐   │
│  │   VS Code    │   change   │    livearch CLI (Node.js)   │   │
│  │  (or any     │──────────▶│                             │   │
│  │   editor)    │            │  ┌──────────┐  ┌────────┐  │   │
│  └──────────────┘            │  │ chokidar │  │Express │  │   │
│                              │  │ watcher  │  │ server │  │   │
│  ┌──────────────┐            │  └────┬─────┘  └───┬────┘  │   │
│  │   Browser    │            │       │             │       │   │
│  │              │◀───────────│  ┌────▼─────────────▼────┐  │   │
│  │ .visualarch  │ WebSocket  │  │       analyser.js     │  │   │
│  │   .html      │  push      │  │  reads files + builds │  │   │
│  │              │            │  │  arch data object     │  │   │
│  └──────────────┘            │  └──────────┬────────────┘  │   │
│                              │             │               │   │
│  ┌──────────────┐            │  ┌──────────▼────────────┐  │   │
│  │  Your Repo   │◀───────────│  │    template.js        │  │   │
│  │              │  writes    │  │  generates HTML file  │  │   │
│  │ .visualarch  │            │  └───────────────────────┘  │   │
│  │   .html      │            │                             │   │
│  └──────────────┘            └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Component responsibilities

| Component | File | Responsibility |
|-----------|------|---------------|
| CLI entry point | `bin/livearch.js` | Start watcher + server, orchestrate everything |
| File watcher | `bin/livearch.js` (chokidar) | Detect file add/change/remove events |
| Analyser | `lib/analyser.js` | Read files, detect tech stack and structure |
| Template | `lib/template.js` | Generate self-contained HTML diagram |
| WebSocket server | `bin/livearch.js` (ws) | Push updates to open browser tabs |
| Diagram viewer | Inside `.visualarch.html` | Render diagram, connect to WS, handle interaction |

---

## 5. File Structure

### LiveArch package structure

```
livearch/
├── bin/
│   └── livearch.js          # CLI entry point — watcher + WS server
├── lib/
│   ├── analyser.js          # Core intelligence — reads repo, builds arch data
│   └── template.js          # HTML generator — builds .visualarch.html
├── package.json             # npm package config, bin entry
├── README.md                # User-facing documentation
├── ARCHITECTURE.md          # This file — full technical + business plan
├── CONTRIBUTING.md          # Contribution guide
└── LICENSE                  # MIT license
```

### What LiveArch creates inside the user's repo

```
their-project/
├── src/
├── package.json
├── ...their files...
└── .visualarch.html         ← LiveArch creates and maintains this file
```

### Future structure (v0.3+)

```
livearch/
├── bin/
│   └── livearch.js
├── lib/
│   ├── analyser.js
│   ├── template.js
│   ├── parsers/             # NEW — language-specific parsers
│   │   ├── javascript.js    # Parse JS/TS imports
│   │   ├── python.js        # Parse Python imports
│   │   └── go.js            # Parse Go imports
│   └── ai/                  # NEW — AI suggestion layer
│       ├── reviewer.js      # Calls Claude API to review arch
│       └── prompts.js       # Prompt templates
├── vscode-extension/        # NEW — VS Code extension
│   ├── extension.js
│   ├── panel.js
│   └── package.json
└── web/                     # NEW — livearch.dev website
    ├── index.html
    ├── pricing.html
    └── docs/
```

---

## 6. Technical Deep Dive

### 6.1 File Watcher (`bin/livearch.js`)

Uses **chokidar** — the most reliable file watcher in the Node.js ecosystem, used by Vite, Webpack, and Jest.

Key decisions:
- **350ms debounce** — prevents rebuilding on every keystroke during rapid saves
- **Ignored paths** — `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`
- **Depth 6** — watches up to 6 folder levels deep (catches most project structures)
- **Persistent mode** — keeps watching until Ctrl+C

```javascript
const watcher = chokidar.watch(WATCH_PATH, {
  ignored: IGNORE,
  persistent: true,
  ignoreInitial: false,  // process existing files on startup
  depth: 6
});
```

### 6.2 Analyser (`lib/analyser.js`)

The analyser runs in two passes:

**Pass 1 — package.json scan**
Reads `package.json` once and maps dependencies to nodes. This detects the entire tech stack in one read.

```
dependencies + devDependencies
        ↓
check each known key (react, express, prisma, stripe...)
        ↓
push matching nodes with correct type, layer, icon
```

**Pass 2 — folder/file scan**
Walks the file tree and classifies each file:

```
filepath
  → check filename (main.jsx → entry, *.test.js → test)
  → check directory (components/ → component, routes/ → route)
  → check file extension (.jsx → component, .css → style)
  → check file content (import mongoose → database)
```

**Edge building**
After nodes are collected, edges are built from a logical connection map:

```
framework → component  (renders)
framework → bundler    (built by)
entry → framework      (bootstraps)
route → service        (calls)
service → database     (reads/writes)
component → state      (reads)
```

### 6.3 Template Generator (`lib/template.js`)

Generates a single self-contained HTML file with:

- All CSS inlined (dark theme, grid background, animations)
- All JavaScript inlined (diagram builder, WebSocket client, interaction handlers)
- The arch data JSON baked in as a `const ARCH = {...}` variable
- A WebSocket client that connects to `ws://localhost:7842`

The diagram is built by JavaScript at runtime:
1. Groups nodes by layer
2. Creates group boxes per layer
3. Components get a CSS grid inside their group
4. SVG arrows are drawn after layout with `getBoundingClientRect()`
5. Arrows redraw on scroll and resize

### 6.4 WebSocket Communication

Protocol is simple — two message types:

```javascript
// Server → Browser on connect
{ type: 'init', arch: { name, nodes, edges, fileCount, timestamp } }

// Server → Browser on file change
{ type: 'update', arch: {...}, event: 'add'|'change'|'remove', file: 'src/components/NewPage.jsx' }
```

Browser handles update:
1. Replaces `ARCH` with new data
2. Calls `buildDiagram()` — rebuilds all DOM nodes
3. Flashes new nodes green
4. Shows toast notification with changed file name
5. Redraws SVG arrows

### 6.5 Self-Contained HTML

The `.visualarch.html` file works in two modes:

**Connected mode** (watcher is running)
- WebSocket connects to `ws://localhost:7842`
- Receives live updates
- Status dot is green

**Offline mode** (watcher not running)
- WebSocket fails to connect — caught silently
- Shows last known architecture (baked into the file)
- Status dot is red with message "Not connected — run: npx livearch"

This means the file is always useful even without the watcher running.

---

## 7. Data Flow

### Full data flow on file save

```
1. Developer saves src/components/NewPage.jsx in VS Code

2. chokidar fires 'add' event with full file path

3. scheduleRebuild() called — starts 350ms debounce timer

4. After 350ms (no more changes):
   a. trackedFiles.add(filePath)
   b. analyse(WATCH_PATH, [...trackedFiles]) called

5. analyser.js runs:
   a. Reads package.json → 15 nodes from dependencies
   b. Walks file tree → finds NewPage.jsx in pages/ → type:'page'
   c. Builds edge: framework → NewPage (renders)
   d. Returns arch object: { name, nodes:[...26], edges:[...40], fileCount:31 }

6. template.js generates new HTML string with arch baked in

7. fs.writeFileSync('.visualarch.html', html) — file updated on disk

8. broadcast({ type:'update', arch, event:'add', file:'src/components/NewPage.jsx' })
   → sends to all WebSocket clients

9. Browser receives message:
   a. ARCH = msg.arch
   b. buildDiagram() — rebuilds DOM
   c. flashNode('file-NewPage') — green flash animation
   d. flash('➕ Added: src/components/NewPage.jsx') — toast notification

10. Console logs:
    + added: src/components/NewPage.jsx  (26 nodes)
```

Total time from file save to diagram update: **~400ms**

---

## 8. Technology Stack

### Core (v0.1)

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | ≥18.0 | Runtime |
| chokidar | ^3.5.3 | File watching |
| ws | ^8.16.0 | WebSocket server |
| express | ^4.18.2 | HTTP server (serves diagram at localhost) |
| Vanilla JS | ES2020 | Diagram viewer (no framework dependencies) |
| SVG | native | Arrow rendering |

### Planned additions

| Technology | Purpose | Version |
|-----------|---------|---------|
| VS Code Extension API | IDE integration | v0.3 |
| Claude API (Anthropic) | AI suggestions | v0.4 Pro |
| Stripe | Payment processing | v0.4 Pro |
| Supabase | User accounts + team sync | v0.4 Pro |
| Vercel | Website + docs hosting | v0.3 |

### Why these choices

**chokidar over fs.watch** — native `fs.watch` is unreliable on macOS and WSL. Chokidar handles all edge cases.

**ws over Socket.io** — Socket.io is 400KB. `ws` is 30KB. For a simple push channel we don't need Socket.io's reconnect logic.

**Vanilla JS over React** — The generated `.visualarch.html` needs to be self-contained with no external dependencies. A React bundle would add 140KB. Vanilla JS keeps it small and fast.

**SVG over Canvas** — SVG arrows scale with zoom and are readable at any size. Canvas arrows would require manual hit-testing.

---

## 9. Business Model

### Three-tier model

```
FREE                    PRO (€9/mo)             TEAM (€29/mo)
────────────────────    ────────────────────    ────────────────────
✅ Local watcher        ✅ Everything free       ✅ Everything Pro
✅ .visualarch.html     ✅ AI suggestions        ✅ Team workspace
✅ Basic diagram        ✅ Public share URL       ✅ Multiple devs
✅ Unlimited repos      ✅ Architecture diff      ✅ Diagram history
✅ Unlimited saves      ✅ Branch comparison      ✅ Slack integration
✅ No account needed    ✅ Priority support       ✅ GitHub integration
                        ✅ Email support          ✅ SSO
                                                 ✅ Up to 10 devs
```

### Why this works

The free tier is genuinely useful — it covers 90% of solo developer needs. This drives adoption and word-of-mouth.

Pro features are genuinely worth €9/month to any developer who:
- Works on a team
- Wants to share architecture with non-technical stakeholders
- Wants AI to catch architecture problems before code review

Team pricing at €29/month for 10 developers is €2.90 per dev per month — cheaper than a coffee. Easy approval for engineering managers.

### Revenue formula

```
Monthly Revenue = (Free users × 0) + (Pro users × €9) + (Teams × €29)

Example at 2000 total users:
  1800 free     × €0  = €0
  180  Pro      × €9  = €1,620
  20   Teams    × €29 = €580
  ─────────────────────────────
  Total MRR             €2,200/month
```

---

## 10. Go-To-Market Strategy

### Phase 1 — Organic launch (Month 1-2, €0 budget)

**Week 1: npm publish**
```bash
npm publish
```
- Write detailed npm description
- Add keywords: `architecture`, `diagram`, `developer-tools`, `visualization`

**Week 2: Reddit posts**
- r/webdev — "I built a tool that auto-generates architecture diagrams from your code"
- r/programming — show the before/after (messy codebase vs clean diagram)
- r/reactjs — show it working on a React project
- r/node — technical post about how chokidar + WebSocket works

**Week 3: Twitter/X**
- Record a 30-second GIF — open VS Code, save a file, watch diagram update
- Post with caption: "Your architecture diagram that actually stays up to date"
- Tag relevant accounts: @vscode, @nodejs, @reactjs

**Week 4: Dev.to + Hashnode article**
- Title: "I got tired of manually updating architecture diagrams, so I built this"
- Full tutorial with GIFs
- Links to GitHub + npm

### Phase 2 — Community (Month 2-4)

- Submit to **Product Hunt** (needs preparation — email list, supporters)
- Post on **Hacker News** Show HN
- Submit to **daily.dev** community
- Reach out to 5 developer YouTubers for review

### Phase 3 — VS Code Marketplace (Month 4-6)

- Launch VS Code extension
- Marketplace has built-in discovery — developers search for tools here
- Extensions go viral faster than npm packages
- Goal: 1000 installs in first month

### Phase 4 — Paid tier launch (Month 5-6)

- Launch Pro when Free has 500+ active users
- Email all users about Pro launch
- Offer 3-month discount to early users

---

## 11. Revenue Projections

### Conservative scenario

| Month | Free Users | Pro Users | Teams | MRR |
|-------|-----------|-----------|-------|-----|
| 1 | 50 | 0 | 0 | €0 |
| 2 | 150 | 0 | 0 | €0 |
| 3 | 400 | 0 | 0 | €0 |
| 4 | 800 | 0 | 0 | €0 |
| 5 | 1200 | 20 | 0 | €180 |
| 6 | 1800 | 45 | 2 | €463 |
| 9 | 3500 | 100 | 8 | €1,132 |
| 12 | 6000 | 200 | 20 | €2,380 |

### Optimistic scenario (Product Hunt front page)

| Month | Free Users | Pro Users | Teams | MRR |
|-------|-----------|-----------|-------|-----|
| 1 | 500 | 0 | 0 | €0 |
| 3 | 2000 | 30 | 2 | €328 |
| 6 | 5000 | 150 | 15 | €1,785 |
| 12 | 15000 | 500 | 60 | €6,240 |

---

## 12. Cost Structure

### Current costs (v0.1)

| Item | Cost |
|------|------|
| Domain (livearch.dev) | €12/year |
| GitHub (free tier) | €0 |
| npm publish | €0 |
| Vercel (free tier for website) | €0 |
| **Total** | **€1/month** |

### Costs at scale (v0.4 with Pro tier)

| Item | Cost at 500 Pro users |
|------|----------------------|
| Domain | €1/month |
| Vercel Pro (website + docs) | €20/month |
| Supabase (user accounts + DB) | €25/month |
| Claude API (AI suggestions, ~500 calls/day) | €30/month |
| Stripe fees (2.9% + €0.30 per transaction) | ~€130/month |
| **Total** | **~€206/month** |

At 500 Pro users (€4,500 MRR):
```
Revenue:  €4,500
Costs:    €206
──────────────
Profit:   €4,294/month (95% margin)
```

---

## 13. Competitive Analysis

| Tool | Input | Live? | Inside repo? | Free? | Target user |
|------|-------|-------|-------------|-------|-------------|
| **LiveArch** | Watches files | ✅ Yes | ✅ Yes | ✅ Yes | Any developer |
| GitDiagram | GitHub URL | ❌ No | ❌ No | ✅ Yes | Exploring repos |
| Eraser | Text description | ❌ No | ❌ No | Partial | Teams |
| InfraSketch | Text description | ❌ No | ❌ No | Limited | System design |
| draw.io | Manual | ❌ No | ❌ No | ✅ Yes | Any |
| Lucidchart | Manual | ❌ No | ❌ No | ❌ No | Enterprise |
| Miro | Manual | ❌ No | ❌ No | ❌ No | Teams |
| Swark | VS Code plugin | ❌ No | ❌ No | ✅ Yes | VS Code users |
| Structurizr | DSL code | ❌ No | ❌ No | ❌ No | Architects |

### LiveArch's unique position

LiveArch is the **only tool** that:
1. Lives inside your repo as a file
2. Updates automatically without any input
3. Requires zero configuration
4. Works offline
5. Is free for solo developers

---

## 14. Roadmap

### v0.1 — MVP ✅ (Current)
- File watcher with chokidar
- package.json tech stack detection (20+ frameworks)
- Folder structure analysis (15+ folder patterns)
- Layer-grouped diagram with arrows
- Self-contained `.visualarch.html`
- WebSocket live updates
- Click-to-inspect panel with file path + connections
- New node flash animation

### v0.2 — Smarter Analysis (Month 2-3)
- Parse actual `import` statements to build real edges
  ```
  import { wines } from '../data/wines.js'
  → edge: Shop → wines.js (imports)
  ```
- Detect API endpoints from Express/Fastify routes
  ```
  app.get('/api/users', handler)
  → node: GET /api/users (route)
  ```
- Detect database models from Prisma schema
- Python project support (`requirements.txt`, FastAPI, Django)
- `--no-watch` flag for CI (generate once and exit)
- Auto-open browser on start

### v0.3 — VS Code Extension (Month 4-6)
- Install from VS Code marketplace — one click
- Auto-starts when project opens (no terminal needed)
- Diagram opens in split panel inside VS Code
- Status bar shows node count
- Command palette: "LiveArch: Open Diagram"

### v0.4 — AI Layer (Month 6-9) — Pro feature
- Send arch data to Claude API
- Returns plain English suggestions:
  - "Shop component imports wines, AgeGate, ShopModal, and Bottle — consider splitting"
  - "No error boundaries detected — add one around Shop"
  - "No auth layer — is this intentional?"
- Suggestions shown in a panel next to the diagram
- One-click to generate a GitHub Issue for each suggestion

### v1.0 — Team Features (Month 9-12) — Pro/Team
- Shareable public diagram URL (livearch.dev/u/username/repo)
- Team mode — multiple devs see same live diagram
- Architecture diff — compare `main` branch vs `feature/` branch
- Diagram snapshots — see how architecture changed over time
- Embed badge in README: `[![Architecture](https://livearch.dev/badge/repo)](https://livearch.dev/u/repo)`

---

## 15. VS Code Extension Plan

### Why VS Code extension beats CLI

| | CLI | VS Code Extension |
|-|-----|-------------------|
| Installation | `npm install -g` | One click in marketplace |
| Discovery | Search npm | Browse marketplace |
| Auto-start | No — must remember to run | Yes — opens with project |
| No terminal needed | No | Yes |
| Viral potential | Low | High (millions browse marketplace) |
| Charging mechanism | Hard | Easy (Pro features behind paywall) |

### Extension architecture

```
VS Code Extension
├── extension.js          # Main entry — activate/deactivate
├── LiveArchPanel.js      # WebviewPanel — shows diagram inside VS Code
├── Watcher.js            # Wraps chokidar — same logic as CLI
├── StatusBar.js          # Shows "⬡ 27 nodes" in status bar
└── package.json          # Extension manifest
    ├── activationEvents: ["onWorkspaceContains:package.json"]
    ├── contributes.commands: ["livearch.openDiagram"]
    └── contributes.configuration: (port, output, ignore)
```

### User experience

```
1. Developer opens VS Code with a project
2. Extension auto-activates (sees package.json)
3. Status bar shows "⬡ Analysing..."
4. After 1 second: "⬡ 27 nodes"
5. Developer clicks status bar → diagram opens in split panel
6. Developer saves any file → diagram updates in split panel
7. Developer clicks a node → VS Code opens that file
```

Step 7 — clicking a node opens the actual file — is the killer feature that CLI cannot offer.

---

## 16. AI Layer Plan

### How AI suggestions work (v0.4 Pro)

```
arch data object
      ↓
structured prompt to Claude API
      ↓
Claude returns JSON array of suggestions
      ↓
LiveArch displays in suggestions panel
```

### Prompt structure

```
You are a software architecture reviewer.
Analyse this architecture and return JSON suggestions.

Architecture:
- Project: ${arch.name}
- Nodes: ${JSON.stringify(arch.nodes)}
- Edges: ${JSON.stringify(arch.edges)}
- File count: ${arch.fileCount}

Return JSON array: [{ severity: 'warning'|'info', node: 'node-id'|null, message: '...', suggestion: '...' }]
Focus on: component size, missing layers, circular dependencies, security, scalability.
```

### Example suggestions

```json
[
  {
    "severity": "warning",
    "node": "file-Shop",
    "message": "Shop component has 6 connections — may be doing too much",
    "suggestion": "Consider splitting into ShopList and ShopActions components"
  },
  {
    "severity": "info",
    "node": null,
    "message": "No error boundary detected",
    "suggestion": "Add an ErrorBoundary component wrapping your main sections"
  },
  {
    "severity": "info",
    "node": null,
    "message": "No loading state management detected",
    "suggestion": "Consider adding React Query or SWR for data fetching state"
  }
]
```

### Cost per AI call

- Average arch object: ~3000 tokens input
- Average response: ~500 tokens output
- Claude Haiku cost: ~€0.001 per call
- At 500 Pro users checking once per day: 500 × €0.001 = €0.50/day = €15/month

Extremely affordable.

---

## 17. Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Nobody uses it | Medium | High | Launch on Reddit + ProductHunt with GIF demo |
| VS Code publishes competing extension | Low | High | Move fast, build brand |
| AI API costs spike | Low | Medium | Cap daily calls per user, cache results |
| Users don't convert to Pro | Medium | High | Make AI suggestions genuinely valuable |
| Security concern about code leaving machine | Medium | High | Keep analysis 100% local in free tier |
| npm package abandoned perception | Low | Medium | Regular releases, active GitHub |
| Large projects too slow | Medium | Medium | Optimise analyser with file hash cache |

### Biggest risk: no one converts

The biggest risk is having 5000 free users and 0 Pro subscribers.

Mitigations:
- AI suggestions must be genuinely useful, not generic
- Public share URL must be something teams actually want
- Launch Pro with a 3-month discount to create urgency
- Email sequence to free users showing Pro features

---

## 18. Success Metrics

### v0.1 Launch targets (Month 1-2)

| Metric | Target |
|--------|--------|
| npm downloads (week 1) | 200 |
| GitHub stars (month 1) | 100 |
| Reddit upvotes on launch post | 50 |
| Active users (open .visualarch.html at least once) | 100 |

### v0.2 Growth targets (Month 3-4)

| Metric | Target |
|--------|--------|
| npm downloads total | 2000 |
| GitHub stars | 400 |
| Weekly active users | 300 |
| VS Code extension installs (if launched) | 500 |

### v0.4 Revenue targets (Month 6-9)

| Metric | Target |
|--------|--------|
| Total users | 3000 |
| Pro subscribers | 100 |
| Team accounts | 10 |
| MRR | €1,190 |

### v1.0 Targets (Month 12)

| Metric | Target |
|--------|--------|
| Total users | 8000 |
| Pro subscribers | 300 |
| Team accounts | 40 |
| MRR | €3,860 |
| GitHub stars | 2000 |
| VS Code installs | 5000 |

---

## Summary

LiveArch fills a genuine gap in the developer tools market. No existing tool provides a **live, automatically updating, repo-resident architecture diagram** that requires zero input from the developer.

The technical implementation is straightforward:
- chokidar watches files
- analyser reads package.json and folder structure
- template generates self-contained HTML
- WebSocket pushes updates to the browser

The business model is clear:
- Free tier drives adoption (zero friction)
- Pro tier (€9/month) monetises with AI + sharing + team features
- VS Code extension is the growth vector

The path to first revenue:
1. Launch free CLI → get 500 users
2. Launch VS Code extension → get 2000 users
3. Launch Pro tier → convert 5% → €900/month
4. Add AI suggestions → increase conversion to 10% → €1,800/month

Total investment to reach €1,800/month: essentially €0 — just time.

---

*LiveArch — built by Shah-in-alam*
*Last updated: June 2026*
