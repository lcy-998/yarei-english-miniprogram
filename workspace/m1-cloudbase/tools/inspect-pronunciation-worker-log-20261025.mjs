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
for(const name of ['pronunciation-worker','pronunciation-inference']){
const result=call(['api','scf','GetFunctionLogs','--body',JSON.stringify({FunctionName:name,Namespace:envId,Limit:15,StartTime:new Date(Date.now()-3600000).toISOString(),EndTime:new Date().toISOString()}),'--json']);const logs=result.Data??result.Logs??result.logs??(Array.isArray(result)?result:[]);
console.log(JSON.stringify({name,keys:Object.keys(result),count:logs.length,logs:logs.map(l=>({keys:Object.keys(l),time:l.StartTime??l.Time??l.timestamp,returnCode:l.RetCode,hasUnavailable:/unavailable|SERVICE_UNAVAILABLE/.test(JSON.stringify(l)),hasUnauthorized:/unauthorized|UNAUTHENTICATED|invalid_event/.test(JSON.stringify(l)),errorClasses:JSON.stringify(l).match(/\b(?:ReferenceError|TypeError|SyntaxError|Error|Timeout)\b/g),safeMarkers:JSON.stringify(l).match(/\b(?:ResourceNotFound|AuthFailure|InvalidParameter|unavailable|unauthorized|rejected|succeeded|processed|ignored|invalid_event)\b/g)}))}));}