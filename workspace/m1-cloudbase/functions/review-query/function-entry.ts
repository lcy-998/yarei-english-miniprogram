import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { REVIEW_QUERY_ACTIONS, validateReviewQueryRequest } from '../../src/contracts/task-query-functions';
import type { ServiceResult } from '../../src/shared/protocol';
import type { CloudBasePlaybackSdkPort } from '../../src/student-work/cloudbase-playback';
import type { ReviewQueryService } from '../../src/task-query/service';
import type { ReviewSubmissionView } from '../../src/task-query/types';
import { createTaskQueryFailureMapper } from '../shared/task-query-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface ReviewQueryHandler extends Pick<ReviewQueryService, 'listReviewTasks' | 'getSubmissionForReview' | 'previewBatchComment'> {}
export interface ReviewQueryFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: ReviewQueryHandler;
  readonly readingMediaStorage?: CloudBasePlaybackSdkPort;
}

async function withSignedReadingPages(result: ServiceResult<ReviewSubmissionView>,
  storage: CloudBasePlaybackSdkPort | undefined): Promise<ServiceResult<ReviewSubmissionView>> {
  if (!result.ok) return result;
  const pages = result.data.readingPages ?? [];
  const ids = [...new Set(pages.flatMap(page => [page.imageAssetKey, page.thumbnailAssetKey])
    .filter(key => key.startsWith('cloud://')))];
  if (!ids.length) return result;
  const urls = new Map<string, string>();
  if (storage) {
    try {
      for (let offset = 0; offset < ids.length; offset += 40) {
        const batch = ids.slice(offset, offset + 40);
        const signed = await storage.getTempFileURL({ fileList: batch.map(fileID => ({ fileID, maxAge: 3600 })) });
        for (const fileID of batch) {
          const item = signed.fileList?.find(entry => entry.fileID === fileID);
          if (item?.tempFileURL?.startsWith('https://') && (item.code === undefined || item.code === 'SUCCESS')) {
            urls.set(fileID, item.tempFileURL);
          }
        }
      }
    } catch { /* Keep submitted answers available when image signing fails. */ }
  }
  const resolved = (key: string) => key.startsWith('cloud://') ? urls.get(key) ?? '' : key;
  return { ...result, data: { ...result.data, readingPages: pages.map(page => ({ ...page,
    imageAssetKey: resolved(page.imageAssetKey), thumbnailAssetKey: resolved(page.thumbnailAssetKey) })) } };
}

export function createReviewQueryFunction(dependencies: ReviewQueryFunctionDependencies) {
  return createTrustedFunction(
    'review-query', REVIEW_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createTaskQueryFailureMapper(dependencies.mapFailure) },
    validateReviewQueryRequest,
    async (input, actor: TrustedActorContext): Promise<ServiceResult<unknown>> => {
      switch (input.action) {
        case 'listReviewTasks': return dependencies.handler.listReviewTasks(actor, input.filters, input.page);
        case 'getSubmissionForReview': return withSignedReadingPages(
          await dependencies.handler.getSubmissionForReview(actor, input.submissionId), dependencies.readingMediaStorage);
        case 'previewBatchComment': return dependencies.handler.previewBatchComment(actor, input.taskId, input.filter, input.selection, input.comment);
      }
    },
  );
}
