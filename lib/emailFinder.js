// Fills in missing email addresses. Order of trust:
//   1. Claude found it on a public page  -> kept as-is, no credits spent
//   2. Apollo people match
//   3. Hunter email finder
//   4. Claude's guess or a name pattern  -> marked "guessed"
// Each external call spends free-tier credits, so we stop at the first hit.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function splitName(name) {
  const parts = (name || '').trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '' };
}

function asciiLower(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

async function readError(res) {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json.error || json.errors?.[0]?.details || json.message || text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

export async function apolloLookup(contact) {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return { skipped: 'APOLLO_API_KEY not set' };
  const { first, last } = splitName(contact.name);
  const params = new URLSearchParams({ first_name: first, last_name: last, reveal_personal_emails: 'false' });
  if (contact.company) params.set('organization_name', contact.company);
  if (contact.domain) params.set('domain', contact.domain);
  if (contact.linkedin) params.set('linkedin_url', contact.linkedin);

  const res = await fetch(`https://api.apollo.io/api/v1/people/match?${params}`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', accept: 'application/json' },
  });
  if (!res.ok) return { error: `Apollo ${res.status}: ${await readError(res)}` };
  const person = (await res.json()).person;
  // Apollo returns a placeholder like email_not_unlocked@domain.com when the email needs credits.
  if (!person?.email || person.email.includes('not_unlocked')) return { email: null };
  return {
    email: person.email,
    verified: person.email_status === 'verified',
    detail: `Apollo (email_status: ${person.email_status || 'unknown'})`,
  };
}

export async function hunterFind(contact) {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return { skipped: 'HUNTER_API_KEY not set' };
  const { first, last } = splitName(contact.name);
  if (!last) return { skipped: 'Hunter needs a first and last name' };
  const params = new URLSearchParams({ first_name: first, last_name: last, api_key: key });
  if (contact.domain) params.set('domain', contact.domain);
  else if (contact.company) params.set('company', contact.company);
  else return { skipped: 'Hunter needs a domain or company' };

  const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`);
  if (res.status === 404) return { email: null };
  if (!res.ok) return { error: `Hunter ${res.status}: ${await readError(res)}` };
  const data = (await res.json()).data || {};
  if (!data.email) return { email: null };
  const verification = data.verification?.status;
  return {
    email: data.email,
    verified: verification === 'valid',
    detail: `Hunter (score ${data.score ?? '?'}, ${verification || 'unverified'})`,
  };
}

// Returns Hunter's verdict: valid | invalid | accept_all | webmail | disposable | unknown
export async function hunterVerify(email) {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return { skipped: 'HUNTER_API_KEY not set' };
  const params = new URLSearchParams({ email, api_key: key });
  const res = await fetch(`https://api.hunter.io/v2/email-verifier?${params}`);
  if (res.status === 202) return { status: 'unknown', detail: 'Hunter is still verifying, try again in a minute' };
  if (!res.ok) return { error: `Hunter ${res.status}: ${await readError(res)}` };
  const data = (await res.json()).data || {};
  return { status: data.status || 'unknown', detail: `Hunter verifier: ${data.status} (score ${data.score ?? '?'})` };
}

export function guessPatterns(contact) {
  const domain = (contact.domain || '').trim().toLowerCase().replace(/^www\./, '');
  const { first, last } = splitName(contact.name);
  const f = asciiLower(first);
  const l = asciiLower(last);
  if (!domain || !f) return [];
  const local = l ? [`${f}`, `${f}.${l}`, `${f}${l}`, `${f[0]}${l}`, `${f}${l[0]}`] : [f];
  return [...new Set(local)].map((p) => `${p}@${domain}`);
}

function setEmail(contact, email, status, source, detail) {
  contact.email = email;
  contact.emailStatus = status;
  contact.emailSource = source;
  contact.emailDetail = detail;
}

/**
 * Looks up one contact's email in place. Returns a short line for the log.
 * options.verifyGuesses: spend a Hunter verification on guessed addresses.
 */
export async function findEmail(contact, { verifyGuesses = false } = {}) {
  const attempts = [];
  const log = (step, result) => {
    attempts.push({ step, ...result });
    return result;
  };

  if (contact.email && contact.emailStatus === 'public' && contact.emailSourceUrl) {
    return `kept Claude's public find ${contact.email}`;
  }

  const claudeGuess = contact.email || null;

  for (const [step, lookup] of [['apollo', apolloLookup], ['hunter', hunterFind]]) {
    let result;
    try {
      result = log(step, await lookup(contact));
    } catch (err) {
      result = log(step, { error: err.message });
    }
    if (result.email) {
      setEmail(contact, result.email, result.verified ? 'verified' : 'likely', step, result.detail);
      contact.emailLookup = { at: new Date().toISOString(), attempts };
      return `${step}: ${result.email} (${contact.emailStatus})`;
    }
    await sleep(300);
  }

  const candidates = [...new Set([claudeGuess, ...guessPatterns(contact)].filter(Boolean))];
  if (!candidates.length) {
    setEmail(contact, null, 'not_found', null, 'No source, and no domain to guess from');
    contact.emailLookup = { at: new Date().toISOString(), attempts };
    return 'not found (add a domain or type the email on the review page)';
  }

  const [best, ...alternates] = candidates;
  setEmail(contact, best, 'guessed', claudeGuess ? 'claude-guess' : 'pattern', `Unverified guess. Other patterns: ${alternates.join(', ') || 'none'}`);
  contact.emailAlternates = alternates;

  if (verifyGuesses) {
    const v = log('hunter-verify', await hunterVerify(best).catch((err) => ({ error: err.message })));
    if (v.status) contact.emailVerification = { status: v.status, at: new Date().toISOString() };
    if (v.status === 'valid') contact.emailStatus = 'verified';
  }

  contact.emailLookup = { at: new Date().toISOString(), attempts };
  return `guessed ${best}${contact.emailStatus === 'verified' ? ' (verified by Hunter)' : ''}`;
}
