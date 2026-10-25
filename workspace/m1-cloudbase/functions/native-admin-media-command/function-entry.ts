import type { FunctionRequest, JsonObject, ServiceResult } from '../../src/shared/protocol';
import { parseExactObject } from '../../src/shared/strict-object';
import { createMeta, success } from '../../src/shared/result';
import { AssetReviewError, type AssetReviewService,
  type AssetReviewReceipt } from '../../src/teacher-media/asset-review-service';
import { createTrustedFunction, type TrustedFunctionDependencies,
  type TrustedFunctionValidation } from '../shared/trusted-function';

export const NATIVE_ADMIN_MEDIA_ACTIONS = ['reportMediaIssue', 'unpublishMedia'] as const;
type Action = (typeof NATIVE_ADMIN_MEDIA_ACTIONS)[number];
type Validated =
  | Readonly<{ action: 'reportMediaIssue'; mediaId: string; reason: string;
    expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'unpublishMedia'; mediaId: string; reason: string;
    expectedVersion: number; operationId: string }>;

export function validateNativeAdminMediaRequest(request: FunctionRequest<Action, JsonObject>):
  TrustedFunctionValidation<Validated> {
  if (!Number.isSafeInteger(request.expectedVersion) || Number(request.expectedVersion) < 1
    || typeof request.operationId !== 'string'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(request.operationId)) return invalid('expectedVersion');
  const exact = parseExactObject(request.payload, ['mediaId', 'reason']);
  if (!exact.ok) return exact;
  if (typeof exact.value.mediaId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(exact.value.mediaId)) return invalid('mediaId');
  const reason = exact.value.reason;
  if (typeof reason !== 'string' || !reason.trim()
    || reason.length > (request.action === 'unpublishMedia' ? 200 : 300)) return invalid('reason');
  return { ok: true, value: { action: request.action, mediaId: exact.value.mediaId,
    reason, expectedVersion: Number(request.expectedVersion),
    operationId: request.operationId } };
}

export interface NativeAdminMediaDependencies extends TrustedFunctionDependencies {
  readonly media: Pick<AssetReviewService, 'reportIssue' | 'unpublish'>;
}

export function createNativeAdminMediaFunction(dependencies: NativeAdminMediaDependencies) {
  return createTrustedFunction<Action, Validated, JsonObject>(
    'native-admin-media-command', NATIVE_ADMIN_MEDIA_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof AssetReviewError
      ? error.code : dependencies.mapFailure?.(phase, error) ?? 'SERVICE_UNAVAILABLE' },
    validateNativeAdminMediaRequest,
    async (input, actor): Promise<ServiceResult<JsonObject>> => {
      const record = input.action === 'reportMediaIssue'
        ? await dependencies.media.reportIssue(actor, input.mediaId, input.expectedVersion,
          input.operationId, input.reason)
        : await dependencies.media.unpublish(actor, input.mediaId,
          input.expectedVersion, input.operationId, input.reason);
      return success<JsonObject>(safeMediaResult(record),
        createMeta(dependencies.clock, dependencies.requestIds));
    });
}

function safeMediaResult(record: AssetReviewReceipt): JsonObject {
  return { id: record.id, status: record.status,
    recordVersion: record.recordVersion, reviewVersion: record.reviewVersion };
}
function invalid(field: string): TrustedFunctionValidation<Validated> {
  return { ok: false, fieldErrors: { [field]: '媒体审核字段无效。' } };
}
