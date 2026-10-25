// Read-only mapping; never prints the subject pepper or credentials.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envId = 'cloud1-d8ggzrwwedb786e41';
const cfg = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (cfg.envId !== envId || localEnv !== envId) throw new Error('ENV_MISMATCH');
const pepper = cfg.functions?.[0]?.envVariables?.YAREI_SUBJECT_PEPPER;
if (typeof pepper !== 'string' || pepper.length < 16) throw new Error('PEPPER_UNAVAILABLE');
const folder = 'C:/Users/18167/AppData/Local/Yarei/three-demo-cleanup-backup-2026-10-22T05-41-58-168Z';
const identities = JSON.parse(readFileSync(resolve(folder, 'database/auth_identities.json'), 'utf8'));
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const raw = execFileSync(process.execPath, [cli, 'user', 'list', '-e', envId,
  '--offset', '0', '--limit', '100', '--json'], { cwd: root, encoding: 'utf8',
  windowsHide: true, timeout: 30000 });
const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
if (parsed.error || !Array.isArray(parsed.data)) throw new Error('AUTH_LIST_FAILED');
const result = parsed.data.map(account => {
  const digest = `sd1_${createHmac('sha256', pepper)
    .update(`yarei:platform-subject:v1\u0000cloudbase:username:${account.Uid}`)
    .digest('base64url')}`;
  const matches = identities.filter(row => row.provider === 'cloudbase_uid'
    && row.providerSubjectDigest === digest);
  return { alias: account.Name, mappedUserIds: matches.map(row => row.userId) };
});
console.log(JSON.stringify(result));
