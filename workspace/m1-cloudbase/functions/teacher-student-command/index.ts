import {
  TEACHER_STUDENT_COMMAND_ACTIONS,
  validateTeacherStudentCommandRequest,
} from '../../src/contracts/teacher-student-functions';
import { createOrgContentDocumentPersistence } from '../../src/repositories/org-content-document-adapter';
import { TeacherStudentCommandService } from '../../src/teacher-students/command-service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createTeacherStudentCommandFunction } from './function-entry';

export { createTeacherStudentCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'teacher-student-command',
  TEACHER_STUDENT_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateTeacherStudentCommandRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseFunction(
  'teacher-student-command',
  unavailable,
  (capabilities, infrastructure) => {
    const persistence = createOrgContentDocumentPersistence(infrastructure.documents);
    return createTeacherStudentCommandFunction({
      ...infrastructure,
      handler: new TeacherStudentCommandService(
        persistence.repository,
        infrastructure.clock,
        capabilities.identifiers,
        persistence.idempotency,
      ),
    });
  },
);
