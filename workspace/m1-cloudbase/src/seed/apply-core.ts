import type { JsonObject } from '../shared/protocol';
import { computeJsonContentHash } from './canonical-json';
import { SEED_COLLECTION_ORDER, type SeedCollectionName, type SeedPackage } from './model';
import { validateSeedPackage } from './validator';

export type SeedMigrationStatus =
  | 'planned'
  | 'applying'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'rolling_back'
  | 'rolled_back';

export type SeedMigrationActiveStatus = Exclude<SeedMigrationStatus, 'failed' | 'succeeded' | 'rolled_back'>;

export interface SeedDocumentReference {
  readonly collection: SeedCollectionName;
  readonly id: string;
  readonly contentHash: string;
}

export interface SeedStoredDocument extends SeedDocumentReference {
  readonly document: JsonObject;
  readonly seedRunId?: string;
  readonly seedVersion?: string;
}

export interface SeedMigrationRun {
  readonly _id: string;
  readonly schemaVersion: number;
  readonly seedVersion: string;
  readonly source: 'm0-fixture';
  readonly status: SeedMigrationStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly counts: Readonly<Record<SeedCollectionName, number>>;
  readonly contentHash: string;
  readonly createdDocumentIds: readonly SeedDocumentReference[];
  readonly executedBy: string;
  readonly requestId?: string;
  readonly batchSize?: number;
  readonly totalBatches?: number;
  readonly nextBatchIndex?: number;
  readonly verifiedBatchCount?: number;
  readonly rollbackCursor?: number;
  readonly failureCode?: string;
  readonly failedFromStatus?: SeedMigrationActiveStatus;
}

export interface SeedRepositoryTransaction {
  getDocument(collection: SeedCollectionName, id: string): Promise<SeedStoredDocument | null>;
  listDocumentsBySeedRunId(seedRunId: string): Promise<readonly SeedStoredDocument[]>;
  createDocument(document: SeedStoredDocument): Promise<void>;
  deleteDocument(collection: SeedCollectionName, id: string): Promise<void>;
  getMigrationRun(seedRunId: string): Promise<SeedMigrationRun | null>;
  putMigrationRun(run: SeedMigrationRun): Promise<void>;
}

export interface SeedRepositoryPort {
  transaction<T>(operation: (transaction: SeedRepositoryTransaction) => Promise<T>): Promise<T>;
  /** Point read outside a transaction, used to decide whether final audit is due. */
  readMigrationRunSnapshot(seedRunId: string): Promise<SeedMigrationRun | null>;
  /**
   * Read-only ownership audit outside a transaction. CloudBase transactions
   * support document references but not collection `where` queries.
   */
  listDocumentsBySeedRunIdSnapshot(seedRunId: string): Promise<readonly SeedStoredDocument[]>;
}

export interface SeedExecutionOptions {
  readonly executedBy: string;
  readonly now: () => string;
}

export interface SeedApplyResult {
  readonly status: 'applied' | 'already_applied';
  readonly seedRunId: string;
  readonly contentHash: string;
  readonly createdCount: number;
  readonly skippedCount: number;
  readonly createdDocumentIds: readonly SeedDocumentReference[];
}

export type SeedVerificationIssueCode =
  | 'MIGRATION_RUN_MISSING'
  | 'MIGRATION_RUN_MISMATCH'
  | 'DOCUMENT_MISSING'
  | 'DOCUMENT_CONTENT_MISMATCH'
  | 'DOCUMENT_OWNERSHIP_MISMATCH'
  | 'UNEXPECTED_OWNED_DOCUMENT';

export interface SeedVerificationIssue {
  readonly code: SeedVerificationIssueCode;
  readonly collection?: SeedCollectionName;
  readonly id?: string;
  readonly message: string;
}

export interface SeedVerificationResult {
  readonly ok: boolean;
  readonly seedRunId: string;
  readonly expectedCount: number;
  readonly matchedCount: number;
  readonly issues: readonly SeedVerificationIssue[];
}

export interface SeedRollbackResult {
  readonly status: 'rolled_back' | 'already_rolled_back';
  readonly seedRunId: string;
  readonly deletedCount: number;
}

export type SeedOperationErrorCode = 'VALIDATION_ERROR' | 'CONFLICT' | 'NOT_FOUND' | 'CAPACITY_EXCEEDED';

export class SeedOperationError extends Error {
  public constructor(
    public readonly code: SeedOperationErrorCode,
    message: string,
    public readonly conflicts: readonly SeedVerificationIssue[] = [],
  ) {
    super(message);
    this.name = 'SeedOperationError';
  }
}

interface SeedCandidate extends SeedStoredDocument {
  readonly seedRunId: string;
  readonly seedVersion: string;
}

const COLLECTION_POSITION = new Map<SeedCollectionName, number>(
  SEED_COLLECTION_ORDER.map((collection, index) => [collection, index]),
);

export async function applySeedPackage(
  repository: SeedRepositoryPort,
  seed: SeedPackage,
  options: SeedExecutionOptions,
): Promise<SeedApplyResult> {
  assertExecutableSeed(seed);
  const timestamp = getExecutionTimestamp(options);
  const candidates = createCandidates(seed);

  return repository.transaction(async (transaction) => {
    const existingRun = await transaction.getMigrationRun(seed.manifest.seedRunId);
    const conflicts: SeedVerificationIssue[] = [];
    assertCompatibleRun(existingRun, seed, conflicts);
    validateRunReferences(existingRun, candidates, conflicts);
    const existingRunCreated = new Map(
      (existingRun?.createdDocumentIds ?? []).map((reference) => [referenceKey(reference), reference]),
    );

    const created: SeedCandidate[] = [];
    let skippedCount = 0;
    for (const candidate of candidates) {
      const current = await transaction.getDocument(candidate.collection, candidate.id);
      if (!current) {
        if (existingRun?.status === 'succeeded') {
          conflicts.push(issue('DOCUMENT_MISSING', `已完成 migration run 的文档 ${candidate.collection}/${candidate.id} 已不存在。`, candidate));
        } else {
          created.push(candidate);
        }
        continue;
      }
      if (computeJsonContentHash(current.document) === candidate.contentHash) {
        if (existingRunCreated.has(referenceKey(candidate)) && (
          current.seedRunId !== seed.manifest.seedRunId
          || current.seedVersion !== seed.manifest.seedVersion
        )) {
          conflicts.push(issue(
            'DOCUMENT_OWNERSHIP_MISMATCH',
            `已完成 migration run 的文档 ${candidate.collection}/${candidate.id} 已改变归属。`,
            candidate,
          ));
          continue;
        }
        skippedCount += 1;
        continue;
      }
      conflicts.push(issue(
        'DOCUMENT_CONTENT_MISMATCH',
        `文档 ${candidate.collection}/${candidate.id} 已存在且内容不同。`,
        candidate,
      ));
    }

    if (conflicts.length > 0) {
      throw new SeedOperationError('CONFLICT', '种子预检发现冲突，未写入任何文档。', sortIssues(conflicts));
    }

    if (existingRun?.status === 'succeeded') {
      return {
        status: 'already_applied',
        seedRunId: seed.manifest.seedRunId,
        contentHash: seed.manifest.contentHash,
        createdCount: 0,
        skippedCount: candidates.length,
        createdDocumentIds: existingRun.createdDocumentIds,
      };
    }

    for (const candidate of created) await transaction.createDocument(candidate);
    const createdDocumentIds = created.map(toReference);
    await transaction.putMigrationRun({
      _id: seed.manifest.seedRunId,
      schemaVersion: seed.manifest.schemaVersion,
      seedVersion: seed.manifest.seedVersion,
      source: seed.manifest.source,
      status: 'succeeded',
      startedAt: timestamp,
      finishedAt: timestamp,
      counts: countDocuments(seed),
      contentHash: seed.manifest.contentHash,
      createdDocumentIds,
      executedBy: options.executedBy,
    });

    return {
      status: 'applied',
      seedRunId: seed.manifest.seedRunId,
      contentHash: seed.manifest.contentHash,
      createdCount: created.length,
      skippedCount,
      createdDocumentIds,
    };
  });
}

export async function verifySeedPackage(
  repository: SeedRepositoryPort,
  seed: SeedPackage,
): Promise<SeedVerificationResult> {
  assertExecutableSeed(seed);
  const candidates = createCandidates(seed);

  return repository.transaction(async (transaction) => {
    const issues: SeedVerificationIssue[] = [];
    const run = await transaction.getMigrationRun(seed.manifest.seedRunId);
    if (!run) {
      issues.push(issue('MIGRATION_RUN_MISSING', '找不到对应的 migration run。'));
    } else {
      assertCompatibleRun(run, seed, issues, true);
      validateRunReferences(run, candidates, issues);
    }

    let matchedCount = 0;
    for (const candidate of candidates) {
      const current = await transaction.getDocument(candidate.collection, candidate.id);
      if (!current) {
        issues.push(issue('DOCUMENT_MISSING', `缺少文档 ${candidate.collection}/${candidate.id}。`, candidate));
      } else if (computeJsonContentHash(current.document) !== candidate.contentHash) {
        issues.push(issue('DOCUMENT_CONTENT_MISMATCH', `文档 ${candidate.collection}/${candidate.id} 内容摘要不一致。`, candidate));
      } else {
        matchedCount += 1;
      }
    }

    if (run) {
      const expectedOwned = new Map(run.createdDocumentIds.map((reference) => [referenceKey(reference), reference]));
      const owned = await transaction.listDocumentsBySeedRunId(seed.manifest.seedRunId);
      for (const current of owned) {
        const expected = expectedOwned.get(referenceKey(current));
        if (!expected) {
          issues.push(issue('UNEXPECTED_OWNED_DOCUMENT', `发现 migration run 未记录的文档 ${current.collection}/${current.id}。`, current));
        } else if (
          current.seedRunId !== seed.manifest.seedRunId
          || current.seedVersion !== seed.manifest.seedVersion
          || computeJsonContentHash(current.document) !== expected.contentHash
        ) {
          issues.push(issue('DOCUMENT_OWNERSHIP_MISMATCH', `文档 ${current.collection}/${current.id} 的种子归属或摘要不一致。`, current));
        }
      }
      for (const expected of run.createdDocumentIds) {
        if (!owned.some((current) => referenceKey(current) === referenceKey(expected))) {
          issues.push(issue('DOCUMENT_OWNERSHIP_MISMATCH', `migration run 创建的文档 ${expected.collection}/${expected.id} 已丢失归属。`, expected));
        }
      }
    }

    return {
      ok: issues.length === 0,
      seedRunId: seed.manifest.seedRunId,
      expectedCount: candidates.length,
      matchedCount,
      issues: sortIssues(issues),
    };
  });
}

export async function rollbackSeedRun(
  repository: SeedRepositoryPort,
  seedRunId: string,
  options: SeedExecutionOptions,
): Promise<SeedRollbackResult> {
  const timestamp = getExecutionTimestamp(options);
  if (!seedRunId) throw new SeedOperationError('VALIDATION_ERROR', 'seedRunId 不能为空。');

  return repository.transaction(async (transaction) => {
    const run = await transaction.getMigrationRun(seedRunId);
    if (!run) throw new SeedOperationError('NOT_FOUND', '找不到对应的 migration run。');
    if (run.status === 'rolled_back') return { status: 'already_rolled_back', seedRunId, deletedCount: 0 };

    const conflicts: SeedVerificationIssue[] = [];
    const expectedKeys = new Set(run.createdDocumentIds.map(referenceKey));
    const ownedDocuments = await transaction.listDocumentsBySeedRunId(seedRunId);
    for (const current of ownedDocuments) {
      if (!expectedKeys.has(referenceKey(current))) {
        conflicts.push(issue('UNEXPECTED_OWNED_DOCUMENT', `发现 migration run 未记录的文档 ${current.collection}/${current.id}。`, current));
      }
    }
    for (const expected of run.createdDocumentIds) {
      const current = await transaction.getDocument(expected.collection, expected.id);
      if (!current) {
        conflicts.push(issue('DOCUMENT_MISSING', `待回滚文档 ${expected.collection}/${expected.id} 已不存在。`, expected));
      } else if (
        current.seedRunId !== seedRunId
        || current.seedVersion !== run.seedVersion
        || computeJsonContentHash(current.document) !== expected.contentHash
      ) {
        conflicts.push(issue('DOCUMENT_OWNERSHIP_MISMATCH', `待回滚文档 ${expected.collection}/${expected.id} 已被外部修改或改变归属。`, expected));
      }
    }
    if (conflicts.length > 0) {
      throw new SeedOperationError('CONFLICT', '回滚预检发现外部修改，未删除任何文档。', sortIssues(conflicts));
    }

    const reversed = [...run.createdDocumentIds].sort(compareReferences).reverse();
    for (const reference of reversed) await transaction.deleteDocument(reference.collection, reference.id);
    await transaction.putMigrationRun({ ...run, status: 'rolled_back', finishedAt: timestamp });
    return { status: 'rolled_back', seedRunId, deletedCount: reversed.length };
  });
}

function createCandidates(seed: SeedPackage): readonly SeedCandidate[] {
  return SEED_COLLECTION_ORDER.flatMap((collection) => seed.collections[collection].map((document) => ({
    collection,
    id: String(document._id),
    document,
    contentHash: computeJsonContentHash(document),
    seedRunId: seed.manifest.seedRunId,
    seedVersion: seed.manifest.seedVersion,
  }))).sort(compareReferences);
}

function countDocuments(seed: SeedPackage): Readonly<Record<SeedCollectionName, number>> {
  return Object.fromEntries(SEED_COLLECTION_ORDER.map((collection) => [collection, seed.collections[collection].length])) as Record<SeedCollectionName, number>;
}

function assertExecutableSeed(seed: SeedPackage): void {
  const validation = validateSeedPackage(seed);
  if (!validation.ok) {
    throw new SeedOperationError('VALIDATION_ERROR', `种子校验未通过：${validation.errors.join('；')}`);
  }
}

function getExecutionTimestamp(options: SeedExecutionOptions): string {
  if (!options.executedBy.trim()) throw new SeedOperationError('VALIDATION_ERROR', 'executedBy 不能为空。');
  const timestamp = options.now();
  if (Number.isNaN(Date.parse(timestamp))) throw new SeedOperationError('VALIDATION_ERROR', 'now 必须返回有效 ISO 时间。');
  return timestamp;
}

function assertCompatibleRun(
  run: SeedMigrationRun | null,
  seed: SeedPackage,
  issues: SeedVerificationIssue[],
  verification = false,
): void {
  if (!run) return;
  if (
    run._id !== seed.manifest.seedRunId
    || run.contentHash !== seed.manifest.contentHash
    || run.seedVersion !== seed.manifest.seedVersion
    || run.schemaVersion !== seed.manifest.schemaVersion
    || run.source !== seed.manifest.source
    || SEED_COLLECTION_ORDER.some((collection) => run.counts[collection] !== seed.collections[collection].length)
  ) {
    issues.push(issue('MIGRATION_RUN_MISMATCH', '已有 migration run 与当前种子的版本或摘要不一致。'));
  }
  if (run.status !== 'succeeded') {
    issues.push(issue('MIGRATION_RUN_MISMATCH', verification
      ? 'migration run 不是 succeeded 状态。'
      : '该 seedRunId 已回滚，必须使用新的 seedRunId 再次执行。'));
  }
}

function validateRunReferences(
  run: SeedMigrationRun | null,
  candidates: readonly SeedCandidate[],
  issues: SeedVerificationIssue[],
): void {
  if (!run) return;
  const candidateHashes = new Map(candidates.map((candidate) => [referenceKey(candidate), candidate.contentHash]));
  const seen = new Set<string>();
  for (const reference of run.createdDocumentIds) {
    const key = referenceKey(reference);
    const expectedHash = candidateHashes.get(key);
    if (seen.has(key) || expectedHash === undefined || expectedHash !== reference.contentHash) {
      issues.push(issue(
        'MIGRATION_RUN_MISMATCH',
        `migration run 的创建记录 ${reference.collection}/${reference.id} 与当前种子不一致。`,
        reference,
      ));
    }
    seen.add(key);
  }
}

function toReference(document: SeedStoredDocument): SeedDocumentReference {
  return { collection: document.collection, id: document.id, contentHash: document.contentHash };
}

function compareReferences(left: SeedDocumentReference, right: SeedDocumentReference): number {
  const collectionDifference = (COLLECTION_POSITION.get(left.collection) ?? 0) - (COLLECTION_POSITION.get(right.collection) ?? 0);
  return collectionDifference || left.id.localeCompare(right.id);
}

function referenceKey(reference: Pick<SeedDocumentReference, 'collection' | 'id'>): string {
  return `${reference.collection}/${reference.id}`;
}

function issue(
  code: SeedVerificationIssueCode,
  message: string,
  reference?: Pick<SeedDocumentReference, 'collection' | 'id'>,
): SeedVerificationIssue {
  return reference ? { code, collection: reference.collection, id: reference.id, message } : { code, message };
}

function sortIssues(issues: readonly SeedVerificationIssue[]): readonly SeedVerificationIssue[] {
  return [...issues].sort((left, right) => {
    const leftCollection = left.collection ? COLLECTION_POSITION.get(left.collection) ?? -1 : -1;
    const rightCollection = right.collection ? COLLECTION_POSITION.get(right.collection) ?? -1 : -1;
    return leftCollection - rightCollection
      || (left.id ?? '').localeCompare(right.id ?? '')
      || left.code.localeCompare(right.code);
  });
}
