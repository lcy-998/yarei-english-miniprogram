import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson, prepareSeedPackage } from '../../src/seed/canonical-json';
import { loadSeedFile } from '../../src/seed/loader';
import { createSeedPlan } from '../../src/seed/plan';
import { validateSeedPackage } from '../../src/seed/validator';

const EXAMPLE_PATH = fileURLToPath(
  new URL('../../../../docs/m1-cloudbase/templates/development-seed.example.json', import.meta.url),
);

describe('M1 本地种子工具', () => {
  it('把权威最小示例在内存中准备为可验证正例，并生成只读计划', async () => {
    const loaded = await loadSeedFile(EXAMPLE_PATH);
    const prepared = prepareSeedPackage(loaded);
    const validation = validateSeedPackage(prepared);

    expect(validation).toMatchObject({ ok: true, issues: [] });
    expect(validation.computedContentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(createSeedPlan(prepared, validation)).toMatchObject({
      totalDocuments: 19,
      runtimeIdentityPlaceholders: 3,
      safety: expect.arrayContaining(['仅生成本地只读计划，不连接 CloudBase。']),
    });
  });

  it('规范 JSON 不受对象字段插入顺序影响', () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: false }, a: 'first' }))
      .toBe(canonicalJson({ a: 'first', nested: { a: false, b: true }, z: 1 }));
  });

  it('阻断跨组织引用与敏感字段和值', async () => {
    const loaded = await loadSeedFile(EXAMPLE_PATH);
    const changed = structuredClone(loaded);
    changed.collections.parent_student_links[0].organizationId = 'org_other_demo';
    changed.collections.users[0].password = 'not-allowed';
    changed.collections.users[1].displayName = 'test@example.com';
    const validation = validateSeedPackage(prepareSeedPackage(changed));

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'ORGANIZATION_MISMATCH',
      'SENSITIVE_FIELD',
      'SENSITIVE_VALUE',
    ]));
  });

  it('阻断后端不支持的角色权限', async () => {
    const loaded = await loadSeedFile(EXAMPLE_PATH);
    const changed = structuredClone(loaded);
    changed.collections.role_assignments[0].permissions = ['audit.manage'];

    const validation = validateSeedPackage(prepareSeedPackage(changed));

    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'DOCUMENT_SCHEMA',
        path: 'role_assignments[0].permissions[0]',
      }),
    ]));
  });

  it('文件加载器明确拒绝环境配置路径', async () => {
    await expect(loadSeedFile('.env.local')).rejects.toThrow('不读取环境配置文件');
  });
});
