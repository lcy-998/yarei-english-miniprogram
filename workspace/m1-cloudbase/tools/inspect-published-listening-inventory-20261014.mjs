// Read-only, redacted inventory of currently published listening question counts.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';

function call(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) throw new Error('CLOUD_JSON_MISSING');
  const result = JSON.parse(raw.slice(jsonStart));
  if (result.error) throw new Error('CLOUD_API_ERROR');
  return result.data;
}

const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const configuredEnvId = (await readFile(join(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const environments = call(['env', 'list', '--json']);
if (!configuredEnvId || configuredEnvId !== config.envId || environments.length !== 1
  || environments[0].EnvId !== configuredEnvId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版' || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no' || environments[0].EnableOverrun !== false) {
  throw new Error('NONPRODUCTION_ENV_GATE');
}

const token = call(['secrets', 'get', '--json']);
if (token?.isTemporary !== true || token.envId !== configuredEnvId
  || Date.parse(token.expiredAt) <= Date.now() + 60000) {
  throw new Error('TEMP_TOKEN_GATE');
}

const app = require('@cloudbase/node-sdk').init({
  env: configuredEnvId,
  secretId: token.secretId,
  secretKey: token.secretKey,
  sessionToken: token.token,
});
const database = app.database();
const resources = [];
for (let offset = 0; offset < 5000; offset += 100) {
  const page = await database.collection('learning_resources').skip(offset).limit(100).get();
  resources.push(...page.data);
  if (page.data.length < 100) break;
}
if (resources.length >= 5000) throw new Error('RESOURCE_LIMIT');
const tasks = (await database.collection('tasks').limit(1000).get()).data;
const items = resources.filter(row => row.type === 'listening' && row.status === 'published')
  .map(row => {
    const sourceId = row.payload?.assetLibrary?.sourcePublicId
      ?? row.payload?.assetLibrary?.sourceResourceId
      ?? row._id;
    const questions = row.payload?.teacherMedia?.questions ?? row.payload?.questions ?? [];
    const references = tasks.filter(task => task.deletedAt === null
      && task.visibility !== 'recycled' && task.status !== 'withdrawn'
      && (task.itemRefs?.some(item => item.resourceId === row._id || item.resourceId === sourceId)
        || task.items?.some(item => item.resourceId === row._id
          || item.resourceId === sourceId || item.resourceSnapshot?.id === sourceId)));
    return {
      id: row._id,
      sourceId,
      title: row.title ?? null,
      version: row.version ?? null,
      questionCount: questions.length,
      testOnly: row.payload?.testOnly === true || row.testOnly === true,
      activeTaskReferenceCount: references.length,
    };
  });

process.stdout.write(JSON.stringify({
  environment: 'verified_nonproduction',
  publishedListeningRecordCount: items.length,
  items,
  cloudWrites: 0,
}) + '\n');
