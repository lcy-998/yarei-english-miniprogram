import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve('D:/app-m3-cache/student/media-draft-projection-20261006/student-task-query-verify-readback-2');
const output = resolve(root, 'dist/student-task-query-runtime-repair-20261007');
const expectedSourceHash = '17F2ECC5F1797DE513083A64D89AB5FB8A938F7875CBCB3BDD36E758E1714588';
const hash = value => createHash('sha256').update(value).digest('hex').toUpperCase();

if (relative(resolve(root, 'dist'), output).startsWith('..') || isAbsolute(relative(resolve(root, 'dist'), output))) {
  throw new Error('OUTPUT_OUTSIDE_DIST');
}
if (!existsSync(join(source, 'index.js')) || !existsSync(join(source, 'package.json'))) {
  throw new Error('REVIEWED_REMOTE_BACKUP_MISSING');
}
const original = await readFile(join(source, 'index.js'));
if (hash(original) !== expectedSourceHash) throw new Error('REVIEWED_REMOTE_BACKUP_CHANGED');
const originalPackage = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
if (originalPackage.dependencies?.['@cloudbase/node-sdk'] !== '3.18.3') {
  throw new Error('SDK_VERSION_MISMATCH');
}
if ((await readdir(output).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).length) {
  throw new Error('OUTPUT_NOT_EMPTY');
}

const require = createRequire(join(root, 'package.json'));
const esbuild = require('esbuild');
const sdkEntry = require.resolve('@cloudbase/node-sdk');
const installedSdk = JSON.parse(await readFile(resolve(root, 'node_modules/@cloudbase/node-sdk/package.json'), 'utf8'));
if (installedSdk.version !== '3.18.3') throw new Error('INSTALLED_SDK_VERSION_MISMATCH');
await mkdir(output, { recursive: true });
const result = await esbuild.build({
  entryPoints: [join(source, 'index.js')],
  outfile: join(output, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20.19',
  format: 'cjs',
  alias: { '@cloudbase/node-sdk': sdkEntry },
  external: ['node:*'],
  legalComments: 'eof',
  metafile: true,
  logLevel: 'silent',
});
const external = Object.values(result.metafile.outputs)
  .flatMap(file => file.imports.filter(item => item.external).map(item => item.path));
if (external.some(name => !name.startsWith('node:') && !require('node:module').builtinModules.includes(name)
  && name !== 'supports-color')) throw new Error('UNEXPECTED_EXTERNAL_DEPENDENCY');
await writeFile(join(output, 'package.json'), `${JSON.stringify({
  name: originalPackage.name,
  version: originalPackage.version,
  private: true,
  main: 'index.js',
  engines: originalPackage.engines,
}, null, 2)}\n`, { flag: 'wx' });
const repaired = await readFile(join(output, 'index.js'));
process.stdout.write(JSON.stringify({ sourceHash: expectedSourceHash, outputHash: hash(repaired),
  outputBytes: repaired.length, nonBuiltinExternal: external.filter(name => name === 'supports-color') }) + '\n');
