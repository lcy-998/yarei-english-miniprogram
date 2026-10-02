export const M1_COLLECTION_NAMES = [
  'organizations',
  'classes',
  'users',
  'auth_identities',
  'role_assignments',
  'class_memberships',
  'teacher_class_grants',
  'parent_student_links',
  'binding_codes',
  'learning_resources',
  'reading_progress',
  'vocabulary_progress',
  'tasks',
  'task_assignments',
  'submissions',
  'review_feedback',
  'idempotency_records',
  'operation_logs',
  'migration_runs',
  'business_sessions',
  'business_session_slots',
] as const;

export type M1CollectionName = (typeof M1_COLLECTION_NAMES)[number];
export type DatabaseIndexDirection = 'asc' | 'desc';

export interface DatabaseIndexField {
  readonly field: string;
  readonly direction: DatabaseIndexDirection;
}

export interface DatabaseIndexDefinition {
  readonly name: string;
  readonly fields: readonly DatabaseIndexField[];
  readonly unique: boolean;
  /** Conditional indexes need a platform capability check before publication. */
  readonly requirement: 'required' | 'conditional';
}

export interface CollectionDefinition {
  readonly name: M1CollectionName;
  readonly clientAccess: 'ADMINONLY';
  readonly indexes: readonly DatabaseIndexDefinition[];
}

export interface ObservedCollectionDefinition {
  readonly name: string;
  readonly clientAccess: string;
  readonly indexes: readonly Readonly<{
    name?: string;
    fields: readonly DatabaseIndexField[];
    unique: boolean;
  }>[];
}

export interface DatabaseManifestIssue {
  readonly code: 'COLLECTION_MISSING' | 'COLLECTION_UNEXPECTED' | 'CLIENT_ACCESS_MISMATCH' | 'INDEX_MISSING' | 'INDEX_UNEXPECTED';
  readonly collection: string;
  readonly index?: string;
  readonly message: string;
}

const index = (
  name: string,
  fields: readonly string[],
  unique = false,
  requirement: DatabaseIndexDefinition['requirement'] = 'required',
): DatabaseIndexDefinition => ({
  name,
  fields: fields.map((field) => ({ field, direction: 'asc' })),
  unique,
  requirement,
});

export const M1_DATABASE_MANIFEST: readonly CollectionDefinition[] = [
  collection('organizations', [index('idx_organizations_status_deleted', ['status', 'deletedAt'])]),
  collection('classes', [
    index('idx_classes_org_status_grade', ['organizationId', 'status', 'grade']),
    index('uq_classes_org_name_deleted', ['organizationId', 'name', 'deletedAt'], true),
  ]),
  collection('users', [index('idx_users_org_status_deleted', ['organizationId', 'status', 'deletedAt'])]),
  collection('auth_identities', [
    index('uq_auth_provider_subject', ['provider', 'providerSubjectDigest'], true),
    index('idx_auth_org_user_status', ['organizationId', 'userId', 'status']),
  ]),
  collection('role_assignments', [
    index('idx_roles_org_user_status', ['organizationId', 'userId', 'status']),
    index('idx_roles_org_role_status', ['organizationId', 'role', 'status']),
    index('idx_roles_org_scope_status', ['organizationId', 'scopeType', 'scopeIds', 'status'], false, 'conditional'),
  ]),
  collection('class_memberships', [
    index('idx_memberships_org_class_status_student', ['organizationId', 'classId', 'status', 'studentId']),
    index('idx_memberships_org_student_status', ['organizationId', 'studentId', 'status']),
  ]),
  collection('teacher_class_grants', [
    index('idx_teacher_grants_org_teacher_status_class', ['organizationId', 'teacherId', 'status', 'classId']),
    index('idx_teacher_grants_org_class_status', ['organizationId', 'classId', 'status']),
  ]),
  collection('parent_student_links', [
    index('idx_parent_links_org_parent_status_student', ['organizationId', 'parentId', 'status', 'studentId']),
    index('idx_parent_links_org_student_status', ['organizationId', 'studentId', 'status']),
  ]),
  collection('binding_codes', [index('idx_binding_codes_status_expires', ['status', 'expiresAt'])]),
  collection('learning_resources', [index('idx_resources_org_type_status_updated', ['organizationId', 'type', 'status', 'updatedAt'])]),
  collection('reading_progress', [index('uq_reading_progress_owner_resource', ['organizationId', 'studentId', 'resourceId'], true)]),
  collection('vocabulary_progress', [index('uq_vocabulary_progress_owner_pack', ['organizationId', 'studentId', 'packId'], true)]),
  collection('tasks', [
    index('idx_tasks_org_teacher_status_due', ['organizationId', 'creatorTeacherId', 'status', 'dueAt']),
    index('idx_tasks_org_target_classes_status_due', ['organizationId', 'targetClassIds', 'status', 'dueAt']),
    index('idx_tasks_org_visibility_updated', ['organizationId', 'visibility', 'updatedAt']),
  ]),
  collection('task_assignments', [
    index('uq_assignments_org_task_student', ['organizationId', 'taskId', 'studentId'], true),
    index('idx_assignments_org_student_status_updated', ['organizationId', 'studentId', 'status', 'updatedAt']),
    index('idx_assignments_org_task_status_submitted', ['organizationId', 'taskId', 'status', 'submittedAt']),
    index('idx_assignments_org_class_task_status', ['organizationId', 'classId', 'taskId', 'status']),
  ]),
  collection('submissions', [
    index('uq_submissions_org_assignment_submission_version', ['organizationId', 'assignmentId', 'submissionVersion'], true),
    index('idx_submissions_org_student_status_updated', ['organizationId', 'studentId', 'status', 'updatedAt']),
    index('idx_submissions_org_task_status_submitted', ['organizationId', 'taskId', 'status', 'submittedAt']),
  ]),
  collection('review_feedback', [
    index('uq_feedback_org_submission', ['organizationId', 'submissionId'], true),
    index('idx_feedback_org_task_published', ['organizationId', 'taskId', 'publishedAt']),
    index('idx_feedback_org_teacher_published', ['organizationId', 'teacherId', 'publishedAt']),
  ]),
  collection('idempotency_records', []),
  collection('operation_logs', [
    index('idx_logs_org_occurred', ['organizationId', 'occurredAt']),
    index('idx_logs_org_actor_occurred', ['organizationId', 'actorUserId', 'occurredAt']),
    index('uq_logs_request', ['requestId'], true),
  ]),
  collection('migration_runs', []),
  collection('business_sessions', [
    index('idx_business_sessions_principal_deleted', ['organizationId', 'userId', 'subjectDigest', 'deletedAt']),
  ]),
  collection('business_session_slots', []),
] as const;

export function compareDatabaseManifest(
  observed: readonly ObservedCollectionDefinition[],
  options: Readonly<{ reportUnexpected?: boolean }> = {},
): readonly DatabaseManifestIssue[] {
  const issues: DatabaseManifestIssue[] = [];
  const observedByName = new Map(observed.map((item) => [item.name, item]));
  for (const expected of M1_DATABASE_MANIFEST) {
    const actual = observedByName.get(expected.name);
    if (!actual) {
      issues.push(issue('COLLECTION_MISSING', expected.name, '缺少 M1 集合。'));
      continue;
    }
    if (actual.clientAccess !== expected.clientAccess) {
      issues.push(issue('CLIENT_ACCESS_MISMATCH', expected.name, '客户端权限必须为 ADMINONLY。'));
    }
    for (const expectedIndex of expected.indexes.filter((item) => item.requirement === 'required')) {
      if (!actual.indexes.some((actualIndex) => indexesEqual(expectedIndex, actualIndex))) {
        issues.push(issue('INDEX_MISSING', expected.name, '缺少必需索引或其唯一性/字段顺序不一致。', expectedIndex.name));
      }
    }
    if (options.reportUnexpected) {
      for (const actualIndex of actual.indexes) {
        if (!expected.indexes.some((expectedIndex) => indexesEqual(expectedIndex, actualIndex))) {
          issues.push(issue('INDEX_UNEXPECTED', expected.name, '发现清单之外的索引，需人工确认而不是自动删除。', actualIndex.name));
        }
      }
    }
  }
  if (options.reportUnexpected) {
    const expectedNames = new Set(M1_COLLECTION_NAMES);
    for (const actual of observed) {
      if (!expectedNames.has(actual.name as M1CollectionName)) {
        issues.push(issue('COLLECTION_UNEXPECTED', actual.name, '发现清单之外的集合，需人工确认而不是自动删除。'));
      }
    }
  }
  return [...issues].sort((left, right) => left.collection.localeCompare(right.collection)
    || left.code.localeCompare(right.code)
    || (left.index ?? '').localeCompare(right.index ?? ''));
}

function collection(name: M1CollectionName, indexes: readonly DatabaseIndexDefinition[]): CollectionDefinition {
  return { name, clientAccess: 'ADMINONLY', indexes };
}

function indexesEqual(
  expected: DatabaseIndexDefinition,
  actual: ObservedCollectionDefinition['indexes'][number],
): boolean {
  return expected.unique === actual.unique
    && expected.fields.length === actual.fields.length
    && expected.fields.every((field, position) => (
      field.field === actual.fields[position]?.field
      && field.direction === actual.fields[position]?.direction
    ));
}

function issue(
  code: DatabaseManifestIssue['code'],
  collectionName: string,
  message: string,
  indexName?: string,
): DatabaseManifestIssue {
  return {
    code,
    collection: collectionName,
    message,
    ...(indexName === undefined ? {} : { index: indexName }),
  };
}
