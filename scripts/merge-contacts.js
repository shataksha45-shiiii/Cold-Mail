// Usage: npm run merge -- <campaign-id> <contacts.json>
//
// Safely adds people to a bundle, or fills in fields on people already in it,
// without rewriting the whole file (you may be editing it on the desk at the same time).
// The JSON file is an array of contact objects:
//   - no "id" (or an unknown one): appended as a new person with the next free id (c4, c5, ...)
//   - a known "id": its fields are merged in; contacts you approved, skipped or drafted are left alone
// Prints the ids it assigned, so you can pass them to `npm run find-emails -- <id> --only ...`.
import fs from 'node:fs';
import { findInHistory, loadCampaign, loadHistory, normalizeEmail, saveCampaign } from '../lib/store.js';

const [campaignId, file] = process.argv.slice(2);
if (!campaignId || !file) {
  console.error('Usage: npm run merge -- <campaign-id> <contacts.json>');
  process.exit(1);
}

let incoming;
try {
  incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`Could not read ${file}: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(incoming)) incoming = [incoming];

// Re-read right before writing so we merge onto the latest version of the file.
const campaign = loadCampaign(campaignId);
const history = loadHistory();
const key = (c) => `${(c.name || '').trim().toLowerCase()}|${(c.company || '').trim().toLowerCase()}`;
const nextId = () => {
  const max = campaign.contacts.reduce((m, c) => Math.max(m, Number(String(c.id).replace(/\D/g, '')) || 0), 0);
  return `c${max + 1}`;
};

const added = [];
const updated = [];
const skipped = [];
for (const raw of incoming) {
  const existing = raw.id && campaign.contacts.find((c) => c.id === raw.id);
  if (existing) {
    if (existing.status !== 'pending') {
      skipped.push(`${existing.id} ${existing.name} (already ${existing.status}, left as is)`);
      continue;
    }
    const { id, status, ...fields } = raw;
    Object.assign(existing, fields);
    updated.push(existing.id);
    continue;
  }
  const dupe = campaign.contacts.find((c) => key(c) === key(raw) || (raw.email && normalizeEmail(c.email) === normalizeEmail(raw.email)));
  if (dupe) { skipped.push(`${raw.name} (already in this bundle as ${dupe.id})`); continue; }
  const earlier = findInHistory(history, raw);
  if (earlier) { skipped.push(`${raw.name} (already emailed on ${earlier.draftedAt?.slice(0, 10)})`); continue; }

  const contact = {
    email: null, emailStatus: 'not_found', emailSourceUrl: null,
    hooks: [], sources: [], resumeHighlights: [], subject: '', body: '',
    ...raw,
    id: nextId(),
    status: 'pending',
    addedAt: new Date().toISOString(),
  };
  campaign.contacts.push(contact);
  added.push(contact.id);
}

saveCampaign(campaign);
console.log(`${campaign.id}: ${campaign.contacts.length} people now.`);
if (added.length) console.log(`  added: ${added.join(',')}`);
if (updated.length) console.log(`  updated: ${updated.join(',')}`);
for (const s of skipped) console.log(`  skipped: ${s}`);
