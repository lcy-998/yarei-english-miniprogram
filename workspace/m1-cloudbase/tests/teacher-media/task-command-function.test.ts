import { describe, expect, it, vi } from 'vitest';
import { createTaskCommandFunction } from '../../functions/task-command/function-entry';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';

const teacher: TrustedActorContext = { requestId: 'req_teacher', sessionId: 'ses_teacher',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: ['media.upload'],
  scopeIds: ['class_demo'], authzVersion: 1 };

describe('central media asset boundary', () => {
  it('rejects legacy media writes through the teacher task function', async () => {
    const entry = createTaskCommandFunction({ runtime: { functionName: 'task-command',
      getPlatformSubject: vi.fn(async () => ({ subject: 'subject', loginType: 'USERNAME' as const,
        isAuthenticated: true })), getBusinessSessionId: vi.fn(async () => 'ses_teacher') },
    actorResolver: { resolve: vi.fn(async () => teacher) },
    clock: { nowIso: () => '2026-10-03T08:00:00+08:00' },
    requestIds: { next: () => 'req_generated' },
    handler: {} as Parameters<typeof createTaskCommandFunction>[0]['handler'] });
    expect(await entry({ apiVersion: 'm1.v1', action: 'submitTeacherMediaReview',
      payload: { mediaId: 'media_demo', actorId: 'forged' }, expectedVersion: 2,
      operationId: 'operation_submit_01' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const result = await entry({ apiVersion: 'm1.v1', action: 'submitTeacherMediaReview',
      payload: { mediaId: 'media_demo' }, expectedVersion: 2,
      operationId: 'operation_submit_01' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await entry({ apiVersion: 'm1.v1', action: 'decideTeacherMediaReview',
      payload: { mediaId: 'media_demo', decision: 'approved', reason: '' }, expectedVersion: 2,
      operationId: 'operation_decide_01' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await entry({ apiVersion: 'm1.v1', action: 'publishTeacherMedia',
      payload: { mediaId: 'media_demo' }, expectedVersion: 2,
      operationId: 'operation_publish_01' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('routes private video actions through the existing task command without accepting forged fields', async () => {
    const save = vi.fn(async () => ({ id: 'teacher_video_demo', status: 'draft', version: 1 }));
    const entry = createTaskCommandFunction({ runtime: { functionName: 'task-command',
      getPlatformSubject: vi.fn(async () => ({ subject: 'subject', loginType: 'USERNAME' as const,
        isAuthenticated: true })), getBusinessSessionId: vi.fn(async () => 'ses_teacher') },
    actorResolver: { resolve: vi.fn(async () => teacher) },
    clock: { nowIso: () => '2026-10-17T08:00:00+08:00' },
    requestIds: { next: () => 'req_generated' },
    handler: {} as Parameters<typeof createTaskCommandFunction>[0]['handler'],
    privateVideos: { available: async () => true, list: async () => [], save,
      get: async () => { throw new Error('not used'); },
      beginUpload: async () => { throw new Error('not used'); },
      seal: async () => { throw new Error('not used'); },
      retryProcessing: async () => { throw new Error('not used'); },
      publish: async () => { throw new Error('not used'); },
      withdraw: async () => { throw new Error('not used'); } } });
    expect(await entry({ apiVersion: 'm1.v1', action: 'privateVideoAvailability', payload: {} }))
      .toMatchObject({ ok: true, data: { enabled: true } });
    expect(await entry({ apiVersion: 'm1.v1', action: 'privateVideoSave',
      payload: { title: '虚构视频', questions: [] } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await entry({ apiVersion: 'm1.v1', action: 'privateVideoSave',
      payload: { title: '虚构视频', questions: [], ownerTeacherId: 'forged' },
      operationId: 'operation_private_video_01' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await entry({ apiVersion: 'm1.v1', action: 'privateVideoSave',
      payload: { title: '虚构视频', questions: [] },
      operationId: 'operation_private_video_01' }))
      .toMatchObject({ ok: true, data: { id: 'teacher_video_demo' } });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
