// Offline, read-only plan from a verified private CloudBase snapshot.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const folder = resolve(process.argv[2] ?? '');
if (!folder.includes('three-demo-cleanup-backup-2026-10-22T')) throw new Error('BACKUP_FOLDER_INVALID');
const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
if (manifest.environmentId !== 'cloud1-d8ggzrwwedb786e41' || Object.keys(manifest.collections).length !== 70) {
  throw new Error('SNAPSHOT_ENVIRONMENT_INVALID');
}
const rows = new Map();
for (const [name, expected] of Object.entries(manifest.collections)) {
  const bytes = readFileSync(join(folder, 'database', `${name}.json`));
  if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
    throw new Error(`SNAPSHOT_HASH_MISMATCH:${name}`);
  }
  const documents = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(documents) || documents.length !== expected.count) {
    throw new Error(`SNAPSHOT_COUNT_MISMATCH:${name}`);
  }
  rows.set(name, documents);
}
const T = 'usr_teacher_demo_01';
const S = 'usr_student_g3_01';
const P = 'usr_parent_demo_01';
const actors = new Set([T, S, P]);
const selected = new Map([...rows.keys()].map(name => [name, new Set()]));
function choose(name, predicate) {
  for (const row of rows.get(name) ?? []) if (predicate(row)) selected.get(name).add(row._id);
}
function has(name, id) { return typeof id === 'string' && selected.get(name)?.has(id) === true; }
function fieldsMatch(row, keys, values) { return keys.some(key => values.has(row[key])); }
choose('tasks', row => row.creatorTeacherId === T);
choose('checkin_activities', row => row.creatorTeacherId === T);
choose('teacher_private_videos', row => row.ownerTeacherId === T);
choose('learning_resources', row => row.teacherPrivateOwnerId === T
  || row.payload?.teacherPrivate?.ownerTeacherId === T);
choose('task_assignments', row => has('tasks', row.taskId) || row.studentId === S);
choose('submissions', row => row.studentId === S || has('tasks', row.taskId)
  || has('task_assignments', row.assignmentId));
choose('review_feedback', row => row.teacherId === T || has('tasks', row.taskId)
  || has('task_assignments', row.assignmentId) || has('submissions', row.submissionId));
choose('task_media_sessions', row => row.studentId === S || has('tasks', row.taskId)
  || has('task_assignments', row.assignmentId));
choose('task_media_operations', row => row.studentId === S || has('tasks', row.taskId)
  || has('task_assignments', row.assignmentId));
choose('checkin_final_boards', row => has('checkin_activities', row.activityId));
choose('checkin_overrides', row => row.studentId === S || has('checkin_activities', row.activityId));
choose('checkin_activity_operations', row => row.actorUserId === T
  || has('checkin_activities', row.activityId));
choose('admin_task_activity_operations', row => has('tasks', row.taskId)
  || has('checkin_activities', row.activityId));
choose('binding_codes', row => row.createdBy === T || row.studentId === S
  || row.usedByParentId === P);
choose('business_sessions', row => actors.has(row.userId));
choose('business_session_slots', row => actors.has(row.userId));
choose('class_textbook_operations', row => row.teacherId === T);
choose('native_admin_account_operations', row => row.actorUserId === T || row.actorId === T);
choose('native_admin_content_operations', row => row.actorUserId === T || row.actorId === T);
choose('native_admin_management_operations', row => row.actorUserId === T || row.actorId === T);
choose('native_admin_operations', row => row.actorId === T || row.actorUserId === T
  || row.result?.teacherId === T);
choose('notification_read_states', row => actors.has(row.userId));
choose('phonics_answer_operations', row => row.studentId === S || row.result?.studentId === S);
choose('phonics_answers', row => row.studentId === S);
choose('pronunciation_operations', row => row.actorId === S || row.studentId === S);
choose('pronunciation_recordings', row => row.studentId === S);
choose('reading_page_events', row => row.studentId === S);
choose('reading_progress', row => row.studentId === S);
choose('review_voice_drafts', row => row.teacherId === T);
choose('review_voice_operations', row => row.teacherId === T);
choose('student_work_operations', row => row.studentId === S || row.result?.studentId === S);
choose('student_works', row => row.studentId === S);
choose('task_dubbing_work_operations', row => row.studentId === S || has('tasks', row.taskId));
choose('task_dubbing_works', row => row.studentId === S || has('tasks', row.taskId));
choose('task_recording_operations', row => row.actorId === S || row.studentId === S
  || has('tasks', row.taskId));
choose('task_recordings', row => row.studentId === S || has('tasks', row.taskId));
choose('teacher_ai_suggestions', row => row.teacherId === T || has('submissions', row.submissionId));
choose('vocabulary_attempt_operations', row => row.studentId === S || row.result?.studentId === S);
choose('vocabulary_attempts', row => row.studentId === S);
choose('vocabulary_progress', row => row.studentId === S);

const allSelectedIds = new Set([...selected.values()].flatMap(set => [...set]));
function referencesSelected(value) {
  if (typeof value === 'string') return allSelectedIds.has(value);
  if (Array.isArray(value)) return value.some(referencesSelected);
  if (value && typeof value === 'object') return Object.values(value).some(referencesSelected);
  return false;
}
choose('idempotency_records', row => actors.has(row.actorUserId) || referencesSelected(row));
choose('operation_logs', row => actors.has(row.actorUserId) || referencesSelected(row));
choose('media_retention_jobs', row => referencesSelected(row));
choose('notification_events', row => referencesSelected(row));

// Retain account identities, current grants, class/parent relationships, public content,
// and migration history so the three accounts can be reused for acceptance.
const protectedTables = ['users', 'auth_identities', 'role_assignments', 'teacher_class_grants',
  'class_memberships', 'parent_student_links', 'native_admin_grants', 'organizations', 'classes',
  'migration_runs', 'org_content_guards', 'phonics_courses', 'task_templates'];
for (const name of protectedTables) {
  if ((selected.get(name)?.size ?? 0) !== 0) throw new Error(`PROTECTED_TABLE_SELECTED:${name}`);
}
const storageInventory = JSON.parse(readFileSync(join(folder, 'storage-inventory.json'), 'utf8'));
const storageByKey = new Map(storageInventory.map(item => [item.key, item]));
const mediaTables = ['pronunciation_recordings', 'task_recordings', 'student_works',
  'task_dubbing_works', 'review_voice_drafts', 'teacher_private_videos'];
const storageRefs = new Set();
function collectStorage(value, refs) {
  if (typeof value === 'string') {
    if (value.startsWith('cloud://')) refs.add(value.replace(/^cloud:\/\/[^/]+\//u, ''));
    return;
  }
  if (Array.isArray(value)) for (const item of value) collectStorage(item, refs);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStorage(item, refs);
}
for (const name of mediaTables) {
  for (const row of rows.get(name) ?? []) if (has(name, row._id)) collectStorage(row, storageRefs);
}
const preservedStorageRefs = new Set();
for (const [name, documents] of rows) {
  for (const row of documents) if (!has(name, row._id)) collectStorage(row, preservedStorageRefs);
}
const deletableStorage = [...storageRefs].filter(key => storageByKey.has(key)
  && !preservedStorageRefs.has(key)
  && /^(pronunciation\/private\/|review-voice\/private\/|teacher-videos\/(private|staging)\/|student-works\/|task-recordings\/|task-dubbing\/)/u.test(key));
const counts = Object.fromEntries([...selected].filter(([, ids]) => ids.size > 0)
  .map(([name, ids]) => [name, ids.size]));
const plan = { environmentId: manifest.environmentId, snapshotAt: manifest.capturedAt,
  accountIds: [S, T, P], selected: Object.fromEntries([...selected]
    .filter(([, ids]) => ids.size > 0).map(([name, ids]) => [name, [...ids].sort()])),
  expectedCounts: counts, storageKeys: deletableStorage.sort(),
  storageBytes: deletableStorage.reduce((sum, key) => sum + Number(storageByKey.get(key).size || 0), 0),
  storageRefsNotListed: [...storageRefs].filter(key => !storageByKey.has(key)).length,
  storageRefsPreserved: [...storageRefs].filter(key => preservedStorageRefs.has(key)).length,
  protectedTables };
const path = join(folder, 'cleanup-plan.json');
writeFileSync(path, JSON.stringify(plan), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ path, collectionCounts: counts,
  totalDocuments: Object.values(counts).reduce((sum, count) => sum + count, 0),
  storageObjects: plan.storageKeys.length, storageBytes: plan.storageBytes,
  storageRefsNotListed: plan.storageRefsNotListed,
  storageRefsPreserved: plan.storageRefsPreserved }));
