#!/usr/bin/env node
// Collects live usage figures for the homepage and writes docs/data/live.json.
//
//   node stats/collect.mjs                 # collect, write docs/data/live.json, bake docs/index.html
//   node stats/collect.mjs --dry-run       # print the JSON, write nothing
//   node stats/collect.mjs --out x.json    # write the JSON elsewhere
//   node stats/collect.mjs --html x.html   # bake into another copy of index.html
//   node stats/collect.mjs --from y.json   # skip the sources, render an existing live.json
//   node stats/collect.mjs --check-cf      # verify the Cloudflare query against the live schema
//   node stats/collect.mjs --checks z.json # keep the check history elsewhere (default docs/data/checks.json)
//   node stats/collect.mjs --dry-run --now 2026-12-20T09:00:00Z   # testing: PNCT window as of that date
//
// Environment (see README, "Live figures"): CF_API_TOKEN, CF_ACCOUNT_TAG, CF_SITE_TAG for PNCT;
// Prazo is read with psql as the role cv_stats over the local socket (PRAZO_DB_ROLE, PRAZO_DB,
// PRAZO_UNIT override the defaults cv_stats, prazo, prazo.service).
//
// After writing the JSON it rewrites, in index.html:
//   - the <!-- live:start --> ... <!-- live:end --> region: the "Right now" sentences (metrics that
//     are public, have a value, and reach their optional minPublic threshold) or the static
//     fallback sentence when there are none;
//   - the status words in each <tr data-system="..."> of the "Systems I run" table.
// Output depends only on the data, so re-rendering the same JSON gives no diff.
// docs/scripts/live.js then turns the baked timestamp into "updated X ago" and applies the
// stale styling after 48 h.
//
// Each run also appends this run's health checks to docs/data/checks.json ({at, prazo, pnct}:
// true = passed, false = failed, null = not checked), keeps the last 35 days, and computes
// uptime_30d from it.
//
// Node 18+ (global fetch), no dependencies. Meant to run from cron on the Raspberry Pi,
// followed by a commit and push of docs/data/live.json (see README, "Live figures").
//
// Rules:
//   - Every source returns a number or null. A source that fails, times out or is not
//     wired up yet returns null; null values are never shown on the site.
//   - Never estimate, round up or fill in a value. If it isn't measured, it's null.
//   - "public" is decided here, not by the source. Parking metrics stay private until
//     Devexperts signs off on publishing them.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(here, '..', 'docs', 'data', 'live.json');
const DEFAULT_HTML = path.join(here, '..', 'docs', 'index.html');
const DEFAULT_CHECKS = path.join(here, '..', 'docs', 'data', 'checks.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKS_KEEP_DAYS = 35;
const UPTIME_DAYS = 30;
const SOURCE_TIMEOUT_MS = 15_000;
// "Now" for placing the PNCT window. --now <ISO> overrides it, for testing only.
const nowArg = process.argv.indexOf('--now');
const NOW = nowArg >= 0 ? new Date(process.argv[nowArg + 1]) : new Date();
if (Number.isNaN(NOW.getTime())) throw new Error('--now needs an ISO date, e.g. 2026-12-01T09:00:00Z');

// ---------- helpers ----------

const execFileP = promisify(execFile);

/** fetch() with a timeout; throws on non-2xx. */
async function fetchWithTimeout(url, options = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/** Runs a query against the Cloudflare GraphQL Analytics API. Needs CF_API_TOKEN (Account Analytics: Read). */
async function cloudflareGraphQL(query, variables) {
  const token = process.env.CF_API_TOKEN;
  if (!token) throw new Error('CF_API_TOKEN is not set');
  const res = await fetchWithTimeout('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Cloudflare GraphQL: ${json.errors.map(e => e.message).join('; ')}`);
  return json.data;
}

/** Runs one read-only query as the cv_stats role over the local socket; returns psql's unaligned output. */
async function psqlCvStats(sql) {
  const { stdout } = await execFileP('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1',
    '-U', process.env.PRAZO_DB_ROLE ?? 'cv_stats', '-d', process.env.PRAZO_DB ?? 'prazo', '-c', sql],
    { timeout: SOURCE_TIMEOUT_MS });
  return stdout.trim();
}

/** Midnight Europe/Lisbon at the start of the given calendar day (day may be <= 0: Date rolls it over). */
function lisbonMidnight(year, month, day) {
  const guess = new Date(Date.UTC(year, month - 1, day));
  // Lisbon is UTC+0 or UTC+1 and switches at 01:00 UTC, so the offset at 00:00 UTC on that day
  // is the offset in force at local midnight.
  const name = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Lisbon', timeZoneName: 'longOffset' })
    .formatToParts(guess).find(p => p.type === 'timeZoneName').value;          // "GMT", "GMT+01:00"
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMin = m ? (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(guess.getTime() - offsetMin * 60_000);
}

/** The last `days` full days in Europe/Lisbon before `now`: { start, end } (end = today 00:00, exclusive). */
function lastFullLisbonDays(days, now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-').map(Number);
  return { start: lisbonMidnight(y, m, d - days), end: lisbonMidnight(y, m, d) };
}

// ---------- sources: one async function per metric ----------
// Each gets a context { now: Date, checks: [...] } (checks includes this run's row) and returns
// { value: number|null, asOf?: ISO string }. asOf defaults to "now" when value is set.

async function prazoActiveUsers() {
  // People Prazo is reminding, from the aggregate view public_stats in Prazo's database
  // (migration V5 in singledev-eu/prazo; definition in its comment and in the README here):
  // finished onboarding, at least one obligation, and not blocked/deactivated on Telegram.
  const out = await psqlCvStats('SELECT people_reminded FROM public_stats');
  if (!/^\d+$/.test(out)) throw new Error(`unexpected output from public_stats: "${out.slice(0, 40)}"`);
  return { value: Number(out) };
}

// Cloudflare Web Analytics has data for pnct.singledev.eu from this day on (00:00 Europe/Lisbon).
// A window that starts earlier would be incomplete, so it stays null.
const PNCT_DATA_SINCE = '2026-11-16T00:00:00Z';
// Only the production host; Pages preview hosts (*.pnct-map.pages.dev) share the site tag.
const PNCT_HOST = 'pnct.singledev.eu';

const PNCT_QUERY = `query PnctVisits($accountTag: string!, $siteTag: string!, $host: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      rumPageloadEventsAdaptiveGroups(limit: 1, filter: { siteTag: $siteTag, requestHost: $host, datetime_geq: $start, datetime_lt: $end }) {
        sum { visits }
      }
    }
  }
}`;

async function pnctVisitors30d() {
  // Visits to pnct.singledev.eu over the last 30 full days (Europe/Lisbon, today excluded), from
  // Cloudflare Web Analytics. Null until the whole window lies after PNCT_DATA_SINCE.
  const win = lastFullLisbonDays(30, NOW);
  if (win.start < new Date(PNCT_DATA_SINCE)) {
    const first = new Date(new Date(PNCT_DATA_SINCE).getTime() + 30 * DAY_MS).toISOString().slice(0, 10);
    console.error(`[collect] pnct_visitors_30d: window starts before Web Analytics data (${PNCT_DATA_SINCE.slice(0, 10)}); first figure on ${first}`);
    return { value: null };
  }
  const { CF_ACCOUNT_TAG: accountTag, CF_SITE_TAG: siteTag } = process.env;
  if (!accountTag || !siteTag) throw new Error('CF_ACCOUNT_TAG and CF_SITE_TAG must be set');
  const data = await cloudflareGraphQL(PNCT_QUERY,
    { accountTag, siteTag, host: PNCT_HOST, start: win.start.toISOString(), end: win.end.toISOString() });
  const accounts = data?.viewer?.accounts ?? [];
  if (!accounts.length) throw new Error('no account matched CF_ACCOUNT_TAG (or the token cannot read it)');
  const visits = accounts[0].rumPageloadEventsAdaptiveGroups?.[0]?.sum?.visits;
  // No rows means no recorded pageviews in the window; don't turn missing data into "0 visitors".
  if (!isNumber(visits)) throw new Error(`no Web Analytics data for ${PNCT_HOST} in the last 30 days`);
  return { value: visits, asOf: win.end.toISOString() };
}

async function uptime30d({ now, checks }) {
  // Share of passed health checks (prazo and pnct, every run) over the last 30 days, from
  // docs/data/checks.json. Null until the history covers 30 days. Rounded down to 0.1 %, so a
  // single failure never shows as 100 %.
  const from = now.getTime() - UPTIME_DAYS * DAY_MS;
  const oldest = checks.length ? Date.parse(checks[0].at) : NaN;
  if (!(oldest <= from)) return { value: null };
  const results = checks.filter(c => Date.parse(c.at) >= from)
    .flatMap(c => CHECKED_SYSTEMS.map(id => c[id]))
    .filter(r => typeof r === 'boolean');
  if (!results.length) return { value: null };
  const passed = results.filter(Boolean).length;
  return { value: Math.floor((passed / results.length) * 1000) / 10 };
}

async function parkingActiveUsers() {
  // Not collected: the Pi can't reach the company network. Private metric ("public": false)
  // until Devexperts approves publishing it.
  return { value: null };
}

async function parkingBookingsWeek() {
  // Not collected, see parkingActiveUsers.
  return { value: null };
}

// ---------- health checks: one per system ----------
// Each returns 'running' | 'degraded' | null (null = not checked; the site keeps its static text).

const HEALTH = {
  /** Running if the Prazo systemd unit on this machine is active. */
  async prazo() {
    try {
      await execFileP('systemctl', ['is-active', '--quiet', process.env.PRAZO_UNIT ?? 'prazo.service'], { timeout: 10_000 });
      return 'running';
    } catch (e) {
      if (e.code === 'ENOENT') return null;           // no systemd here (e.g. a laptop): not checked
      return 'degraded';                              // non-zero exit: inactive, failed or unknown
    }
  },
  /** Running if https://pnct.singledev.eu answers 200 within 10 s. */
  async pnct() {
    try {
      const res = await fetch('https://pnct.singledev.eu/', { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      return res.status === 200 ? 'running' : 'degraded';
    } catch {
      return 'degraded';
    }
  },
};

// ---------- registry ----------

const METRICS = [
  { id: 'prazo_active_users', system: 'prazo', public: true, minPublic: 10, source: prazoActiveUsers,
    sentence: 'Prazo is reminding {value} people about Portuguese deadlines.',
    sentenceOne: 'Prazo is reminding {value} person about Portuguese deadlines.' },
  { id: 'pnct_visitors_30d', system: 'pnct', public: true, minPublic: 100, source: pnctVisitors30d,
    sentence: 'The PNCT map had {value} visitors in the last 30 days.',
    sentenceOne: 'The PNCT map had {value} visitor in the last 30 days.' },
  { id: 'uptime_30d', system: null, public: true, source: uptime30d,
    sentence: 'Over the last 30 days, {value}% of health checks on my public systems passed.' },
  { id: 'parking_active_users', system: 'parking', public: false, source: parkingActiveUsers,
    sentence: 'The office parking service has {value} active users.' },
  { id: 'parking_bookings_week', system: 'parking', public: false, source: parkingBookingsWeek,
    sentence: 'The office parking service took {value} bookings last week.' },
];

// minPublic: the metric is rendered only once its value reaches this (optional) threshold.

// Status shown when a system isn't checked: hubithab is in development; parking is out of reach
// from the Pi, so it gets a plain description instead of a live status.
const SYSTEMS = [
  { id: 'prazo', status: 'running' },
  { id: 'pnct', status: 'running' },
  { id: 'parking', status: 'internal', unchecked: true },
  { id: 'hubithab', status: 'development', unchecked: true },
];

// ---------- run ----------

async function runSource(name, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[collect] ${name} failed: ${e.message}`);
    return null;
  }
}

const isNumber = v => typeof v === 'number' && Number.isFinite(v);

const CHECKED_SYSTEMS = SYSTEMS.filter(s => !s.unchecked && HEALTH[s.id]).map(s => s.id);

/** Reads the check history; a missing file is an empty history, a broken one is an error. */
async function readChecks(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const rows = JSON.parse(text).checks;
  if (!Array.isArray(rows)) throw new Error(`${file}: "checks" must be an array`);
  return rows.filter(r => r && validTime(r.at)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** One row per line, so each run adds a one-line diff. */
const checksJson = rows => `{\n  "checks": [\n${rows.map(r => `    ${JSON.stringify(r)}`).join(',\n')}${rows.length ? '\n' : ''}  ]\n}\n`;

async function collect(history) {
  const nowDate = new Date();
  const now = nowDate.toISOString();

  // Health checks first: this run's results count towards uptime_30d.
  const systems = await Promise.all(SYSTEMS.map(async s => {
    if (s.unchecked || !HEALTH[s.id]) return { id: s.id, status: s.status, checkedAt: null };
    const status = await runSource(`health:${s.id}`, HEALTH[s.id]);
    return status
      ? { id: s.id, status, checkedAt: new Date().toISOString() }
      : { id: s.id, status: s.status, checkedAt: null };
  }));
  const row = { at: now };
  for (const id of CHECKED_SYSTEMS) {
    const s = systems.find(x => x.id === id);
    row[id] = s.checkedAt === null ? null : s.status === 'running';
  }
  const keepFrom = nowDate.getTime() - CHECKS_KEEP_DAYS * DAY_MS;
  const checks = [...history.filter(c => Date.parse(c.at) >= keepFrom), row];

  const metrics = await Promise.all(METRICS.map(async m => {
    const r = await runSource(m.id, () => m.source({ now: nowDate, checks }));
    const value = r && isNumber(r.value) ? r.value : null;
    return {
      id: m.id,
      system: m.system,
      value,
      sentence: m.sentence,
      ...(m.sentenceOne ? { sentenceOne: m.sentenceOne } : {}),
      asOf: value === null ? null : (r.asOf ?? now),
      public: m.public,
      ...(isNumber(m.minPublic) ? { minPublic: m.minPublic } : {}),
    };
  }));

  const anything = metrics.some(m => m.value !== null) || systems.some(s => s.checkedAt !== null);
  // generatedAt stays null while nothing is measured, so the site never claims "updated just now"
  // for an empty file.
  return { data: { generatedAt: anything ? now : null, metrics, systems }, checks };
}

// ---------- --check-cf: verify the PNCT query against the live GraphQL schema ----------

/** Walks the schema by introspection (no remembered field names) and runs the query once. */
async function checkCloudflare() {
  const unwrap = t => { while (t && t.ofType) t = t.ofType; return t; };
  const typeQuery = `query T($name: String!) { __type(name: $name) {
    fields { name args { name type { name kind ofType { name kind ofType { name kind } } } }
             type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } }
    inputFields { name } } }`;
  const type = async name => (await cloudflareGraphQL(typeQuery, { name })).__type;
  const field = (t, name, where) => {
    const f = t?.fields?.find(x => x.name === name);
    if (!f) throw new Error(`field "${name}" not found on ${where}`);
    return f;
  };

  const root = (await cloudflareGraphQL('{ __schema { queryType { name } } }')).__schema.queryType.name;
  const viewer = unwrap(field(await type(root), 'viewer', root).type).name;
  const account = unwrap(field(await type(viewer), 'accounts', viewer).type).name;
  const rum = field(await type(account), 'rumPageloadEventsAdaptiveGroups', account);
  const group = unwrap(rum.type).name;
  const sum = unwrap(field(await type(group), 'sum', group).type).name;
  field(await type(sum), 'visits', sum);
  const filterType = unwrap(rum.args.find(a => a.name === 'filter')?.type)?.name;
  const filterFields = ((await type(filterType))?.inputFields ?? []).map(f => f.name);
  for (const f of ['siteTag', 'requestHost', 'datetime_geq', 'datetime_lt']) {
    if (!filterFields.includes(f)) throw new Error(`filter field "${f}" not found on ${filterType}`);
  }
  console.log(`schema ok: ${viewer}.accounts -> ${account}.rumPageloadEventsAdaptiveGroups(filter: ${filterType}) -> ${group}.sum.visits`);
  const end = new Date(), start = new Date(end.getTime() - 7 * 864e5);
  const week = await cloudflareGraphQL(PNCT_QUERY, { accountTag: process.env.CF_ACCOUNT_TAG, siteTag: process.env.CF_SITE_TAG,
    host: PNCT_HOST, start: start.toISOString(), end: end.toISOString() });
  if (!week?.viewer?.accounts?.length) throw new Error('no account matched CF_ACCOUNT_TAG (or the token cannot read it)');
  console.log(`query ok: ${week.viewer.accounts[0].rumPageloadEventsAdaptiveGroups?.[0]?.sum?.visits ?? 0} visits on ${PNCT_HOST} in the last 7 days`);
  const r = await pnctVisitors30d().catch(e => { console.log(`30-day figure: ${e.message}`); return null; });
  if (r) console.log(`30-day figure: ${r.value ?? 'not available yet'}`);
}

// ---------- baking into index.html ----------

const LIVE_START = '<!-- live:start (generated by stats/collect.mjs) -->';
const LIVE_END = '<!-- live:end -->';
const FALLBACK = '<span class="label">Right now:</span> Prazo is sending Telegram reminders about Portuguese deadlines from a Raspberry Pi, and the PNCT map is online at <a href="https://pnct.singledev.eu">pnct.singledev.eu</a>.';
const STATUS_WORDS = { running: 'Running', development: 'In development', degraded: 'Degraded at the last check',
  internal: 'Internal, in use daily' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const validTime = iso => typeof iso === 'string' && !Number.isNaN(Date.parse(iso));
const numberFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const monthFormat = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const stampFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });

const publishable = m => m && m.public === true && isNumber(m.value)
  && (!isNumber(m.minPublic) || m.value >= m.minPublic)
  && typeof m.sentence === 'string' && m.sentence.includes('{value}')
  && (!m.sentence.includes('{month}') || validTime(m.asOf));

/** One sentence as HTML. A unit right after {value} (e.g. "%") goes inside the teal span. */
function sentenceHtml(m) {
  const template = m.value === 1 && typeof m.sentenceOne === 'string' && m.sentenceOne.includes('{value}') ? m.sentenceOne : m.sentence;
  return template.split(/(\{value\}%?|\{month\})/).map(part => {
    if (part.startsWith('{value}')) {
      const unit = part.slice('{value}'.length);
      return `<span class="num" data-value="${m.value}"${unit ? ` data-unit="${esc(unit)}"` : ''}>${numberFormat.format(m.value)}${esc(unit)}</span>`;
    }
    if (part === '{month}') return monthFormat.format(new Date(m.asOf));
    return esc(part);
  }).join('');
}

function liveBlock(data) {
  const metrics = (data.metrics ?? []).filter(publishable);
  const ind = '                ';
  if (!validTime(data.generatedAt) || !metrics.length) return `${ind}<p class="now-text">${FALLBACK}</p>\n`;
  const at = esc(data.generatedAt);
  return `${ind}<p class="now-text" id="now-text" data-generated-at="${at}"><span class="label">Right now:</span> ${metrics.map(sentenceHtml).join(' ')}</p>\n`
    + `${ind}<p class="now-meta" id="now-meta"><span class="dot" aria-hidden="true"></span><span>updated <time datetime="${at}">${stampFormat.format(new Date(data.generatedAt))} UTC</time></span></p>\n`;
}

function statusSpan(s) {
  const fallback = SYSTEMS.find(x => x.id === s.id)?.status;
  const status = STATUS_WORDS[s.status] ? s.status : fallback;
  if (!validTime(s.checkedAt)) return `<span class="status">${STATUS_WORDS[status]}</span>`;
  const day = dayFormat.format(new Date(s.checkedAt));
  const words = status === 'degraded' ? `${STATUS_WORDS.degraded}, ${day}` : STATUS_WORDS[status];
  return `<span class="status${status === 'degraded' ? ' is-warn' : ''}" data-checked-at="${esc(s.checkedAt)}">${words}</span>`;
}

function bake(html, data) {
  if (!html.includes(LIVE_START) || !html.includes(LIVE_END)) throw new Error('index.html: live markers not found');
  html = html.slice(0, html.indexOf(LIVE_START) + LIVE_START.length) + '\n' + liveBlock(data) + html.slice(html.indexOf(LIVE_END));
  for (const s of data.systems ?? []) {
    if (!SYSTEMS.some(x => x.id === s.id)) continue;
    const row = new RegExp(`(<tr data-system="${s.id}">[\\s\\S]*?)<span class="status[^"]*"[^>]*>[^<]*</span>`);
    if (!row.test(html)) throw new Error(`index.html: no status cell for system "${s.id}"`);
    html = html.replace(row, (_, before) => before + statusSpan(s));
  }
  return html;
}

async function writeAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);  // the site never sees a half-written file
}

async function main() {
  const args = process.argv.slice(2);
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? path.resolve(args[i + 1]) : null; };
  const dryRun = args.includes('--dry-run');
  const out = opt('--out') ?? DEFAULT_OUT;
  const htmlFile = opt('--html') ?? DEFAULT_HTML;
  const from = opt('--from');
  const checksFile = opt('--checks') ?? DEFAULT_CHECKS;

  if (args.includes('--check-cf')) { await checkCloudflare(); return; }

  // --from only re-renders existing data: no sources, no checks, checks.json untouched.
  const result = from ? { data: JSON.parse(await readFile(from, 'utf8')), checks: null }
    : await collect(await readChecks(checksFile));
  const { data, checks } = result;
  const json = JSON.stringify(data, null, 2) + '\n';
  if (dryRun) {
    process.stdout.write(json);
    if (checks) console.error(`[collect] dry run: ${checks.length} check row(s) in the last ${CHECKS_KEEP_DAYS} days incl. this run; nothing written`);
    return;
  }

  await writeAtomic(out, json);
  await writeAtomic(htmlFile, bake(await readFile(htmlFile, 'utf8'), data));
  if (checks) await writeAtomic(checksFile, checksJson(checks));    // last: a failed run adds no row
  const shown = (data.metrics ?? []).filter(publishable).length;
  console.log(`[collect] wrote ${path.relative(process.cwd(), out)} and baked ${path.relative(process.cwd(), htmlFile)}: ${shown} public metric(s) with values`);
}

main().catch(e => { console.error(e); process.exit(1); });
