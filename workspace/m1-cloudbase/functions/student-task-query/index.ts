import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { STUDENT_TASK_QUERY_ACTIONS, validateStudentTaskQueryRequest } from '../../src/contracts/task-query-functions';
import { createDefaultCloudBaseTaskQueryFunction } from '../shared/default-cloudbase-function';
import { createStudentTaskQueryFunction } from './function-entry';

export { createStudentTaskQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'student-task-query',
  STUDENT_TASK_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateStudentTaskQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseTaskQueryFunction(
  'student-task-query',
  unavailable,
  (_capabilities, infrastructure) => createStudentTaskQueryFunction({
    ...infrastructure,
    handler: infrastructure.studentTaskHandler,
  }),
);
