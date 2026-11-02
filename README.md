# coldmail

Upload your resume, describe the role you want, and get personalised cold emails to the right people. You review each one, then send it from your own Gmail.

This is the **hosted, multi-user version** (`product` branch): Google sign-in, a database, research on the Claude API, and sending through each user's Gmail. The original laptop version, which runs on Claude Code and your Claude plan, is on the [`main` branch](../../tree/main).

- **Deploy it:** [DEPLOY.md](DEPLOY.md)
- **How it works:** [ARCHITECTURE.md](ARCHITECTURE.md)

## How it works for a user

1. **Sign in with Google.**
2. **account** page: upload a resume. Claude reads it into a profile.
3. **+ new bundle**: describe who you want to reach and pick how many people. A search takes 5–15 minutes; a live tracker shows each step.
4. **desk**: flip through the postcards, edit, **approve** or **set aside**. **+ add people** finds more for the same bundle.
5. Connect Gmail once (send-only permission), then **send**. Each email goes out from your account with your resume attached and your signature added.

## Limits

Per user: 3 searches a month and 50 emails a day by default (configurable). Nothing is ever sent without the user approving it.
