// Read-only, redacted inventory for replacing fictional English teaching materials.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const targets = [
  'res_m3_sbc0008_review_draft_20261002',
  'res_formal_sbc0008_v1_20261007',
  'res_m3_real_sbc0008_reading_20260930',
  'res_m3_original_feelings_draft_20261003',
  'res_m3_pep3a_u2_real_vocabulary_20261005',
  'res_m3_peter_rabbit_real_question_20261005',
  'res_m3_peter_rabbit_listening_auto_20261005',
  'res_m3_sbc0008_video_auto_20261005',
  'res_m3_sbc0008_dubbing_auto_20261005',
  'res_m3_sbc0008_real_recording_20261005',
  'res_reading_zoo_cloud_v2',
  'res_reading_zoo_demo',
  'res_vocabulary_animals_cloud_v1',
  'res_m2_exercise_animals_choice_demo',
];
function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const at = raw.indexOf('{');
  if (at < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(at));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const line = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(item => item.startsWith('TCB_ENV_ID='));
const envId = line?.slice(11).trim();
const envs = call(['env', 'list', '--json']);
if (!envId || envId !== config.envId || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].PackageName !== '个人版'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no') {
  throw new Error('NONPRODUCTION_ENV_GATE');
}
const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== envId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) throw new Error('TEMP_TOKEN_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId, secretId: token.secretId,
  secretKey: token.secretKey, sessionToken: token.token });
const db = app.database();
const rows = [];
for (let offset = 0; offset < 5000; offset += 100) {
  const page = await db.collection('learning_resources').skip(offset).limit(100).get();
  rows.push(...page.data);
  if (page.data.length < 100) break;
}
if (rows.length >= 5000) throw new Error('RESOURCE_LIMIT');
const byId = new Map(rows.map(row => [row._id, row]));
const tasks = await db.collection('tasks').limit(1000).get();
const launchTasks = tasks.data.filter(task => task._id?.startsWith('task_launch_'));
const launchTaskStatus = { total: launchTasks.length,
  recycled: launchTasks.filter(task => task.visibility === 'recycled').length,
  visible: launchTasks.filter(task => task.visibility !== 'recycled').map(task => task._id) };
const activeTaskReferences = Object.fromEntries(targets.map(id => [id,
  tasks.data.filter(task => task.deletedAt === null && task.visibility !== 'recycled'
    && task.status !== 'withdrawn'
    && (task.itemRefs?.some(item => item.resourceId === id)
      || task.items?.some(item => item.resourceId === id || item.resourceSnapshot?.id === id)))
    .map(task => task._id)]));
const referencedTaskIds = new Set(Object.values(activeTaskReferences).flat());
const referencedTaskSummaries = tasks.data.filter(task => referencedTaskIds.has(task._id))
  .map(task => ({ id: task._id, status: task.status, visibility: task.visibility,
    title: task.title, createdBy: task.teacherId ?? task.createdBy ?? null,
    startsAt: task.startsAt ?? null, dueAt: task.dueAt ?? null,
    targetCount: task.targetStudentIds?.length ?? null,
    itemRefs: task.itemRefs?.map(item => ({ resourceId: item.resourceId,
      completionRule: item.completionRule, scoringRule: item.scoringRule,
      order: item.order })) ?? [] }));
const summary = {};
for (const row of rows) {
  const key = `${row.type ?? 'unknown'}:${row.status ?? 'unknown'}`;
  summary[key] = (summary[key] ?? 0) + 1;
}
const targetRows = targets.map(id => {
  const row = byId.get(id);
  return row ? { id, type: row.type ?? null, status: row.status ?? null,
    version: row.version ?? null, organization: row.organizationId ?? null,
    globalSource: row.globalCatalogSource === true, globalProjection: row.globalCatalogProjection === true,
    publicSource: row.publicCatalogSource === true,
    publicProjection: row.publicLearningProjection === true,
    reviewStatus: row.payload?.assetLibrary?.reviewStatus ?? null,
    testOnly: row.payload?.testOnly === true || row.testOnly === true }
    : { id, missing: true };
});
process.stdout.write(JSON.stringify({ environment: 'verified_nonproduction', total: rows.length,
  byTypeStatus: summary, targets: targetRows,
  publishedRecords: rows.filter(row => row.status === 'published').map(row => ({
    id: row._id, type: row.type, title: row.title ?? null,
    sourceType: row.payload?.sourceType ?? null,
    testOnly: row.payload?.testOnly === true || row.testOnly === true,
    globalSource: row.globalCatalogSource === true,
    globalProjection: row.globalCatalogProjection === true,
  })),
  targetShapes: targetRows.filter(row => !row.missing).map(target => {
    const row = byId.get(target.id);
    return { id: target.id, topKeys: Object.keys(row).sort(),
      payloadKeys: Object.keys(row.payload ?? {}).sort(),
      assetLibraryKeys: Object.keys(row.payload?.assetLibrary ?? {}).sort(),
      contentKeys: Object.keys(row.payload?.content ?? {}).sort(),
      mediaKeys: Object.keys(row.payload?.media ?? {}).sort(),
      reviewStatus: row.reviewStatus ?? row.payload?.reviewStatus ?? row.payload?.assetLibrary?.reviewStatus ?? null,
      acceptanceStatus: row.acceptanceStatus ?? row.payload?.acceptanceStatus ?? null,
      copyrightStatus: row.copyrightStatus ?? null,
      sourceBookEdition: row.sourceBookEdition ?? null,
      unresolvedFields: row.unresolvedFields ?? row.payload?.unverifiedFields ?? null,
      pageCount: row.pages?.length ?? row.payload?.chapters?.flatMap(chapter => chapter.pages ?? []).length ?? null,
      wordCount: row.words?.length ?? row.payload?.words?.length ?? null,
      mediaKind: row.payload?.teacherMedia?.kind ?? null,
      mediaQuestionCount: row.payload?.teacherMedia?.questions?.length ?? null };
  }), activeTaskReferences, referencedTaskSummaries, launchTaskStatus, cloudWrites: 0 }) + '\n');
