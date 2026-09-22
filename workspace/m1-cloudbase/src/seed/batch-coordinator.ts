import { DocumentDatabasePlatformError } from '../repositories/document-database-port';
import { computeJsonContentHash } from './canonical-json';
import {
  SeedOperationError,
  type SeedDocumentReference,
  type SeedExecutionOptions,
  type SeedMigrationActiveStatus,
  type SeedMigrationRun,
  type SeedMigrationStatus,
  type SeedRepositoryPort,
  type SeedRepositoryTransaction,
  type SeedStoredDocument,
  type SeedVerificationIssue,
} from './apply-core';
import { SEED_COLLECTION_ORDER, type SeedCollectionName, type SeedPackage } from './model';
import { validateSeedPackage, type SeedIdentityProfile } from './validator';

export const MAX_SEED_BATCH_SIZE = 25;

export interface SeedBatchCoordinatorOptions extends SeedExecutionOptions {
  readonly requestId: string;
  readonly batchSize: number;
  /** Must be set explicitly for a materialized runtime package; omitted remains fixture-only. */
  readonly identityProfile?: SeedIdentityProfile;
}

export interface SeedBatchRunState {
  readonly seedRunId: string;
  readonly status: SeedMigrationStatus;
  readonly nextBatchIndex: number;
  readonly totalBatches: number;
  readonly verifiedBatchCount: number;
  readonly rollbackCursor: number;
  readonly createdCount: number;
}

interface SeedBatchCandidate extends SeedStoredDocument {
  readonly seedRunId: string;
  readonly seedVersion: string;
}

/** Creates the durable planned record only; it writes no seed document. */
export async function planSeedBatchRun(
  repository: SeedRepositoryPort,
  seed: SeedPackage,
  options: SeedBatchCoordinatorOptions,
): Promise<SeedBatchRunState> {
  assertCoordinatorInput(seed, options);
  const timestamp = executionTimestamp(options);
  const candidates = createCandidates(seed);
  const totalBatches = Math.ceil(candidates.length / options.batchSize);

  return repository.transaction(async (transaction) => {
    const existing = await transaction.getMigrationRun(seed.manifest.seedRunId);
    if (existing) {
      assertCompatibleBatchRun(existing, seed, options, totalBatches);
      return toState(existing);
    }
    const run: SeedMigrationRun = {
      _id: seed.manifest.seedRunId,
      schemaVersion: seed.manifest.schemaVersion,
      seedVersion: seed.manifest.seedVersion,
      source: seed.manifest.source,
      status: 'planned',
      startedAt: timestamp,
      finishedAt: timestamp,
      counts: countDocuments(seed),
      contentHash: seed.manifest.contentHash,
      createdDocumentIds: [],
      executedBy: options.executedBy,
      requestId: options.requestId,
      batchSize: options.batchSize,
      totalBatches,
      nextBatchIndex: 0,
      verifiedBatchCount: 0,
      rollbackCursor: 0,
    };
    await transaction.putMigrationRun(run);
    return toState(run);
  });
}

/**
 * Advances exactly one durable import transition or one fixed-size batch.
 * A caller may safely invoke it again after process interruption.
 */
export async function advanceSeedBatchRun(
  repository: SeedRepositoryPort,
  seed: SeedPackage,
  options: SeedBatchCoordinatorOptions,
): Promise<SeedBatchRunState> {
  assertCoordinatorInput(seed, options);
  const candidates = createCandidates(seed);
  const totalBatches = Math.ceil(candidates.length / options.batchSize);
  const timestamp = executionTimestamp(options);
  try {
    const snapshot = await repository.readMigrationRunSnapshot(seed.manifest.seedRunId);
    if (snapshot !== null
      && snapshot.status === 'verifying'
      && snapshot.verifiedBatchCount === totalBatches) {
      const actualOwnedDocuments = await repository.listDocumentsBySeedRunIdSnapshot(snapshot._id);
      verifyOwnedSet(actualOwnedDocuments, snapshot);
      return repository.transaction(async (transaction) => {
        const run = await requireCompatibleRun(transaction, seed, options, totalBatches);
        if (run.status === 'succeeded') return toState(run);
        if (run.status !== 'verifying' || run.verifiedBatchCount !== totalBatches
          || !sameReferences(run.createdDocumentIds, snapshot.createdDocumentIds)) {
          throw new SeedOperationError('CONFLICT', 'migration run 在归属集合审计期间发生变化。');
        }
        return saveState(transaction, {
          ...run,
          status: 'succeeded',
          rollbackCursor: run.createdDocumentIds.length,
          failureCode: undefined,
          failedFromStatus: undefined,
          finishedAt: timestamp,
        });
      });
    }
    return await repository.transaction(async (transaction) => {
      const run = await requireCompatibleRun(transaction, seed, options, totalBatches);
      if (run.status === 'succeeded') return toState(run);
      if (run.status === 'failed') throw new SeedOperationError('CONFLICT', 'migration run 已失败，必须先显式恢复或开始回滚。');
      if (run.status === 'rolling_back' || run.status === 'rolled_back') {
        throw new SeedOperationError('CONFLICT', 'migration run 已进入回滚流程，不能继续导入。');
      }
      if (run.status === 'planned') {
        return saveState(transaction, {
          ...run,
          status: 'applying',
          finishedAt: timestamp,
        });
      }
      if (run.status === 'applying') {
        const nextBatchIndex = requiredInteger(run.nextBatchIndex, 'nextBatchIndex');
        if (nextBatchIndex >= totalBatches) {
          return saveState(transaction, {
            ...run,
            status: 'verifying',
            verifiedBatchCount: 0,
            finishedAt: timestamp,
          });
        }
        const batch = candidates.slice(nextBatchIndex * options.batchSize, (nextBatchIndex + 1) * options.batchSize);
        const created = await applyOneBatch(transaction, run, batch);
        return saveState(transaction, {
          ...run,
          status: 'applying',
          createdDocumentIds: [...run.createdDocumentIds, ...created],
          nextBatchIndex: nextBatchIndex + 1,
          rollbackCursor: run.createdDocumentIds.length + created.length,
          finishedAt: timestamp,
        });
      }

      const verifiedBatchCount = requiredInteger(run.verifiedBatchCount, 'verifiedBatchCount');
      if (verifiedBatchCount < totalBatches) {
        const batch = candidates.slice(
          verifiedBatchCount * options.batchSize,
          (verifiedBatchCount + 1) * options.batchSize,
        );
        await verifyOneBatch(transaction, run, batch);
        return saveState(transaction, {
          ...run,
          status: 'verifying',
          verifiedBatchCount: verifiedBatchCount + 1,
          finishedAt: timestamp,
        });
      }
      throw new SeedOperationError('CONFLICT', '归属集合审计尚未完成。');
    });
  } catch (error: unknown) {
    await markRunFailed(repository, seed.manifest.seedRunId, timestamp, error);
    throw error;
  }
}

/** Explicitly resumes the last committed phase; it never skips verification. */
export async function resumeFailedSeedBatchRun(
  repository: SeedRepositoryPort,
  seed: SeedPackage,
  options: SeedBatchCoordinatorOptions,
): Promise<SeedBatchRunState> {
  assertCoordinatorInput(seed, options);
  const timestamp = executionTimestamp(options);
  const totalBatches = Math.ceil(createCandidates(seed).length / options.batchSize);
  return repository.transaction(async (transaction) => {
    const run = await requireCompatibleRun(transaction, seed, options, totalBatches);
    if (run.status !== 'failed' || run.failedFromStatus === undefined) {
      throw new SeedOperationError('CONFLICT', 'migration run 当前不是可恢复的 failed 状态。');
    }
    const status = resumeStatus(run.failedFromStatus);
    return saveState(transaction, {
      ...run,
      status,
      failureCode: undefined,
      failedFromStatus: undefined,
      finishedAt: timestamp,
    });
  });
}

export async function beginSeedBatchRollback(
  repository: SeedRepositoryPort,
  seedRunId: string,
  options: SeedExecutionOptions,
): Promise<SeedBatchRunState> {
  if (!seedRunId) throw new SeedOperationError('VALIDATION_ERROR', 'seedRunId 不能为空。');
  const timestamp = executionTimestamp(options);
  return repository.transaction(async (transaction) => {
    const run = await transaction.getMigrationRun(seedRunId);
    if (!run) throw new SeedOperationError('NOT_FOUND', '找不到对应的 migration run。');
    assertBatchMetadata(run);
    if (run.status === 'rolled_back' || run.status === 'rolling_back') return toState(run);
    if (run.status === 'failed' && run.failedFromStatus === 'rolling_back') {
      throw new SeedOperationError('CONFLICT', '回滚失败的 migration run 必须恢复原 rollbackCursor，不能重新开始回滚。');
    }
    const updated: SeedMigrationRun = {
      ...run,
      status: 'rolling_back',
      rollbackCursor: run.createdDocumentIds.length,
      failureCode: undefined,
      failedFromStatus: undefined,
      finishedAt: timestamp,
    };
    await transaction.putMigrationRun(updated);
    return toState(updated);
  });
}

/** Advances exactly one reverse-order rollback batch or its final state transition. */
export async function advanceSeedBatchRollback(
  repository: SeedRepositoryPort,
  seedRunId: string,
  options: SeedExecutionOptions,
): Promise<SeedBatchRunState> {
  if (!seedRunId) throw new SeedOperationError('VALIDATION_ERROR', 'seedRunId 不能为空。');
  const timestamp = executionTimestamp(options);
  try {
    return await repository.transaction(async (transaction) => {
      const run = await transaction.getMigrationRun(seedRunId);
      if (!run) throw new SeedOperationError('NOT_FOUND', '找不到对应的 migration run。');
      assertBatchMetadata(run);
      if (run.status === 'rolled_back') return toState(run);
      if (run.status === 'failed') throw new SeedOperationError('CONFLICT', '回滚已失败，必须先显式恢复。');
      if (run.status !== 'rolling_back') throw new SeedOperationError('CONFLICT', 'migration run 尚未进入 rolling_back。');

      const cursor = requiredInteger(run.rollbackCursor, 'rollbackCursor');
      if (cursor === 0) {
        return saveState(transaction, {
          ...run,
          status: 'rolled_back',
          finishedAt: timestamp,
        });
      }
      const batchSize = requiredPositiveInteger(run.batchSize, 'batchSize');
      const start = Math.max(0, cursor - batchSize);
      const batch = run.createdDocumentIds.slice(start, cursor).reverse();
      await rollbackOneBatch(transaction, run, batch);
      return saveState(transaction, {
        ...run,
        status: 'rolling_back',
        rollbackCursor: start,
        finishedAt: timestamp,
      });
    });
  } catch (error: unknown) {
    await markRunFailed(repository, seedRunId, timestamp, error);
    throw error;
  }
}

/** Local convenience runner. It retains the same one-transaction-per-step semantics. */
export async function runSeedBatchImportToCompletion(
  repository: SeedRepositoryPort,
  seed: SeedPackage,
  options: SeedBatchCoordinatorOptions,
): Promise<SeedBatchRunState> {
  let state = await planSeedBatchRun(repository, seed, options);
  const maxSteps = state.totalBatches * 2 + 4;
  for (let step = 0; state.status !== 'succeeded' && step < maxSteps; step += 1) {
    state = await advanceSeedBatchRun(repository, seed, options);
  }
  if (state.status !== 'succeeded') throw new SeedOperationError('CONFLICT', '分批种子导入未在预期状态步数内完成。');
  return state;
}

export async function runSeedBatchRollbackToCompletion(
  repository: SeedRepositoryPort,
  seedRunId: string,
  options: SeedExecutionOptions,
): Promise<SeedBatchRunState> {
  let state = await beginSeedBatchRollback(repository, seedRunId, options);
  const maxSteps = state.totalBatches + 1;
  for (let step = 0; state.status !== 'rolled_back' && step < maxSteps; step += 1) {
    state = await advanceSeedBatchRollback(repository, seedRunId, options);
  }
  if (state.status !== 'rolled_back') throw new SeedOperationError('CONFLICT', '分批种子回滚未在预期状态步数内完成。');
  return state;
}

async function applyOneBatch(
  transaction: SeedRepositoryTransaction,
  run: SeedMigrationRun,
  candidates: readonly SeedBatchCandidate[],
): Promise<readonly SeedDocumentReference[]> {
  const owned = new Map(run.createdDocumentIds.map((reference) => [referenceKey(reference), reference]));
  const missing: SeedBatchCandidate[] = [];
  const issues: SeedVerificationIssue[] = [];
  for (const candidate of candidates) {
    const current = await transaction.getDocument(candidate.collection, candidate.id);
    if (!current) {
      missing.push(candidate);
      continue;
    }
    if (current.contentHash !== candidate.contentHash) {
      issues.push(issue('DOCUMENT_CONTENT_MISMATCH', candidate, `文档 ${referenceKey(candidate)} 已存在且内容不同。`));
      continue;
    }
    if (owned.has(referenceKey(candidate)) && !hasExpectedOwnership(current, run, candidate.contentHash)) {
      issues.push(issue('DOCUMENT_OWNERSHIP_MISMATCH', candidate, `文档 ${referenceKey(candidate)} 已改变种子归属。`));
    }
  }
  throwIssues('种子批次预检发现冲突，当前批次未写入。', issues);
  for (const candidate of missing) await transaction.createDocument(candidate);
  return missing.map(toReference);
}

async function verifyOneBatch(
  transaction: SeedRepositoryTransaction,
  run: SeedMigrationRun,
  candidates: readonly SeedBatchCandidate[],
): Promise<void> {
  const owned = new Set(run.createdDocumentIds.map(referenceKey));
  const issues: SeedVerificationIssue[] = [];
  for (const candidate of candidates) {
    const current = await transaction.getDocument(candidate.collection, candidate.id);
    if (!current) {
      issues.push(issue('DOCUMENT_MISSING', candidate, `缺少文档 ${referenceKey(candidate)}。`));
    } else if (current.contentHash !== candidate.contentHash) {
      issues.push(issue('DOCUMENT_CONTENT_MISMATCH', candidate, `文档 ${referenceKey(candidate)} 内容摘要不一致。`));
    } else if (owned.has(referenceKey(candidate)) && !hasExpectedOwnership(current, run, candidate.contentHash)) {
      issues.push(issue('DOCUMENT_OWNERSHIP_MISMATCH', candidate, `文档 ${referenceKey(candidate)} 的种子归属不一致。`));
    }
  }
  throwIssues('种子全量 verify 发现冲突。', issues);
}

function verifyOwnedSet(actual: readonly SeedStoredDocument[], run: SeedMigrationRun): void {
  const expected = new Map(run.createdDocumentIds.map((reference) => [referenceKey(reference), reference]));
  const issues: SeedVerificationIssue[] = [];
  for (const document of actual) {
    const reference = expected.get(referenceKey(document));
    if (!reference) {
      issues.push(issue('UNEXPECTED_OWNED_DOCUMENT', document, `发现 run 未记录的文档 ${referenceKey(document)}。`));
    } else if (!hasExpectedOwnership(document, run, reference.contentHash)) {
      issues.push(issue('DOCUMENT_OWNERSHIP_MISMATCH', document, `文档 ${referenceKey(document)} 的归属或摘要不一致。`));
    }
  }
  for (const reference of run.createdDocumentIds) {
    if (!actual.some((document) => referenceKey(document) === referenceKey(reference))) {
      issues.push(issue('DOCUMENT_OWNERSHIP_MISMATCH', reference, `run 创建的文档 ${referenceKey(reference)} 已丢失归属。`));
    }
  }
  throwIssues('种子归属集合 verify 未通过。', issues);
}

function sameReferences(
  left: readonly SeedDocumentReference[],
  right: readonly SeedDocumentReference[],
): boolean {
  return left.length === right.length && left.every((reference, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && reference.collection === candidate.collection
      && reference.id === candidate.id
      && reference.contentHash === candidate.contentHash;
  });
}

async function rollbackOneBatch(
  transaction: SeedRepositoryTransaction,
  run: SeedMigrationRun,
  references: readonly SeedDocumentReference[],
): Promise<void> {
  const issues: SeedVerificationIssue[] = [];
  for (const reference of references) {
    const current = await transaction.getDocument(reference.collection, reference.id);
    if (!current) {
      issues.push(issue('DOCUMENT_MISSING', reference, `待回滚文档 ${referenceKey(reference)} 已不存在。`));
    } else if (!hasExpectedOwnership(current, run, reference.contentHash)) {
      issues.push(issue('DOCUMENT_OWNERSHIP_MISMATCH', reference, `待回滚文档 ${referenceKey(reference)} 已被外部修改或改变归属。`));
    }
  }
  throwIssues('回滚批次预检发现外部修改，当前批次未删除。', issues);
  for (const reference of references) await transaction.deleteDocument(reference.collection, reference.id);
}

async function requireCompatibleRun(
  transaction: SeedRepositoryTransaction,
  seed: SeedPackage,
  options: SeedBatchCoordinatorOptions,
  totalBatches: number,
): Promise<SeedMigrationRun> {
  const run = await transaction.getMigrationRun(seed.manifest.seedRunId);
  if (!run) throw new SeedOperationError('NOT_FOUND', '找不到对应的 migration run，请先 plan。');
  assertCompatibleBatchRun(run, seed, options, totalBatches);
  return run;
}

function assertCompatibleBatchRun(
  run: SeedMigrationRun,
  seed: SeedPackage,
  options: SeedBatchCoordinatorOptions,
  totalBatches: number,
): void {
  if (run.contentHash !== seed.manifest.contentHash
    || run.seedVersion !== seed.manifest.seedVersion
    || run.schemaVersion !== seed.manifest.schemaVersion
    || run.source !== seed.manifest.source
    || run.requestId !== options.requestId
    || run.batchSize !== options.batchSize
    || run.totalBatches !== totalBatches
    || SEED_COLLECTION_ORDER.some((collection) => run.counts[collection] !== seed.collections[collection].length)) {
    throw new SeedOperationError('CONFLICT', '已有 migration run 与当前种子或分批计划不一致。');
  }
  assertBatchMetadata(run);
}

function assertBatchMetadata(run: SeedMigrationRun): void {
  requiredPositiveInteger(run.batchSize, 'batchSize');
  requiredInteger(run.totalBatches, 'totalBatches');
  requiredInteger(run.nextBatchIndex, 'nextBatchIndex');
  requiredInteger(run.verifiedBatchCount, 'verifiedBatchCount');
  requiredInteger(run.rollbackCursor, 'rollbackCursor');
}

async function saveState(
  transaction: SeedRepositoryTransaction,
  run: SeedMigrationRun,
): Promise<SeedBatchRunState> {
  await transaction.putMigrationRun(run);
  return toState(run);
}

async function markRunFailed(
  repository: SeedRepositoryPort,
  seedRunId: string,
  timestamp: string,
  error: unknown,
): Promise<void> {
  try {
    await repository.transaction(async (transaction) => {
      const run = await transaction.getMigrationRun(seedRunId);
      if (!run || run.status === 'failed' || run.status === 'succeeded' || run.status === 'rolled_back') return;
      const failedFromStatus = run.status as SeedMigrationActiveStatus;
      await transaction.putMigrationRun({
        ...run,
        status: 'failed',
        failureCode: safeFailureCode(error),
        failedFromStatus,
        finishedAt: timestamp,
      });
    });
  } catch {
    // Preserve the original failure. A subsequent read will reveal that the
    // state transition could not be recorded, without claiming success.
  }
}

function safeFailureCode(error: unknown): string {
  if (error instanceof SeedOperationError) return error.code;
  if (error instanceof DocumentDatabasePlatformError) return `DATABASE_${error.kind.toUpperCase().replace('-', '_')}`;
  return 'UNEXPECTED_FAILURE';
}

function resumeStatus(status: SeedMigrationActiveStatus): SeedMigrationActiveStatus {
  if (status === 'rolling_back') return 'rolling_back';
  if (status === 'verifying') return 'verifying';
  return 'applying';
}

function createCandidates(seed: SeedPackage): readonly SeedBatchCandidate[] {
  return SEED_COLLECTION_ORDER.flatMap((collection) => seed.collections[collection].map((document) => ({
    collection,
    id: String(document._id),
    document,
    contentHash: computeJsonContentHash(document),
    seedRunId: seed.manifest.seedRunId,
    seedVersion: seed.manifest.seedVersion,
  })));
}

function countDocuments(seed: SeedPackage): Readonly<Record<SeedCollectionName, number>> {
  return Object.fromEntries(SEED_COLLECTION_ORDER.map((collection) => [
    collection,
    seed.collections[collection].length,
  ])) as Record<SeedCollectionName, number>;
}

function assertCoordinatorInput(seed: SeedPackage, options: SeedBatchCoordinatorOptions): void {
  const validation = validateSeedPackage(seed, { identityProfile: options.identityProfile ?? 'fixture' });
  if (!validation.ok) throw new SeedOperationError('VALIDATION_ERROR', `种子校验未通过：${validation.errors.join('；')}`);
  if (!options.requestId.trim()) throw new SeedOperationError('VALIDATION_ERROR', 'requestId 不能为空。');
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > MAX_SEED_BATCH_SIZE) {
    throw new SeedOperationError('VALIDATION_ERROR', `batchSize 必须是 1—${MAX_SEED_BATCH_SIZE} 的整数。`);
  }
  executionTimestamp(options);
}

function executionTimestamp(options: SeedExecutionOptions): string {
  if (!options.executedBy.trim()) throw new SeedOperationError('VALIDATION_ERROR', 'executedBy 不能为空。');
  const timestamp = options.now();
  if (Number.isNaN(Date.parse(timestamp))) throw new SeedOperationError('VALIDATION_ERROR', 'now 必须返回有效 ISO 时间。');
  return timestamp;
}

function toState(run: SeedMigrationRun): SeedBatchRunState {
  return {
    seedRunId: run._id,
    status: run.status,
    nextBatchIndex: requiredInteger(run.nextBatchIndex, 'nextBatchIndex'),
    totalBatches: requiredInteger(run.totalBatches, 'totalBatches'),
    verifiedBatchCount: requiredInteger(run.verifiedBatchCount, 'verifiedBatchCount'),
    rollbackCursor: requiredInteger(run.rollbackCursor, 'rollbackCursor'),
    createdCount: run.createdDocumentIds.length,
  };
}

function requiredInteger(value: number | undefined, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new SeedOperationError('CONFLICT', `migration run ${field} 无效。`);
  }
  return value as number;
}

function requiredPositiveInteger(value: number | undefined, field: string): number {
  const parsed = requiredInteger(value, field);
  if (parsed < 1) throw new SeedOperationError('CONFLICT', `migration run ${field} 必须大于 0。`);
  return parsed;
}

function hasExpectedOwnership(
  document: SeedStoredDocument,
  run: SeedMigrationRun,
  contentHash: string,
): boolean {
  return document.seedRunId === run._id
    && document.seedVersion === run.seedVersion
    && document.contentHash === contentHash;
}

function toReference(document: SeedStoredDocument): SeedDocumentReference {
  return { collection: document.collection, id: document.id, contentHash: document.contentHash };
}

function referenceKey(reference: Pick<SeedDocumentReference, 'collection' | 'id'>): string {
  return `${reference.collection}/${reference.id}`;
}

function issue(
  code: SeedVerificationIssue['code'],
  reference: Pick<SeedDocumentReference, 'collection' | 'id'>,
  message: string,
): SeedVerificationIssue {
  return { code, collection: reference.collection, id: reference.id, message };
}

function throwIssues(message: string, issues: readonly SeedVerificationIssue[]): void {
  if (issues.length > 0) throw new SeedOperationError('CONFLICT', message, issues);
}
