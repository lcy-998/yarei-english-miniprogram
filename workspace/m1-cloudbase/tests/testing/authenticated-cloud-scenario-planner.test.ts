import { describe, expect, it } from 'vitest';
import {
  CLOUD_TEST_ACCOUNT_SLOTS,
  createAuthenticatedCloudIntegrationPlan,
  createRedactedCloudEvidence,
  type AuthenticatedCloudPlanInput,
  type CloudTestAccountSlot,
} from '../../src/testing/authenticated-cloud-scenario-planner';

function completeAliases(): AuthenticatedCloudPlanInput['accountAliases'] {
  return Object.fromEntries(CLOUD_TEST_ACCOUNT_SLOTS.map((slot) => [slot, `alias-${slot.replace('.', '-')}`])) as Record<CloudTestAccountSlot, string>;
}

describe('已认证云联调场景计划器', () => {
  it('生成四角色、匿名拒绝、跨组织、撤权、数据库拒绝和主闭环场景', () => {
    const plan = createAuthenticatedCloudIntegrationPlan({ accountAliases: completeAliases() });

    expect(plan).toMatchObject({
      schemaVersion: 'm1-authenticated-cloud-plan.v1',
      mode: 'plan-only',
      environment: 'dedicated-non-production',
      requiredManualInputs: [],
    });
    expect(plan.scenarios).toHaveLength(14);
    expect(plan.scenarios.every((scenario) => scenario.readiness === 'ready')).toBe(true);
    for (const role of ['student', 'parent', 'teacher', 'admin'] as const) {
      expect(plan.scenarios).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `authenticated-role-${role}`, tags: expect.arrayContaining([`role:${role}`, 'authentication']) }),
        expect.objectContaining({ id: `cross-organization-${role}-rejected`, tags: expect.arrayContaining([`role:${role}`, 'cross-organization']) }),
      ]));
    }
    expect(plan.scenarios).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'anonymous-business-function-rejected', tags: expect.arrayContaining(['anonymous-rejection']) }),
      expect.objectContaining({ id: 'stale-session-rejected-after-authorization-revocation', tags: expect.arrayContaining(['session-revocation']) }),
      expect.objectContaining({ id: 'authenticated-client-database-direct-access-rejected', tags: expect.arrayContaining(['client-database-deny']) }),
      expect.objectContaining({ id: 'authenticated-main-loop', tags: expect.arrayContaining(['main-loop']) }),
    ]));
  });

  it('主闭环固定为教师发布、学生提交、教师点评和家长只读查看', () => {
    const plan = createAuthenticatedCloudIntegrationPlan({ accountAliases: completeAliases() });
    const scenario = plan.scenarios.find((item) => item.id === 'authenticated-main-loop');

    expect(scenario?.steps.map((step) => [step.actor, step.operation])).toEqual([
      ['primary.teacher', 'task-command.publishTask'],
      ['primary.student', 'submission-command.submit'],
      ['primary.teacher', 'review-command.publishReview'],
      ['primary.parent', 'parent-query.getFeedback'],
    ]);
  });

  it('幂等和事务场景使用显式标签并声明重复写入与半成品预期', () => {
    const plan = createAuthenticatedCloudIntegrationPlan({ accountAliases: completeAliases() });
    const idempotency = plan.scenarios.find((item) => item.id === 'idempotent-write-retry-matrix');
    const transaction = plan.scenarios.find((item) => item.id === 'transaction-rollback-has-no-partial-writes');

    expect(idempotency?.tags).toEqual(expect.arrayContaining(['idempotency', 'transaction']));
    expect(idempotency?.steps.map((step) => step.expected.writeCount)).toEqual(['one', 'one', 'one', 'unchanged']);
    expect(transaction?.tags).toContain('transaction');
    expect(transaction?.steps.at(-1)).toMatchObject({ id: 'verify-no-partial-writes', expected: { writeCount: 'unchanged' } });
  });

  it('缺少账号别名时逐项列出 requiredManualInputs 并只阻塞相关场景', () => {
    const plan = createAuthenticatedCloudIntegrationPlan({ accountAliases: { 'primary.student': 'student-alias' } });

    expect(plan.requiredManualInputs.map((item) => item.key)).toEqual([
      'accountAliases.primary.parent',
      'accountAliases.primary.teacher',
      'accountAliases.primary.admin',
      'accountAliases.secondary.student',
      'accountAliases.secondary.parent',
      'accountAliases.secondary.teacher',
      'accountAliases.secondary.admin',
    ]);
    expect(plan.scenarios.find((item) => item.id === 'authenticated-role-student')?.readiness).toBe('ready');
    expect(plan.scenarios.find((item) => item.id === 'anonymous-business-function-rejected')?.readiness).toBe('ready');
    expect(plan.scenarios.find((item) => item.id === 'cross-organization-student-rejected')?.readiness).toBe('requires-manual-input');
  });

  it('账号别名和任意敏感输入值永不复制进计划或证据模板', () => {
    const sensitiveValues = [
      'platform-subject-private-001',
      '13800000000',
      'Password-Do-Not-Echo',
      'as1.private-token-value',
    ];
    const accountAliases = Object.fromEntries(CLOUD_TEST_ACCOUNT_SLOTS.map((slot, index) => [slot, sensitiveValues[index % sensitiveValues.length]]));
    const plan = createAuthenticatedCloudIntegrationPlan({
      accountAliases,
      platformSubject: sensitiveValues[0],
      mobile: sensitiveValues[1],
      password: sensitiveValues[2],
      token: sensitiveValues[3],
    });
    const serialized = JSON.stringify(plan);

    for (const value of sensitiveValues) expect(serialized).not.toContain(value);
    expect(plan.requiredManualInputs).toEqual([]);
    expect(plan.evidenceTemplates).toHaveLength(plan.scenarios.length);
    expect(plan.evidenceTemplates.every((template) => template.maskedRequestId === null)).toBe(true);
  });
});

describe('云联调证据脱敏投影', () => {
  it('只保留固定证据字段，requestId 仅保留长度掩码', () => {
    const rawRequestId = 'req_private_request_0123456789';
    const evidence = createRedactedCloudEvidence({
      scenarioId: 'authenticated-main-loop',
      outcome: 'passed',
      errorCode: null,
      requestId: rawRequestId,
      observedAt: '2026-09-17T09:00:00.000+08:00',
      assertions: [
        { checkId: 'main-loop-consistent', passed: true },
        { checkId: 'raw-secret-assertion', passed: true },
      ],
      counts: { businessWrites: 3, auditWrites: 3, duplicateWrites: 0, privateDocuments: 99 },
      platformSubject: 'platform-subject-private-001',
      mobile: '13800000000',
      password: 'Password-Do-Not-Echo',
      businessSessionToken: 'as1.private-token-value',
    });

    expect(evidence).toEqual({
      scenarioId: 'authenticated-main-loop',
      outcome: 'passed',
      errorCode: null,
      maskedRequestId: `request-id:[${rawRequestId.length}-chars-redacted]`,
      observedAt: '2026-09-17T09:00:00.000+08:00',
      assertions: [{ checkId: 'main-loop-consistent', passed: true }],
      counts: { businessWrites: 3, auditWrites: 3, duplicateWrites: 0 },
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(rawRequestId);
    expect(serialized).not.toContain('platform-subject-private-001');
    expect(serialized).not.toContain('13800000000');
    expect(serialized).not.toContain('Password-Do-Not-Echo');
    expect(serialized).not.toContain('as1.private-token-value');
  });

  it('未知场景、错误码、断言、时间和计数均失败关闭为安全占位', () => {
    expect(createRedactedCloudEvidence({
      scenarioId: 'secret-scenario-name', outcome: 'unknown', errorCode: 'RAW_PROVIDER_ERROR',
      requestId: '', observedAt: 'not-a-time', assertions: [{ checkId: 'secret-check', passed: true }],
      counts: { businessWrites: -1, auditWrites: 1.5, duplicateWrites: 1_000_001 },
    })).toEqual({
      scenarioId: 'unknown-scenario', outcome: 'blocked', errorCode: null, maskedRequestId: null, observedAt: null,
      assertions: [], counts: { businessWrites: null, auditWrites: null, duplicateWrites: null },
    });
  });
});

