import { TASK_TEMPLATE_QUERY_ACTIONS, validateTaskTemplateQueryRequest } from '../../src/contracts/task-template-functions';
import { DocumentTemplateRepository } from '../../src/task-template/document-repository';
import { TaskTemplateService } from '../../src/task-template/service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createTaskTemplateQueryFunction } from './function-entry';

export { createTaskTemplateQueryFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('task-template-query', TASK_TEMPLATE_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateTaskTemplateQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('task-template-query', unavailable,
  (capabilities, infrastructure) => createTaskTemplateQueryFunction({ ...infrastructure,
    service: new TaskTemplateService(new DocumentTemplateRepository(infrastructure.documents),
      infrastructure.clock, capabilities.identifiers) }));
