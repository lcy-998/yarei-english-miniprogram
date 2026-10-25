import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { TASK_QUERY_ACTIONS, validateTaskQueryRequest } from '../../src/contracts/task-query-functions';
import type { ServiceResult } from '../../src/shared/protocol';
import type { TeacherTaskQueryService } from '../../src/task-query/service';
import type { TeacherCheckListService } from '../../src/teacher-check/service';
import { createMeta, failure, success } from '../../src/shared/result';
import { createTaskQueryFailureMapper } from '../shared/task-query-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface TaskQueryHandler extends Pick<TeacherTaskQueryService, 'getTeacherWorkbench' | 'listTeacherTasks' | 'getDraftOptions' | 'previewTask' | 'getTaskForEdit' | 'getCompletion'> {}
export interface TaskQueryFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: TaskQueryHandler;
  readonly checkList?: TeacherCheckListService;
}

export function createTaskQueryFunction(dependencies: TaskQueryFunctionDependencies) {
  return createTrustedFunction(
    'task-query', TASK_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createTaskQueryFailureMapper(dependencies.mapFailure) },
    validateTaskQueryRequest,
    async (input, actor: TrustedActorContext): Promise<ServiceResult<unknown>> => {
      switch (input.action) {
        case 'getTeacherWorkbench': return dependencies.handler.getTeacherWorkbench(actor, input.date, input.classId);
        case 'listTeacherTasks': return dependencies.handler.listTeacherTasks(actor, input.filters, input.page);
        case 'listTeacherCheckItems': return dependencies.checkList
          ? success(await dependencies.checkList.list(actor, input.filters, input.page),
            createMeta(dependencies.clock, dependencies.requestIds))
          : failure('SERVICE_UNAVAILABLE', createMeta(dependencies.clock, dependencies.requestIds));
        case 'getDraftOptions': return dependencies.handler.getDraftOptions(actor, input.catalogMode);
        case 'previewTask': return dependencies.handler.previewTask(actor, input.preview);
        case 'getTaskForEdit': return dependencies.handler.getTaskForEdit(actor, input.taskId);
        case 'getCompletion': return dependencies.handler.getCompletion(actor, input.taskId, input.filter, input.page);
      }
    },
  );
}
