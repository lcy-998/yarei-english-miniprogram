import { createDefaultCloudBaseTaskQueryFunction } from '../shared/default-cloudbase-function';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { TEACHER_SUGGESTION_COMMAND_ACTIONS,
  validateTeacherSuggestionCommandRequest } from '../../src/contracts/teacher-suggestion-functions';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { TeacherSuggestionService } from '../../src/teacher-ai/service';
import { createTeacherSuggestionCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('teacher-suggestion-command',
  TEACHER_SUGGESTION_COMMAND_ACTIONS, (_action, _payload, request) => {
    const validated = validateTeacherSuggestionCommandRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });

export const main = createDefaultCloudBaseTaskQueryFunction(
  'teacher-suggestion-command', unavailable,
  (capabilities, infrastructure) => {
    const runtime = capabilities.teacherSuggestion;
    const store = capabilities.teacherSuggestionStore;
    if (!runtime || !store) return unavailable;
    const suggestions = new TeacherSuggestionService(infrastructure.reviewHandler,
      createTaskQueryDocumentRepository(infrastructure.documents), runtime.inference, store,
      infrastructure.clock, capabilities.identifiers, runtime.modelVersion, runtime.promptVersion);
    return createTeacherSuggestionCommandFunction({ ...infrastructure, suggestions });
  },
);
