import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LocalStorage, uploadAuthorizer } from '../src/storage';
import { createHttpServer } from '../src/http';
import { LocalAuth } from '../src/auth';
import { SqliteDocuments } from '../src/database';
import type { VersionedDocument } from '../../m1-cloudbase/src/repositories/document-database-port';
import { JobQueue } from '../src/jobs';

test('private media rejects unsigned/tampered URLs, honors byte ranges and immutable uploads',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yarei-media-')),auth=new LocalAuth(join(dir,'auth.sqlite'));
 const storage=new LocalStorage(join(dir,'files'),'cloud1-test.bucket','https://example.test','x'.repeat(32));
 auth.provision('u1','19900000009','password-example-1234');const token=(await auth.login('19900000009','password-example-1234','test'))!;
 const server=createHttpServer(auth,{origin:'https://example.test',storage,authorizeUpload:async(uid,key)=>{if(uid!=='u1'||key!=='student-works/staging/u1/test.mp3')throw new Error('forbidden');}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 try {
  assert.throws(()=>storage.path('../secret'));assert.throws(()=>storage.key('cloud://cloud1-other/a'));
  const file=await storage.uploadFile({cloudPath:'private/example.mp3',fileContent:Buffer.from('0123456789')});
  const hourly=(await storage.getTempFileURL({fileList:[{fileID:file.fileID,maxAge:3600}]})).fileList[0]!.tempFileURL;const hourlyUrl=new URL(hourly);assert.equal(Number(hourlyUrl.searchParams.get('exp'))-Number(hourlyUrl.searchParams.get('t')),3600);
  const signed=(await storage.getTempFileURL({fileList:[{fileID:file.fileID,maxAge:60}]})).fileList[0]!.tempFileURL;const url=new URL(signed),path=url.pathname+url.search;
  assert.equal((await fetch(base+url.pathname)).status,403);
  assert.equal((await fetch(base+path.replace('exp=','exp=9'))).status,403);
  const response=await fetch(base+path,{headers:{Range:'bytes=2-5'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 2-5/10');assert.equal(await response.text(),'2345');
  assert.equal((await fetch(base+path,{headers:{Range:'bytes=99-100'}})).status,416);
  await assert.rejects(storage.uploadFile({cloudPath:'private/example.mp3',fileContent:Buffer.from('overwrite')}));
  const upload=async()=>{const form=new FormData();form.append('file',new Blob(['audio']),'test.mp3');return fetch(base+'/api/media/upload?path=student-works%2Fstaging%2Fu1%2Ftest.mp3',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});};
  assert.equal((await upload()).status,200);assert.equal((await readFile(storage.path('student-works/staging/u1/test.mp3'))).toString(),'audio');assert.equal((await upload()).status,200);
  assert.equal((await fetch(base+'/api/functions/pronunciation-worker',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'})).status,404);
 } finally {await new Promise<void>(r=>server.close(()=>r()));auth.close();await rm(dir,{recursive:true,force:true});}
});

test('upload grants require current owner, role and draft state',async()=>{
 const db=new SqliteDocuments(':memory:'); // Use the concrete runtime repository rather than weakening its identity type.
 const {createIdentitySessionRuntimeCapabilities}=await import('../../m1-cloudbase/functions/shared/identity-session-capabilities');
 const {createNodeCryptoCapabilities}=await import('../../m1-cloudbase/src/runtime/node-crypto-capabilities');
 const {createPrimaryCloudIntegrationSeedPackage}=await import('../../m1-cloudbase/src/seed/primary-cloud-integration-fixture');
 const clock={nowIso:()=>new Date().toISOString()},key=randomBytes(32).toString('base64url');const crypto=createNodeCryptoCapabilities({clock,secrets:{subjectPepper:key,cursorSigningKey:key,batchReviewSigningKey:key,businessSessionEncryptionKey:key,bindingCodeDerivationKey:key,bindingCodePepper:key}});
 const seed=createPrimaryCloudIntegrationSeedPackage();await db.runTransaction(async tx=>{for(const [c,docs]of Object.entries(seed.collections))for(const raw of docs)await tx.create(c,(c==='auth_identities'?{...raw,providerSubjectDigest:crypto.subjectDigest.digest('cloudbase:username:'+raw.userId)}:raw) as VersionedDocument);await tx.create('pronunciation_recordings',{_id:'test',organizationId:'org_qihang_demo',schemaVersion:1,version:1,deletedAt:null,studentId:'usr_student_g3_01',status:'draft',fileId:null,stagingPath:'pronunciation/staging/test/test.mp3'});});
 const runtime=createIdentitySessionRuntimeCapabilities({documents:db,clock,requestIds:crypto.requestIds,cryptography:crypto,sdk:{getWXContext:()=>({}),database:()=>{throw new Error();}}});
 const authorize=uploadAuthorizer(db,runtime.identities,crypto.subjectDigest);
 try {await authorize('usr_student_g3_01','pronunciation/staging/test/test.mp3');await assert.rejects(authorize('usr_teacher_demo_01','pronunciation/staging/test/test.mp3'));await db.runTransaction(async tx=>{const row=(await tx.get('pronunciation_recordings','test'))!;await tx.replace('pronunciation_recordings','test',1,{...row,status:'sealed',version:2});});await assert.rejects(authorize('usr_student_g3_01','pronunciation/staging/test/test.mp3'));}finally{await db.close();}
});

test('queued work survives process-level queue recreation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yarei-queue-'));const file=join(dir,'jobs.sqlite');const first=new JobQueue(file);await first.enqueue('test',{operation:'a'});first.stop();const second=new JobQueue(file);
 try {await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('not delivered')),4000);second.start(async(kind,event)=>{assert.equal(kind,'test');assert.deepEqual(event,{operation:'a'});clearTimeout(timer);resolve();return {ok:true};});});}finally{second.stop();await rm(dir,{recursive:true,force:true});}
});

test('native accounts are idempotent and password reset revokes sessions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yarei-account-')),auth=new LocalAuth(join(dir,'auth.sqlite'));
 try {const provider=auth.nativeProvider({digest:value=>'sd1_'+Buffer.from(value).toString('base64url')},dir);
  assert.equal(await provider.mobileExists('19900000008','operation_one'),false);
  const receipt=await provider.provision({mobile:'19900000008',displayName:'fictional'},'operation_one');
  assert.deepEqual(await provider.provision({mobile:'19900000008',displayName:'fictional'},'operation_one'),receipt);
  assert.equal(await provider.mobileExists('19900000008','operation_one'),false);assert.equal(await provider.mobileExists('19900000008','other_operation'),true);
  const delivered=JSON.parse(await readFile(join(dir,'account-delivery',receipt.platformUid+'.json'),'utf8')) as {password:string};
  const token=(await auth.login('19900000008',delivered.password,'test'))!;assert(token);
  auth.resetPassword(receipt.platformUid,'replacement-pass-1234');assert.equal(auth.resolve(token),undefined);assert(await auth.login('19900000008','replacement-pass-1234','test'));
  await provider.blockUnlinked(receipt,'other_operation');assert(await auth.login('19900000008','replacement-pass-1234','test'));
 }finally{auth.close();await rm(dir,{recursive:true,force:true});}
});
