// Turns approved contacts into Gmail drafts with the resume attached, and records
// each one in data/history.json so nobody gets emailed twice.
import fs from 'node:fs';
import { createDraft, gmailConnection } from './google.js';
import { buildMessage, composeBody, formatAddress } from './mime.js';
import {
  findInHistory, isValidEmail, loadCampaign, loadHistory, loadProfile, resolveResume, saveCampaign, saveHistory,
} from './store.js';

export async function createDraftsForCampaign(campaignId, { contactIds } = {}) {
  const campaign = loadCampaign(campaignId);
  const profile = loadProfile();
  const history = loadHistory();
  const { email: fromEmail } = gmailConnection();

  const resume = campaign.attachResume === false ? null : resolveResume(campaign, profile);
  if (campaign.attachResume !== false && !resume) throw new Error('No resume PDF found in data/resume/');
  const attachment = resume && { filename: resume.file, data: fs.readFileSync(resume.path), contentType: 'application/pdf' };

  const targets = campaign.contacts.filter(
    (c) => c.status === 'approved' && (!contactIds || contactIds.includes(c.id)),
  );

  const results = [];
  for (const contact of targets) {
    const fail = (error) => results.push({ id: contact.id, name: contact.name, ok: false, error });
    if (!isValidEmail(contact.email)) { fail('No valid email address'); continue; }
    if (!contact.subject?.trim() || !contact.body?.trim()) { fail('Subject or body is empty'); continue; }

    const earlier = findInHistory(history, contact);
    if (earlier && earlier.campaignId !== campaign.id) {
      contact.previouslyContacted = earlier;
    }

    try {
      const raw = buildMessage({
        from: fromEmail && profile?.name ? formatAddress(profile.name, fromEmail) : undefined,
        to: formatAddress(contact.name, contact.email),
        subject: contact.subject,
        text: composeBody(contact.body, profile?.signature),
        attachment,
      });
      const draft = await createDraft(raw);
      Object.assign(contact, { status: 'drafted', draftId: draft.id, draftedAt: new Date().toISOString() });
      history.contacts.push({
        name: contact.name, company: contact.company, email: contact.email,
        campaignId: campaign.id, subject: contact.subject, draftedAt: contact.draftedAt,
      });
      results.push({ id: contact.id, name: contact.name, ok: true, draftId: draft.id });
    } catch (err) {
      fail(err.message);
      if (/not connected|expired|google-credentials/i.test(err.message)) break; // every other one would fail the same way
    }
    saveCampaign(campaign);
    saveHistory(history);
  }
  saveCampaign(campaign);
  return results;
}
