import { describe, expect, it } from 'vitest';
import { main } from '../../functions/native-admin-media-command';
import { validateNativeAdminMediaRequest } from '../../functions/native-admin-media-command/function-entry';

describe('A-08 protected media command gate', () => {
  it('requires a current record version, operation key and issue reason', () => {
    const request = { apiVersion: 'm1.v1' as const, action: 'reportMediaIssue' as const,
      payload: { mediaId: 'media_demo', reason: '扫描证据缺失' },
      expectedVersion: 2, operationId: 'operation_media_issue' };
    expect(validateNativeAdminMediaRequest(request)).toMatchObject({ ok: true });
    expect(validateNativeAdminMediaRequest({ ...request, payload: { ...request.payload,
      reason: '' } }).ok).toBe(false);
    expect(validateNativeAdminMediaRequest({ ...request, expectedVersion: 0 }).ok).toBe(false);
    expect(validateNativeAdminMediaRequest({ ...request, payload: { ...request.payload,
      actorRole: 'admin' } }).ok).toBe(false);
    expect(validateNativeAdminMediaRequest({ ...request, action: 'unpublishMedia',
      payload: { mediaId: 'media_demo', reason: '源素材需要校对' } }).ok).toBe(true);
    expect(validateNativeAdminMediaRequest({ ...request, action: 'unpublishMedia',
      payload: { mediaId: 'media_demo', reason: '' } }).ok).toBe(false);
  });

  it('does not expose old review or publish actions and needs a configured service for writes', async () => {
    expect(await main({ apiVersion: 'm1.v1', action: 'reportMediaIssue', payload: {
      mediaId: 'media_demo', reason: '题目片段需要校对' },
    expectedVersion: 2, operationId: 'operation_media_issue' }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(await main({ apiVersion: 'm1.v1', action: 'publishMedia',
      payload: { mediaId: 'media_demo' }, expectedVersion: 3,
      operationId: 'operation_media_publish' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
