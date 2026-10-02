import type { JsonValue } from '../shared/protocol';
import type { DocumentDatabaseReaderPort, VersionedDocument } from '../repositories/document-database-port';
import { computeJsonContentHash } from './canonical-json';
import { M2_FIXTURE_IDS } from './m2-development-fixture';

/** Only records actually referenced by the five M2 additive documents. */
export const M2_CURRENT_DEPENDENCIES = [
  { collection: 'organizations', id: M2_FIXTURE_IDS.organization, expectedStatus: 'active' },
  { collection: 'classes', id: M2_FIXTURE_IDS.class, expectedStatus: 'active' },
  { collection: 'users', id: M2_FIXTURE_IDS.teacher, expectedStatus: 'active' },
  { collection: 'users', id: M2_FIXTURE_IDS.student, expectedStatus: 'active' },
  { collection: 'role_assignments', id: 'rol_teacher_demo_01', expectedStatus: 'active' },
  { collection: 'teacher_class_grants', id: 'grt_teacher_demo_01_grade3_2', expectedStatus: 'active' },
  { collection: 'class_memberships', id: 'mem_grade3_2_g3_01', expectedStatus: 'active' },
] as const;

export interface M2CurrentDependencyFingerprint {
  readonly collection: (typeof M2_CURRENT_DEPENDENCIES)[number]['collection'];
  readonly id: string;
  readonly organizationId: string;
  readonly status: 'active';
  readonly version: number;
  /** SHA-256 of the complete document as observed, including its current metadata. */
  readonly contentHash: string;
}
export interface M2CurrentRunFingerprint {
  readonly id: string;
  readonly organizationId: string;
  readonly status: 'failed';
  readonly failedFromStatus: 'rolling_back';
  readonly version: number;
  readonly seedContentHash: string;
  readonly documentHash: string;
  readonly rollbackCursor: number;
  readonly createdReferenceCount: number;
}
export interface M2CurrentDependencyBaseline {
  readonly purpose: 'm2-existing-dependencies-read-only-review';
  readonly organizationId: string;
  readonly baseRun: M2CurrentRunFingerprint;
  readonly dependencies: readonly M2CurrentDependencyFingerprint[];
  readonly digest: string;
}
export interface M2DependencyIssue { readonly code: string; readonly path: string; readonly message: string }
export class M2DependencyError extends Error {
  public constructor(public readonly issues: readonly M2DependencyIssue[]) {
    super(issues.map(item => `${item.code}:${item.path}`).join(', '));
    this.name = 'M2DependencyError';
  }
}

/** Produces a review candidate from a local reader; it does not approve the candidate or write anything. */
export async function proposeM2CurrentDependencyBaseline(reader: DocumentDatabaseReaderPort,
  baseRunId = 'seed_m1_cloud_integration_v4'): Promise<M2CurrentDependencyBaseline> {
  const run = await reader.get('migration_runs', baseRunId);
  const issues: M2DependencyIssue[] = [];
  const baseRun = runFingerprint(run, baseRunId, issues);
  const dependencies: M2CurrentDependencyFingerprint[] = [];
  for (const [index, requirement] of M2_CURRENT_DEPENDENCIES.entries()) {
    const row = await reader.get(requirement.collection, requirement.id);
    if (!validDependency(row, requirement, issues, `dependencies[${index}]`)) continue;
    dependencies.push({ collection: requirement.collection, id: requirement.id,
      organizationId: M2_FIXTURE_IDS.organization, status: 'active', version: row!.version,
      contentHash: computeJsonContentHash(row as JsonValue) });
  }
  if (issues.length || baseRun === null) throw new M2DependencyError(issues);
  const withoutDigest = { purpose: 'm2-existing-dependencies-read-only-review' as const,
    organizationId: M2_FIXTURE_IDS.organization, baseRun, dependencies };
  return { ...withoutDigest, digest: computeJsonContentHash(withoutDigest as unknown as JsonValue) };
}

/** Requires a separate reviewed digest; observing current rows is never itself approval. */
export function assertReviewedM2CurrentBaseline(baseline: M2CurrentDependencyBaseline,
  reviewedDigest: string): void {
  const issues: M2DependencyIssue[] = [];
  if (baseline.purpose !== 'm2-existing-dependencies-read-only-review'
    || baseline.organizationId !== M2_FIXTURE_IDS.organization) {
    issues.push(issue('SCOPE', 'purpose', '基线用途或组织不匹配。'));
  }
  if (!isHash(reviewedDigest) || baseline.digest !== reviewedDigest
    || baseline.digest !== recomputeDigest(baseline)) {
    issues.push(issue('DIGEST', 'digest', '审阅摘要缺失、过弱或与基线不一致。'));
  }
  const run = baseline.baseRun;
  if (run.id !== 'seed_m1_cloud_integration_v4' || run.organizationId !== M2_FIXTURE_IDS.organization
    || run.status !== 'failed' || run.failedFromStatus !== 'rolling_back'
    || !positive(run.version) || !isHash(run.seedContentHash) || !isHash(run.documentHash)
    || !nonNegative(run.rollbackCursor) || !positive(run.createdReferenceCount)
    || run.rollbackCursor > run.createdReferenceCount) {
    issues.push(issue('RUN', 'baseRun', '必须精确记录当前失败回滚 run 的状态、版本、游标与摘要。'));
  }
  if (baseline.dependencies.length !== M2_CURRENT_DEPENDENCIES.length) {
    issues.push(issue('DEPENDENCY_COUNT', 'dependencies', '现存依赖清单不完整。'));
  }
  const seen = new Set<string>();
  baseline.dependencies.forEach((record, index) => {
    const requirement = M2_CURRENT_DEPENDENCIES[index];
    const key = `${record.collection}/${record.id}`;
    if (!requirement || record.collection !== requirement.collection || record.id !== requirement.id
      || seen.has(key) || record.organizationId !== M2_FIXTURE_IDS.organization
      || record.status !== 'active' || !positive(record.version) || !isHash(record.contentHash)) {
      issues.push(issue('DEPENDENCY', `dependencies[${index}]`, '依赖缺失、跨组织、非活动或版本/摘要不完整。'));
    }
    seen.add(key);
  });
  if (issues.length) throw new M2DependencyError(issues);
}

/** Repeat before each import transition to prevent drift after a read-only review. */
export async function verifyM2CurrentDependencyBaseline(reader: DocumentDatabaseReaderPort,
  baseline: M2CurrentDependencyBaseline, reviewedDigest: string): Promise<void> {
  assertReviewedM2CurrentBaseline(baseline, reviewedDigest);
  const issues: M2DependencyIssue[] = [];
  const run = await reader.get('migration_runs', baseline.baseRun.id);
  const actualRun = runFingerprint(run, baseline.baseRun.id, issues);
  if (actualRun && computeJsonContentHash(actualRun as unknown as JsonValue)
    !== computeJsonContentHash(baseline.baseRun as unknown as JsonValue)) {
    issues.push(issue('RUN_DRIFT', 'baseRun', 'M1 run 自审阅以来发生变化。'));
  }
  for (const [index, requirement] of M2_CURRENT_DEPENDENCIES.entries()) {
    const row = await reader.get(requirement.collection, requirement.id);
    if (!validDependency(row, requirement, issues, `dependencies[${index}]`)) continue;
    const expected = baseline.dependencies[index];
    if (!expected || row!.version !== expected.version
      || computeJsonContentHash(row as JsonValue) !== expected.contentHash) {
      issues.push(issue('DEPENDENCY_DRIFT', `dependencies[${index}]`, '依赖版本或完整内容摘要已变化。'));
    }
  }
  if (issues.length) throw new M2DependencyError(issues);
}

function runFingerprint(row: VersionedDocument | null, id: string,
  issues: M2DependencyIssue[]): M2CurrentRunFingerprint | null {
  if (!row || row._id !== id || row.organizationId !== M2_FIXTURE_IDS.organization
    || row.status !== 'failed' || row.failedFromStatus !== 'rolling_back'
    || !positive(row.version) || !isHash(row.contentHash)
    || !nonNegative(row.rollbackCursor) || !Array.isArray(row.createdDocumentIds)
    || row.createdDocumentIds.length < 1 || Number(row.rollbackCursor) > row.createdDocumentIds.length) {
    issues.push(issue('RUN_UNVERIFIED', 'baseRun', 'M1 失败回滚 run 的当前状态或游标不可核验。'));
    return null;
  }
  return { id, organizationId: M2_FIXTURE_IDS.organization, status: 'failed',
    failedFromStatus: 'rolling_back', version: row.version,
    seedContentHash: row.contentHash as string, documentHash: computeJsonContentHash(row as JsonValue),
    rollbackCursor: Number(row.rollbackCursor), createdReferenceCount: row.createdDocumentIds.length };
}

function validDependency(row: VersionedDocument | null,
  requirement: (typeof M2_CURRENT_DEPENDENCIES)[number], issues: M2DependencyIssue[], path: string): row is VersionedDocument {
  if (!row || row._id !== requirement.id || row.organizationId !== M2_FIXTURE_IDS.organization
    || row.deletedAt !== null || row.status !== 'active' || !positive(row.version)
    || !semanticMatch(row, requirement.collection)) {
    issues.push(issue('DEPENDENCY_UNVERIFIED', path, '现存依赖缺失、越界、非活动或关系不匹配。'));
    return false;
  }
  return true;
}
function semanticMatch(row: VersionedDocument, collection: string): boolean {
  if (collection === 'organizations') return row.timeZone === 'Asia/Shanghai';
  if (collection === 'classes') return row.grade === 3;
  if (collection === 'role_assignments') return row.userId === M2_FIXTURE_IDS.teacher
    && row.role === 'teacher' && Array.isArray(row.permissions)
    && row.permissions.includes('content.read') && row.permissions.includes('task.publish');
  if (collection === 'teacher_class_grants') return row.teacherId === M2_FIXTURE_IDS.teacher
    && row.classId === M2_FIXTURE_IDS.class && Array.isArray(row.permissions)
    && row.permissions.includes('content.read') && row.permissions.includes('task.publish');
  if (collection === 'class_memberships') return row.studentId === M2_FIXTURE_IDS.student
    && row.classId === M2_FIXTURE_IDS.class;
  return true;
}
function recomputeDigest(baseline: M2CurrentDependencyBaseline): string {
  const { digest: _ignored, ...data } = baseline;
  return computeJsonContentHash(data as unknown as JsonValue);
}
function issue(code: string, path: string, message: string): M2DependencyIssue { return { code, path, message }; }
function isHash(value: unknown): value is string { return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value); }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function nonNegative(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
