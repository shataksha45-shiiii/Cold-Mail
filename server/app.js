// Hosted, multi-user coldmail. Usage: npm start (needs the environment variables in .env.example).
// Every API route is scoped to the signed-in user. Changes require the X-Coldmail header,
// which only this page sends (other sites can't add it without a CORS preflight we never allow).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as auth from '../lib/auth.js';
import { migrate } from '../lib/db.js';
import { hunterVerify } from '../lib/emailFinder.js';
import * as jobs from '../lib/jobs.js';
import { buildMessage, composeBody, formatAddress } from '../lib/mime.js';
import * as repo from '../lib/repo.js';
import { parseResume } from '../lib/research.js';
import { isValidEmail, normalizeEmail } from '../lib/store.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const DAILY_SEND_LIMIT = Number(process.env.DAILY_SEND_LIMIT || 50);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function redirect(res, location, cookies = []) {
  res.writeHead(302, { Location: location, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });
  res.end();
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'That is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const raw = await readRaw(req, 1_000_000);
  try {
    return raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const sameContact = (a, b) => (a.email && b.email && normalizeEmail(a.email) === normalizeEmail(b.email))
  || `${(a.name || '').toLowerCase()}|${(a.company || '').toLowerCase()}` === `${(b.name || '').toLowerCase()}|${(b.company || '').toLowerCase()}`;

function findContact(campaign, contactId) {
  const contact = campaign.contacts.find((c) => c.id === contactId);
  if (!contact) throw new HttpError(404, 'Postcard not found');
  return contact;
}

// ---------- Laptop helper ----------
// The site owner's laptop runs a helper (npm run helper on the main branch) that asks for queued
// searches, runs them with Claude Code, and reports back. It authenticates with WORKER_TOKEN.
let helperSeenAt = 0;
const helperOnline = () => Date.now() - helperSeenAt < 90_000;

function isHelper(req) {
  const expected = process.env.WORKER_TOKEN;
  const given = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!expected || expected.length < 32 || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const CONTACT_FIELDS = ['name', 'title', 'company', 'domain', 'linkedin', 'whyRelevant', 'hooks', 'sources', 'email', 'emailStatus',
  'emailSourceUrl', 'emailSource', 'emailDetail', 'emailAlternates', 'emailVerification', 'resumeHighlights', 'subject', 'body'];
const EMAIL_STATUSES = ['public', 'verified', 'likely', 'manual', 'guessed', 'not_found'];

function cleanContact(raw) {
  const c = {};
  for (const f of CONTACT_FIELDS) if (raw[f] !== undefined) c[f] = raw[f];
  if (typeof c.name !== 'string' || typeof c.company !== 'string' || !c.name.trim() || !c.company.trim()) return null;
  for (const f of ['hooks', 'resumeHighlights', 'emailAlternates']) c[f] = Array.isArray(c[f]) ? c[f].filter((x) => typeof x === 'string').slice(0, 10) : [];
  c.sources = Array.isArray(c.sources) ? c.sources.filter((x) => x && typeof x.url === 'string' && /^https?:\/\//.test(x.url)).slice(0, 12) : [];
  if (!EMAIL_STATUSES.includes(c.emailStatus)) c.emailStatus = isValidEmail(c.email) ? 'guessed' : 'not_found';
  if (!isValidEmail(c.email)) c.email = null;
  for (const f of ['subject', 'body', 'whyRelevant', 'title']) if (typeof c[f] !== 'string') c[f] = '';
  return c;
}

async function helperRoute(req, res, pathname) {
  if (!isHelper(req)) throw new HttpError(401, 'Bad helper token');
  helperSeenAt = Date.now();

  if (pathname === '/api/worker/next' && req.method === 'POST') {
    // Idle checks are answered from memory, so the database can sleep between searches.
    if (!jobs.laptopWork.pending) return send(res, 200, { run: null });
    await repo.failSilentLaptopRuns();
    const claimed = await repo.claimLaptopRun();
    if (!claimed) {
      jobs.laptopWork.pending = false;
      return send(res, 200, { run: null });
    }
    const { userId, run } = claimed;
    const user = await repo.getUser(userId);
    if (!user || !jobs.isAdmin(user)) throw new HttpError(403, 'Run does not belong to the owner');
    const campaign = await repo.getCampaign(userId, run.campaignId);
    const resume = await repo.getResume(userId, campaign.resumeId);
    const history = await repo.listHistory(userId);
    return send(res, 200, {
      run,
      campaign,
      resume: { filename: resume.filename, data: resume.data.toString('base64') },
      signature: user.signature,
      style: user.style,
      alreadyEmailed: history.map((h) => ({ name: h.name, company: h.company, email: h.email, sentAt: h.sentAt })),
    });
  }

  const match = pathname.match(/^\/api\/worker\/runs\/([\w-]+)\/(progress|finish)$/);
  if (!match || req.method !== 'POST') throw new HttpError(404, 'Not found');
  const found = await repo.getRunAnyUser(match[1]);
  if (!found || found.run.engine !== 'laptop' || found.run.status !== 'running') throw new HttpError(409, 'That search is no longer running');
  const { userId, run } = found;
  const body = await readJson(req);
  const PHASES = ['resume', 'research', 'emails', 'writing', 'done'];

  if (match[2] === 'progress') {
    if (PHASES.includes(body.phase) && PHASES.indexOf(body.phase) > PHASES.indexOf(run.phase)) run.phase = body.phase;
    if (Array.isArray(body.events)) run.events = body.events.slice(-200).map((e) => ({ at: String(e.at || ''), text: String(e.text || '').slice(0, 300) }));
    if (typeof body.lastNote === 'string') run.lastNote = body.lastNote.slice(0, 400);
    run.heartbeatAt = new Date().toISOString();
    await repo.saveRun(userId, run);
    return send(res, 200, { stop: Boolean(run.stopRequested) });
  }

  // finish: merge the people found into the bundle (under the row lock), then close the run.
  let added = 0;
  if (Array.isArray(body.contacts) && body.contacts.length) {
    added = await repo.updateCampaign(userId, run.campaignId, (c) => {
      const key = (x) => `${(x.name || '').trim().toLowerCase()}|${(x.company || '').trim().toLowerCase()}`;
      const seen = new Set(c.contacts.map(key));
      const seenEmails = new Set(c.contacts.map((x) => normalizeEmail(x.email)).filter(Boolean));
      let n = 0;
      for (const raw of body.contacts) {
        const contact = cleanContact(raw);
        if (!contact || seen.has(key(contact)) || (contact.email && seenEmails.has(normalizeEmail(contact.email)))) continue;
        const max = c.contacts.reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0), 0);
        c.contacts.push({ ...contact, id: `c${max + 1}`, status: 'pending', ...(run.mode === 'more' ? { addedAt: new Date().toISOString() } : {}) });
        seen.add(key(contact));
        if (contact.email) seenEmails.add(normalizeEmail(contact.email));
        n += 1;
      }
      if (!c.searchPlan && typeof body.searchPlan === 'string') c.searchPlan = body.searchPlan.slice(0, 1000);
      return n;
    });
  }
  const ok = body.status === 'done' && added > 0;
  Object.assign(run, {
    status: run.stopRequested ? 'stopped' : ok ? 'done' : 'failed',
    phase: ok ? 'done' : run.phase,
    summary: typeof body.summary === 'string' ? body.summary.slice(0, 4000) : '',
    error: ok ? undefined : (typeof body.error === 'string' && body.error) || (added ? undefined : 'No new people were found.'),
    endedAt: new Date().toISOString(),
  });
  if (!ok) await jobs.dropEmptyNewBundle(userId, run);
  await repo.saveRun(userId, run);
  return send(res, 200, { added });
}

// What the page needs to know about the signed-in user.
async function me(user) {
  const resumes = await repo.listResumes(user.id);
  return {
    user: { email: user.email, name: user.name, picture: user.picture },
    search: { engine: jobs.searchEngine(user), helperOnline: helperOnline() },
    gmail: { connected: Boolean(user.gmail_token), email: user.gmail_token ? user.email : null },
    usage: await jobs.usage(user),
    hunter: Boolean(process.env.HUNTER_API_KEY),
    resumes: resumes.map((r) => ({ id: r.id, filename: r.filename })),
    profile: { status: user.profile_status, name: user.profile?.name || user.name, signature: user.signature },
    style: user.style,
  };
}

// Parse a fresh resume into a profile in the background, so the first search is quicker.
function parseInBackground(user, resume, data) {
  repo.updateUser(user.id, { profile_status: 'parsing' })
    .then(() => parseResume(data))
    .then((profile) => repo.updateUser(user.id, {
      profile, profile_status: 'ready', profile_resume_id: resume.id,
      ...(user.signature ? {} : { signature: profile.signature }),
    }))
    .catch((err) => {
      console.error('resume parse failed:', err.message);
      return repo.updateUser(user.id, { profile_status: 'failed' });
    });
}

async function sendApproved(user, campaignId, contactIds) {
  const campaign = await repo.getCampaign(user.id, campaignId);
  const targets = campaign.contacts.filter((c) => c.status === 'approved' && (!contactIds || contactIds.includes(c.id)));
  if (!targets.length) return [];
  const sentToday = await repo.sentCountSince(user.id, '1 day');
  if (sentToday + targets.length > DAILY_SEND_LIMIT) {
    throw new HttpError(429, `You can send up to ${DAILY_SEND_LIMIT} emails a day (keeps your Gmail out of spam filters). ${Math.max(0, DAILY_SEND_LIMIT - sentToday)} left today.`);
  }
  const resume = campaign.attachResume === false ? null : await repo.getResume(user.id, campaign.resumeId).catch(() => null);
  const attachment = resume && { filename: resume.filename, data: resume.data, contentType: 'application/pdf' };

  const results = [];
  for (const contact of targets) {
    if (!isValidEmail(contact.email)) { results.push({ id: contact.id, name: contact.name, ok: false, error: 'No valid email' }); continue; }
    if (!contact.subject?.trim() || !contact.body?.trim()) { results.push({ id: contact.id, name: contact.name, ok: false, error: 'Subject or body is empty' }); continue; }
    try {
      const raw = buildMessage({
        from: formatAddress(user.name || '', user.email),
        to: formatAddress(contact.name, contact.email),
        subject: contact.subject,
        text: composeBody(contact.body, user.signature),
        attachment,
      });
      const gmailId = await auth.sendGmail(user, raw);
      const sentAt = new Date().toISOString();
      await repo.updateCampaign(user.id, campaignId, (c) => {
        const t = c.contacts.find((x) => x.id === contact.id);
        Object.assign(t, { status: 'sent', sentAt, gmailId });
      });
      await repo.addHistory(user.id, { campaignId, name: contact.name, company: contact.company, email: contact.email, subject: contact.subject, gmailId });
      results.push({ id: contact.id, name: contact.name, ok: true });
    } catch (err) {
      results.push({ id: contact.id, name: contact.name, ok: false, error: err.message });
      if (err.status === 400) break; // Gmail not connected / revoked: every other send fails the same way
    }
    await sleep(1500); // pace sends a little, like a person would
  }
  return results;
}

// [method, pattern, handler(match, body, user)] ; all require sign-in
const routes = [
  ['GET', /^\/api\/me$/, (_, __, user) => me(user)],

  ['PATCH', /^\/api\/profile$/, async (_, body, user) => {
    const fields = {};
    if (typeof body.signature === 'string') fields.signature = body.signature.trim().slice(0, 1000);
    if (typeof body.style === 'string') fields.style = body.style.trim().slice(0, 6000);
    await repo.updateUser(user.id, fields);
    return { ok: true };
  }],

  ['DELETE', /^\/api\/resume\/(\d+)$/, async ([id], _, user) => {
    await repo.deleteResume(user.id, Number(id));
    return { resumes: (await repo.listResumes(user.id)).map((r) => ({ id: r.id, filename: r.filename })) };
  }],

  ['POST', /^\/api\/gmail\/disconnect$/, async (_, __, user) => {
    await auth.disconnectGmail(user);
    return { ok: true };
  }],

  ['DELETE', /^\/api\/account$/, async (_, __, user) => {
    jobs.stopRun(user.id);
    await auth.disconnectGmail(user).catch(() => {});
    await repo.deleteUser(user.id);
    return { ok: true };
  }],

  ['GET', /^\/api\/runs\/latest$/, async (_, __, user) => jobs.activeRun(user.id) || repo.latestRun(user.id)],
  ['POST', /^\/api\/runs$/, (_, body, user) => jobs.startRun(user, body)],
  ['POST', /^\/api\/runs\/stop$/, (_, __, user) => jobs.stopRun(user.id)],

  ['GET', /^\/api\/history$/, async (_, __, user) => (await repo.listHistory(user.id)).map((h) => ({ ...h, draftedAt: h.sentAt }))],

  ['GET', /^\/api\/campaigns$/, async (_, __, user) => (await repo.listCampaigns(user.id)).map((c) => ({
    id: c.id,
    targetRole: c.targetRole,
    name: c.name || null,
    createdAt: c.createdAt,
    counts: Object.fromEntries(['pending', 'approved', 'skipped', 'sent'].map((s) => [s, c.contacts.filter((x) => x.status === s).length])),
  }))],

  ['GET', /^\/api\/campaigns\/([\w-]+)$/, async ([id], _, user) => {
    const campaign = await repo.getCampaign(user.id, id);
    const history = await repo.listHistory(user.id);
    for (const c of campaign.contacts) {
      const earlier = history.find((h) => h.campaignId !== campaign.id && sameContact(h, c));
      c.previouslyContacted = earlier ? { ...earlier, draftedAt: earlier.sentAt } : null;
    }
    const resumes = await repo.listResumes(user.id);
    const resume = resumes.find((r) => r.id === campaign.resumeId);
    campaign.resolvedResume = resume ? resume.id : null;
    return campaign;
  }],

  ['DELETE', /^\/api\/campaigns\/([\w-]+)$/, async ([id], _, user) => {
    await repo.deleteCampaign(user.id, id);
    return { ok: true };
  }],

  ['PATCH', /^\/api\/campaigns\/([\w-]+)$/, async ([id], body, user) => {
    if ('resumeId' in body) await repo.getResume(user.id, Number(body.resumeId)); // must be theirs
    let name;
    if ('name' in body) {
      name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
      if (name.length > 80) throw new Error('Name is too long (80 characters max)');
    }
    await repo.updateCampaign(user.id, id, (c) => {
      if ('resumeId' in body) c.resumeId = Number(body.resumeId);
      if ('attachResume' in body) c.attachResume = Boolean(body.attachResume);
      if (name !== undefined) {
        if (name) c.name = name;
        else delete c.name; // empty name goes back to the role description
      }
    });
    return { ok: true, name: name || null };
  }],

  ['PATCH', /^\/api\/campaigns\/([\w-]+)\/contacts\/([\w-]+)$/, async ([id, contactId], body, user) => repo.updateCampaign(user.id, id, (c) => {
    const contact = findContact(c, contactId);
    if (contact.status === 'sent') throw new HttpError(409, 'Already sent.');
    for (const field of ['subject', 'body']) if (typeof body[field] === 'string') contact[field] = body[field].slice(0, 10000);
    if (typeof body.email === 'string' && body.email.trim() !== (contact.email || '')) {
      Object.assign(contact, { email: body.email.trim(), emailStatus: 'manual', emailSource: 'you' });
      delete contact.emailVerification;
    }
    if (body.status) {
      if (!['pending', 'approved', 'skipped'].includes(body.status)) throw new HttpError(400, 'Bad status');
      if (body.status === 'approved' && !isValidEmail(contact.email)) throw new HttpError(400, 'Add a valid email before approving');
      contact.status = body.status;
    }
    return contact;
  })],

  ['POST', /^\/api\/campaigns\/([\w-]+)\/contacts\/([\w-]+)\/verify$/, async ([id, contactId], _, user) => {
    const email = findContact(await repo.getCampaign(user.id, id), contactId).email;
    if (!isValidEmail(email)) throw new HttpError(400, 'No email to verify');
    const result = await hunterVerify(email);
    if (result.skipped || result.error) throw new HttpError(400, result.skipped || result.error);
    return repo.updateCampaign(user.id, id, (c) => {
      const contact = findContact(c, contactId);
      contact.emailVerification = { status: result.status, at: new Date().toISOString() };
      if (result.status === 'valid') contact.emailStatus = 'verified';
      return contact;
    });
  }],

  ['POST', /^\/api\/campaigns\/([\w-]+)\/send$/, ([id], body, user) => sendApproved(user, id, body.contactIds)],
];

function serveStatic(res, pathname) {
  const legal = { '/privacy': 'privacy.html', '/terms': 'terms.html' }[pathname];
  if (legal) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, legal), 'utf8')
      .replaceAll('{{CONTACT_EMAIL}}', process.env.CONTACT_EMAIL || 'the email address listed on the coldmail website')
      .replaceAll('{{APP_URL}}', auth.appUrl());
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
    res.end(html);
    return;
  }
  const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : path.normalize(pathname));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new HttpError(404, 'Not found');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, auth.appUrl());
  const { pathname } = url;
  try {
    if (pathname === '/healthz') return send(res, 200, { ok: true });

    // Sign-in and Gmail connection
    if (pathname === '/auth/google' && req.method === 'GET') {
      const { location, setCookie } = auth.startOAuth('signin');
      return redirect(res, location, [setCookie]);
    }
    if (pathname === '/auth/gmail' && req.method === 'GET') {
      const user = await auth.currentUser(req);
      if (!user) return redirect(res, '/auth/google');
      const { location, setCookie } = auth.startOAuth('gmail', user);
      return redirect(res, location, [setCookie]);
    }
    if (pathname === '/auth/google/callback' && req.method === 'GET') {
      const { setCookies, redirect: to } = await auth.finishOAuth(req, url);
      return redirect(res, to, setCookies);
    }

    if (pathname.startsWith('/api/worker/')) return await helperRoute(req, res, pathname);
    if (req.method !== 'GET' && req.headers['x-coldmail'] !== '1') throw new HttpError(403, 'Forbidden');

    if (pathname === '/auth/logout' && req.method === 'POST') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': await auth.logout(req) });
    }

    if (pathname.startsWith('/api/')) {
      const user = await auth.currentUser(req);
      if (pathname === '/api/me' && !user) return send(res, 200, { user: null });
      if (!user) throw new HttpError(401, 'Please sign in.');

      if (pathname === '/api/resume' && req.method === 'POST') {
        const data = await readRaw(req, 10_000_000);
        if (data.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'That file is not a PDF');
        const name = path.basename(decodeURIComponent(req.headers['x-filename'] || 'resume.pdf')).replace(/[^\w.-]+/g, '-').slice(0, 80) || 'resume.pdf';
        if ((await repo.listResumes(user.id)).length >= 5) throw new HttpError(400, 'You can keep up to 5 resumes. Delete one first.');
        const resume = await repo.addResume(user.id, name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`, data);
        if (process.env.ANTHROPIC_API_KEY) parseInBackground(user, resume, data);
        return send(res, 200, await me(await repo.getUser(user.id)));
      }

      for (const [method, pattern, handler] of routes) {
        const match = pathname.match(pattern);
        if (match && req.method === method) {
          const body = ['POST', 'PATCH'].includes(method) ? await readJson(req) : {};
          return send(res, 200, (await handler(match.slice(1), body, user)) ?? null);
        }
      }
      throw new HttpError(404, 'Not found');
    }

    if (req.method !== 'GET') throw new HttpError(404, 'Not found');
    serveStatic(res, pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.end();
    // Only unexpected crashes are hidden; deliberate errors (busy, not set up, limits) explain themselves.
    send(res, status, { error: status === 500 ? 'Something went wrong on our side.' : err.message });
  }
});

await migrate();
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`coldmail running at ${auth.appUrl()} (port ${PORT})`);
});
