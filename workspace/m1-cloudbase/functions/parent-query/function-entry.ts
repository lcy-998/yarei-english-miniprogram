import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { PARENT_QUERY_ACTIONS, validateParentQueryRequest } from '../../src/contracts/task-core-functions';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, failure, success } from '../../src/shared/result';
import type { ParentTaskResultView } from '../../src/task-core/types';
import { ParentMediaError, type ParentMediaPlaybackService } from '../../src/task-query/parent-media-playback';
import { ParentFeedbackVoiceError, type ParentFeedbackVoiceService } from '../../src/task-query/parent-feedback-voice';
import { ParentTaskMediaError, type ParentTaskMediaPlaybackService } from '../../src/task-query/parent-task-media-playback';
import type { FeedbackDetailView, PageRequest, PageResult, ParentChildListItem, ParentHomeView, ParentTaskListItem, StudentTaskFilters } from '../../src/task-query/types';
import { createTaskQueryFailureMapper } from '../shared/task-query-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface ParentQueryHandler {
  listChildren(actor: TrustedActorContext): Promise<ServiceResult<readonly ParentChildListItem[]>>;
  getHome(actor: TrustedActorContext, studentId: string): Promise<ServiceResult<ParentHomeView>>;
  listChildTasks(actor: TrustedActorContext, studentId: string, filters: StudentTaskFilters, page: PageRequest): Promise<ServiceResult<PageResult<ParentTaskListItem>>>;
  getParentTaskResult(actor: TrustedActorContext, studentId: string, taskId: string): Promise<ServiceResult<ParentTaskResultView>>;
  getFeedback(actor: TrustedActorContext, studentId: string, feedbackId: string): Promise<ServiceResult<FeedbackDetailView>>;
}

export interface ParentQueryFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: ParentQueryHandler;
  readonly mediaPlayback?: Pick<ParentMediaPlaybackService, 'getRecording'>;
  readonly feedbackVoice?: Pick<ParentFeedbackVoiceService, 'getPlayback'>;
  readonly taskMediaPlayback?: Pick<ParentTaskMediaPlaybackService, 'getPlayback'>;
}

export function createParentQueryFunction(dependencies: ParentQueryFunctionDependencies) {
  return createTrustedFunction(
    'parent-query',
    PARENT_QUERY_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => {
      if (phase === 'handler' && error instanceof ParentMediaError) return error.code;
      if (phase === 'handler' && error instanceof ParentFeedbackVoiceError) return error.code;
      if (phase === 'handler' && error instanceof ParentTaskMediaError) return error.code;
      return createTaskQueryFailureMapper(dependencies.mapFailure)(phase, error);
    } },
    validateParentQueryRequest,
    async (input, actor): Promise<ServiceResult<unknown>> => {
      if (input.action === 'listChildren') return dependencies.handler.listChildren(actor);
      if (input.action === 'getHome') return dependencies.handler.getHome(actor, input.childId);
      if (input.action === 'listChildTasks') return dependencies.handler.listChildTasks(actor, input.childId, input.filters, input.page);
      if (input.action === 'getFeedback') return dependencies.handler.getFeedback(actor, input.childId, input.feedbackId);
      if (input.action === 'getRecordingPlayback') {
        const meta = createMeta(dependencies.clock, dependencies.requestIds);
        return dependencies.mediaPlayback
          ? success(await dependencies.mediaPlayback.getRecording(actor, input), meta)
          : failure('SERVICE_UNAVAILABLE', meta);
      }
      if (input.action === 'getChildFeedbackVoicePlayback') {
        const meta = createMeta(dependencies.clock, dependencies.requestIds);
        return dependencies.feedbackVoice
          ? success(await dependencies.feedbackVoice.getPlayback(actor, input), meta)
          : failure('SERVICE_UNAVAILABLE', meta);
      }
      if (input.action === 'getTaskMediaPlayback') {
        const meta = createMeta(dependencies.clock, dependencies.requestIds);
        return dependencies.taskMediaPlayback
          ? success(await dependencies.taskMediaPlayback.getPlayback(actor, input), meta)
          : failure('SERVICE_UNAVAILABLE', meta);
      }
      return dependencies.handler.getParentTaskResult(actor, input.childId, input.taskId);
    },
  );
}
