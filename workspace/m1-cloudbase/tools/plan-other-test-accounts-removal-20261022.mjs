// Offline exact-ID plan to retain only the three named virtual business users.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = 'C:/Users/18167/AppData/Local/Yarei/three-demo-cleanup-backup-2026-10-22T05-41-58-168Z';
const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
if (manifest.environmentId !== 'cloud1-d8ggzrwwedb786e41'
  || Object.keys(manifest.collections).length !== 70) throw new Error('SNAPSHOT_GATE');
const rows = new Map();
for (const [name, entry] of Object.entries(manifest.collections)) {
  const bytes = readFileSync(join(folder, 'database', `${name}.json`));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`SNAPSHOT_HASH_MISMATCH:${name}`);
  }
  const documents = JSON.parse(bytes.toString('utf8'));
  if (documents.length !== entry.count) throw new Error(`SNAPSHOT_COUNT_MISMATCH:${name}`);
  rows.set(name, documents);
}
const retained = ['usr_student_g3_01', 'usr_teacher_demo_01', 'usr_parent_demo_01'];
const retainedSet = new Set(retained);
const allUsers = rows.get('users');
const removedUsers = allUsers.filter(row => !retainedSet.has(row._id));
if (allUsers.length !== 542 || removedUsers.length !== 539
  || retained.some(id => !allUsers.some(row => row._id === id && row.status === 'active'))
  || removedUsers.some(row => !row._id.startsWith('usr_')
    || !['org_qihang_demo', 'org_isolation_secondary'].includes(row.organizationId))) {
  throw new Error('USER_SET_CHANGED');
}
const userIds = new Set(removedUsers.map(row => row._id));
const selected = new Map([...rows.keys()].map(name => [name, new Set()]));
function choose(name, predicate) {
  for (const row of rows.get(name) ?? []) if (predicate(row)) selected.get(name).add(row._id);
}
choose('users', row => userIds.has(row._id));
choose('auth_identities', row => userIds.has(row.userId));
choose('role_assignments', row => userIds.has(row.userId));
choose('class_memberships', row => userIds.has(row.studentId));
choose('teacher_class_grants', row => userIds.has(row.teacherId));
choose('native_admin_grants', row => userIds.has(row.teacherId));
choose('parent_student_links', row => userIds.has(row.parentId) || userIds.has(row.studentId));
choose('business_sessions', row => userIds.has(row.userId));
choose('business_session_slots', row => userIds.has(row.userId));
choose('binding_codes', row => userIds.has(row.studentId)
  || userIds.has(row.createdBy) || userIds.has(row.usedByParentId));
choose('notification_read_states', row => userIds.has(row.userId));
choose('org_content_guards', row => typeof row.guardKey === 'string'
  && [...userIds].some(id => row.guardKey.includes(id)));
choose('idempotency_records', row => userIds.has(row.actorUserId));
for (const name of ['phonics_answer_operations', 'phonics_answers',
  'pronunciation_operations', 'pronunciation_recordings',
  'reading_page_events', 'reading_progress', 'review_voice_drafts',
  'review_voice_operations', 'student_work_operations', 'student_works',
  'task_dubbing_work_operations', 'task_dubbing_works',
  'task_recording_operations', 'task_recordings',
  'task_media_operations', 'task_media_sessions',
  'vocabulary_attempt_operations', 'vocabulary_attempts', 'vocabulary_progress']) {
  choose(name, row => userIds.has(row.studentId) || userIds.has(row.teacherId)
    || userIds.has(row.actorId) || userIds.has(row.actorUserId));
}
choose('teacher_ai_suggestions', row => userIds.has(row.teacherId));
choose('teacher_private_videos', row => userIds.has(row.ownerTeacherId));
choose('tasks', row => userIds.has(row.creatorTeacherId));
choose('checkin_activities', row => userIds.has(row.creatorTeacherId));
choose('task_assignments', row => userIds.has(row.studentId));
choose('submissions', row => userIds.has(row.studentId));
choose('review_feedback', row => userIds.has(row.teacherId));

const protectedNames = ['organizations', 'classes', 'learning_resources',
  'operation_logs', 'migration_runs', 'task_templates', 'phonics_courses'];
for (const name of protectedNames) if (selected.get(name).size !== 0) {
  throw new Error(`PROTECTED_TABLE_SELECTED:${name}`);
}
const retainedRoles = rows.get('role_assignments').filter(row => retainedSet.has(row.userId));
const retainedLinks = rows.get('parent_student_links').filter(row => !selected.get('parent_student_links').has(row._id));
if (retainedRoles.length !== 3 || retainedLinks.length !== 1
  || retainedLinks[0].parentId !== 'usr_parent_demo_01'
  || retainedLinks[0].studentId !== 'usr_student_g3_01') {
  throw new Error('RETAINED_RELATIONSHIP_GATE');
}
const counts = Object.fromEntries([...selected].filter(([, set]) => set.size > 0)
  .map(([name, set]) => [name, set.size]));
const plan = { environmentId: manifest.environmentId, snapshotAt: manifest.capturedAt,
  retained, removedUserIds: [...userIds].sort(),
  selected: Object.fromEntries([...selected].filter(([, set]) => set.size > 0)
    .map(([name, set]) => [name, [...set].sort()])),
  counts, protectedNames, expectedAuthAliases: ['demo_student_01', 'demo_teacher_01', 'demo_parent_01', 'administrator'] };
writeFileSync(join(folder, 'other-test-accounts-removal-plan.json'), JSON.stringify(plan),
  { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ userCount: removedUsers.length,
  byStatus: Object.fromEntries([...new Set(removedUsers.map(row => row.status))]
    .map(status => [status, removedUsers.filter(row => row.status === status).length])),
  counts, totalDocuments: Object.values(counts).reduce((sum, count) => sum + count, 0),
  retainedRoles: retainedRoles.length, retainedParentLinks: retainedLinks.length }));
