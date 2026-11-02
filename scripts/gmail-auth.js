// Usage: npm run auth
// Opens Google sign-in in your browser and saves a login token to data/google-token.json.
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { authUrl, exchangeCode, loadClient } from '../lib/google.js';

const { clientId } = loadClient();
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/') {
    res.writeHead(404).end();
    return;
  }
  const done = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<body style="font-family:system-ui;padding:40px"><h2>${message}</h2><p>You can close this tab.</p></body>`);
  };
  if (url.searchParams.get('state') !== state) return done(400, 'Login link did not match. Run npm run auth again.');
  if (url.searchParams.get('error')) {
    done(400, `Google said: ${url.searchParams.get('error')}`);
    return server.close(() => process.exit(1));
  }
  try {
    const token = await exchangeCode({ code: url.searchParams.get('code'), redirectUri, codeVerifier });
    done(200, `Gmail connected as ${token.email}`);
    console.log(`Connected as ${token.email}. Token saved to data/google-token.json`);
    server.close(() => process.exit(0));
  } catch (err) {
    done(500, err.message);
    console.error(err.message);
    server.close(() => process.exit(1));
  }
});

let redirectUri;
server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://127.0.0.1:${server.address().port}`;
  const url = authUrl({ clientId, redirectUri, codeChallenge, state });
  console.log('Opening Google sign-in in your browser. If it does not open, visit:\n');
  console.log(url, '\n');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
});
