import { describe, expect, it } from 'vitest';
import { main as authSessionMain } from '../../functions/auth-session';
import { canonicalize, createOperationFingerprint } from '../../src/shared/request-summary';
import { failure, serviceError } from '../../src/shared/result';
import { parseExactObject } from '../../src/shared/strict-object';
import { parseFunctionRequest } from '../../src/shared/validation';

describe('M1 线协议输入校验', () => {
  it('接受 m1.v1 已知 action，并拒绝未知 action、操作 ID 与版本', () => {
    const valid = parseFunctionRequest({ apiVersion: 'm1.v1', action: 'selectRole', payload: { role: 'student' }, businessSessionToken: 'opaque.session.token', operationId: 'op_select_0001', expectedVersion: 1 }, ['selectRole'] as const);
    expect(valid.ok).toBe(true);
    expect(valid).toMatchObject({ ok: true, value: { businessSessionToken: 'opaque.session.token' } });
    expect(parseFunctionRequest({ apiVersion: 'm1.v1', action: 'admin', payload: {} }, ['selectRole'] as const)).toMatchObject({ ok: false, fieldErrors: { action: expect.any(String) } });
    expect(parseFunctionRequest({ apiVersion: 'm1.v1', action: 'selectRole', payload: {}, expectedVersion: 0 }, ['selectRole'] as const)).toMatchObject({ ok: true, value: { expectedVersion: 0 } });
    expect(parseFunctionRequest({ apiVersion: 'm1.v1', action: 'selectRole', payload: {}, businessSessionToken: 'bad token' }, ['selectRole'] as const)).toMatchObject({ ok: false, fieldErrors: { businessSessionToken: expect.any(String) } });
  });

  it('拒绝未在 action schema 中声明的字段', () => {
    expect(parseExactObject({ role: 'student', actorUserId: 'usr_forged' }, ['role'])).toEqual({ ok: false, fieldErrors: { actorUserId: '不支持的字段。' } });
    expect(parseExactObject({ role: 'student', businessSessionToken: 'opaque.session.token' }, ['role'])).toEqual({ ok: false, fieldErrors: { businessSessionToken: '不支持的字段。' } });
  });

  it('未配置函数永远不执行命令', async () => {
    const result = await authSessionMain({ apiVersion: 'm1.v1', action: 'selectRole', payload: { role: 'student' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('未配置 auth 入口仍执行严格 action schema', async () => {
    expect(await authSessionMain({ apiVersion: 'm1.v1', action: 'logout', payload: {} })).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { operationId: expect.any(String) } },
    });
    expect(await authSessionMain({ apiVersion: 'm1.v1', action: 'logout', payload: {}, operationId: 'op_logout_0001' })).toMatchObject({
      ok: false, error: { code: 'SERVICE_UNAVAILABLE' },
    });
  });

  it('代表性 auth action 以精确 schema 拒绝伪造 actor 字段', async () => {
    const result = await authSessionMain({ apiVersion: 'm1.v1', action: 'selectRole', payload: { role: 'student', actorUserId: 'usr_forged' } });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { actorUserId: expect.any(String) } } });
  });
});

describe('M1 错误与幂等基础', () => {
  it('将可重试与不可重试错误映射为稳定安全文案', () => {
    expect(serviceError('CONFLICT')).toMatchObject({ retryable: false, message: expect.any(String) });
    expect(serviceError('SERVICE_UNAVAILABLE')).toMatchObject({ retryable: true, message: expect.any(String) });
    const result = failure('FORBIDDEN', { requestId: 'req_test', serverTime: '2026-09-13T00:00:00.000Z', apiVersion: 'm1.v1' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('为键顺序不同的同一请求生成相同摘要，并为不同意图隔离记录', () => {
    const left = createOperationFingerprint({ organizationId: 'org_demo', actorUserId: 'usr_student', functionName: 'submission-command', action: 'submit', operationId: 'op_submit_0001', payload: { taskId: 'tsk_1', answers: ['a'] }, expectedVersion: 2 });
    const right = createOperationFingerprint({ organizationId: 'org_demo', actorUserId: 'usr_student', functionName: 'submission-command', action: 'submit', operationId: 'op_submit_0001', payload: { answers: ['a'], taskId: 'tsk_1' }, expectedVersion: 2 });
    const changed = createOperationFingerprint({ organizationId: 'org_demo', actorUserId: 'usr_student', functionName: 'submission-command', action: 'submit', operationId: 'op_submit_0001', payload: { taskId: 'tsk_2', answers: ['a'] }, expectedVersion: 2 });
    expect(left).toEqual(right);
    expect(changed.requestHash).not.toBe(left.requestHash);
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
