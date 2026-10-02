import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCloudFunctions, CLOUD_FUNCTIONS } from '../../tools/build-cloud-functions.mjs';
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

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'yarei-cloud-functions-'));
  outputRoot = join(temporaryRoot, 'functions');
  await buildCloudFunctions({ outDir: outputRoot });
}, 30000);

afterAll(async () => {
  if (temporaryRoot !== '') await rm(temporaryRoot, { recursive: true, force: true });
});

describe('CloudBase deployment packages', () => {
  it('builds an independent CommonJS package for every registered function', async () => {
    expect(CLOUD_FUNCTIONS.map(({ name }) => name).sort()).toEqual([...FUNCTION_NAMES].sort());
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
        || name === 'tty' || name === 'util'
        || ((functionName === 'student-work-command' || functionName === 'task-recording-command') && name === 'supports-color'
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
  });

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
