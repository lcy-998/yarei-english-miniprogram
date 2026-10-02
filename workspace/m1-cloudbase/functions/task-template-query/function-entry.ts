import { TASK_TEMPLATE_QUERY_ACTIONS, validateTaskTemplateQueryRequest } from '../../src/contracts/task-template-functions';
import type { TaskTemplateService } from '../../src/task-template/service';
import type { TaskTemplate } from '../../src/task-template/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createTaskTemplateFailureMapper } from '../shared/task-template-failure';

export interface TaskTemplateQueryDependencies extends TrustedFunctionDependencies { readonly service: TaskTemplateService }
export function createTaskTemplateQueryFunction(dependencies: TaskTemplateQueryDependencies) {
  return createTrustedFunction('task-template-query', TASK_TEMPLATE_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createTaskTemplateFailureMapper(dependencies.mapFailure) },
    validateTaskTemplateQueryRequest,
    async (input, actor): Promise<ServiceResult<readonly TaskTemplate[] | TaskTemplate>> => success(
      input.action === 'listTemplates' ? await dependencies.service.list(actor)
        : await dependencies.service.get(actor, input.templateId),
      createMeta(dependencies.clock, dependencies.requestIds),
    ));
}
