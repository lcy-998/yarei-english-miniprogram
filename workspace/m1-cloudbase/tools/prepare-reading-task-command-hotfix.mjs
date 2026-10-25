import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Prepares a code-only review artifact from the currently deployed nonproduction bundle.
// This script performs no cloud writes and never prints function environment values.
const root = resolve(import.meta.dirname, '..');
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const envLine = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='));
const expectedEnvId = envLine?.slice('TCB_ENV_ID='.length).trim();
if (!expectedEnvId || config.envId !== expectedEnvId) throw new Error('NONPRODUCTION_ENV_MISMATCH');

function cliData(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8',
    windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('CLOUD_CLI_JSON_UNAVAILABLE');
  return JSON.parse(raw.slice(start)).data;
}
const environments = cliData(['env', 'list', '--json']);
if (!Array.isArray(environments) || environments.length !== 1
  || environments[0].EnvId !== expectedEnvId || environments[0].Status !== 'NORMAL'
  || environments[0].EnableOverrun !== false || environments[0].EnvPaid !== 'no'
  || environments[0].EnvCharged !== 'no') throw new Error('ENVIRONMENT_OR_COST_PREFLIGHT_FAILED');
const detail = cliData(['fn', 'detail', 'task-command', '--json']);
if (detail.FunctionName !== 'task-command' || detail.Status !== 'Active'
  || detail.Runtime !== 'Nodejs20.19' || detail.Timeout !== 20
  || detail.MemorySize !== 256 || detail.InstallDependency !== 'FALSE'
  || detail.FunctionVersion !== '$LATEST' || !Array.isArray(detail.Triggers)
  || detail.Triggers.length !== 0 || typeof detail.CodeInfo !== 'string'
  || !detail.CodeInfo.includes('approvedReadingPronunciation')) {
  throw new Error('REMOTE_FUNCTION_BASELINE_CHANGED');
}
const changes = [
  ['function approvedReadingPronunciation(payload, resourceVersion) {',
    'function approvedReadingPronunciation(payload, resourceVersion, copyrightStatus = payload.copyrightStatus) {'],
  ['if (payload.copyrightStatus !== "verified" || !record2(payload.pronunciation)) return false;',
    'if (copyrightStatus !== "verified" || !record2(payload.pronunciation)) return false;'],
  ['!approvedReadingPronunciation(resource.payload, resource.contentVersion)',
    '!approvedReadingPronunciation(resource.payload, resource.contentVersion, resource.copyrightStatus ?? null)'],
  ['snapshotSchemaVersion: wordIds === null ? 1 : 2,\n      resourceSnapshot: { title: resource.title, type: resource.type, payload: resource.payload },',
    'snapshotSchemaVersion: wordIds === null ? 1 : 2,\n      resourceSnapshot: { title: resource.title, type: resource.type, payload: resource.type === "reading" && resource.copyrightStatus ? { ...resource.payload, copyrightStatus: resource.copyrightStatus } : resource.payload },'],
];
let patched = detail.CodeInfo;
for (const [before, after] of changes) {
  if (patched.split(before).length !== 2) throw new Error('REMOTE_PATCH_CONTEXT_CHANGED');
  patched = patched.replace(before, after);
}
const output = resolve(root, 'dist/m3-reading-assignment-hotfix-20261007');
const target = resolve(output, 'task-command');
mkdirSync(target, { recursive: true });
writeFileSync(resolve(output, 'baseline-index.js'), detail.CodeInfo, 'utf8');
writeFileSync(resolve(target, 'index.js'), patched, 'utf8');
writeFileSync(resolve(target, 'package.json'), `${JSON.stringify({
  name: 'yarei-cloud-function-task-command', version: '0.1.0', private: true,
  main: 'index.js', engines: { node: '20.19.x' },
  dependencies: { '@cloudbase/node-sdk': '3.18.3' },
}, null, 2)}\n`, 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
process.stdout.write(JSON.stringify({ status: 'prepared', remoteModifiedAt: detail.ModTime,
  remoteCodeSha256: sha(detail.CodeInfo), patchedCodeSha256: sha(patched),
  baselineBytes: Buffer.byteLength(detail.CodeInfo), patchedBytes: Buffer.byteLength(patched),
  replacementCount: changes.length, output }) + '\n');
