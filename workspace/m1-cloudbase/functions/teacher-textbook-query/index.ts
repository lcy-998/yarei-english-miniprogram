import { TEACHER_TEXTBOOK_QUERY_ACTIONS, validateTeacherTextbookQueryRequest } from '../../src/contracts/teacher-textbook-functions';
import { DocumentTextbookRepository } from '../../src/textbook/document-repository';
import { TeacherTextbookService } from '../../src/textbook/service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createTeacherTextbookQueryFunction } from './function-entry';

export { createTeacherTextbookQueryFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('teacher-textbook-query', TEACHER_TEXTBOOK_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateTeacherTextbookQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('teacher-textbook-query', unavailable,
  (_capabilities, infrastructure) => createTeacherTextbookQueryFunction({ ...infrastructure,
    service: new TeacherTextbookService(new DocumentTextbookRepository(infrastructure.documents), infrastructure.clock) }));
