import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { createContentQueryFunction } from '../../functions/content-query/function-entry';

const actor: TrustedActorContext = { requestId: 'request_asset', sessionId: 'session_teacher',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_teacher', permissions: ['content.read'],
  scopeIds: ['class_one'], authzVersion: 1 };

describe('teacher asset content-query boundary', () => {
  it('accepts only exact read requests and keeps the actor server-owned', async () => {
    const list = vi.fn(async () => ({ items: [], nextOffset: null }));
    const facets = vi.fn(async () => [{ grade: '三年级', textbook: '测试教材', unit: 'Unit 3' }]);
    const preview = vi.fn(async () => ({ id: 'audio_demo', kind: 'listening' as const,
      title: '虚构听力', contentVersion: 3, grade: '三年级', textbook: null, unit: null,
      durationMs: 10000, questionCount: 0, questions: [], clips: [], subtitles: [],
      playback: { temporaryUrl: 'https://example.test/audio.mp3', expiresAt: '2026-10-03T08:01:00.000Z' } }));
    const entry = createContentQueryFunction({ runtime: { functionName: 'content-query',
      getPlatformSubject: vi.fn(async () => ({ subject: 'subject', loginType: 'USERNAME' as const,
        isAuthenticated: true })), getBusinessSessionId: vi.fn(async () => 'session_teacher') },
    actorResolver: { resolve: vi.fn(async () => actor) },
    clock: { nowIso: () => '2026-10-03T08:00:00.000Z' },
    requestIds: { next: () => 'request_generated' },
    handler: {} as Parameters<typeof createContentQueryFunction>[0]['handler'],
    teacherAssets: { list, facets, preview } });
    const request = { apiVersion: 'm1.v1', action: 'listTeacherAssets',
      payload: { filters: { kind: 'listening', targetClassIds: ['class_one'] },
        page: { limit: 20, offset: 0 } } };
    expect(await entry({ ...request, payload: { ...request.payload, actorUserId: 'forged' } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await entry(request)).toMatchObject({ ok: true, data: { items: [] } });
    expect(list).toHaveBeenCalledWith(actor, { kind: 'listening', targetClassIds: ['class_one'] },
      { limit: 20, offset: 0 });
    expect(await entry({ apiVersion: 'm1.v1', action: 'listTeacherAssetFacets',
      payload: { kind: 'listening', targetClassIds: ['class_one'] } }))
      .toMatchObject({ ok: true, data: [{ grade: '三年级' }] });
    expect(facets).toHaveBeenCalledWith(actor, 'listening', ['class_one']);
    expect(await entry({ apiVersion: 'm1.v1', action: 'previewTeacherAsset',
      payload: { resourceId: 'audio_demo', targetClassIds: ['class_one'] } }))
      .toMatchObject({ ok: true, data: { id: 'audio_demo' } });
    expect(preview).toHaveBeenCalledWith(actor, 'audio_demo', ['class_one']);
  });
});
