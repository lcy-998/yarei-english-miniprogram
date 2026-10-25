import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { TASK_QUERY_ACTIONS, validateTaskQueryRequest } from '../../src/contracts/task-query-functions';
import { createDefaultCloudBaseTaskQueryFunction } from '../shared/default-cloudbase-function';
import { createTaskQueryFunction } from './function-entry';
import { TeacherCheckListService } from '../../src/teacher-check/service';
import { ActivityService } from '../../src/activity/activity-service';
import { DocumentActivityRepository } from '../../src/activity/document-repository';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';

export { createTaskQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'task-query',
  TASK_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateTaskQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseTaskQueryFunction(
  'task-query',
  unavailable,
  (capabilities, infrastructure) => createTaskQueryFunction({
    ...infrastructure,
    handler: infrastructure.teacherTaskHandler,
    checkList: new TeacherCheckListService(
      createTaskQueryDocumentRepository(infrastructure.documents),
      createOrgContentDocumentRepository(infrastructure.documents),
      new ActivityService(new DocumentActivityRepository(infrastructure.documents),
        infrastructure.clock, capabilities.identifiers), infrastructure.clock),
  }),
);
