import { describe, expect, it, vi } from 'vitest';
import { ADMIN_FUNCTION_NAME, ADMIN_SESSION_AUDIENCE, type AdminFunctionInvoker,
  type OrganizationAdminWireRequest } from '../src/cloud/admin-cloud-contract';
import { createAdminCloudTransport } from '../src/cloud/admin-cloud-transport';
import { createOrganizationAdminClient } from '../src/cloud/organization-admin-client';

const detail = {
  id: 'question_bird_demo', title: '动物主题选择题', stemSummary: 'Which animal can fly?',
  grade: '三年级', unit: 'Unit 3', difficulty: '中等', knowledgePoint: '动物', questionType: 'single_choice',
  status: 'published', visibility: { type: 'classes', classIds: ['class_grade3_demo'] },
  updatedAt: '2026-09-26T01:00:00.000Z', version: 2,
  stem: 'Which animal can fly?', options: ['A. bird', 'B. lion'], correctAnswer: 'A. bird', explanation: 'Birds can fly.',
};
function setup(data: unknown) {
  const invoke = vi.fn(async (_name: typeof ADMIN_FUNCTION_NAME, _request: OrganizationAdminWireRequest) => ({
    ok: true, data, meta: { requestId: 'request_question_demo', serverTime: '2026-09-26T02:00:00.000Z', apiVersion: 'm1.v1' },
  }));
  const invoker: AdminFunctionInvoker = { invoke };
  const client = createOrganizationAdminClient(createAdminCloudTransport({ invoker,
    sessions: { current: async () => ({ audience: ADMIN_SESSION_AUDIENCE,
      token: 'admin-session-token-for-question-tests', expiresAt: '2026-09-26T04:00:00.000Z' }) },
    now: () => new Date('2026-09-26T02:00:00.000Z') }));
  return { client, invoke };
}

describe('A-06 admin browser cloud boundary', () => {
  it('sends explicit batch versions and strictly parses read-only question content', async () => {
    const { client, invoke } = setup([detail]);
    expect(await client.batchSetQuestionVisibility({ items: [{ id: detail.id, expectedVersion: 1 }],
      visibility: { type: 'classes', classIds: ['class_grade3_demo'] }, reason: '授权班级',
      operationId: 'operation_question_visibility_demo' })).toMatchObject({ ok: true, data: [{ id: detail.id, version: 2 }] });
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({ action: 'batchSetQuestionVisibility',
      expectedVersion: 1, payload: { items: [{ id: detail.id, expectedVersion: 1 }], reason: '授权班级' } });
  });
  it('rejects malformed detail instead of showing editable or untrusted fields', async () => {
    const { client } = setup({ ...detail, stem: undefined });
    expect(await client.getAdminQuestion(detail.id)).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });
});
