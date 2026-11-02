# Deploying coldmail

The hosted app lives on the `product` branch. (`main` is the original laptop version that runs on Claude Code.) Plan for about an hour, plus Google's review time.

## What you need

| Thing | Where | Cost |
|---|---|---|
| Render account | render.com (sign in with GitHub) | Web service ~$7/mo + Postgres ~$6/mo. Check Render's pricing page. |
| Anthropic API key | console.anthropic.com → API Keys | Pay per use. Check the first few searches in the Console usage page. |
| Google OAuth client | console.cloud.google.com (the same "Cold Mail" project works) | Free |
| Hunter key (optional) | hunter.io/api-keys | Free tier: 50 searches/month, shared by all users |
| Your own domain (for Google review) | any registrar | ~$10/yr |

## 1. Create the app on Render

1. render.com → **New → Blueprint** → connect GitHub → pick **Cold-Mail**. Render reads `render.yaml` and proposes a web service `coldmail` (branch `product`) plus a database `coldmail-db`.
2. It asks for the values marked `sync: false`. For now, fill in:
   - `ANTHROPIC_API_KEY`: your key
   - `HUNTER_API_KEY`: optional
   - `ADMIN_EMAILS`: your Gmail (no monthly limit for you)
   - `CONTACT_EMAIL`: the address shown on the privacy page
   - `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: leave blank for a minute
3. **Apply.** When it's live, copy its address (like `https://coldmail-xxxx.onrender.com`) and set `APP_URL` to exactly that, with no trailing slash.

`SESSION_SECRET` and `DATABASE_URL` are filled in automatically. The database tables are created on first start.

## 2. Google sign-in and Gmail

In console.cloud.google.com, in your Cold Mail project:

1. **Google Auth Platform → Data access → Add or remove scopes**: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` and `.../auth/gmail.send`.
2. **Branding**: app name `coldmail`, support email, and app home page = your `APP_URL`, privacy policy = `APP_URL/privacy`, terms = `APP_URL/terms`. Add your domain under **Authorized domains**.
3. **Clients → Create client → Web application**:
   - Authorized JavaScript origins: your `APP_URL`
   - Authorized redirect URIs: `APP_URL/auth/google/callback`
   - Create, then copy the client ID and secret into Render's `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Render redeploys.
4. **Audience**: while the app is in **Testing**, only test users you add here (up to 100) can sign in. Add yourself and anyone trying it early.

Open your `APP_URL`, sign in, upload a resume on the **account** page, connect Gmail, and run a small search (5 people) to check everything.

## 3. Open it to everyone (Google review)

Sign-in with basic profile scopes needs no review. The **Gmail send** permission does: until Google approves it, only your test users can connect Gmail.

1. Put the app on a domain you own (Render → Settings → Custom Domains), update `APP_URL`, the OAuth client's origin and redirect URI, and verify the domain in Google Search Console.
2. Google Auth Platform → **Audience → Publish app**, then submit for verification. Google asks for:
   - why you need `gmail.send` (sending emails the user reviewed and approved, from their own account)
   - a short screen recording: sign-in, connecting Gmail, approving a postcard and sending it
   - the privacy policy link (it already includes the required Limited Use statement)
3. Review usually takes days to a few weeks. Google may ask follow-up questions by email.

## Running the hosted version locally

```bash
git checkout product
npm install
cp .env.example .env   # fill in SESSION_SECRET, ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID/SECRET
npm run dev
```

Without `DATABASE_URL`, it uses a built-in database in `data/dev-db`. For Google sign-in locally, add `http://localhost:3000` and `http://localhost:3000/auth/google/callback` to the OAuth client.

## Limits you can change (Render → Environment)

- `MONTHLY_RUN_LIMIT` (3): searches per user per month. Accounts in `ADMIN_EMAILS` are unlimited.
- `DAILY_SEND_LIMIT` (50): emails per user per day.
- `MAX_CONCURRENT_RUNS` (3): searches running at once across all users.
