// Google sign-in (basic profile only) and, separately, permission to send from the user's Gmail.
// Asking for Gmail later ("incremental authorization") means people can try the app before
// granting anything sensitive. Sessions are random tokens in an HttpOnly cookie; only their
// hash is stored.
import { decrypt, encrypt, randomToken, sha256 } from './secrets.js';
import * as repo from './repo.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const SESSION_COOKIE = 'cm_session';
const STATE_COOKIE = 'cm_oauth';

export const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const secureCookies = () => appUrl().startsWith('https://');
const redirectUri = () => `${appUrl()}/auth/google/callback`;

function client() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  return { id, secret };
}

// ---------- Cookies ----------
export function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function cookie(name, value, { maxAge, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (secureCookies()) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

// ---------- Invite list ----------
// ALLOWED_EMAILS (comma-separated) limits who can sign in; ADMIN_EMAILS are always allowed. Empty = anyone.
const emailList = (name) => (process.env[name] || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
export function isAllowed(email) {
  const allowed = emailList('ALLOWED_EMAILS');
  const e = email.toLowerCase();
  return !allowed.length || allowed.includes(e) || emailList('ADMIN_EMAILS').includes(e);
}

// ---------- Sessions ----------
export async function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const user = token ? await repo.userForSession(sha256(token)) : null;
  return user && isAllowed(user.email) ? user : null; // removing someone from the list signs them out
}

async function startSession(userId) {
  const token = randomToken();
  await repo.createSession(userId, sha256(token));
  return cookie(SESSION_COOKIE, token, { maxAge: 60 * 60 * 24 * 30 });
}

export async function logout(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await repo.deleteSession(sha256(token));
  return cookie(SESSION_COOKIE, '', { maxAge: 0 });
}

// ---------- OAuth ----------
// purpose: 'signin' (openid email profile) or 'gmail' (adds gmail.send, offline access)
export function startOAuth(purpose, user) {
  const { id } = client();
  const state = randomToken(16);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    state,
    include_granted_scopes: 'true',
  });
  if (purpose === 'gmail') {
    params.set('scope', `openid email ${GMAIL_SEND_SCOPE}`);
    params.set('access_type', 'offline');
    params.set('prompt', 'consent'); // makes Google return a refresh token every time
    if (user?.email) params.set('login_hint', user.email);
  } else {
    params.set('scope', 'openid email profile');
    params.set('prompt', 'select_account');
  }
  return {
    location: `${AUTH_URL}?${params}`,
    setCookie: cookie(STATE_COOKIE, `${state}.${purpose}`, { maxAge: 600, path: '/auth' }),
  };
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || 'Google token error');
    err.code = json.error;
    throw err;
  }
  return json;
}

// Handles /auth/google/callback for both purposes. Returns { setCookies, redirect }.
export async function finishOAuth(req, url) {
  const [state, purpose] = (parseCookies(req)[STATE_COOKIE] || '').split('.');
  const clear = cookie(STATE_COOKIE, '', { maxAge: 0, path: '/auth' });
  if (!state || url.searchParams.get('state') !== state) return { setCookies: [clear], redirect: '/?error=login' };
  if (url.searchParams.get('error')) return { setCookies: [clear], redirect: purpose === 'gmail' ? '/#/setup' : '/' };

  const { id, secret } = client();
  const tokens = await tokenRequest({
    code: url.searchParams.get('code'), client_id: id, client_secret: secret, redirect_uri: redirectUri(), grant_type: 'authorization_code',
  });
  const info = await (await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json();
  if (!info.sub || !info.email || info.email_verified === false) return { setCookies: [clear], redirect: '/?error=login' };

  if (purpose === 'gmail') {
    const user = await currentUser(req);
    if (!user || user.google_sub !== info.sub) return { setCookies: [clear], redirect: '/#/setup?error=account' };
    const scopes = (tokens.scope || '').split(' ');
    if (!scopes.includes(GMAIL_SEND_SCOPE) || !tokens.refresh_token) return { setCookies: [clear], redirect: '/#/setup?error=gmail' };
    await repo.updateUser(user.id, { gmail_token: encrypt(tokens.refresh_token) });
    return { setCookies: [clear], redirect: '/#/setup' };
  }

  if (!isAllowed(info.email)) return { setCookies: [clear], redirect: '/?error=invite' };
  const user = await repo.upsertGoogleUser({ sub: info.sub, email: info.email, name: info.name || '', picture: info.picture || '' });
  return { setCookies: [clear, await startSession(user.id)], redirect: '/#/desk' };
}

// ---------- Gmail ----------
async function gmailAccessToken(user) {
  if (!user.gmail_token) throw Object.assign(new Error('Connect Gmail first (account page).'), { status: 400 });
  const { id, secret } = client();
  try {
    const t = await tokenRequest({ refresh_token: decrypt(user.gmail_token), client_id: id, client_secret: secret, grant_type: 'refresh_token' });
    return t.access_token;
  } catch (err) {
    if (err.code === 'invalid_grant') {
      await repo.updateUser(user.id, { gmail_token: null });
      throw Object.assign(new Error('Gmail access was removed or expired. Connect Gmail again on the account page.'), { status: 400 });
    }
    throw err;
  }
}

// raw: base64url RFC 2822 message (lib/mime.js buildMessage). Sends immediately; returns Gmail's message id.
export async function sendGmail(user, raw) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await gmailAccessToken(user)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail: ${json.error?.message || res.statusText}`);
  return json.id;
}

export async function disconnectGmail(user) {
  if (user.gmail_token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(user.gmail_token))}`, { method: 'POST' }).catch(() => {});
  }
  await repo.updateUser(user.id, { gmail_token: null });
}
