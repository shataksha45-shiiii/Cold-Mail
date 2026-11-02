// Reading and writing the JSON files in data/ (campaigns, profile, history).
import fs from 'node:fs';
import path from 'node:path';
import {
  CAMPAIGNS_DIR, HISTORY_FILE, PROFILE_FILE, RESUME_DIR,
} from './paths.js';

export const CONTACT_STATUSES = ['pending', 'approved', 'skipped', 'drafted'];
// public   = Claude found it on a real web page (emailSourceUrl says where)
// verified = Apollo/Hunter say it is deliverable
// likely   = Apollo/Hunter returned it but could not verify it
// manual   = you typed it in on the review page
// guessed  = inferred from a name pattern, no source
export const EMAIL_STATUSES = ['public', 'verified', 'likely', 'manual', 'guessed', 'not_found'];

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (err instanceof SyntaxError) throw new Error(`${path.relative(process.cwd(), file)} is not valid JSON: ${err.message}`);
    throw err;
  }
}

// Write to a temp file then rename, so a crash never leaves half a file behind.
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function campaignFile(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id || '')) throw new Error(`Invalid campaign id: "${id}"`);
  return path.join(CAMPAIGNS_DIR, `${id}.json`);
}

export function loadCampaign(id) {
  const file = campaignFile(id);
  if (!fs.existsSync(file)) throw new Error(`No campaign "${id}" in data/campaigns/`);
  return readJson(file);
}

export function saveCampaign(campaign) {
  campaign.updatedAt = new Date().toISOString();
  writeJson(campaignFile(campaign.id), campaign);
}

export function listCampaigns() {
  if (!fs.existsSync(CAMPAIGNS_DIR)) return [];
  return fs.readdirSync(CAMPAIGNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return readJson(path.join(CAMPAIGNS_DIR, f));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export const loadProfile = () => readJson(PROFILE_FILE, null);
export const loadHistory = () => readJson(HISTORY_FILE, { contacts: [] });
export const saveHistory = (history) => writeJson(HISTORY_FILE, history);

export const normalizeEmail = (email) => (email || '').trim().toLowerCase();
export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
const personKey = (c) => `${(c.name || '').trim().toLowerCase()}|${(c.company || '').trim().toLowerCase()}`;

// Has this person (same email, or same name at the same company) been emailed before?
export function findInHistory(history, contact) {
  const email = normalizeEmail(contact.email);
  return history.contacts.find(
    (h) => (email && normalizeEmail(h.email) === email) || personKey(h) === personKey(contact),
  ) || null;
}

export function listResumes() {
  if (!fs.existsSync(RESUME_DIR)) return [];
  return fs.readdirSync(RESUME_DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
}

// Which PDF gets attached: the campaign's choice, else the profile default, else the only/first PDF.
export function resolveResume(campaign, profile) {
  const resumes = listResumes();
  const wanted = campaign?.resumeFile || profile?.defaultResume;
  const file = wanted && resumes.includes(wanted) ? wanted : resumes[0];
  return file ? { file, path: path.join(RESUME_DIR, file) } : null;
}
