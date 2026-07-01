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
# analyse the current project and push its architecture
node /path/to/LiveArch/bin/livearch.js push me/my-repo --server http://localhost:3000
# → open http://localhost:3000/u/me/my-repo
```

If you set `LIVEARCH_INGEST_TOKEN` on the server, pass the same value to the CLI
with `--token` (or the `LIVEARCH_INGEST_TOKEN` env var).

## Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/ingest` | CLI pushes `{ handle, slug, arch, token }` — stores the latest snapshot |
| `GET /u/<handle>/<slug>` | The permanent viewer URL — renders the last snapshot |
| `GET /` | Landing page |

## Storage

Phase 1 uses a filesystem JSON store under `server/.data/` (see `lib/store.js`).
For production on Vercel, swap `saveSnapshot`/`getSnapshot` for Neon Postgres or
Vercel Blob — nothing else changes.

## Deploy (later)

This is a standard Next.js app and deploys to Vercel as-is, but the filesystem
store is ephemeral on serverless — wire up a real datastore first (see the
design doc).
