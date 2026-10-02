import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'yarei-m2-offline-seed-'));
const outputFile = join(temporaryDirectory, 'm2-offline-seed.cjs');
const require = createRequire(import.meta.url);
try {
  await build({
    entryPoints: [fileURLToPath(new URL('../src/seed/m2-offline-rehearsal-cli.ts', import.meta.url))],
    outfile: outputFile, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent',
  });
  await require(outputFile).completion;
} finally {
  const resolved = await realpath(temporaryDirectory);
  const parent = await realpath(tmpdir());
  if (dirname(resolved).toLowerCase() !== parent.toLowerCase()) {
    throw new Error('Temporary offline seed directory escaped its parent.');
  }
  await rm(resolved, { recursive: true, force: true });
}
