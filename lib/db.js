// Database access. Hosted: real Postgres from DATABASE_URL. Local development: PGlite,
// a Postgres that runs inside Node and keeps its files in data/dev-db (no install needed).
// Both speak the same SQL, so every query below works on either.
import path from 'node:path';
import { DATA } from './paths.js';

let backend = null;

async function connect() {
  if (backend) return backend;
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const ssl = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false };
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 10 });
    backend = {
      query: (sql, params) => pool.query(sql, params),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn((sql, params) => client.query(sql, params));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(path.join(DATA, 'dev-db'));
    backend = {
      query: (sql, params) => db.query(sql, params),
      tx: (fn) => db.transaction((t) => fn((sql, params) => t.query(sql, params))),
    };
  }
  return backend;
}

export async function query(sql, params = []) {
  return (await connect()).query(sql, params);
}

// Runs fn(q) inside one transaction; q has the same shape as query().
export async function tx(fn) {
  return (await connect()).tx(fn);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  google_sub    TEXT UNIQUE NOT NULL,
  email         TEXT NOT NULL,
  name          TEXT,
  picture       TEXT,
  gmail_token   TEXT,           -- encrypted refresh token for gmail.send, null until connected
  signature     TEXT NOT NULL DEFAULT '',
  style         TEXT NOT NULL DEFAULT '',
  profile       JSONB,          -- resume parsed into structured data
  profile_status TEXT NOT NULL DEFAULT 'none', -- none | parsing | ready | failed
  profile_resume_id INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS resumes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,    -- same shape as the local campaign files: targetRole, contacts[] ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_user ON campaigns(user_id);
CREATE TABLE IF NOT EXISTS history (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT,
  name        TEXT,
  company     TEXT,
  email       TEXT,
  subject     TEXT,
  gmail_id    TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS history_user ON history(user_id);
CREATE TABLE IF NOT EXISTS runs (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,     -- running | done | failed | stopped
  data       JSONB NOT NULL,    -- target, phase, events, summary ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id, created_at);
`;

export async function migrate() {
  for (const statement of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await query(statement);
  }
  // A restart kills any research that was in progress; don't leave it looking alive.
  await query(`UPDATE runs SET status = 'failed', data = data || '{"error":"The server restarted during this run. Please start it again."}'::jsonb WHERE status = 'running'`);
}
