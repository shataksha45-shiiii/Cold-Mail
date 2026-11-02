// Usage: npm run check -- <campaign-id>
// Validates a campaign file Claude wrote: required fields, email sources,
// duplicates, and people you've already emailed. Exits 1 if there are errors.
import { CONTACT_STATUSES, EMAIL_STATUSES, findInHistory, isValidEmail, loadCampaign, loadHistory, normalizeEmail } from '../lib/store.js';

const campaignId = process.argv[2];
if (!campaignId) {
  console.error('Usage: npm run check -- <campaign-id>');
  process.exit(1);
}

const campaign = loadCampaign(campaignId);
const history = loadHistory();
const errors = [];
const warnings = [];

if (campaign.id !== campaignId) errors.push(`"id" is "${campaign.id}" but the file is ${campaignId}.json`);
if (!campaign.targetRole) errors.push('Missing "targetRole"');
if (!Array.isArray(campaign.contacts)) {
  errors.push('"contacts" must be an array');
  campaign.contacts = [];
}

const seenIds = new Set();
const seenEmails = new Map();
for (const [i, c] of campaign.contacts.entries()) {
  const who = `${c.name || `contact #${i + 1}`}${c.company ? ` (${c.company})` : ''}`;
  const err = (m) => errors.push(`${who}: ${m}`);
  const warn = (m) => warnings.push(`${who}: ${m}`);

  if (!c.id) err('missing "id"');
  else if (seenIds.has(c.id)) err(`duplicate id "${c.id}"`);
  seenIds.add(c.id);
  for (const field of ['name', 'title', 'company', 'whyRelevant']) if (!c[field]) err(`missing "${field}"`);
  if (!Array.isArray(c.sources) || !c.sources.some((s) => s?.url)) err('needs at least one source with a "url"');
  if (!CONTACT_STATUSES.includes(c.status)) err(`"status" must be one of ${CONTACT_STATUSES.join(', ')}`);
  if (!EMAIL_STATUSES.includes(c.emailStatus)) err(`"emailStatus" must be one of ${EMAIL_STATUSES.join(', ')}`);
  if (c.email && !isValidEmail(c.email)) err(`"${c.email}" is not a valid email`);
  if (c.emailStatus === 'public' && !c.emailSourceUrl) err('emailStatus "public" needs "emailSourceUrl" (otherwise use "guessed")');
  if (!c.domain && c.emailStatus !== 'public') warn('no "domain", so Hunter and pattern guessing will struggle');

  if (c.email) {
    const e = normalizeEmail(c.email);
    if (seenEmails.has(e)) err(`same email as ${seenEmails.get(e)}`);
    seenEmails.set(e, who);
  }
  const earlier = findInHistory(history, c);
  if (earlier && earlier.campaignId !== campaign.id) warn(`already emailed on ${earlier.draftedAt?.slice(0, 10)} (campaign ${earlier.campaignId})`);

  if (c.body) {
    const words = c.body.trim().split(/\s+/).length;
    if (words > 180) warn(`body is ${words} words, aim for under 150`);
    if (/\[[^\]]+\]|\{\{|TODO|lorem/i.test(c.body)) err('body has a placeholder like [..], {{..}} or TODO');
    if (!c.subject) err('has a body but no subject');
  }
}

const drafted = campaign.contacts.filter((c) => c.body).length;
console.log(`${campaign.id}: ${campaign.contacts.length} contacts, ${drafted} with an email written.`);
for (const e of errors) console.log(`  ✗ ${e}`);
for (const w of warnings) console.log(`  ! ${w}`);
if (!errors.length) console.log('  ✓ no errors');
process.exit(errors.length ? 1 : 0);
