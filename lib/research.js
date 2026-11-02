// The hosted version of the /coldmail playbook, on the Claude API:
//   1. parseResume   - PDF -> structured profile (structured output)
//   2. research      - agent loop with web search + web fetch; people are saved through a
//                      save_person tool as they're found, which drives the live progress
//   3. (emailFinder) - Apollo / Hunter for anyone without a public email
//   4. writeEmails   - one structured call that writes every postcard
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';
// Server-side refusal fallback: if a safety classifier declines, the API re-runs on a suitable model.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

let anthropic;
const client = () => (anthropic ??= new Anthropic()); // reads ANTHROPIC_API_KEY

const hostname = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};
const textOf = (message) => message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

// ---------- 1. Resume -> profile ----------
const str = { type: 'string' };
const strList = { type: 'array', items: str };
const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'email', 'phone', 'headline', 'links', 'education', 'experience', 'projects', 'skills', 'achievements', 'signature'],
  properties: {
    name: str, email: str, phone: str, headline: str,
    links: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'url'], properties: { label: str, url: str } } },
    education: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['school', 'degree', 'dates'], properties: { school: str, degree: str, dates: str } } },
    experience: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role', 'org', 'dates', 'bullets', 'tags'], properties: { role: str, org: str, dates: str, bullets: strList, tags: strList } } },
    projects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'description', 'tech', 'link', 'tags'], properties: { name: str, description: str, tech: strList, link: str, tags: strList } } },
    skills: strList,
    achievements: strList,
    signature: str,
  },
};

export async function parseResume(pdf) {
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PROFILE_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
        {
          type: 'text',
          text: [
            'Turn this resume into the structured profile. Copy facts exactly; never invent anything.',
            'tags: short lowercase topic words for each experience and project (e.g. fintech, security, ml, growth, design, drones) so they can be matched to people later.',
            'links: only URLs written on the resume; empty list if none are visible.',
            'signature: the person\'s name, then phone and email on one line separated by " · ", then any links written on the resume. Plain text, newlines between lines. Leave out what isn\'t on the resume.',
            'Use an empty string for anything missing.',
          ].join('\n'),
        },
      ],
    }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new Error('Claude could not read this resume.');
  return JSON.parse(textOf(message));
}

// ---------- 2. Research people ----------
const SAVE_PERSON = {
  name: 'save_person',
  description: 'Record one person to email, as soon as you have confirmed them. Call once per person.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'title', 'company', 'domain', 'linkedin', 'why_relevant', 'hooks', 'sources', 'email', 'email_source_url'],
    properties: {
      name: { type: 'string', description: 'Full name' },
      title: { type: 'string', description: 'Current job title' },
      company: { type: 'string' },
      domain: { type: 'string', description: 'Company email domain, usually the website domain, e.g. acme.com. Empty if unknown.' },
      linkedin: { type: 'string', description: 'LinkedIn URL if seen, else empty' },
      why_relevant: { type: 'string', description: 'One or two sentences: why this person fits this job seeker' },
      hooks: { type: 'array', items: { type: 'string' }, description: '1-3 specific, verifiable facts to personalise with (something they shipped, wrote, said, or their team works on)' },
      sources: {
        type: 'array',
        description: 'Every page used for this person',
        items: { type: 'object', additionalProperties: false, required: ['url', 'title', 'note'], properties: { url: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' } } },
      },
      email: { type: 'string', description: 'Their email ONLY if you saw it written on a page, else empty' },
      email_source_url: { type: 'string', description: 'The page where that email is written, else empty' },
    },
  },
};

const RESEARCH_SYSTEM = `You find the right people for a job seeker to cold-email, using web search and web fetch.

Rules:
- Only real people. Confirm from a page you actually read that they currently hold the role (recent team page, profile snippet, news, talk, post). Never invent people, facts or email addresses.
- Prefer people who can say yes: the hiring manager for the role, team leads, founders/CTOs at small startups, recruiters who hire for that team. Prefer people who would work with the job seeker over generic HR.
- Pick people whose work overlaps the job seeker's profile, so their email can be specific. Spread across companies; avoid near-duplicates.
- For each person, gather 1-3 hooks: specific, verifiable facts to open an email with. Never generic praise.
- An email address counts only if you saw it written on a page; give that page as email_source_url. Do not guess addresses; the system looks them up afterwards.
- Call save_person as soon as each person is confirmed. Stop once you've saved the number asked for.
- Never save anyone on the exclusion list.`;

/**
 * Runs the research loop. Calls onPerson(input) for each save_person call; it returns a short
 * string that goes back to Claude (e.g. "saved", or why it was rejected). onStep(text) reports progress.
 */
export async function research({ profile, target, count, searchPlan, exclude, onPerson, onStep, onNote, signal, isFull }) {
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: Math.min(60, count * 4) },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: Math.min(45, count * 3) },
    SAVE_PERSON,
  ];
  const brief = [
    `Job seeker's profile (JSON):\n${JSON.stringify(profile)}`,
    `What they want: ${target}`,
    searchPlan ? `Search plan used so far for this bundle: ${searchPlan}` : '',
    `Find ${count} people and save each with save_person.`,
    exclude.length ? `Exclusion list (already in the bundle or already emailed), do not save these:\n${exclude.map((e) => `- ${e}`).join('\n')}` : '',
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ].filter(Boolean).join('\n\n');

  const messages = [{ role: 'user', content: brief }];
  for (let turn = 0; turn < 40; turn += 1) {
    const stream = client().beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      system: RESEARCH_SYSTEM,
      output_config: { effort: 'high' },
      tools,
      messages,
      ...FALLBACK,
    }, { signal });

    stream.on('contentBlock', (block) => {
      if (block.type === 'server_tool_use' && block.name === 'web_search') onStep(`searching “${block.input?.query ?? ''}”`);
      else if (block.type === 'server_tool_use' && block.name === 'web_fetch') onStep(`reading ${hostname(block.input?.url ?? '')}`);
      else if (block.type === 'text' && block.text.trim()) onNote(block.text.trim().slice(0, 400));
    });

    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('Claude declined this search. Try describing the role differently.');
    messages.push({ role: 'assistant', content: message.content });
    if (message.stop_reason === 'pause_turn') continue; // server tools hit their per-turn limit; resume
    if (message.stop_reason === 'max_tokens') throw new Error('The research step ran out of room. Try fewer people.');

    const calls = message.content.filter((b) => b.type === 'tool_use');
    if (!calls.length) return textOf(message); // finished

    const results = [];
    for (const call of calls) {
      let content;
      if (call.name !== 'save_person') content = `Unknown tool ${call.name}`;
      else content = await onPerson(call.input);
      results.push({ type: 'tool_result', tool_use_id: call.id, content });
    }
    if (isFull()) {
      results.push({ type: 'text', text: 'That is everyone needed. Stop researching and reply with one short paragraph on anything worth double-checking.' });
    }
    messages.push({ role: 'user', content: results });
  }
  return '';
}

// ---------- 4. Write the emails ----------
const EMAILS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['emails'],
  properties: {
    emails: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'subject', 'body', 'resume_highlights'],
        properties: { id: str, subject: str, body: str, resume_highlights: strList },
      },
    },
  },
};

const WRITING_RULES = `Write one cold email per person, from the job seeker.
- Pick the 1-2 resume items (experience, projects, achievements) that best match this person's work, using their hooks and the profile tags. List them in resume_highlights (e.g. "Project: PhishGuard (security)").
- Open with one hook, specifically and honestly. No "I hope this finds you well", no flattery.
- Then who the job seeker is in one line, the matched items with a concrete result, and one small clear ask (a 15-minute chat, or whether they are hiring for the role).
- If a resume is attached, say so briefly.
- 80-150 words, plain text, no markdown, no emojis, short paragraphs.
- Subject: specific, under 8 words, never clickbait.
- No signature or sign-off name: end with the ask or a plain "Thanks," line. The signature is added automatically.
- No placeholders like [Company]. If a detail is missing, write around it.
- Never invent facts about either person.`;

export async function writeEmails({ profile, style, target, contacts, attachResume }) {
  const people = contacts.map((c) => ({
    id: c.id, name: c.name, title: c.title, company: c.company, why_relevant: c.whyRelevant, hooks: c.hooks,
  }));
  const stream = client().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: WRITING_RULES,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: EMAILS_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        `Job seeker's profile (JSON):\n${JSON.stringify(profile)}`,
        `They are looking for: ${target}`,
        `Resume attached to each email: ${attachResume ? 'yes' : 'no'}`,
        style ? `Emails they liked; match this tone:\n${style}` : '',
        `People (JSON):\n${JSON.stringify(people)}`,
        'Write exactly one email per person, using their id.',
      ].filter(Boolean).join('\n\n'),
    }],
    ...FALLBACK,
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new Error('Claude declined to write these emails.');
  return JSON.parse(textOf(message)).emails;
}
