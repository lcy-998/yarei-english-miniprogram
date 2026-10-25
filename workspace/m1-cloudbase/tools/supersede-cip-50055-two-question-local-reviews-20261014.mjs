import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'G:/英语资产/library/media';
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
for (const [oldId, replacementId] of [
  ['video-cip50055-pangu-2q-voiced-v6', 'video-cip50055-pangu-5q-voiced-v7'],
  ['video-cip50055-respect-elders-voiced-v2', 'video-cip50055-respect-elders-5q-voiced-v3'],
]) {
  const dir = join(root, oldId, 'v1/review');
  const priorBytes = await readFile(join(dir, 'approved-content-v1.json'));
  const prior = JSON.parse(priorBytes);
  const record = {
    schemaVersion: 1, resourceId: oldId, sourceVersion: 1,
    sourceSha256: prior.sourceSha256, reviewRevision: 2, reviewerId: 'Codex',
    reviewedAt: '2026-10-14T11:04:30+08:00', decision: 'superseded',
    priorReviewSha256: hash(priorBytes), replacementResourceId: replacementId,
    reason: 'Current publisher voiced course video now has five distinct source-grounded questions; two-question revision is historical and must not be staged again.',
  };
  const path = join(dir, 'approved-content-v2.json');
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  try {
    if (hash(await readFile(path)) !== hash(bytes)) throw new Error('REVIEW_CONFLICT');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(path, bytes, { flag: 'wx' });
  }
  process.stdout.write(JSON.stringify({ oldId, replacementId, supersessionReviewSha256: hash(bytes) }) + '\n');
}
