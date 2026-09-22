import { createRequire } from 'node:module';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT_ROOT = resolve(PROJECT_ROOT, 'dist', 'functions');
const SDK_PACKAGE = '@cloudbase/node-sdk';
const SDK_VERSION = '3.18.3';

export const CLOUD_FUNCTIONS = Object.freeze([
  Object.freeze({ name: 'auth-session', timeout: 10 }),
  Object.freeze({ name: 'admin-session', timeout: 10 }),
  Object.freeze({ name: 'task-query', timeout: 10 }),
  Object.freeze({ name: 'task-command', timeout: 20 }),
  Object.freeze({ name: 'student-task-query', timeout: 10 }),
  Object.freeze({ name: 'submission-command', timeout: 15 }),
  Object.freeze({ name: 'review-query', timeout: 10 }),
  Object.freeze({ name: 'review-command', timeout: 20 }),
  Object.freeze({ name: 'parent-query', timeout: 10 }),
  Object.freeze({ name: 'relationship-command', timeout: 15 }),
  Object.freeze({ name: 'content-query', timeout: 10 }),
  Object.freeze({ name: 'organization-admin', timeout: 20 }),
  Object.freeze({ name: 'learning-progress-query', timeout: 10 }),
  Object.freeze({ name: 'learning-progress-command', timeout: 15 }),
  Object.freeze({ name: 'teacher-student-query', timeout: 10 }),
  Object.freeze({ name: 'teacher-student-command', timeout: 15 }),
]);

export async function buildCloudFunctions(options = {}) {
  const outputRoot = resolveOutputRoot(options.outDir ?? DEFAULT_OUTPUT_ROOT);
  const esbuild = loadExistingEsbuild();
  const stagingRoot = `${outputRoot}.staging-${process.pid}-${Date.now()}`;
  assertSafeGeneratedPath(stagingRoot);
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  try {
    await Promise.all(CLOUD_FUNCTIONS.map((definition) => buildFunction(esbuild, definition, stagingRoot)));
    await verifyGeneratedPackages(stagingRoot);
    assertSafeGeneratedPath(outputRoot);
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(stagingRoot, outputRoot);
    return { outputRoot, functions: CLOUD_FUNCTIONS.map(({ name }) => name) };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

async function buildFunction(esbuild, definition, stagingRoot) {
  const functionRoot = join(stagingRoot, definition.name);
  await mkdir(functionRoot, { recursive: true });
  const entrySource = [
    "import { installCloudBaseNodeDeploymentFromEnvironment } from './functions/shared/cloudbase-node-deployment-entry';",
    `import { main as functionMain } from './functions/${definition.name}/index';`,
    'installCloudBaseNodeDeploymentFromEnvironment();',
    'export const main = functionMain;',
  ].join('\n');

  await esbuild.build({
    stdin: {
      contents: entrySource,
      loader: 'ts',
      resolveDir: PROJECT_ROOT,
      sourcefile: `deployment/${definition.name}.ts`,
    },
    outfile: join(functionRoot, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node20.19',
    format: 'cjs',
    external: [SDK_PACKAGE, 'node:*'],
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    treeShaking: true,
    logLevel: 'silent',
  });

  await writeFile(join(functionRoot, 'package.json'), `${JSON.stringify({
    name: `yarei-cloud-function-${definition.name}`,
    version: '0.1.0',
    private: true,
    main: 'index.js',
    engines: { node: '20.19.x' },
    dependencies: { [SDK_PACKAGE]: SDK_VERSION },
  }, null, 2)}\n`, 'utf8');
}

function loadExistingEsbuild() {
  try {
    return createRequire(join(PROJECT_ROOT, 'package.json'))('esbuild');
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  }
  throw new Error('The pinned local esbuild dependency is unavailable; no dependency was downloaded.');
}

async function verifyGeneratedPackages(stagingRoot) {
  for (const { name } of CLOUD_FUNCTIONS) {
    const bundle = await readFile(join(stagingRoot, name, 'index.js'), 'utf8');
    if (!bundle.includes(SDK_PACKAGE)
      || !bundle.includes('bootstrapCloudBaseNodeDeployment')
      || /require\(["']\.{1,2}[\\/]/.test(bundle)) {
      throw new Error(`Generated package ${name} is not a self-contained deployment bundle.`);
    }
  }
}

function resolveOutputRoot(value) {
  const resolved = isAbsolute(value) ? resolve(value) : resolve(PROJECT_ROOT, value);
  assertSafeGeneratedPath(resolved);
  return resolved;
}

function assertSafeGeneratedPath(candidate) {
  const resolvedCandidate = resolve(candidate);
  const allowedRoots = [resolve(PROJECT_ROOT, 'dist'), resolve(tmpdir())];
  const allowed = allowedRoots.some((root) => {
    const pathFromRoot = relative(root, resolvedCandidate);
    return pathFromRoot !== '' && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
  });
  if (!allowed) throw new Error(`Refusing to replace unsafe generated output path: ${resolvedCandidate}`);
}

function readCliOutputRoot(argv) {
  const index = argv.indexOf('--outdir');
  if (index === -1) return DEFAULT_OUTPUT_ROOT;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error('--outdir requires a path.');
  return value;
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  const result = await buildCloudFunctions({ outDir: readCliOutputRoot(process.argv.slice(2)) });
  process.stdout.write(`Built ${result.functions.length} CloudBase function packages in ${result.outputRoot}\n`);
}
