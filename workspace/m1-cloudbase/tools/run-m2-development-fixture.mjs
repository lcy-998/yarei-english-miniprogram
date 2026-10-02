import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'yarei-m2-fixture-'));
const outputFile = join(temporaryDirectory, 'm2-fixture.cjs');
const require = createRequire(import.meta.url);
try {
  await build({
    entryPoints: [fileURLToPath(new URL('../src/seed/m2-development-fixture-cli.ts', import.meta.url))],
    outfile: outputFile, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent',
  });
  require(outputFile);
} finally {
  const resolved = await realpath(temporaryDirectory);
  const parent = await realpath(tmpdir());
  if (dirname(resolved).toLowerCase() !== parent.toLowerCase()) {
    throw new Error('Temporary fixture directory escaped its parent.');
  }
  await rm(resolved, { recursive: true, force: true });
}
