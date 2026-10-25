import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCloudFunctions, CLOUD_FUNCTIONS, IDENTITY_RUNTIME_FUNCTIONS, NATIVE_ADMIN_FUNCTIONS, TEACHER_AI_FUNCTIONS, TEACHER_PRIVATE_VIDEO_FUNCTIONS, TEACHER_STUDENT_IMPORT_FUNCTIONS } from '../../tools/build-cloud-functions.mjs';
import { FUNCTION_NAMES } from '../../src/shared/protocol';

const SDK_PACKAGE = '@cloudbase/node-sdk';
const SDK_VERSION = '3.18.3';
const CONFIG_TEMPLATE = fileURLToPath(
  new URL('../../../../docs/m1-cloudbase/templates/cloudbaserc.example.json', import.meta.url),
);
const TIMER_TEMPLATE = fileURLToPath(
  new URL('../../../../docs/m2-maintenance-timer-trigger.example.json', import.meta.url),
);
const FUNCTION_SECURITY_TEMPLATE = fileURLToPath(
  new URL('../../../../docs/m1-cloudbase/templates/function-security-rules.example.json', import.meta.url),
);
const STORAGE_FRAGMENTS = [
  fileURLToPath(new URL('../../../../docs/m2-task-recording-storage-rule.example.json', import.meta.url)),
  fileURLToPath(new URL('../../../../docs/m2-student-work-storage-rule.example.json', import.meta.url)),
] as const;
const SECRET_ENVIRONMENT_VARIABLES = [
  'YAREI_SUBJECT_PEPPER',
  'YAREI_QUERY_CURSOR_SIGNING_KEY',
  'YAREI_BATCH_REVIEW_SIGNING_KEY',
  'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY',
  'YAREI_BINDING_CODE_DERIVATION_KEY',
  'YAREI_BINDING_CODE_PEPPER',
] as const;

let temporaryRoot = '';
let outputRoot = '';
let nativeAdminOutputRoot = '';
let teacherAiOutputRoot = '';
let identityRuntimeOutputRoot = '';
let teacherStudentImportOutputRoot = '';

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'yarei-cloud-functions-'));
  outputRoot = join(temporaryRoot, 'functions');
  nativeAdminOutputRoot = join(temporaryRoot, 'native-admin-functions');
  teacherAiOutputRoot = join(temporaryRoot, 'teacher-ai-functions');
  identityRuntimeOutputRoot = join(temporaryRoot, 'identity-runtime-functions');
  teacherStudentImportOutputRoot = join(temporaryRoot, 'teacher-student-import-functions');
  await buildCloudFunctions({ outDir: outputRoot });
  await buildCloudFunctions({ outDir: nativeAdminOutputRoot, nativeAdminOnly: true });
  await buildCloudFunctions({ outDir: teacherAiOutputRoot, teacherAiOnly: true });
  await buildCloudFunctions({ outDir: identityRuntimeOutputRoot, identityRuntimeOnly: true });
  await buildCloudFunctions({ outDir: teacherStudentImportOutputRoot, teacherStudentImportOnly: true });
// The complete set of independently bundled functions shares CI CPU with the
// other Vitest workers; the assertion still checks every generated package.
}, 120000);

afterAll(async () => {
  if (temporaryRoot !== '') await rm(temporaryRoot, { recursive: true, force: true });
});

describe('CloudBase deployment packages', () => {
  it('builds an independent CommonJS package for every registered function', async () => {
    // These M3 entries remain local-only until their separate security/grant
    // review: never package them with the six existing business keys.
    expect(CLOUD_FUNCTIONS.map(({ name }) => name).sort())
      .toEqual(FUNCTION_NAMES.filter(name => name !== 'native-admin-query'
        && name !== 'native-admin-command'
        && name !== 'native-admin-management-command'
        && name !== 'native-admin-operations-command'
        && name !== 'native-admin-media-command'
        && name !== 'pronunciation-command'
        && name !== 'pronunciation-query'
        && name !== 'pronunciation-worker'
        && name !== 'teacher-suggestion-command'
        && name !== 'teacher-suggestion-worker'
        && name !== 'teacher-private-video-worker'
        && name !== 'teacher-student-import-command').sort());
    const expectedNames = CLOUD_FUNCTIONS.map(({ name }) => name).sort();
    const packageNames = (await readdir(outputRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(packageNames).toEqual(expectedNames);

    for (const functionName of expectedNames) {
      const functionRoot = join(outputRoot, functionName);
      expect((await readdir(functionRoot)).sort()).toEqual(['index.js', 'package.json']);
      const bundle = await readFile(join(functionRoot, 'index.js'), 'utf8');
      const packageJson = JSON.parse(await readFile(join(functionRoot, 'package.json'), 'utf8'));
      const deploymentModule = createRequire(import.meta.url)(join(functionRoot, 'index.js')) as { main?: unknown };
      const externalRequires = [...bundle.matchAll(/\brequire\("([^"]+)"\)/g)].map((match) => match[1]);

      expect(bundle).toContain('bootstrapCloudBaseNodeDeployment');
      expect(bundle).toContain('installCloudBaseNodeDeploymentFromEnvironment');
      expect(bundle).toContain(`require("${SDK_PACKAGE}")`);
      expect(bundle).toMatch(/module\.exports|exports\.main/);
      expect(bundle).not.toMatch(/require\(["']\.{1,2}[\\/]/);
      expect(bundle).not.toContain('sourceMappingURL');
      expect(externalRequires.every((name) => name === SDK_PACKAGE || name.startsWith('node:')
        || builtinModules.includes(name)
        || ((functionName === 'student-work-command' || functionName === 'task-recording-command'
          || functionName === 'pronunciation-command' || functionName === 'review-command'
          || functionName === 'submission-command' || functionName === 'task-command') && name === 'supports-color'
          && bundle.includes('try {\n      const supportsColor = require("supports-color")')))).toBe(true);
      expect(typeof deploymentModule.main).toBe('function');
      expect(packageJson).toEqual({
        name: `yarei-cloud-function-${functionName}`,
        version: '0.1.0',
        private: true,
        main: 'index.js',
        engines: { node: '20.19.x' },
        dependencies: { [SDK_PACKAGE]: SDK_VERSION },
      });
    }
  }, 30000);

  it('builds the five native-admin functions only through an explicit review-bundle path', async () => {
    expect(NATIVE_ADMIN_FUNCTIONS.map(({ name }) => name).sort()).toEqual([
      'native-admin-command', 'native-admin-management-command', 'native-admin-media-command',
      'native-admin-operations-command', 'native-admin-query',
    ]);
    const packageNames = (await readdir(nativeAdminOutputRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    expect(packageNames).toEqual(NATIVE_ADMIN_FUNCTIONS.map(({ name }) => name).sort());
    for (const functionName of packageNames) {
      const functionRoot = join(nativeAdminOutputRoot, functionName);
      expect((await readdir(functionRoot)).sort()).toEqual(['index.js', 'package.json']);
      const bundle = await readFile(join(functionRoot, 'index.js'), 'utf8');
      expect(bundle).toContain('bootstrapCloudBaseNodeDeployment');
      expect(bundle).not.toMatch(/require\(["']\.{1,2}[\\/]/);
      const deploymentModule = createRequire(import.meta.url)(join(functionRoot, 'index.js')) as { main?: unknown };
      expect(typeof deploymentModule.main).toBe('function');
    }
  }, 30000);

  it('keeps high-memory teacher video processing behind its own build selector', async () => {
    expect(TEACHER_PRIVATE_VIDEO_FUNCTIONS.map(({ name }) => name))
      .toEqual(['teacher-private-video-worker']);
    const result = await buildCloudFunctions({ outDir: join(temporaryRoot, 'teacher-private-video'),
      teacherPrivateVideoOnly: true });
    expect(result.functions).toEqual(['teacher-private-video-worker']);
  }, 30000);

  it('builds the Qwen business command and private worker only through its explicit M3 opt-in path', async () => {
    expect(TEACHER_AI_FUNCTIONS.map(({ name }) => name)).toEqual(['teacher-suggestion-command', 'teacher-suggestion-worker']);
    const packageNames = (await readdir(teacherAiOutputRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    expect(packageNames).toEqual(['teacher-suggestion-command', 'teacher-suggestion-worker']);
    const bundle = await readFile(join(teacherAiOutputRoot, 'teacher-suggestion-command', 'index.js'), 'utf8');
    expect(bundle).toContain('teacher-suggestion-command');
    expect(bundle).toContain('bootstrapCloudBaseNodeDeployment');
  }, 30000);

  it('builds only the two runtime functions affected by the canonical Auth subject mapping', async () => {
    expect(IDENTITY_RUNTIME_FUNCTIONS.map(({ name }) => name).sort())
      .toEqual(['auth-session', 'native-admin-management-command']);
    const packageNames = (await readdir(identityRuntimeOutputRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    expect(packageNames).toEqual(['auth-session', 'native-admin-management-command']);
    for (const functionName of packageNames) {
      const functionRoot = join(identityRuntimeOutputRoot, functionName);
      expect((await readdir(functionRoot)).sort()).toEqual(['index.js', 'package.json']);
      const bundle = await readFile(join(functionRoot, 'index.js'), 'utf8');
      const deploymentModule = createRequire(import.meta.url)(join(functionRoot, 'index.js')) as { main?: unknown };
      expect(bundle).toContain('bootstrapCloudBaseNodeDeployment');
      expect(bundle).not.toMatch(/require\(["']\.{1,2}[\\/]/);
      expect(typeof deploymentModule.main).toBe('function');
    }
  }, 30000);

  it('keeps student account provisioning in its own protected opt-in bundle', async () => {
    expect(TEACHER_STUDENT_IMPORT_FUNCTIONS.map(({ name }) => name))
      .toEqual(['teacher-student-import-command']);
    const packageNames = (await readdir(teacherStudentImportOutputRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    expect(packageNames).toEqual(['teacher-student-import-command']);
    const functionRoot = join(teacherStudentImportOutputRoot, 'teacher-student-import-command');
    const bundle = await readFile(join(functionRoot, 'index.js'), 'utf8');
    const deploymentModule = createRequire(import.meta.url)(join(functionRoot, 'index.js')) as { main?: unknown };
    expect(bundle).toContain('createTcbNativeAccountProviderFactory');
    expect(bundle).toContain('teacher-student-import-command');
    expect(bundle).not.toMatch(/require\(["']\.{1,2}[\\/]/);
    expect(typeof deploymentModule.main).toBe('function');
  }, 30000);

  it('contains only secret variable names and no environment identifier or credential values', async () => {
    const generatedText = (
      await Promise.all(CLOUD_FUNCTIONS.flatMap(({ name }) => [
        readFile(join(outputRoot, name, 'index.js'), 'utf8'),
        readFile(join(outputRoot, name, 'package.json'), 'utf8'),
      ]))
    ).join('\n');

    expect(generatedText).toContain('YAREI_SUBJECT_PEPPER');
    expect(generatedText).not.toMatch(/\b(?:TCB_ENV_ID|CLOUDBASE_ENV_ID|envId)\b/);
    expect(generatedText).not.toMatch(/AKID[A-Za-z0-9]{13,}/);
    expect(generatedText).not.toMatch(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/);
    expect(generatedText).not.toMatch(/(?:SecretId|SecretKey|AppSecret|password)\s*[:=]\s*["'][^"']{8,}["']/i);
  });

  it('keeps the deployment template aligned with the generated package layout', async () => {
    const template = JSON.parse(await readFile(CONFIG_TEMPLATE, 'utf8'));
    expect(template.functionRoot).toBe('./dist/functions');
    expect(template.functions.map((entry: { name: string }) => entry.name).sort())
      .toEqual(CLOUD_FUNCTIONS.map(({ name }) => name).sort());
    for (const definition of template.functions) {
      const expected = CLOUD_FUNCTIONS.find(({ name }) => name === definition.name);
      expect(definition).toMatchObject({
        runtime: 'Nodejs20.19',
        handler: 'index.main',
        timeout: expected?.timeout,
        memorySize: expected?.memorySize ?? 256,
        installDependency: true,
        envVariables: Object.fromEntries(
          SECRET_ENVIRONMENT_VARIABLES.map((name) => [name, `{{env.${name}}}`]),
        ),
      });
    }
    expect(template.functions.find((entry: { name: string }) => entry.name === 'maintenance-timer')?.triggers)
      .toBeUndefined();
    expect(JSON.parse(await readFile(TIMER_TEMPLATE, 'utf8'))).toEqual({
      functionName: 'maintenance-timer', trigger: { name: 'yarei_maintenance_minute',
        type: 'timer', config: '0 * * * * * *' },
    });
    expect(JSON.parse(await readFile(FUNCTION_SECURITY_TEMPLATE, 'utf8'))).toEqual({
      '*': { invoke: "auth != null && auth.loginType != 'ANONYMOUS'" },
      'maintenance-timer': { invoke: false },
    });
  });

  it('keeps recording storage examples non-deployable until merged with existing environment rules', async () => {
    for (const path of STORAGE_FRAGMENTS) {
      const fragment = JSON.parse(await readFile(path, 'utf8'));
      expect(fragment).toMatchObject({ deployable: false, privateClientReadWrite: false });
      expect(fragment).not.toHaveProperty('read');
      expect(fragment).not.toHaveProperty('write');
      expect(fragment.stagingClientWriteCondition).toContain(fragment.scope.replace('/', '\\/'));
    }
  });
});
