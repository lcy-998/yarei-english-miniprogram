import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(workspaceRoot, 'm1-cloudbase', '.env.local');
const outputPath = resolve(workspaceRoot, 'miniprogram', 'runtime', 'cloudbase.local.ts');
const adminOutputPath = resolve(workspaceRoot, 'admin-console', '.env.local');

const source = await readFile(sourcePath, 'utf8');
const environmentId = readVariable(source, 'TCB_ENV_ID');
if (environmentId === null) throw new Error('TCB_ENV_ID is unavailable in the approved local M1 configuration.');

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `// Generated from the local M1 development configuration. Do not commit.\nexport const cloudBaseDevelopmentEnvId = ${JSON.stringify(environmentId)}\n`,
  { encoding: 'utf8', mode: 0o600 },
);
await writeFile(adminOutputPath, `VITE_CLOUDBASE_ENV_ID=${environmentId}\n`, { encoding: 'utf8', mode: 0o600 });
process.stdout.write('Prepared local miniprogram and admin CloudBase development configuration without printing its value.\n');

function readVariable(sourceText, name) {
  for (const rawLine of sourceText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1 || line.slice(0, separator).trim() !== name) continue;
    const rawValue = line.slice(separator + 1).trim();
    const value = rawValue.length >= 2 && ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'")))
      ? rawValue.slice(1, -1)
      : rawValue;
    return value.length > 0 && value.length <= 128 && !/\s/u.test(value) ? value : null;
  }
  return null;
}
