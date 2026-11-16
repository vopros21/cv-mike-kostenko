#!/usr/bin/env node
// Exit 0 if the figures or statuses differ between two live.json files, 1 if not.
// Timestamps (generatedAt, asOf, checkedAt) are ignored: a fresher run alone is not a change.
//   node stats/changed.mjs old.json new.json
import { readFile } from 'node:fs/promises';

const load = async f => JSON.parse(await readFile(f, 'utf8'));
const essence = d => JSON.stringify({
  metrics: (d.metrics ?? []).map(m => [m.id, m.value, m.public, m.sentence, m.sentenceOne ?? null]),
  systems: (d.systems ?? []).map(s => [s.id, s.status, s.checkedAt === null]),
});

const [a, b] = await Promise.all(process.argv.slice(2, 4).map(load));
process.exit(essence(a) === essence(b) ? 1 : 0);
