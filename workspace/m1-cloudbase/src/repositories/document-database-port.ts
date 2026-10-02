import type { JsonValue } from '../shared/protocol';

export type DocumentData = Readonly<Record<string, JsonValue>>;

export type VersionedDocument = DocumentData & Readonly<{
  _id: string;
  organizationId: string;
  schemaVersion: 1;
  version: number;
  deletedAt: string | null;
}>;

export interface DocumentDatabaseReaderPort {
  get(collection: string, documentId: string): Promise<VersionedDocument | null>;
  find(collection: string, criteria: DocumentData): Promise<readonly VersionedDocument[]>;
}

/**
 * A transaction-scoped document handle. A future CloudBase SDK bridge must bind
 * every method on this object to the same native transaction instance.
 */
export interface DocumentDatabaseTransactionPort {
  get(collection: string, documentId: string): Promise<VersionedDocument | null>;
  find(collection: string, criteria: DocumentData): Promise<readonly VersionedDocument[]>;
  create(collection: string, document: VersionedDocument): Promise<boolean>;
  replace(
    collection: string,
    documentId: string,
    expectedVersion: number,
    document: VersionedDocument,
  ): Promise<boolean>;
  delete(collection: string, documentId: string, expectedVersion: number): Promise<boolean>;
  append(collection: string, document: VersionedDocument): Promise<boolean>;
}

/** The only document database dependency required by repository adapters. */
export interface DocumentDatabasePort extends DocumentDatabaseReaderPort {
  /** A bounded, stable _id-ordered page for user-facing directories. */
  findPage(collection: string, criteria: DocumentData, page: Readonly<{ limit: number; offset: number }>): Promise<Readonly<{
    items: readonly VersionedDocument[];
    hasMore: boolean;
  }>>;
  runTransaction<T>(work: (transaction: DocumentDatabaseTransactionPort) => Promise<T>): Promise<T>;
}

export type DocumentDatabaseFailureKind = 'conflict' | 'unavailable' | 'invalid-data' | 'internal';

/**
 * SDK bridges wrap platform failures in this error before crossing into the
 * domain repository. Its message is diagnostic-only and is never exposed.
 */
export class DocumentDatabasePlatformError extends Error {
  public constructor(
    public readonly kind: DocumentDatabaseFailureKind,
    diagnosticMessage: string,
    cause?: unknown,
  ) {
    super(diagnosticMessage);
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause, enumerable: false });
    this.name = 'DocumentDatabasePlatformError';
  }
}
