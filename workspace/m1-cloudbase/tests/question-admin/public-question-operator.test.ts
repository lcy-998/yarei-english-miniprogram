import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../tools/run-m3-public-question-distribution.mjs', import.meta.url));
const projectRoot = resolve(dirname(script), '..');
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function runPlan(packagePath: string) {
  return spawnSync(process.execPath, [script, 'plan', packagePath],
    { encoding: 'utf8', cwd: projectRoot, timeout: 30000 });
}

describe('public question controlled import operator', () => {
  it('plans only a matching reviewed question, source file and cross-school rights receipt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yarei-public-question-'));
    directories.push(directory);
    const source = 'Fictional source question bytes';
    const sourceSha256 = hash(source);
    const exercisePackId = 'exercise_pack_test';
    const question = { grade: '三年级', questionType: 'single_choice',
      stem: 'Choose the word.', options: ['cat', 'dog'],
      correctAnswer: 'cat', explanation: '虚构测试解析' };
    const content = JSON.stringify({ resourceId: 'question_public_source',
      contentType: 'exercise', decision: 'approved', copyrightStatus: 'verified',
      sourceSha256, contentVersion: 1, reviewRevision: 1, exercisePackId,
      reviewedAt: '2026-10-06T12:00:00+08:00', exercise: question });
    const copyright = JSON.stringify({ resourceId: 'question_public_source',
      decision: 'approved', scope: 'all_schools_teaching', sourceSha256, exercisePackId });
    const manifest = JSON.stringify({ resourceId: 'question_public_source',
      title: '虚构公共习题', resourceType: 'supplement', processingStatus: 'publish_ready',
      exercisePackId,
      sourceUrl: 'https://example.org/fictional-question-source',
      sourceSha256, details: { reviewSha256: hash(content), reviewRevision: 1 } });
    await Promise.all([
      writeFile(join(directory, 'source.txt'), source),
      writeFile(join(directory, 'approved-content.json'), content),
      writeFile(join(directory, 'copyright.json'), copyright),
      writeFile(join(directory, 'manifest.json'), manifest),
    ]);
    const specification = { sourceId: 'question_public_source',
      organizationId: 'org_one', title: '虚构公共习题', ...question,
      contentVersion: 1, sourceSha256, manifestSha256: hash(manifest),
      sourceUrl: 'https://example.org/fictional-question-source',
      reviewId: `review_${hash(content).slice(0, 32)}`,
      copyrightEvidenceId: `copyright_${hash(copyright).slice(0, 32)}`,
      copyrightEvidenceSha256: hash(copyright), importedBy: 'import_demo',
      exercisePackId,
      verifiedAt: '2026-10-06T12:00:00+08:00',
      assetRoot: '.', evidence: { sourcePath: 'source.txt', manifestPath: 'manifest.json',
        approvedContentPath: 'approved-content.json', copyrightEvidencePath: 'copyright.json' } };
    const packagePath = join(directory, 'package.json');
    await writeFile(packagePath, JSON.stringify(specification));
    const valid = runPlan(packagePath);
    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({ ready: true,
      sourceId: 'question_public_source', inputSha256: hash(await readFile(packagePath)) });
    await writeFile(join(directory, 'copyright.json'),
      JSON.stringify({ resourceId: 'question_public_source', decision: 'approved',
        scope: 'one_school_only', sourceSha256 }));
    expect(runPlan(packagePath).status).not.toBe(0);
  });
});
