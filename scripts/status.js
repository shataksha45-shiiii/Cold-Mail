// Usage: npm run status [-- --json]
// One-glance checklist of what is set up. /coldmail runs this first.
import fs from 'node:fs';
import path from 'node:path';
import { gmailConnection } from '../lib/google.js';
import { GOOGLE_CREDENTIALS_FILE, PROFILE_FILE, RESUME_DIR, STYLE_FILE } from '../lib/paths.js';
import { listCampaigns, listResumes, loadHistory, loadProfile } from '../lib/store.js';

const resumes = listResumes();
const profile = loadProfile();
let profileStale = false;
if (profile?.sourceResume && resumes.includes(profile.sourceResume)) {
  const resumeTime = fs.statSync(path.join(RESUME_DIR, profile.sourceResume)).mtimeMs;
  profileStale = resumeTime > fs.statSync(PROFILE_FILE).mtimeMs;
}

const status = {
  resumes,
  profile: profile ? { name: profile.name, sourceResume: profile.sourceResume, stale: profileStale, hasSignature: Boolean(profile.signature) } : null,
  styleExamples: fs.existsSync(STYLE_FILE),
  apolloKey: Boolean(process.env.APOLLO_API_KEY),
  hunterKey: Boolean(process.env.HUNTER_API_KEY),
  googleCredentials: fs.existsSync(GOOGLE_CREDENTIALS_FILE),
  gmail: gmailConnection(),
  campaigns: listCampaigns().map((c) => ({
    id: c.id,
    targetRole: c.targetRole,
    contacts: c.contacts.length,
    drafted: c.contacts.filter((x) => x.status === 'drafted').length,
  })),
  previouslyContacted: loadHistory().contacts.length,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}

const tick = (ok, label, hint = '') => console.log(`${ok ? '✓' : '✗'} ${label}${!ok && hint ? `  → ${hint}` : ''}`);
tick(resumes.length > 0, `Resume PDF${resumes.length ? `: ${resumes.join(', ')}` : ''}`, 'put your resume in data/resume/');
tick(Boolean(profile) && !profileStale, profile ? `Profile parsed from ${profile.sourceResume}${profileStale ? ' (resume changed since, re-parse)' : ''}` : 'Profile', 'run /coldmail and it will parse your resume');
tick(Boolean(profile?.signature), 'Email signature', 'set "signature" in data/profile.json');
tick(status.styleExamples, 'Style examples (optional)', 'paste 1–2 emails you liked into data/style-examples.md');
tick(status.apolloKey, 'Apollo API key (optional)', 'add APOLLO_API_KEY to .env');
tick(status.hunterKey, 'Hunter API key (optional)', 'add HUNTER_API_KEY to .env');
tick(status.googleCredentials, 'Google OAuth client', 'see "Connect Gmail" in README.md');
tick(status.gmail.connected, `Gmail connected${status.gmail.email ? ` as ${status.gmail.email}` : ''}`, 'run: npm run auth');
console.log(`\n${status.campaigns.length} campaign(s), ${status.previouslyContacted} people emailed so far.`);
for (const c of status.campaigns) console.log(`  - ${c.id}: ${c.contacts} contacts, ${c.drafted} drafted (${c.targetRole})`);
