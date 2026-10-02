import { describe, expect, it } from 'vitest';
import { MemoryAdminRepository } from '../src/services/admin-repository';
import { MemoryQuestionAdminService } from '../src/services/question-admin-service';
import { ADMIN_SEED } from '../src/services/seed';

function fixture(permissions = ADMIN_SEED.roles[0]!.permissions) {
  const repository = new MemoryAdminRepository(ADMIN_SEED);
  const service = new MemoryQuestionAdminService(repository, { actorId: 'admin-zhou', actorName: '周老师',
    schoolIds: ['school-demo-001'], permissions: [...permissions] }, () => '2026-09-26T02:00:00.000Z');
  return { repository, service };
}

describe('A-06 school question administration in local demo', () => {
  it('shows read-only content and preserves it across authorization and status changes', async () => {
    const { repository, service } = fixture();
    const first = await service.get('res_exercise_bird_demo');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const changed = await service.setVisibility(first.data.id, { type: 'organization' }, first.data.version,
      '演示学校开放', 'operation_question_visibility_demo');
    expect(changed).toMatchObject({ ok: true, data: { visibility: { type: 'organization' },
      stem: first.data.stem, correctAnswer: first.data.correctAnswer, version: 2 } });
    const status = await service.batchSetStatus([{ id: first.data.id, expectedVersion: 2 }], 'offline',
      '演示下架', 'operation_question_offline_demo');
    expect(status).toMatchObject({ ok: true, data: [{ status: 'offline', explanation: first.data.explanation }] });
    expect((await repository.read()).audits.filter(item => item.action.includes('题目'))).toHaveLength(2);
  });

  it('rejects missing permission and keeps all rows unchanged when a batch version is stale', async () => {
    const limited = fixture(['organization.view']);
    expect(await limited.service.batchSetStatus([{ id: 'res_exercise_bird_demo', expectedVersion: 1 }],
      'offline', '越权尝试', 'operation_question_denied_demo')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const { service } = fixture();
    const result = await service.batchSetVisibility([
      { id: 'res_exercise_bird_demo', expectedVersion: 1 }, { id: 'res_exercise_lion_demo', expectedVersion: 2 },
    ], { type: 'organization' }, '批量授权', 'operation_question_stale_demo');
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await service.get('res_exercise_bird_demo')).toMatchObject({ ok: true, data: { version: 1 } });
  });
});
