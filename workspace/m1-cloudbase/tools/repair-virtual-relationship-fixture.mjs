import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import tcb from '@cloudbase/node-sdk';

const environment = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/u).flatMap((line) => {
  const separator = line.indexOf('=');
  return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
}));
const rawSecrets = execFileSync(process.execPath, ['D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb', 'secrets', 'get', '--json'], { encoding: 'utf8' });
const firstJson = Math.min(...[rawSecrets.indexOf('{'), rawSecrets.indexOf('[')].filter((index) => index >= 0));
const credentials = JSON.parse(rawSecrets.slice(firstJson)).data;
const database = tcb.init({
  env: environment.TCB_ENV_ID,
  secretId: credentials.secretId,
  secretKey: credentials.secretKey,
  sessionToken: credentials.token,
}).database();

const organizationId = 'org_qihang_demo';
const studentId = 'usr_student_g3_02';
const parentId = 'usr_parent_demo_01';
const studentNumber = 'STU-G3-002';
const now = new Date().toISOString();

await retryTransaction(async () => database.runTransaction(async (transaction) => {
  const [studentResult, parentRoleResult] = await Promise.all([
    transaction.collection('users').doc(studentId).get(),
    transaction.collection('role_assignments').where({ organizationId, userId: parentId, role: 'parent', status: 'active' }).get(),
  ]);
  const student = first(studentResult.data);
  const parentRole = first(parentRoleResult.data);
  if (!student || student.organizationId !== organizationId || student.status !== 'active') throw new Error('VIRTUAL_STUDENT_NOT_READY');
  if (!parentRole || parentRole.organizationId !== organizationId) throw new Error('VIRTUAL_PARENT_ROLE_NOT_READY');
  if (student.studentNumber !== studentNumber) {
    await transaction.collection('users').doc(studentId).update({
      studentNumber,
      authorizationVersion: numeric(student.authorizationVersion, 1) + 1,
      updatedAt: now,
    });
  }
  const permissions = new Set(Array.isArray(parentRole.permissions) ? parentRole.permissions : []);
  permissions.add('child.read');
  permissions.add('child.bind');
  permissions.add('child.unbind');
  if (permissions.size !== (Array.isArray(parentRole.permissions) ? parentRole.permissions.length : 0)) {
    await transaction.collection('role_assignments').doc(parentRole._id).update({
      permissions: [...permissions],
      version: numeric(parentRole.version, 1) + 1,
      updatedAt: now,
    });
    const parentResult = await transaction.collection('users').doc(parentId).get();
    const parent = first(parentResult.data);
    if (!parent || parent.organizationId !== organizationId || parent.status !== 'active') throw new Error('VIRTUAL_PARENT_NOT_READY');
    await transaction.collection('users').doc(parentId).update({
      authorizationVersion: numeric(parent.authorizationVersion, 1) + 1,
      updatedAt: now,
    });
  }
}));

process.stdout.write('VIRTUAL_RELATIONSHIP_FIXTURE=ready\n');

function first(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value !== null && typeof value === 'object' ? value : null;
}
function numeric(value, fallback) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }

async function retryTransaction(work) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await work(); } catch (error) {
      if (attempt === 3 || !String(error?.code ?? '').includes('DATABASE_TRANSACTION_FAIL')) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
}
