import { TEACHER_TEXTBOOK_COMMAND_ACTIONS, validateTeacherTextbookCommandRequest } from '../../src/contracts/teacher-textbook-functions';
import { DocumentTextbookRepository } from '../../src/textbook/document-repository';
import { TeacherTextbookService } from '../../src/textbook/service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createTeacherTextbookCommandFunction } from './function-entry';

export { createTeacherTextbookCommandFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('teacher-textbook-command', TEACHER_TEXTBOOK_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateTeacherTextbookCommandRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('teacher-textbook-command', unavailable,
  (_capabilities, infrastructure) => createTeacherTextbookCommandFunction({ ...infrastructure,
    service: new TeacherTextbookService(new DocumentTextbookRepository(infrastructure.documents), infrastructure.clock) }));
