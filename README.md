# Cold Mail Automation

Upload your resume, describe the role you want, and get personalised cold emails to the right people, sitting in your Gmail drafts with your resume attached. You review each one; you click send.

Free to run: Claude Code (your Pro plan) does the research and writing; Gmail API, Apollo and Hunter free tiers do the rest. How it works: [ARCHITECTURE.md](ARCHITECTURE.md).

## Use it

```bash
npm run review
```

That opens the app at http://localhost:3000.

1. **setup** tab: upload your resume PDF (you can keep several, e.g. a PM one and a tech one).
2. **+ new** tab: describe who you want to reach, pick how many people and which resume, and click **find people**. Claude Code runs in the background on your Pro plan (5–15 minutes) and you can watch each step.
3. **desk** tab: flip through the postcards. Edit anything, **approve** or **set aside**. Need more people? **+ add people** next to the bundle name finds 5, 10 or 15 more for the same bundle, skipping anyone already in it or already emailed.
4. **send to gmail**: approved emails land in Gmail → Drafts with your resume attached. You send them.

You can still start a bundle from Claude Code instead: `/coldmail PM intern at early-stage AI startups in India, 15 people`.

Check what's set up any time with `npm run status`, or open the **setup** tab.

## One-time setup

### 1. Node.js 22.9 or newer
You already have it (`node -v`). No `npm install` needed: the project has no dependencies.

### 2. Connect Gmail (free, about 10 minutes)
1. Go to https://console.cloud.google.com, create a project (e.g. "Cold Mail").
2. **APIs & Services → Library** → search "Gmail API" → **Enable**.
3. **APIs & Services → OAuth consent screen** (may be called "Google Auth Platform"): choose **External**, fill in the app name and your email. Under **Audience / Test users**, add your own Gmail address. Leave the app in **Testing**.
4. **Credentials → Create credentials → OAuth client ID** → Application type **Desktop app** → Create → **Download JSON**.
5. Save that file as `data/google-credentials.json`.
6. Run:
   ```bash
   npm run auth
   ```
   Sign in, and click through the "Google hasn't verified this app" warning (it's your own app). You'll see "Gmail connected".

The tool asks only for permission to **create drafts**. It cannot read your inbox, and it never sends anything.

Google logs test-mode apps out after 7 days. When the review page says the login expired, just run `npm run auth` again.

### 3. Email lookup keys (optional, free tiers)
Copy keys into `.env`:
- Apollo: app.apollo.io → Settings → Integrations → API → create key → `APOLLO_API_KEY=`
- Hunter: hunter.io/api-keys → `HUNTER_API_KEY=`

Without them, emails come only from Claude's research and pattern guesses. Free tiers have small monthly credit limits; the tool only spends them on people Claude couldn't find an email for.

### 4. Make the emails sound like you (optional)
Paste one or two cold emails you were happy with into `data/style-examples.md`. Edit your `signature` in `data/profile.json` after the first run.

## Commands

| Command | What it does |
|---|---|
| `/coldmail <role> [count]` | (in Claude Code) the whole pipeline |
| `npm run status` | setup checklist and campaign list |
| `npm run review` | open the review page |
| `npm run auth` | connect / reconnect Gmail |
| `npm run find-emails -- <id>` | re-run email lookup. Flags: `--verify-guesses`, `--only c1,c2`, `--max 5`, `--force` |
| `npm run check -- <id>` | validate a campaign file |
| `npm run merge -- <id> <file.json>` | add people to a bundle (or fill in their fields) without touching cards you've edited |
| `npm run drafts -- <id>` | create drafts for approved contacts without the page |

## Privacy
Everything stays on your laptop in `data/` (gitignored): resume, research, history, Google login. The review page only listens on your own machine.
