import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mode = process.argv[2];
if (!['probe', 'apply', 'rollback', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const cache = 'D:/app-m3-cache/task-publication-hotfix-20261008-rebased';
const candidateZip = resolve(cache, 'candidate-check.zip');
const baselineZip = resolve(cache, 'baseline-check.zip');
const OLD_HASH = 'ad0a4bf3c21dd4ba9e436c108bd3084f1ddd67b6283374a854dc4e9927336bdd';
const NEW_HASH = '6d3283b71c24517222bc19759d0c45392660c134ba19988f2578a931cade4750';
const CANDIDATE_ZIP_HASH = 'e6a8c883231675b20fe868b55e0b64f5ce2cf06be13e6c2e87725a48baecd327';
const BASELINE_ZIP_HASH = '122886b9dcb2a5bf1a168ad394a278d5e4b2765cde66b7044068825555c7269e';
const sha = value => createHash('sha256').update(value).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const first = raw.indexOf('{');
  if (first < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  const result = JSON.parse(raw.slice(first));
  if (result.error) throw new Error('CLOUD_CLI_REJECTED');
  return result.data;
}
function details() { return cliData(['fn', 'detail', 'task-command', '--json']); }
function route() {
  const row = cliData(['fn', 'get-route', 'task-command', '--json']);
  return { functionVersion: row.FunctionVersion ?? row.RoutingConfig?.FunctionVersion ?? null,
    weights: row.RoutingConfig?.AdditionalVersionWeights ?? [],
    matches: row.RoutingConfig?.AdditionVersionMatches ?? [],
    legacyMatches: row.RoutingConfig?.AddtionVersionMatchs ?? [] };
}
function signature(value) {
  const variables = value.Environment?.Variables;
  if (!Array.isArray(variables) || variables.length !== 6
    || variables.some(row => typeof row.Key !== 'string' || typeof row.Value !== 'string'
      || row.Value.length === 0)) throw new Error('FUNCTION_ENV_UNAVAILABLE');
  return { runtime: value.Runtime, timeout: value.Timeout, memory: value.MemorySize,
    handler: value.Handler, role: value.Role, installDependency: value.InstallDependency,
    triggers: value.Triggers, vpc: value.VpcConfig, publicNet: value.PublicNetConfig,
    environmentDigest: sha(JSON.stringify(variables.map(row => [row.Key, row.Value])
      .sort((a, b) => a[0].localeCompare(b[0])))) };
}
function hmac(key, text) { return createHmac('sha256', key).update(text).digest(); }
async function scfCall(action, payload, credentials, region) {
  const host = 'scf.tencentcloudapi.com';
  const service = 'scf';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const body = JSON.stringify(payload);
  const canonicalRequest = `POST\n/\n\ncontent-type:${contentType}\nhost:${host}\n\ncontent-type;host\n${sha(body)}`;
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha(canonicalRequest)}`;
  const dateKey = hmac(`TC3${credentials.secretKey}`, date);
  const serviceKey = hmac(dateKey, service);
  const signingKey = hmac(serviceKey, 'tc3_request');
  const signatureValue = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signatureValue}`;
  let response;
  try {
    response = await fetch(`https://${host}/`, { method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': contentType,
        Host: host, 'X-TC-Action': action, 'X-TC-Version': '2018-04-16',
        'X-TC-Timestamp': String(timestamp), 'X-TC-Region': region,
        'X-TC-Token': credentials.token }, body, signal: AbortSignal.timeout(90000) });
  } catch (error) { throw new Error(`SCF_NETWORK_${String(error?.code ?? error?.name ?? 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '')}`); }
  const data = await response.json().catch(() => null);
  if (!data?.Response || data.Response.Error || !response.ok) {
    const code = String(data?.Response?.Error?.Code ?? `HTTP_${response.status}`)
      .replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 90);
    throw new Error(`SCF_REJECTED_${action}_${code}`);
  }
  return data.Response;
}
async function waitForHash(expected) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const row = details();
    if (row.Status === 'Active' && sha(row.CodeInfo ?? '') === expected) return row;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('FUNCTION_READBACK_TIMEOUT');
}
const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envLine = (await readFile(resolve(root, '.env.local'), 'utf8'))
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='));
const envId = envLine?.slice('TCB_ENV_ID='.length).trim();
if (!envId || config.envId !== envId || config.region !== 'ap-shanghai') {
  throw new Error('NONPRODUCTION_REGION_GATE');
}
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== envId || environments[0].Status !== 'NORMAL'
  || environments[0].PackageName !== '个人版'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const current = details();
const currentRoute = route();
if (current.Status !== 'Active' || current.Runtime !== 'Nodejs20.19'
  || current.Timeout !== 20 || current.MemorySize !== 256
  || current.InstallDependency !== 'FALSE' || current.Handler !== 'index.main'
  || currentRoute.functionVersion !== '$LATEST' || currentRoute.weights.length
  || currentRoute.matches.length || currentRoute.legacyMatches.length) {
  throw new Error('FUNCTION_CONFIG_GATE');
}
const credentials = cliData(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || !credentials.secretId || !credentials.secretKey || !credentials.token
  || Date.parse(credentials.expiredAt) <= Date.now() + 120000) {
  throw new Error('TEMPORARY_CREDENTIALS_GATE');
}
if (mode === 'probe') {
  const response = await scfCall('GetFunction', { FunctionName: 'task-command',
    Namespace: envId, Qualifier: '$LATEST' }, credentials, config.region);
  if (response.FunctionName !== 'task-command' || response.Status !== 'Active') {
    throw new Error('SIGNED_READ_PROBE_MISMATCH');
  }
  process.stdout.write(JSON.stringify({ status: 'signed-read-ok', functionStatus: response.Status,
    codeSha256: sha(current.CodeInfo), installDependency: current.InstallDependency }) + '\n');
  process.exit(0);
}
if (mode === 'verify') {
  if (sha(current.CodeInfo) !== NEW_HASH) throw new Error('NEW_CODE_NOT_ACTIVE');
  process.stdout.write(JSON.stringify({ status: 'verified', codeSha256: NEW_HASH,
    installDependency: current.InstallDependency, route: currentRoute.functionVersion }) + '\n');
  process.exit(0);
}
const expectedBefore = mode === 'apply' ? OLD_HASH : NEW_HASH;
const expectedAfter = mode === 'apply' ? NEW_HASH : OLD_HASH;
const zipPath = mode === 'apply' ? candidateZip : baselineZip;
if (sha(current.CodeInfo) !== expectedBefore) throw new Error('FUNCTION_CODE_GATE');
const zip = await readFile(zipPath);
if (zip.length >= 10 * 1024 * 1024 || sha(zip) !== (mode === 'apply'
  ? CANDIDATE_ZIP_HASH : BASELINE_ZIP_HASH)) throw new Error('ZIP_FROZEN_ARTIFACT_GATE');
const beforeConfig = signature(current);
const body = { FunctionName: 'task-command', Namespace: envId,
  Handler: 'index.main', ZipFile: zip.toString('base64'),
  InstallDependency: 'FALSE', Publish: 'FALSE' };
try {
  await scfCall('UpdateFunctionCode', body, credentials, config.region);
  const after = await waitForHash(expectedAfter);
  if (!same(beforeConfig, signature(after)) || !same(currentRoute, route())) {
    throw new Error('POST_UPDATE_CONFIG_DRIFT');
  }
  process.stdout.write(JSON.stringify({ status: mode === 'apply' ? 'deployed' : 'rolled-back',
    codeSha256: expectedAfter, configUnchanged: true, routeUnchanged: true,
    installDependency: after.InstallDependency }) + '\n');
} catch (error) {
  const readback = details();
  const codeHash = sha(readback.CodeInfo ?? '');
  if (codeHash !== expectedBefore && codeHash !== expectedAfter) {
    throw new Error(`STOP_CONCURRENT_CODE_CHANGE_${error.message}`);
  }
  if (mode === 'apply' && codeHash === NEW_HASH) {
    try {
      const originalZip = await readFile(baselineZip);
      if (sha(originalZip) !== BASELINE_ZIP_HASH) throw new Error('ROLLBACK_ZIP_HASH_CHANGED');
      await scfCall('UpdateFunctionCode', { FunctionName: 'task-command', Namespace: envId,
        Handler: 'index.main', ZipFile: originalZip.toString('base64'),
        InstallDependency: 'FALSE', Publish: 'FALSE' }, credentials, config.region);
      const restored = await waitForHash(OLD_HASH);
      if (!same(beforeConfig, signature(restored)) || !same(currentRoute, route())) {
        throw new Error('ROLLBACK_CONFIG_DRIFT');
      }
      throw new Error(`APPLY_FAILED_ROLLED_BACK_${error.message}`);
    } catch (rollbackError) {
      if (String(rollbackError.message).startsWith('APPLY_FAILED_ROLLED_BACK_')) throw rollbackError;
      throw new Error(`APPLY_FAILED_ROLLBACK_UNVERIFIED_${error.message}`);
    }
  }
  throw new Error(`${mode.toUpperCase()}_FAILED_${codeHash === expectedBefore ? 'BASELINE_UNCHANGED' : 'CODE_CHANGED'}_${error.message}`);
}
