export const CLOUD_TEST_ACCOUNT_SLOTS = [
  'primary.student',
  'primary.parent',
  'primary.teacher',
  'primary.admin',
  'secondary.student',
  'secondary.parent',
  'secondary.teacher',
  'secondary.admin',
] as const;

export type CloudTestAccountSlot = (typeof CLOUD_TEST_ACCOUNT_SLOTS)[number];
export type CloudTestRole = 'student' | 'parent' | 'teacher' | 'admin';
export type ScenarioReadiness = 'ready' | 'requires-manual-input';
export type ScenarioOutcome = 'not-run' | 'passed' | 'failed' | 'blocked';

export type CloudScenarioTag =
  | `role:${CloudTestRole}`
  | 'authentication'
  | 'authorization'
  | 'anonymous-rejection'
  | 'cross-organization'
  | 'session-revocation'
  | 'client-database-deny'
  | 'main-loop'
  | 'idempotency'
  | 'transaction';

export interface AuthenticatedCloudPlanInput {
  /** Values are presence-only local aliases. They are never copied into output. */
  readonly accountAliases?: Readonly<Partial<Record<CloudTestAccountSlot, string>>>;
}

export interface RequiredManualInput {
  readonly key: `accountAliases.${CloudTestAccountSlot}`;
  readonly purpose: string;
}

export interface CloudScenarioStep {
  readonly id: string;
  readonly actor: CloudTestAccountSlot | 'anonymous';
  readonly operation: string;
  readonly fixtureRef?: string;
  readonly expected: Readonly<{
    outcome: 'allow' | 'deny';
    errorCodes?: readonly string[];
    writeCount?: 'zero' | 'one' | 'unchanged';
  }>;
}

export interface AuthenticatedCloudScenario {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly CloudScenarioTag[];
  readonly requiredAccounts: readonly CloudTestAccountSlot[];
  readonly readiness: ScenarioReadiness;
  readonly steps: readonly CloudScenarioStep[];
}

export interface RedactedEvidenceTemplate {
  readonly scenarioId: string;
  readonly outcome: 'not-run';
  readonly errorCode: null;
  readonly maskedRequestId: null;
  readonly observedAt: null;
  readonly assertions: readonly [];
  readonly counts: Readonly<{
    businessWrites: null;
    auditWrites: null;
    duplicateWrites: null;
  }>;
}

export interface AuthenticatedCloudIntegrationPlan {
  readonly schemaVersion: 'm1-authenticated-cloud-plan.v1';
  readonly mode: 'plan-only';
  readonly environment: 'dedicated-non-production';
  readonly requiredManualInputs: readonly RequiredManualInput[];
  readonly scenarios: readonly AuthenticatedCloudScenario[];
  readonly evidenceTemplates: readonly RedactedEvidenceTemplate[];
}

const ROLE_TITLES: Readonly<Record<CloudTestRole, string>> = {
  student: '学生已认证会话只进入本人范围',
  parent: '家长已认证会话只进入有效绑定范围',
  teacher: '教师已认证会话只进入当前授权班级',
  admin: '管理员仅通过独立后台会话进入授权范围',
};

const MANUAL_INPUT_PURPOSES: Readonly<Record<CloudTestAccountSlot, string>> = {
  'primary.student': '主测试组织学生账号别名',
  'primary.parent': '主测试组织家长账号别名',
  'primary.teacher': '主测试组织教师账号别名',
  'primary.admin': '主测试组织后台管理员账号别名',
  'secondary.student': '次测试组织学生账号别名，用于跨组织拒绝',
  'secondary.parent': '次测试组织家长账号别名，用于跨组织拒绝',
  'secondary.teacher': '次测试组织教师账号别名，用于跨组织拒绝',
  'secondary.admin': '次测试组织后台管理员账号别名，用于跨组织拒绝',
};

const BASE_SCENARIOS: readonly Omit<AuthenticatedCloudScenario, 'readiness'>[] = [
  ...(['student', 'parent', 'teacher', 'admin'] as const).map((role) => ({
    id: `authenticated-role-${role}`,
    title: ROLE_TITLES[role],
    tags: [`role:${role}`, 'authentication', 'authorization'] as const,
    requiredAccounts: [`primary.${role}`] as readonly CloudTestAccountSlot[],
    steps: [{
      id: 'bootstrap-and-read-current-scope',
      actor: `primary.${role}` as CloudTestAccountSlot,
      operation: role === 'admin' ? 'admin-session.bootstrap-and-read' : 'auth-session.bootstrap-select-and-read',
      expected: { outcome: 'allow' as const, writeCount: 'zero' as const },
    }],
  })),
  {
    id: 'anonymous-business-function-rejected',
    title: '匿名身份不能调用业务函数',
    tags: ['authentication', 'anonymous-rejection'],
    requiredAccounts: [],
    steps: [{
      id: 'invoke-without-platform-identity', actor: 'anonymous', operation: 'business-function.invoke',
      expected: { outcome: 'deny', errorCodes: ['MISSING_CREDENTIALS', 'UNAUTHENTICATED'], writeCount: 'zero' },
    }],
  },
  ...(['student', 'parent', 'teacher', 'admin'] as const).map((role) => ({
    id: `cross-organization-${role}-rejected`,
    title: `${ROLE_TITLES[role]}：跨组织目标拒绝`,
    tags: [`role:${role}`, 'authorization', 'cross-organization'] as const,
    requiredAccounts: [`primary.${role}`, `secondary.${role}`] as readonly CloudTestAccountSlot[],
    steps: [{
      id: 'invoke-primary-session-against-secondary-fixture',
      actor: `primary.${role}` as CloudTestAccountSlot,
      operation: 'authorized-read-or-write-against-cross-organization-fixture',
      fixtureRef: `secondary.${role}.owned-fixture`,
      expected: { outcome: 'deny' as const, errorCodes: ['NOT_FOUND', 'FORBIDDEN'], writeCount: 'zero' as const },
    }],
  })),
  {
    id: 'stale-session-rejected-after-authorization-revocation',
    title: '撤权后旧会话立即失效',
    tags: ['role:teacher', 'authorization', 'session-revocation', 'transaction'],
    requiredAccounts: ['primary.teacher', 'primary.admin'],
    steps: [
      { id: 'establish-session', actor: 'primary.teacher', operation: 'auth-session.bootstrap-and-select-teacher', expected: { outcome: 'allow', writeCount: 'zero' } },
      { id: 'revoke-current-grant', actor: 'primary.admin', operation: 'organization-admin.revoke-teacher-grant', expected: { outcome: 'allow', writeCount: 'one' } },
      { id: 'reuse-stale-session', actor: 'primary.teacher', operation: 'task-query.invoke-with-existing-session', expected: { outcome: 'deny', errorCodes: ['UNAUTHENTICATED'], writeCount: 'zero' } },
    ],
  },
  {
    id: 'authenticated-client-database-direct-access-rejected',
    title: '已认证客户端直接读写业务集合均被资源规则拒绝',
    tags: ['role:student', 'authorization', 'client-database-deny'],
    requiredAccounts: ['primary.student'],
    steps: [
      { id: 'direct-read', actor: 'primary.student', operation: 'client-database.direct-read', fixtureRef: 'business-collection.fixture', expected: { outcome: 'deny', writeCount: 'zero' } },
      { id: 'direct-write', actor: 'primary.student', operation: 'client-database.direct-write', fixtureRef: 'business-collection.fixture', expected: { outcome: 'deny', writeCount: 'zero' } },
    ],
  },
  {
    id: 'authenticated-main-loop',
    title: '教师发布、学生提交、教师点评、家长只读查看主闭环',
    tags: ['role:teacher', 'role:student', 'role:parent', 'main-loop', 'idempotency', 'transaction'],
    requiredAccounts: ['primary.teacher', 'primary.student', 'primary.parent'],
    steps: [
      { id: 'publish-task', actor: 'primary.teacher', operation: 'task-command.publishTask', fixtureRef: 'main-loop.task-draft', expected: { outcome: 'allow', writeCount: 'one' } },
      { id: 'submit-assignment', actor: 'primary.student', operation: 'submission-command.submit', fixtureRef: 'main-loop.assignment', expected: { outcome: 'allow', writeCount: 'one' } },
      { id: 'publish-review', actor: 'primary.teacher', operation: 'review-command.publishReview', fixtureRef: 'main-loop.submission', expected: { outcome: 'allow', writeCount: 'one' } },
      { id: 'read-feedback', actor: 'primary.parent', operation: 'parent-query.getFeedback', fixtureRef: 'main-loop.feedback', expected: { outcome: 'allow', writeCount: 'zero' } },
    ],
  },
  {
    id: 'idempotent-write-retry-matrix',
    title: '写操作串行、并发、响应丢失和异载荷重试保持幂等',
    tags: ['role:teacher', 'idempotency', 'transaction'],
    requiredAccounts: ['primary.teacher'],
    steps: [
      { id: 'same-intent-serial-retry', actor: 'primary.teacher', operation: 'write.retry-same-operation', expected: { outcome: 'allow', writeCount: 'one' } },
      { id: 'same-intent-concurrent-retry', actor: 'primary.teacher', operation: 'write.concurrent-retry-same-operation', expected: { outcome: 'allow', writeCount: 'one' } },
      { id: 'response-lost-retry', actor: 'primary.teacher', operation: 'write.retry-after-response-loss', expected: { outcome: 'allow', writeCount: 'one' } },
      { id: 'same-key-different-payload', actor: 'primary.teacher', operation: 'write.retry-different-request', expected: { outcome: 'deny', errorCodes: ['CONFLICT'], writeCount: 'unchanged' } },
    ],
  },
  {
    id: 'transaction-rollback-has-no-partial-writes',
    title: '事务冲突或授权变化不留下半成品',
    tags: ['role:teacher', 'role:admin', 'authorization', 'transaction'],
    requiredAccounts: ['primary.teacher', 'primary.admin'],
    steps: [
      { id: 'capture-before-counts', actor: 'primary.admin', operation: 'evidence.capture-safe-counts', expected: { outcome: 'allow', writeCount: 'zero' } },
      { id: 'force-version-or-authorization-conflict', actor: 'primary.teacher', operation: 'write.with-stale-version-or-revoked-grant', expected: { outcome: 'deny', errorCodes: ['CONFLICT', 'FORBIDDEN', 'UNAUTHENTICATED'], writeCount: 'zero' } },
      { id: 'verify-no-partial-writes', actor: 'primary.admin', operation: 'evidence.compare-safe-counts', expected: { outcome: 'allow', writeCount: 'unchanged' } },
    ],
  },
];

export function createAuthenticatedCloudIntegrationPlan(input: unknown): AuthenticatedCloudIntegrationPlan {
  const aliases = readAliasPresence(input);
  const requiredSlots = new Set(BASE_SCENARIOS.flatMap((scenario) => scenario.requiredAccounts));
  const missing = CLOUD_TEST_ACCOUNT_SLOTS.filter((slot) => requiredSlots.has(slot) && !aliases.has(slot));
  const scenarios = BASE_SCENARIOS.map((scenario): AuthenticatedCloudScenario => ({
    ...scenario,
    tags: [...scenario.tags],
    requiredAccounts: [...scenario.requiredAccounts],
    readiness: scenario.requiredAccounts.every((slot) => aliases.has(slot)) ? 'ready' : 'requires-manual-input',
    steps: scenario.steps.map((step) => ({ ...step, expected: { ...step.expected, ...(step.expected.errorCodes === undefined ? {} : { errorCodes: [...step.expected.errorCodes] }) } })),
  }));
  return {
    schemaVersion: 'm1-authenticated-cloud-plan.v1',
    mode: 'plan-only',
    environment: 'dedicated-non-production',
    requiredManualInputs: missing.map((slot) => ({
      key: `accountAliases.${slot}`,
      purpose: MANUAL_INPUT_PURPOSES[slot],
    })),
    scenarios,
    evidenceTemplates: scenarios.map((scenario) => evidenceTemplate(scenario.id)),
  };
}

export interface RedactedCloudEvidence {
  readonly scenarioId: string;
  readonly outcome: ScenarioOutcome;
  readonly errorCode: string | null;
  readonly maskedRequestId: string | null;
  readonly observedAt: string | null;
  readonly assertions: readonly Readonly<{ checkId: string; passed: boolean }>[];
  readonly counts: Readonly<{
    businessWrites: number | null;
    auditWrites: number | null;
    duplicateWrites: number | null;
  }>;
}

const OUTCOMES: readonly ScenarioOutcome[] = ['not-run', 'passed', 'failed', 'blocked'];
const ERROR_CODES = new Set([
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RESOURCE_OFFLINE',
  'TASK_NOT_SUBMITTABLE', 'REDO_LIMIT_REACHED', 'DUPLICATE_OPERATION', 'NETWORK_ERROR',
  'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR', 'MISSING_CREDENTIALS',
]);
const ASSERTION_IDS = new Set([
  'authorized-scope-only', 'no-sensitive-fields', 'no-cross-organization-data', 'no-client-database-access',
  'old-session-rejected', 'single-business-write', 'single-audit-write', 'no-duplicate-write',
  'no-partial-write', 'main-loop-consistent',
]);

/**
 * Projects untrusted execution observations into a fixed allowlist. Unknown
 * fields are ignored, account credentials are never accepted, and request IDs
 * retain length only so the original identifier cannot be reconstructed here.
 */
export function createRedactedCloudEvidence(input: unknown): RedactedCloudEvidence {
  const record = isRecord(input) ? input : {};
  const scenarioId = typeof record.scenarioId === 'string' && BASE_SCENARIOS.some((scenario) => scenario.id === record.scenarioId)
    ? record.scenarioId
    : 'unknown-scenario';
  const outcome = typeof record.outcome === 'string' && OUTCOMES.includes(record.outcome as ScenarioOutcome)
    ? record.outcome as ScenarioOutcome
    : 'blocked';
  const errorCode = typeof record.errorCode === 'string' && ERROR_CODES.has(record.errorCode) ? record.errorCode : null;
  const observedAt = typeof record.observedAt === 'string' && isIsoDateTime(record.observedAt) ? record.observedAt : null;
  const assertions = Array.isArray(record.assertions)
    ? record.assertions.flatMap((candidate) => {
        if (!isRecord(candidate) || typeof candidate.checkId !== 'string' || !ASSERTION_IDS.has(candidate.checkId) || typeof candidate.passed !== 'boolean') return [];
        return [{ checkId: candidate.checkId, passed: candidate.passed }];
      })
    : [];
  const counts = isRecord(record.counts) ? record.counts : {};
  return {
    scenarioId,
    outcome,
    errorCode,
    maskedRequestId: typeof record.requestId === 'string' && record.requestId.length > 0
      ? `request-id:[${Math.min(record.requestId.length, 999)}-chars-redacted]`
      : null,
    observedAt,
    assertions,
    counts: {
      businessWrites: safeCount(counts.businessWrites),
      auditWrites: safeCount(counts.auditWrites),
      duplicateWrites: safeCount(counts.duplicateWrites),
    },
  };
}

function readAliasPresence(input: unknown): ReadonlySet<CloudTestAccountSlot> {
  if (!isRecord(input) || !isRecord(input.accountAliases)) return new Set();
  const aliasRecord = input.accountAliases;
  return new Set(CLOUD_TEST_ACCOUNT_SLOTS.filter((slot) => {
    const value = aliasRecord[slot];
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
  }));
}

function evidenceTemplate(scenarioId: string): RedactedEvidenceTemplate {
  return {
    scenarioId,
    outcome: 'not-run',
    errorCode: null,
    maskedRequestId: null,
    observedAt: null,
    assertions: [],
    counts: { businessWrites: null, auditWrites: null, duplicateWrites: null },
  };
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
