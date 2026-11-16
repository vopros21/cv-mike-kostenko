#!/usr/bin/env node
// Collects live usage figures for the homepage and writes docs/data/live.json.
//
//   node stats/collect.mjs            # write docs/data/live.json
//   node stats/collect.mjs --dry-run  # print the JSON, write nothing
//   node stats/collect.mjs --out x.json
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
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(here, '..', 'docs', 'data', 'live.json');
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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : DEFAULT_OUT;

  const data = await collect();
  const json = JSON.stringify(data, null, 2) + '\n';
  if (dryRun) { process.stdout.write(json); return; }

  await mkdir(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  await writeFile(tmp, json);
  await rename(tmp, out);           // atomic: the site never sees a half-written file
  const shown = data.metrics.filter(m => m.public && m.value !== null).length;
  console.log(`[collect] wrote ${path.relative(process.cwd(), out)}: ${shown} public metric(s) with values`);
}

main().catch(e => { console.error(e); process.exit(1); });
