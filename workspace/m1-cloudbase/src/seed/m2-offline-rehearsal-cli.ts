import { createM2DevelopmentFixture } from './m2-development-fixture';
import { createM2OfflineDatabase, createM2OfflineOperator,
  type M2OfflineCommand, type M2OfflineRequest } from './m2-offline-operator';

export const completion = (async (): Promise<void> => {
  const fixture = createM2DevelopmentFixture();
  const database = createM2OfflineDatabase();
  const baseline = database.snapshot();
  const operator = createM2OfflineOperator(database, fixture);
  const makeRequest = (command: M2OfflineCommand): M2OfflineRequest => ({
    command, guard: { environmentPurpose: 'm2-offline-only', dataClassification: 'synthetic-only' },
    expectedSeedRunId: fixture.manifest.seedRunId, requestId: 'request_m2_offline_rehearsal',
    executedBy: 'offline_rehearsal', batchSize: 2,
  });
  process.stdout.write('M2 增量种子离线计划（云端导入须另行授权）\n');
  process.stdout.write(`M1 基线 run：${operator.plan.requiredBaseSeedRunId}\n`);
  process.stdout.write(`M1 本地基线摘要：${operator.plan.requiredBaseContentHash}\n`);
  process.stdout.write(`M2 run：${operator.plan.seedRunId}\n`);
  process.stdout.write(`总摘要：${operator.plan.contentHash}\n`);
  for (const item of operator.plan.documents) {
    process.stdout.write(`${item.collection}/${item.id} ${item.contentHash}\n`);
  }
  let state = await operator.execute(makeRequest('plan'));
  for (let step = 0; state.status !== 'succeeded' && step < 20; step += 1) {
    state = await operator.execute(makeRequest('advance'));
  }
  if (state.status !== 'succeeded' || state.createdCount !== operator.plan.totalDocuments) {
    throw new Error('M2 离线分批导入或 verify 未完成。');
  }
  process.stdout.write(`离线导入与 verify：${state.status}，${state.createdCount} 条，${state.totalBatches} 批\n`);
  state = await operator.execute(makeRequest('begin_rollback'));
  for (let step = 0; state.status !== 'rolled_back' && step < 20; step += 1) {
    state = await operator.execute(makeRequest('advance_rollback'));
  }
  if (state.status !== 'rolled_back') throw new Error('M2 离线精确回滚未完成。');
  const current = database.snapshot();
  for (const [collection, documents] of Object.entries(baseline)) {
    if (collection === 'migration_runs') continue;
    if (JSON.stringify(current[collection] ?? []) !== JSON.stringify(documents)) {
      throw new Error(`离线回滚后 M1 基线集合发生变化：${collection}。`);
    }
  }
  process.stdout.write('离线精确回滚：rolled_back；M1 业务集合保持原样。\n');
})();
