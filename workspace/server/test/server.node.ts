import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { SqliteDocuments } from '../src/database';
import { LocalAuth } from '../src/auth';
import { installRuntime } from '../src/runtime';
import { createHttpServer } from '../src/http';
import { createPrimaryCloudIntegrationSeedPackage } from '../../m1-cloudbase/src/seed/primary-cloud-integration-fixture';
import type { VersionedDocument } from '../../m1-cloudbase/src/repositories/document-database-port';

test('operator initializes a private administrator and provisions credentials only for an existing user',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'yarei-operator-'));
  const env={...process.env,YAREI_DATA_DIR:dir,YAREI_ADMIN_PHONE:'19900000009'};
  const operator=join(__dirname,'operator.cjs');
  try {
    execFileSync(process.execPath,[operator,'init-admin'],{env,stdio:'pipe'});
    const first=JSON.parse(await readFile(join(dir,'initial-admin.json'),'utf8')) as {phone:string;password:string};
    assert.equal(first.phone,'19900000009');assert(first.password.length>=14);
    assert.throws(()=>execFileSync(process.execPath,[operator,'init-admin'],{env,stdio:'pipe'}));
    const file=join(dir,'account.json');
    await writeFile(file,JSON.stringify({userId:'nonexistent',phone:'19900000008'}),{mode:0o600});
    assert.throws(()=>execFileSync(process.execPath,[operator,'provision'],{env:{...env,YAREI_ACCOUNT_FILE:file},stdio:'pipe'}));
    await writeFile(file,JSON.stringify({userId:'usr_yarei_admin',phone:'19900000008'}),{mode:0o600});
    execFileSync(process.execPath,[operator,'provision'],{env:{...env,YAREI_ACCOUNT_FILE:file},stdio:'pipe'});
    const credentialFile=(await readdir(dir)).find(name=>name.startsWith('provisioned-'))!;
    const second=JSON.parse(await readFile(join(dir,credentialFile),'utf8')) as {phone:string;password:string};
    const auth=new LocalAuth(join(dir,'auth.sqlite'));
    try {assert(await auth.login(second.phone,second.password,'operator-test'));} finally {auth.close();}
    const db=new SqliteDocuments(join(dir,'business.sqlite'));
    try {assert.equal((await db.find('users',{})).length,1);assert.equal((await db.find('auth_identities',{})).length,2);} finally {await db.close();}
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('SQLite transactions roll back, serialize concurrent writers, persist, and reject stale versions',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'yarei-db-')); const path=join(dir,'db.sqlite');
  let db=new SqliteDocuments(path);
  const doc: VersionedDocument={_id:'d1',organizationId:'o1',schemaVersion:1,version:1,deletedAt:null,value:0};
  try {
    await assert.rejects(db.runTransaction(async tx=>{await tx.create('test',doc);throw new Error('rollback');}));
    assert.equal(await db.get('test','d1'),null);
    await db.runTransaction(async tx=>{assert.equal(await tx.create('test',doc),true);assert.equal(await tx.create('test',doc),false);});
    await Promise.all(Array.from({length:20},()=>db.runTransaction(async tx=>{
      const current=(await tx.get('test','d1'))!;await new Promise(r=>setTimeout(r,1));
      assert.equal(await tx.replace('test','d1',current.version,{...current,version:current.version+1,value:Number(current.value)+1}),true);
    })));
    assert.equal((await db.get('test','d1'))?.value,20);
    assert.equal(await db.runTransaction(tx=>tx.replace('test','d1',1,doc)),false);
    await db.close();db=new SqliteDocuments(path);
    assert.equal((await db.get('test','d1'))?.value,20);
    assert.equal((await db.find('test',{organizationId:'other'})).length,0);
  } finally {await db.close();await rm(dir,{recursive:true,force:true});}
});

test('HTTP authentication, four-role isolation, durable business writes, and logout',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'yarei-http-'));
  const db=new SqliteDocuments(join(dir,'business.sqlite'));
  const auth=new LocalAuth(join(dir,'auth.sqlite'));
  const secret=()=>randomBytes(32).toString('base64url');
  const crypto=installRuntime(db,{subjectPepper:secret(),cursorSigningKey:secret(),batchReviewSigningKey:secret(),businessSessionEncryptionKey:secret(),bindingCodeDerivationKey:secret(),bindingCodePepper:secret()});
  const actors=[['admin','usr_admin_demo_01'],['student','usr_student_g3_01'],['teacher','usr_teacher_demo_01'],['parent','usr_parent_demo_01']] as const;
  const passwords=actors.map(()=>randomBytes(20).toString('hex'));
  const seed=createPrimaryCloudIntegrationSeedPackage();
  await db.runTransaction(async tx=>{
    for (const [collection,docs] of Object.entries(seed.collections)) for (const raw of docs) {
      const doc=collection==='auth_identities' ? {...raw,providerSubjectDigest:crypto.subjectDigest.digest('cloudbase:username:local_'+raw.userId)} : raw;
      assert.equal(await tx.create(collection,doc as VersionedDocument),true);
    }
  });
  actors.forEach((actor,i)=>auth.provision('local_'+actor[1],'1990000000'+i,passwords[i]));
  const server=createHttpServer(auth,{origin:'https://example.test'});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address();assert(address && typeof address==='object');
  const base='http://127.0.0.1:'+address.port;
  const post=async(path:string,body:object,token?:string,origin?:string)=>{
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json() as Record<string,unknown>};
  };
  const fn=async(name:string,action:string,payload:object,token:string,businessSessionToken?:string,extra:object={})=>{
    const response=await post('/api/functions/'+name,{apiVersion:'m1.v1',action,payload,...(businessSessionToken?{businessSessionToken}:{}),...extra},token);
    assert.equal(response.status,200);
    return response.body.result as {ok:boolean;data:Record<string,unknown>;error?:{code:string}};
  };
  try {
    assert.equal((await fetch(base+'/healthz')).status,200);
    assert.equal((await post('/api/functions/admin-session',{apiVersion:'m1.v1',action:'bootstrap',payload:{}})).status,401);
    assert.equal((await post('/api/auth/login',{phone:'19900000000',password:'wrong'})).status,401);
    assert.equal((await post('/api/auth/login',{phone:'19900000000',password:passwords[0]},undefined,'https://attacker.test')).status,403);
    const tokens:string[]=[]; const sessions:string[]=[];
    for (let i=0;i<actors.length;i++) {
      const login=await post('/api/auth/login',{phone:'1990000000'+i,password:passwords[i]});
      assert.equal(login.status,200);const token=String(login.body.accessToken);tokens.push(token);
      const name=i===0?'admin-session':'auth-session';
      const result=await fn(name,'bootstrap',{},token);assert.equal(result.ok,true,JSON.stringify(result));
      let session=String(result.data[i===0?'token':'sessionId']);
      if (i>0) {const selected=await fn(name,'selectRole',{role:actors[i][0]},token,session);assert.equal(selected.ok,true,JSON.stringify(selected));session=String(selected.data.sessionId);}
      sessions.push(session);
    }
    const classes=await fn('organization-admin','listClasses',{},tokens[0],sessions[0]);assert.equal(classes.ok,true,JSON.stringify(classes));
    const createPayload={name:'集成验证班',grade:'三年级',term:'2026秋季',reason:'仅用于隔离的本地测试'};
    const created=await fn('organization-admin','createClass',createPayload,tokens[0],sessions[0],{expectedVersion:1,operationId:'op_http_create_class_001'});
    assert.equal(created.ok,true,JSON.stringify(created));
    const retried=await fn('organization-admin','createClass',createPayload,tokens[0],sessions[0],{expectedVersion:1,operationId:'op_http_create_class_001'});
    assert.equal(retried.ok,true,JSON.stringify(retried));assert.deepEqual(retried.data,created.data);
    assert.equal((await db.find('classes',{name:'集成验证班'})).length,1);
    const wrongAudience=await fn('organization-admin','listClasses',{},tokens[1],sessions[1]);assert.equal(wrongAudience.ok,false);
    const stolenSession=await fn('organization-admin','listClasses',{},tokens[1],sessions[0]);assert.equal(stolenSession.ok,false);
    const homes=await Promise.all(Array.from({length:12},(_,i)=>fn('auth-session','getCurrentSession',{},tokens[1+i%3],sessions[1+i%3])));
    homes.forEach((r,i)=>{assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.userId,actors[1+i%3][1]);});
    const updated=await fn('auth-session','updateProfile',{displayName:'测试学生更新'},tokens[1],sessions[1],{operationId:'op_http_profile_001',expectedVersion:1});
    assert.equal(updated.ok,true,JSON.stringify(updated));assert.equal((await db.get('users','usr_student_g3_01'))?.displayName,'测试学生更新');
    const replay=await fn('auth-session','updateProfile',{displayName:'测试学生更新'},tokens[1],sessions[1],{operationId:'op_http_profile_001',expectedVersion:1});assert.equal(replay.ok,false);assert.equal(replay.error?.code,'CONFLICT');
    await post('/api/auth/logout',{},tokens[0]);
    assert.equal((await post('/api/functions/admin-session',{apiVersion:'m1.v1',action:'bootstrap',payload:{}},tokens[0])).status,401);
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.close();auth.close();await rm(dir,{recursive:true,force:true});
  }
});
