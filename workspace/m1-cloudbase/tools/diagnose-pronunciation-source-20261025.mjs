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
const {Module}=await import('node:module');
const code=require('esbuild').buildSync({stdin:{contents:`export {DocumentPronunciationSource} from './src/pronunciation/source-adapter'; export {FreshPronunciationWorkerIdentity} from './src/pronunciation/worker-identity-adapter'; export {createCloudBaseDocumentDatabase} from './src/repositories/cloudbase-document-database'; export {createIdentityDocumentRepository} from './src/repositories/identity-session-document-adapter'; export {createTaskQueryDocumentRepository} from './src/repositories/task-query-document-adapter'; export {createLearningProgressDocumentRepository} from './src/repositories/learning-progress-document-adapter';`,resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false});
const mod=new Module(resolve(root,'.runtime/voice-diagnosis-current.cjs')); mod.filename=mod.id;mod.paths=Module._nodeModulePaths(root);mod._compile(code.outputFiles[0].text,mod.filename);
const api=mod.exports, documents=api.createCloudBaseDocumentDatabase(db), identities=api.createIdentityDocumentRepository(documents), clock={nowIso:()=>new Date().toISOString()};
const source=new api.DocumentPronunciationSource(api.createTaskQueryDocumentRepository(documents),api.createLearningProgressDocumentRepository(documents),documents,identities,clock);
const workerIdentity=new api.FreshPronunciationWorkerIdentity(identities);
const remoteCode=readFileSync(resolve(root,'.runtime/pronunciation-wait-20261025/pronunciation-worker.js'),'utf8').replace('installCloudBaseNodeDeploymentFromEnvironment();','')+'\nmodule.exports.diagnostic={DocumentPronunciationSource,FreshPronunciationWorkerIdentity,createLearningProgressDocumentRepository};';
const remoteModule=new Module(resolve(root,'.runtime/voice-remote-diagnostic.cjs'));remoteModule.filename=remoteModule.id;remoteModule.paths=Module._nodeModulePaths(root);remoteModule._compile(remoteCode,remoteModule.filename);
const remote=remoteModule.exports.diagnostic;
const oldSource=new remote.DocumentPronunciationSource(api.createTaskQueryDocumentRepository(documents),remote.createLearningProgressDocumentRepository(documents),documents,identities,clock);
const rows=(await db.collection('pronunciation_recordings').where({organizationId:'org_qihang_demo'}).orderBy('createdAt','desc').limit(8).get()).data;
const output=[];
for(const row of rows){
const actor=await workerIdentity.currentStudent(row.organizationId,row.studentId,row.platformSubjectDigest??'');
let current=false, resolveError=null, changedFields=[];
if(actor){try{const resolved=await source.resolve(actor,{kind:'reading',resourceId:row.source.resourceId,segmentId:row.source.segmentId},true);changedFields=[...new Set([...Object.keys(row.source),...Object.keys(resolved)])].filter(k=>JSON.stringify(row.source[k])!==JSON.stringify(resolved[k]));current=await source.currentForScoring(actor,row);}catch(e){resolveError=e.code??e.name;}}
let remoteSourceCurrent=actor?await oldSource.currentForScoring(actor,row):false;let remoteError=null;try{if(actor)await oldSource.resolve(actor,{kind:'reading',resourceId:row.source.resourceId,segmentId:row.source.segmentId},true);}catch(e){remoteError=e.code??e.name;}output.push({remoteSourceCurrent,remoteError,createdAt:row.createdAt,status:row.status,identityValid:!!actor,authzVersionMatches:actor?.authzVersion===row.scoreAuthzVersion,sourceCurrent:current,changedFields,resolveError});}
console.log(JSON.stringify(output,null,2));