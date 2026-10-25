// Read-only diagnosis for the fictional Shakespeare listening task. Never print answers or credentials.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envId = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice('TCB_ENV_ID='.length).trim();
if (envId !== 'cloud1-d8ggzrwwedb786e41' || config.envId !== envId) {
  throw new Error('NONPRODUCTION_ENVIRONMENT_MISMATCH');
}
function call(args) {
  let raw;
  try { raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }); } catch { throw new Error('CLOUD_PREFLIGHT_UNAVAILABLE'); }
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_UNAVAILABLE');
  const parsed = JSON.parse(raw.slice(at));
  if (parsed.error) throw new Error(`CLOUD_API_${parsed.error.code ?? 'FAILED'}`);
  return parsed.data;
}
const env = call(['env', 'list', '--json']);
if (!Array.isArray(env) || env.length !== 1 || env[0].EnvId !== envId
  || env[0].Status !== 'NORMAL' || env[0].EnvPaid !== 'no'
  || env[0].EnvCharged !== 'no' || env[0].EnableOverrun !== false) {
  throw new Error('NONPRODUCTION_COST_GATE');
}
const credentials = call(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) {
  throw new Error('TEMPORARY_CREDENTIALS_INVALID');
}
const require = createRequire(resolve(root, 'package.json'));
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token });
const db = app.database();
const resourceId = 'res_voa_lle1_l13_listening_formal_v1';
const row = await db.collection('learning_resources').doc(resourceId).get();
const resource = Array.isArray(row.data) ? row.data[0] : row.data;
const candidate = resource?.payload?.teacherMedia;
const result = { resource: { exists: Boolean(resource), status: resource?.status ?? null,
  title: resource?.title ?? null, contentVersion: resource?.contentVersion ?? null,
  questionIds: candidate?.questionIds ?? null,
  renderedQuestionIds: Array.isArray(candidate?.questions)
    ? candidate.questions.map(question => question.questionId) : null,
  questionTypes: Array.isArray(candidate?.questions)
    ? candidate.questions.map(question => question.questionType) : null }, tasks: [], assignments: [] };
for (const organizationId of ['org_qihang_demo', 'org_secondary_demo']) {
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await db.collection('tasks').where({ organizationId }).skip(offset).limit(100).get();
    const tasks = Array.isArray(page.data) ? page.data : [];
    for (const task of tasks) {
      for (const item of task.items ?? []) {
        if (item.resourceId !== resourceId && !String(item.title ?? '').includes('William Shakespeare')) continue;
        result.tasks.push({ organizationId, taskId: task._id,
          taskStatus: task.status, visibility: task.visibility,
          itemId: item.id, itemTitle: item.title, resourceId: item.resourceId,
          snapshotQuestionIds: item.mediaSnapshot?.questionIds ?? null,
          snapshotRenderedIds: item.mediaSnapshot?.questions?.map(question => question.questionId) ?? null,
          snapshotQuestionTypes: item.mediaSnapshot?.questions?.map(question => question.questionType) ?? null,
          snapshotVersion: item.mediaSnapshot?.mediaVersion ?? null });
        const assignmentPage = await db.collection('task_assignments')
          .where({ organizationId, taskId: task._id }).limit(100).get();
        const assignments = Array.isArray(assignmentPage.data) ? assignmentPage.data : [];
        for (const assignment of assignments) {
          const submissionPage = await db.collection('submissions')
            .where({ organizationId, assignmentId: assignment._id }).limit(10).get();
          const submissions = Array.isArray(submissionPage.data) ? submissionPage.data : [];
          result.assignments.push({ assignmentStatus: assignment.status,
            redoCount: assignment.redoCount ?? null, submissionSummaries: submissions.map(submission => ({
              status: submission.status, version: submission.version,
              mediaAnswerCount: (submission.answers ?? []).filter(answer =>
                answer.taskItemId === item.id && answer.structuredValue?.kind === 'listening')
                .flatMap(answer => answer.structuredValue.questionResponses ?? []).length,
            })) });
        }
      }
    }
    if (tasks.length < 100) break;
  }
}
process.stdout.write(JSON.stringify(result) + '\n');
