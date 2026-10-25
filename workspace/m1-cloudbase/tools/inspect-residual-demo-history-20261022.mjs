// Offline review of old account-targeted audit and revoked relationship rows.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const folder = resolve(process.argv[2] ?? '');
if (!folder.includes('three-demo-cleanup-backup-2026-10-22T03-12-37-348Z')) throw new Error('FOLDER_INVALID');
const rows = name => JSON.parse(readFileSync(join(folder, 'database', `${name}.json`), 'utf8'));
const ids = new Set(['usr_student_g3_01', 'usr_teacher_demo_01', 'usr_parent_demo_01']);
const cutoff = Date.parse('2026-10-22T02:42:12.511Z');
const oldLogs = rows('operation_logs').filter(row => {
  const at = Date.parse(row.occurredAt ?? '');
  if (!Number.isFinite(at) || at >= cutoff) return false;
  const metadata = row.metadata ?? {};
  return ids.has(row.actorUserId) || ids.has(row.targetId)
    || ['teacherId', 'studentId', 'parentId', 'userId'].some(key => ids.has(metadata[key]));
});
const revokedLinks = rows('parent_student_links').filter(row =>
  row.parentId === 'usr_parent_demo_01' && row.status === 'revoked');
console.log(JSON.stringify({ oldLogs: oldLogs.length,
  byAction: Object.fromEntries([...new Set(oldLogs.map(row => row.action))]
    .map(action => [action, oldLogs.filter(row => row.action === action).length])),
  ids: oldLogs.map(row => row._id), revokedLinks: revokedLinks.map(row => row._id) }));
