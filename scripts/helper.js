// Usage: npm run helper
//
// Connects this laptop to your hosted coldmail site. When you start a search on the site,
// this helper picks it up, runs it here with Claude Code (the same /coldmail playbook, on
// your Claude plan), streams progress back so the site's tracker moves, and uploads the
// people and postcards when it's done. Keep it running while you want searches to work.
//
// Needs in .env:  COLDMAIL_URL=https://your-site.onrender.com
//                 COLDMAIL_WORKER_TOKEN=<WORKER_TOKEN from the site's settings>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA, RESUME_DIR } from '../lib/paths.js';
import { latestRun, startRun, stopRun } from '../lib/runs.js';
import { campaignFile, readJson, writeJson } from '../lib/store.js';

const SITE = (process.env.COLDMAIL_URL || '').replace(/\/$/, '');
const TOKEN = process.env.COLDMAIL_WORKER_TOKEN || '';
const IDLE_POLL_MS = 15_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

if (!SITE || !TOKEN) {
  console.error('Add COLDMAIL_URL and COLDMAIL_WORKER_TOKEN to .env first (see DEPLOY.md on the product branch).');
  process.exit(1);
}

async function site(pathname, body) {
  const res = await fetch(`${SITE}${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `${res.status} ${res.statusText}`), { status: res.status });
  return json;
}

// The site stores "sent"; the laptop playbook calls the same thing "drafted".
const toLocalStatus = (s) => (s === 'sent' ? 'drafted' : s);

function extraNote(job) {
  const lines = [];
  if (job.alreadyEmailed?.length) {
    lines.push('People already emailed from the coldmail website (treat exactly like data/history.json; never pick them again):');
    for (const h of job.alreadyEmailed) lines.push(`- ${h.name} (${h.company})${h.email ? `, ${h.email}` : ''}`);
  }
  if (job.style?.trim()) lines.push('', 'Emails the user liked; match their tone:', job.style.trim());
  return lines.join('\n');
}

// Puts the site's resume where the playbook can read it. Never overwrites a file that's already
// here: an identical file is reused; a different one is saved alongside under a new name.
function saveResume({ filename, data }) {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('The site sent a resume that is not a PDF.');
  const name = path.basename(filename);
  const existing = path.join(RESUME_DIR, name);
  if (fs.existsSync(existing) && fs.readFileSync(existing).equals(bytes)) return name;
  let target = name;
  if (fs.existsSync(existing)) {
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    target = `${name.replace(/\.pdf$/i, '')}-site-${hash}.pdf`;
  }
  fs.mkdirSync(RESUME_DIR, { recursive: true });
  if (!fs.existsSync(path.join(RESUME_DIR, target))) fs.writeFileSync(path.join(RESUME_DIR, target), bytes, { flag: 'wx' });
  return target;
}

async function handle(job) {
  const { run, campaign } = job;
  console.log(`[${stamp()}] picked up: ${run.mode === 'more' ? `${run.count} more for` : `${run.count} people for`} “${run.target}”`);
  let resumeFile;
  try {
    resumeFile = saveResume(job.resume);
  } catch (err) {
    await site(`/api/worker/runs/${run.id}/finish`, { status: 'failed', error: err.message });
    return;
  }

  // For "add people", put the site's bundle here so the playbook's merge step can extend it.
  let originalIds = new Set();
  if (run.mode === 'more') {
    const local = {
      ...campaign,
      resumeFile,
      contacts: campaign.contacts.map((c) => ({ ...c, status: toLocalStatus(c.status) })),
    };
    originalIds = new Set(local.contacts.map((c) => c.id));
    writeJson(campaignFile(campaign.id), local);
  }

  let local;
  try {
    local = run.mode === 'more'
      ? startRun({ moreFor: campaign.id, count: run.count, extraNote: extraNote(job) })
      : startRun({ target: run.target, count: run.count, resumeFile, extraNote: extraNote(job) });
  } catch (err) {
    await site(`/api/worker/runs/${run.id}/finish`, { status: 'failed', error: err.message });
    return;
  }

  // Mirror progress to the site every few seconds until the local run ends.
  let lastSent = '';
  let lastPost = 0;
  while (true) {
    await sleep(3000);
    const now = latestRun();
    const payload = { phase: now.phase, events: now.events, lastNote: now.lastNote || '' };
    const fingerprint = JSON.stringify(payload);
    // Report on change, and at least once a minute so the site sees we're alive and can ask us to stop.
    if (fingerprint !== lastSent || now.status !== 'running' || Date.now() - lastPost > 60_000) {
      lastPost = Date.now();
      try {
        const { stop } = await site(`/api/worker/runs/${run.id}/progress`, payload);
        lastSent = fingerprint;
        if (stop && now.status === 'running') {
          console.log(`[${stamp()}] stop requested on the site`);
          stopRun();
        }
      } catch (err) {
        if (err.status === 409) stopRun(); // the site gave up on this run
        else console.log(`[${stamp()}] couldn't reach the site (${err.message}); still working`);
      }
    }
    if (now.status !== 'running') { local = now; break; }
  }

  // Upload the results.
  const localId = run.mode === 'more' ? campaign.id : local.campaignId;
  const bundle = localId && fs.existsSync(campaignFile(localId)) ? readJson(campaignFile(localId)) : null;
  const contacts = (bundle?.contacts || []).filter((c) => !originalIds.has(c.id));
  const result = await site(`/api/worker/runs/${run.id}/finish`, {
    status: local.status === 'done' ? 'done' : 'failed',
    summary: local.summary || '',
    error: local.error || (local.status === 'stopped' ? 'Stopped.' : ''),
    contacts,
    searchPlan: bundle?.searchPlan || '',
  });
  console.log(`[${stamp()}] ${local.status}: ${result.added} ${result.added === 1 ? 'person' : 'people'} added to the site`);

  // The site now holds the bundle; drop the local copies so they don't show up in the laptop app.
  if (localId) fs.rmSync(campaignFile(localId), { force: true });
  fs.rmSync(path.join(DATA, 'runs', `more-${campaign.id}.json`), { force: true });
}

console.log(`coldmail helper connected to ${SITE}. Leave this running; Ctrl+C to stop.`);
let warned = false;
while (true) {
  try {
    const job = await site('/api/worker/next');
    warned = false;
    if (job.run) await handle(job);
    else await sleep(IDLE_POLL_MS);
  } catch (err) {
    if (err.status === 401) {
      console.error('The site rejected the helper token. Check COLDMAIL_WORKER_TOKEN in .env matches WORKER_TOKEN on the site.');
      process.exit(1);
    }
    if (!warned) console.log(`[${stamp()}] can't reach ${SITE} (${err.message}). Retrying…`);
    warned = true;
    await sleep(IDLE_POLL_MS);
  }
}
