import type { DocumentData, DocumentDatabasePort, DocumentDatabaseTransactionPort,
  VersionedDocument } from '../repositories/document-database-port';
import { M2_FIXTURE_IDS } from './m2-development-fixture';

const RUN_ID = 'seed_m2_local_addon_v1';
const BASE_RUN_ID = 'seed_m1_cloud_integration_v4';
const SEED_VERSION = 'm2-local-addon-v1';
const CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  learning_resources: [M2_FIXTURE_IDS.exercise, M2_FIXTURE_IDS.textbook],
  phonics_courses: [M2_FIXTURE_IDS.phonics],
  task_templates: [M2_FIXTURE_IDS.template],
  checkin_activities: [M2_FIXTURE_IDS.activity],
};
const CANDIDATE_KEYS = new Set(Object.entries(CANDIDATES)
  .flatMap(([collection, ids]) => ids.map(id => `${collection}/${id}`)));

/**
 * All deployed business repositories share this document boundary. It prevents
 * a partially imported M2 fixture from appearing in a directory, detail read,
 * or resource lookup used before a write. Seed operators must use the raw port.
 */
export function createM2BusinessReadIsolation(raw: DocumentDatabasePort): DocumentDatabasePort {
  async function published(reader: Pick<DocumentDatabaseTransactionPort, 'get'>): Promise<boolean> {
    const run = await reader.get('migration_runs', RUN_ID);
    if (run === null || run.organizationId !== 'org_qihang_demo'
      || run.source !== 'synthetic-m2-addon' || run.status !== 'succeeded'
      || run.baseSeedRunId !== BASE_RUN_ID || !isDigest(run.contentHash)
      || !isDigest(run.dependencyDigest) || !Array.isArray(run.created)
      || run.created.length !== CANDIDATE_KEYS.size) return false;
    const seen = new Set<string>();
    for (const ref of run.created) {
      if (!isRecord(ref) || typeof ref.collection !== 'string' || typeof ref.id !== 'string') return false;
      const key = `${ref.collection}/${ref.id}`;
      if (!CANDIDATE_KEYS.has(key) || seen.has(key) || !isDigest(ref.contentHash)) return false;
      seen.add(key);
    }
    return true;
  }

  function visible(collection: string, row: VersionedDocument, ready: boolean): boolean {
    const candidate = CANDIDATE_KEYS.has(`${collection}/${row._id}`);
    const tagged = row.seedRunId === RUN_ID;
    if (!candidate && !tagged) return true;
    if (!ready || !candidate || row.organizationId !== 'org_qihang_demo') return false;
    // Normal service updates remove seed metadata after the run succeeds. The
    // verified run owns this exact ID, so the updated business row stays visible.
    return !tagged || row.seedVersion === SEED_VERSION && isDigest(row.seedDocumentContentHash);
  }

  async function filteredGet(reader: Pick<DocumentDatabaseTransactionPort, 'get'>,
    collection: string, id: string): Promise<VersionedDocument | null> {
    const row = await reader.get(collection, id);
    if (row === null || CANDIDATES[collection] === undefined) return row;
    return visible(collection, row, await published(reader)) ? row : null;
  }

  async function filteredFind(reader: Pick<DocumentDatabaseTransactionPort, 'get' | 'find'>,
    collection: string, criteria: DocumentData): Promise<readonly VersionedDocument[]> {
    const rows = await reader.find(collection, criteria);
    if (CANDIDATES[collection] === undefined || rows.length === 0) return rows;
    const ready = await published(reader);
    return rows.filter(row => visible(collection, row, ready));
  }

  return {
    get: (collection, documentId) => filteredGet(raw, collection, documentId),
    find: (collection, criteria) => filteredFind(raw, collection, criteria),
    findPage: async (collection, criteria, page) => {
      if (CANDIDATES[collection] === undefined) return raw.findPage(collection, criteria, page);
      const result = await raw.findPage(collection, criteria, page);
      const ready = await published(raw);
      const candidates = await Promise.all(CANDIDATES[collection].map(id => raw.get(collection, id)));
      if (candidates.every(row => row === null || visible(collection, row, ready))
        && result.items.every(row => visible(collection, row, ready))) return result;
      // A hidden seed row before the requested offset shifts every later page.
      // Re-page the bounded result set after filtering to preserve hasMore.
      const rows = (await raw.find(collection, criteria))
        .filter(row => visible(collection, row, ready))
        .sort((left, right) => left._id < right._id ? -1 : left._id > right._id ? 1 : 0);
      return { items: rows.slice(page.offset, page.offset + page.limit),
        hasMore: rows.length > page.offset + page.limit };
    },
    runTransaction: (work) => raw.runTransaction(tx => work({
      get: (collection, documentId) => filteredGet(tx, collection, documentId),
      find: (collection, criteria) => filteredFind(tx, collection, criteria),
      create: (collection, document) => tx.create(collection, document),
      replace: (collection, documentId, expectedVersion, document) =>
        tx.replace(collection, documentId, expectedVersion, document),
      delete: (collection, documentId, expectedVersion) => tx.delete(collection, documentId, expectedVersion),
      append: (collection, document) => tx.append(collection, document),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}
