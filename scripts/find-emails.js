// Usage: npm run find-emails -- <campaign-id> [--verify-guesses] [--only id1,id2] [--max N] [--force]
//
// Runs the email lookup for every contact that still needs one. Contacts Claude
// already found a public email for are skipped, so Apollo/Hunter credits are
// only spent on the gaps.
import { findEmail } from '../lib/emailFinder.js';
import { loadCampaign, saveCampaign } from '../lib/store.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const campaignId = args.find((a, i) => !a.startsWith('--') && !['--only', '--max'].includes(args[i - 1]));

if (!campaignId) {
  console.error('Usage: npm run find-emails -- <campaign-id> [--verify-guesses] [--only id1,id2] [--max N] [--force]');
  process.exit(1);
}

const only = option('--only')?.split(',').map((s) => s.trim());
const max = Number(option('--max') || Infinity);
const force = flag('--force');

const campaign = loadCampaign(campaignId);
const needsLookup = (c) => {
  if (only) return only.includes(c.id);
  if (['skipped', 'drafted'].includes(c.status)) return false;
  if (force) return c.emailStatus !== 'public' && c.emailStatus !== 'manual';
  return !['public', 'verified', 'likely', 'manual'].includes(c.emailStatus);
};

const todo = campaign.contacts.filter(needsLookup).slice(0, max);
console.log(`${campaign.contacts.length} contacts, ${todo.length} need an email lookup.`);
if (!process.env.APOLLO_API_KEY) console.log('  (APOLLO_API_KEY not set, skipping Apollo)');
if (!process.env.HUNTER_API_KEY) console.log('  (HUNTER_API_KEY not set, skipping Hunter)');

for (const contact of todo) {
  const line = await findEmail(contact, { verifyGuesses: flag('--verify-guesses') });
  for (const a of contact.emailLookup?.attempts || []) {
    if (a.error) console.log(`    ! ${a.step}: ${a.error}`);
  }
  console.log(`- ${contact.name} (${contact.company}): ${line}`);
  saveCampaign(campaign); // save after each so a crash never loses lookups already paid for
}

const counts = {};
for (const c of campaign.contacts) counts[c.emailStatus || 'none'] = (counts[c.emailStatus || 'none'] || 0) + 1;
console.log('\nEmail status:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', '));
