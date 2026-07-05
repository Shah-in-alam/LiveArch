# ⬡ LiveArch — hosted server (Phases 1–3)

A minimal Next.js app that gives your architecture diagram a **permanent,
shareable URL**, **live sync** to viewers (SSE), and **accounts** with scoped
tokens, private projects, and snapshot history. Implements Phases 1–3 of
[`docs/BACKEND-DESIGN.md`](../docs/BACKEND-DESIGN.md), minus the Postgres
datastore and team membership (still filesystem-backed).

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

### Accounts & handle ownership (Phase 3)

Create an account and claim a handle; afterwards **only your account** can
publish under it:

```bash
livearch login --handle me --email me@example.com --server http://localhost:3000
livearch whoami --server http://localhost:3000
livearch push me/app --server http://localhost:3000     # uses your saved token
livearch push me/app --private --server http://localhost:3000   # account-locked
```

- `login` calls `POST /api/auth/register`, which returns a **token shown once**
  and saved to `~/.livearch/config.json` (per server). `push`/`share` send it as
  `Authorization: Bearer …`.
- A **claimed handle** is owned by one account; pushes with another account's
  token are rejected (403). Private projects are viewable only by the owning
  account's token (`?token=…`).
- Tokens are stored **hashed** (SHA-256), are revocable, and track `last_used`.
- **Legacy / anonymous** still works: an unclaimed handle falls back to the
  per-project `--token` model (or open, no token) — handy for quick local dev.

### Plans & gating (Phase 3 monetisation)

Accounts have a plan — **Free** (default), **Pro**, or **Team** — defined in
[`lib/plans.js`](lib/plans.js). Limits are enforced server-side at the write path:

| | Free | Pro | Team |
|---|---|---|---|
| Hosted projects | 3 | unlimited | unlimited |
| Private projects | ✗ | ✓ | ✓ |
| Snapshot history | 5 | 20 | 50 |
| Teams | ✗ | ✗ | ✓ |

A gated push returns **402** (`PLAN_REQUIRED` / `PLAN_LIMIT`) and the CLI prints an
upgrade hint. Change plan with `livearch upgrade --plan pro` (→ `POST
/api/billing/upgrade`).

**Billing.** By default (`LIVEARCH_BILLING` unset) `upgrade` applies the plan
immediately — the self-host / dev stand-in. To take real payments, enable Stripe:

```bash
cd server && npm install stripe
# set in .env.local (see .env.example):
#   LIVEARCH_BILLING=stripe
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM
```

Then `livearch upgrade --plan pro` returns a Stripe Checkout URL (the CLI opens
it); after payment, Stripe calls `POST /api/billing/webhook`
(`checkout.session.completed`) and the plan is applied. Cancellations
(`customer.subscription.deleted`) downgrade to Free. The webhook→plan mapping is
unit-tested; live Checkout needs your Stripe keys.

### Team membership & roles (Team plan)

A **Team**-plan owner can invite other accounts to one of their projects:

```bash
livearch team add me/app teammate --role member   # read + write
livearch team add me/app viewer1  --role viewer   # read (incl. private) only
livearch team me/app                              # list members
livearch team remove me/app teammate
```

- A **member** may `push` to that (existing) project and read it even when
  private; a **viewer** may only read a private project. Neither can create new
  projects under the owner's handle or manage members.
- Inviting requires the owner to be on the **Team** plan (else `402`), and the
  invitee must have logged in once (so their handle resolves to an account).
- Enforced in `projects.authorizeWrite` / `canRead` on both backends. API:
  `GET/POST/DELETE /api/projects/<handle>/<slug>/members`.

### Sign in with GitHub (optional)

Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (OAuth app callback:
`<origin>/api/auth/github/callback`) to enable **Sign in with GitHub** at
`/api/auth/github`. It creates/links an account and shows a token to paste into
`livearch login --token …`. When unset, the endpoint returns `501` with setup
instructions; the register/token flow above works without it.

## Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/ingest` | CLI pushes `{ handle, slug, arch }` with a `Bearer` token — stores the latest snapshot, appends history, and fans it out |
| `GET /u/<handle>/<slug>` | The permanent viewer URL — renders the last snapshot and subscribes to live updates |
| `GET /api/stream/<handle>/<slug>` | Server-Sent Events stream of live updates for viewers |
| `POST /api/auth/register` | Create an account, claim a handle, return a token |
| `GET /api/auth/whoami` | Resolve the bearer token to its account |
| `GET/POST/DELETE /api/auth/tokens` | List / issue / revoke this account's tokens |
| `POST /api/billing/upgrade` | Change the plan (`{ plan }`) — instant, or returns a Stripe Checkout URL |
| `POST /api/billing/webhook` | Stripe webhook: applies the plan on `checkout.session.completed` |
| `GET/POST/DELETE /api/projects/<h>/<s>/members` | List / invite / remove project members (Team plan) |
| `GET /api/auth/github[/callback]` | Optional GitHub OAuth (env-gated) |
| `GET /` | Landing page |

## Live sync

`livearch share` pushes on every save; `/api/ingest` publishes to an in-process
pub/sub (`lib/bus.js`), and each viewer's `/api/stream/...` SSE connection
receives the update and re-renders. The in-process bus is correct for a single
Node instance; for multi-instance serverless, swap `lib/bus.js` for Upstash
Redis pub/sub (see the design doc).

## Storage

Two interchangeable backends behind one async API, chosen at startup:

**Filesystem (default)** — JSON under `server/.data/`: snapshots +
`.history.json` per project, and `_accounts/`, `_tokens/`, `_handles/` for
accounts. Zero setup; great for `next dev` and small self-hosting.

**Postgres / Neon** — set `DATABASE_URL` and the server uses Postgres instead
(`lib/pg.js`, driver `@neondatabase/serverless`). Tables are created
automatically on first use; the canonical schema is [`db/schema.sql`](db/schema.sql).

```bash
# Provision Neon via the Vercel Marketplace (injects DATABASE_URL automatically):
vercel integration add neon
vercel env pull .env.local        # then `npm run dev` picks it up

# …or point at any Postgres/Neon connection string:
echo 'DATABASE_URL=postgres://user:pass@host/db?sslmode=require' >> .env.local
```

Both backends implement the same operations, so switching changes nothing else.
The filesystem layout is deliberately Postgres-shaped (see `db/schema.sql`).
Copy [`.env.example`](.env.example) to `.env.local` for the full list of env vars.

## Deploy

This is a standard Next.js app and deploys to Vercel as-is. The filesystem store
is ephemeral on serverless, so set `DATABASE_URL` (Neon) in production — the
Postgres backend then persists snapshots, accounts, and history. Provision Neon
through the Vercel Marketplace so the env var is injected into the deployment
automatically.
