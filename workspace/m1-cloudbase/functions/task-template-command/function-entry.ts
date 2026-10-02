import { TASK_TEMPLATE_COMMAND_ACTIONS, validateTaskTemplateCommandRequest } from '../../src/contracts/task-template-functions';
import type { TaskTemplateService } from '../../src/task-template/service';
import type { TaskTemplate } from '../../src/task-template/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createTaskTemplateFailureMapper } from '../shared/task-template-failure';

export interface TaskTemplateCommandDependencies extends TrustedFunctionDependencies { readonly service: TaskTemplateService }
export function createTaskTemplateCommandFunction(dependencies: TaskTemplateCommandDependencies) {
  return createTrustedFunction('task-template-command', TASK_TEMPLATE_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createTaskTemplateFailureMapper(dependencies.mapFailure) },
    validateTaskTemplateCommandRequest,
    async (input, actor): Promise<ServiceResult<TaskTemplate>> => success(
      input.action === 'saveTemplate'
        ? await dependencies.service.save(actor, input.input, input.expectedVersion, input.operationId)
        : input.action === 'renameTemplate'
          ? await dependencies.service.rename(actor, input.templateId, input.title, input.expectedVersion, input.operationId)
          : input.action === 'copyTemplate'
            ? await dependencies.service.copyPersonal(actor, input.templateId, input.title, input.expectedVersion, input.operationId)
            : input.action === 'removeTemplate'
              ? await dependencies.service.remove(actor, input.templateId, input.expectedVersion, input.operationId)
              : await dependencies.service.use(actor, input.templateId, input.expectedVersion, input.operationId),
      createMeta(dependencies.clock, dependencies.requestIds),
    ));
}
