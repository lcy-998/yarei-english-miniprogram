import type { DocumentDatabaseReaderPort, VersionedDocument } from '../repositories/document-database-port';
import { computeJsonContentHash } from './canonical-json';
import type { M2OfflinePlan } from './m2-offline-operator';
import { M2_FIXTURE_COLLECTIONS, M2_FIXTURE_IDS, type M2FixtureCollection } from './m2-development-fixture';

/** Business readers that must use this gate (or an equivalent fail-closed check) before cloud import. */
export const M2_SEED_READ_GATE_INTEGRATION_POINTS = [
  { collection: 'learning_resources', readers: [
    'repositories/org-content-document-adapter.ts',
    'repositories/task-core-document-adapter.ts',
    'repositories/learning-progress-document-adapter.ts',
    'task-template/document-repository.ts',
    'activity/document-repository.ts',
    'textbook/document-repository.ts',
    'textbook/admin-service.ts',
    'question-admin/service.ts',
    'vocabulary-evidence/document-repository.ts',
    'student-work/document-repository.ts',
    'task-recording/catalog-service.ts',
  ] },
  { collection: 'phonics_courses', readers: ['phonics/document-repository.ts'] },
  { collection: 'task_templates', readers: [
    'task-template/document-repository.ts',
    'repositories/task-core-document-adapter.ts',
    'admin-task-activity/write-repository.ts',
  ] },
  { collection: 'checkin_activities', readers: [
    'activity/document-repository.ts',
    'notification/document-repository.ts',
    'notification/maintenance.ts',
    'admin-task-activity/write-repository.ts',
  ] },
] as const satisfies readonly Readonly<{ collection: M2FixtureCollection; readers: readonly string[] }>[];

/**
 * Immutable-row check for offline seed rehearsal. Deployed business reads use
 * m2-business-read-isolation.ts so legitimate edits stay visible after success.
 */
export async function filterVisibleM2SeedRows<T extends VersionedDocument>(
  reader: DocumentDatabaseReaderPort,
  collection: M2FixtureCollection,
  rows: readonly T[],
  plan: M2OfflinePlan,
): Promise<readonly T[]> {
  const candidates = new Map(plan.documents.filter(item => item.collection === collection)
    .map(item => [item.id, item.contentHash]));
  const relevant = rows.some(row => row.seedRunId === plan.seedRunId || candidates.has(row._id));
  if (!relevant) return [...rows];
  const run = await reader.get('migration_runs', plan.seedRunId);
  const available = run !== null && run.organizationId === M2_FIXTURE_IDS.organization
    && run.source === 'synthetic-m2-addon' && run.status === 'succeeded'
    && run.contentHash === plan.contentHash && run.baseSeedRunId === plan.requiredBaseSeedRunId
    && run.baseContentHash === plan.requiredBaseContentHash
    && run.dependencyDigest === plan.dependencyDigest && exactRunCounts(run.counts, plan)
    && exactCreatedRefs(run.created, plan);
  return rows.filter(row => {
    const expectedHash = candidates.get(row._id);
    if (row.seedRunId !== plan.seedRunId && expectedHash === undefined) return true;
    if (!available || expectedHash === undefined || row.seedRunId !== plan.seedRunId
      || row.seedVersion !== 'm2-local-addon-v1' || row.seedDocumentContentHash !== expectedHash) return false;
    const { seedDocumentContentHash: _ignored, ...raw } = row;
    return computeJsonContentHash(raw) === expectedHash;
  });
}

function exactRunCounts(value: unknown, plan: M2OfflinePlan): boolean {
  if (!record(value)) return false;
  return M2_FIXTURE_COLLECTIONS.every(collection => value[collection] === plan.counts[collection]);
}
function exactCreatedRefs(value: unknown, plan: M2OfflinePlan): boolean {
  if (!Array.isArray(value) || value.length !== plan.documents.length) return false;
  const expected = new Map(plan.documents.map(item => [`${item.collection}/${item.id}`, item.contentHash]));
  const seen = new Set<string>();
  for (const item of value) {
    if (!record(item) || typeof item.collection !== 'string' || typeof item.id !== 'string') return false;
    const key = `${item.collection}/${item.id}`;
    if (seen.has(key) || expected.get(key) !== item.contentHash) return false;
    seen.add(key);
  }
  return true;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
