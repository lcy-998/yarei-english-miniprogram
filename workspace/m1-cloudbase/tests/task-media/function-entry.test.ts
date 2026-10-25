import { describe, expect, it, vi } from 'vitest';
import { createLearningProgressCommandFunction } from '../../functions/learning-progress-command/function-entry';
import { createStudentTaskQueryFunction } from '../../functions/student-task-query/function-entry';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';

const student: TrustedActorContext = { requestId: 'req_student', sessionId: 'ses_student',
  actorUserId: 'student_demo', actorRole: 'student', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: [], scopeIds: ['student_demo'], authzVersion: 1 };

function boundary(functionName: 'learning-progress-command' | 'student-task-query') {
  return { runtime: { functionName,
    getPlatformSubject: vi.fn(async () => ({ subject: 'subject', loginType: 'USERNAME' as const, isAuthenticated: true })),
    getBusinessSessionId: vi.fn(async () => 'ses_student') },
  actorResolver: { resolve: vi.fn(async () => student) },
  clock: { nowIso: () => '2026-10-03T08:00:00+08:00' },
  requestIds: { next: () => 'req_generated' } };
}

describe('trusted M3 media function actions', () => {
  it('rejects forged progress and routes begin/heartbeat through current student identity', async () => {
    const begin = vi.fn(async () => ({ ok: true as const, data: { status: 'ready' as const,
      mediaId: 'media_demo', mediaVersion: 2, sessionId: 'media_session_demo',
      temporaryUrl: 'https://example.invalid/audio', expiresAt: '2026-10-03T08:01:00+08:00',
      confirmedThroughMs: 0, seekForwardAllowed: false as const } }));
    const heartbeat = vi.fn(async () => ({ ok: true as const,
      data: { sessionId: 'media_session_demo', confirmedThroughMs: 1000, completed: false } }));
    const command = createLearningProgressCommandFunction({ ...boundary('learning-progress-command'),
      handler: { async saveReadingProgress() { throw new Error('unexpected'); },
        async saveVocabularyProgress() { throw new Error('unexpected'); } }, media: { begin, heartbeat } });
    expect(await command({ apiVersion: 'm1.v1', action: 'beginTaskMediaSession',
      payload: { taskId: 'task_demo', itemId: 'item_demo', studentId: 'forged' }, operationId: 'operation_begin' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ apiVersion: 'm1.v1', action: 'beginTaskMediaSession',
      payload: { taskId: 'task_demo', itemId: 'item_demo' }, operationId: 'operation_begin' }))
      .toMatchObject({ ok: true, data: { sessionId: 'media_session_demo' } });
    expect(begin).toHaveBeenCalledWith(student, 'task_demo', 'item_demo', 'operation_begin');
    expect(await command({ apiVersion: 'm1.v1', action: 'reportTaskMediaHeartbeat',
      payload: { sessionId: 'media_session_demo', playedFromMs: 0, playedToMs: 1000,
        positionMs: 1000, confirmedThroughMs: 1000 }, operationId: 'operation_beat' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await command({ apiVersion: 'm1.v1', action: 'reportTaskMediaHeartbeat',
      payload: { sessionId: 'media_session_demo', playedFromMs: 0, playedToMs: 1000,
        positionMs: 1000 }, operationId: 'operation_beat' }))
      .toMatchObject({ ok: true, data: { confirmedThroughMs: 1000 } });
    expect(heartbeat).toHaveBeenCalledWith(student, { action: 'reportTaskMediaHeartbeat',
      sessionId: 'media_session_demo', playedFromMs: 0, playedToMs: 1000,
      positionMs: 1000, operationId: 'operation_beat' });
  });

  it('queries only current student media session and rejects extra payload fields', async () => {
    const get = vi.fn(async () => ({ ok: true as const, data: { status: 'unavailable' as const,
      mediaId: 'media_demo', mediaVersion: 2, sessionId: null, temporaryUrl: null,
      expiresAt: null, confirmedThroughMs: 0, seekForwardAllowed: false as const } }));
    const query = createStudentTaskQueryFunction({ ...boundary('student-task-query'),
      handler: { async getHome() { throw new Error('unexpected'); },
        async listMyTasks() { throw new Error('unexpected'); },
        async getMyTask() { throw new Error('unexpected'); } }, media: { get } });
    expect(await query({ apiVersion: 'm1.v1', action: 'getTaskMediaPlayback',
      payload: { taskId: 'task_demo', itemId: 'item_demo' } }))
      .toMatchObject({ ok: true, data: { status: 'unavailable' } });
    expect(get).toHaveBeenCalledWith(student, 'task_demo', 'item_demo');
    expect(await query({ apiVersion: 'm1.v1', action: 'getTaskMediaPlayback',
      payload: { taskId: 'task_demo', itemId: 'item_demo', organizationId: 'forged' } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
