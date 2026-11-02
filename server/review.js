// Usage: npm run review [-- --no-open]
// Local review page at http://localhost:3000. Only reachable from this computer.
// Reads campaign files fresh on every request, so edits Claude makes show up on refresh.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDraftsForCampaign } from '../lib/drafts.js';
import { hunterVerify } from '../lib/emailFinder.js';
import { gmailConnection } from '../lib/google.js';
import { GOOGLE_CREDENTIALS_FILE, PROFILE_FILE, RESUME_DIR, STYLE_FILE } from '../lib/paths.js';
import { latestRun, startRun, stopRun } from '../lib/runs.js';
import {
  findInHistory, isValidEmail, listCampaigns, listResumes, loadCampaign, loadHistory, loadProfile, resolveResume, saveCampaign, writeJson,
} from '../lib/store.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new HttpError(413, 'Request too large');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function getContact(campaign, contactId) {
  const contact = campaign.contacts.find((c) => c.id === contactId);
  if (!contact) throw new HttpError(404, `No contact ${contactId}`);
  return contact;
}

function withHistory(campaign) {
  const history = loadHistory();
  for (const c of campaign.contacts) {
    const earlier = findInHistory(history, c);
    c.previouslyContacted = earlier && earlier.campaignId !== campaign.id ? earlier : null;
  }
  return campaign;
}

const routes = [
  ['GET', /^\/api\/status$/, () => {
    const profile = loadProfile();
    return {
      gmail: gmailConnection(),
      googleCredentials: fs.existsSync(GOOGLE_CREDENTIALS_FILE),
      apollo: Boolean(process.env.APOLLO_API_KEY),
      hunter: Boolean(process.env.HUNTER_API_KEY),
      styleExamples: fs.existsSync(STYLE_FILE),
      profile: profile && { name: profile.name, signature: profile.signature || '', sourceResume: profile.sourceResume || null },
      resumes: listResumes(),
    };
  }],

  ['PATCH', /^\/api\/profile$/, (_, body) => {
    const profile = loadProfile();
    if (!profile) throw new HttpError(400, 'No profile yet. It is made on your first run.');
    if (typeof body.signature === 'string') profile.signature = body.signature.trim();
    writeJson(PROFILE_FILE, profile);
    return { signature: profile.signature };
  }],

  ['GET', /^\/api\/runs\/latest$/, () => latestRun()],

  ['POST', /^\/api\/runs$/, (_, body) => {
    try {
      return startRun(body);
    } catch (err) {
      throw new HttpError(err.status || 500, err.message);
    }
  }],

  ['POST', /^\/api\/runs\/stop$/, () => stopRun()],

  ['GET', /^\/api\/history$/, () => loadHistory().contacts.slice().reverse()],

  ['GET', /^\/api\/campaigns$/, () => listCampaigns().map((c) => ({
    id: c.id,
    targetRole: c.targetRole,
    createdAt: c.createdAt,
    counts: Object.fromEntries(['pending', 'approved', 'skipped', 'drafted'].map((s) => [s, c.contacts.filter((x) => x.status === s).length])),
  }))],

  ['GET', /^\/api\/campaigns\/([\w-]+)$/, ([id]) => {
    const campaign = withHistory(loadCampaign(id));
    campaign.resolvedResume = resolveResume(campaign, loadProfile())?.file || null;
    return campaign;
  }],

  ['PATCH', /^\/api\/campaigns\/([\w-]+)$/, ([id], body) => {
    const campaign = loadCampaign(id);
    if ('resumeFile' in body) {
      if (!listResumes().includes(body.resumeFile)) throw new HttpError(400, 'Unknown resume file');
      campaign.resumeFile = body.resumeFile;
    }
    if ('attachResume' in body) campaign.attachResume = Boolean(body.attachResume);
    saveCampaign(campaign);
    return { ok: true };
  }],

  ['PATCH', /^\/api\/campaigns\/([\w-]+)\/contacts\/([\w-]+)$/, ([id, contactId], body) => {
    const campaign = loadCampaign(id);
    const contact = getContact(campaign, contactId);
    if (contact.status === 'drafted') throw new HttpError(409, 'Already in Gmail drafts. Edit it there.');
    for (const field of ['subject', 'body']) if (typeof body[field] === 'string') contact[field] = body[field];
    if (typeof body.email === 'string' && body.email.trim() !== (contact.email || '')) {
      contact.email = body.email.trim();
      contact.emailStatus = 'manual';
      contact.emailSource = 'you';
      delete contact.emailVerification;
    }
    if (body.status) {
      if (!['pending', 'approved', 'skipped'].includes(body.status)) throw new HttpError(400, 'Bad status');
      if (body.status === 'approved' && !isValidEmail(contact.email)) throw new HttpError(400, 'Add a valid email before approving');
      contact.status = body.status;
    }
    saveCampaign(campaign);
    return contact;
  }],

  ['POST', /^\/api\/campaigns\/([\w-]+)\/contacts\/([\w-]+)\/verify$/, async ([id, contactId]) => {
    const campaign = loadCampaign(id);
    const contact = getContact(campaign, contactId);
    if (!isValidEmail(contact.email)) throw new HttpError(400, 'No email to verify');
    const result = await hunterVerify(contact.email);
    if (result.skipped || result.error) throw new HttpError(400, result.skipped || result.error);
    contact.emailVerification = { status: result.status, at: new Date().toISOString() };
    if (result.status === 'valid') contact.emailStatus = 'verified';
    saveCampaign(campaign);
    return contact;
  }],

  ['POST', /^\/api\/campaigns\/([\w-]+)\/drafts$/, async ([id], body) => {
    try {
      return await createDraftsForCampaign(id, { contactIds: body.contactIds });
    } catch (err) {
      throw new HttpError(400, err.message); // setup problems (no resume, Gmail not connected) are for the user, not crashes
    }
  }],
];

// Saves an uploaded PDF into data/resume/. The body is the raw file; the name comes in a header.
async function uploadResume(req) {
  const name = decodeURIComponent(req.headers['x-filename'] || 'resume.pdf');
  const safe = path.basename(name).replace(/[^\w.-]+/g, '-').replace(/^-+/, '') || 'resume.pdf';
  const file = safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10_000_000) throw new HttpError(413, 'PDF is over 10 MB');
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (data.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'That file is not a PDF');
  fs.mkdirSync(RESUME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESUME_DIR, file), data);
  return { file, resumes: listResumes() };
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    // Anything that changes data must come from this page (custom header = other sites can't send it).
    if (req.method !== 'GET' && req.headers['x-coldmail'] !== '1') throw new HttpError(403, 'Forbidden');
    if (pathname === '/api/resume' && req.method === 'POST') {
      send(res, 200, await uploadResume(req));
      return;
    }
    if (pathname.startsWith('/api/')) {
      for (const [method, pattern, handler] of routes) {
        const match = pathname.match(pattern);
        if (match && req.method === method) {
          const body = ['POST', 'PATCH'].includes(method) ? await readBody(req) : {};
          send(res, 200, await handler(match.slice(1), body));
          return;
        }
      }
      throw new HttpError(404, 'Not found');
    }
    const file = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : path.normalize(pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    const status = err.status || (/^No campaign/.test(err.message) ? 404 : 500);
    if (status === 500) console.error(err);
    send(res, status, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Review page running at ${url} (Ctrl+C to stop)`);
  if (!process.argv.includes('--no-open') && process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore' }).on('error', () => {});
});
