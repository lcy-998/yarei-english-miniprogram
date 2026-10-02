import type { JsonValue } from '../shared/protocol';
import {
  DocumentDatabasePlatformError,
  type DocumentData,
  type DocumentDatabaseFailureKind,
  type DocumentDatabasePort,
  type DocumentDatabaseTransactionPort,
  type VersionedDocument,
} from './document-database-port';

export type FakeDocumentOperation = 'get' | 'find' | 'create' | 'replace' | 'delete' | 'append' | 'commit';

export interface FakeDocumentFailure {
  readonly operation: FakeDocumentOperation;
  readonly collection?: string;
  readonly kind: DocumentDatabaseFailureKind;
  readonly diagnosticMessage?: string;
}

/** Local contract double; it never imports an SDK or environment identifier. */
export class FakeDocumentDatabase implements DocumentDatabasePort {
  private collections: Map<string, Map<string, VersionedDocument>>;
  private transactionTail: Promise<void> = Promise.resolve();
  private nextFailure: FakeDocumentFailure | null = null;
  private transactionFindCount = 0;

  public constructor(seed: Readonly<Record<string, readonly VersionedDocument[]>> = {}) {
    this.collections = createCollections(seed);
  }

  public failNext(failure: FakeDocumentFailure): void {
    this.nextFailure = { ...failure };
  }

  public get observedTransactionFindCount(): number {
    return this.transactionFindCount;
  }

  public async get(collection: string, documentId: string): Promise<VersionedDocument | null> {
    this.throwIfArmed('get', collection);
    return cloneOptional(this.collections.get(collection)?.get(documentId) ?? null);
  }

  public async find(collection: string, criteria: DocumentData): Promise<readonly VersionedDocument[]> {
    this.throwIfArmed('find', collection);
    return [...(this.collections.get(collection)?.values() ?? [])]
      .filter((document) => matches(document, criteria))
      .map(cloneDocument);
  }

  public async findPage(collection: string, criteria: DocumentData, page: Readonly<{ limit: number; offset: number }>): Promise<Readonly<{
    items: readonly VersionedDocument[];
    hasMore: boolean;
  }>> {
    validatePage(page);
    this.throwIfArmed('find', collection);
    const matching = [...(this.collections.get(collection)?.values() ?? [])]
      .filter((document) => matches(document, criteria))
      .sort((left, right) => left._id < right._id ? -1 : left._id > right._id ? 1 : 0);
    return {
      items: matching.slice(page.offset, page.offset + page.limit).map(cloneDocument),
      hasMore: matching.length > page.offset + page.limit,
    };
  }

  public async runTransaction<T>(work: (transaction: DocumentDatabaseTransactionPort) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const working = cloneCollections(this.collections);
    const transaction = new FakeDocumentTransaction(working, (operation, collection) => {
      if (operation === 'find') this.transactionFindCount += 1;
      this.throwIfArmed(operation, collection);
    });
    try {
      const result = await work(transaction);
      this.throwIfArmed('commit');
      this.collections = working;
      return result;
    } finally {
      release();
    }
  }

  public snapshot(): Readonly<Record<string, readonly VersionedDocument[]>> {
    return Object.fromEntries([...this.collections.entries()].map(([collection, documents]) => [
      collection,
      [...documents.values()].map(cloneDocument),
    ]));
  }

  private throwIfArmed(operation: FakeDocumentOperation, collection?: string): void {
    const failure = this.nextFailure;
    if (failure === null || failure.operation !== operation) return;
    if (failure.collection !== undefined && failure.collection !== collection) return;
    this.nextFailure = null;
    throw new DocumentDatabasePlatformError(
      failure.kind,
      failure.diagnosticMessage ?? `simulated ${operation} failure`,
    );
  }
}

function validatePage(page: Readonly<{ limit: number; offset: number }>): void {
  if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
    || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 10000) {
    throw new DocumentDatabasePlatformError('invalid-data', 'Invalid document page request.');
  }
}

class FakeDocumentTransaction implements DocumentDatabaseTransactionPort {
  public constructor(
    private readonly collections: Map<string, Map<string, VersionedDocument>>,
    private readonly beforeOperation: (operation: FakeDocumentOperation, collection?: string) => void,
  ) {}

  public async get(collection: string, documentId: string): Promise<VersionedDocument | null> {
    this.beforeOperation('get', collection);
    return cloneOptional(this.collections.get(collection)?.get(documentId) ?? null);
  }

  public async find(collection: string, criteria: DocumentData): Promise<readonly VersionedDocument[]> {
    this.beforeOperation('find', collection);
    return [...(this.collections.get(collection)?.values() ?? [])]
      .filter((document) => matches(document, criteria))
      .map(cloneDocument);
  }

  public async create(collection: string, document: VersionedDocument): Promise<boolean> {
    this.beforeOperation('create', collection);
    const documents = getOrCreateCollection(this.collections, collection);
    if (documents.has(document._id)) return false;
    documents.set(document._id, cloneDocument(document));
    return true;
  }

  public async replace(
    collection: string,
    documentId: string,
    expectedVersion: number,
    document: VersionedDocument,
  ): Promise<boolean> {
    this.beforeOperation('replace', collection);
    const documents = getOrCreateCollection(this.collections, collection);
    const current = documents.get(documentId);
    if (current === undefined || current.version !== expectedVersion || document._id !== documentId) return false;
    documents.set(documentId, cloneDocument(document));
    return true;
  }

  public async append(collection: string, document: VersionedDocument): Promise<boolean> {
    this.beforeOperation('append', collection);
    const documents = getOrCreateCollection(this.collections, collection);
    if (documents.has(document._id)) return false;
    documents.set(document._id, cloneDocument(document));
    return true;
  }

  public async delete(collection: string, documentId: string, expectedVersion: number): Promise<boolean> {
    this.beforeOperation('delete', collection);
    const documents = getOrCreateCollection(this.collections, collection);
    const current = documents.get(documentId);
    if (current === undefined || current.version !== expectedVersion) return false;
    documents.delete(documentId);
    return true;
  }
}

function createCollections(seed: Readonly<Record<string, readonly VersionedDocument[]>>): Map<string, Map<string, VersionedDocument>> {
  return new Map(Object.entries(seed).map(([collection, documents]) => [
    collection,
    new Map(documents.map((document) => [document._id, cloneDocument(document)])),
  ]));
}

function cloneCollections(
  source: Map<string, Map<string, VersionedDocument>>,
): Map<string, Map<string, VersionedDocument>> {
  return new Map([...source.entries()].map(([collection, documents]) => [
    collection,
    new Map([...documents.entries()].map(([documentId, document]) => [documentId, cloneDocument(document)])),
  ]));
}

function getOrCreateCollection(
  collections: Map<string, Map<string, VersionedDocument>>,
  collection: string,
): Map<string, VersionedDocument> {
  const current = collections.get(collection);
  if (current !== undefined) return current;
  const created = new Map<string, VersionedDocument>();
  collections.set(collection, created);
  return created;
}

function matches(document: VersionedDocument, criteria: DocumentData): boolean {
  return Object.entries(criteria).every(([field, expected]) => equalJson(document[field], expected));
}

function equalJson(left: JsonValue | undefined, right: JsonValue): boolean {
  if (left === undefined) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => equalJson(value, right[index]));
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);
    return leftEntries.length === rightEntries.length
      && rightEntries.every(([key, value]) => equalJson(left[key], value));
  }
  return left === right;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneOptional(document: VersionedDocument | null): VersionedDocument | null {
  return document === null ? null : cloneDocument(document);
}

function cloneDocument(document: VersionedDocument): VersionedDocument {
  return cloneJson(document) as VersionedDocument;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}
