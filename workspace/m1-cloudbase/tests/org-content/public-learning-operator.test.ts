import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../tools/run-m3-public-learning-distribution.mjs', import.meta.url));
const projectRoot = resolve(dirname(script), '..');
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function runPlan(packagePath: string) {
  return spawnSync(process.execPath, [script, 'plan', packagePath],
    { encoding: 'utf8', cwd: projectRoot, timeout: 30000 });
}

describe('public reading and vocabulary controlled import operator', () => {
  it('requires matching asset review, rights and final export approval', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yarei-public-learning-'));
    directories.push(directory);
    const source = 'Fictional reviewed learning source';
    const sourceSha256 = hash(source);
    const words = [{ id: 'word_one', word: 'hello', meaning: '你好', example: 'Hello!',
      syllables: ['hel', 'lo'], audioAssetKey: 'cloud://private/hello.mp3' }];
    const resource = { _id: 'vocab_public_source', organizationId: 'org_one',
      schemaVersion: 1, version: 1, deletedAt: null, type: 'vocabulary',
      status: 'draft', title: '虚构公共词包', contentVersion: '1.1',
      copyrightStatus: 'verified', visibility: { type: 'classes', classIds: [] },
      grade: '三年级', unit: 'Unit 1', words, payload: { words } };
    const review = JSON.stringify({ resourceId: resource._id, contentType: 'vocabulary',
      decision: 'approved', copyrightStatus: 'verified', sourceSha256,
      reviewRevision: 1, reviewedAt: '2026-10-06T12:00:00+08:00',
      vocabulary: { grade: '三年级', unit: 'Unit 1' } });
    const rights = JSON.stringify({ resourceId: resource._id, decision: 'approved',
      scope: 'all_schools_teaching', sourceSha256 });
    const manifest = JSON.stringify({ resourceId: resource._id, title: resource.title,
      resourceType: 'supplement', processingStatus: 'publish_ready',
      sourceSha256, version: 1,
      details: { reviewSha256: hash(review), reviewRevision: 1 } });
    const exportApproval = JSON.stringify({ resourceId: resource._id,
      decision: 'approved', scope: 'all_schools_teaching',
      reviewSha256: hash(review), copyrightEvidenceSha256: hash(rights),
      preparedResourceSha256: hash(JSON.stringify(resource)) });
    await Promise.all([
      writeFile(join(directory, 'source.txt'), source),
      writeFile(join(directory, 'approved-content.json'), review),
      writeFile(join(directory, 'copyright.json'), rights),
      writeFile(join(directory, 'manifest.json'), manifest),
      writeFile(join(directory, 'public-export-approval.json'), exportApproval),
    ]);
    const specification = { resource, sourceSha256, manifestSha256: hash(manifest),
      reviewId: `review_${hash(review).slice(0, 32)}`,
      copyrightEvidenceId: `copyright_${hash(rights).slice(0, 32)}`,
      copyrightEvidenceSha256: hash(rights), importedBy: 'import_demo',
      verifiedAt: '2026-10-06T12:00:00+08:00',
      exportApprovalSha256: hash(exportApproval), assetRoot: '.',
      cloudAssetSha256: { 'cloud://private/hello.mp3': 'a'.repeat(64) },
      evidence: { sourcePath: 'source.txt', manifestPath: 'manifest.json',
        approvedContentPath: 'approved-content.json', copyrightEvidencePath: 'copyright.json',
        publicExportApprovalPath: 'public-export-approval.json' } };
    const packagePath = join(directory, 'package.json');
    await writeFile(packagePath, JSON.stringify(specification));
    const valid = runPlan(packagePath);
    expect(valid.status, valid.stderr).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({ ready: true, sourceId: resource._id });
    await writeFile(join(directory, 'public-export-approval.json'),
      JSON.stringify({ ...JSON.parse(exportApproval), decision: 'rejected' }));
    expect(runPlan(packagePath).status).not.toBe(0);
  });
});
