// Starts /coldmail from the review page by running Claude Code headless (`claude -p`),
// which uses your Claude Pro login, and turns its streamed events into readable progress.
// One run at a time; each run's progress is saved to data/runs/<id>.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA, ROOT } from './paths.js';
import { loadCampaign, readJson, writeJson } from './store.js';

const RUNS_DIR = path.join(DATA, 'runs');
const PHASES = ['resume', 'research', 'emails', 'writing', 'done'];

// Only these tools are allowed without asking; anything else is refused in headless mode.
const ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Task',
  'Bash(npm run status*)', 'Bash(npm run check*)', 'Bash(npm run find-emails*)', 'Bash(npm run merge*)',
];

const FROM_UI_NOTE = [
  'You were started from the coldmail review page, which is already running at http://localhost:3000.',
  'Do not start the review server in Phase 7. Nobody can answer questions during this run: make sensible choices yourself.',
  'Finish with a short summary (3-5 lines): how many people, how many emails found publicly / by Apollo or Hunter / guessed, and anyone worth double-checking.',
  'The page shows the results itself, so do not tell the user to refresh, open localhost, run commands or connect Gmail.',
].join(' ');

let current = null; // { run, child }

function claudeBinary() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const local = path.join(os.homedir(), '.local', 'bin', 'claude');
  return fs.existsSync(local) ? local : 'claude';
}

const runFile = (id) => path.join(RUNS_DIR, `${id}.json`);
const save = (run) => writeJson(runFile(run.id), run);

export function latestRun() {
  if (current) return current.run;
  if (!fs.existsSync(RUNS_DIR)) return null;
  // Run logs are named by their start time; other files here (e.g. more-<bundle>.json) are Claude's scratch files.
  const files = fs.readdirSync(RUNS_DIR).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort();
  return files.length ? readJson(path.join(RUNS_DIR, files.at(-1)), null) : null;
}

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function advance(run, phase) {
  if (PHASES.indexOf(phase) > PHASES.indexOf(run.phase)) run.phase = phase;
}

// Turn one tool call into a progress line, and move the phase forward.
function describeTool(run, name, input = {}) {
  const file = input.file_path || input.path || '';
  const campaignMatch = file.match(/data\/campaigns\/([\w-]+)\.json$/);
  if (campaignMatch && campaignMatch[1] !== 'demo' && run.mode !== 'more') run.campaignId = campaignMatch[1];

  switch (name) {
    case 'Read':
      if (file.endsWith('.pdf')) { advance(run, 'resume'); return 'reading your resume'; }
      if (file.endsWith('profile.json')) return 'looking over your profile';
      if (file.endsWith('history.json')) return 'checking who you already wrote to';
      return null;
    case 'Write':
    case 'Edit':
      if (file.endsWith('profile.json')) { advance(run, 'resume'); return 'saving your profile'; }
      if (/data\/runs\/more-/.test(file)) {
        if (run.sawEmailLookup) { advance(run, 'writing'); return 'writing postcards'; }
        return 'noting the people found';
      }
      if (campaignMatch) {
        if (run.sawEmailLookup) { advance(run, 'writing'); return 'writing postcards'; }
        return 'saving the people found';
      }
      return null;
    case 'WebSearch':
      advance(run, 'research');
      return `searching “${input.query}”`;
    case 'WebFetch':
      advance(run, 'research');
      return `reading ${hostname(input.url)}`;
    case 'Task':
    case 'Agent':
      advance(run, 'research');
      return `sending a helper: ${input.description || 'research'}`;
    case 'Bash': {
      const cmd = input.command || '';
      if (cmd.includes('find-emails')) { run.sawEmailLookup = true; advance(run, 'emails'); return 'looking up email addresses'; }
      if (cmd.includes('npm run merge')) return run.sawEmailLookup ? 'adding postcards to the bundle' : 'adding the new people to the bundle';
      if (cmd.includes('check')) return 'double-checking the bundle';
      if (cmd.includes('status')) return 'checking setup';
      return null;
    }
    default:
      return null;
  }
}

// Returns true when this event is Claude's final message: text only, after the postcards were written.
function handleEvent(run, event) {
  if (event.type === 'assistant') {
    const content = event.message?.content || [];
    const final = run.phase === 'writing' && content.some((b) => b.type === 'text' && b.text.trim()) && !content.some((b) => b.type === 'tool_use');
    if (final) run.finalText = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim().slice(0, 4000);
    for (const block of content) {
      if (block.type === 'tool_use') {
        const text = describeTool(run, block.name, block.input);
        if (text) run.events.push({ at: new Date().toISOString(), kind: 'step', text });
      } else if (block.type === 'text' && block.text.trim()) {
        run.lastNote = block.text.trim().slice(0, 400);
      }
    }
    return final;
  } else if (event.type === 'result') {
    run.summary = String(event.result || '').trim();
    if (event.is_error || event.subtype !== 'success') run.error = run.summary || event.subtype;
  }
  return false;
}

// Claude sometimes writes its final summary and then doesn't exit. If nothing else happens for
// this long after the final message, the work is finished: stop the process and count it as done.
const FINISH_GRACE_MS = Number(process.env.COLDMAIL_FINISH_GRACE_MS || 120_000);

// Either a new bundle ({ target, count, resumeFile }) or more people for one ({ moreFor, count }).
// extraNote: optional extra instructions appended to the run (used by the website helper).
export function startRun({ target, count, resumeFile, moreFor, extraNote }) {
  if (current) throw Object.assign(new Error('A run is already going. Wait for it, or stop it first.'), { status: 409 });
  const n = Math.min(25, Math.max(1, Number(count) || 15));
  let cleanTarget;
  if (moreFor) {
    try {
      cleanTarget = loadCampaign(moreFor).targetRole;
    } catch (err) {
      throw Object.assign(err, { status: 404 });
    }
  } else {
    cleanTarget = String(target || '').replace(/\s+/g, ' ').trim();
    if (cleanTarget.length < 3) throw Object.assign(new Error('Describe the role you want first.'), { status: 400 });
  }

  const run = {
    id: new Date().toISOString().replace(/[:.]/g, '-'),
    target: cleanTarget,
    count: n,
    resumeFile: resumeFile || null,
    mode: moreFor ? 'more' : 'new',
    status: 'running',
    phase: 'resume',
    startedAt: new Date().toISOString(),
    events: [],
    campaignId: moreFor || null,
  };
  const args = moreFor ? `more ${n} for ${moreFor}` : `${cleanTarget}, ${n} people${resumeFile ? `, use resume ${resumeFile}` : ''}`;
  const child = spawn(claudeBinary(), [
    '-p', `/coldmail ${args}`,
    '--model', process.env.COLDMAIL_MODEL || 'claude-sonnet-5-5', // lighter on your Claude plan than Opus
    '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...ALLOWED_TOOLS,
    '--append-system-prompt', extraNote ? `${FROM_UI_NOTE}\n\n${extraNote}` : FROM_UI_NOTE,
  ], {
    cwd: ROOT,
    env: { ...process.env, PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  current = { run, child };
  save(run);

  let buffer = '';
  let finishTimer = null;
  let stderr = '';
  let lastSave = 0;
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let final = false;
      try { final = handleEvent(run, JSON.parse(line)); } catch { /* not JSON, ignore */ }
      clearTimeout(finishTimer);
      if (final) {
        finishTimer = setTimeout(() => {
          run.finishedByWatchdog = true;
          child.kill('SIGTERM');
        }, FINISH_GRACE_MS);
      }
    }
    if (Date.now() - lastSave > 1000) { save(run); lastSave = Date.now(); }
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  child.on('error', (err) => {
    run.error = err.code === 'ENOENT' ? 'Could not find the claude command. Is Claude Code installed?' : err.message;
  });
  // 'exit' rather than 'close': a stray child process can keep the output pipe open after Claude itself has exited.
  child.on('exit', (code) => {
    clearTimeout(finishTimer);
    run.endedAt = new Date().toISOString();
    if (run.stopped) run.status = 'stopped';
    else if ((code === 0 && !run.error) || run.finishedByWatchdog) {
      if (!run.summary && run.finalText) run.summary = run.finalText;
      run.status = 'done';
      run.phase = 'done';
    } else {
      run.status = 'failed';
      run.error = run.error || stderr.trim() || `claude exited with code ${code}`;
    }
    save(run);
    current = null;
  });
  return run;
}

export function stopRun() {
  if (!current) return latestRun();
  current.run.stopped = true;
  current.child.kill('SIGTERM');
  return current.run;
}
