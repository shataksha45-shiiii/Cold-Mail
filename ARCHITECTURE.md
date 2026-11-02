# How the hosted version works

```mermaid
flowchart TD
    U[Browser: landing, desk, bundles, ledger, account] -->|cookie session + X-Coldmail header| S[server/app.js]
    S --> A[lib/auth.js<br/>Google sign-in, Gmail send]
    S --> R[lib/repo.js]
    R --> D[(Postgres<br/>users · resumes · campaigns · history · runs)]
    S --> J[lib/jobs.js<br/>limits, background runs]
    J --> C[lib/research.js<br/>Claude API: profile, research loop, writing]
    C -->|web_search / web_fetch| W[Public web]
    J --> E[lib/emailFinder.js<br/>Apollo → Hunter → pattern]
    A -->|gmail.send| G[User's Gmail]
```

## Where searches run

`jobs.searchEngine(user)` decides:
- **`laptop`** for the owner (`ADMIN_EMAILS`) when `WORKER_TOKEN` is set. The run is stored as `queued`. The helper on the owner's laptop (`scripts/helper.js` on `main`) polls `POST /api/worker/next` with the token, claims the run, runs the `/coldmail` playbook with Claude Code, posts progress to `/api/worker/runs/:id/progress` (which also carries "stop"), and uploads the people to `/finish`. The server cleans and merges them under the row lock. A helper that goes silent for 20 minutes fails the run.
- **`api`** for anyone else when `ANTHROPIC_API_KEY` is set: the in-process pipeline below.
- **`off`** otherwise.

Visitors use demo mode: the page answers its own requests from `public/demo.json` and never calls the API.

## A search on the API, step by step

1. **Profile.** The resume PDF goes to Claude with a JSON schema and comes back as a structured profile (projects, experience, topic tags, signature). This is cached per resume.
2. **Research.** An agent loop on `claude-opus-5-5` with Anthropic's server-side web search and web fetch, plus one tool of ours: `save_person`. Each call is checked (it must have a name, a company and a source URL, and must not be a duplicate or someone already emailed) and written into the bundle straight away. That's what drives the live tracker. People already in the bundle or already emailed are passed in as an exclusion list.
3. **Emails.** Anyone without a public address goes through Apollo, then Hunter, then a name-pattern guess, using the server's keys.
4. **Writing.** One structured call writes a subject and body for every new person, featuring the resume items that match their work.

Every write to a bundle happens in a transaction with a row lock (`repo.updateCampaign`), so the research job and the user's own edits never overwrite each other. "Add people" reuses the same steps with the existing bundle.

## Safety and limits

- **Sessions:** random tokens in an HttpOnly cookie; only their SHA-256 hash is stored.
- **Requests:** every API route is scoped to the signed-in user. Requests that change data need a custom header other sites can't send.
- **Gmail:** send-only (`gmail.send`). The refresh token is encrypted with AES-256-GCM. Nothing is sent until the user approves a postcard and confirms the send.
- **Limits:** searches per user per month, sends per user per day, and searches running at once across all users. A failed search doesn't count against the monthly allowance, and a failed new bundle is removed.
- **Account deletion:** cascades through every table and revokes Gmail.
