import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { PARENT_QUERY_ACTIONS, validateParentQueryRequest } from '../../src/contracts/task-core-functions';
import type { ServiceResult } from '../../src/shared/protocol';
import type { ParentTaskResultView } from '../../src/task-core/types';
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
}

export function createParentQueryFunction(dependencies: ParentQueryFunctionDependencies) {
  return createTrustedFunction(
    'parent-query',
    PARENT_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createTaskQueryFailureMapper(dependencies.mapFailure) },
    validateParentQueryRequest,
    async (input, actor): Promise<ServiceResult<unknown>> => {
      if (input.action === 'listChildren') return dependencies.handler.listChildren(actor);
      if (input.action === 'getHome') return dependencies.handler.getHome(actor, input.childId);
      if (input.action === 'listChildTasks') return dependencies.handler.listChildTasks(actor, input.childId, input.filters, input.page);
      if (input.action === 'getFeedback') return dependencies.handler.getFeedback(actor, input.childId, input.feedbackId);
      return dependencies.handler.getParentTaskResult(actor, input.childId, input.taskId);
    },
  );
}
