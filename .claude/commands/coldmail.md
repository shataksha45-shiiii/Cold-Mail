---
description: Find the right people for a target role, look up their emails, and write a personalised cold email to each, ready for review
argument-hint: <role you want, e.g. "PM intern at early-stage AI startups in India"> [number of people, default 15]  |  more <N> for <bundle-id>
allowed-tools: Read, Write, Edit, Glob, WebSearch, WebFetch, Bash(npm run status*), Bash(npm run check*), Bash(npm run find-emails*), Bash(npm run merge*), Bash(npm run review*)
---

You are running the cold-mail pipeline for the user. Target: **$ARGUMENTS**

Work through the phases in order. Keep the user posted with one short line per phase. Never invent people, facts, or email addresses: everything you write down must come from a page you actually read.

**Adding people to an existing bundle:** if the target looks like `more <N> for <bundle-id>`, skip to the section "Adding more people" at the end. Otherwise start at Phase 0.

## Phase 0: Check setup

Run `npm run status -- --json`.
- No resume PDF in `data/resume/` → stop and tell the user to put their resume there.
- If the request names a resume (e.g. "use my tech resume"), match it to a file in `data/resume/`.
- Gmail/Apollo/Hunter missing is fine for now. Mention it in one line and carry on.

## Phase 1: Understand the resume

If `data/profile.json` is missing, or `profile.stale` is true, read the resume PDF and write `data/profile.json`:

```json
{
  "name": "", "email": "", "phone": "",
  "links": { "linkedin": "", "github": "", "portfolio": "" },
  "headline": "one line: who they are",
  "education": [{ "school": "", "degree": "", "dates": "", "details": [] }],
  "experience": [{ "role": "", "org": "", "dates": "", "bullets": [], "tags": ["product", "security", "..."] }],
  "projects": [{ "name": "", "description": "", "tech": [], "link": "", "tags": [] }],
  "skills": { "technical": [], "product": [], "other": [] },
  "achievements": [],
  "signature": "Name\nPhone · email\nLinkedIn: url · GitHub: url",
  "defaultResume": "file.pdf",
  "sourceResume": "file.pdf"
}
```

`tags` are short topic words (fintech, security, ml, growth, design...) so you can match resume items to people later. Build `signature` from the contact details on the resume; only include links that are on it. If a profile already exists and is fresh, just read it (and the resume, if this campaign uses a different one).

Also read `data/style-examples.md` if it exists: these are emails the user liked; match their tone.

## Phase 2: Plan the search

Turn the target into concrete search criteria: kinds of companies, team, and the people who can actually say yes (hiring manager for the role, team lead, founders/CTO at small startups, a recruiter who hires for that team). Prefer people who would work with the user over generic HR. Default count is 15 unless the user gave one.

Read `data/history.json` (if it exists) so you don't pick people already emailed.

Create the campaign id: `YYYY-MM-DD-short-slug` (today's date, lowercase, hyphens), e.g. `2026-11-02-pm-intern-ai-startups`.

## Phase 3: Research people

Use WebSearch and WebFetch. For each person, confirm from a page you read that they **currently** work there in that role (recent profile snippet, team page, recent post/talk). Collect:
- `whyRelevant`: one or two sentences on why this person is a good fit for this user's ask.
- `hooks`: 1–3 specific, verifiable facts to personalise with (a project they shipped, a post they wrote, a talk, what their team works on). Never generic praise.
- `sources`: every page you used, as `{ "url", "title", "note" }`.
- `domain`: the company's email domain (usually its website domain). This matters for the email lookup.
- Email: if you see their email **written on a page** (personal site, GitHub, company page, blog, talk slides), record it with `"emailStatus": "public"` and `"emailSourceUrl"` set to that page. If you only infer it (e.g. from the company's pattern), put it in `email` with `"emailStatus": "guessed"`. Otherwise leave `email` null with `"emailStatus": "not_found"`.

If research is slow, you may split the people across a few parallel subagents, giving each the same rules.

## Phase 4: Save the campaign

Write `data/campaigns/<id>.json`:

```json
{
  "id": "<id>",
  "targetRole": "the user's target in plain words",
  "searchPlan": "short summary of who you looked for and why",
  "resumeFile": "file.pdf",
  "attachResume": true,
  "createdAt": "<ISO timestamp>",
  "contacts": [
    {
      "id": "c1",
      "name": "", "title": "", "company": "", "domain": "", "linkedin": "",
      "whyRelevant": "", "hooks": [], "sources": [{ "url": "", "title": "", "note": "" }],
      "email": null, "emailStatus": "not_found", "emailSourceUrl": null,
      "resumeHighlights": [], "subject": "", "body": "",
      "status": "pending"
    }
  ]
}
```

Run `npm run check -- <id>` and fix every ✗ error.

## Phase 5: Fill in missing emails

Run `npm run find-emails -- <id>`. This keeps your public finds and only spends Apollo/Hunter credits on the rest, falling back to pattern guesses. Read the output and mention how many emails are public / verified / guessed / missing.

## Phase 6: Write the emails

Read the campaign file again (the email step updated it). For every contact, write `subject` and `body`, and list in `resumeHighlights` the resume items you chose to feature (e.g. "Project: PhishGuard (security)").

Rules for each email:
- Pick the 1–2 resume items that best match **this person's** work, using their hooks and the profile `tags`. Someone in security sees the security project first; a growth PM sees the growth result.
- Opening line references one hook specifically and honestly. No "I hope this finds you well", no flattery.
- Then who the user is in one line, the matched resume items with a concrete result, and a clear, small ask (e.g. a 15-minute chat, or whether they're hiring for X).
- Mention that the resume is attached if `attachResume` is true.
- 80–150 words, plain text, no markdown, no emojis. Short paragraphs.
- Subject: specific and under 8 words, never clickbait.
- **Do not write a signature or sign-off name**: end with the ask, or a plain "Thanks," line. The signature from `profile.json` is added automatically.
- No placeholders like [Company]. If you lack a detail, write around it.

Then run `npm run check -- <id>` again and fix errors.

## Phase 7: Hand off to review

Start the review page in the background with `npm run review` (if it is already running, the user only needs to refresh). Tell the user:
- how many people, how many emails found publicly vs by Apollo/Hunter vs guessed,
- anyone you want them to double-check (guessed emails, weaker fits),
- that they approve or skip each one at http://localhost:3000, then click **Create Gmail drafts**, and send from Gmail → Drafts.
- if Gmail is not connected yet: run `npm run auth` first (setup in README.md).

## Adding more people to an existing bundle

Used when the target is `more <N> for <bundle-id>`. The user may be reviewing that bundle on the desk while you work, so **never write the campaign file directly**: all changes go through `npm run merge`, which appends new people and only touches the people you add.

1. Run `npm run status -- --json`, then read `data/profile.json`, `data/style-examples.md` (if present), `data/history.json` (if present) and `data/campaigns/<bundle-id>.json`. Keep its `targetRole`, `searchPlan` and `resumeFile`; read that resume if the profile came from a different one.
2. Research N **new** people exactly as in Phase 3, for the same target. Skip anyone already in the bundle or in history. Look for people different from those already there (other companies, other angles in the search plan) rather than near-duplicates.
3. Write them, with no `id` and no `status`, as a JSON array to `data/runs/more-<bundle-id>.json` (same contact fields as Phase 4, emails empty if you didn't see them on a page). Run `npm run merge -- <bundle-id> data/runs/more-<bundle-id>.json` and note the ids it prints after `added:`.
4. Run `npm run find-emails -- <bundle-id> --only <those ids>` so credits are only spent on the new people.
5. Read the campaign again, then write the emails for the new people only (same rules as Phase 6). Put them in the same JSON file as `[{ "id": "c16", "subject": "", "body": "", "resumeHighlights": [] }, ...]` and run `npm run merge` again.
6. Run `npm run check -- <bundle-id>`. If it reports errors on the new people, fix them through another merge.
