// Everything the hosted app reads or writes, always scoped to one user.
import crypto from 'node:crypto';
import { query, tx } from './db.js';

export class NotFound extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.status = 404;
  }
}

// ---------- Users ----------
export async function upsertGoogleUser({ sub, email, name, picture }) {
  const { rows } = await query(
    `INSERT INTO users (google_sub, email, name, picture) VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture
     RETURNING *`,
    [sub, email, name, picture],
  );
  return rows[0];
}

export async function getUser(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function updateUser(id, fields) {
  const allowed = ['gmail_token', 'signature', 'style', 'profile', 'profile_status', 'profile_resume_id'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return getUser(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => (k === 'profile' && fields[k] ? JSON.stringify(fields[k]) : fields[k]));
  const { rows } = await query(`UPDATE users SET ${sets} WHERE id = $1 RETURNING *`, [id, ...values]);
  return rows[0];
}

export async function deleteUser(id) {
  await query('DELETE FROM users WHERE id = $1', [id]); // cascades to everything they own
}

// ---------- Sessions ----------
export async function createSession(userId, tokenHash, days = 30) {
  await query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`, [tokenHash, userId, String(days)]);
}

export async function userForSession(tokenHash) {
  const { rows } = await query(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()',
    [tokenHash],
  );
  return rows[0] || null;
}

export async function deleteSession(tokenHash) {
  await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

// ---------- Resumes ----------
export async function addResume(userId, filename, data) {
  const { rows } = await query('INSERT INTO resumes (user_id, filename, data) VALUES ($1, $2, $3) RETURNING id, filename, created_at', [userId, filename, data]);
  return rows[0];
}

export async function listResumes(userId) {
  const { rows } = await query('SELECT id, filename, created_at FROM resumes WHERE user_id = $1 ORDER BY created_at', [userId]);
  return rows;
}

export async function getResume(userId, id) {
  const { rows } = await query('SELECT * FROM resumes WHERE user_id = $1 AND id = $2', [userId, id]);
  if (!rows[0]) throw new NotFound('Resume not found');
  // pg returns a Buffer, PGlite a Uint8Array; Buffer gives every caller working .toString('base64').
  return { ...rows[0], data: Buffer.from(rows[0].data) };
}

export async function deleteResume(userId, id) {
  await query('DELETE FROM resumes WHERE user_id = $1 AND id = $2', [userId, id]);
}

// ---------- Campaigns (stored as one JSON document each) ----------
export function newCampaignId(targetRole) {
  const slug = targetRole.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bundle';
  return `${new Date().toISOString().slice(0, 10)}-${slug}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function createCampaign(userId, data) {
  await query('INSERT INTO campaigns (id, user_id, data) VALUES ($1, $2, $3)', [data.id, userId, JSON.stringify(data)]);
  return data;
}

export async function listCampaigns(userId) {
  const { rows } = await query('SELECT data FROM campaigns WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return rows.map((r) => r.data);
}

export async function getCampaign(userId, id) {
  const { rows } = await query('SELECT data FROM campaigns WHERE user_id = $1 AND id = $2', [userId, id]);
  if (!rows[0]) throw new NotFound('Bundle not found');
  return rows[0].data;
}

// Read-modify-write under a row lock, so the research job and the user's own edits
// on the desk can never overwrite each other.
export async function updateCampaign(userId, id, mutate) {
  return tx(async (q) => {
    const { rows } = await q('SELECT data FROM campaigns WHERE user_id = $1 AND id = $2 FOR UPDATE', [userId, id]);
    if (!rows[0]) throw new NotFound('Bundle not found');
    const campaign = rows[0].data;
    const result = await mutate(campaign);
    campaign.updatedAt = new Date().toISOString();
    await q('UPDATE campaigns SET data = $3, updated_at = now() WHERE user_id = $1 AND id = $2', [userId, id, JSON.stringify(campaign)]);
    return result === undefined ? campaign : result;
  });
}

export async function deleteCampaign(userId, id) {
  await query('DELETE FROM campaigns WHERE user_id = $1 AND id = $2', [userId, id]);
}

// ---------- History of sent emails ----------
export async function addHistory(userId, entry) {
  await query(
    'INSERT INTO history (user_id, campaign_id, name, company, email, subject, gmail_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [userId, entry.campaignId, entry.name, entry.company, entry.email, entry.subject, entry.gmailId],
  );
}

export async function listHistory(userId) {
  const { rows } = await query(
    'SELECT name, company, email, subject, campaign_id AS "campaignId", sent_at AS "sentAt" FROM history WHERE user_id = $1 ORDER BY sent_at DESC',
    [userId],
  );
  return rows;
}

export async function sentCountSince(userId, interval) {
  const { rows } = await query(`SELECT count(*)::int AS n FROM history WHERE user_id = $1 AND sent_at > now() - $2::interval`, [userId, interval]);
  return rows[0].n;
}

// ---------- Research runs ----------
export async function createRun(userId, run) {
  await query('INSERT INTO runs (id, user_id, status, data) VALUES ($1, $2, $3, $4)', [run.id, userId, run.status, JSON.stringify(run)]);
}

export async function saveRun(userId, run) {
  await query('UPDATE runs SET status = $3, data = $4 WHERE user_id = $1 AND id = $2', [userId, run.id, run.status, JSON.stringify(run)]);
}

export async function latestRun(userId) {
  const { rows } = await query('SELECT data, status FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
  return rows[0] ? { ...rows[0].data, status: rows[0].status } : null;
}

// Runs that count against the monthly allowance: anything this calendar month that didn't fail outright.
export async function runsThisMonth(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM runs WHERE user_id = $1 AND created_at >= date_trunc('month', now()) AND status <> 'failed'`,
    [userId],
  );
  return rows[0].n;
}

// ---------- Laptop helper queue ----------
// Searches for the site owner wait as status 'queued' with engine 'laptop' until their laptop
// helper claims them. These functions aren't scoped by user: only the helper (with the
// WORKER_TOKEN) calls them, and the server checks the run belongs to an admin.
export async function openLaptopRun(userId) {
  const { rows } = await query(`SELECT data, status FROM runs WHERE user_id = $1 AND status IN ('queued', 'running') AND data->>'engine' = 'laptop' LIMIT 1`, [userId]);
  return rows[0] ? { ...rows[0].data, status: rows[0].status } : null;
}

export async function claimLaptopRun() {
  return tx(async (q) => {
    const { rows } = await q(`SELECT id, user_id, data FROM runs WHERE status = 'queued' AND data->>'engine' = 'laptop' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!rows[0]) return null;
    const run = { ...rows[0].data, status: 'running', claimedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
    await q('UPDATE runs SET status = $2, data = $3 WHERE id = $1', [rows[0].id, 'running', JSON.stringify(run)]);
    return { userId: rows[0].user_id, run };
  });
}

export async function getRunAnyUser(id) {
  const { rows } = await query('SELECT user_id, status, data FROM runs WHERE id = $1', [id]);
  return rows[0] ? { userId: rows[0].user_id, run: { ...rows[0].data, status: rows[0].status } } : null;
}

// A helper that stops reporting (laptop closed mid-search) leaves its run hanging; give up after 20 minutes.
export async function failSilentLaptopRuns() {
  await query(`UPDATE runs SET status = 'failed', data = data || '{"error":"Your laptop stopped responding during this search. Start it again when the helper is running."}'::jsonb
    WHERE status = 'running' AND data->>'engine' = 'laptop' AND (data->>'heartbeatAt')::timestamptz < now() - interval '20 minutes'`);
}
