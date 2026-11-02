# coldmail (hosted, `product` branch)

Multi-user web app: Google sign-in, Postgres, research on the Claude API, sending through each user's Gmail (`gmail.send`). The laptop version that uses Claude Code lives on `main`. Deploy steps: DEPLOY.md.

- `server/app.js`: HTTP server and API; every query is scoped to the signed-in user. Non-GET requests need the `X-Coldmail: 1` header.
- `lib/research.js`: the playbook on the Claude API (resume → profile, research loop with web search/fetch + `save_person`, email writing). Model `claude-opus-5-5` with server-side refusal fallback.
- `lib/jobs.js`: runs research in the background, enforces monthly/concurrency limits, merges people into bundles under a row lock (`repo.updateCampaign`).
- `lib/db.js`: Postgres via `DATABASE_URL`, or PGlite in `data/dev-db` when unset. Schema and startup migration live here.
- `lib/auth.js`: Google OAuth (sign-in, then incremental Gmail consent), sessions, Gmail send.
- Never invent people, facts or emails. Nothing is sent without the user approving it and clicking send.
