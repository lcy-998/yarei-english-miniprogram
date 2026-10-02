import type { DatabaseIndexDefinition, DatabaseManifestIssue, ObservedCollectionDefinition } from './database-manifest';

/** Additive M2 collections; the accepted M1 manifest remains unchanged. */
export const M2_COLLECTION_NAMES = [
  'reading_page_events',
  'vocabulary_attempts',
  'vocabulary_attempt_operations',
  'student_works',
  'student_work_operations',
  'task_recordings',
  'task_recording_operations',
  'media_retention_jobs',
  'phonics_courses',
  'phonics_answers',
  'phonics_answer_operations',
  'task_templates',
  'task_template_operations',
  'checkin_activities',
  'checkin_activity_operations',
  'checkin_overrides',
  'checkin_final_boards',
  'notification_read_states',
  'notification_events',
  'checkin_finalization_recovery',
  'maintenance_scan_state',
  'class_textbook_configs',
  'class_textbook_operations',
  'textbook_center_settings',
  'textbook_catalog_drafts',
  'textbook_admin_operations',
  'question_admin_operations',
  'admin_task_activity_operations',
] as const;

export type M2CollectionName = (typeof M2_COLLECTION_NAMES)[number];
export interface M2CollectionDefinition {
  readonly name: M2CollectionName;
  readonly clientAccess: 'ADMINONLY';
  readonly indexes: readonly DatabaseIndexDefinition[];
}

function index(name: string, fields: readonly string[], unique = false): DatabaseIndexDefinition {
  return { name, fields: fields.map(field => ({ field, direction: 'asc' as const })),
    unique, requirement: 'required' };
}
function collection(name: M2CollectionName, indexes: readonly DatabaseIndexDefinition[]): M2CollectionDefinition {
  return { name, clientAccess: 'ADMINONLY', indexes };
}

export const M2_DATABASE_MANIFEST: readonly M2CollectionDefinition[] = [
  collection('reading_page_events', [index('idx_read_pages_owner_resource_time',
    ['organizationId', 'studentId', 'resourceId', 'visitedAt'])]),
  collection('vocabulary_attempts', [index('idx_vocab_attempts_task_scope',
    ['organizationId', 'studentId', 'packId', 'taskId', 'itemId', 'round', 'contentVersion']),
  index('idx_vocab_attempts_activity_scope', ['organizationId', 'studentId', 'packId', 'contentVersion'])]),
  collection('vocabulary_attempt_operations', []),
  collection('student_works', [index('idx_student_works_owner_material_status',
    ['organizationId', 'studentId', 'materialId', 'status']),
  index('idx_student_works_owner_deleted_at', ['organizationId', 'studentId', 'deletedAt']),
  index('idx_student_works_deleted_drafts', ['organizationId', 'studentId', 'status', 'recoveryState']),
  index('idx_student_works_retention_status', ['organizationId', 'status', 'deletedAt'])]),
  collection('student_work_operations', []),
  collection('task_recordings', [index('idx_task_recordings_owner_item_submission',
    ['organizationId', 'studentId', 'taskId', 'itemId', 'submissionVersion'])]),
  collection('task_recording_operations', []),
  collection('media_retention_jobs', [index('idx_media_retention_org_status',
    ['organizationId', 'status', 'deletedAt'])]),
  collection('phonics_courses', [index('idx_phonics_courses_org_status', ['organizationId', 'status', 'deletedAt'])]),
  collection('phonics_answers', [index('idx_phonics_answers_owner_course_round',
    ['organizationId', 'studentId', 'courseId', 'contentVersion', 'round'])]),
  collection('phonics_answer_operations', []),
  collection('task_templates', [index('idx_task_templates_org_scope_owner_status',
    ['organizationId', 'scope', 'ownerTeacherId', 'status'])]),
  collection('task_template_operations', []),
  collection('checkin_activities', [index('idx_checkin_activities_org_class_status',
    ['organizationId', 'classId', 'status', 'deletedAt']),
  index('idx_checkin_activities_org_status_ends', ['organizationId', 'status', 'endsOn', 'deletedAt'])]),
  collection('checkin_activity_operations', []),
  collection('checkin_overrides', [index('idx_checkin_overrides_org_activity_student_date',
    ['organizationId', 'activityId', 'studentId', 'date'])]),
  collection('checkin_final_boards', [index('idx_checkin_final_boards_org_activity',
    ['organizationId', 'activityId'], true)]),
  collection('notification_read_states', [index('idx_notification_reads_owner_role',
    ['organizationId', 'userId', 'role', 'deletedAt'])]),
  collection('notification_events', [index('idx_notification_events_owner_role_time',
    ['organizationId', 'recipientUserId', 'recipientRole', 'occurredAt'])]),
  collection('checkin_finalization_recovery', [index('idx_finalization_recovery_org_status',
    ['organizationId', 'status', 'deletedAt'])]),
  collection('maintenance_scan_state', []),
  collection('class_textbook_configs', [index('idx_class_textbook_configs_org_class',
    ['organizationId', 'classId', 'deletedAt'])]),
  collection('class_textbook_operations', []),
  collection('textbook_center_settings', [index('idx_textbook_center_settings_org',
    ['organizationId', 'deletedAt'])]),
  collection('textbook_catalog_drafts', [index('idx_textbook_catalog_drafts_org',
    ['organizationId', 'deletedAt'])]),
  collection('textbook_admin_operations', []),
  collection('question_admin_operations', []),
  collection('admin_task_activity_operations', []),
] as const;

export function compareM2DatabaseManifest(observed: readonly ObservedCollectionDefinition[]): readonly DatabaseManifestIssue[] {
  const byName = new Map(observed.map(item => [item.name, item]));
  const issues: DatabaseManifestIssue[] = [];
  for (const expected of M2_DATABASE_MANIFEST) {
    const actual = byName.get(expected.name);
    if (!actual) {
      issues.push({ code: 'COLLECTION_MISSING', collection: expected.name, message: '缺少 M2 集合。' });
      continue;
    }
    if (actual.clientAccess !== 'ADMINONLY') issues.push({ code: 'CLIENT_ACCESS_MISMATCH',
      collection: expected.name, message: 'M2 集合必须只允许服务端访问。' });
    for (const required of expected.indexes) {
      const found = actual.indexes.some(candidate => candidate.unique === required.unique
        && candidate.fields.length === required.fields.length
        && required.fields.every((field, position) => field.field === candidate.fields[position]?.field
          && field.direction === candidate.fields[position]?.direction));
      if (!found) issues.push({ code: 'INDEX_MISSING', collection: expected.name,
        index: required.name, message: '缺少 M2 必需索引或字段顺序不一致。' });
    }
  }
  return issues.sort((left, right) => left.collection.localeCompare(right.collection)
    || left.code.localeCompare(right.code) || (left.index ?? '').localeCompare(right.index ?? ''));
}
