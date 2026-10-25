// Offline exact-ID cleanup plan for the just-published acceptance fixtures.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const folder = resolve(process.argv[2] ?? '');
if (!folder.includes('three-demo-cleanup-backup-2026-10-22T05-20-27-321Z')) throw new Error('SNAPSHOT_PATH_INVALID');
const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
if (manifest.environmentId !== 'cloud1-d8ggzrwwedb786e41' || Object.keys(manifest.collections).length !== 70) {
  throw new Error('SNAPSHOT_ENV_INVALID');
}
const rows = new Map();
for (const [name, entry] of Object.entries(manifest.collections)) {
  const bytes = readFileSync(join(folder, 'database', `${name}.json`));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`SNAPSHOT_HASH_MISMATCH:${name}`);
  }
  const data = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(data) || data.length !== entry.count) throw new Error(`SNAPSHOT_COUNT_MISMATCH:${name}`);
  rows.set(name, data);
}
const taskIds = [
  'task_client_accept_20261022_read_listen',
  'task_client_accept_20261022_video_exercise',
  'task_client_accept_20261022_speaking',
  'task_client_accept_20261022_vocab_exercise',
  'task_client_accept_20261022_textbook',
  'task_client_accept_20261022_pending',
  'task_client_accept_20261022_scored',
  'task_client_accept_20261022_returned',
];
const activityId = 'activity_client_accept_20261022_read_vocab';
const tasks = rows.get('tasks') ?? [];
const activities = rows.get('checkin_activities') ?? [];
if (taskIds.some(id => !tasks.some(row => row._id === id
  && row.creatorTeacherId === 'usr_teacher_demo_01' && row.visibility === 'visible'))
  || !activities.some(row => row._id === activityId
    && row.creatorTeacherId === 'usr_teacher_demo_01' && row.status === 'published')) {
  throw new Error('ACCEPTANCE_ROOTS_CHANGED');
}
const protectedNames = new Set(['users', 'auth_identities', 'role_assignments',
  'teacher_class_grants', 'class_memberships', 'parent_student_links',
  'native_admin_grants', 'organizations', 'classes', 'learning_resources',
  'phonics_courses', 'task_templates', 'migration_runs', 'org_content_guards']);
const selected = new Map([...rows.keys()].map(name => [name, new Set()]));
for (const id of taskIds) selected.get('tasks').add(id);
selected.get('checkin_activities').add(activityId);
function hasReference(value, ids) {
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) return value.some(item => hasReference(item, ids));
  if (value && typeof value === 'object') return Object.values(value).some(item => hasReference(item, ids));
  return false;
}
const directIds = new Set([...taskIds, activityId]);
for (const [name, documents] of rows) {
  if (protectedNames.has(name)) continue;
  for (const row of documents) {
    if (hasReference(row, directIds)
      || /client_accept_20261022|client_results_20261022/u.test(String(row._id ?? ''))
      || /client_accept_20261022|client_results_20261022/u.test(String(row.requestId ?? ''))
      || /client_accept_20261022|client_results_20261022/u.test(String(row.operationId ?? ''))) {
      selected.get(name).add(row._id);
    }
  }
}
// Follow assignment, submission, feedback, and operation references without expanding through user IDs.
for (let pass = 0; pass < 3; pass += 1) {
  const ids = new Set([...selected.values()].flatMap(set => [...set]));
  let added = 0;
  for (const [name, documents] of rows) {
    if (protectedNames.has(name)) continue;
    for (const row of documents) {
      if (!selected.get(name).has(row._id) && hasReference(row, ids)) {
        selected.get(name).add(row._id);
        added += 1;
      }
    }
  }
  if (added === 0) break;
}
for (const name of protectedNames) if (selected.get(name)?.size > 0) throw new Error(`PROTECTED_SELECTED:${name}`);
const counts = Object.fromEntries([...selected].filter(([, set]) => set.size > 0)
  .map(([name, set]) => [name, set.size]));
const mediaCollections = new Set(['pronunciation_recordings', 'task_recordings',
  'student_works', 'task_dubbing_works', 'review_voice_drafts', 'teacher_private_videos']);
const mediaRefs = new Set();
function cloudRefs(value, dest) {
  if (typeof value === 'string') {
    if (value.startsWith('cloud://')) dest.add(value.replace(/^cloud:\/\/[^/]+\//u, ''));
  } else if (Array.isArray(value)) for (const item of value) cloudRefs(item, dest);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) cloudRefs(item, dest);
}
for (const name of mediaCollections) {
  for (const row of rows.get(name) ?? []) if (selected.get(name).has(row._id)) cloudRefs(row, mediaRefs);
}
const preservedRefs = new Set();
for (const [name, documents] of rows) for (const row of documents) {
  if (!selected.get(name).has(row._id)) cloudRefs(row, preservedRefs);
}
const storage = JSON.parse(readFileSync(join(folder, 'storage-inventory.json'), 'utf8'));
const storageByKey = new Map(storage.map(row => [row.key, row]));
const deletableMedia = [...mediaRefs].filter(key => storageByKey.has(key) && !preservedRefs.has(key));
const plan = { environmentId: manifest.environmentId, snapshotAt: manifest.capturedAt,
  taskIds, activityId, selected: Object.fromEntries([...selected]
    .filter(([, set]) => set.size > 0).map(([name, set]) => [name, [...set].sort()])),
  counts, mediaKeys: deletableMedia.sort(), protectedNames: [...protectedNames] };
writeFileSync(join(folder, 'acceptance-removal-plan.json'), JSON.stringify(plan),
  { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ counts,
  totalDocuments: Object.values(counts).reduce((sum, count) => sum + count, 0),
  mediaObjects: deletableMedia.length,
  mediaBytes: deletableMedia.reduce((sum, key) => sum + Number(storageByKey.get(key).size || 0), 0) }));
