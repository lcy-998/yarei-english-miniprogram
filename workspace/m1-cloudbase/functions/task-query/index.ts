import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { TASK_QUERY_ACTIONS, validateTaskQueryRequest } from '../../src/contracts/task-query-functions';
import { createDefaultCloudBaseTaskQueryFunction } from '../shared/default-cloudbase-function';
import { createTaskQueryFunction } from './function-entry';

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
  (_capabilities, infrastructure) => createTaskQueryFunction({
    ...infrastructure,
    handler: infrastructure.teacherTaskHandler,
  }),
);
