import { DatabaseSync } from 'node:sqlite';
import type { DocumentData, DocumentDatabasePort, DocumentDatabaseTransactionPort, VersionedDocument } from '../../m1-cloudbase/src/repositories/document-database-port';

/** Single-process SQLite writer. All reads share the queue, so callers never see uncommitted data. */
export class SqliteDocuments implements DocumentDatabasePort {
  private readonly db: DatabaseSync;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents(collection TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(collection,id));
      CREATE INDEX IF NOT EXISTS documents_org ON documents(collection,json_extract(body,'$.organizationId'));
      CREATE INDEX IF NOT EXISTS documents_user ON documents(collection,json_extract(body,'$.userId'));
      CREATE INDEX IF NOT EXISTS documents_subject ON documents(collection,json_extract(body,'$.providerSubjectDigest'));`);
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private read(collection: string, id: string): VersionedDocument | null {
    const row = this.db.prepare('SELECT body FROM documents WHERE collection=? AND id=?').get(collection,id);
    return row ? JSON.parse(String(row.body)) as VersionedDocument : null;
  }
  private search(collection: string, criteria: DocumentData): readonly VersionedDocument[] {
    // Repository criteria are equality predicates. Compare parsed JSON to retain null/array semantics.
    return this.db.prepare('SELECT body FROM documents WHERE collection=? ORDER BY id').all(collection)
      .map(row => JSON.parse(String(row.body)) as VersionedDocument)
      .filter(doc => Object.entries(criteria).every(([key,value]) => JSON.stringify(doc[key]) === JSON.stringify(value)));
  }
  get(collection: string,id: string): Promise<VersionedDocument | null> { return this.exclusive(async () => this.read(collection,id)); }
  find(collection: string,criteria: DocumentData): Promise<readonly VersionedDocument[]> { return this.exclusive(async () => this.search(collection,criteria)); }
  findPage(collection: string,criteria: DocumentData,page: Readonly<{limit:number;offset:number}>) {
    return this.exclusive(async () => {
      if (!Number.isSafeInteger(page.limit) || page.limit<1 || page.limit>50 || !Number.isSafeInteger(page.offset) || page.offset<0 || page.offset>10000) throw new Error('Invalid page');
      const rows=this.search(collection,criteria);
      return {items:rows.slice(page.offset,page.offset+page.limit),hasMore:rows.length>page.offset+page.limit};
    });
  }
  runTransaction<T>(work: (transaction: DocumentDatabaseTransactionPort) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      let active = true;
      const guard = () => { if (!active) throw new Error('Transaction closed'); };
      const create = async (collection: string,doc: VersionedDocument) => {
        guard(); validate(doc);
        return this.db.prepare('INSERT OR IGNORE INTO documents(collection,id,version,body) VALUES(?,?,?,?)').run(collection,doc._id,doc.version,JSON.stringify(doc)).changes === 1;
      };
      const tx: DocumentDatabaseTransactionPort = {
        get: async (c,id) => {guard(); return this.read(c,id);},
        find: async (c,criteria) => {guard(); return this.search(c,criteria);},
        create, append:create,
        replace: async (c,id,version,doc) => {
          guard(); validate(doc); if (doc._id !== id) return false;
          return this.db.prepare('UPDATE documents SET version=?,body=? WHERE collection=? AND id=? AND version=?').run(doc.version,JSON.stringify(doc),c,id,version).changes === 1;
        },
        delete: async (c,id,version) => {guard(); return this.db.prepare('DELETE FROM documents WHERE collection=? AND id=? AND version=?').run(c,id,version).changes === 1;},
      };
      try {const result = await work(tx); this.db.exec('COMMIT'); return result;}
      catch (error) {this.db.exec('ROLLBACK'); throw error;}
      finally {active = false;}
    });
  }
  async close(): Promise<void> { await this.queue; this.db.close(); }
}
function validate(doc: VersionedDocument): void {
  if (!doc || typeof doc._id !== 'string' || !doc._id || !Number.isSafeInteger(doc.version) || doc.version < 1) throw new Error('Invalid document');
}
