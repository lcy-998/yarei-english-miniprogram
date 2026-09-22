import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { STUDENT_TASK_QUERY_ACTIONS, validateStudentTaskQueryRequest } from '../../src/contracts/task-query-functions';
import type { ServiceResult } from '../../src/shared/protocol';
import type { StudentTaskQueryService } from '../../src/task-query/service';
import { createTaskQueryFailureMapper } from '../shared/task-query-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface StudentTaskQueryHandler extends Pick<StudentTaskQueryService, 'getHome' | 'listMyTasks' | 'getMyTask'> {}
export interface StudentTaskQueryFunctionDependencies extends TrustedFunctionDependencies { readonly handler: StudentTaskQueryHandler }

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
      }
    },
  );
}
