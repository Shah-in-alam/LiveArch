# LiveArch — Hosted Backend Design (sketch)

Status: **Phases 1–3 implemented** in [`server/`](../server/) (filesystem-backed);
the Postgres datastore and team membership remain. This document sketches the
backend that delivers the v1.0 "Team" features a purely local tool can't: a
**permanent shareable URL** (viewable when your laptop is off) and
**cross-network live team viewing with accounts and access control**.

Implemented so far: permanent URL + SSR viewer (Phase 1), live sync via SSE
(Phase 2), accounts with scoped tokens, handle ownership, private projects, and
snapshot history (Phase 3), plus a **Postgres (Neon) backend** selected by
`DATABASE_URL` (filesystem otherwise) — both behind one async API. GitHub OAuth
is wired but env-gated. Remaining: team membership/roles and org billing.

Everything else in LiveArch stays local and free. This backend is the Pro/Team
layer.

---

## 1. What the local tool already does (and its limit)

The watcher already broadcasts live updates to every connected browser, and you
can share over LAN or a tunnel (see the README "Sharing with your team"). The
limitation is simple: **it only exists while your machine runs it.** There is no
persistent URL, no accounts, and no cross-network access without a tunnel.

The backend adds exactly those three things — and nothing more.

---

## 2. Goals & non-goals

**Goals**
- Permanent, shareable diagram URL: `livearch.dev/u/<handle>/<repo>`.
- Live updates to many viewers across the internet, in sync.
- Accounts, private-by-default projects, and team membership.
- History / snapshots and branch-vs-branch diff on the server.
- A live README badge that reflects the current architecture.

**Non-goals (deliberately)**
- Uploading source code. Only the **architecture graph** (nodes/edges metadata:
  labels, types, layers, file paths) is sent — never file contents. This keeps
  the tool's "your code stays on your machine" promise intact for the code
  itself; hosted mode uploads the graph only, and offers path redaction.
- Running builds/analysis in the cloud. Analysis stays on the developer's
  machine; the backend only stores and fans out the resulting graph.

---

## 3. Key insight: the unit of data is the arch JSON, not the HTML

`analyse()` already produces a small JSON graph (`{name, nodes, edges,
fileCount, layers}`) — typically 50–200 KB even for large monorepos. That, not
the self-contained HTML, is what the backend stores and streams. The viewer page
renders it with the **same `lib/template.js`** (server-side) or a React port, so
there is one rendering path.

This makes the backend cheap: tiny JSON snapshots, debounced, per project.

---

## 4. Architecture overview

```
   Developer machine                     Hosted backend (Vercel)              Viewers (browsers)
 ┌────────────────────┐   HTTPS POST    ┌───────────────────────────┐        ┌──────────────────┐
 │ livearch (CLI)     │  arch JSON      │  Ingest API  /api/ingest  │        │  /u/<h>/<repo>   │
 │  - analyse()       │ ───────────────▶│   auth + rate-limit       │        │  (SSR latest)    │
 │  - livearch share  │   (token)       │        │                  │        └────────┬─────────┘
 │  - livearch login  │                 │        ▼                  │                 │ SSE
 └────────────────────┘                 │   Postgres (Neon)         │                 │
                                        │   snapshots (jsonb)       │   publish        ▼
                                        │        │                  │ ─────────▶ ┌───────────┐
                                        │        ▼                  │            │ Realtime  │
                                        │   Pub/Sub (Upstash Redis) │ ◀───────── │ fan-out   │
                                        │        │                  │  subscribe └───────────┘
                                        │        ▼                  │
                                        │  Stream API /api/stream   │ ── SSE ──▶ viewers (live)
                                        └───────────────────────────┘
```

**Flow (live):** CLI rebuild → debounced POST to `/api/ingest` → backend
persists the latest snapshot **and** publishes to `project:<id>` → the Stream
API (SSE) pushes it to every subscribed viewer → they re-render. When the laptop
is off, the viewer page simply serves the last persisted snapshot (that's the
permanent URL).

**Why POST from the CLI, not a persistent socket:** serverless/Fluid functions
don't hold long-lived client sockets well, and the CLI doesn't need one — a
debounced HTTPS POST per change is simpler, retryable, and cache-friendly.

**Why SSE (not WebSocket) to viewers:** updates are one-way (server→viewer), SSE
streams cleanly from a Fluid function, auto-reconnects, and needs no upgrade
handshake. A managed realtime provider (Ably/Pusher) is the drop-in if we outgrow
self-managed SSE + Redis fan-out.

---

## 5. Data model (Postgres)

```sql
users(          id, github_id, handle, email, created_at )
projects(       id, owner_id → users, slug, name,
                visibility ENUM('public','private') DEFAULT 'private', created_at )
project_members(project_id → projects, user_id → users, role ENUM('owner','member','viewer') )
snapshots(      id, project_id → projects, branch, arch JSONB, created_at )   -- keep latest + N history
api_tokens(     id, user_id → users, token_hash, name, last_used_at )
```

- Latest snapshot per `(project, branch)` drives the viewer; history enables the
  server-side diff and "how architecture changed over time".
- Snapshots as `JSONB` (small). Move to Vercel Blob only if graphs grow large.

---

## 6. API surface

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/ingest` | CLI pushes `{ projectId, branch, arch }` with a bearer token. Upserts latest snapshot, appends history, publishes to pub/sub. |
| `GET`  | `/api/stream/:projectId` | SSE stream of live updates for viewers (auth-checked for private projects). |
| `GET`  | `/u/:handle/:slug` | Viewer page — SSR renders the latest snapshot, then subscribes to the stream. |
| `GET`  | `/api/badge/:handle/:slug.svg` | Live README badge (reuses `lib/badge.js`), cached. |
| `GET`  | `/api/diff/:projectId?base=..&head=..` | Server-side branch diff (reuses `lib/diff.js`). |
| Auth   | `/api/auth/*` | Sign in with GitHub / Vercel; device flow for the CLI. |

---

## 7. CLI additions

```bash
livearch login                 # OAuth device flow → stores a scoped token in ~/.livearch
livearch share                 # links this repo to a project, prints the public URL,
                               #   and streams snapshots on every save
livearch share --private       # team-only visibility
livearch push                  # one-shot upload (CI: publish the current architecture)
```

- `share` = today's watch loop plus a debounced `POST /api/ingest` after each
  rebuild. Reuses everything already built; the only new code is auth + the POST.
- `push` fits CI: generate on merge to `main`, publish the canonical diagram +
  badge.

---

## 8. Suggested stack (leaning on the Vercel ecosystem)

| Concern | Choice | Why |
|--------|--------|-----|
| App / API | **Next.js (App Router) on Vercel, Fluid Compute** | Full Node, longer timeouts, native streaming for SSE. |
| Auth | **Clerk** (Marketplace) or Sign in with GitHub/Vercel | Devs already have GitHub; minimal friction. |
| Database | **Neon Postgres** (Marketplace) | Serverless Postgres, auto-provisioned env vars. |
| Realtime fan-out | **Upstash Redis** pub/sub (Marketplace) + SSE | Cheap fan-out; swap to Ably/Pusher at scale. |
| Blob (optional) | **Vercel Blob** | Only if snapshots outgrow a JSONB column. |
| Abuse control | **Vercel BotID / WAF**, per-token rate limits on ingest | Ingest is the write path — protect it. |

---

## 9. Security & privacy

- **Only the graph is uploaded** — labels, types, layers, and file paths; never
  file contents. Offer `--redact-paths` to hash file paths for sensitive repos.
- **Private by default.** Viewer and stream endpoints check project membership;
  public projects are opt-in.
- **Scoped CLI tokens** (revocable, `last_used` tracked). Ingest authenticates by
  token → resolves the project; a token can only write its own projects.
- **Rate-limit + validate ingest** (schema-check the arch; cap size).

---

## 10. Cost & scaling

- Writes are tiny and debounced (≤ a few KB per save, ~1 every 350 ms max).
- The scaling axis is **concurrent viewers × update rate** → handled by the
  pub/sub layer; SSE connections are cheap on Fluid Compute.
- Snapshots are small; history can be capped (e.g. last 50) or tiered by plan.

---

## 11. Phased rollout

1. **Phase 1 — Permanent URL (no realtime).** ✅ `livearch push`/`share` → SSR
   viewer of the latest snapshot. Solves "viewable when my laptop is off."
2. **Phase 2 — Live sync.** ✅ pub/sub + `/api/stream` (SSE). Viewers update in
   real time across networks.
3. **Phase 3 — Accounts & teams.** ✅ accounts, scoped tokens, handle ownership,
   private projects, snapshot history, plan tiers (Free/Pro/Team) with gating,
   Stripe billing, team membership/roles, server-side branch diff, a Neon
   Postgres datastore (`DATABASE_URL`), and env-gated GitHub OAuth. Remaining:
   going-live GitHub OAuth (needs an app).

MVP is Phase 1: it's mostly the existing analyser/template plus one POST endpoint
and one SSR page — a few days of work, no realtime complexity.

---

## 12. What stays the same

The local/free experience is unchanged and never depends on this backend. The
CLI works fully offline; hosting is strictly additive (opt-in `login`/`share`).
