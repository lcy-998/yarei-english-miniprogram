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
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const name=process.argv[2], mode=process.argv[3]??'inspect';
if(!['pronunciation-worker','pronunciation-query','pronunciation-command'].includes(name))throw new Error('INVALID_TARGET');
const base=resolve(root,'.runtime/pronunciation-wait-20261025-versioned'), backup=resolve(base,'backup',name), candidate=resolve(root,'dist/functions',name), readback=resolve(base,'readback',name);
const sha=v=>createHash('sha256').update(v).digest('hex');
const signature=d=>sha(JSON.stringify({runtime:d.Runtime,memory:d.MemorySize,timeout:d.Timeout,handler:d.Handler,role:d.Role,install:d.InstallDependency,triggers:d.Triggers,environment:(d.Environment?.Variables??[]).map(v=>[v.Key,v.Value]).sort()}));
const detail=()=>call(['fn','detail',name,'--json']);
const route=()=>call(['fn','get-route',name,'--json']);
function transfer(args){try{return execFileSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_OPTIONS:`--require=${root}/tools/cloudbase-code-dns-fallback.cjs`}});}catch{throw new Error('CODE_TRANSFER_FAILED');}}
const quota={};for(const metric of ['FunctionInvocation','DbWritepkg','DbReadpkg']){const value=call(['api','tcb','DescribeQuotaData','--api-version','2018-06-08','--body',JSON.stringify({EnvId:envId,MetricName:metric}),'--json']);if(!Number.isFinite(value?.Value)||value.Value>=190000)throw new Error('QUOTA_GATE');quota[metric]=value.Value;}
const before=detail();if(before.Status!=='Active')throw new Error('NOT_ACTIVE');
const beforeRoute=route();
mkdirSync(base,{recursive:true});
const receiptPath=resolve(base,name+'-deployment.json');
if(mode==='inspect'){
 mkdirSync(backup,{recursive:true});transfer(['fn','code','download',name,backup,'--json']);
 const backupHash=sha(readFileSync(resolve(backup,'index.js')));
 if(before.CodeInfo&&sha(before.CodeInfo)!==backupHash)throw new Error('BACKUP_MISMATCH');
 const receipt={beforeHash:backupHash,beforeModTime:before.ModTime,signature:signature(before),route:beforeRoute,candidateHash:sha(readFileSync(resolve(candidate,'index.js'))),quota};
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2));console.log(JSON.stringify({stage:'ready',name,...receipt}));
}else{
 const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
 if(signature(before)!==receipt.signature||(before.CodeInfo?sha(before.CodeInfo)!==receipt.beforeHash:before.ModTime!==receipt.beforeModTime)||sha(readFileSync(resolve(candidate,'index.js')))!==receipt.candidateHash)throw new Error('BASELINE_CHANGED');
 transfer(['fn','code','update',name,'--dir',candidate,'--deployMode','zip','--json']);
 let after;for(let i=0;i<15;i++){after=detail();if(after.Status==='Active'&&after.ModTime!==before.ModTime)break;await new Promise(r=>setTimeout(r,2000));}
 if(signature(after)!==receipt.signature)throw new Error('CONFIG_CHANGED');
 mkdirSync(readback,{recursive:true});transfer(['fn','code','download',name,readback,'--json']);
 const readbackHash=sha(readFileSync(resolve(readback,'index.js')));
 if(readbackHash!==receipt.candidateHash)throw new Error('READBACK_MISMATCH');
 const afterRoute=route();
 const routeValue=r=>JSON.stringify([r.FunctionVersion??r.RoutingConfig?.FunctionVersion,r.RoutingConfig]);
 if(routeValue(afterRoute)!==routeValue(receipt.route))throw new Error('ROUTE_CHANGED');
 writeFileSync(receiptPath,JSON.stringify({...receipt,readbackHash,deployedAt:new Date().toISOString(),active:after.Status==='Active',configurationUnchanged:true},null,2));
 console.log(JSON.stringify({stage:'deployed',name,readbackHash,configurationUnchanged:true,active:after.Status==='Active'}));
}