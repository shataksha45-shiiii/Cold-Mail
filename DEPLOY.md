# Deploying coldmail for free

The hosted app lives on the `product` branch. (`main` is the laptop version that runs on Claude Code.) This setup costs $0:

| Piece | Service | Notes |
|---|---|---|
| Web app | Render free web service | No card. Sleeps after 15 min without visitors; the next visit takes ~1 min to wake. Keep the page open while a search runs. |
| Database | Neon free Postgres | No card. |
| Sign-in + Gmail | Google OAuth, "Testing" mode | Only test users you add (max 100) can sign in. No review or domain needed. |
| Email lookup | Hunter free tier | 50 lookups/month, shared |
| Your searches | **Your laptop**, with Claude Code on your Claude plan | Free. Your laptop must be on with `npm run helper` running while a search runs; reviewing and sending work from anywhere. |
| Other people's searches | Claude API | Off unless you add `ANTHROPIC_API_KEY` (paid). Visitors get the demo instead. |

**Who sees what**
- **Visitors** click "explore the demo": made-up people, everything clickable, but searching and sending are switched off. Nothing they do reaches the server.
- **You** click "owner sign in". Your searches run on your laptop.
- Anyone else who signs in must be in `ALLOWED_EMAILS` and on Google's test-user list. Without an API key they can't search.

## 1. Database (Neon)

1. neon.tech → sign up (GitHub works) → create a project named `coldmail`, in a region near you.
2. On the project dashboard, click **Connect** and copy the **connection string** (`postgresql://...?sslmode=require`).

## 2. Web app (Render)

1. render.com → sign up with GitHub → allow access to **Cold-Mail**.
2. **New → Blueprint** → **Cold-Mail**, branch **`product`** → Connect.
3. Fill in:
   - `DATABASE_URL`: the Neon connection string
   - `WORKER_TOKEN` is generated for you; you'll copy it to your laptop in step 4
   - `ALLOWED_EMAILS`: your Gmail, plus anyone you invite (comma-separated)
   - `ADMIN_EMAILS`: your Gmail
   - `CONTACT_EMAIL`: shown on the privacy page
   - `HUNTER_API_KEY`: optional
   - Leave `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `ANTHROPIC_API_KEY` empty for now
4. **Apply**. When it says **Live**, copy the address (`https://coldmail-xxxx.onrender.com`), set `APP_URL` to it in **Environment** (no trailing slash), and save.

## 3. Google sign-in

In console.cloud.google.com, in the same project you used for the laptop version:

1. **Google Auth Platform → Clients → Create client → Web application**:
   - Authorized JavaScript origins: your `APP_URL`
   - Authorized redirect URIs: `APP_URL/auth/google/callback`
   - Copy the client ID and secret into Render's `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
2. **Data access → Add or remove scopes**: add `openid`, `userinfo.email`, `userinfo.profile`, `gmail.send`.
3. **Audience**: keep **Testing**, and add every person who'll use it as a **test user** (the same emails as `ALLOWED_EMAILS`).
4. **Branding** (optional for testing): home page `APP_URL`, privacy `APP_URL/privacy`, terms `APP_URL/terms`.

Open `APP_URL`, click **owner sign in**, upload your resume on the **account** page, and connect Gmail. In "Testing" mode Google expires Gmail access after 7 days; the site asks you to reconnect when that happens.

## 4. Connect your laptop (your free searches)

1. In Render → your service → **Environment**, copy the value of `WORKER_TOKEN` (Render generated it).
2. On your laptop, in the coldmail folder on the **`main`** branch, add two lines to `.env`:
   ```
   COLDMAIL_URL=https://coldmail-xxxx.onrender.com
   COLDMAIL_WORKER_TOKEN=<the WORKER_TOKEN value>
   ```
3. Run it, and leave it running:
   ```bash
   npm run helper
   ```
   It says "connected". Your account page shows **laptop helper: online**.
4. Start a search on the site. The helper picks it up within ~15 seconds, runs it with Claude Code, and the site's tracker moves live. If your laptop is off, the search waits ("waiting for your laptop") and starts when the helper connects.

The helper only ever talks to your site with that token. Anyone who has the token can pull your queued searches, so keep it secret like a password. If it leaks, change `WORKER_TOKEN` on Render and in your `.env`.

## 5. Optional: searches for other people

console.anthropic.com → Billing → add credit → API Keys → create a key → paste it into Render as `ANTHROPIC_API_KEY`. Invited users' searches then run on the API (paid); yours still run on your laptop. Keep `MONTHLY_RUN_LIMIT` low to control spend.

## Inviting someone

Add their email to `ALLOWED_EMAILS` on Render **and** as a Google test user. Remove them from `ALLOWED_EMAILS` to sign them out for good.

## Running the hosted version locally

```bash
git checkout product
npm install
cp .env.example .env   # fill in SESSION_SECRET and the Google client (add http://localhost:3000 to it)
npm run dev
```

Without `DATABASE_URL`, it uses a built-in database in `data/dev-db`.
