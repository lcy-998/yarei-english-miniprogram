import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { build } from 'esbuild';
const mode=process.argv[2];
if(!['inspect','apply'].includes(mode)) throw new Error('MODE_INVALID');
const root=resolve(import.meta.dirname,'..'), assets='G:/英语资产', expected='cloud1-d8ggzrwwedb786e41';
const cli='D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config=JSON.parse(readFileSync(resolve(root,'cloudbaserc.json'),'utf8'));
const envId=readFileSync(resolve(root,'.env.local'),'utf8').split(/\r?\n/u).find(x=>x.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if(envId!==expected||config.envId!==expected) throw new Error('NONPRODUCTION_ENV_GATE');
function call(args){try{const raw=execFileSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});const at=raw.indexOf('{');if(at<0)throw Error();const parsed=JSON.parse(raw.slice(at));if(parsed.error)throw Error();return parsed.data;}catch{throw new Error('CLOUDBASE_PREFLIGHT_FAILED');}}
const envs=call(['env','list','--json']);
if(!Array.isArray(envs)||envs.length!==1||envs[0].EnvId!==expected||envs[0].Status!=='NORMAL'||envs[0].PackageName!=='个人版'||envs[0].EnableOverrun!==false||envs[0].EnvPaid!=='no'||envs[0].EnvCharged!=='no') throw new Error('ENVIRONMENT_COST_GATE');
const quota=call(['api','tcb','DescribeQuotaData','--api-version','2018-06-08','--body',JSON.stringify({EnvId:expected,MetricName:'DbWritepkg'}),'--json']);
if(!Number.isFinite(quota.Value)||quota.Value>190000) throw new Error('WRITE_QUOTA_GATE');
const temporary=call(['secrets','get','--json']);
if(temporary?.isTemporary!==true||temporary.envId!==expected||Date.parse(temporary.expiredAt)<Date.now()+60000) throw new Error('TEMPORARY_CREDENTIAL_GATE');
const require=createRequire(resolve(root,'package.json'));
const db=require('@cloudbase/node-sdk').init({env:expected,secretId:temporary.secretId,secretKey:temporary.secretKey,sessionToken:temporary.token}).database();
const readRows=async(collection,filter)=>{const out=[];let offset=0;while(offset<=10000){const response=await db.collection(collection).where(filter).skip(offset).limit(100).get();const page=response.data||[];out.push(...page);if(page.length<100)break;offset+=page.length;}return out;};
const orgRows=await readRows('organizations',{status:'active',deletedAt:null});
const orgIds=orgRows.map(x=>x._id).sort();if(JSON.stringify(orgIds)!==JSON.stringify(['org_isolation_secondary','org_qihang_demo']))throw new Error('ORGANIZATION_SCOPE_GATE');
const sourceCatalog=JSON.parse(await readFile(join(assets,'library/catalog.json'),'utf8'));
const titles=new Map(sourceCatalog.resources.filter(r=>r.resourceType==='textbook'&&r.processingStatus==='publish_ready').map(r=>[r.resourceId,r.title]));
const sbc0008=titles.get('book-sbc-en-0008');if(sbc0008)titles.set('res_formal_sbc0008_v1_20261007',sbc0008);
const all=await readRows('learning_resources',{type:'reading',status:'published',deletedAt:null});
const sourceById=new Map(all.filter(x=>x.globalCatalogSource===true).map(x=>[x._id,x]));
const projectionsBySource=new Map();
for(const row of all.filter(x=>x.globalCatalogProjection===true&&typeof x.globalSourceId==='string')){
 const list=projectionsBySource.get(row.globalSourceId)||[];list.push(row);projectionsBySource.set(row.globalSourceId,list);
}
const targets=[];
for(const [sourceId,newTitle] of titles){
 const source=sourceById.get(sourceId);if(!source)continue;
 const projections=projectionsBySource.get(sourceId)||[];
 if(source.globalCatalogSource!==true||source.status!=='published'||source.deletedAt!==null)throw new Error(`SOURCE_SHAPE_GATE_${sourceId}`);
 if(projections.some(p=>p.status!=='published'||p.deletedAt!==null||p.organizationId===source.organizationId))throw new Error(`PROJECTION_SHAPE_GATE_${sourceId}`);
 if(source.title!==newTitle||projections.some(p=>p.title!==newTitle))targets.push({sourceId,newTitle,source,projections});
}
if(targets.some(t=>t.projections.length!==1||t.projections[0].organizationId!=='org_isolation_secondary'))throw new Error('PROJECTION_SET_GATE');
function sourceFingerprint(row){return createHash('sha256').update(JSON.stringify({id:row._id,version:row.version,type:row.type,title:row.title,contentVersion:row.contentVersion,payload:row.payload,visibility:row.visibility,status:row.status})).digest('hex');}if(mode==='inspect'){
 const rows=targets.map(t=>({sourceId:t.sourceId,newTitle:t.newTitle,source:{title:t.source.title,version:t.source.version,contentVersion:t.source.contentVersion,fingerprint:t.source.globalCatalogFingerprint,computedFingerprint:sourceFingerprint(t.source),fingerprintMatches:t.source.globalCatalogFingerprint===sourceFingerprint(t.source)},projections:t.projections.map(p=>({id:p._id,title:p.title,version:p.version,contentVersion:p.contentVersion,sourceVersion:p.globalSourceVersion,sourceFingerprintMatches:p.globalSourceFingerprint===t.source.globalCatalogFingerprint}))}));
 process.stdout.write(JSON.stringify({mode,environment:expected,kind:'verified_nonproduction',dbWriteQuota:quota.Value,overrunBilling:false,publishedReadingCount:all.length,targets:rows.length,rows})+'\\n');process.exit(0);
}
for(const t of targets){
 if(!Number.isSafeInteger(t.source.version)||t.source.version<1||typeof t.source.globalCatalogFingerprint!=='string'||! /^[a-f0-9]{64}$/iu.test(t.source.globalCatalogFingerprint))throw new Error(`SOURCE_FINGERPRINT_GATE_${t.sourceId}`);
 for(const p of t.projections){if(p.globalSourceVersion>t.source.version||p.contentVersion!==t.source.contentVersion||p.globalSourceFingerprint!==t.source.globalCatalogFingerprint)throw new Error(`PROJECTION_LINK_GATE_${p._id}`);}
}
const changes=targets.map(t=>({sourceId:t.sourceId,newTitle:t.newTitle,source:{id:t.source._id,organizationId:t.source.organizationId,title:t.source.title,version:t.source.version,contentVersion:t.source.contentVersion},projections:t.projections.map(p=>({id:p._id,organizationId:p.organizationId,title:p.title,version:p.version,globalSourceVersion:p.globalSourceVersion}))}));
if(mode==='inspect'){
 process.stdout.write(JSON.stringify({mode,environment:expected,kind:'verified_nonproduction',dbWriteQuota:quota.Value,overrunBilling:false,publishedReadingCount:all.length,matchedPublishedBooks:targets.length,documentUpdates:targets.reduce((n,t)=>n+1+t.projections.length,0),changes})+'\n');process.exit(0);
}
if(!targets.length){process.stdout.write(JSON.stringify({mode,status:'already_normalized',environment:expected,updates:0})+'\n');process.exit(0);}
const runId='20261021';
const reportDir=resolve(root,'..','..','workspace','m3-acceptance','2026-10-21','online-title-normalization');
await mkdir(reportDir,{recursive:true});
const backupPath=join(reportDir,'cloudbase-preimage.json');
const receiptPath=join(reportDir,'cloudbase-title-normalization-receipt.json');
const backupRows=targets.flatMap(t=>[t.source,...t.projections].map(r=>({_id:r._id,organizationId:r.organizationId,title:r.title,version:r.version,updatedAt:r.updatedAt??null,contentVersion:r.contentVersion??null,globalCatalogSource:r.globalCatalogSource===true,globalCatalogProjection:r.globalCatalogProjection===true,globalSourceId:r.globalSourceId??null,globalSourceVersion:r.globalSourceVersion??null,globalCatalogFingerprint:r.globalCatalogFingerprint??null,globalSourceFingerprint:r.globalSourceFingerprint??null,newTitle:t.newTitle})));
const backup={schemaVersion:1,environment:expected,createdAt:new Date().toISOString(),reason:'标题字段规范化；内容版本、正文、页面、媒体、权限与历史任务快照不变。',rows:backupRows};
const priorBackup=await readFile(backupPath,'utf8').catch(()=>null);if(priorBackup){const oldBackup=JSON.parse(priorBackup);if(JSON.stringify(oldBackup.rows)!==JSON.stringify(backup.rows))throw new Error('BACKUP_STATE_MISMATCH');}else await writeFile(backupPath,JSON.stringify(backup,null,2)+'\n',{flag:'wx'});
const receiptRows=[];
for(const t of targets){
 const now=new Date().toISOString();
 const nextSource={...t.source,title:t.newTitle,version:t.source.version+1,updatedAt:now};
 nextSource.globalCatalogFingerprint=sourceFingerprint(nextSource);
 const nextProjections=t.projections.map(p=>({...p,title:t.newTitle,version:p.version+1,updatedAt:now,globalSourceVersion:nextSource.version,globalSourceFingerprint:nextSource.globalCatalogFingerprint}));
 const docs=[nextSource,...nextProjections];
 const audits=docs.map(row=>{const key=createHash('sha256').update(row._id).digest('hex').slice(0,24);const id=`audit_title_${runId}_${key}`;return {_id:id,organizationId:row.organizationId,schemaVersion:1,version:1,deletedAt:null,requestId:id,actorUserId:'codex_title_normalization',actorRole:'system',action:'asset_library.normalize_published_title',targetType:'learning_resource',targetId:row._id,result:'succeeded',errorCode:null,occurredAt:now,metadata:{oldTitle:t.source.title,newTitle:t.newTitle,sourceId:t.sourceId,previousDocumentVersion:row._id===t.sourceId?t.source.version:t.projections.find(p=>p._id===row._id).version,nextDocumentVersion:row.version,contentVersionUnchanged:true,payloadUnchanged:true,statusUnchanged:true}};});
 for(const audit of audits){const response=await db.collection('operation_logs').doc(audit._id).get().catch(()=>null);const data=response?.data;const found=Array.isArray(data)?data.find(row=>row?._id===audit._id):data&&typeof data==='object'&&data._id===audit._id?data:null;if(found)throw new Error(AUDIT_ID_EXISTS_);}
 const tx=await db.startTransaction();
 try{
  for(const old of [t.source,...t.projections]){const currentResponse=await tx.collection('learning_resources').doc(old._id).get();const current=Array.isArray(currentResponse.data)?currentResponse.data[0]:currentResponse.data;if(!current||current.version!==old.version||current.title!==old.title)throw new Error(`WRITE_CONFLICT_${old._id}`);}
  for(const row of docs){const {_id,...body}=row;await tx.collection('learning_resources').doc(_id).set(body);}
  for(const audit of audits){const {_id,...body}=audit;await tx.collection('operation_logs').doc(_id).set(body);}
  await tx.commit();
 }catch(error){await tx.rollback().catch(()=>{});throw error;}
 for(const row of docs){const response=await db.collection('learning_resources').doc(row._id).get();const read=Array.isArray(response.data)?response.data[0]:response.data;if(read?.title!==t.newTitle||read?.version!==row.version)throw new Error(`READBACK_FAILED_${row._id}`);}
 receiptRows.push({sourceId:t.sourceId,title:t.newTitle,sourceVersionBefore:t.source.version,sourceVersionAfter:nextSource.version,projectionIds:nextProjections.map(p=>p._id),documentsUpdated:docs.length});
}
const bundle=join(root,'.runtime','online-title-normalization','entry.cjs');await mkdir(dirname(bundle),{recursive:true});
await build({entryPoints:[join(root,'src/seed/m3-global-asset-audit-entry.ts')],outfile:bundle,bundle:true,format:'cjs',platform:'node',target:'node22',logLevel:'silent'});
const api=require(bundle),documents=api.createCloudBaseDocumentDatabase(db);
const textbookService=new api.TeacherTextbookService(new api.DocumentTextbookRepository(documents),{nowIso:()=>new Date().toISOString()});
const studentService=new api.ContentQueryService(api.createOrgContentDocumentRepository(documents));
const serviceReadback=[];
for(const organizationId of orgIds){
 const grants=(await db.collection('teacher_class_grants').where({organizationId,status:'active',deletedAt:null}).limit(100).get()).data||[];
 const members=(await db.collection('class_memberships').where({organizationId,status:'active',deletedAt:null}).limit(100).get()).data||[];
 if(!grants.length||!members.length)throw new Error(`DEMO_ACTOR_MISSING_${organizationId}`);
 const teacher={requestId:`title_teacher_${organizationId}`,sessionId:'title-normalization-readback',actorUserId:grants[0].teacherId,actorRole:'teacher',organizationId,platformSubjectDigest:'title-normalization-readback',permissions:['content.read','task.publish'],scopeIds:[...new Set(grants.map(x=>x.classId).filter(Boolean))],authzVersion:1};
 const member=members[0];const student={requestId:`title_student_${organizationId}`,sessionId:'title-normalization-readback',actorUserId:member.studentId,actorRole:'student',organizationId,platformSubjectDigest:'title-normalization-readback',permissions:['content.read'],scopeIds:[member.classId],authzVersion:1};
 const teacherRows=(await textbookService.listTextbooks(teacher,{}, {limit:100,offset:0})).items;
 const studentRows=(await studentService.listStudentCatalog(student,{type:'reading'},{limit:100,offset:0})).items;
 for(const t of targets){const resourceId=organizationId===t.source.organizationId?t.sourceId:api.legacyGlobalProjectionId(t.sourceId,organizationId);const expectedTitle=t.newTitle;const tr=teacherRows.find(x=>x.id===resourceId);const sr=studentRows.find(x=>x.id===resourceId);if(!tr||tr.title!==expectedTitle||!sr||sr.title!==expectedTitle)throw new Error(`SERVICE_READBACK_FAILED_${resourceId}`);}
 serviceReadback.push({organizationId,updatedBooksVerified:targets.length,teacherCatalog:'passed',studentCatalog:'passed'});
}
const receipt={schemaVersion:1,environment:expected,nonproduction:true,updatedAt:new Date().toISOString(),logicalBooksUpdated:targets.length,documentsUpdated:receiptRows.reduce((n,x)=>n+x.documentsUpdated,0),dbWriteQuotaBefore:quota.Value,overrunBilling:false,records:receiptRows,serviceReadback,backupPath};
await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({mode,status:'completed',environment:expected,nonproduction:true,logicalBooksUpdated:receipt.logicalBooksUpdated,documentsUpdated:receipt.documentsUpdated,serviceReadback,backupPath,receiptPath,overrunBilling:false})+'\n');