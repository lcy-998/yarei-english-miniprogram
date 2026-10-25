import { describe, expect, it, vi } from 'vitest';
import { createStudentWorkCommandFunction } from '../../functions/student-work-command/function-entry';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';

const student: TrustedActorContext = { requestId: 'req_student', sessionId: 'ses_student',
  actorUserId: 'student_demo', actorRole: 'student', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: [], scopeIds: ['student_demo'], authzVersion: 1 };

describe('trusted task dubbing command actions', () => {
  it('keeps actor and version outside client payload and rejects autonomous work substitution', async () => {
    const begin = vi.fn(async () => ({ ok: true as const, data: { workId: 'task_work_demo',
      taskId: 'task_demo', itemId: 'item_demo', round: 1,
      stagingPath: 'task-dubbing/staging/demo', status: 'draft' as const,
      durationMs: null, version: 1 } }));
    const seal = vi.fn(async () => ({ ok: true as const, data: { workId: 'task_work_demo',
      taskId: 'task_demo', itemId: 'item_demo', round: 1,
      stagingPath: 'task-dubbing/staging/demo', status: 'submitted' as const,
      durationMs: 3000, version: 2 } }));
    const entry = createStudentWorkCommandFunction({ runtime: { functionName: 'student-work-command',
      getPlatformSubject: vi.fn(async () => ({ subject: 'subject', loginType: 'USERNAME' as const,
        isAuthenticated: true })), getBusinessSessionId: vi.fn(async () => 'ses_student') },
    actorResolver: { resolve: vi.fn(async () => student) },
    clock: { nowIso: () => '2026-10-03T08:00:00+08:00' },
    requestIds: { next: () => 'req_generated' },
    service: { beginDraft: vi.fn(), submit: vi.fn(), deleteDraft: vi.fn() } as unknown as
      Parameters<typeof createStudentWorkCommandFunction>[0]['service'],
    taskDubbing: { begin, seal } });
    expect(await entry({ apiVersion: 'm1.v1', action: 'beginTaskDubbingWork',
      payload: { taskId: 'task_demo', itemId: 'item_demo', studentId: 'forged' },
      expectedVersion: 0, operationId: 'operation_begin' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await entry({ apiVersion: 'm1.v1', action: 'beginTaskDubbingWork',
      payload: { taskId: 'task_demo', itemId: 'item_demo' }, expectedVersion: 0,
      operationId: 'operation_begin' }))
      .toMatchObject({ ok: true, data: { workId: 'task_work_demo', round: 1 } });
    expect(begin).toHaveBeenCalledWith(student, 'task_demo', 'item_demo', 'operation_begin');
    expect(await entry({ apiVersion: 'm1.v1', action: 'sealTaskDubbingWork',
      payload: { workId: 'task_work_demo', stagingFileId: 'cloud://staging/audio.mp3' },
      expectedVersion: 1, operationId: 'operation_seal' }))
      .toMatchObject({ ok: true, data: { status: 'submitted' } });
    expect(seal).toHaveBeenCalledWith(student, 'task_work_demo',
      'cloud://staging/audio.mp3', 1, 'operation_seal');
  });
});
