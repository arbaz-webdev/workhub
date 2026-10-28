// Load test for the API: many people using WorkHub at once (issue #72: 1,000 concurrent
// users, p95 under 300 ms). Each virtual user keeps the inbox's live stream open, as the
// app does, and every few seconds loads a page's worth of data. Read-only: it changes nothing.
//
//   LOAD_TEST_PASSWORD=... node scripts/load-test.mjs --users 1000 --duration 120
//
// Options (all optional):
//   --url        API address (default http://localhost:4000, i.e. straight to the API)
//   --users      virtual users (default 1000)      --duration  seconds at full load (default 60)
//   --ramp       seconds to add them all (default 30)   --think  ms between requests (default 3000)
//   --emails     accounts to sign in as, comma-separated; virtual users share their sessions
//                (default the local demo accounts, see README). LOAD_TEST_PASSWORD is their password.
//   --no-streams don't hold an inbox stream open per user
//   --json FILE  also write the results as JSON
//   --allow-remote  needed for anything but localhost: don't load someone else's server,
//                   and remember that a free-plan host may suspend a service that's hammered.
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4000' },
    users: { type: 'string', default: '1000' },
    duration: { type: 'string', default: '60' },
    ramp: { type: 'string', default: '30' },
    think: { type: 'string', default: '3000' },
    emails: { type: 'string', default: 'demo.owner@example.test,demo.member@example.test' },
    origin: { type: 'string', default: 'http://localhost:3000' },
    'no-streams': { type: 'boolean', default: false },
    json: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
    'target-p95': { type: 'string', default: '300' },
  },
});

const base = new URL(opts.url);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && !opts['allow-remote']) {
  console.error(`Refusing to load ${base.host}: pass --allow-remote if it's yours to test.`);
  process.exit(2);
}
const password = process.env.LOAD_TEST_PASSWORD;
if (!password) {
  console.error('Set LOAD_TEST_PASSWORD to the test accounts’ password.');
  process.exit(2);
}
const USERS = Number(opts.users);
const DURATION_MS = Number(opts.duration) * 1000;
const RAMP_MS = Number(opts.ramp) * 1000;
const THINK_MS = Number(opts.think);
const TARGET_P95 = Number(opts['target-p95']);

const client = base.protocol === 'https:' ? https : http;
const agent = new client.Agent({ keepAlive: true, maxSockets: Infinity });
const streamAgent = new client.Agent({ keepAlive: false, maxSockets: Infinity });
/** A path under --url (which may itself have a path, such as https://host/api). */
const apiUrl = (path) => new URL(path.replace(/^\//, ''), base.href.endsWith('/') ? base.href : `${base.href}/`);

/** One request; resolves with status, body and how long it took. Never rejects. */
function send(method, path, { cookie, workspace, body } = {}) {
  return new Promise((resolve) => {
    const started = performance.now();
    const payload = body ? JSON.stringify(body) : undefined;
    const req = client.request(
      apiUrl(path),
      {
        method,
        agent,
        headers: {
          accept: 'application/json',
          ...(payload ? { 'content-type': 'application/json', origin: opts.origin } : {}),
          ...(cookie ? { cookie } : {}),
          ...(workspace ? { 'x-workspace-id': workspace } : {}),
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString(), ms: performance.now() - started }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ status: 0, error: err.message, ms: performance.now() - started }));
    req.end(payload);
  });
}

/** Holds the inbox stream open until `stop`, as a signed-in browser tab does. */
function openStream(session, stop) {
  const req = client.request(apiUrl(`chat/events?workspace=${encodeURIComponent(session.workspace)}`), {
    agent: streamAgent,
    headers: { accept: 'text/event-stream', cookie: session.cookie },
  });
  req.on('response', (res) => {
    const ok = res.statusCode === 200;
    if (ok) streams.open += 1;
    else streams.failed += 1;
    res.resume();
    res.on('close', () => ok && (streams.open -= 1));
  });
  req.on('error', () => (streams.failed += 1));
  req.end();
  stop.then(() => req.destroy());
}

// What a person's browser loads, weighted roughly by how often (the app's home, inbox and
// attendance pages are the busiest). Endpoints an account's role can't open are dropped.
const MIX = [
  ['GET /auth/me', 20],
  ['GET /attendance/today', 15],
  ['GET /chat/summary', 15],
  ['GET /chat/presence', 10],
  ['GET /projects', 10],
  ['GET /dashboard', 8],
  ['GET /attendance/me', 6],
  ['GET /notifications', 6],
  ['GET /companies', 5],
  ['GET /workspaces/current', 5],
];

async function signIn(email) {
  const res = await send('POST', '/auth/sign-in', { body: { email, password } });
  if (res.status !== 200) throw new Error(`Signing in as ${email} failed (${res.status}): ${res.body ?? res.error}`);
  if (JSON.parse(res.body).twoFactorRequired) throw new Error(`${email} uses two-factor sign-in; use an account without it.`);
  const cookie = [res.headers['set-cookie']].flat().find((c) => c?.startsWith('wh_session='))?.split(';')[0];
  const me = JSON.parse((await send('GET', '/auth/me', { cookie })).body);
  const workspace = me.workspaces?.[0]?.id;
  if (!workspace) throw new Error(`${email} has no workspace`);
  // Keep the endpoints this account may open.
  const mix = [];
  for (const [name, weight] of MIX) {
    const [method, path] = name.split(' ');
    if ((await send(method, path, { cookie, workspace })).status === 200) mix.push([name, weight]);
  }
  return { email, cookie, workspace, mix, total: mix.reduce((t, [, w]) => t + w, 0) };
}

function pick(session) {
  let r = Math.random() * session.total;
  for (const [name, weight] of session.mix) if ((r -= weight) < 0) return name;
  return session.mix[0][0];
}

const results = new Map(); // name → { ms: number[], errors: number, statuses: {} }
const streams = { open: 0, failed: 0, peak: 0 };
let measuring = false;

function record(name, res) {
  if (!measuring) return;
  const entry = results.get(name) ?? { ms: [], errors: 0, statuses: {} };
  entry.ms.push(res.ms);
  if (res.status !== 200) {
    entry.errors += 1;
    const key = res.status || res.error;
    entry.statuses[key] = (entry.statuses[key] ?? 0) + 1;
  }
  results.set(name, entry);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => THINK_MS * (0.5 + Math.random());

async function virtualUser(session, until, stop) {
  if (!opts['no-streams']) openStream(session, stop);
  await sleep(Math.random() * THINK_MS);
  while (Date.now() < until) {
    const name = pick(session);
    const [method, path] = name.split(' ');
    record(name, await send(method, path, { cookie: session.cookie, workspace: session.workspace }));
    await sleep(jitter());
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarise(name, ms, errors, statuses) {
  const sorted = [...ms].sort((a, b) => a - b);
  return {
    name,
    requests: ms.length,
    errors,
    statuses,
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
    max: Math.round(sorted.at(-1) ?? 0),
  };
}

const emails = opts.emails.split(',').map((e) => e.trim()).filter(Boolean);
console.log(`Signing in ${emails.length} account(s) at ${base.origin}…`);
const sessions = await Promise.all(emails.map(signIn));
for (const s of sessions) console.log(`  ${s.email}: ${s.mix.map(([n]) => n.split(' ')[1]).join(', ')}`);

console.log(`Adding ${USERS} users over ${RAMP_MS / 1000}s, then measuring for ${DURATION_MS / 1000}s (about one request per user every ${THINK_MS / 1000}s)…`);
let release;
const stop = new Promise((r) => (release = r));
const until = Date.now() + RAMP_MS + DURATION_MS;
const users = [];
const peakTimer = setInterval(() => (streams.peak = Math.max(streams.peak, streams.open)), 250);
for (let i = 0; i < USERS; i += 1) {
  users.push(virtualUser(sessions[i % sessions.length], until, stop));
  await sleep(RAMP_MS / USERS);
}
measuring = true;
const measuredFrom = Date.now();
const progress = setInterval(() => {
  const done = [...results.values()].reduce((t, e) => t + e.ms.length, 0);
  console.log(`  ${Math.round((Date.now() - measuredFrom) / 1000)}s: ${done} requests, ${streams.open} live streams`);
}, 10_000);
await Promise.all(users);
measuring = false;
clearInterval(progress);
clearInterval(peakTimer);
const seconds = (Date.now() - measuredFrom) / 1000;
release();

const rows = [...results.entries()].map(([name, e]) => summarise(name, e.ms, e.errors, e.statuses)).sort((a, b) => b.requests - a.requests);
const all = summarise(
  'All requests',
  [...results.values()].flatMap((e) => e.ms),
  rows.reduce((t, r) => t + r.errors, 0),
  {},
);
const errorRate = all.requests ? all.errors / all.requests : 1;

console.log(`\n${USERS} users, ${seconds.toFixed(0)}s measured, ${(all.requests / seconds).toFixed(0)} requests/s, live streams peak ${streams.peak} (failed ${streams.failed})\n`);
console.log('Endpoint'.padEnd(26) + 'Requests'.padStart(9) + 'Errors'.padStart(8) + 'p50'.padStart(7) + 'p95'.padStart(7) + 'p99'.padStart(7) + 'Max'.padStart(8) + '  (ms)');
for (const r of [...rows, all]) {
  console.log(r.name.padEnd(26) + String(r.requests).padStart(9) + String(r.errors).padStart(8) + String(r.p50).padStart(7) + String(r.p95).padStart(7) + String(r.p99).padStart(7) + String(r.max).padStart(8));
}
for (const r of rows) if (r.errors) console.log(`  ${r.name} errors: ${JSON.stringify(r.statuses)}`);

const passed = all.p95 < TARGET_P95 && errorRate < 0.01;
console.log(`\n${passed ? 'PASS' : 'FAIL'}: p95 ${all.p95} ms (target under ${TARGET_P95}), errors ${(errorRate * 100).toFixed(2)}% (target under 1%)`);
if (opts.json) writeFileSync(opts.json, JSON.stringify({ users: USERS, seconds, rps: all.requests / seconds, streams, rows, all, passed }, null, 2));
agent.destroy();
process.exit(passed ? 0 : 1);
