import { ADMIN_TASK_ACTIVITY_QUERY_ACTIONS, validateAdminTaskActivityQueryRequest } from '../../src/contracts/admin-task-activity-functions';
import { AdminTaskActivityService } from '../../src/admin-task-activity/service';
import { AdminTaskActivityWriteRepository } from '../../src/admin-task-activity/write-repository';
import { DocumentActivityRepository } from '../../src/activity/document-repository';
import { DocumentTemplateRepository } from '../../src/task-template/document-repository';
import { createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createAdminTaskActivityQueryFunction } from './function-entry';

export { createAdminTaskActivityQueryFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('admin-task-activity-query', ADMIN_TASK_ACTIVITY_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const result = validateAdminTaskActivityQueryRequest(request);
    return result.ok ? null : result.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('admin-task-activity-query', unavailable,
  (_capabilities, infrastructure) => createAdminTaskActivityQueryFunction({ ...infrastructure,
    service: new AdminTaskActivityService({ organization: createOrgContentDocumentRepository(infrastructure.documents),
      tasks: createTaskQueryDocumentRepository(infrastructure.documents),
      activities: new DocumentActivityRepository(infrastructure.documents),
      templates: new DocumentTemplateRepository(infrastructure.documents),
      writes: new AdminTaskActivityWriteRepository(infrastructure.documents),
      clock: infrastructure.clock, requestIds: infrastructure.requestIds }) }));
