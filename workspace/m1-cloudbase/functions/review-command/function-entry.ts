import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { REVIEW_COMMAND_ACTIONS, validateReviewCommandRequest } from '../../src/contracts/task-core-functions';
import type { JsonObject, ServiceResult } from '../../src/shared/protocol';
import { createMeta, failure, success } from '../../src/shared/result';
import type { ReviewVoiceCommentService, ReviewVoiceResult, ReviewVoiceDraftView } from '../../src/review-voice/service';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface ReviewCommandHandler {
  publishReview(
    actor: TrustedActorContext,
    input: Readonly<{
      submissionId: string;
      decision: 'approved' | 'returned';
      score?: number;
      textComment?: string;
      aiSuggestionId?: string;
      voiceRecordingId?: string;
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
  readonly reviewVoice?: Pick<ReviewVoiceCommentService, 'begin' | 'seal'>;
}

export function createReviewCommandFunction(dependencies: ReviewCommandFunctionDependencies) {
  return createTrustedFunction(
    'review-command',
    REVIEW_COMMAND_ACTIONS,
    dependencies,
    validateReviewCommandRequest,
    async (input, actor) => {
      if (input.action === 'beginReviewVoiceRecording' || input.action === 'sealReviewVoiceRecording') {
        if (!dependencies.reviewVoice) return failure('SERVICE_UNAVAILABLE',
          createMeta(dependencies.clock, dependencies.requestIds));
        const result = input.action === 'beginReviewVoiceRecording'
          ? await dependencies.reviewVoice.begin(actor, input.submissionId, input.operationId)
          : await dependencies.reviewVoice.seal(actor, input.recordingId,
            input.stagingFileId, input.expectedVersion, input.operationId);
        return voiceResult(result, dependencies);
      }
      return input.action === 'publishReview'
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
        );
    },
  );
}

function voiceResult(result: ReviewVoiceResult<ReviewVoiceDraftView>,
  dependencies: TrustedFunctionDependencies): ServiceResult<JsonObject> {
  const meta = createMeta(dependencies.clock, dependencies.requestIds);
  return result.ok ? success<JsonObject>({ ...result.data }, meta) : failure(result.code, meta);
}
