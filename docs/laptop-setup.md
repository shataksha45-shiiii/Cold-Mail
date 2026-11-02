# Laptop edition: setup and use

The `main` branch runs entirely on your own computer. Claude Code (on your Claude plan) does the research and writing, approved emails land in your **Gmail Drafts** with your resume attached, and you send them yourself. It also includes the **helper** that powers your searches on the hosted website.

## One-time setup

### 1. Node.js 22.9 or newer
Check with `node -v`. No `npm install` is needed: the laptop edition has no dependencies.

### 2. Claude Code
Install [Claude Code](https://claude.com/claude-code) and sign in with your Claude plan. Searches run through it.

### 3. Connect Gmail (free, about 10 minutes)
1. Go to https://console.cloud.google.com and create a project (e.g. "Cold Mail").
2. **APIs & Services → Library** → search "Gmail API" → **Enable**.
3. **Google Auth Platform** (or "OAuth consent screen"): choose **External**, fill in the app name and your email. Under **Audience → Test users**, add your own Gmail address. Leave the app in **Testing**.
4. **Clients → Create client** → Application type **Desktop app** → Create → **Download JSON**.
5. Save that file as `data/google-credentials.json`.
6. Run `npm run auth`, sign in, and click through "Google hasn't verified this app" (it's your own app).

The laptop edition only asks for permission to **create drafts**: it can't read your inbox and never sends anything. Google signs test-mode apps out after 7 days; run `npm run auth` again when the app says so.

### 4. Email lookup keys (optional, free tiers)
Add to `.env`:
- Apollo: app.apollo.io → Settings → Integrations → API → `APOLLO_API_KEY=`
- Hunter: hunter.io/api-keys → `HUNTER_API_KEY=`

Without them, emails come from Claude's research and name-pattern guesses. Credits are only spent on people Claude couldn't find a public email for.

### 5. Sound like you (optional)
Paste one or two cold emails you liked into `data/style-examples.md`. After the first run, adjust `signature` in the setup tab.

## Use it

```bash
npm run review
```

That opens http://localhost:3000.

1. **setup**: upload your resume PDF (keep several if you like, e.g. a PM one and a tech one).
2. **+ new**: describe who you want to reach, pick how many people and which resume, then **find people**. Claude Code runs in the background (5–15 minutes) and you watch each step.
3. **desk**: flip through the postcards, edit, then **approve** or **set aside**. **+ add people** finds more for the same bundle, skipping anyone already in it or already emailed.
4. **send to gmail**: approved emails land in Gmail → Drafts with your resume attached. You send them.

You can also start a search from Claude Code: `/coldmail PM intern at early-stage AI startups in India, 15 people`.

## Connecting to the hosted website

To run your website searches free on this laptop, add to `.env`:

```
COLDMAIL_URL=https://your-site.onrender.com
COLDMAIL_WORKER_TOKEN=<WORKER_TOKEN from the site's settings>
```

Then keep this running:

```bash
npm run helper
```

## Commands

| Command | What it does |
|---|---|
| `/coldmail <role> [count]` | (in Claude Code) the whole pipeline |
| `npm run status` | setup checklist and bundle list |
| `npm run review` | open the review app |
| `npm run auth` | connect / reconnect Gmail |
| `npm run helper` | run searches for the hosted website on this laptop |
| `npm run find-emails -- <id>` | re-run email lookup (`--verify-guesses`, `--only c1,c2`, `--max 5`, `--force`) |
| `npm run check -- <id>` | validate a bundle file |
| `npm run merge -- <id> <file.json>` | add people to a bundle without touching cards you've edited |
| `npm run drafts -- <id>` | create Gmail drafts for approved postcards without the page |

## Privacy

Everything stays on your laptop in `data/` (gitignored): resume, research, history and Google login. The review app only listens on your own machine.
