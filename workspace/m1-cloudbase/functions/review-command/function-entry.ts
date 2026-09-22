import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { REVIEW_COMMAND_ACTIONS, validateReviewCommandRequest } from '../../src/contracts/task-core-functions';
import type { JsonObject, ServiceResult } from '../../src/shared/protocol';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface ReviewCommandHandler {
  publishReview(
    actor: TrustedActorContext,
    input: Readonly<{
      submissionId: string;
      decision: 'approved' | 'returned';
      score?: number;
      textComment?: string;
      returnReason?: string;
      expectedSubmissionVersion: number;
    }>,
    expectedAssignmentVersion: number,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>>;
  publishBatchComment(
    actor: TrustedActorContext,
    previewToken: string,
    previewVersion: number,
    textComment: string,
    operationId: string,
  ): Promise<ServiceResult<JsonObject>>;
}

export interface ReviewCommandFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: ReviewCommandHandler;
}

export function createReviewCommandFunction(dependencies: ReviewCommandFunctionDependencies) {
  return createTrustedFunction(
    'review-command',
    REVIEW_COMMAND_ACTIONS,
    dependencies,
    validateReviewCommandRequest,
    async (input, actor) => input.action === 'publishReview'
      ? dependencies.handler.publishReview(
          actor,
          input.input,
          input.expectedAssignmentVersion,
          input.operationId,
        )
      : dependencies.handler.publishBatchComment(
          actor,
          input.previewToken,
          input.previewVersion,
          input.textComment,
          input.operationId,
        ),
  );
}
