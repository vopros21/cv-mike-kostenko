#!/usr/bin/env node
// Collects live usage figures for the homepage and writes docs/data/live.json.
//
//   node stats/collect.mjs                 # collect, write docs/data/live.json, bake docs/index.html
//   node stats/collect.mjs --dry-run       # print the JSON, write nothing
//   node stats/collect.mjs --out x.json    # write the JSON elsewhere
//   node stats/collect.mjs --html x.html   # bake into another copy of index.html
//   node stats/collect.mjs --from y.json   # skip the sources, render an existing live.json
//
// After writing the JSON it rewrites, in index.html:
//   - the <!-- live:start --> ... <!-- live:end --> region: the "Right now" sentences
//     (public metrics with a value only) or the static fallback sentence when there are none;
//   - the status words in each <tr data-system="..."> of the "Systems I run" table.
// Output depends only on the data, so re-rendering the same JSON gives no diff.
// docs/scripts/live.js then turns the baked timestamp into "updated X ago", applies the
// stale styling after 48 h and runs the count-up.
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
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(here, '..', 'docs', 'data', 'live.json');
const DEFAULT_HTML = path.join(here, '..', 'docs', 'index.html');
const SOURCE_TIMEOUT_MS = 15_000;

// ---------- helpers (plumbing, ready to use) ----------

/** fetch() with a timeout; throws on non-2xx. */
async function fetchWithTimeout(url, options = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/** Runs a query against the Cloudflare GraphQL Analytics API. Needs CF_API_TOKEN (Analytics:Read). */
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

/** HEAD/GET a URL; resolves true when it answers 2xx within the timeout, false otherwise. */
async function isUp(url) {
  try { await fetchWithTimeout(url, { method: 'GET', redirect: 'follow' }, 10_000); return true; }
  catch { return false; }
}

/** First and last instant (UTC) of the previous calendar month. */
function previousMonth(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
  return { start, end };
}

// ---------- sources: one async function per metric ----------
// Each returns { value: number|null, asOf?: ISO string }. asOf defaults to "now" when value is set.

async function prazoActiveUsers() {
  // TODO(prazo): count users with at least one enabled obligation, e.g. via a read-only
  // PostgreSQL role on the Pi:
  //   SELECT count(DISTINCT user_id) FROM user_obligation WHERE enabled;
  // or expose a token-protected /internal/stats endpoint from the Spring Boot app.
  return { value: null };
}

async function pnctVisitorsMonth() {
  // TODO(pnct): unique visitors to pnct.singledev.eu last calendar month, from Cloudflare
  // Web Analytics. Needs CF_API_TOKEN and CF_ZONE_OR_SITE_TAG (zone tag for the zone-level
  // httpRequests datasets, or the Web Analytics site tag for rumPageloadEventsAdaptiveGroups).
  // Sketch (Web Analytics, check field names against the current schema before relying on it):
  //
  //   const { start, end } = previousMonth();
  //   const data = await cloudflareGraphQL(`query ($account: String!, $site: String!, $from: Time!, $to: Time!) {
  //     viewer { accounts(filter: { accountTag: $account }) {
  //       rumPageloadEventsAdaptiveGroups(limit: 1, filter: { siteTag: $site, datetime_geq: $from, datetime_leq: $to }) {
  //         sum { visits }
  //       } } } }`,
  //     { account: process.env.CF_ACCOUNT_ID, site: process.env.CF_ZONE_OR_SITE_TAG,
  //       from: start.toISOString(), to: end.toISOString() });
  //   const value = data.viewer.accounts[0]?.rumPageloadEventsAdaptiveGroups[0]?.sum.visits ?? null;
  //   return { value, asOf: end.toISOString() };   // asOf drives "{month}" in the sentence
  void cloudflareGraphQL; void previousMonth;
  return { value: null };
}

async function uptime30d() {
  // TODO(uptime): share of passed health checks over the last 30 days, in percent (e.g. 99.8).
  // Needs a history; one option is an Uptime Kuma instance on the Pi and its API, another is
  // appending each checkHealth() result below to a local log and computing the ratio here.
  return { value: null };
}

async function parkingActiveUsers() {
  // TODO(parking): distinct users with a booking in the last 30 days. Private metric:
  // stays "public": false until Devexperts approves publishing it.
  return { value: null };
}

async function parkingBookingsWeek() {
  // TODO(parking): bookings in the previous ISO week. Private metric, see above.
  return { value: null };
}

// ---------- health checks: one per system ----------
// Each returns 'running' | 'degraded' | null (null = not checked; the site keeps its static text).

async function checkHealth(system) {
  // TODO(health): wire up a real check per system, for example:
  //   pnct:    isUp('https://pnct.singledev.eu/')
  //   prazo:   a heartbeat the bot writes to PostgreSQL every few minutes, or Telegram getMe
  //   parking: the service's /health endpoint from inside the company network (if allowed)
  // and return (await isUp(url)) ? 'running' : 'degraded'.
  void isUp; void system;
  return null;
}

// ---------- registry ----------

const METRICS = [
  { id: 'prazo_active_users', system: 'prazo', public: true, source: prazoActiveUsers,
    sentence: 'Prazo is reminding {value} people about Portuguese deadlines.' },
  { id: 'pnct_visitors_month', system: 'pnct', public: true, source: pnctVisitorsMonth,
    sentence: 'pnct.singledev.eu had {value} visitors in {month}.' },
  { id: 'uptime_30d', system: null, public: true, source: uptime30d,
    sentence: 'Over the last 30 days, {value}% of health checks on my public systems passed.' },
  { id: 'parking_active_users', system: 'parking', public: false, source: parkingActiveUsers,
    sentence: 'The office parking service has {value} active users.' },
  { id: 'parking_bookings_week', system: 'parking', public: false, source: parkingBookingsWeek,
    sentence: 'The office parking service took {value} bookings last week.' },
];

// Status used when a system has no health check yet ("development" is never checked).
const SYSTEMS = [
  { id: 'prazo', status: 'running' },
  { id: 'pnct', status: 'running' },
  { id: 'parking', status: 'running' },
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

async function collect() {
  const now = new Date().toISOString();

  const metrics = await Promise.all(METRICS.map(async m => {
    const r = await runSource(m.id, m.source);
    const value = r && isNumber(r.value) ? r.value : null;
    return {
      id: m.id,
      system: m.system,
      value,
      sentence: m.sentence,
      asOf: value === null ? null : (r.asOf ?? now),
      public: m.public,
    };
  }));

  const systems = await Promise.all(SYSTEMS.map(async s => {
    if (s.unchecked) return { id: s.id, status: s.status, checkedAt: null };
    const status = await runSource(`health:${s.id}`, () => checkHealth(s.id));
    return status
      ? { id: s.id, status, checkedAt: new Date().toISOString() }
      : { id: s.id, status: s.status, checkedAt: null };
  }));

  const anything = metrics.some(m => m.value !== null) || systems.some(s => s.checkedAt !== null);
  // generatedAt stays null while nothing is measured, so the site never claims "updated just now"
  // for an empty file.
  return { generatedAt: anything ? now : null, metrics, systems };
}

// ---------- baking into index.html ----------

const LIVE_START = '<!-- live:start (generated by stats/collect.mjs) -->';
const LIVE_END = '<!-- live:end -->';
const FALLBACK = '<span class="label">Right now:</span> Prazo is sending Telegram reminders about Portuguese deadlines from a Raspberry Pi, and the PNCT map is online at <a href="https://pnct.singledev.eu">pnct.singledev.eu</a>.';
const STATUS_WORDS = { running: 'Running', development: 'In development', degraded: 'Degraded at the last check' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const validTime = iso => typeof iso === 'string' && !Number.isNaN(Date.parse(iso));
const numberFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const monthFormat = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const stampFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });

const publishable = m => m && m.public === true && isNumber(m.value) && typeof m.sentence === 'string'
  && m.sentence.includes('{value}') && (!m.sentence.includes('{month}') || validTime(m.asOf));

/** One sentence as HTML. A unit right after {value} (e.g. "%") goes inside the teal span. */
function sentenceHtml(m) {
  return m.sentence.split(/(\{value\}%?|\{month\})/).map(part => {
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

  const data = from ? JSON.parse(await readFile(from, 'utf8')) : await collect();
  const json = JSON.stringify(data, null, 2) + '\n';
  if (dryRun) { process.stdout.write(json); return; }

  await writeAtomic(out, json);
  await writeAtomic(htmlFile, bake(await readFile(htmlFile, 'utf8'), data));
  const shown = (data.metrics ?? []).filter(publishable).length;
  console.log(`[collect] wrote ${path.relative(process.cwd(), out)} and baked ${path.relative(process.cwd(), htmlFile)}: ${shown} public metric(s) with values`);
}

main().catch(e => { console.error(e); process.exit(1); });
