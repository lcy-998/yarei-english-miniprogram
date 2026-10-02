import type { JsonValue } from '../shared/protocol';
import type { LearningProgressRepository, LearningProgressTransaction } from '../learning-progress/repository';
import {
  LearningProgressError,
  type LearningProgressAuditRecord,
  type LearningProgressOperationRecord,
  type LearningResourceAccessRecord,
  type ReadingProgressRecord,
  type ReadingPageEventRecord,
  type VocabularyProgressRecord,
} from '../learning-progress/types';
import {
  DocumentDatabasePlatformError,
  type DocumentDatabasePort,
  type DocumentDatabaseReaderPort,
  type DocumentDatabaseTransactionPort,
  type VersionedDocument,
} from './document-database-port';

export const LEARNING_PROGRESS_COLLECTIONS = {
  resources: 'learning_resources',
  memberships: 'class_memberships',
  reading: 'reading_progress',
  readingPageEvents: 'reading_page_events',
  vocabulary: 'vocabulary_progress',
  idempotency: 'idempotency_records',
  audit: 'operation_logs',
} as const;

export function createLearningProgressDocumentRepository(
  database: DocumentDatabasePort,
): LearningProgressRepository {
  return new LearningProgressDocumentRepository(database);
}

class LearningProgressDocumentRepository implements LearningProgressRepository {
  public constructor(private readonly database: DocumentDatabasePort) {}

  public async findResource(organizationId: string, resourceId: string, studentId?: string): Promise<LearningResourceAccessRecord | null> {
    return this.read((reader) => new LearningProgressDocumentReader(reader).findResource(organizationId, resourceId, studentId));
  }

  public async findReadingProgress(
    organizationId: string,
    studentId: string,
    resourceId: string,
  ): Promise<ReadingProgressRecord | null> {
    return this.read((reader) => new LearningProgressDocumentReader(reader)
      .findReadingProgress(organizationId, studentId, resourceId));
  }

  public async listReadingPageEvents(organizationId: string, studentId: string, resourceId: string): Promise<readonly ReadingPageEventRecord[]> {
    return this.read(reader => new LearningProgressDocumentReader(reader).listReadingPageEvents(organizationId, studentId, resourceId));
  }

  public async findVocabularyProgress(
    organizationId: string,
    studentId: string,
    packId: string,
  ): Promise<VocabularyProgressRecord | null> {
    return this.read((reader) => new LearningProgressDocumentReader(reader)
      .findVocabularyProgress(organizationId, studentId, packId));
  }

  public async runTransaction<T>(
    work: (transaction: LearningProgressTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.runTransaction(async (documents) => work(
        new LearningProgressDocumentTransaction(documents),
      ));
    } catch (error: unknown) {
      throw toLearningProgressPersistenceError(error);
    }
  }

  public async appendAudit(record: LearningProgressAuditRecord): Promise<void> {
    try {
      await this.database.runTransaction(async (documents) => {
        await appendAudit(documents, record);
      });
    } catch (error: unknown) {
      throw toLearningProgressPersistenceError(error);
    }
  }

  private async read<T>(work: (reader: DocumentDatabaseReaderPort) => Promise<T>): Promise<T> {
    try {
      return await work(this.database);
    } catch (error: unknown) {
      throw toLearningProgressPersistenceError(error);
    }
  }
}

class LearningProgressDocumentReader {
  public constructor(protected readonly documents: Pick<DocumentDatabaseReaderPort, 'get' | 'find'>) {}

  public async findResource(
    organizationId: string,
    resourceId: string,
    studentId?: string,
  ): Promise<LearningResourceAccessRecord | null> {
    const document = await this.documents.get(LEARNING_PROGRESS_COLLECTIONS.resources, resourceId);
    if (!isVisible(document, organizationId)) return null;
    const resource = decodeResource(document);
    if (document.allowedStudentIds !== undefined || studentId === undefined) return resource;
    const visibility = requireObject(document.visibility);
    const visibilityType = requireEnum(visibility.type, ['organization', 'classes'] as const);
    const classIds = visibilityType === 'classes' ? requireStringArray(visibility.classIds) : [];
    const memberships = await this.documents.find(LEARNING_PROGRESS_COLLECTIONS.memberships, {
      organizationId, studentId, status: 'active', deletedAt: null,
    });
    const authorized = memberships.some(membership => isVisible(membership, organizationId)
      && typeof membership.classId === 'string'
      && (visibilityType === 'organization' || classIds.includes(membership.classId)));
    return { ...resource, allowedStudentIds: authorized ? [studentId] : [] };
  }

  public async findReadingProgress(
    organizationId: string,
    studentId: string,
    resourceId: string,
  ): Promise<ReadingProgressRecord | null> {
    const document = await this.documents.get(
      LEARNING_PROGRESS_COLLECTIONS.reading,
      readingProgressDocumentId(organizationId, studentId, resourceId),
    );
    if (!isVisible(document, organizationId)) return null;
    const record = decodeReadingProgress(document);
    return record.studentId === studentId && record.resourceId === resourceId ? record : null;
  }

  public async listReadingPageEvents(organizationId: string, studentId: string, resourceId: string): Promise<readonly ReadingPageEventRecord[]> {
    const documents = await this.documents.find(LEARNING_PROGRESS_COLLECTIONS.readingPageEvents, {
      organizationId, studentId, resourceId, deletedAt: null,
    });
    return documents.filter(document => isVisible(document, organizationId)).map(decodeReadingPageEvent)
      .sort((left, right) => left.visitedAt.localeCompare(right.visitedAt) || left.id.localeCompare(right.id));
  }

  public async findVocabularyProgress(
    organizationId: string,
    studentId: string,
    packId: string,
  ): Promise<VocabularyProgressRecord | null> {
    const document = await this.documents.get(
      LEARNING_PROGRESS_COLLECTIONS.vocabulary,
      vocabularyProgressDocumentId(organizationId, studentId, packId),
    );
    if (!isVisible(document, organizationId)) return null;
    const record = decodeVocabularyProgress(document);
    return record.studentId === studentId && record.packId === packId ? record : null;
  }
}

class LearningProgressDocumentTransaction extends LearningProgressDocumentReader implements LearningProgressTransaction {
  public constructor(private readonly transaction: DocumentDatabaseTransactionPort) {
    super(transaction);
  }

  public async findOperation(recordId: string): Promise<LearningProgressOperationRecord | null> {
    const document = await this.transaction.get(
      LEARNING_PROGRESS_COLLECTIONS.idempotency,
      operationDocumentId(recordId),
    );
    if (document === null || document.deletedAt !== null) return null;
    const operation = decodeOperation(document);
    if (operation.id !== recordId) throw new LearningProgressError('INTERNAL_ERROR');
    return operation;
  }

  public async saveReadingProgress(record: ReadingProgressRecord): Promise<void> {
    await saveProgress(
      this.transaction,
      LEARNING_PROGRESS_COLLECTIONS.reading,
      readingProgressDocumentId(record.organizationId, record.studentId, record.resourceId),
      record,
      (document) => decodeReadingProgress(document),
      (current) => current.studentId === record.studentId && current.resourceId === record.resourceId,
    );
  }

  public async appendReadingPageEvent(record: ReadingPageEventRecord): Promise<void> {
    if (!(await this.transaction.create(LEARNING_PROGRESS_COLLECTIONS.readingPageEvents,
      createDocument(record.id, record.organizationId, 1, record)))) throw new LearningProgressError('CONFLICT');
  }

  public async saveVocabularyProgress(record: VocabularyProgressRecord): Promise<void> {
    await saveProgress(
      this.transaction,
      LEARNING_PROGRESS_COLLECTIONS.vocabulary,
      vocabularyProgressDocumentId(record.organizationId, record.studentId, record.packId),
      record,
      (document) => decodeVocabularyProgress(document),
      (current) => current.studentId === record.studentId && current.packId === record.packId,
    );
  }

  public async saveOperation(record: LearningProgressOperationRecord): Promise<void> {
    const idempotencyRecord = {
      id: record.id,
      organizationId: record.organizationId,
      actorUserId: record.studentId,
      functionName: 'learning-progress-command',
      action: record.action,
      operationId: record.operationId,
      requestHash: record.fingerprint,
      status: 'succeeded',
      safeResult: record.result,
    };
    const document = createDocument(
      operationDocumentId(record.id),
      record.organizationId,
      1,
      idempotencyRecord,
    );
    if (!(await this.transaction.create(LEARNING_PROGRESS_COLLECTIONS.idempotency, document))) {
      throw new LearningProgressError('CONFLICT');
    }
  }

  public async appendAudit(record: LearningProgressAuditRecord): Promise<void> {
    await appendAudit(this.transaction, record);
  }
}

async function saveProgress<T extends ReadingProgressRecord | VocabularyProgressRecord>(
  transaction: DocumentDatabaseTransactionPort,
  collection: string,
  documentId: string,
  record: T,
  decode: (document: VersionedDocument) => T,
  matchesUniqueKey: (current: T) => boolean,
): Promise<void> {
  const currentDocument = await transaction.get(collection, documentId);
  if (currentDocument === null) {
    if (record.version !== 1) throw new LearningProgressError('CONFLICT');
    const created = await transaction.create(collection, createDocument(
      documentId,
      record.organizationId,
      record.version,
      record,
    ));
    if (!created) throw new LearningProgressError('CONFLICT');
    return;
  }
  if (!isVisible(currentDocument, record.organizationId)) throw new LearningProgressError('CONFLICT');
  const current = decode(currentDocument);
  if (!matchesUniqueKey(current) || record.version !== currentDocument.version + 1) {
    throw new LearningProgressError('CONFLICT');
  }
  const replaced = await transaction.replace(
    collection,
    documentId,
    currentDocument.version,
    createDocument(documentId, record.organizationId, record.version, record),
  );
  if (!replaced) throw new LearningProgressError('CONFLICT');
}

async function appendAudit(
  transaction: DocumentDatabaseTransactionPort,
  record: LearningProgressAuditRecord,
): Promise<void> {
  const documentId = auditDocumentId(record.organizationId, record.requestId);
  const operationLog = {
    id: record.id,
    requestId: record.requestId,
    organizationId: record.organizationId,
    actorUserId: record.actorUserId,
    actorRole: record.actorRole,
    action: record.action,
    targetType: record.action === 'reading_progress.saved' ? 'reading_progress' : 'vocabulary_progress',
    targetId: record.targetId,
    result: record.result,
    errorCode: record.reason ?? null,
    metadata: {},
    occurredAt: record.occurredAt,
  };
  const appended = await transaction.append(
    LEARNING_PROGRESS_COLLECTIONS.audit,
    createDocument(documentId, record.organizationId, 1, operationLog),
  );
  if (!appended) throw new LearningProgressError('CONFLICT');
}

export function readingProgressDocumentId(
  organizationId: string,
  studentId: string,
  resourceId: string,
): string {
  return `reading-progress:${organizationId}:${studentId}:${resourceId}`;
}

export function vocabularyProgressDocumentId(
  organizationId: string,
  studentId: string,
  packId: string,
): string {
  return `vocabulary-progress:${organizationId}:${studentId}:${packId}`;
}

export function operationDocumentId(recordId: string): string {
  return `learning-progress-operation:${recordId}`;
}

export function auditDocumentId(organizationId: string, requestId: string): string {
  return `audit:${organizationId}:${requestId}`;
}

function decodeResource(document: VersionedDocument): LearningResourceAccessRecord {
  const type = requireEnum(document.type, ['reading', 'vocabulary'] as const);
  const status = document.status === 'draft' ? 'offline'
    : requireEnum(document.status, ['published', 'offline'] as const);
  const allowedStudentIds = document.allowedStudentIds === undefined ? [] : requireStringArray(document.allowedStudentIds);
  const legacyPayload = document.payload === undefined ? null : requireObject(document.payload);
  const rawContentVersion = document.contentVersion;
  const contentVersion = typeof rawContentVersion === 'string' && rawContentVersion.trim()
    ? rawContentVersion : typeof rawContentVersion === 'number' && Number.isSafeInteger(rawContentVersion)
      && rawContentVersion > 0 ? String(rawContentVersion) : undefined;
  const chapterPages = document.pages !== undefined
    || (legacyPayload?.demoOnly === true && legacyPayload.pages !== undefined)
    || legacyPayload?.chapters === undefined ? undefined
    : requireObjectArray(legacyPayload.chapters).flatMap(chapter => requireObjectArray(chapter.pages)
      .map(page => ({ ...page, chapterId: chapter.id })));
  const rawPages = document.pages ?? (legacyPayload?.demoOnly === true ? legacyPayload.pages : undefined)
    ?? chapterPages ?? (type === 'vocabulary' ? [] : undefined);
  const pages = requireObjectArray(rawPages).map((page) => ({
    id: requireString(page.id),
    chapterId: requireString(page.chapterId),
    pageNumber: requireNonNegativeInteger(page.pageNumber),
  }));
  return {
    id: readDomainId(document),
    organizationId: document.organizationId,
    type,
    status,
    ...(contentVersion === undefined ? {} : { contentVersion }),
    allowedStudentIds,
    pages,
    wordIds: document.wordIds === undefined && type === 'reading' ? []
      : requireStringArray(document.wordIds ?? (legacyPayload?.words === undefined ? undefined
        : requireObjectArray(legacyPayload.words).map(word => requireString(word.id)))),
  };
}

function decodeReadingProgress(document: VersionedDocument): ReadingProgressRecord {
  return {
    id: readDomainId(document),
    organizationId: document.organizationId,
    studentId: requireString(document.studentId),
    resourceId: requireString(document.resourceId),
    chapterId: requireString(document.chapterId),
    pageId: requireString(document.pageId),
    pageNumber: requireNonNegativeInteger(document.pageNumber),
    favorite: requireBoolean(document.favorite),
    version: document.version,
    updatedAt: requireString(document.updatedAt),
  };
}

function decodeReadingPageEvent(document: VersionedDocument): ReadingPageEventRecord {
  const pageNumber = requireNonNegativeInteger(document.pageNumber);
  const progressVersion = requireNonNegativeInteger(document.progressVersion);
  if (pageNumber < 1 || progressVersion < 1) throw new LearningProgressError('INTERNAL_ERROR');
  if (document.contentVersion !== null && (typeof document.contentVersion !== 'string'
    || !document.contentVersion.trim())) throw new LearningProgressError('INTERNAL_ERROR');
  return { id: readDomainId(document), organizationId: document.organizationId,
    studentId: requireString(document.studentId), resourceId: requireString(document.resourceId),
    chapterId: requireString(document.chapterId), pageId: requireString(document.pageId),
    pageNumber, progressVersion, contentVersion: document.contentVersion,
    operationId: requireString(document.operationId),
    visitedAt: requireString(document.visitedAt) };
}

function decodeVocabularyProgress(document: VersionedDocument): VocabularyProgressRecord {
  return {
    id: readDomainId(document),
    organizationId: document.organizationId,
    studentId: requireString(document.studentId),
    packId: requireString(document.packId),
    completedCount: requireNonNegativeInteger(document.completedCount),
    correctCount: requireNonNegativeInteger(document.correctCount),
    correctRate: requireFiniteNumber(document.correctRate),
    wrongWordIds: requireStringArray(document.wrongWordIds),
    version: document.version,
    updatedAt: requireString(document.updatedAt),
  };
}

function decodeOperation(document: VersionedDocument): LearningProgressOperationRecord {
  if (document.functionName !== 'learning-progress-command' || document.status !== 'succeeded') {
    throw new LearningProgressError('INTERNAL_ERROR');
  }
  const result = requireObject(document.safeResult);
  const operation: LearningProgressOperationRecord = {
    id: readDomainId(document),
    organizationId: document.organizationId,
    studentId: requireString(document.actorUserId),
    action: requireEnum(document.action, ['saveReadingProgress', 'saveVocabularyProgress'] as const),
    operationId: requireString(document.operationId),
    fingerprint: requireString(document.requestHash),
    result: 'wrongWordIds' in result
      ? decodeVocabularyView(result)
      : decodeReadingView(result),
  };
  if (`${operation.organizationId}:${operation.studentId}:${operation.operationId}` !== operation.id) {
    throw new LearningProgressError('INTERNAL_ERROR');
  }
  return cloneJson(toJsonValue(operation)) as unknown as LearningProgressOperationRecord;
}

function decodeReadingView(value: Readonly<Record<string, JsonValue>>) {
  return {
    id: requireString(value.id),
    resourceId: requireString(value.resourceId),
    chapterId: requireString(value.chapterId),
    pageId: requireString(value.pageId),
    pageNumber: requireNonNegativeInteger(value.pageNumber),
    favorite: requireBoolean(value.favorite),
    version: requireNonNegativeInteger(value.version),
    updatedAt: requireString(value.updatedAt),
  };
}

function decodeVocabularyView(value: Readonly<Record<string, JsonValue>>) {
  return {
    id: requireString(value.id),
    packId: requireString(value.packId),
    completedCount: requireNonNegativeInteger(value.completedCount),
    correctCount: requireNonNegativeInteger(value.correctCount),
    correctRate: requireFiniteNumber(value.correctRate),
    wrongWordIds: requireStringArray(value.wrongWordIds),
    version: requireNonNegativeInteger(value.version),
    updatedAt: requireString(value.updatedAt),
  };
}

function createDocument(
  documentId: string,
  organizationId: string,
  version: number,
  record: unknown,
): VersionedDocument {
  if (documentId.length === 0 || organizationId.length === 0 || !Number.isSafeInteger(version) || version < 1) {
    throw new LearningProgressError('INTERNAL_ERROR');
  }
  const encoded = toJsonObject(record);
  return cloneJson({
    ...encoded,
    _id: documentId,
    organizationId,
    schemaVersion: 1,
    version,
    deletedAt: null,
  }) as VersionedDocument;
}

function readDomainId(document: VersionedDocument): string {
  const id = document.id;
  return typeof id === 'string' && id.length > 0 ? id : document._id;
}

function isVisible(
  document: VersionedDocument | null,
  organizationId: string,
): document is VersionedDocument {
  return document !== null && document.organizationId === organizationId && document.deletedAt === null;
}

function requireString(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new LearningProgressError('INTERNAL_ERROR');
  return value;
}

function requireBoolean(value: JsonValue | undefined): boolean {
  if (typeof value !== 'boolean') throw new LearningProgressError('INTERNAL_ERROR');
  return value;
}

function requireFiniteNumber(value: JsonValue | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new LearningProgressError('INTERNAL_ERROR');
  return value;
}

function requireNonNegativeInteger(value: JsonValue | undefined): number {
  const number = requireFiniteNumber(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new LearningProgressError('INTERNAL_ERROR');
  return number;
}

function requireStringArray(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new LearningProgressError('INTERNAL_ERROR');
  }
  return [...value] as string[];
}

function requireObject(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningProgressError('INTERNAL_ERROR');
  }
  return cloneJson(value) as unknown as Readonly<Record<string, JsonValue>>;
}

function requireObjectArray(value: JsonValue | undefined): readonly Readonly<Record<string, JsonValue>>[] {
  if (!Array.isArray(value)) throw new LearningProgressError('INTERNAL_ERROR');
  return value.map((item) => requireObject(item));
}

function requireEnum<T extends string>(value: JsonValue | undefined, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new LearningProgressError('INTERNAL_ERROR');
  }
  return value as T;
}

function toJsonObject(value: unknown): Readonly<Record<string, JsonValue>> {
  const encoded = toJsonValue(value);
  if (encoded === null || typeof encoded !== 'object' || Array.isArray(encoded)) {
    throw new LearningProgressError('INTERNAL_ERROR');
  }
  return encoded as Readonly<Record<string, JsonValue>>;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new LearningProgressError('INTERNAL_ERROR');
    return value;
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = toJsonValue(item);
    }
    return result;
  }
  throw new LearningProgressError('INTERNAL_ERROR');
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function toLearningProgressPersistenceError(error: unknown): LearningProgressError {
  if (error instanceof LearningProgressError) return error;
  if (error instanceof DocumentDatabasePlatformError) {
    if (error.kind === 'conflict') return new LearningProgressError('CONFLICT');
    if (error.kind === 'unavailable') return new LearningProgressError('SERVICE_UNAVAILABLE');
  }
  return new LearningProgressError('INTERNAL_ERROR');
}
