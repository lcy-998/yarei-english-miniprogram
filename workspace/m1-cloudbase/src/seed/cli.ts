import { CONTENT_HASH_PLACEHOLDER, prepareSeedPackage } from './canonical-json';
import { loadSeedFile, SeedLoadError } from './loader';
import { createSeedPlan } from './plan';
import { validateSeedPackage } from './validator';

interface ProcessPort { readonly argv: readonly string[]; exitCode?: number }
interface ConsolePort { log(value: string): void; error(value: string): void }
declare const process: ProcessPort;
declare const console: ConsolePort;
declare const require: (moduleName: 'node:path') => { resolve(path: string): string };

const [, , command, inputPath] = process.argv;
const selectedPath = inputPath ?? '../../docs/m1-cloudbase/templates/development-seed.example.json';

if (!command || !['validate', 'plan', 'hash'].includes(command)) {
  console.error('用法：seed-tool <validate|plan|hash> [seed.json]');
  process.exitCode = 2;
} else {
  // Exported completion lets the local runner wait before deleting its temporary bundle.
}

export const completion = command && ['validate', 'plan', 'hash'].includes(command)
  ? run(command, selectedPath)
  : Promise.resolve();

async function run(commandName: string, filePath: string): Promise<void> {
  try {
    const loaded = await loadSeedFile(require('node:path').resolve(filePath));
    const prepared = loaded.manifest.contentHash === CONTENT_HASH_PLACEHOLDER ? prepareSeedPackage(loaded) : loaded;
    const validation = validateSeedPackage(prepared);
    if (commandName === 'hash') {
      console.log(validation.computedContentHash);
      return;
    }
    if (!validation.ok) {
      console.error(JSON.stringify({ ok: false, issues: validation.issues }, null, 2));
      process.exitCode = 1;
      return;
    }
    if (commandName === 'validate') {
      console.log(JSON.stringify({
        ok: true,
        seedVersion: prepared.manifest.seedVersion,
        seedRunId: prepared.manifest.seedRunId,
        contentHash: validation.computedContentHash,
        placeholderPreparedInMemory: loaded.manifest.contentHash === CONTENT_HASH_PLACEHOLDER,
        counts: validation.counts,
        cloudAccess: false,
      }, null, 2));
      return;
    }
    console.log(JSON.stringify(createSeedPlan(prepared, validation), null, 2));
  } catch (error) {
    const message = error instanceof SeedLoadError || error instanceof Error ? error.message : '未知本地校验错误。';
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    process.exitCode = 1;
  }
}
