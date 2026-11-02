// Usage: npm run drafts -- <campaign-id>
// Same as the "Create Gmail drafts" button on the review page.
import { createDraftsForCampaign } from '../lib/drafts.js';

const campaignId = process.argv[2];
if (!campaignId) {
  console.error('Usage: npm run drafts -- <campaign-id>');
  process.exit(1);
}

const results = await createDraftsForCampaign(campaignId);
if (!results.length) console.log('No approved contacts to draft. Approve some on the review page first.');
for (const r of results) console.log(r.ok ? `✓ ${r.name}: draft created` : `✗ ${r.name}: ${r.error}`);
