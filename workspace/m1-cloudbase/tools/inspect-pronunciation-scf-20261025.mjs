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
const {AbstractClient}=require('tencentcloud-sdk-nodejs-common');
const scf=new AbstractClient('scf.tencentcloudapi.com','2018-04-16',{credential:{secretId:credentials.secretId,secretKey:credentials.secretKey,token:credentials.token},region:'ap-shanghai'});
for(const action of ['GetFunctionEventInvokeConfig','GetFunctionLogs']){
try{
const value=await scf.request(action,{FunctionName:'pronunciation-worker',Namespace:envId,...(action==='GetFunctionLogs'?{Limit:20}:{} )});
if(action==='GetFunctionLogs'){console.log(JSON.stringify({action,keys:Object.keys(value),logs:(value.Data??[]).map(l=>{let ret;try{ret=JSON.parse(l.RetMsg);}catch{}return {time:l.StartTime,retCode:l.RetCode,status:ret?.status,ok:ret?.ok,errorClass:JSON.stringify(l).match(/\b(?:ReferenceError|TypeError|SyntaxError|Timeout)\b/g),messageMarkers:JSON.stringify(l).match(/\b(?:unauthorized|unavailable|invalid_event|forbidden|scored|processing|ignored|failed)\b/g)};})}));}
else console.log(JSON.stringify({action,...value}));
}catch(e){console.log(JSON.stringify({action,code:e.code??e.name}));}}const detail=await scf.request('GetFunction',{FunctionName:'pronunciation-worker',Namespace:envId,ShowCode:'FALSE'});console.log(JSON.stringify({functionConfig:Object.fromEntries(Object.entries(detail).filter(([k,v])=>/Status|Async|Concurrency|Timeout|Retry|Type|Version/.test(k)))}));