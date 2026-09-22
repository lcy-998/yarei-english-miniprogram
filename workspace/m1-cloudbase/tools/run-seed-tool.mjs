import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'yarei-seed-tool-'));
const outputFile = join(temporaryDirectory, 'seed-tool.cjs');
const require = createRequire(import.meta.url);

try {
  await build({
    entryPoints: [fileURLToPath(new URL('../src/seed/cli.ts', import.meta.url))],
    outfile: outputFile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  });
  const seedTool = require(outputFile);
  await seedTool.completion;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
