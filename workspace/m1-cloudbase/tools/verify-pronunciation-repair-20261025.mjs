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
const {Module}=await import('node:module');const {createHash,randomUUID}=await import('node:crypto');
const exports=`export {DocumentPronunciationSource} from './src/pronunciation/source-adapter'; export {FreshPronunciationWorkerIdentity} from './src/pronunciation/worker-identity-adapter'; export {createCloudBaseDocumentDatabase} from './src/repositories/cloudbase-document-database'; export {createIdentityDocumentRepository} from './src/repositories/identity-session-document-adapter'; export {createTaskQueryDocumentRepository} from './src/repositories/task-query-document-adapter'; export {createLearningProgressDocumentRepository} from './src/repositories/learning-progress-document-adapter'; export {PronunciationService} from './src/pronunciation/service'; export {DocumentPronunciationRepository} from './src/pronunciation/document-repository'; export {CloudBasePronunciationSeal} from './src/pronunciation/cloudbase-adapters'; export {PronunciationAsyncJobService} from './src/pronunciation/async-job-service'; export {HmacPronunciationJobDispatcher} from './src/pronunciation/job-wire'; export {DirectScfPronunciationTransport} from './src/pronunciation/scf-direct-transport';`;
const code=require('esbuild').buildSync({stdin:{contents:exports,resolveDir:root},bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const mod=new Module(resolve(root,'.runtime/voice-repair-selftest.cjs'));mod.filename=mod.id;mod.paths=Module._nodeModulePaths(root);mod._compile(code.outputFiles[0].text,mod.filename);
const api=mod.exports, documents=api.createCloudBaseDocumentDatabase(db),identities=api.createIdentityDocumentRepository(documents),clock={nowIso:()=>new Date().toISOString()};
const sources=new api.DocumentPronunciationSource(api.createTaskQueryDocumentRepository(documents),api.createLearningProgressDocumentRepository(documents),documents,identities,clock);
const workerIdentities=new api.FreshPronunciationWorkerIdentity(identities),records=new api.DocumentPronunciationRepository(documents);
const recent=(await db.collection('pronunciation_recordings').where({organizationId:'org_qihang_demo'}).orderBy('createdAt','desc').limit(1).get()).data[0];
const actor=await workerIdentities.currentStudent(recent.organizationId,recent.studentId,recent.platformSubjectDigest);
if(!actor)throw new Error('DEMO_ACTOR_UNAVAILABLE');
const unique=()=>`voicecheck_${randomUUID().replaceAll('-','')}`;
const asActor=()=>({...actor,requestId:unique()});
const service=new api.PronunciationService(records,sources,new api.CloudBasePronunciationSeal(app,envId),null,null,clock,{next:unique});
const detail=call(['fn','detail','pronunciation-worker','--json']);const vars=Object.fromEntries(detail.Environment.Variables.map(v=>[v.Key,v.Value]));
const transport=new api.DirectScfPronunciationTransport({secretId:credentials.secretId,secretKey:credentials.secretKey,sessionToken:credentials.token},'ap-shanghai',envId);
const dispatcher=new api.HmacPronunciationJobDispatcher(transport,vars.VOICE_INTERNAL_SECRET,{nowUnix:()=>Math.floor(Date.now()/1000)});
const jobs=new api.PronunciationAsyncJobService(records,sources,dispatcher,{infer:async()=>{throw new Error('LOCAL_INFERENCE_FORBIDDEN');}},workerIdentities,clock,Number(vars.VOICE_WORKER_LEASE_MS));
if(['probe-worker','probe-event'].includes(process.argv[2])){
 const saved=JSON.parse(readFileSync(resolve(root,'.runtime/pronunciation-wait-20261025/selftest-id.json'),'utf8'));
 const row=(await db.collection('pronunciation_recordings').doc(saved.recordingId).get()).data[0];
 if(!row||!row.id.startsWith('voicecheck_')||row.studentId!==actor.actorUserId)throw new Error('SELFTEST_RECORD_MISMATCH');
 const direct=new api.HmacPronunciationJobDispatcher({invokeEvent:async(name,event)=>{
 const response=await transport.send(name,event,process.argv[2]==='probe-event'?'Event':'RequestResponse',290000);const result=response.Result;let body;try{body=JSON.parse(result?.RetMsg??'null');}catch{}
 console.log(JSON.stringify({invokeResult:result?.InvokeResult,returnKeys:body?Object.keys(body):[],resultKeys:result?Object.keys(result):[],errorMessage:result?.ErrMsg,ok:body?.ok,status:body?.status,code:body?.code,error:body?.error?.code,score:body?.score??body?.data?.score}));
 }},vars.VOICE_INTERNAL_SECRET,{nowUnix:()=>Math.floor(Date.now()/1000)});
 await direct.dispatch({organizationId:row.organizationId,studentId:row.studentId,recordingId:row.id,operationId:row.scoreOperationId});
 const view=await service.getScore(asActor(),row.id);console.log(JSON.stringify({status:view.status,score:view.score}));process.exit(0);
}
if(process.argv[2]==='probe-qualified-event'){
 const pending=(await db.collection('pronunciation_recordings').where({organizationId:actor.organizationId,studentId:actor.actorUserId,status:'processing'}).limit(1).get()).data[0];
 if(!pending)throw new Error('NO_PENDING');
 const {AbstractClient}=require('tencentcloud-sdk-nodejs-common');const scf=new AbstractClient('scf.tencentcloudapi.com','2018-04-16',{credential:{secretId:credentials.secretId,secretKey:credentials.secretKey,token:credentials.token},region:'ap-shanghai'});
 const direct=new api.HmacPronunciationJobDispatcher({invokeEvent:async(name,event)=>{const r=await scf.request('Invoke',{FunctionName:name,Namespace:envId,Qualifier:'$LATEST',InvocationType:'Event',ClientContext:JSON.stringify(event)});console.log(JSON.stringify({accepted:r.Result?.InvokeResult===0}));}},vars.VOICE_INTERNAL_SECRET,{nowUnix:()=>Math.floor(Date.now()/1000)});
 await direct.dispatch({organizationId:pending.organizationId,studentId:pending.studentId,recordingId:pending.id,operationId:pending.scoreOperationId});
 for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,2000));const row=(await db.collection('pronunciation_recordings').doc(pending.id).get()).data[0];if(row.workerInvocationCount>0){console.log(JSON.stringify({claimed:true,status:row.status}));process.exit(0);}}
 console.log(JSON.stringify({claimed:false}));process.exit(2);
}
if(process.argv[2]==='verify-query'){
 const saved=JSON.parse(readFileSync(resolve(root,'.runtime/pronunciation-wait-20261025/selftest-id.json'),'utf8'));
 const remoteCode=readFileSync(resolve(root,'.runtime/pronunciation-wait-20261025/readback/pronunciation-query/index.js'),'utf8').replace('installCloudBaseNodeDeploymentFromEnvironment();','')+'\nmodule.exports.QueryService=PronunciationService;';
 const remote=new Module(resolve(root,'.runtime/voice-query-readback.cjs'));remote.filename=remote.id;remote.paths=Module._nodeModulePaths(root);remote._compile(remoteCode,remote.filename);
 const query=new remote.exports.QueryService(records,sources,null,null,null,clock,{next:unique});
 const score=await query.getScore(asActor(),saved.recordingId),history=await query.listAttempts(asActor(),saved.source),works=await query.listMyWorks(asActor(),{limit:30,cursor:null});const work=works.items.find(w=>w.scoreId===saved.recordingId);
 const pending=(await db.collection('pronunciation_recordings').where({organizationId:actor.organizationId,studentId:actor.actorUserId,status:'processing'}).limit(30).get()).data;
 console.log(JSON.stringify({downloadedQueryCode:true,status:score.status,score:score.score,historyCount:history.length,workFound:!!work,workContainsScore:!!work?.score,pendingCount:pending.length}));process.exit(0);
}
if(process.argv[2]==='recover'){
 const pending=(await db.collection('pronunciation_recordings').where({organizationId:'org_qihang_demo',status:'processing'}).limit(10).get()).data;
 let count=0;for(const row of pending){if(row.studentId!==actor.actorUserId||row.source.kind!=='reading'||row.workerInvocationCount!==0)continue;await jobs.accept(asActor(),row.id,row.version,unique());count++;}
 console.log(JSON.stringify({recovered:count}));process.exit(0);
}
const manifest=JSON.parse(readFileSync(resolve(root,'.runtime/pronunciation-selftest-20261017/manifest.json'),'utf8'));
const track=manifest.tracks.find(t=>t.key==='correct'),bytes=readFileSync(resolve(root,'.runtime/pronunciation-selftest-20261017/audio/correct.mp3'));
if(createHash('sha256').update(bytes).digest('hex')!==track.sha256)throw new Error('SAMPLE_HASH_MISMATCH');
let selected;for(let offset=0;offset<600&&!selected;offset+=100){const list=(await db.collection('learning_resources').where({organizationId:actor.organizationId,status:'published'}).skip(offset).limit(100).get()).data;for(const resource of list){const p=resource.payload?.pronunciation??resource.pronunciation;const segment=p?.segments?.find(s=>s.text===manifest.targetText);if(segment){try{const input={kind:'reading',resourceId:resource._id,segmentId:segment.id};await sources.resolve(actor,input,true);selected=input;break;}catch{}}}if(list.length<100)break;}
if(!selected)throw new Error('MATCHED_APPROVED_REFERENCE_NOT_FOUND');
const started=Date.now();let sealed;
if(process.argv[2]==='resume'){
 if(recent.status!=='sealed'||!recent.id.startsWith('voicecheck_')||recent.contentSha256!==track.sha256)throw new Error('RESUME_TEST_RECORD_MISMATCH');
 sealed={recordingId:recent.id,expectedVersion:recent.version};selected={kind:'reading',resourceId:recent.source.resourceId,segmentId:recent.source.segmentId};
}else{
 const draft=await service.beginRecording(asActor(),selected,unique());
 const upload=await app.uploadFile({cloudPath:draft.stagingPath,fileContent:bytes});const fileId=upload.fileID??upload.data?.fileID;
 sealed=await service.sealRecording(asActor(),draft.recordingId,fileId,1,unique());
}
const result=await jobs.accept(asActor(),sealed.recordingId,sealed.expectedVersion,unique());
const {writeFileSync}=await import('node:fs');writeFileSync(resolve(root,'.runtime/pronunciation-wait-20261025/selftest-id.json'),JSON.stringify({recordingId:sealed.recordingId,started,source:selected}));
console.log(JSON.stringify({stage:'score_requested',status:result.status,syntheticAudioHashVerified:true}));
for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,2500));const view=await service.getScore(asActor(),sealed.recordingId);if(view.status!=='processing'){const history=await service.listAttempts(asActor(),selected);const works=await service.listMyWorks(asActor(),{limit:30,cursor:null});const item=works.items.find(r=>r.scoreId===sealed.recordingId);console.log(JSON.stringify({stage:'terminal',status:view.status,score:view.score,qualityReason:view.qualityReason,elapsedMs:Date.now()-started,historyCount:history.length,workContainsScore:Boolean(item?.score)}));process.exit(view.status==='scored'?0:2);}}
console.log(JSON.stringify({stage:'still_processing',elapsedMs:Date.now()-started}));process.exitCode=2;