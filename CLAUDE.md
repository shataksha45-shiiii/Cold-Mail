# Cold Mail Automation

Personal tool: Claude Code does the AI work (resume parsing, people research, email writing) through the `/coldmail` command in `.claude/commands/coldmail.md`. Small Node scripts (no dependencies, Node 22.9+) do the rest. See ARCHITECTURE.md.

- All state is JSON in `data/` (gitignored except `demo.json`): `profile.json`, `campaigns/<id>.json`, `history.json`.
- Campaign/contact field meanings and allowed values: `lib/store.js` (`CONTACT_STATUSES`, `EMAIL_STATUSES`) and `scripts/check-campaign.js`.
- After editing a campaign file, run `npm run check -- <id>`.
- Never invent people, facts or emails. `emailStatus: "public"` requires `emailSourceUrl`.
- Email bodies never include a signature; `lib/mime.js` `composeBody` appends `profile.signature`.
- Never send email. The tool only creates Gmail drafts; the user sends them.
