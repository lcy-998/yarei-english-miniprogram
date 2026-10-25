import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { STUDENT_TASK_QUERY_ACTIONS, validateStudentTaskQueryRequest } from '../../src/contracts/task-query-functions';
import type { ServiceResult } from '../../src/shared/protocol';
import type { StudentTaskQueryService } from '../../src/task-query/service';
import type { TaskMediaPlaybackService } from '../../src/task-media/playback-service';
import type { SubmittedTaskMediaPlaybackService } from '../../src/task-media/submitted-playback-service';
import { createMeta, failure, success } from '../../src/shared/result';
import { createTaskQueryFailureMapper } from '../shared/task-query-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface StudentTaskQueryHandler extends Pick<StudentTaskQueryService, 'getHome' | 'listMyTasks' | 'getMyTask'> {}
export interface StudentTaskQueryFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: StudentTaskQueryHandler;
  readonly media?: Pick<TaskMediaPlaybackService, 'get'>;
  readonly submittedMedia?: Pick<SubmittedTaskMediaPlaybackService, 'get'>;
}

export function createStudentTaskQueryFunction(dependencies: StudentTaskQueryFunctionDependencies) {
  return createTrustedFunction(
    'student-task-query', STUDENT_TASK_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createTaskQueryFailureMapper(dependencies.mapFailure) },
    validateStudentTaskQueryRequest,
    async (input, actor: TrustedActorContext): Promise<ServiceResult<unknown>> => {
      switch (input.action) {
        case 'getHome': return dependencies.handler.getHome(actor, input.localDate);
        case 'listMyTasks': return dependencies.handler.listMyTasks(actor, input.filters, input.page);
        case 'getMyTask': return dependencies.handler.getMyTask(actor, input.taskId);
        case 'getTaskMediaPlayback': {
          if (!dependencies.media) return failure('SERVICE_UNAVAILABLE', createMeta(dependencies.clock, dependencies.requestIds));
          const result = await dependencies.media.get(actor, input.taskId, input.itemId);
          const meta = createMeta(dependencies.clock, dependencies.requestIds);
          return result.ok ? success(result.data, meta)
            : failure(result.code === 'SESSION_EXPIRED' ? 'CONFLICT'
              : result.code === 'SEEK_FORWARD' || result.code === 'PLAYBACK_TOO_FAST'
                ? 'VALIDATION_ERROR' : result.code, meta);
        }
        case 'getSubmittedTaskMediaPlayback': {
          if (!dependencies.submittedMedia) return failure('SERVICE_UNAVAILABLE',
            createMeta(dependencies.clock, dependencies.requestIds));
          const result = await dependencies.submittedMedia.get(actor, input.taskId,
            input.itemId, input.submissionVersion);
          const meta = createMeta(dependencies.clock, dependencies.requestIds);
          return result.ok ? success(result.data, meta) : failure(result.code, meta);
        }
      }
    },
  );
}
