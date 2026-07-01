# ⬡ LiveArch — hosted server (Phase 1 MVP)

A minimal Next.js app that gives your architecture diagram a **permanent,
shareable URL**. Implements Phase 1 of [`docs/BACKEND-DESIGN.md`](../docs/BACKEND-DESIGN.md):
store the last snapshot the CLI pushes and serve it. (Live sync + accounts are
Phase 2/3.)

## Run it

```bash
cd server
npm install
npm run dev            # http://localhost:3000
```

## Publish a diagram

From any project (in another terminal):

```bash
# publish once
node /path/to/LiveArch/bin/livearch.js push me/my-repo --server http://localhost:3000

# …or keep it live — push on every save; viewers update in real time (SSE)
node /path/to/LiveArch/bin/livearch.js share me/my-repo --server http://localhost:3000

# → open http://localhost:3000/u/me/my-repo
```

### Private projects & ownership

Pass a `--token` to claim ownership of a project; only that token can push to it
afterward. Add `--private` to make it viewable only with the token:

```bash
livearch push me/secret-app --token <your-secret> --private --server http://localhost:3000
# → viewers must use  http://localhost:3000/u/me/secret-app?token=<your-secret>
```

- **First push with a token** creates an owned project. **First push with no
  token** creates an open project (anyone can push) — handy for local dev.
- Public projects are viewable by anyone; private ones require the owner token.
- Tokens are stored **hashed** (SHA-256); the raw token is never persisted.

This is the access-control layer of Phase 3. Full user **accounts** (OAuth /
Sign in with GitHub) and a persistent multi-user datastore are the remaining
Phase-3 work — see [`../docs/BACKEND-DESIGN.md`](../docs/BACKEND-DESIGN.md).

## Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/ingest` | CLI pushes `{ handle, slug, arch, token }` — stores the latest snapshot and fans it out |
| `GET /u/<handle>/<slug>` | The permanent viewer URL — renders the last snapshot and subscribes to live updates |
| `GET /api/stream/<handle>/<slug>` | Server-Sent Events stream of live updates for viewers |
| `GET /` | Landing page |

## Live sync

`livearch share` pushes on every save; `/api/ingest` publishes to an in-process
pub/sub (`lib/bus.js`), and each viewer's `/api/stream/...` SSE connection
receives the update and re-renders. The in-process bus is correct for a single
Node instance; for multi-instance serverless, swap `lib/bus.js` for Upstash
Redis pub/sub (see the design doc).

## Storage

Phase 1 uses a filesystem JSON store under `server/.data/` (see `lib/store.js`).
For production on Vercel, swap `saveSnapshot`/`getSnapshot` for Neon Postgres or
Vercel Blob — nothing else changes.

## Deploy (later)

This is a standard Next.js app and deploys to Vercel as-is, but the filesystem
store is ephemeral on serverless — wire up a real datastore first (see the
design doc).
