import type { JsonObject, JsonValue } from '../shared/protocol';
import {
  type DocumentDatabasePort,
  type DocumentDatabaseTransactionPort,
  type VersionedDocument,
} from '../repositories/document-database-port';
import { computeJsonContentHash } from './canonical-json';
import {
  SeedOperationError,
  type SeedDocumentReference,
  type SeedMigrationRun,
  type SeedMigrationStatus,
  type SeedRepositoryPort,
  type SeedRepositoryTransaction,
  type SeedStoredDocument,
} from './apply-core';
import { SEED_COLLECTION_ORDER, type SeedCollectionName } from './model';

const MIGRATION_RUNS_COLLECTION = 'migration_runs';
const SEED_VERSION_FIELD = 'seedVersion';
const SEED_DOCUMENT_HASH_FIELD = 'seedDocumentContentHash';

export interface SeedDocumentDatabaseRepositoryOptions {
  /** Trusted single-organization boundary for this development seed run. */
  readonly organizationId: string;
  /**
   * Verified upper bound for calls made through DocumentDatabaseTransactionPort.
   * There is deliberately no default: a caller must map this conservative budget
   * to the platform's current native transaction limits before enabling writes.
   */
  readonly maxPortOperationsPerTransaction: number;
}

/**
 * Seed persistence over the existing document transaction boundary.
 * It intentionally exposes no collection-wide delete or non-transactional write.
 */
export function createSeedDocumentDatabaseRepository(
  database: DocumentDatabasePort,
  options: SeedDocumentDatabaseRepositoryOptions,
): SeedRepositoryPort {
  const organizationId = options.organizationId.trim();
  if (!organizationId) throw new Error('Seed document repository organizationId must not be empty.');
  if (!Number.isInteger(options.maxPortOperationsPerTransaction)
    || options.maxPortOperationsPerTransaction < 1) {
    throw new Error('Seed document repository transaction budget must be a positive integer.');
  }

  return {
    readMigrationRunSnapshot: async (seedRunId: string) => {
      const current = await database.get(MIGRATION_RUNS_COLLECTION, seedRunId);
      return current === null ? null : decodeMigrationRun(current, organizationId);
    },
    listDocumentsBySeedRunIdSnapshot: async (seedRunId: string) => {
      const documents: SeedStoredDocument[] = [];
      for (const collection of SEED_COLLECTION_ORDER) {
        const rows = await database.find(collection, { seedRunId });
        for (const row of rows) {
          const decoded = decodeStoredDocument(collection, row);
          if (decoded.seedRunId === seedRunId) documents.push(decoded);
        }
      }
      return documents.sort(compareStoredDocuments);
    },
    transaction: async <T>(operation: (transaction: SeedRepositoryTransaction) => Promise<T>): Promise<T> => database
      .runTransaction(async (transaction) => operation(new SeedDocumentDatabaseTransaction(
        transaction,
        organizationId,
        options.maxPortOperationsPerTransaction,
      ))),
  };
}

class SeedDocumentDatabaseTransaction implements SeedRepositoryTransaction {
  private readonly documentCache = new Map<string, VersionedDocument | null>();
  private migrationDocument: VersionedDocument | null | undefined;
  private migrationRun: SeedMigrationRun | null | undefined;
  private operationCount = 0;
  private mutationStarted = false;
  private readonly missingDocumentKeys = new Set<string>();

  public constructor(
    private readonly transaction: DocumentDatabaseTransactionPort,
    private readonly organizationId: string,
    private readonly maxOperations: number,
  ) {}

  public async getDocument(collection: SeedCollectionName, id: string): Promise<SeedStoredDocument | null> {
    const key = documentKey(collection, id);
    let current = this.documentCache.get(key);
    if (current === undefined && !this.documentCache.has(key)) {
      this.consumeOperation();
      current = await this.transaction.get(collection, id);
      this.documentCache.set(key, current);
      if (current === null) this.missingDocumentKeys.add(key);
    }
    return current === null || current === undefined ? null : decodeStoredDocument(collection, current);
  }

  public async listDocumentsBySeedRunId(seedRunId: string): Promise<readonly SeedStoredDocument[]> {
    const documents: SeedStoredDocument[] = [];
    for (const collection of SEED_COLLECTION_ORDER) {
      this.consumeOperation();
      const rows = await this.transaction.find(collection, { seedRunId });
      for (const row of rows) {
        this.documentCache.set(documentKey(collection, row._id), row);
        const decoded = decodeStoredDocument(collection, row);
        if (decoded.seedRunId === seedRunId) documents.push(decoded);
      }
    }
    return documents.sort(compareStoredDocuments);
  }

  public async createDocument(document: SeedStoredDocument): Promise<void> {
    assertSeedDocumentForWrite(document, this.organizationId);
    this.assertCapacityBeforeFirstMutation('create');
    this.consumeOperation();
    const encoded = encodeStoredDocument(document);
    if (!await this.transaction.create(document.collection, encoded)) {
      throw conflict(`Seed document create conflicted: ${document.collection}/${document.id}.`);
    }
    const key = documentKey(document.collection, document.id);
    this.documentCache.set(key, encoded);
    this.missingDocumentKeys.delete(key);
  }

  public async deleteDocument(collection: SeedCollectionName, id: string): Promise<void> {
    this.assertCapacityBeforeFirstMutation('delete');
    const key = documentKey(collection, id);
    const current = this.documentCache.get(key);
    if (current === undefined || current === null) {
      throw conflict(`Seed rollback document is not available in the transaction cache: ${collection}/${id}.`);
    }
    this.consumeOperation();
    if (!await this.transaction.delete(collection, id, current.version)) {
      throw conflict(`Seed rollback delete conflicted: ${collection}/${id}.`);
    }
    this.documentCache.set(key, null);
  }

  public async getMigrationRun(seedRunId: string): Promise<SeedMigrationRun | null> {
    if (this.migrationRun !== undefined) {
      if (this.migrationRun !== null && this.migrationRun._id !== seedRunId) {
        throw conflict('A seed transaction cannot access multiple migration runs.');
      }
      return this.migrationRun;
    }
    this.consumeOperation();
    const current = await this.transaction.get(MIGRATION_RUNS_COLLECTION, seedRunId);
    this.migrationDocument = current;
    this.migrationRun = current === null ? null : decodeMigrationRun(current, this.organizationId);
    return this.migrationRun;
  }

  public async putMigrationRun(run: SeedMigrationRun): Promise<void> {
    if (this.migrationRun === undefined) await this.getMigrationRun(run._id);
    if (this.migrationRun !== null && this.migrationRun !== undefined && this.migrationRun._id !== run._id) {
      throw conflict('A seed transaction cannot replace a different migration run.');
    }
    this.assertCapacityBeforeFirstMutation('migration');
    this.consumeOperation();
    const currentVersion = this.migrationDocument?.version;
    const encoded = encodeMigrationRun(run, this.organizationId, currentVersion === undefined ? 1 : currentVersion + 1);
    const saved = currentVersion === undefined
      ? await this.transaction.create(MIGRATION_RUNS_COLLECTION, encoded)
      : await this.transaction.replace(MIGRATION_RUNS_COLLECTION, run._id, currentVersion, encoded);
    if (!saved) throw conflict(`Migration run write conflicted: ${run._id}.`);
    this.migrationDocument = encoded;
    this.migrationRun = cloneMigrationRun(run);
  }

  private assertCapacityBeforeFirstMutation(kind: 'create' | 'delete' | 'migration'): void {
    if (this.mutationStarted) return;
    let plannedMutations = 1;
    if (kind === 'create') plannedMutations = this.missingDocumentKeys.size + 1;
    if (kind === 'delete') {
      plannedMutations = [...this.documentCache.values()].filter((document) => document !== null).length + 1;
    }
    if (this.operationCount + plannedMutations > this.maxOperations) {
      throw new SeedOperationError(
        'CAPACITY_EXCEEDED',
        `种子事务预计需要至少 ${this.operationCount + plannedMutations} 次文档端口操作，超过已验证上限 ${this.maxOperations}；首个写入前已停止。`,
      );
    }
    this.mutationStarted = true;
  }

  private consumeOperation(): void {
    if (this.operationCount + 1 > this.maxOperations) {
      throw new SeedOperationError(
        'CAPACITY_EXCEEDED',
        `种子事务超过已验证的 ${this.maxOperations} 次文档端口操作上限，事务已停止。`,
      );
    }
    this.operationCount += 1;
  }
}

function encodeStoredDocument(document: SeedStoredDocument): VersionedDocument {
  return {
    ...cloneJsonObject(document.document),
    [SEED_VERSION_FIELD]: document.seedVersion!,
    [SEED_DOCUMENT_HASH_FIELD]: document.contentHash,
  } as unknown as VersionedDocument;
}

function decodeStoredDocument(collection: SeedCollectionName, stored: VersionedDocument): SeedStoredDocument {
  const cloned = cloneJsonObject(stored as JsonObject);
  const seedVersion = cloned[SEED_VERSION_FIELD];
  const storedHash = cloned[SEED_DOCUMENT_HASH_FIELD];
  const raw = Object.fromEntries(Object.entries(cloned).filter(([field]) => (
    field !== SEED_VERSION_FIELD && field !== SEED_DOCUMENT_HASH_FIELD
  ))) as JsonObject;
  const contentHash = computeJsonContentHash(raw);
  const hasValidOwnership = typeof raw.seedRunId === 'string'
    && typeof seedVersion === 'string'
    && storedHash === contentHash;
  return {
    collection,
    id: stored._id,
    document: raw,
    contentHash,
    ...(hasValidOwnership ? { seedRunId: raw.seedRunId as string, seedVersion } : {}),
  };
}

function assertSeedDocumentForWrite(document: SeedStoredDocument, organizationId: string): void {
  if (document.document._id !== document.id) throw conflict('Seed document ID does not match its payload.');
  if (document.document.organizationId !== organizationId) {
    throw conflict(`Seed document is outside the trusted organization: ${document.collection}/${document.id}.`);
  }
  if (!document.seedRunId || document.document.seedRunId !== document.seedRunId || !document.seedVersion) {
    throw conflict(`Seed document ownership metadata is incomplete: ${document.collection}/${document.id}.`);
  }
  if (SEED_VERSION_FIELD in document.document || SEED_DOCUMENT_HASH_FIELD in document.document) {
    throw conflict(`Seed document uses reserved persistence metadata: ${document.collection}/${document.id}.`);
  }
  if (computeJsonContentHash(document.document) !== document.contentHash) {
    throw conflict(`Seed document content hash is stale: ${document.collection}/${document.id}.`);
  }
}

function encodeMigrationRun(run: SeedMigrationRun, organizationId: string, version: number): VersionedDocument {
  if (run.schemaVersion !== 1) {
    throw conflict(`Unsupported M1 seed schema version for migration run: ${run._id}.`);
  }
  return {
    _id: run._id,
    organizationId,
    schemaVersion: 1,
    version,
    deletedAt: null,
    seedVersion: run.seedVersion,
    source: run.source,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    counts: { ...run.counts },
    contentHash: run.contentHash,
    createdDocumentIds: run.createdDocumentIds.map((reference) => ({ ...reference })),
    executedBy: run.executedBy,
    ...(run.requestId === undefined ? {} : { requestId: run.requestId }),
    ...(run.batchSize === undefined ? {} : { batchSize: run.batchSize }),
    ...(run.totalBatches === undefined ? {} : { totalBatches: run.totalBatches }),
    ...(run.nextBatchIndex === undefined ? {} : { nextBatchIndex: run.nextBatchIndex }),
    ...(run.verifiedBatchCount === undefined ? {} : { verifiedBatchCount: run.verifiedBatchCount }),
    ...(run.rollbackCursor === undefined ? {} : { rollbackCursor: run.rollbackCursor }),
    ...(run.failureCode === undefined ? {} : { failureCode: run.failureCode }),
    ...(run.failedFromStatus === undefined ? {} : { failedFromStatus: run.failedFromStatus }),
  };
}

function decodeMigrationRun(document: VersionedDocument, organizationId: string): SeedMigrationRun {
  const status = document.status;
  const statuses = ['planned', 'applying', 'verifying', 'succeeded', 'failed', 'rolling_back', 'rolled_back'] as const;
  if (document.organizationId !== organizationId
    || document.source !== 'm0-fixture'
    || typeof status !== 'string'
    || !statuses.includes(status as (typeof statuses)[number])
    || typeof document.seedVersion !== 'string'
    || typeof document.startedAt !== 'string'
    || typeof document.finishedAt !== 'string'
    || typeof document.contentHash !== 'string'
    || typeof document.executedBy !== 'string'
    || !isJsonObject(document.counts)
    || !Array.isArray(document.createdDocumentIds)) {
    throw conflict(`Migration run is malformed or outside the trusted organization: ${document._id}.`);
  }
  const counts = decodeCounts(document.counts, document._id);
  const references = document.createdDocumentIds.map((value) => decodeReference(value, document._id));
  return {
    _id: document._id,
    schemaVersion: document.schemaVersion,
    seedVersion: document.seedVersion,
    source: 'm0-fixture',
    status: status as SeedMigrationStatus,
    startedAt: document.startedAt,
    finishedAt: document.finishedAt,
    counts,
    contentHash: document.contentHash,
    createdDocumentIds: references,
    executedBy: document.executedBy,
    ...decodeOptionalString(document, 'requestId'),
    ...decodeOptionalInteger(document, 'batchSize'),
    ...decodeOptionalInteger(document, 'totalBatches', true),
    ...decodeOptionalInteger(document, 'nextBatchIndex', true),
    ...decodeOptionalInteger(document, 'verifiedBatchCount', true),
    ...decodeOptionalInteger(document, 'rollbackCursor', true),
    ...decodeOptionalString(document, 'failureCode'),
    ...decodeFailedFromStatus(document),
  };
}

function decodeOptionalString<K extends 'requestId' | 'failureCode'>(
  document: VersionedDocument,
  field: K,
): Partial<Record<K, string>> {
  const value = document[field];
  if (value === undefined) return {};
  if (typeof value !== 'string' || value.length === 0) throw conflict(`Migration run ${field} is malformed: ${document._id}.`);
  return { [field]: value } as Partial<Record<K, string>>;
}

function decodeOptionalInteger<K extends 'batchSize' | 'totalBatches' | 'nextBatchIndex' | 'verifiedBatchCount' | 'rollbackCursor'>(
  document: VersionedDocument,
  field: K,
  allowZero = false,
): Partial<Record<K, number>> {
  const value = document[field];
  if (value === undefined) return {};
  if (typeof value !== 'number' || !Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw conflict(`Migration run ${field} is malformed: ${document._id}.`);
  }
  return { [field]: value } as Partial<Record<K, number>>;
}

function decodeFailedFromStatus(document: VersionedDocument): Pick<SeedMigrationRun, 'failedFromStatus'> | Record<string, never> {
  const value = document.failedFromStatus;
  if (value === undefined) return {};
  if (value !== 'planned' && value !== 'applying' && value !== 'verifying' && value !== 'rolling_back') {
    throw conflict(`Migration run failedFromStatus is malformed: ${document._id}.`);
  }
  return { failedFromStatus: value };
}

function decodeCounts(value: Readonly<Record<string, JsonValue>>, runId: string): Readonly<Record<SeedCollectionName, number>> {
  const counts = {} as Record<SeedCollectionName, number>;
  for (const collection of SEED_COLLECTION_ORDER) {
    const count = value[collection];
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw conflict(`Migration run counts are malformed: ${runId}.`);
    }
    counts[collection] = count as number;
  }
  return counts;
}

function decodeReference(value: JsonValue, runId: string): SeedDocumentReference {
  if (!isJsonObject(value)
    || !SEED_COLLECTION_ORDER.includes(value.collection as SeedCollectionName)
    || typeof value.id !== 'string'
    || typeof value.contentHash !== 'string') {
    throw conflict(`Migration run document reference is malformed: ${runId}.`);
  }
  return {
    collection: value.collection as SeedCollectionName,
    id: value.id,
    contentHash: value.contentHash,
  };
}

function compareStoredDocuments(left: SeedStoredDocument, right: SeedStoredDocument): number {
  return SEED_COLLECTION_ORDER.indexOf(left.collection) - SEED_COLLECTION_ORDER.indexOf(right.collection)
    || left.id.localeCompare(right.id);
}

function documentKey(collection: SeedCollectionName, id: string): string {
  return `${collection}/${id}`;
}

function cloneMigrationRun(run: SeedMigrationRun): SeedMigrationRun {
  return {
    ...run,
    counts: { ...run.counts },
    createdDocumentIds: run.createdDocumentIds.map((reference) => ({ ...reference })),
  };
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJson(value) as JsonObject;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function conflict(message: string): SeedOperationError {
  return new SeedOperationError('CONFLICT', message);
}
