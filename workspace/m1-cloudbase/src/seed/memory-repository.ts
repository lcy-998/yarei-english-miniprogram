import type { JsonObject } from '../shared/protocol';
import { computeJsonContentHash } from './canonical-json';
import {
  type SeedMigrationRun,
  type SeedRepositoryPort,
  type SeedRepositoryTransaction,
  type SeedStoredDocument,
} from './apply-core';
import { SEED_COLLECTION_ORDER, type SeedCollectionName } from './model';

type DocumentStore = Map<SeedCollectionName, Map<string, SeedStoredDocument>>;

export class MemorySeedRepository implements SeedRepositoryPort {
  private documents: DocumentStore = createDocumentStore();
  private migrationRuns = new Map<string, SeedMigrationRun>();
  private transactionTail: Promise<void> = Promise.resolve();

  public async transaction<T>(operation: (transaction: SeedRepositoryTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const workingDocuments = cloneDocumentStore(this.documents);
    const workingRuns = cloneMigrationRuns(this.migrationRuns);
    try {
      const result = await operation(createTransaction(workingDocuments, workingRuns));
      this.documents = workingDocuments;
      this.migrationRuns = workingRuns;
      return result;
    } finally {
      release();
    }
  }

  public async readMigrationRunSnapshot(seedRunId: string): Promise<SeedMigrationRun | null> {
    return this.getMigrationRun(seedRunId);
  }

  public async listDocumentsBySeedRunIdSnapshot(seedRunId: string): Promise<readonly SeedStoredDocument[]> {
    return this.listDocuments().filter((document) => document.seedRunId === seedRunId);
  }

  public getDocument(collection: SeedCollectionName, id: string): SeedStoredDocument | null {
    const document = this.documents.get(collection)?.get(id);
    return document ? cloneStoredDocument(document) : null;
  }

  public listDocuments(): readonly SeedStoredDocument[] {
    return SEED_COLLECTION_ORDER.flatMap((collection) => [...(this.documents.get(collection)?.values() ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneStoredDocument));
  }

  public getMigrationRun(seedRunId: string): SeedMigrationRun | null {
    const run = this.migrationRuns.get(seedRunId);
    return run ? cloneMigrationRun(run) : null;
  }

  public seedExternalDocument(
    collection: SeedCollectionName,
    document: JsonObject,
    metadata: Readonly<{ seedRunId?: string; seedVersion?: string }> = {},
  ): void {
    const id = typeof document._id === 'string' ? document._id : '';
    if (!id) throw new Error('外部测试文档必须包含字符串 _id。');
    this.documents.get(collection)?.set(id, {
      collection,
      id,
      document: cloneJsonObject(document),
      contentHash: computeJsonContentHash(document),
      ...metadata,
    });
  }

  public replaceDocumentExternally(collection: SeedCollectionName, id: string, document: JsonObject): void {
    const current = this.documents.get(collection)?.get(id);
    if (!current) throw new Error(`文档不存在：${collection}/${id}。`);
    this.documents.get(collection)?.set(id, {
      ...current,
      document: cloneJsonObject(document),
      contentHash: computeJsonContentHash(document),
    });
  }

  public deleteDocumentExternally(collection: SeedCollectionName, id: string): void {
    this.documents.get(collection)?.delete(id);
  }
}

function createTransaction(
  documents: DocumentStore,
  migrationRuns: Map<string, SeedMigrationRun>,
): SeedRepositoryTransaction {
  return {
    async getDocument(collection, id) {
      const document = documents.get(collection)?.get(id);
      return document ? cloneStoredDocument(document) : null;
    },
    async listDocumentsBySeedRunId(seedRunId) {
      return SEED_COLLECTION_ORDER.flatMap((collection) => [...(documents.get(collection)?.values() ?? [])]
        .filter((document) => document.seedRunId === seedRunId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(cloneStoredDocument));
    },
    async createDocument(document) {
      const collection = documents.get(document.collection);
      if (!collection) throw new Error(`未知集合：${document.collection}。`);
      if (collection.has(document.id)) throw new Error(`文档已存在：${document.collection}/${document.id}。`);
      collection.set(document.id, cloneStoredDocument(document));
    },
    async deleteDocument(collection, id) {
      documents.get(collection)?.delete(id);
    },
    async getMigrationRun(seedRunId) {
      const run = migrationRuns.get(seedRunId);
      return run ? cloneMigrationRun(run) : null;
    },
    async putMigrationRun(run) {
      migrationRuns.set(run._id, cloneMigrationRun(run));
    },
  };
}

function createDocumentStore(): DocumentStore {
  return new Map(SEED_COLLECTION_ORDER.map((collection) => [collection, new Map<string, SeedStoredDocument>()]));
}

function cloneDocumentStore(source: DocumentStore): DocumentStore {
  return new Map(SEED_COLLECTION_ORDER.map((collection) => [
    collection,
    new Map([...(source.get(collection)?.entries() ?? [])].map(([id, document]) => [id, cloneStoredDocument(document)])),
  ]));
}

function cloneMigrationRuns(source: ReadonlyMap<string, SeedMigrationRun>): Map<string, SeedMigrationRun> {
  return new Map([...source.entries()].map(([id, run]) => [id, cloneMigrationRun(run)]));
}

function cloneStoredDocument(document: SeedStoredDocument): SeedStoredDocument {
  return { ...document, document: cloneJsonObject(document.document) };
}

function cloneMigrationRun(run: SeedMigrationRun): SeedMigrationRun {
  return {
    ...run,
    counts: { ...run.counts },
    createdDocumentIds: run.createdDocumentIds.map((reference) => ({ ...reference })),
  };
}

function cloneJsonObject(document: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(document)) as JsonObject;
}
