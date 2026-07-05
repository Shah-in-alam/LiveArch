-- LiveArch hosted backend — Postgres schema (Neon-ready).
--
-- The server creates these tables automatically on first use (see lib/pg.js
-- init()). This file is the canonical reference / manual migration, matching
-- the data model in docs/BACKEND-DESIGN.md.

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  handle      TEXT UNIQUE NOT NULL,
  email       TEXT,
  provider    TEXT NOT NULL DEFAULT 'token',   -- 'token' | 'github'
  provider_id TEXT,                            -- external identity (e.g. GitHub user id)
  plan        TEXT NOT NULL DEFAULT 'free',    -- 'free' | 'pro' | 'team'
  created_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash   TEXT PRIMARY KEY,               -- SHA-256 of the secret; raw token never stored
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT,
  created_at   BIGINT NOT NULL,
  last_used_at BIGINT
);

CREATE TABLE IF NOT EXISTS projects (
  handle           TEXT NOT NULL,
  slug             TEXT NOT NULL,
  owner_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,  -- account ownership
  owner_hash       TEXT,                                             -- legacy per-project token
  visibility       TEXT NOT NULL DEFAULT 'public',                   -- 'public' | 'private'
  created_at       BIGINT NOT NULL,
  PRIMARY KEY (handle, slug)
);

CREATE TABLE IF NOT EXISTS snapshots (
  handle     TEXT NOT NULL,
  slug       TEXT NOT NULL,
  arch       JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (handle, slug)
);

CREATE TABLE IF NOT EXISTS snapshot_history (
  id     BIGSERIAL PRIMARY KEY,
  handle TEXT NOT NULL,
  slug   TEXT NOT NULL,
  arch   JSONB NOT NULL,
  at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_project ON snapshot_history (handle, slug, at DESC);
