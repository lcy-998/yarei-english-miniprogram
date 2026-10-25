import type { DatabaseIndexDefinition } from './database-manifest';

/** Proposed additive M3 collections. This is a local review artifact, not a deployment command. */
export const M3_TEACHER_COLLECTION_NAMES = [
  'native_admin_grants', 'native_admin_operations',
  'native_admin_management_operations', 'native_admin_content_operations',
  'native_admin_account_operations',
  'teacher_media_records', 'teacher_media_operations',
  'teacher_student_import_operations', 'teacher_student_import_rows',
  'teacher_student_import_commits', 'student_number_reservations',
  'task_media_sessions', 'task_media_operations', 'task_dubbing_works', 'task_dubbing_work_operations',
  'review_voice_drafts', 'review_voice_operations',
] as const;
export type M3TeacherCollectionName = (typeof M3_TEACHER_COLLECTION_NAMES)[number];

export interface M3TeacherCollectionDefinition {
  readonly name: M3TeacherCollectionName;
  readonly clientAccess: 'ADMINONLY';
  readonly indexes: readonly DatabaseIndexDefinition[];
}

const index = (name: string, fields: readonly string[], unique = false): DatabaseIndexDefinition => ({
  name, fields: fields.map(field => ({ field, direction: 'asc' as const })),
  unique, requirement: 'required',
});
const collection = (name: M3TeacherCollectionName,
  indexes: readonly DatabaseIndexDefinition[]): M3TeacherCollectionDefinition => ({
  name, clientAccess: 'ADMINONLY', indexes,
});

export const M3_TEACHER_DATABASE_MANIFEST: readonly M3TeacherCollectionDefinition[] = [
  collection('native_admin_grants', [
    index('uq_native_grant_org_teacher', ['organizationId', 'teacherId'], true),
    index('idx_native_grant_org_status', ['organizationId', 'status']),
  ]),
  collection('native_admin_operations', [
    index('uq_native_operation_actor_id', ['organizationId', 'actorId', 'operationId'], true),
  ]),
  collection('native_admin_management_operations', [
    index('_id_', ['_id'], true),
    index('idx_native_management_actor', ['organizationId', 'actorUserId', 'operationId']),
  ]),
  collection('native_admin_content_operations', [
    index('_id_', ['_id'], true),
    index('idx_native_content_actor', ['organizationId', 'actorUserId', 'operationId']),
  ]),
  collection('native_admin_account_operations', [
    index('_id_', ['_id'], true),
  ]),
  collection('teacher_media_records', [
    index('_id_', ['_id'], true),
    index('idx_teacher_media_owner_status', ['organizationId', 'ownerTeacherId', 'status']),
  ]),
  collection('teacher_media_operations', [
    index('_id_', ['_id'], true),
  ]),
  collection('teacher_student_import_operations', [
    index('uq_student_import_actor_operation', ['organizationId', 'teacherId', 'operationId'], true),
  ]),
  collection('teacher_student_import_rows', [
    index('uq_student_import_row', ['organizationId', 'teacherId', 'operationId', 'lineNumber'], true),
  ]),
  collection('teacher_student_import_commits', [
    index('uq_student_import_commit', ['organizationId', 'rowOperationId'], true),
  ]),
  collection('student_number_reservations', [
    index('uq_student_number_reservation', ['organizationId', 'studentNumber'], true),
  ]),
  collection('task_media_sessions', [
    index('uq_task_media_session_id', ['_id'], true),
    index('idx_task_media_student_item', ['organizationId', 'studentId', 'taskId', 'itemId']),
  ]),
  collection('task_media_operations', [
    index('uq_task_media_operation_id', ['_id'], true),
    index('idx_task_media_operation_student', ['organizationId', 'studentId', 'operationId']),
  ]),
  collection('task_dubbing_works', [
    index('uq_task_dubbing_work_id', ['_id'], true),
    index('idx_task_dubbing_student_item', ['organizationId', 'studentId', 'taskId', 'itemId']),
  ]),
  collection('task_dubbing_work_operations', [
    index('uq_task_dubbing_work_operation_id', ['_id'], true),
  ]),
  collection('review_voice_drafts', [
    index('_id_', ['_id'], true),
    index('idx_review_voice_submission', ['organizationId', 'teacherId', 'submissionId']),
  ]),
  collection('review_voice_operations', [
    index('_id_', ['_id'], true),
  ]),
];
