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
  Object.freeze({ name: 'activity-query', timeout: 10 }),
  Object.freeze({ name: 'activity-command', timeout: 20 }),
  Object.freeze({ name: 'vocabulary-evidence-query', timeout: 10 }),
  Object.freeze({ name: 'vocabulary-evidence-command', timeout: 15 }),
  Object.freeze({ name: 'student-work-query', timeout: 10 }),
  Object.freeze({ name: 'student-work-command', timeout: 60, memorySize: 512 }),
  Object.freeze({ name: 'phonics-query', timeout: 10 }),
  Object.freeze({ name: 'phonics-command', timeout: 15 }),
  Object.freeze({ name: 'task-template-query', timeout: 10 }),
  Object.freeze({ name: 'task-template-command', timeout: 20 }),
  Object.freeze({ name: 'teacher-textbook-query', timeout: 10 }),
  Object.freeze({ name: 'teacher-textbook-command', timeout: 20 }),
  Object.freeze({ name: 'learning-stats-query', timeout: 20 }),
  Object.freeze({ name: 'notification-query', timeout: 10 }),
  Object.freeze({ name: 'notification-command', timeout: 10 }),
  Object.freeze({ name: 'maintenance-timer', timeout: 60 }),
  Object.freeze({ name: 'admin-task-activity-query', timeout: 20 }),
  Object.freeze({ name: 'admin-task-activity-command', timeout: 20 }),
  Object.freeze({ name: 'textbook-admin-query', timeout: 20 }),
  Object.freeze({ name: 'textbook-admin-command', timeout: 20 }),
  Object.freeze({ name: 'task-recording-query', timeout: 20 }),
  Object.freeze({ name: 'task-recording-command', timeout: 60, memorySize: 512 }),
]);

/** All M3 pronunciation functions require explicit opt-in and stay out of M1/M2 bundles. */
export const PRONUNCIATION_FUNCTIONS = Object.freeze([
  Object.freeze({ name: 'pronunciation-command', timeout: 60, memorySize: 512 }),
  Object.freeze({ name: 'pronunciation-query', timeout: 20, memorySize: 256 }),
  Object.freeze({ name: 'pronunciation-worker', timeout: 300, memorySize: 512 }),
]);

/** Explicitly opt-in review bundles. These are never added to the standard M1/M2 build. */
export const NATIVE_ADMIN_FUNCTIONS = Object.freeze([
  Object.freeze({ name: 'native-admin-query', timeout: 20, memorySize: 256 }),
  Object.freeze({ name: 'native-admin-command', timeout: 20, memorySize: 256 }),
  Object.freeze({ name: 'native-admin-management-command', timeout: 20, memorySize: 256 }),
  Object.freeze({ name: 'native-admin-operations-command', timeout: 20, memorySize: 256 }),
  Object.freeze({ name: 'native-admin-media-command', timeout: 20, memorySize: 256 }),
]);

/** Student account provisioning uses the protected Manager Auth runtime and is opt-in. */
export const TEACHER_STUDENT_IMPORT_FUNCTIONS = Object.freeze([
  Object.freeze({ name: 'teacher-student-import-command', timeout: 300, memorySize: 512 }),
]);

/** High-memory teacher video processing is built only after its cost and runtime review. */
export const TEACHER_PRIVATE_VIDEO_FUNCTIONS = Object.freeze([
  Object.freeze({ name: 'teacher-private-video-worker', timeout: 900, memorySize: 3072 }),
]);

/** Qwen-backed teacher suggestions are opt-in and excluded from standard M1/M2 builds. */
export const TEACHER_AI_FUNCTIONS = Object.freeze([
  Object.freeze({ name: 'teacher-suggestion-command', timeout: 240, memorySize: 512 }),
  Object.freeze({ name: 'teacher-suggestion-worker', timeout: 240, memorySize: 512 }),
]);
export const TEACHER_AI_CLOSURE_FUNCTIONS = Object.freeze([
  CLOUD_FUNCTIONS.find(({ name }) => name === 'submission-command'),
  CLOUD_FUNCTIONS.find(({ name }) => name === 'review-command'),
  ...TEACHER_AI_FUNCTIONS,
]);

/** Narrow runtime-only repair package for the trusted CloudBase Auth subject mapping. */
export const IDENTITY_RUNTIME_FUNCTIONS = Object.freeze([
  CLOUD_FUNCTIONS.find(({ name }) => name === 'auth-session'),
  NATIVE_ADMIN_FUNCTIONS.find(({ name }) => name === 'native-admin-management-command'),
]);

export async function buildCloudFunctions(options = {}) {
  const outputRoot = resolveOutputRoot(options.outDir ?? DEFAULT_OUTPUT_ROOT);
  const esbuild = loadExistingEsbuild();
  const selectorFlags = [options.identityRuntimeOnly, options.nativeAdminOnly, options.teacherStudentImportOnly, options.pronunciationOnly,
    options.teacherAiClosureOnly, options.teacherAiOnly, options.teacherPrivateVideoOnly, options.includeNativeAdmin,
    options.includePronunciation, options.includeTeacherAi];
  if (options.functionNames !== undefined && selectorFlags.some(Boolean)) {
    throw new Error('functionNames cannot be combined with bundle selectors.');
  }
  const definitions = options.functionNames !== undefined
    ? (() => {
      if (!Array.isArray(options.functionNames) || options.functionNames.length === 0
        || new Set(options.functionNames).size !== options.functionNames.length) {
        throw new Error('functionNames must contain unique standard function names.');
      }
      const selected = options.functionNames.map((name) => CLOUD_FUNCTIONS.find((item) => item.name === name));
      if (selected.some((item) => item === undefined)) throw new Error('functionNames includes a nonstandard function.');
      return selected;
    })()
    : options.identityRuntimeOnly === true ? IDENTITY_RUNTIME_FUNCTIONS
    : options.nativeAdminOnly === true ? NATIVE_ADMIN_FUNCTIONS
      : options.teacherStudentImportOnly === true ? TEACHER_STUDENT_IMPORT_FUNCTIONS
    : options.teacherPrivateVideoOnly === true ? TEACHER_PRIVATE_VIDEO_FUNCTIONS
    : options.pronunciationOnly === true ? PRONUNCIATION_FUNCTIONS
      : options.teacherAiClosureOnly === true ? TEACHER_AI_CLOSURE_FUNCTIONS
      : options.teacherAiOnly === true ? TEACHER_AI_FUNCTIONS
      : [...CLOUD_FUNCTIONS,
        ...(options.includeNativeAdmin === true ? NATIVE_ADMIN_FUNCTIONS : []),
        ...(options.includePronunciation === true ? PRONUNCIATION_FUNCTIONS : []),
        ...(options.includeTeacherAi === true ? TEACHER_AI_FUNCTIONS : [])];
  const stagingRoot = `${outputRoot}.staging-${process.pid}-${Date.now()}`;
  assertSafeGeneratedPath(stagingRoot);
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  try {
    await Promise.all(definitions.map((definition) => buildFunction(esbuild, definition, stagingRoot)));
    await verifyGeneratedPackages(stagingRoot, definitions);
    assertSafeGeneratedPath(outputRoot);
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(stagingRoot, outputRoot);
    return { outputRoot, functions: definitions.map(({ name }) => name) };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

async function buildFunction(esbuild, definition, stagingRoot) {
  const functionRoot = join(stagingRoot, definition.name);
  await mkdir(functionRoot, { recursive: true });
  const nativeAccountProviderSetup = definition.name === 'native-admin-management-command'
    || definition.name === 'teacher-student-import-command'
    ? "import { createTcbNativeAccountProviderFactory } from './functions/native-admin-management-command/tcb-account-provider-factory';"
    : '';
  const runtimeInstall = definition.name === 'native-admin-management-command'
    || definition.name === 'teacher-student-import-command'
    ? 'installCloudBaseNodeDeploymentFromEnvironment(createTcbNativeAccountProviderFactory);'
    : 'installCloudBaseNodeDeploymentFromEnvironment();';
  const entrySource = [
    "import { installCloudBaseNodeDeploymentFromEnvironment } from './functions/shared/cloudbase-node-deployment-entry';",
    nativeAccountProviderSetup,
    `import { main as functionMain } from './functions/${definition.name}/index';`,
    runtimeInstall,
    'export const main = functionMain;',
  ].filter(Boolean).join('\n');

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

async function verifyGeneratedPackages(stagingRoot, definitions) {
  for (const { name } of definitions) {
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

function readCliFunctionNames(argv) {
  const names = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--function') continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error('--function requires a standard function name.');
    names.push(value);
    index += 1;
  }
  return names.length === 0 ? undefined : names;
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  const argv = process.argv.slice(2);
  const result = await buildCloudFunctions({ outDir: readCliOutputRoot(argv),
    functionNames: readCliFunctionNames(argv),
    identityRuntimeOnly: argv.includes('--identity-runtime-only'),
    nativeAdminOnly: argv.includes('--native-admin-only'),
    teacherStudentImportOnly: argv.includes('--teacher-student-import-only'),
    teacherPrivateVideoOnly: argv.includes('--teacher-private-video-only'),
    pronunciationOnly: argv.includes('--pronunciation-only'),
    teacherAiClosureOnly: argv.includes('--teacher-ai-closure-only'),
    includePronunciation: argv.includes('--include-pronunciation'),
    teacherAiOnly: argv.includes('--teacher-ai-only'),
    includeTeacherAi: argv.includes('--include-teacher-ai') });
  process.stdout.write(`Built ${result.functions.length} CloudBase function packages in ${result.outputRoot}\n`);
}
