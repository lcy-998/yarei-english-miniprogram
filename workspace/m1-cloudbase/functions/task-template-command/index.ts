import { TASK_TEMPLATE_COMMAND_ACTIONS, validateTaskTemplateCommandRequest } from '../../src/contracts/task-template-functions';
import { DocumentTemplateRepository } from '../../src/task-template/document-repository';
import { TaskTemplateService } from '../../src/task-template/service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createTaskTemplateCommandFunction } from './function-entry';

export { createTaskTemplateCommandFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('task-template-command', TASK_TEMPLATE_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateTaskTemplateCommandRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('task-template-command', unavailable,
  (capabilities, infrastructure) => createTaskTemplateCommandFunction({ ...infrastructure,
    service: new TaskTemplateService(new DocumentTemplateRepository(infrastructure.documents),
      infrastructure.clock, capabilities.identifiers) }));
