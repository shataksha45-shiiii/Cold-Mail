// Google sign-in (OAuth) and the two Gmail API calls we need: who am I, and create a draft.
// Scope is gmail.compose: it can create drafts but cannot read your inbox.
import { GOOGLE_CREDENTIALS_FILE, GOOGLE_TOKEN_FILE } from './paths.js';
import { readJson, writeJson } from './store.js';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.compose'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function loadClient() {
  const raw = readJson(GOOGLE_CREDENTIALS_FILE, null);
  if (!raw) throw new Error('Missing data/google-credentials.json. Follow "Connect Gmail" in README.md.');
  const c = raw.installed || raw.web;
  if (!c?.client_id) throw new Error('data/google-credentials.json does not look like an OAuth client file.');
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

export function authUrl({ clientId, redirectUri, codeChallenge, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(`Google token error: ${json.error_description || json.error}`);
    err.code = json.error;
    throw err;
  }
  return json;
}

export async function exchangeCode({ code, redirectUri, codeVerifier }) {
  const { clientId, clientSecret } = loadClient();
  const t = await tokenRequest({
    code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
    grant_type: 'authorization_code', code_verifier: codeVerifier,
  });
  const token = { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
  writeJson(GOOGLE_TOKEN_FILE, token);
  token.email = (await gmail('profile')).emailAddress;
  writeJson(GOOGLE_TOKEN_FILE, token);
  return token;
}

export function gmailConnection() {
  const token = readJson(GOOGLE_TOKEN_FILE, null);
  return token?.refresh_token ? { connected: true, email: token.email || null } : { connected: false, email: null };
}

async function accessToken() {
  const token = readJson(GOOGLE_TOKEN_FILE, null);
  if (!token?.refresh_token) throw new Error('Gmail is not connected. Run: npm run auth');
  if (token.access_token && token.expires_at > Date.now() + 60_000) return token.access_token;

  const { clientId, clientSecret } = loadClient();
  try {
    const t = await tokenRequest({
      refresh_token: token.refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token',
    });
    Object.assign(token, { access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 });
    writeJson(GOOGLE_TOKEN_FILE, token);
    return token.access_token;
  } catch (err) {
    if (err.code === 'invalid_grant') {
      throw new Error('Gmail login expired (Google expires logins for apps in "Testing" mode after 7 days). Run: npm run auth');
    }
    throw err;
  }
}

async function gmail(pathname, options = {}) {
  const res = await fetch(`${GMAIL_API}/${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${json.error?.message || res.statusText}`);
  return json;
}

export const getProfile = () => gmail('profile');

export function createDraft(raw) {
  return gmail('drafts', { method: 'POST', body: JSON.stringify({ message: { raw } }) });
}
