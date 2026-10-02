import { M2_FIXTURE_COLLECTIONS, createM2DevelopmentFixture,
  validateM2DevelopmentFixture } from './m2-development-fixture';

const fixture = createM2DevelopmentFixture();
const validation = validateM2DevelopmentFixture(fixture);
if (!validation.ok) {
  for (const issue of validation.issues) process.stderr.write(`${issue.code} ${issue.path}: ${issue.message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('M2 虚构增量种子：本地校验通过（未导入云端）\n');
  process.stdout.write(`依赖 M1 run：${fixture.manifest.requiredBaseSeedRunId}\n`);
  process.stdout.write(`种子 run：${fixture.manifest.seedRunId}\n`);
  process.stdout.write(`摘要：${fixture.manifest.contentHash}\n`);
  for (const name of M2_FIXTURE_COLLECTIONS) {
    process.stdout.write(`${name}: ${fixture.manifest.expectedCounts[name]}\n`);
  }
  process.stdout.write('教材仅有草稿目录摘要；拼读音频未接入；通知由业务事件生成。\n');
}
