// Read-only, redacted readiness check for T-08 voice feedback in the existing nonproduction environment.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (!envId || envId !== config.envId || envId !== 'cloud1-d8ggzrwwedb786e41') {
  throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
}
const raw = execFileSync(process.execPath, [cli, 'secrets', 'get', '--json'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
  maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const credentials = JSON.parse(raw.slice(raw.indexOf('{'))).data;
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60000) throw new Error('TEMPORARY_CREDENTIALS_INVALID');
const database = createRequire(resolve(root, 'package.json'))('@cloudbase/node-sdk').init({
  env: envId, secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token,
}).database();
const collections = ['review_voice_drafts', 'review_voice_operations'];
const results = [];
for (const name of collections) {
  try {
    const response = await database.collection(name).limit(1).get();
    results.push({ name, readable: Array.isArray(response.data), errorCode: null });
  } catch (error) {
    results.push({ name, readable: false,
      errorCode: typeof error?.code === 'string' ? error.code : 'UNKNOWN' });
  }
}
const organizationId = 'org_qihang_demo';
const teacherId = 'usr_teacher_demo_01';
const classId = 'cls_grade3_2';
const [grants, assignments] = await Promise.all([
  database.collection('teacher_class_grants').where({ organizationId, teacherId,
    classId, status: 'active', deletedAt: null }).limit(10).get(),
  database.collection('task_assignments').where({ organizationId, classId,
    status: 'awaiting_review', deletedAt: null }).limit(20).get(),
]);
process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction', collections: results,
  virtualTeacherReviewGrant: Array.isArray(grants.data) && grants.data.some(row =>
    Array.isArray(row.permissions) && row.permissions.includes('submission.review')),
  pendingVirtualAssignments: Array.isArray(assignments.data) ? assignments.data.length : null,
  identifiersOrCredentialsPrinted: false }) + '\n');
