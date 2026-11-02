import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createSelfhostSdk} from '../../miniprogram/repositories/selfhost-sdk';
import {createCloudBaseAdminRuntime} from '../../admin-console/src/cloud/cloudbase-admin-runtime';
import {CloudAdminService} from '../../admin-console/src/services/cloud-admin-service';
async function main() {
  const credentials=JSON.parse(await readFile(process.env.YAREI_CREDENTIAL_FILE!,'utf8')) as {phone:string;password:string};
  const sdk=createSelfhostSdk(async(path,body,token)=>{
    const response=await fetch('https://video.aimanhua.xin'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    assert(response.ok);return response.json();
  });
  const runtime=createCloudBaseAdminRuntime({sdk,environmentId:'aliyun-selfhost'});
  try {
    assert.equal((await runtime.signInWithPassword({mobile:credentials.phone,password:credentials.password})).ok,true);
    assert.equal((await runtime.sessions.bootstrap()).ok,true);
    const result=await new CloudAdminService(runtime).snapshot();
    assert.equal(result.ok,true,JSON.stringify(result.ok ? {} : result));
    console.log('Real administrator client: login, session, dashboard, classes, users, role assignments, and audit snapshots passed.');
  } finally {await runtime.signOutPlatform();}
}
void main();
