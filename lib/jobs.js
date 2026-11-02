// Starts and tracks research runs for the hosted app: one run per user at a time,
// a monthly allowance per user, progress saved to the runs table for the tracker page.
import crypto from 'node:crypto';
import { findEmail } from './emailFinder.js';
import { isValidEmail, normalizeEmail } from './store.js';
import * as repo from './repo.js';
import { parseResume, research, writeEmails } from './research.js';

const active = new Map(); // userId -> { run, abort }
const MAX_PEOPLE = 15;
const GLOBAL_LIMIT = Number(process.env.MAX_CONCURRENT_RUNS || 3);

const adminEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = (user) => adminEmails().includes(user.email.toLowerCase());
export const monthlyLimit = (user) => (isAdmin(user) ? Infinity : Number(process.env.MONTHLY_RUN_LIMIT || 3));

// Where a user's searches run: the owner's laptop helper (free, on their Claude plan),
// the Claude API (paid, needs ANTHROPIC_API_KEY), or nowhere.
export function searchEngine(user) {
  if (isAdmin(user) && process.env.WORKER_TOKEN) return 'laptop';
  if (process.env.ANTHROPIC_API_KEY) return 'api';
  return 'off';
}

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function usage(user) {
  const limit = monthlyLimit(user);
  const used = await repo.runsThisMonth(user.id);
  return { used, limit: Number.isFinite(limit) ? limit : null };
}

export function activeRun(userId) {
  return active.get(userId)?.run || null;
}

// Either a new bundle ({ target, count, resumeId }) or more people for one ({ moreFor, count }).
export async function startRun(user, { target, count, resumeId, moreFor }) {
  const engine = searchEngine(user);
  if (engine === 'off') throw new UserError('Searching is turned off on this site.', 503);
  if (active.has(user.id) || (engine === 'laptop' && await repo.openLaptopRun(user.id))) {
    throw new UserError('A search is already running or waiting. Wait for it, or stop it first.', 409);
  }
  if (engine === 'api' && active.size >= GLOBAL_LIMIT) throw new UserError('coldmail is busy right now. Please try again in a few minutes.', 503);
  const { used, limit } = await usage(user);
  if (limit !== null && used >= limit) throw new UserError(`You've used all ${limit} searches for this month. They reset on the 1st.`, 429);
  const n = Math.min(MAX_PEOPLE, Math.max(1, Number(count) || 10));

  let campaign;
  if (moreFor) {
    campaign = await repo.getCampaign(user.id, moreFor);
  } else {
    const cleanTarget = String(target || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (cleanTarget.length < 3) throw new UserError('Describe the role you want first.');
    const resume = await repo.getResume(user.id, Number(resumeId));
    campaign = await repo.createCampaign(user.id, {
      id: repo.newCampaignId(cleanTarget),
      targetRole: cleanTarget,
      searchPlan: '',
      resumeId: resume.id,
      attachResume: true,
      createdAt: new Date().toISOString(),
      contacts: [],
    });
  }

  const run = {
    id: `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`,
    engine,
    mode: moreFor ? 'more' : 'new',
    target: campaign.targetRole,
    count: n,
    campaignId: campaign.id,
    status: 'running',
    phase: 'resume',
    startedAt: new Date().toISOString(),
    events: [],
  };
  if (engine === 'laptop') {
    // The laptop helper picks it up (GET /api/worker/next) and reports back.
    run.status = 'queued';
    run.phase = 'resume';
    await repo.createRun(user.id, run);
    return run;
  }
  await repo.createRun(user.id, run);
  const abort = new AbortController();
  active.set(user.id, { run, abort });
  execute(user, run, abort.signal).finally(() => active.delete(user.id));
  return run;
}

export async function stopRun(userId) {
  const entry = active.get(userId);
  if (entry) {
    entry.run.stopped = true;
    entry.abort.abort();
    return entry.run;
  }
  const laptop = await repo.openLaptopRun(userId);
  if (!laptop) return null;
  if (laptop.status === 'queued') {
    Object.assign(laptop, { status: 'stopped', endedAt: new Date().toISOString() });
    await dropEmptyNewBundle(userId, laptop);
  } else {
    laptop.stopRequested = true; // the helper sees this on its next progress report and stops
  }
  await repo.saveRun(userId, laptop);
  return laptop;
}

// A brand-new bundle that ended up with nobody in it is just clutter.
export async function dropEmptyNewBundle(userId, run) {
  if (run.mode !== 'new' || !run.campaignId) return;
  const left = await repo.getCampaign(userId, run.campaignId).catch(() => null);
  if (left && !left.contacts.length) {
    await repo.deleteCampaign(userId, run.campaignId);
    run.campaignId = null;
  }
}

async function execute(user, run, signal) {
  let lastSave = 0;
  const persist = async (force = false) => {
    if (!force && Date.now() - lastSave < 1500) return;
    lastSave = Date.now();
    await repo.saveRun(user.id, run).catch(() => {});
  };
  const step = (text) => {
    run.events.push({ at: new Date().toISOString(), text });
    persist();
  };
  const PHASES = ['resume', 'research', 'emails', 'writing', 'done'];
  const phase = (p) => {
    if (PHASES.indexOf(p) > PHASES.indexOf(run.phase)) run.phase = p;
    persist(true);
  };

  try {
    const campaign = await repo.getCampaign(user.id, run.campaignId);
    const resume = await repo.getResume(user.id, campaign.resumeId);

    // 1. Profile from the resume this bundle uses (re-read only when it changed).
    let fresh = await repo.getUser(user.id);
    if (!fresh.profile || fresh.profile_resume_id !== resume.id) {
      step('reading your resume');
      await repo.updateUser(user.id, { profile_status: 'parsing' });
      const profile = await parseResume(resume.data);
      fresh = await repo.updateUser(user.id, {
        profile, profile_status: 'ready', profile_resume_id: resume.id,
        ...(fresh.signature ? {} : { signature: profile.signature }),
      });
    } else {
      step('your resume is already read');
    }

    // 2. Research. Everyone already in the bundle or already emailed is excluded.
    phase('research');
    const history = await repo.listHistory(user.id);
    const exclude = [
      ...campaign.contacts.map((c) => `${c.name} (${c.company})`),
      ...history.map((h) => `${h.name} (${h.company})`),
    ];
    const known = new Set([...campaign.contacts, ...history].map((c) => `${(c.name || '').toLowerCase()}|${(c.company || '').toLowerCase()}`));
    const knownEmails = new Set([...campaign.contacts, ...history].map((c) => normalizeEmail(c.email)).filter(Boolean));
    const addedIds = [];

    const onPerson = async (p) => {
      const key = `${p.name.trim().toLowerCase()}|${p.company.trim().toLowerCase()}`;
      const sources = (p.sources || []).filter((s) => /^https?:\/\//.test(s.url));
      if (!p.name.trim() || !p.company.trim()) return 'Rejected: name and company are required.';
      if (!sources.length) return 'Rejected: give at least one source URL you actually read.';
      if (known.has(key) || (p.email && knownEmails.has(normalizeEmail(p.email)))) return 'Rejected: already in this bundle or already emailed. Find someone else.';
      if (addedIds.length >= run.count) return 'Not saved: you already have everyone needed.';
      const publicEmail = isValidEmail(p.email) && /^https?:\/\//.test(p.email_source_url);
      const id = await repo.updateCampaign(user.id, run.campaignId, (c) => {
        const max = c.contacts.reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0), 0);
        const contact = {
          id: `c${max + 1}`,
          name: p.name.trim(), title: p.title.trim(), company: p.company.trim(),
          domain: p.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null,
          linkedin: /^https?:\/\//.test(p.linkedin) ? p.linkedin : null,
          whyRelevant: p.why_relevant.trim(),
          hooks: p.hooks.slice(0, 3),
          sources,
          email: publicEmail ? p.email.trim() : null,
          emailStatus: publicEmail ? 'public' : 'not_found',
          emailSourceUrl: publicEmail ? p.email_source_url : null,
          resumeHighlights: [], subject: '', body: '',
          status: 'pending',
          ...(run.mode === 'more' ? { addedAt: new Date().toISOString() } : {}),
        };
        c.contacts.push(contact);
        return contact.id;
      });
      known.add(key);
      if (publicEmail) knownEmails.add(normalizeEmail(p.email));
      addedIds.push(id);
      step(`found ${p.name.trim()} (${p.company.trim()})`);
      return `Saved as ${id} (${addedIds.length} of ${run.count}).`;
    };

    const note = await research({
      profile: fresh.profile,
      target: run.target,
      count: run.count,
      searchPlan: campaign.searchPlan,
      exclude,
      onPerson,
      onStep: step,
      onNote: (text) => { run.lastNote = text; persist(); },
      signal,
      isFull: () => addedIds.length >= run.count,
    });
    if (!addedIds.length) throw new Error('No one suitable was found. Try a broader description.');

    // 3. Emails for anyone without a public address (Apollo, then Hunter, then a guess).
    phase('emails');
    step('looking up email addresses');
    const current = await repo.getCampaign(user.id, run.campaignId);
    for (const id of addedIds) {
      const contact = current.contacts.find((c) => c.id === id);
      if (!contact || contact.emailStatus === 'public') continue;
      if (signal.aborted) throw new Error('stopped');
      await findEmail(contact);
      await repo.updateCampaign(user.id, run.campaignId, (c) => {
        const target = c.contacts.find((x) => x.id === id);
        if (target && target.status === 'pending') {
          for (const field of ['email', 'emailStatus', 'emailSource', 'emailDetail', 'emailAlternates', 'emailVerification']) target[field] = contact[field];
        }
      });
    }

    // 4. Write the postcards.
    phase('writing');
    step('writing postcards');
    const latest = await repo.getCampaign(user.id, run.campaignId);
    const toWrite = latest.contacts.filter((c) => addedIds.includes(c.id));
    const emails = await writeEmails({ profile: fresh.profile, style: fresh.style, target: run.target, contacts: toWrite, attachResume: latest.attachResume !== false });
    await repo.updateCampaign(user.id, run.campaignId, (c) => {
      for (const e of emails) {
        const target = c.contacts.find((x) => x.id === e.id && addedIds.includes(x.id));
        if (target && target.status === 'pending') Object.assign(target, { subject: e.subject.trim(), body: e.body.trim(), resumeHighlights: e.resume_highlights });
      }
      if (!c.searchPlan) c.searchPlan = `Looked for: ${run.target}`;
    });

    const final = (await repo.getCampaign(user.id, run.campaignId)).contacts.filter((c) => addedIds.includes(c.id));
    const count = (s) => final.filter((c) => c.emailStatus === s).length;
    run.summary = [
      `**${addedIds.length} ${addedIds.length === 1 ? 'person' : 'people'}** ${run.mode === 'more' ? 'added to your bundle' : 'found'}.`,
      `Emails: ${count('public')} found publicly, ${count('verified') + count('likely')} from Apollo/Hunter, ${count('guessed')} guessed, ${count('not_found')} missing.`,
      note ? `\n${note}` : '',
    ].join('\n').trim();
    run.status = 'done';
    run.phase = 'done';
  } catch (err) {
    run.status = run.stopped ? 'stopped' : 'failed';
    if (!run.stopped) {
      console.error(`run ${run.id} failed:`, err);
      run.error = err.status === 401 ? 'The Claude API key is missing or invalid (server setting).' : err.message;
    }
    await dropEmptyNewBundle(user.id, run);
  }
  run.endedAt = new Date().toISOString();
  await persist(true);
}
