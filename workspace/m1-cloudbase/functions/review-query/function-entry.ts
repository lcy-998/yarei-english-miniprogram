import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { REVIEW_QUERY_ACTIONS, validateReviewQueryRequest } from '../../src/contracts/task-query-functions';
import type { ServiceResult } from '../../src/shared/protocol';
import type { ReviewQueryService } from '../../src/task-query/service';
import { createTaskQueryFailureMapper } from '../shared/task-query-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface ReviewQueryHandler extends Pick<ReviewQueryService, 'listReviewTasks' | 'getSubmissionForReview' | 'previewBatchComment'> {}
export interface ReviewQueryFunctionDependencies extends TrustedFunctionDependencies { readonly handler: ReviewQueryHandler }

export function createReviewQueryFunction(dependencies: ReviewQueryFunctionDependencies) {
  return createTrustedFunction(
    'review-query', REVIEW_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createTaskQueryFailureMapper(dependencies.mapFailure) },
    validateReviewQueryRequest,
    async (input, actor: TrustedActorContext): Promise<ServiceResult<unknown>> => {
      switch (input.action) {
        case 'listReviewTasks': return dependencies.handler.listReviewTasks(actor, input.filters, input.page);
        case 'getSubmissionForReview': return dependencies.handler.getSubmissionForReview(actor, input.submissionId);
        case 'previewBatchComment': return dependencies.handler.previewBatchComment(actor, input.taskId, input.filter, input.selection, input.comment);
      }
    },
  );
}
