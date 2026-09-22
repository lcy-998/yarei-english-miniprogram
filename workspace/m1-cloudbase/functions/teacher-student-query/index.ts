import { TEACHER_STUDENT_QUERY_ACTIONS, validateTeacherStudentQueryRequest } from '../../src/contracts/teacher-student-functions';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createDefaultCloudBaseTeacherStudentQueryFunction } from '../shared/default-cloudbase-function';
import { createTeacherStudentQueryFunction } from './function-entry';

export { createTeacherStudentQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'teacher-student-query',
  TEACHER_STUDENT_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateTeacherStudentQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseTeacherStudentQueryFunction(
  unavailable,
  (_capabilities, infrastructure) => createTeacherStudentQueryFunction({
    ...infrastructure,
    handler: infrastructure.handler,
  }),
);
