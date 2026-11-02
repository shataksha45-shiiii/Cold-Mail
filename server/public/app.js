// coldmail डाक — review page.
// Desk: a stack of postcards you flip through, approve or set aside (edits autosave).
// Bundles: campaigns. Ledger: everything sent to Gmail. Setup: what's connected.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const EMAIL_LABELS = {
  public: ['found publicly', 'good'],
  verified: ['verified', 'good'],
  likely: ['likely', 'ok'],
  manual: ['typed by you', 'ok'],
  guessed: ['guessed', 'risky'],
  not_found: ['no email', 'bad'],
};

// Three glow colours + a deep base per card: rani & marigold, peacock, saffron dusk, holi, haldi & sindoor, indigo print.
const PALETTES = [
  ['#ff2e88', '#ffb000', '#7b2ff7', '#2a0d4a'],
  ['#00c2b2', '#2f6bff', '#c8f53d', '#06203d'],
  ['#ff7a1a', '#ff2e63', '#ffd23d', '#3d0b2e'],
  ['#9d4dff', '#ff4fa3', '#2fe0b0', '#1a0d3d'],
  ['#ffc400', '#e8301e', '#ff6aa2', '#3a0f14'],
  ['#3d6bff', '#00d1c1', '#ff8a3d', '#0b1240'],
];
const VALUES = ['₹5', '₹10', '₹15', '₹25', '₹50', '₹2'];

// ---------- Folk-art motifs (line drawings, 100×100) ----------
const svg = (inner) => `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const around = (n, fn) => Array.from({ length: n }, (_, k) => fn((360 / n) * k, k)).join('');
const MOTIFS = {
  rangoli: () => svg(`<circle cx="50" cy="50" r="44"/><circle cx="50" cy="50" r="9"/>
    ${around(8, (a) => `<path d="M50 41 C42 32 44 18 50 10 C56 18 58 32 50 41Z" transform="rotate(${a} 50 50)"/>`)}
    ${around(16, (a) => `<circle cx="50" cy="13" r="1.6" fill="currentColor" transform="rotate(${a + 11.25} 50 50)"/>`)}`),
  lotus: () => svg(`<path d="M50 76 C38 64 37 46 50 26 C63 46 62 64 50 76Z"/>
    <path d="M50 76 C34 72 22 58 23 40 C38 46 47 60 50 76Z"/><path d="M50 76 C66 72 78 58 77 40 C62 46 53 60 50 76Z"/>
    <path d="M50 76 C30 79 15 71 8 60 C25 57 40 64 50 76Z"/><path d="M50 76 C70 79 85 71 92 60 C75 57 60 64 50 76Z"/>
    <path d="M24 86 H76 M34 92 H66"/>`),
  peacock: () => svg(`<path d="M50 97 C50 80 50 64 50 50"/>
    ${Array.from({ length: 9 }, (_, k) => { const y = 92 - k * 5; const w = 10 + k * 2.2; return `<path d="M50 ${y} C${50 - w * 0.6} ${y - 4} ${50 - w} ${y - 10} ${50 - w} ${y - 14} M50 ${y} C${50 + w * 0.6} ${y - 4} ${50 + w} ${y - 10} ${50 + w} ${y - 14}"/>`; }).join('')}
    <ellipse cx="50" cy="34" rx="22" ry="28"/><ellipse cx="50" cy="36" rx="14" ry="19"/><ellipse cx="50" cy="38" rx="7" ry="10" fill="currentColor"/>`),
  paisley: () => svg(`<path d="M62 88 C30 90 14 64 26 42 C36 22 64 16 74 36 C82 52 70 64 60 58 C50 52 56 40 66 44"/>
    <path d="M60 79 C38 80 27 62 35 46 C42 32 60 29 66 40"/>
    ${around(7, (a, k) => `<circle cx="${30 + k * 6}" cy="${84 - Math.sin(k / 2) * 10}" r="1.6" fill="currentColor"/>`)}
    <circle cx="44" cy="58" r="4"/><circle cx="44" cy="58" r="1" fill="currentColor"/>`),
  sun: () => svg(`<circle cx="50" cy="50" r="16"/><circle cx="50" cy="50" r="22"/>
    ${around(16, (a, k) => `<path d="M50 ${k % 2 ? 22 : 24} L${k % 2 ? 46 : 47} 10 M50 ${k % 2 ? 22 : 24} L${k % 2 ? 54 : 53} 10" transform="rotate(${a} 50 50)"/>`)}
    <path d="M43 47 h3 M54 47 h3 M44 56 C47 59 53 59 56 56"/>`),
  warli: () => svg(`<circle cx="50" cy="50" r="44"/>
    ${around(6, (a) => `<g transform="rotate(${a} 50 50)"><circle cx="50" cy="15" r="3.4"/><path d="M45 20 L55 20 L50 27Z M50 27 L45 34 L55 34Z M45 21 L38 25 M55 21 L62 25 M47 34 L45 40 M53 34 L55 40"/></g>`)}
    <circle cx="50" cy="50" r="7"/>`),
};
const MOTIF_ORDER = ['rangoli', 'lotus', 'peacock', 'paisley', 'sun', 'warli'];

// Circular ink postmark with wavy cancellation lines.
let markId = 0;
function postmarkSvg(word, date, { waves = true } = {}) {
  const id = `pm${markId += 1}`;
  const wave = (y) => `<path d="M0 ${y} q 10 -7 20 0 t 20 0 t 20 0 t 20 0" fill="none" stroke="currentColor" stroke-width="2.4"/>`;
  return `<svg viewBox="0 0 ${waves ? 210 : 120} 120" xmlns="http://www.w3.org/2000/svg">
    ${waves ? `<g transform="translate(0 24)">${[0, 18, 36, 54].map(wave).join('')}</g>` : ''}
    <g transform="translate(${waves ? 90 : 0} 0)" font-family="Space Mono, monospace" fill="currentColor">
      <defs><path id="${id}" d="M60 60 m-43 0 a43 43 0 1 1 86 0 a43 43 0 1 1 -86 0"/></defs>
      <circle cx="60" cy="60" r="56" fill="none" stroke="currentColor" stroke-width="3"/>
      <circle cx="60" cy="60" r="31" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <text font-size="10" letter-spacing="3" font-weight="700"><textPath href="#${id}">COLDMAIL ✦ डाक ✦ AIR MAIL ✦</textPath></text>
      <text x="60" y="58" text-anchor="middle" font-size="9.5" font-weight="700" letter-spacing=".5">${word}</text>
      <text x="60" y="72" text-anchor="middle" font-size="8.5" letter-spacing="1">${date}</text>
    </g>
  </svg>`;
}
const stampDate = (iso) => new Date(iso || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase();
const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const pad = (n) => String(n).padStart(2, '0');
const firstName = (name) => (name || '').trim().split(/\s+/)[0];
const initial = (c) => (c.company || c.name || '?').trim()[0].toUpperCase();

function paint(el, index) {
  const [c1, c2, c3, c4] = PALETTES[index % PALETTES.length];
  el.style.setProperty('--c1', c1);
  el.style.setProperty('--c2', c2);
  el.style.setProperty('--c3', c3);
  el.style.setProperty('--c4', c4);
}
const motifFor = (index) => MOTIFS[MOTIF_ORDER[index % MOTIF_ORDER.length]]();

// ---------- State + API ----------
const state = { status: null, campaigns: [], campaign: null, filter: 'all', index: 0, view: 'desk', demo: false };
const isLive = (run) => Boolean(run && ['running', 'queued'].includes(run.status));

// ---------- Demo mode ----------
// Visitors can explore with made-up people. Requests are answered here in the browser, from
// demo.json; nothing reaches the server, and searching and sending are switched off.
let demoData = null;
const clone = (x) => JSON.parse(JSON.stringify(x));

async function demoApi(path, options = {}) {
  demoData ??= await (await fetch('/demo.json')).json();
  const method = options.method || 'GET';
  const body = options.body || {};
  const camp = demoData.campaign;
  const counts = () => Object.fromEntries(['pending', 'approved', 'skipped', 'sent'].map((s) => [s, camp.contacts.filter((x) => x.status === s).length]));
  const off = (what) => { throw new Error(`${what} is switched off in the demo.`); };
  let m;
  if (path === '/api/me') return clone(demoData.me);
  if (path === '/api/campaigns') return [{ id: camp.id, targetRole: camp.targetRole, createdAt: camp.createdAt, counts: counts() }];
  if (path === '/api/history') return clone(demoData.history);
  if (path === '/api/runs/latest') return clone(demoData.run);
  if (path === '/api/runs') off('Searching');
  if (path === '/auth/logout') return exitDemo();
  if ((m = path.match(/^\/api\/campaigns\/[\w-]+\/contacts\/([\w-]+)$/)) && method === 'PATCH') {
    const contact = camp.contacts.find((c) => c.id === m[1]);
    if (contact.status === 'sent') throw new Error('Already sent.');
    for (const f of ['subject', 'body']) if (typeof body[f] === 'string') contact[f] = body[f];
    if (typeof body.email === 'string' && body.email !== contact.email) Object.assign(contact, { email: body.email, emailStatus: 'manual' });
    if (body.status) {
      if (body.status === 'approved' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email || '')) throw new Error('Add a valid email before approving');
      contact.status = body.status;
    }
    return clone(contact);
  }
  if (/\/send$/.test(path)) off('Sending');
  if (/\/verify$/.test(path)) off('Verifying emails');
  if (path.startsWith('/api/campaigns/') && method === 'GET') return clone(camp);
  if (path.startsWith('/api/campaigns/') && method === 'PATCH') { Object.assign(camp, body); return { ok: true }; }
  if (path === '/api/profile') {
    if (typeof body.signature === 'string') demoData.me.profile.signature = body.signature;
    if (typeof body.style === 'string') demoData.me.style = body.style;
    return { ok: true };
  }
  off('That');
}

function enterDemo() {
  try { sessionStorage.setItem('demo', '1'); } catch { /* private mode */ }
  location.hash = '#/desk';
  location.reload();
}

function exitDemo() {
  try { sessionStorage.removeItem('demo'); } catch { /* private mode */ }
  location.href = '/';
  return new Promise(() => {});
}

async function api(path, options = {}) {
  if (state.demo) return demoApi(path, options);
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Coldmail': '1' },
    body: options.body && JSON.stringify(options.body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 5500);
}

function link(url, text) {
  const a = document.createElement('a');
  a.href = url;
  a.textContent = text || url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
function fillList(ul, items, render) {
  ul.replaceChildren(...items.map((item) => {
    const li = document.createElement('li');
    render(li, item);
    return li;
  }));
}

const contacts = () => state.campaign?.contacts || [];
const filtered = () => contacts().filter((c) => state.filter === 'all' || c.status === state.filter);
const paletteIndex = (contact) => contacts().findIndex((c) => c.id === contact.id);
const currentCard = () => $('#deck').children[state.index];
const currentContact = () => filtered()[state.index];

// ---------- Routing between tabs ----------
const VIEWS = ['home', 'new', 'desk', 'bundles', 'ledger', 'setup'];
const canTransition = typeof document.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!canTransition) document.documentElement.classList.add('no-vt');

// Page changes cross-fade with the View Transitions API where the browser has it.
function route() {
  const view = location.hash.replace('#/', '').split('?')[0] || 'home';
  const next = state.status?.user && VIEWS.includes(view) ? view : 'home';
  if (canTransition && state.routed && next !== state.view) document.startViewTransition(() => showView(next));
  else showView(next);
  state.routed = true;
}

function showView(view) {
  state.view = view;
  document.body.dataset.view = view;
  for (const section of $$('.view')) section.hidden = section.dataset.view !== state.view;
  for (const tab of $$('#tabs a')) tab.classList.toggle('active', tab.dataset.view === state.view);
  if (state.view === 'bundles') renderBundles();
  if (state.view === 'ledger') renderLedger();
  if (state.view === 'setup') {
    renderSetup();
    const err = new URLSearchParams(location.hash.split('?')[1] || '').get('error');
    if (err === 'gmail') toast('Gmail wasn’t connected. Please allow “send email on your behalf” when Google asks.', 'error');
    if (err === 'account') toast('Connect the same Google account you signed in with.', 'error');
    if (err) history.replaceState(null, '', '#/setup');
  }
  if (state.view === 'new') renderNew();
  if (state.view === 'desk') requestAnimationFrame(sizeDeck);
  $('#more-menu').hidden = true;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ---------- Desk ----------
function renderDeskHead() {
  const c = state.campaign;
  $('#bundle-name').textContent = c.targetRole;
  $('#more-btn').hidden = c.id === 'demo'; // the demo's people are made up
  for (const btn of $$('#filters button')) {
    const f = btn.dataset.filter;
    $('b', btn).textContent = f === 'all' ? c.contacts.length : c.contacts.filter((x) => x.status === f).length;
    btn.classList.toggle('active', f === state.filter);
  }
  renderDock();
}

function renderDock() {
  const c = state.campaign;
  const approved = c.contacts.filter((x) => x.status === 'approved').length;
  const send = $('#create-drafts');
  send.disabled = approved === 0;
  send.textContent = approved ? `send ${approved} →` : 'approve to send';
  const select = $('#resume-select');
  select.replaceChildren(
    ...state.status.resumes.map((r) => new Option(r.filename, r.id, false, r.id === c.resolvedResume && c.attachResume !== false)),
    new Option('no attachment', '__none__', false, c.attachResume === false || !c.resolvedResume),
  );
}

function renderCard(contact) {
  const card = $('#card-template').content.firstElementChild.cloneNode(true);
  const index = paletteIndex(contact);
  const locked = contact.status === 'sent';
  card.dataset.id = contact.id;
  card.dataset.status = contact.status;
  paint(card, index);

  // Picture side
  $('.front-motif', card).innerHTML = motifFor(index);
  $('.entry-no', card).textContent = `No. ${pad(index + 1)}`;
  $('.company-tag', card).textContent = contact.company || '';
  $('.name', card).textContent = contact.name;
  $('.role', card).textContent = contact.title || '';
  $('.new-tag', card).hidden = !(contact.addedAt && contact.status === 'pending');

  // Notes side
  $('.why', card).textContent = contact.whyRelevant || '';
  const highlights = contact.resumeHighlights || [];
  $('.hl-block', card).hidden = !highlights.length;
  fillList($('.highlights', card), highlights, (li, h) => { li.textContent = h; });
  const hooks = contact.hooks || [];
  $('.hooks-block', card).hidden = !hooks.length;
  fillList($('.hooks', card), hooks, (li, h) => { li.textContent = h; });
  const sources = [...(contact.sources || [])];
  if (contact.linkedin) sources.unshift({ url: contact.linkedin, title: 'LinkedIn' });
  fillList($('.sources', card), sources, (li, s) => {
    const body = document.createElement('span');
    body.append(link(s.url, s.title || hostname(s.url)));
    if (s.note) {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = s.note;
      body.append(note);
    }
    li.append(body);
  });
  const flip = $('.flip-btn', card);
  flip.onclick = () => {
    const open = card.classList.toggle('notes-open');
    flip.textContent = open ? 'picture ↻' : 'notes ↻';
  };

  // Writing side
  $('.stamp-motif', card).innerHTML = motifFor(index);
  $('.stamp-value', card).textContent = VALUES[index % VALUES.length];
  if (contact.status === 'approved') $('.postmark', card).innerHTML = postmarkSvg('APPROVED', stampDate());
  if (contact.status === 'sent') $('.postmark', card).innerHTML = postmarkSvg('SENT', stampDate(contact.sentAt));

  if (contact.previouslyContacted) {
    const p = contact.previouslyContacted;
    $('.previously', card).hidden = false;
    $('.previously', card).textContent = `Already written to on ${formatDate(p.draftedAt)}.`;
  }

  setBadge(card, contact.emailStatus);
  const detail = $('.email-detail-text', card);
  if (contact.emailStatus === 'public' && contact.emailSourceUrl) {
    detail.append('seen on ', link(contact.emailSourceUrl, hostname(contact.emailSourceUrl)));
  }
  const alternates = (contact.emailAlternates || []).filter((a) => a !== contact.email).slice(0, 4);
  if (alternates.length && !locked && !['verified', 'public'].includes(contact.emailStatus)) {
    const toggle = $('.alts-toggle', card);
    const box = $('.alts', card);
    toggle.hidden = false;
    toggle.textContent = `${alternates.length} other guess${alternates.length === 1 ? '' : 'es'} ▾`;
    toggle.onclick = () => { box.hidden = !box.hidden; };
    box.replaceChildren(...alternates.map((alt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'alt';
      b.textContent = alt;
      b.onclick = () => { $('.email', card).value = alt; box.hidden = true; save(card, { email: alt }); };
      return b;
    }));
  }
  if (contact.emailVerification) detail.append(` · Hunter: ${contact.emailVerification.status}`);

  $('.email', card).value = contact.email || '';
  $('.subject', card).value = contact.subject || '';
  $('.body', card).value = contact.body || '';
  const signature = state.status.profile?.signature;
  $('.signature', card).textContent = signature || 'your signature is added here';
  $('.signature', card).classList.toggle('missing', !signature);
  updateWordCount(card);

  const verify = $('.verify', card);
  verify.hidden = !state.status.hunter || locked || ['verified', 'public'].includes(contact.emailStatus) || !contact.email;
  verify.onclick = async () => {
    verify.disabled = true;
    verify.textContent = 'checking…';
    try {
      updateContact(await api(`/api/campaigns/${state.campaign.id}/contacts/${contact.id}/verify`, { method: 'POST' }));
    } catch (err) {
      toast(err.message, 'error');
      verify.disabled = false;
      verify.textContent = 'verify';
    }
  };

  for (const input of $$('input, textarea', card)) input.disabled = locked;
  for (const field of ['email', 'subject', 'body']) {
    const el = $(`.${field}`, card);
    el.addEventListener('input', () => {
      if (field === 'body') updateWordCount(card);
      setSaved(card, 'unsaved');
      clearTimeout(el.saveTimer);
      el.saveTimer = setTimeout(() => { el.saveTimer = null; save(card, { [field]: el.value }); }, 600);
    });
  }
  return card;
}

function setBadge(card, emailStatus) {
  const [label, tone] = EMAIL_LABELS[emailStatus] || ['unknown', 'risky'];
  const badge = $('.email-badge', card);
  badge.textContent = label;
  badge.className = `email-badge ${tone}`;
}
function setSaved(card, text, error = false) {
  const el = $('.saved', card);
  el.textContent = text;
  el.classList.toggle('err', error);
}
function updateWordCount(card) {
  const words = $('.body', card).value.trim().split(/\s+/).filter(Boolean).length;
  const el = $('.wordcount', card);
  el.textContent = `${words} words`;
  el.classList.toggle('over', words > 150);
}

function renderDeck() {
  const list = filtered();
  state.index = Math.min(state.index, Math.max(0, list.length - 1));
  $('#deck').replaceChildren(...list.map(renderCard));
  $('#desk').hidden = !list.length;
  $('#desk-empty').hidden = list.length > 0;
  $('#desk-empty-note').textContent = state.filter === 'all' ? '' : 'Try another pile.';
  renderIndex();
  layout();
}

function renderIndex() {
  const list = filtered();
  $('#book-index').replaceChildren(...list.map((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `st-${c.status}`;
    b.style.setProperty('--tab', PALETTES[paletteIndex(c) % PALETTES.length][0]);
    b.innerHTML = '<small></small><span></span>';
    $('small', b).textContent = pad(paletteIndex(c) + 1);
    $('span', b).textContent = firstName(c.name);
    b.title = `${c.name}, ${c.company}`;
    b.onclick = () => go(i);
    return b;
  }));
  $('#strip').replaceChildren(...list.map((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mini st-${c.status}`;
    paint(b, paletteIndex(c));
    b.innerHTML = '<span></span>';
    $('span', b).textContent = initial(c);
    b.title = `${c.name}, ${c.company}`;
    b.onclick = () => go(i);
    return b;
  }));
}

// Position every card relative to the one in front: behind ones peek, turned ones swing away.
function layout() {
  const cards = [...$('#deck').children];
  cards.forEach((card, i) => {
    const pos = i - state.index;
    card.dataset.pos = pos < 0 ? 'gone' : pos > 3 ? 'far' : String(pos);
    card.style.zIndex = String(100 - Math.abs(pos));
    card.inert = pos !== 0;
  });
  $$('#book-index button').forEach((b, i) => b.classList.toggle('active', i === state.index));
  const minis = $$('#strip .mini');
  minis.forEach((b, i) => b.classList.toggle('active', i === state.index));
  const active = minis[state.index];
  const strip = $('#strip');
  if (active) strip.scrollTo({ left: active.offsetLeft - strip.clientWidth / 2 + active.offsetWidth / 2 });
  $('#counter').textContent = cards.length ? `${pad(state.index + 1)} / ${pad(cards.length)}` : '';
  updateControls();
  sizeDeck();
}

const resizer = new ResizeObserver(() => sizeDeck());
function sizeDeck() {
  const front = currentCard();
  if (!front) return;
  const inner = $('.card-inner', front);
  if (!inner.offsetHeight) return;
  $('#deck').style.setProperty('--front-h', `${inner.offsetHeight}px`);
  resizer.disconnect();
  resizer.observe(inner);
}

function updateControls() {
  const c = currentContact();
  const n = filtered().length;
  $('#prev').disabled = state.index <= 0;
  $('#next').disabled = state.index >= n - 1;
  if (!c) return;
  const locked = c.status === 'sent';
  $('#act-approve').hidden = locked || c.status === 'approved';
  $('#act-skip').hidden = locked || c.status === 'skipped';
  $('#act-undo').hidden = locked || c.status === 'pending';
  $('#act-locked').hidden = !locked;
}

function go(i) {
  const n = filtered().length;
  const next = Math.max(0, Math.min(n - 1, i));
  if (next === state.index) return;
  const open = currentCard();
  if (open?.classList.contains('notes-open')) $('.flip-btn', open).click();
  state.index = next;
  layout();
}

async function save(card, patch) {
  try {
    const updated = await api(`/api/campaigns/${state.campaign.id}/contacts/${card.dataset.id}`, { method: 'PATCH', body: patch });
    mergeContact(updated);
    setSaved(card, 'saved');
    if ('email' in patch) setBadge(card, updated.emailStatus);
  } catch (err) {
    setSaved(card, 'not saved', true);
    toast(err.message, 'error');
  }
}

function mergeContact(updated) {
  const i = contacts().findIndex((c) => c.id === updated.id);
  state.campaign.contacts[i] = { ...state.campaign.contacts[i], ...updated };
  return state.campaign.contacts[i];
}

// Re-render one card in place, keeping its spot in the stack.
function updateContact(updated, { stamped = false } = {}) {
  const contact = mergeContact(updated);
  const old = $(`#deck .postcard[data-id="${updated.id}"]`);
  if (old) {
    const fresh = renderCard(contact);
    fresh.dataset.pos = old.dataset.pos;
    fresh.style.zIndex = old.style.zIndex;
    fresh.inert = old.inert;
    if (stamped) fresh.classList.add('just-stamped');
    old.replaceWith(fresh);
  }
  renderDeskHead();
  renderIndex();
  layout();
}

async function act(status) {
  const card = currentCard();
  if (!card) return;
  // Flush pending autosaves so the approved version is what gets sent.
  const pending = {};
  for (const field of ['email', 'subject', 'body']) {
    const el = $(`.${field}`, card);
    if (el.saveTimer) { clearTimeout(el.saveTimer); el.saveTimer = null; pending[field] = el.value; }
  }
  let updated;
  try {
    updated = await api(`/api/campaigns/${state.campaign.id}/contacts/${card.dataset.id}`, { method: 'PATCH', body: { ...pending, status } });
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const stays = state.filter === 'all' || state.filter === status;
  updateContact(updated, { stamped: status === 'approved' });
  if (status === 'pending') return;

  // Let the postmark land, then turn the page.
  setTimeout(() => {
    if (stays) {
      go(state.index + 1);
      return;
    }
    const el = $(`#deck .postcard[data-id="${updated.id}"]`);
    if (el) el.dataset.pos = 'gone';
    setTimeout(() => {
      el?.remove();
      renderIndex();
      state.index = Math.min(state.index, Math.max(0, filtered().length - 1));
      $('#desk').hidden = !filtered().length;
      $('#desk-empty').hidden = filtered().length > 0;
      layout();
    }, 450);
  }, status === 'approved' ? 750 : 250);
}

async function loadCampaign(id) {
  state.campaign = await api(`/api/campaigns/${id}`);
  state.index = 0;
  try { localStorage.setItem('campaign', id); } catch { /* private mode */ }
  renderDeskHead();
  renderDeck();
}

// ---------- Bundles ----------
function renderBundles() {
  const box = $('#bundles');
  if (!state.campaigns.length) {
    box.innerHTML = '<p class="empty-note">No bundles yet. <a href="#/new">Start your first one →</a></p>';
    return;
  }
  const add = document.createElement('a');
  add.className = 'bundle bundle-add';
  add.href = '#/new';
  add.innerHTML = '<div class="bundle-stack"><i><b>+</b></i></div><h2>new bundle</h2><p>describe a role, Claude does the rest</p>';
  box.replaceChildren(add, ...state.campaigns.map((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `bundle${state.campaign?.id === c.id ? ' current' : ''}`;
    paint(b, i * 2 + 1);
    const total = Object.values(c.counts).reduce((a, n) => a + n, 0);
    b.innerHTML = `<div class="bundle-stack"><i></i><i></i><i>${motifFor(i)}<b></b></i></div><h2></h2><p></p>
      <div class="bar"><i class="b-sent"></i><i class="b-stamped"></i><i class="b-skipped"></i></div>`;
    $('.bundle-stack b', b).textContent = pad(total);
    $('h2', b).textContent = c.targetRole;
    $('p', b).textContent = `${formatDate(c.createdAt)} · ${c.counts.pending} to review · ${c.counts.sent} sent`;
    const pct = (n) => `${total ? (n / total) * 100 : 0}%`;
    $('.b-sent', b).style.width = pct(c.counts.sent);
    $('.b-stamped', b).style.width = pct(c.counts.approved);
    $('.b-skipped', b).style.width = pct(c.counts.skipped);
    b.onclick = async () => {
      await loadCampaign(c.id);
      location.hash = '#/desk';
    };
    return b;
  }));
}

// ---------- Ledger ----------
async function renderLedger() {
  const box = $('#ledger');
  let rows;
  try {
    rows = await api('/api/history');
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty"><p class="empty-title">nothing posted yet</p><p class="empty-note">Postcards you send to Gmail are written in here.</p></div>';
    return;
  }
  box.replaceChildren(...rows.map((r) => {
    const row = document.createElement('div');
    row.className = 'ledger-row';
    row.innerHTML = `<div class="ledger-mark">${postmarkSvg('SENT', stampDate(r.draftedAt), { waves: false })}</div>
      <div class="ledger-who"><b></b><span></span></div>
      <div class="ledger-subject"><b></b><span></span></div>
      <span class="ledger-tag"></span>`;
    $('.ledger-who b', row).textContent = r.name;
    $('.ledger-who span', row).textContent = r.company || '';
    $('.ledger-subject b', row).textContent = r.subject || '(no subject)';
    $('.ledger-subject span', row).textContent = r.email;
    $('.ledger-tag', row).textContent = formatDate(r.draftedAt);
    return row;
  }));
}

// ---------- Account ----------
function stampTile(i, ok, title, state, mark) {
  const el = document.createElement('div');
  el.className = `setup-item ${ok ? 'on' : 'off'}`;
  paint(el, i);
  el.style.setProperty('--r', `${[-3, 2, -1.5, 3, -2, 1.5, -2.5][i % 7]}deg`);
  el.innerHTML = `<div class="setup-stamp"><div class="art"><small><span lang="hi">भारत</span> INDIA</small>${motifFor(i)}<b>${VALUES[i % VALUES.length]}</b></div></div>
    ${ok ? `<div class="setup-mark">${postmarkSvg(mark || 'READY', stampDate(), { waves: false })}</div>` : ''}
    <h3></h3><p class="hint"></p>`;
  $('h3', el).textContent = title;
  const em = document.createElement('em');
  em.textContent = state;
  $('h3', el).append(em);
  return el;
}

function editor(value, placeholder, label, save) {
  const box = document.createElement('div');
  box.className = 'sig-edit';
  box.innerHTML = '<textarea rows="4" spellcheck="false"></textarea><button class="ghost" type="button"></button>';
  $('textarea', box).value = value || '';
  $('textarea', box).placeholder = placeholder;
  $('button', box).textContent = label;
  $('button', box).onclick = async () => {
    try {
      await save($('textarea', box).value);
      toast('Saved.', 'good');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return box;
}

function renderSetup() {
  const s = state.status;
  const tiles = [];

  // Resumes
  const resume = stampTile(0, s.resumes.length > 0, 'resume', s.resumes.length ? 'ready' : 'missing');
  $('.hint', resume).textContent = s.resumes.length ? 'Attached to your emails. Keep up to 5.' : 'Upload the PDF you send out.';
  const list = document.createElement('ul');
  list.className = 'file-list';
  for (const r of s.resumes) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><button type="button" class="linkish">remove</button>';
    $('span', li).textContent = r.filename;
    $('button', li).onclick = async () => {
      if (!confirm(`Remove ${r.filename}?`)) return;
      try {
        await api(`/api/resume/${r.id}`, { method: 'DELETE' });
        state.status = await api('/api/me');
        renderSetup();
      } catch (err) { toast(err.message, 'error'); }
    };
    list.append(li);
  }
  const upload = document.createElement('label');
  upload.className = 'upload ghost';
  upload.innerHTML = `${s.resumes.length ? 'add another' : 'upload PDF'}<input type="file" accept="application/pdf,.pdf" hidden>`;
  $('input', upload).onchange = (e) => uploadResume(e.target.files[0]);
  resume.append(list, upload);
  tiles.push(resume);

  // Profile (parsed resume)
  const ps = s.profile.status;
  const profile = stampTile(1, ps === 'ready', 'profile', { ready: 'ready', parsing: 'reading…', failed: 'failed', none: 'waiting' }[ps]);
  $('.hint', profile).textContent = {
    ready: 'Claude has read your resume and uses it to match people.',
    parsing: 'Claude is reading your resume. This takes a minute.',
    failed: 'Couldn’t read that resume. Try uploading it again.',
    none: 'Made from your resume when you upload it.',
  }[ps];
  tiles.push(profile);

  // Gmail
  const gmail = stampTile(2, s.gmail.connected, 'gmail', s.gmail.connected ? 'connected' : 'not connected', 'LINKED');
  $('.hint', gmail).textContent = s.gmail.connected
    ? `Emails you approve are sent from ${s.gmail.email}. coldmail can only send; it can’t read your inbox.`
    : 'Connect so approved postcards can be sent from your Gmail. coldmail can only send; it can’t read your inbox.';
  const gbtn = document.createElement(s.gmail.connected ? 'button' : 'a');
  gbtn.className = s.gmail.connected ? 'ghost upload' : 'send upload';
  gbtn.textContent = s.gmail.connected ? 'disconnect' : 'connect gmail →';
  if (s.gmail.connected) {
    gbtn.type = 'button';
    gbtn.onclick = async () => {
      if (!confirm('Disconnect Gmail? You can connect it again any time.')) return;
      await api('/api/gmail/disconnect', { method: 'POST', body: {} });
      state.status = await api('/api/me');
      renderSetup();
      renderSidebar();
    };
  } else {
    gbtn.href = '/auth/gmail';
  }
  gmail.append(gbtn);
  tiles.push(gmail);

  // Searches this month
  const u = s.usage;
  const left = u.limit === null ? null : Math.max(0, u.limit - u.used);
  const usage = stampTile(3, left !== 0, 'searches', left === null ? 'unlimited' : `${left} left`, 'MONTHLY');
  $('.hint', usage).textContent = left === null ? 'No monthly limit on this account.' : `${u.used} of ${u.limit} used this month. Resets on the 1st.`;
  tiles.push(usage);

  // Laptop helper (only for the owner, whose searches run on their laptop)
  if (s.search?.engine === 'laptop') {
    const on = s.search.helperOnline;
    const helper = stampTile(6, on, 'laptop helper', on ? 'online' : 'offline', 'ONLINE');
    $('.hint', helper).textContent = on
      ? 'Your laptop is connected. Searches run there with Claude Code, on your Claude plan.'
      : 'Searches run on your laptop. Open the coldmail folder and run “npm run helper” to connect it.';
    tiles.push(helper);
  }

  // Signature
  const sig = stampTile(4, Boolean(s.profile.signature), 'signature', s.profile.signature ? 'ready' : 'empty');
  $('.hint', sig).textContent = 'Added under every email, exactly as written.';
  sig.append(editor(s.profile.signature, 'Your name\nPhone · email\nLinkedIn: https://…', 'save signature', async (value) => {
    await api('/api/profile', { method: 'PATCH', body: { signature: value } });
    state.status.profile.signature = value.trim();
  }));
  tiles.push(sig);

  // Voice
  const voice = stampTile(5, Boolean(s.style), 'your voice', s.style ? 'set' : 'optional');
  $('.hint', voice).textContent = 'Paste one or two cold emails you liked. Claude matches their tone.';
  voice.append(editor(s.style, 'Hi Priya, I read your post on…', 'save examples', async (value) => {
    await api('/api/profile', { method: 'PATCH', body: { style: value } });
    state.status.style = value.trim();
  }));
  tiles.push(voice);

  // Account actions
  const acct = document.createElement('div');
  acct.className = 'account-actions';
  acct.innerHTML = '<p class="hint"></p><div><button class="ghost" type="button" id="sign-out">sign out</button><button class="ghost danger" type="button" id="delete-account">delete my account and data</button></div><p class="legal"><a href="/privacy">privacy</a> · <a href="/terms">terms</a></p>';
  $('.hint', acct).textContent = `Signed in as ${s.user.email}`;
  $('#sign-out', acct).onclick = async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    location.href = '/';
  };
  $('#delete-account', acct).onclick = async () => {
    if (!confirm('Delete your account? This removes your resumes, bundles and history for good, and disconnects Gmail.')) return;
    await api('/api/account', { method: 'DELETE' });
    location.href = '/';
  };

  $('#setup').replaceChildren(...tiles, acct);
}

// Landing page call-to-action depends on whether you're signed in.
function renderLanding() {
  const start = $('#landing-start');
  const desk = $('#landing-desk');
  const params = new URLSearchParams(location.search);
  if (params.get('error') === 'login') toast('Sign-in didn’t complete. Please try again.', 'error');
  if (params.get('error') === 'invite') toast('coldmail is invite-only for now. Ask the owner to add your email.', 'error');
  if (state.status.user) {
    start.href = '#/new';
    start.textContent = 'new bundle →';
    desk.hidden = false;
  } else {
    start.href = '#/desk';
    start.textContent = 'explore the demo →';
    start.onclick = (e) => { e.preventDefault(); enterDemo(); };
    desk.hidden = false;
    desk.href = '/auth/google';
    desk.textContent = 'owner sign in';
  }
}

// ---------- Init + events ----------
async function init() {
  for (const slot of $$('.logo-slot')) slot.innerHTML = MOTIFS.lotus();
  decorate();
  try { state.demo = sessionStorage.getItem('demo') === '1'; } catch { /* private mode */ }
  $('#demo-bar').hidden = !state.demo;
  $('#exit-demo').onclick = exitDemo;
  const status = await api('/api/me');
  state.status = status;
  renderLanding();
  if (!status.user) {
    route();
    return;
  }
  const campaigns = await api('/api/campaigns');
  state.campaigns = campaigns;
  renderSidebar();

  if (!campaigns.length) {
    $('#desk-head').hidden = true;
    $('#desk').hidden = true;
    $('#desk-empty').hidden = false;
    $('#desk-empty-note').innerHTML = '<a href="#/new">Start your first bundle →</a>';
  } else {
    let saved = null;
    try { saved = localStorage.getItem('campaign'); } catch { /* private mode */ }
    await loadCampaign(campaigns.some((c) => c.id === saved) ? saved : campaigns[0].id);
  }
  await pollRun();
  route();
}

window.addEventListener('hashchange', route);

$('#filters').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  state.filter = btn.dataset.filter;
  state.index = 0;
  renderDeskHead();
  renderDeck();
});

$('#prev').onclick = () => go(state.index - 1);
$('#next').onclick = () => go(state.index + 1);
$('#act-approve').onclick = () => act('approved');
$('#act-skip').onclick = () => act('skipped');
$('#act-undo').onclick = () => act('pending');

document.addEventListener('keydown', (e) => {
  if (state.view !== 'desk' || e.target.closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight') go(state.index + 1);
  if (e.key === 'ArrowLeft') go(state.index - 1);
});

// Vertical wheel scrolls the stamp strip sideways.
$('#strip').addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    $('#strip').scrollLeft += e.deltaY;
  }
}, { passive: false });

$('#resume-select').addEventListener('change', async (e) => {
  const value = e.target.value;
  const body = value === '__none__' ? { attachResume: false } : { attachResume: true, resumeId: Number(value) };
  try {
    await api(`/api/campaigns/${state.campaign.id}`, { method: 'PATCH', body });
    Object.assign(state.campaign, body);
    if (value !== '__none__') state.campaign.resolvedResume = Number(value);
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#create-drafts').addEventListener('click', async () => {
  const btn = $('#create-drafts');
  btn.disabled = true;
  if (!state.status.gmail.connected) {
    toast('Connect Gmail on your account page first.', 'error');
    location.hash = '#/setup';
    renderDock();
    return;
  }
  const n = state.campaign.contacts.filter((c) => c.status === 'approved').length;
  if (!confirm(`Send ${n} email${n === 1 ? '' : 's'} from ${state.status.user.email} now? They go out immediately.`)) {
    renderDock();
    return;
  }
  btn.textContent = 'posting…';
  try {
    const results = await api(`/api/campaigns/${state.campaign.id}/send`, { method: 'POST', body: {} });
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    toast(
      failed.length ? `${ok} sent. Couldn't send ${failed.map((f) => `${f.name} (${f.error})`).join('; ')}` : `${ok} postcard${ok === 1 ? '' : 's'} sent from your Gmail.`,
      failed.length ? 'error' : 'good',
    );
  } catch (err) {
    toast(err.message, 'error');
  }
  const index = state.index;
  await loadCampaign(state.campaign.id);
  state.index = Math.max(0, Math.min(index, filtered().length - 1));
  layout();
  state.campaigns = await api('/api/campaigns');
});

window.addEventListener('beforeunload', (e) => {
  if ($$('input, textarea').some((el) => el.saveTimer)) e.preventDefault();
});

// ---------- New bundle: start a /coldmail run and track it ----------
const STEPS = [
  ['resume', 'resume read'],
  ['research', 'researching people'],
  ['emails', 'finding emails'],
  ['writing', 'writing postcards'],
  ['done', 'ready to review'],
];
let pollTimer = null;

function dismissedRun() {
  try { return localStorage.getItem('dismissedRun'); } catch { return null; }
}

function renderNew() {
  const run = state.run;
  const showTracking = run && (isLive(run) || run.id !== dismissedRun());
  $('#new-title').innerHTML = !showTracking ? 'new bundle <span lang="hi">नया पुलिंदा</span>'
    : isLive(run) ? 'on its way <span lang="hi">रास्ते में</span>'
      : run.status === 'done' ? 'delivered <span lang="hi">पहुँच गया</span>'
        : 'returned <span lang="hi">लौट आया</span>';
  $('#compose').hidden = Boolean(showTracking);
  $('#tracking').hidden = !showTracking;
  if (showTracking) return renderTracking();

  const resumes = state.status.resumes;
  const select = $('#compose-resume');
  select.replaceChildren(...resumes.map((r) => new Option(r.filename, r.id)));
  const warn = $('#compose-warn');
  warn.hidden = resumes.length > 0;
  warn.innerHTML = 'Upload your resume first, on your <a href="#/setup">account</a> page.';
  const u = state.status.usage;
  const left = u.limit === null ? null : Math.max(0, u.limit - u.used);
  $('.compose-note').textContent = left === null
    ? 'Claude researches on the web, finds emails and writes each postcard. Takes 5–15 minutes.'
    : `Claude researches on the web, finds emails and writes each postcard. Takes 5–15 minutes. ${left} of ${u.limit} searches left this month.`;
  if (left === 0) { warn.hidden = false; warn.textContent = 'You have used all your searches for this month. They reset on the 1st.'; }
  const search = state.status.search || {};
  if (search.engine === 'laptop') {
    $('.compose-note').textContent = search.helperOnline
      ? 'Runs on your laptop with Claude Code. Your laptop helper is online ✓. Takes 5–15 minutes.'
      : 'Runs on your laptop with Claude Code. Your laptop helper is offline: the search will wait until you run “npm run helper”.';
  }
  if (search.engine === 'off') {
    warn.hidden = false;
    warn.textContent = state.demo ? 'Searching is switched off in the demo. Everything else works with made-up people.' : 'Searching is switched off on this site.';
  }
  $('#compose-go').disabled = !resumes.length || left === 0 || search.engine === 'off';
}

// Claude's summary uses a little markdown: escape everything, then allow **bold** and `code`.
function miniMarkdown(text) {
  const escaped = text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  return escaped.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

let seenEvents = 0;
function renderTracking() {
  const run = state.run;
  $('#track-target').textContent = run.target;
  $('#track-kicker').textContent = run.status === 'queued' ? 'speed post · waiting for your laptop'
    : run.mode === 'more' ? `speed post · adding ${run.count} more people` : 'speed post · tracking';
  const at = STEPS.findIndex(([key]) => key === run.phase);
  const route = $('#route');
  route.style.setProperty('--f', run.status === 'done' ? 1 : Math.max(0, at) / (STEPS.length - 1));
  route.classList.toggle('finished', !isLive(run));
  $('#track-steps').replaceChildren(...STEPS.map(([key, label], i) => {
    const li = document.createElement('li');
    const done = i < at || run.status === 'done';
    li.className = done ? 'done' : i === at && isLive(run) ? 'now' : '';
    if (run.status === 'failed' && i === at) li.className = 'failed';
    li.innerHTML = '<i></i><span></span>';
    $('span', li).textContent = label;
    return li;
  }));
  $('#track-stop').hidden = !isLive(run);
  const finished = !isLive(run);
  $('#track-done').hidden = !finished;
  if (finished) {
    const text = run.status === 'done' ? run.summary : run.status === 'stopped' ? 'Stopped.' : `Something went wrong: ${run.error}`;
    $('#track-summary').innerHTML = miniMarkdown(text || 'Done.');
    $('#track-open').hidden = !(run.status === 'done' && run.campaignId);
  }
  const fresh = run.events.length - seenEvents;
  seenEvents = run.events.length;
  const events = run.events.slice(-14).reverse();
  if (run.status === 'queued') {
    const online = state.status.search?.helperOnline;
    events.unshift({ at: '', note: true, text: online ? 'Your laptop helper is online; it will pick this up in a few seconds.' : 'Waiting for your laptop. Turn it on and run “npm run helper” in the coldmail folder; this search starts as soon as it connects.' });
  } else if (isLive(run) && run.lastNote) events.unshift({ at: '', text: run.lastNote, note: true });
  $('#track-log').replaceChildren(...events.map((e, i) => {
    const li = document.createElement('li');
    if (e.note) li.className = 'note';
    if (!e.note && i < fresh + (events[0]?.note ? 1 : 0)) li.classList.add('fresh');
    li.innerHTML = '<time></time><span></span>';
    $('time', li).textContent = e.at ? new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    $('span', li).textContent = e.text;
    return li;
  }));
}

async function pollRun() {
  clearTimeout(pollTimer);
  let run;
  try { run = await api('/api/runs/latest'); } catch { return; }
  const wasRunning = isLive(state.run);
  state.run = run;
  renderSidebar();
  if (wasRunning && run && !isLive(run)) {
    [state.status, state.campaigns] = await Promise.all([api('/api/me'), api('/api/campaigns')]);
    if (run.status === 'done' && run.mode === 'more' && state.campaign?.id === run.campaignId) {
      const index = state.index;
      await loadCampaign(run.campaignId);
      state.index = Math.min(index, filtered().length - 1);
      layout();
    }
    const doneText = run.mode === 'more' ? 'New people added to your bundle.' : 'Your new bundle is ready.';
    toast(run.status === 'done' ? doneText : `Run ${run.status}.`, run.status === 'done' ? 'good' : 'error');
  }
  if (state.view === 'desk') $('#more-btn').disabled = isLive(run);
  if (state.view === 'new') renderNew();
  if (run?.status === 'queued' && !state.demo) state.status = await api('/api/me').catch(() => state.status);
  if (isLive(run)) pollTimer = setTimeout(pollRun, run.status === 'queued' ? 5000 : 2000);
}

$('#compose').addEventListener('submit', async (e) => {
  e.preventDefault();
  const target = $('#compose-target').value.trim();
  if (!target) { $('#compose-target').focus(); return; }
  $('#compose-go').disabled = true;
  try {
    seenEvents = 0;
    state.run = await api('/api/runs', { method: 'POST', body: { target, count: $('#compose-count').value, resumeId: Number($('#compose-resume').value) } });
    $('#compose-target').value = '';
    renderNew();
    pollRun();
  } catch (err) {
    toast(err.message, 'error');
  }
  $('#compose-go').disabled = false;
});

$('#track-stop').onclick = async () => {
  try { await api('/api/runs/stop', { method: 'POST', body: {} }); } catch (err) { toast(err.message, 'error'); }
};
$('#track-new').onclick = () => {
  try { localStorage.setItem('dismissedRun', state.run.id); } catch { /* private mode */ }
  renderNew();
};
$('#track-open').onclick = async () => {
  try { localStorage.setItem('dismissedRun', state.run.id); } catch { /* private mode */ }
  state.filter = 'all';
  await loadCampaign(state.run.campaignId);
  $('#desk-head').hidden = false;
  location.hash = '#/desk';
};

async function uploadResume(file) {
  if (!file) return;
  try {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'X-Coldmail': '1', 'X-Filename': encodeURIComponent(file.name) },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.status = data;
    toast(`${file.name} saved.`, 'good');
    renderSetup();
    renderSidebar();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Sidebar ----------
function renderSidebar() {
  const s = state.status;
  if (!s) return;
  const running = isLive(state.run);
  $('#run-dot').hidden = !running;
  $('#setup-dot').hidden = Boolean(s.gmail.connected && s.resumes.length > 0);
  const side = $('#side-run');
  side.hidden = !running;
  if (running) {
    $('span', side).textContent = state.run.status === 'queued' ? 'waiting for your laptop…' : state.run.mode === 'more' ? 'adding people…' : 'Claude is researching…';
    side.onclick = () => { location.hash = '#/new'; };
  }
  const u = s.usage;
  const box = $('#side-status');
  box.replaceChildren();
  const line = (on, text) => {
    const span = document.createElement('span');
    span.className = on ? 'on' : '';
    span.textContent = text;
    box.append(span);
  };
  line(s.gmail.connected, s.gmail.connected ? 'gmail connected' : 'gmail not connected');
  line(true, u.limit === null ? 'unlimited searches' : `${Math.max(0, u.limit - u.used)} of ${u.limit} searches left`);
  const who = document.createElement('span');
  who.className = 'side-user';
  who.textContent = s.user.email;
  box.append(who);
}

// ---------- Add more people to the open bundle ----------
$('#more-btn').onclick = (e) => {
  e.stopPropagation();
  $('#more-menu').hidden = !$('#more-menu').hidden;
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.more-wrap')) $('#more-menu').hidden = true;
});
for (const btn of $$('#more-menu [data-n]')) {
  btn.onclick = async () => {
    $('#more-menu').hidden = true;
    try {
      seenEvents = 0;
      state.run = await api('/api/runs', { method: 'POST', body: { moreFor: state.campaign.id, count: btn.dataset.n } });
      try { localStorage.removeItem('dismissedRun'); } catch { /* private mode */ }
      pollRun();
      location.hash = '#/new';
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ---------- Decoration: landing art, stamps, parallax ----------
function decorate() {
  $$('.float-card i').forEach((el, i) => { el.innerHTML = motifFor([0, 2, 4][i]); });
  $$('.float-stamp').forEach((el, i) => {
    el.innerHTML = `<div class="stamp-art"><small class="stamp-country"><span lang="hi">भारत</span> INDIA</small><span class="stamp-motif">${motifFor([5, 1][i])}</span><b class="stamp-value">${['₹15', '₹5'][i]}</b></div>`;
  });
  $('.float-mark').innerHTML = postmarkSvg('DELIVERED', stampDate(), { waves: false });
  $('#compose-motif').innerHTML = MOTIFS.lotus();
  const empty = $('.empty-stamp');
  if (empty) empty.innerHTML = `<div class="stamp-art"><small class="stamp-country"><span lang="hi">भारत</span> INDIA</small><span class="stamp-motif">${MOTIFS.rangoli()}</span><b class="stamp-value">₹5</b></div>`;

  // Gentle parallax on the landing art, following the pointer.
  const art = $('#landing-art');
  let frame = 0;
  window.addEventListener('pointermove', (e) => {
    if (state.view !== 'home' || frame) return;
    frame = requestAnimationFrame(() => {
      art.style.setProperty('--mx', ((e.clientX / innerWidth) - 0.5).toFixed(3));
      art.style.setProperty('--my', ((e.clientY / innerHeight) - 0.5).toFixed(3));
      frame = 0;
    });
  });
}

init().catch((err) => toast(err.message, 'error'));
