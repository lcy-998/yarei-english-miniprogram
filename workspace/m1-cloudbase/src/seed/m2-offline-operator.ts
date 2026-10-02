import type { JsonObject, JsonValue } from '../shared/protocol';
import { FakeDocumentDatabase } from '../repositories/fake-document-database';
import type { DocumentDatabasePort, DocumentDatabaseTransactionPort,
  VersionedDocument } from '../repositories/document-database-port';
import { computeJsonContentHash } from './canonical-json';
import { createPrimaryCloudIntegrationSeedPackage } from './primary-cloud-integration-fixture';
import type { SeedPackage } from './model';
import { assertReviewedM2CurrentBaseline, verifyM2CurrentDependencyBaseline,
  type M2CurrentDependencyBaseline } from './m2-current-dependency-baseline';
import { M2_FIXTURE_COLLECTIONS, M2_FIXTURE_IDS, createM2DevelopmentFixture,
  validateM2DevelopmentFixture, type M2DevelopmentFixture, type M2FixtureCollection } from './m2-development-fixture';

/** The offline export is restricted to FakeDocumentDatabase; cloud execution has a separate audited entry. */
const NONEMPTY_COLLECTIONS = ['learning_resources', 'phonics_courses', 'task_templates', 'checkin_activities'] as const;
const MAX_BATCH_SIZE = 25;
const HASH_FIELD = 'seedDocumentContentHash';
const RUN_COLLECTION = 'migration_runs';
const RUN_STATUSES = ['planned', 'applying', 'verifying', 'succeeded', 'failed', 'rolling_back', 'rolled_back'] as const;
type RunStatus = (typeof RUN_STATUSES)[number];
type ResumableStatus = 'applying' | 'verifying' | 'rolling_back';
export type M2OfflineCommand = 'status' | 'plan' | 'advance' | 'resume' | 'begin_rollback' | 'advance_rollback';

interface Candidate {
  readonly collection: M2FixtureCollection;
  readonly id: string;
  readonly document: JsonObject;
  readonly contentHash: string;
}
interface OwnedReference { readonly collection: M2FixtureCollection; readonly id: string; readonly contentHash: string }
interface RunRecord {
  readonly _id: string;
  readonly status: RunStatus;
  readonly failedFromStatus: ResumableStatus | null;
  readonly contentHash: string;
  readonly baseSeedRunId: string;
  readonly baseContentHash: string;
  readonly dependencyDigest: string | null;
  readonly counts: Readonly<Record<M2FixtureCollection, number>>;
  readonly requestId: string;
  readonly executedBy: string;
  readonly batchSize: number;
  readonly totalBatches: number;
  readonly nextBatchIndex: number;
  readonly verifiedBatchCount: number;
  readonly rollbackCursor: number;
  readonly created: readonly OwnedReference[];
  readonly version: number;
}
export interface M2OfflineRequest {
  readonly command: M2OfflineCommand;
  readonly guard: Readonly<{ environmentPurpose: 'm2-offline-only'; dataClassification: 'synthetic-only' }>;
  readonly expectedSeedRunId: string;
  readonly requestId: string;
  readonly executedBy: string;
  readonly batchSize: number;
}
export interface M2OfflineState {
  readonly status: RunStatus | 'not_planned';
  readonly seedRunId: string;
  readonly totalBatches: number;
  readonly nextBatchIndex: number;
  readonly verifiedBatchCount: number;
  readonly rollbackCursor: number;
  readonly createdCount: number;
}
export interface M2OfflinePlan {
  readonly seedRunId: string;
  readonly requiredBaseSeedRunId: string;
  readonly requiredBaseContentHash: string;
  readonly dependencyDigest: string | null;
  readonly contentHash: string;
  readonly totalDocuments: number;
  readonly counts: Readonly<Record<M2FixtureCollection, number>>;
  readonly documents: readonly OwnedReference[];
  readonly collectionOrder: readonly M2FixtureCollection[];
  readonly authorizationRequiredForCloud: true;
}
export class M2OfflineSeedError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'CONFLICT' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'M2OfflineSeedError';
  }
}

export function createM2OfflinePlan(
  fixture: M2DevelopmentFixture = createM2DevelopmentFixture(),
  base: SeedPackage = createPrimaryCloudIntegrationSeedPackage(),
  audited?: Readonly<{ baseline: M2CurrentDependencyBaseline; reviewedDigest: string }>,
): M2OfflinePlan {
  const validation = validateM2DevelopmentFixture(fixture, base);
  if (!validation.ok) throw new M2OfflineSeedError('VALIDATION_ERROR',
    `M2 种子本地校验未通过：${validation.issues.map(issue => issue.code).join(', ')}。`);
  const documents = candidates(fixture).map(({ collection, id, contentHash }) => ({ collection, id, contentHash }));
  if (audited) assertReviewedM2CurrentBaseline(audited.baseline, audited.reviewedDigest);
  return { seedRunId: fixture.manifest.seedRunId,
    requiredBaseSeedRunId: fixture.manifest.requiredBaseSeedRunId,
    requiredBaseContentHash: audited?.baseline.baseRun.seedContentHash ?? base.manifest.contentHash,
    dependencyDigest: audited?.baseline.digest ?? null,
    contentHash: fixture.manifest.contentHash,
    totalDocuments: documents.length, counts: { ...fixture.manifest.expectedCounts }, documents,
    collectionOrder: [...NONEMPTY_COLLECTIONS], authorizationRequiredForCloud: true };
}

/** Creates an isolated in-memory copy of the accepted M1 main-organization package. */
export function createM2OfflineDatabase(base: SeedPackage = createPrimaryCloudIntegrationSeedPackage()): FakeDocumentDatabase {
  const rows: Record<string, VersionedDocument[]> = {};
  for (const [collection, documents] of Object.entries(base.collections)) {
    rows[collection] = documents.map(document => document as unknown as VersionedDocument);
  }
  rows[RUN_COLLECTION] = [{ _id: base.manifest.seedRunId, organizationId: M2_FIXTURE_IDS.organization,
    schemaVersion: 1, version: 1, deletedAt: null, source: base.manifest.source,
    seedVersion: base.manifest.seedVersion, status: 'succeeded', contentHash: base.manifest.contentHash,
    counts: base.manifest.expectedCounts, createdDocumentIds: [],
  } as VersionedDocument];
  return new FakeDocumentDatabase(rows);
}

export function createM2OfflineOperator(
  database: FakeDocumentDatabase,
  fixture: M2DevelopmentFixture = createM2DevelopmentFixture(),
  base: SeedPackage = createPrimaryCloudIntegrationSeedPackage(),
  audited?: Readonly<{ baseline: M2CurrentDependencyBaseline; reviewedDigest: string }>,
): Readonly<{ plan: M2OfflinePlan; execute(request: unknown): Promise<M2OfflineState> }> {
  if (database.constructor !== FakeDocumentDatabase) {
    throw new M2OfflineSeedError('VALIDATION_ERROR', 'M2 离线操作器只接受本地 FakeDocumentDatabase。');
  }
  return createM2OperatorCore(database, fixture, base, audited, 'm2-offline-only');
}

/** Accepts a server-side database only with an exact current-dependency review. */
export function createM2AuditedCloudOperator(
  database: DocumentDatabasePort,
  audited: Readonly<{ baseline: M2CurrentDependencyBaseline; reviewedDigest: string }>,
  fixture: M2DevelopmentFixture = createM2DevelopmentFixture(),
  base: SeedPackage = createPrimaryCloudIntegrationSeedPackage(),
): Readonly<{ plan: M2OfflinePlan; execute(request: unknown): Promise<M2OfflineState> }> {
  assertReviewedM2CurrentBaseline(audited.baseline, audited.reviewedDigest);
  return createM2OperatorCore(database, fixture, base, audited, 'm2-non-production');
}

function createM2OperatorCore(
  database: DocumentDatabasePort,
  fixture: M2DevelopmentFixture,
  base: SeedPackage,
  audited: Readonly<{ baseline: M2CurrentDependencyBaseline; reviewedDigest: string }> | undefined,
  purpose: 'm2-offline-only' | 'm2-non-production',
): Readonly<{ plan: M2OfflinePlan; execute(request: unknown): Promise<M2OfflineState> }> {
  const plan = createM2OfflinePlan(fixture, base, audited);
  const all = candidates(fixture);
  return {
    plan,
    execute: async (input: unknown) => {
      const request = parseRequest(input, plan, purpose);
      if (request.command === 'status') {
        const run = readRun(await database.get(RUN_COLLECTION, plan.seedRunId), plan);
        return state(run === null ? null : compatible(run, request, plan), plan, request.batchSize);
      }
      if (request.command === 'plan') {
        return database.runTransaction(async tx => {
          const existing = readRun(await tx.get(RUN_COLLECTION, plan.seedRunId), plan);
          if (existing) return state(compatible(existing, request, plan), plan, request.batchSize);
          await requireBase(tx, plan, audited);
          await requireNoCandidateCollisions(tx, all);
          await requireNoUnexpectedOwned(tx, plan.seedRunId);
          const run = initialRun(plan, request);
          await saveRun(tx, run, null);
          return state(run, plan, request.batchSize);
        });
      }
      if (request.command === 'resume') {
        return database.runTransaction(async tx => {
          const run = await requireRun(tx, request, plan);
          if (run.status !== 'failed' || run.failedFromStatus === null) throw conflict('当前 run 不可恢复。');
          const next = { ...run, status: run.failedFromStatus, failedFromStatus: null, version: run.version + 1 };
          await saveRun(tx, next, run);
          return state(next, plan, request.batchSize);
        });
      }
      if (request.command === 'begin_rollback') {
        return database.runTransaction(async tx => {
          const run = await requireRun(tx, request, plan);
          if (run.status === 'rolled_back' || run.status === 'rolling_back') return state(run, plan, request.batchSize);
          if (run.status === 'failed' && run.failedFromStatus === 'rolling_back') {
            throw conflict('回滚失败须先恢复原游标。');
          }
          const next: RunRecord = { ...run, status: 'rolling_back', failedFromStatus: null,
            rollbackCursor: run.created.length, version: run.version + 1 };
          await saveRun(tx, next, run);
          return state(next, plan, request.batchSize);
        });
      }
      try {
        return await database.runTransaction(async tx => {
          const run = await requireRun(tx, request, plan);
          if (request.command === 'advance') {
            if (run.status !== 'succeeded') await requireBase(tx, plan, audited);
            return advance(tx, run, all, plan, request.batchSize);
          }
          return advanceRollback(tx, run, plan, request.batchSize);
        });
      } catch (error: unknown) {
        await markFailed(database, request, plan);
        throw error;
      }
    },
  };
}

async function advance(tx: DocumentDatabaseTransactionPort, run: RunRecord,
  all: readonly Candidate[], plan: M2OfflinePlan, batchSize: number): Promise<M2OfflineState> {
  if (run.status === 'succeeded') return state(run, plan, batchSize);
  if (run.status === 'failed' || run.status === 'rolling_back' || run.status === 'rolled_back') {
    throw conflict('当前 run 不可继续导入。');
  }
  if (run.status === 'planned') {
    const next: RunRecord = { ...run, status: 'applying', version: run.version + 1 };
    await saveRun(tx, next, run);
    return state(next, plan, batchSize);
  }
  if (run.status === 'applying') {
    if (run.nextBatchIndex === run.totalBatches) {
      const next: RunRecord = { ...run, status: 'verifying', version: run.version + 1 };
      await saveRun(tx, next, run);
      return state(next, plan, batchSize);
    }
    const batch = all.slice(run.nextBatchIndex * batchSize, (run.nextBatchIndex + 1) * batchSize);
    await requireNoCandidateCollisions(tx, batch);
    for (const candidate of batch) {
      const row = { ...candidate.document, [HASH_FIELD]: candidate.contentHash } as unknown as VersionedDocument;
      if (!await tx.create(candidate.collection, row)) throw conflict(`创建冲突：${candidate.collection}/${candidate.id}。`);
    }
    const next: RunRecord = { ...run, nextBatchIndex: run.nextBatchIndex + 1,
      created: [...run.created, ...batch.map(({ collection, id, contentHash }) => ({ collection, id, contentHash }))],
      version: run.version + 1 };
    await saveRun(tx, next, run);
    return state(next, plan, batchSize);
  }
  if (run.verifiedBatchCount < run.totalBatches) {
    const batch = all.slice(run.verifiedBatchCount * batchSize, (run.verifiedBatchCount + 1) * batchSize);
    for (const candidate of batch) await requireExactOwned(tx, candidate, run);
    const next: RunRecord = { ...run, verifiedBatchCount: run.verifiedBatchCount + 1, version: run.version + 1 };
    await saveRun(tx, next, run);
    return state(next, plan, batchSize);
  }
  await auditOwnedSet(tx, run);
  const next: RunRecord = { ...run, status: 'succeeded', version: run.version + 1 };
  await saveRun(tx, next, run);
  return state(next, plan, batchSize);
}

async function advanceRollback(tx: DocumentDatabaseTransactionPort, run: RunRecord,
  plan: M2OfflinePlan, batchSize: number): Promise<M2OfflineState> {
  if (run.status === 'rolled_back') return state(run, plan, batchSize);
  if (run.status !== 'rolling_back') throw conflict('尚未进入精确回滚。');
  if (run.rollbackCursor === 0) {
    await auditRemainingOwnedSet(tx, run);
    const next: RunRecord = { ...run, status: 'rolled_back', version: run.version + 1 };
    await saveRun(tx, next, run);
    return state(next, plan, batchSize);
  }
  const start = Math.max(0, run.rollbackCursor - batchSize);
  const batch = run.created.slice(start, run.rollbackCursor).reverse();
  await auditRemainingOwnedSet(tx, run);
  const rows: Array<{ reference: OwnedReference; row: VersionedDocument }> = [];
  for (const reference of batch) {
    const row = await requireExactOwned(tx, reference, run);
    rows.push({ reference, row });
  }
  for (const { reference, row } of rows) {
    if (!await tx.delete(reference.collection, reference.id, row.version)) {
      throw conflict(`精确回滚冲突：${reference.collection}/${reference.id}。`);
    }
  }
  const next: RunRecord = { ...run, rollbackCursor: start, version: run.version + 1 };
  await saveRun(tx, next, run);
  return state(next, plan, batchSize);
}

async function requireBase(tx: DocumentDatabaseTransactionPort, plan: M2OfflinePlan,
  audited?: Readonly<{ baseline: M2CurrentDependencyBaseline; reviewedDigest: string }>): Promise<void> {
  if (audited) {
    await verifyM2CurrentDependencyBaseline(tx, audited.baseline, audited.reviewedDigest);
    return;
  }
  const baseRun = await tx.get(RUN_COLLECTION, plan.requiredBaseSeedRunId);
  const organization = await tx.get('organizations', M2_FIXTURE_IDS.organization);
  const classRow = await tx.get('classes', M2_FIXTURE_IDS.class);
  const teacher = await tx.get('users', M2_FIXTURE_IDS.teacher);
  const student = await tx.get('users', M2_FIXTURE_IDS.student);
  const memberships = await tx.find('class_memberships', { organizationId: M2_FIXTURE_IDS.organization,
    classId: M2_FIXTURE_IDS.class, studentId: M2_FIXTURE_IDS.student, status: 'active', deletedAt: null });
  const grants = await tx.find('teacher_class_grants', { organizationId: M2_FIXTURE_IDS.organization,
    classId: M2_FIXTURE_IDS.class, teacherId: M2_FIXTURE_IDS.teacher, status: 'active', deletedAt: null });
  if (!baseRun || baseRun.status !== 'succeeded' || baseRun.organizationId !== M2_FIXTURE_IDS.organization
    || baseRun.source !== 'm0-fixture' || baseRun.contentHash !== plan.requiredBaseContentHash
    || !organization || organization.status !== 'active'
    || !classRow || classRow.status !== 'active' || !teacher || teacher.status !== 'active'
    || !student || student.status !== 'active' || memberships.length !== 1
    || !grants.some(grant => Array.isArray(grant.permissions) && grant.permissions.includes('content.read'))) {
    throw conflict('M1 主组织基线 run、班级或授权关系未通过只读预检。');
  }
}

async function requireNoCandidateCollisions(tx: DocumentDatabaseTransactionPort,
  batch: readonly Candidate[]): Promise<void> {
  for (const candidate of batch) {
    if (await tx.get(candidate.collection, candidate.id)) {
      throw conflict(`已有文档 ID，拒绝覆盖：${candidate.collection}/${candidate.id}。`);
    }
  }
}

async function requireNoUnexpectedOwned(tx: DocumentDatabaseTransactionPort, seedRunId: string): Promise<void> {
  for (const collection of M2_FIXTURE_COLLECTIONS) {
    if ((await tx.find(collection, { seedRunId })).length) {
      throw conflict(`run 尚未建立但 ${collection} 已存在同归属文档。`);
    }
  }
}

async function requireExactOwned(tx: DocumentDatabaseTransactionPort,
  reference: OwnedReference, run: RunRecord): Promise<VersionedDocument> {
  if (!run.created.some(item => item.collection === reference.collection && item.id === reference.id
    && item.contentHash === reference.contentHash)) throw conflict('run 缺少该文档的创建归属记录。');
  const row = await tx.get(reference.collection, reference.id);
  if (!row || row.seedRunId !== run._id || row.seedVersion !== 'm2-local-addon-v1'
    || row[HASH_FIELD] !== reference.contentHash || documentHash(row) !== reference.contentHash) {
    throw conflict(`文档已缺失或发生外部变化：${reference.collection}/${reference.id}。`);
  }
  return row;
}

async function auditOwnedSet(tx: DocumentDatabaseTransactionPort, run: RunRecord): Promise<void> {
  const expected = new Map(run.created.map(item => [`${item.collection}/${item.id}`, item]));
  const observed: OwnedReference[] = [];
  for (const collection of M2_FIXTURE_COLLECTIONS) {
    const rows = await tx.find(collection, { seedRunId: run._id });
    for (const row of rows) {
      const reference = expected.get(`${collection}/${row._id}`);
      if (!reference) throw conflict(`发现 run 未记录的归属文档：${collection}/${row._id}。`);
      await requireExactOwned(tx, reference, run);
      observed.push(reference);
    }
  }
  if (observed.length !== expected.size) throw conflict('run 归属文档数量与创建记录不一致。');
}

async function auditRemainingOwnedSet(tx: DocumentDatabaseTransactionPort, run: RunRecord): Promise<void> {
  const remaining = run.created.slice(0, run.rollbackCursor);
  const expected = new Map(remaining.map(item => [`${item.collection}/${item.id}`, item]));
  let observedCount = 0;
  for (const collection of M2_FIXTURE_COLLECTIONS) {
    const rows = await tx.find(collection, { seedRunId: run._id });
    for (const row of rows) {
      const reference = expected.get(`${collection}/${row._id}`);
      if (!reference) throw conflict(`回滚发现未记录的归属文档：${collection}/${row._id}。`);
      await requireExactOwned(tx, reference, run);
      observedCount += 1;
    }
  }
  if (observedCount !== expected.size) throw conflict('回滚前归属集合与剩余游标不一致。');
}

function candidates(fixture: M2DevelopmentFixture): readonly Candidate[] {
  return NONEMPTY_COLLECTIONS.flatMap(collection => fixture.collections[collection].map(document => ({
    collection, id: String(document._id), document,
    contentHash: computeJsonContentHash(document),
  })));
}
function documentHash(row: VersionedDocument): string {
  const { [HASH_FIELD]: _ignored, ...document } = row;
  return computeJsonContentHash(document as JsonValue);
}

function initialRun(plan: M2OfflinePlan, request: M2OfflineRequest): RunRecord {
  return { _id: plan.seedRunId, status: 'planned', failedFromStatus: null,
    contentHash: plan.contentHash, baseSeedRunId: plan.requiredBaseSeedRunId,
    baseContentHash: plan.requiredBaseContentHash,
    dependencyDigest: plan.dependencyDigest,
    counts: { ...plan.counts },
    requestId: request.requestId, executedBy: request.executedBy, batchSize: request.batchSize,
    totalBatches: Math.ceil(plan.totalDocuments / request.batchSize), nextBatchIndex: 0,
    verifiedBatchCount: 0, rollbackCursor: 0, created: [], version: 1 };
}
function state(run: RunRecord | null, plan: M2OfflinePlan, batchSize: number): M2OfflineState {
  return run ? { status: run.status, seedRunId: run._id, totalBatches: run.totalBatches,
    nextBatchIndex: run.nextBatchIndex, verifiedBatchCount: run.verifiedBatchCount,
    rollbackCursor: run.rollbackCursor, createdCount: run.created.length }
    : { status: 'not_planned', seedRunId: plan.seedRunId,
      totalBatches: Math.ceil(plan.totalDocuments / batchSize), nextBatchIndex: 0,
      verifiedBatchCount: 0, rollbackCursor: 0, createdCount: 0 };
}
function compatible(run: RunRecord, request: M2OfflineRequest, plan: M2OfflinePlan): RunRecord {
  if (run._id !== request.expectedSeedRunId || run.contentHash !== plan.contentHash
    || run.baseSeedRunId !== plan.requiredBaseSeedRunId || run.baseContentHash !== plan.requiredBaseContentHash
    || run.dependencyDigest !== plan.dependencyDigest
    || run.requestId !== request.requestId
    || run.executedBy !== request.executedBy || run.batchSize !== request.batchSize
    || run.totalBatches !== Math.ceil(plan.totalDocuments / request.batchSize)
    || M2_FIXTURE_COLLECTIONS.some(collection => run.counts[collection] !== plan.counts[collection])) {
    throw conflict('run 与受控计划、操作者或批次配置不一致。');
  }
  return run;
}
async function requireRun(tx: DocumentDatabaseTransactionPort, request: M2OfflineRequest,
  plan: M2OfflinePlan): Promise<RunRecord> {
  const run = readRun(await tx.get(RUN_COLLECTION, plan.seedRunId), plan);
  if (!run) throw new M2OfflineSeedError('NOT_FOUND', '尚未创建 M2 增量 run。');
  return compatible(run, request, plan);
}
function readRun(row: VersionedDocument | null, plan: M2OfflinePlan): RunRecord | null {
  if (!row) return null;
  if (row.organizationId !== M2_FIXTURE_IDS.organization || row._id !== plan.seedRunId
    || row.schemaVersion !== 1 || row.deletedAt !== null || !validPositive(row.version)
    || row.source !== 'synthetic-m2-addon' || row.seedVersion !== 'm2-local-addon-v1'
    || !RUN_STATUSES.includes(row.status as RunStatus)
    || typeof row.contentHash !== 'string' || typeof row.baseSeedRunId !== 'string'
    || typeof row.baseContentHash !== 'string'
    || (row.dependencyDigest !== null && !/^sha256:[a-f0-9]{64}$/.test(String(row.dependencyDigest)))
    || typeof row.requestId !== 'string' || typeof row.executedBy !== 'string'
    || !isRecord(row.counts)
    || !validPositive(row.batchSize) || !validPositive(row.totalBatches)
    || !validNonNegative(row.nextBatchIndex) || !validNonNegative(row.verifiedBatchCount)
    || !validNonNegative(row.rollbackCursor) || !Array.isArray(row.created)) {
    throw conflict('M2 migration run 结构无效。');
  }
  const created: OwnedReference[] = [];
  const approved = new Map(plan.documents.map(item => [`${item.collection}/${item.id}`, item.contentHash]));
  const seen = new Set<string>();
  for (const item of row.created) {
    if (!isRecord(item) || !NONEMPTY_COLLECTIONS.includes(item.collection as (typeof NONEMPTY_COLLECTIONS)[number])
      || typeof item.id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(String(item.contentHash))) {
      throw conflict('M2 migration run 创建记录无效。');
    }
    const key = `${item.collection}/${item.id}`;
    if (seen.has(key) || approved.get(key) !== item.contentHash) {
      throw conflict('M2 migration run 创建记录不属于已审核计划。');
    }
    seen.add(key);
    created.push({ collection: item.collection as M2FixtureCollection,
      id: item.id, contentHash: String(item.contentHash) });
  }
  if (row.failedFromStatus !== null && row.failedFromStatus !== 'applying'
    && row.failedFromStatus !== 'verifying' && row.failedFromStatus !== 'rolling_back') {
    throw conflict('M2 migration run 失败阶段无效。');
  }
  if (Number(row.nextBatchIndex) > Number(row.totalBatches)
    || Number(row.verifiedBatchCount) > Number(row.totalBatches)
    || Number(row.rollbackCursor) > created.length || created.length > plan.totalDocuments) {
    throw conflict('M2 migration run 游标越界。');
  }
  const counts = {} as Record<M2FixtureCollection, number>;
  for (const collection of M2_FIXTURE_COLLECTIONS) {
    if (!validNonNegative((row.counts as JsonObject)[collection])) throw conflict('M2 migration run 集合计数无效。');
    counts[collection] = Number((row.counts as JsonObject)[collection]);
  }
  return { _id: row._id, status: row.status as RunStatus,
    failedFromStatus: row.failedFromStatus as ResumableStatus | null,
    contentHash: row.contentHash, baseSeedRunId: row.baseSeedRunId,
    baseContentHash: row.baseContentHash, dependencyDigest: row.dependencyDigest as string | null, counts,
    requestId: row.requestId, executedBy: row.executedBy,
    batchSize: Number(row.batchSize), totalBatches: Number(row.totalBatches),
    nextBatchIndex: Number(row.nextBatchIndex), verifiedBatchCount: Number(row.verifiedBatchCount),
    rollbackCursor: Number(row.rollbackCursor), created, version: row.version };
}
async function saveRun(tx: DocumentDatabaseTransactionPort, run: RunRecord,
  previous: RunRecord | null): Promise<void> {
  const row = { _id: run._id, organizationId: M2_FIXTURE_IDS.organization,
    schemaVersion: 1, version: run.version, deletedAt: null,
    source: 'synthetic-m2-addon', seedVersion: 'm2-local-addon-v1',
    status: run.status, failedFromStatus: run.failedFromStatus,
    contentHash: run.contentHash, baseSeedRunId: run.baseSeedRunId,
    baseContentHash: run.baseContentHash, dependencyDigest: run.dependencyDigest, counts: { ...run.counts },
    requestId: run.requestId, executedBy: run.executedBy, batchSize: run.batchSize,
    totalBatches: run.totalBatches, nextBatchIndex: run.nextBatchIndex,
    verifiedBatchCount: run.verifiedBatchCount, rollbackCursor: run.rollbackCursor,
    created: run.created.map(item => ({ ...item })),
  } as VersionedDocument;
  const success = previous === null
    ? await tx.create(RUN_COLLECTION, row)
    : await tx.replace(RUN_COLLECTION, run._id, previous.version, row);
  if (!success) throw conflict('M2 migration run 并发写入冲突。');
}
async function markFailed(database: DocumentDatabasePort, request: M2OfflineRequest,
  plan: M2OfflinePlan): Promise<void> {
  await database.runTransaction(async tx => {
    const current = readRun(await tx.get(RUN_COLLECTION, plan.seedRunId), plan);
    if (!current || current.status === 'failed' || current.status === 'succeeded'
      || current.status === 'rolled_back') return;
    if (current.requestId !== request.requestId || current.executedBy !== request.executedBy) return;
    if (current.status !== 'applying' && current.status !== 'verifying' && current.status !== 'rolling_back') return;
    await saveRun(tx, { ...current, status: 'failed', failedFromStatus: current.status,
      version: current.version + 1 }, current);
  });
}
function parseRequest(input: unknown, plan: M2OfflinePlan,
  purpose: 'm2-offline-only' | 'm2-non-production'): M2OfflineRequest {
  if (!isRecord(input) || !exactKeys(input,
    ['command', 'guard', 'expectedSeedRunId', 'requestId', 'executedBy', 'batchSize'])
    || !['status', 'plan', 'advance', 'resume', 'begin_rollback', 'advance_rollback'].includes(String(input.command))
    || !isRecord(input.guard) || !exactKeys(input.guard, ['environmentPurpose', 'dataClassification'])
    || input.guard.environmentPurpose !== purpose
    || input.guard.dataClassification !== 'synthetic-only'
    || input.expectedSeedRunId !== plan.seedRunId
    || typeof input.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(input.requestId)
    || typeof input.executedBy !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/.test(input.executedBy)
    || !validPositive(input.batchSize) || Number(input.batchSize) > MAX_BATCH_SIZE) {
    throw new M2OfflineSeedError('VALIDATION_ERROR', 'M2 离线种子请求未通过严格门禁。');
  }
  return input as unknown as M2OfflineRequest;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value);
}
function validPositive(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function validNonNegative(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) >= 0; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function conflict(message: string): M2OfflineSeedError { return new M2OfflineSeedError('CONFLICT', message); }
