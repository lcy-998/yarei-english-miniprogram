import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const data=process.env.YAREI_DATA_DIR??'/var/lib/yarei-v0128',base=process.env.YAREI_TEST_ORIGIN??'http://127.0.0.1:3201';
const accounts=JSON.parse(fs.readFileSync(data+'/migration-accounts.json')),results=[];
const post=async(path,body,token)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...token?{authorization:'Bearer '+token}:{}},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
const call=async(token,session,name,action,payload={})=>(await post('/api/functions/'+name,{apiVersion:'m1.v1',action,payload,...session?{businessSessionToken:session}:{}},token)).data.result;
for(const account of accounts.filter(a=>a.roles.length)){
 const login=await post('/api/auth/login',account);assert.equal(login.status,200);const token=login.data.accessToken;
 const bootstrap=await call(token,null,'auth-session','bootstrap');assert(bootstrap.ok,bootstrap.error?.code);
 for(const role of account.roles){
  const selected=await call(token,bootstrap.data.sessionId,'auth-session','selectRole',{role});assert(selected.ok,selected.error?.code);const session=selected.data.sessionId;
  results.push({role,check:'login/bootstrap/selectRole',ok:true});
  const checks=[['content-query','listReadingResources',{}],['content-query','listVocabularyPacks',{}]];
  if(role==='student')checks.push(['student-task-query','getHome',{localDate:new Date().toISOString().slice(0,10)}],['content-query','getMyClass',{}]);
  if(role==='teacher')checks.push(['native-admin-query','getAccess',{}],['teacher-student-query','listStudents',{filters:{status:'all'},page:{limit:20}}]);
  if(role==='parent')checks.push(['parent-query','listChildren',{}]);
  for(const [name,action,payload]of checks){const r=await call(token,session,name,action,payload);results.push({role,check:action,ok:r?.ok??false,code:r?.error?.code});if(action==='listReadingResources'&&r.ok&&r.data?.length){const detail=await call(token,session,'content-query','getReadingResource',{resourceId:r.data[0].id});results.push({role,check:'getReadingResource/signed-pages',ok:detail.ok,code:detail.error?.code});}}
  const forged=await call(token,session,'auth-session','selectRole',{role:'admin'});assert(!forged.ok);results.push({role,check:'ungranted-admin-role-denied',ok:true});
 }
 await post('/api/auth/logout',{},token);assert.equal((await post('/api/functions/auth-session',{apiVersion:'m1.v1',action:'bootstrap',payload:{}},token)).status,401);
}
const key=JSON.parse(fs.readFileSync('/var/lib/yarei-source/yarei-cloudbase-migration-20261102/storage.json')).data.find(x=>x.key.endsWith('.mp4')).key;
const secret=JSON.parse(fs.readFileSync(data+'/secrets.json')).cursorSigningKey,t=Math.floor(Date.now()/1000),exp=t+60,encoded=Buffer.from(key).toString('base64url');
const sign=createHmac('sha256',secret).update('yarei:media:v1\0'+JSON.stringify([encoded,t,exp])).digest('hex').slice(0,32);
const response=await fetch(`${base}/media/${encoded}?t=${t}&exp=${exp}&sign=${sign}`,{headers:{Range:'bytes=0-31'}});assert.equal(response.status,206);assert.equal(Buffer.from(await response.arrayBuffer()).toString('hex'),fs.readFileSync(data+'/storage/'+key).subarray(0,32).toString('hex'));results.push({check:'signed-private-video-range',ok:true});
assert.equal((await fetch(base+'/media/'+encoded)).status,403);assert.equal((await post('/api/functions/pronunciation-worker',{},'x'.repeat(43))).status,404);
fs.writeFileSync(data+'/http-smoke.json',JSON.stringify(results,null,2),{mode:0o600});console.log(JSON.stringify(results));assert(results.every(r=>r.ok));
