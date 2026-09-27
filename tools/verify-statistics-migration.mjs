// Run after npm run build. The source stays read-only and is never copied into git.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { StatisticsArchive } from '../build/statistics/archive.js';
const source = process.argv[2];
if (!source) throw new Error('Usage: node tools/verify-statistics-migration.mjs /path/statistics_v1.json');
const bytes = await readFile(source);
const expected = JSON.parse(bytes.toString('utf8'));
const directory = await mkdtemp(join(tmpdir(), 'ems-real-migration-'));
try {
  await copyFile(source, join(directory, 'statistics_v1.json'));
  await StatisticsArchive.open(directory);
  const archive = await StatisticsArchive.open(directory);
  assert.equal(archive.loadedMonths, 0);
  assert.deepEqual(Object.keys(archive.data.days).sort(), Object.keys(expected.days).sort());
  for (const [day, value] of Object.entries(expected.days)) assert.deepEqual(archive.data.days[day], value);
  assert.deepEqual(archive.data.runtime, expected.runtime);
  assert.deepEqual(archive.data.monthRewardsBilling, expected.monthRewardsBilling);
  await archive.commit();
  const reopened = await StatisticsArchive.open(directory);
  for (const [day, value] of Object.entries(expected.days)) assert.deepEqual(reopened.data.days[day], value);
  assert.deepEqual(await readFile(join(directory, 'statistics_v1.pre-v2.json')), bytes);
  assert.deepEqual(await readFile(source), bytes);
  console.log(JSON.stringify({ result: 'PASS', verifiedDays: Object.keys(expected.days).length,
    runtimePreserved: true, rewardsPreserved: true, sourceUnchanged: true,
    sourceSha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
