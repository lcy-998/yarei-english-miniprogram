// Offline, read-only account classification from the current private snapshot.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = 'C:/Users/18167/AppData/Local/Yarei/three-demo-cleanup-backup-2026-10-22T05-41-58-168Z';
const read = name => JSON.parse(readFileSync(join(folder, 'database', `${name}.json`), 'utf8'));
const users = read('users');
const roles = read('role_assignments');
const auth = read('auth_identities');
const retain = new Set(['usr_student_g3_01', 'usr_teacher_demo_01', 'usr_parent_demo_01']);
const rolesByUser = new Map();
for (const row of roles) {
  if (!rolesByUser.has(row.userId)) rolesByUser.set(row.userId, []);
  rolesByUser.get(row.userId).push(row.role);
}
const groups = {};
for (const row of users) {
  const label = retain.has(row._id) ? 'retain_three'
    : row._id.startsWith('usr_capacity_') ? 'capacity_student'
      : (rolesByUser.get(row._id) ?? []).join('+') || 'no_role';
  groups[label] = (groups[label] ?? 0) + 1;
}
const nonStudent = users.filter(row => !retain.has(row._id)
  && (rolesByUser.get(row._id) ?? []).some(role => role !== 'student'));
console.log(JSON.stringify({ users: users.length, roles: roles.length,
  authIdentities: auth.length, groups,
  nonStudentAccounts: nonStudent.map(row => ({ id: row._id,
    roles: rolesByUser.get(row._id), organizationId: row.organizationId,
    status: row.status, hasAuthIdentity: auth.some(identity => identity.userId === row._id) })),
  capacityIdExamples: users.filter(row => row._id.startsWith('usr_capacity_'))
    .slice(0, 3).map(row => row._id),
  noRoleExamples: users.filter(row => !rolesByUser.has(row._id)).slice(0, 4)
    .map(row => ({ id: row._id, status: row.status, organizationId: row.organizationId })) }));
