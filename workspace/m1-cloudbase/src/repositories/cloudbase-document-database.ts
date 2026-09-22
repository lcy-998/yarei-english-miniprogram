import type { JsonValue } from '../shared/protocol';
import {
  DocumentDatabasePlatformError,
  type DocumentData,
  type DocumentDatabaseFailureKind,
  type DocumentDatabasePort,
  type DocumentDatabaseTransactionPort,
  type VersionedDocument,
} from './document-database-port';

interface CloudBaseGetResult {
  readonly data?: unknown;
}

interface CloudBaseDocumentReferencePort {
  get(): Promise<CloudBaseGetResult>;
  create?(input: DocumentData): Promise<unknown>;
  set(input: DocumentData): Promise<unknown>;
  remove(): Promise<unknown>;
}

interface CloudBaseQueryPort {
  orderBy(field: string, direction: 'asc' | 'desc'): CloudBaseQueryPort;
  limit(size: number): CloudBaseQueryPort;
  skip(offset: number): CloudBaseQueryPort;
  get(): Promise<CloudBaseGetResult>;
}

interface CloudBaseCollectionPort {
  doc(documentId: string): CloudBaseDocumentReferencePort;
  where(criteria: DocumentData): CloudBaseQueryPort;
}

export interface CloudBaseNativeTransactionPort {
  collection(name: string): CloudBaseCollectionPort;
}

export interface CloudBaseNativeDatabasePort extends CloudBaseNativeTransactionPort {
  runTransaction<T>(work: (transaction: CloudBaseNativeTransactionPort) => Promise<T>): Promise<T>;
}

export interface CloudBaseDocumentDatabaseOptions {
  /** CloudBase server queries are paged; keep this at or below the SDK limit. */
  readonly pageSize?: number;
  /** Safety bound preventing an accidental unbounded collection scan. */
  readonly maxPages?: number;
}

export function createCloudBaseDocumentDatabase(
  database: CloudBaseNativeDatabasePort,
  options: CloudBaseDocumentDatabaseOptions = {},
): DocumentDatabasePort {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('CloudBase document pageSize must be an integer between 1 and 100.');
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('CloudBase document maxPages must be a positive integer.');
  }
  return new CloudBaseDocumentDatabase(database, pageSize, maxPages);
}

class CloudBaseDocumentDatabase implements DocumentDatabasePort {
  public constructor(
    private readonly database: CloudBaseNativeDatabasePort,
    private readonly pageSize: number,
    private readonly maxPages: number,
  ) {}

  public async get(collection: string, documentId: string): Promise<VersionedDocument | null> {
    return readDocument(this.database, collection, documentId);
  }

  public async find(collection: string, criteria: DocumentData): Promise<readonly VersionedDocument[]> {
    return readDocuments(this.database, collection, criteria, this.pageSize, this.maxPages);
  }

  public async runTransaction<T>(
    work: (transaction: DocumentDatabaseTransactionPort) => Promise<T>,
  ): Promise<T> {
    let workFailed = false;
    let workFailure: unknown;
    try {
      return await this.database.runTransaction(async (nativeTransaction) => {
        // Some SDKs retry transaction callbacks. Only preserve a failure from
        // the latest attempt so a later commit error is never misclassified.
        workFailed = false;
        workFailure = undefined;
        try {
          return await work(new CloudBaseDocumentTransaction(nativeTransaction, this.pageSize, this.maxPages));
        } catch (error: unknown) {
          workFailed = true;
          workFailure = error;
          throw error;
        }
      });
    } catch (error: unknown) {
      // Preserve domain/persistence failures raised by the callback. Only native
      // start/commit/rollback failures are converted into the database boundary.
      if (workFailed) throw workFailure;
      throw toPlatformError('transaction', error);
    }
  }
}

class CloudBaseDocumentTransaction implements DocumentDatabaseTransactionPort {
  private readonly pending = new Map<string, VersionedDocument>();

  public constructor(
    private readonly transaction: CloudBaseNativeTransactionPort,
    private readonly pageSize: number,
    private readonly maxPages: number,
  ) {}

  public async get(collection: string, documentId: string): Promise<VersionedDocument | null> {
    const pending = this.pending.get(pendingKey(collection, documentId));
    if (pending !== undefined) return cloneDocumentData(pending) as VersionedDocument;
    return readDocument(this.transaction, collection, documentId);
  }

  public async find(collection: string, criteria: DocumentData): Promise<readonly VersionedDocument[]> {
    return readDocuments(this.transaction, collection, criteria, this.pageSize, this.maxPages);
  }

  public async create(collection: string, document: VersionedDocument): Promise<boolean> {
    try {
      await createDocument(this.transaction, collection, document._id, document);
      this.pending.set(pendingKey(collection, document._id), cloneDocumentData(document) as VersionedDocument);
      return true;
    } catch (error: unknown) {
      if (error instanceof DocumentDatabasePlatformError && error.kind === 'conflict') return false;
      throw error;
    }
  }

  public async replace(
    collection: string,
    documentId: string,
    expectedVersion: number,
    document: VersionedDocument,
  ): Promise<boolean> {
    const current = await this.get(collection, documentId);
    if (current === null || current.version !== expectedVersion || document._id !== documentId) return false;
    await writeDocument(this.transaction, collection, documentId, document);
    this.pending.set(pendingKey(collection, documentId), cloneDocumentData(document) as VersionedDocument);
    return true;
  }

  public async delete(collection: string, documentId: string, expectedVersion: number): Promise<boolean> {
    const current = await this.get(collection, documentId);
    if (current === null || current.version !== expectedVersion) return false;
    await executeSdkOperation('delete', async () => this.transaction.collection(collection).doc(documentId).remove());
    this.pending.delete(pendingKey(collection, documentId));
    return true;
  }

  public async append(collection: string, document: VersionedDocument): Promise<boolean> {
    return this.create(collection, document);
  }
}

function pendingKey(collection: string, documentId: string): string {
  return `${collection}\u0000${documentId}`;
}

async function readDocuments(
  database: CloudBaseNativeTransactionPort,
  collection: string,
  criteria: DocumentData,
  pageSize: number,
  maxPages: number,
): Promise<readonly VersionedDocument[]> {
  const documents: VersionedDocument[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const data = await executeSdkOperation('find', async () => database
      .collection(collection)
      .where(cloneDocumentData(criteria))
      .orderBy('_id', 'asc')
      .limit(pageSize)
      .skip(page * pageSize)
      .get());
    const rows = readResultRows(data);
    documents.push(...rows.map(decodeVersionedDocument));
    if (rows.length < pageSize) return documents;
  }
  throw new DocumentDatabasePlatformError(
    'invalid-data',
    'CloudBase find exceeded the configured page safety bound.',
  );
}

async function readDocument(
  database: CloudBaseNativeTransactionPort,
  collection: string,
  documentId: string,
): Promise<VersionedDocument | null> {
  let result: CloudBaseGetResult;
  try {
    result = await database.collection(collection).doc(documentId).get();
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null;
    throw toPlatformError('get', error);
  }
  const value = normalizeCloudBaseData(result.data);
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length !== 1) throw invalidDocumentError('CloudBase document get returned multiple rows.');
    return decodeVersionedDocument(value[0]);
  }
  if (isPlainObject(value) && Array.isArray(value.list)) {
    if (value.list.length === 0) return null;
    if (value.list.length !== 1) throw invalidDocumentError('CloudBase document get returned multiple rows.');
    return decodeVersionedDocument(value.list[0]);
  }
  return decodeVersionedDocument(value);
}

async function createDocument(
  database: CloudBaseNativeTransactionPort,
  collection: string,
  documentId: string,
  document: VersionedDocument,
): Promise<void> {
  const { _id: storedDocumentId, ...fields } = cloneDocumentData(document);
  if (storedDocumentId !== documentId) {
    throw invalidDocumentError('CloudBase document ID does not match the document reference.');
  }
  const reference = database.collection(collection).doc(documentId);
  await executeSdkOperation('create', async () => (typeof reference.create === 'function'
    ? reference.create(fields)
    : reference.set(fields)));
}

async function writeDocument(
  database: CloudBaseNativeTransactionPort,
  collection: string,
  documentId: string,
  document: VersionedDocument,
): Promise<void> {
  const { _id: storedDocumentId, ...fields } = cloneDocumentData(document);
  if (storedDocumentId !== documentId) {
    throw invalidDocumentError('CloudBase document ID does not match the document reference.');
  }
  await executeSdkOperation('write', async () => database
    .collection(collection)
    .doc(documentId)
    .set(fields));
}

async function executeSdkOperation<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    throw toPlatformError(operation, error);
  }
}

function readResultRows(result: CloudBaseGetResult): readonly unknown[] {
  const value = normalizeCloudBaseData(result.data);
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (isPlainObject(value) && Array.isArray(value.list)) return value.list;
  throw invalidDocumentError('CloudBase query returned a non-array payload.');
}

function decodeVersionedDocument(value: unknown): VersionedDocument {
  if (!isPlainObject(value)) throw invalidDocumentError('CloudBase document is not a plain object.');
  if (typeof value._id !== 'string' || value._id.length === 0
    || typeof value.organizationId !== 'string' || value.organizationId.length === 0
    || value.schemaVersion !== 1
    || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1
    || (value.deletedAt !== null && typeof value.deletedAt !== 'string')) {
    throw invalidDocumentError('CloudBase document does not match the versioned schema.');
  }
  return cloneDocumentData(value as DocumentData) as VersionedDocument;
}

function normalizeCloudBaseData(value: unknown): unknown {
  if (typeof value !== 'string') return normalizeExtendedJson(value);
  try {
    return normalizeExtendedJson(JSON.parse(value) as unknown);
  } catch {
    return value;
  }
}

function normalizeExtendedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeExtendedJson);
  if (!isPlainObject(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1) {
    const [key] = keys;
    const raw = value[key];
    if ((key === '$numberInt' || key === '$numberLong' || key === '$numberDouble') && typeof raw === 'string') {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : value;
    }
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeExtendedJson(item)]));
}

function cloneDocumentData(value: DocumentData): DocumentData {
  return cloneJson(value) as DocumentData;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function invalidDocumentError(message: string): DocumentDatabasePlatformError {
  return new DocumentDatabasePlatformError('invalid-data', message);
}

function isNotFoundError(error: unknown): boolean {
  const code = readErrorCode(error).toLowerCase();
  return code.includes('not_found')
    || code.includes('notfound')
    || code.includes('not_exist')
    || code.includes('notexist')
    || code.includes('not exists')
    || code.includes('not_existed')
    || code.includes('document_not_found')
    || code.includes('document_not_exist');
}

function toPlatformError(operation: string, error: unknown): DocumentDatabasePlatformError {
  if (error instanceof DocumentDatabasePlatformError) return error;
  const code = readErrorCode(error);
  const kind = mapFailureKind(code);
  const safeCode = /^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : 'unknown';
  return new DocumentDatabasePlatformError(kind, `CloudBase ${operation} failed (${safeCode}).`, error);
}

function mapFailureKind(code: string): DocumentDatabaseFailureKind {
  const normalized = code.toLowerCase();
  if (normalized.includes('timeout') || normalized.includes('network') || normalized.includes('unavailable') || normalized.includes('limit')) {
    return 'unavailable';
  }
  if (normalized.includes('conflict') || normalized.includes('duplicate') || normalized.includes('transaction')) {
    return 'conflict';
  }
  if (normalized.includes('invalid') || normalized.includes('parameter')) return 'invalid-data';
  return 'internal';
}

function readErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const record = error as Readonly<Record<string, unknown>>;
  const candidates = [record.errCode, record.code, record.errorCode];
  const found = candidates.find((candidate) => typeof candidate === 'string' || typeof candidate === 'number');
  return found === undefined ? 'unknown' : String(found);
}
