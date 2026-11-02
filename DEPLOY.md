# Deploying coldmail for free

The hosted app lives on the `product` branch. (`main` is the laptop version that runs on Claude Code.) This setup costs $0:

| Piece | Service | Notes |
|---|---|---|
| Web app | Render free web service | No card. Sleeps after 15 min without visitors; the next visit takes ~1 min to wake. Keep the page open while a search runs. |
| Database | Neon free Postgres | No card. |
| Sign-in + Gmail | Google OAuth, "Testing" mode | Only test users you add (max 100) can sign in. No review or domain needed. |
| Email lookup | Hunter free tier | 50 lookups/month, shared |
| Searches | Claude API | **The only paid part.** Leave `ANTHROPIC_API_KEY` empty and searches stay off; add a key with credit any time to switch them on. |

Who can use it is controlled twice: Google's test-user list, and `ALLOWED_EMAILS` in the app.

## 1. Database (Neon)

1. neon.tech → sign up (GitHub works) → create a project named `coldmail`, in a region near you.
2. On the project dashboard, click **Connect** and copy the **connection string** (`postgresql://...?sslmode=require`).

## 2. Web app (Render)

1. render.com → sign up with GitHub → allow access to **Cold-Mail**.
2. **New → Blueprint** → **Cold-Mail**, branch **`product`** → Connect.
3. Fill in:
   - `DATABASE_URL`: the Neon connection string
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

Open `APP_URL`, sign in, upload your resume on the **account** page, and connect Gmail.

## 4. Turning searches on (when you're ready)

console.anthropic.com → Billing → add credit → API Keys → create a key → paste it into Render as `ANTHROPIC_API_KEY`. Keep `MONTHLY_RUN_LIMIT` low to control spend; admins have no limit.

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
