import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { TEACHER_SUGGESTION_COMMAND_ACTIONS,
  validateTeacherSuggestionCommandRequest } from '../../src/contracts/teacher-suggestion-functions';
import type { TeacherSuggestionService } from '../../src/teacher-ai/service';
import type { JsonObject, ServiceResult } from '../../src/shared/protocol';
import { createMeta, failure, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface TeacherSuggestionFunctionDependencies extends TrustedFunctionDependencies {
  readonly suggestions: TeacherSuggestionService;
}

export function createTeacherSuggestionCommandFunction(dependencies: TeacherSuggestionFunctionDependencies) {
  return createTrustedFunction('teacher-suggestion-command', TEACHER_SUGGESTION_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: (_phase, error) => dependencies.mapFailure?.('handler', error) ?? 'SERVICE_UNAVAILABLE' },
    validateTeacherSuggestionCommandRequest,
    async (input, actor: TrustedActorContext): Promise<ServiceResult<JsonObject>> => {
      const result = input.action === 'getSuggestion'
        ? await dependencies.suggestions.get(actor, input.submissionId, input.generationOperationId)
        : input.action === 'getAutomaticSuggestion'
          ? await dependencies.suggestions.getAutomatic(actor, input.submissionId)
          : await dependencies.suggestions.generate(actor, input.submissionId, input.operationId);
      const meta = createMeta(dependencies.clock, dependencies.requestIds);
      if (!result.ok) return failure(result.code, meta);
      if (result.value.status !== 'trial') return success<JsonObject>({ status: result.value.status }, meta);
      return success<JsonObject>({ id: result.value.id,
        submissionId: result.value.submissionId, submissionVersion: result.value.submissionVersion,
        modelVersion: result.value.modelVersion, promptVersion: result.value.promptVersion,
        text: result.value.text, generationNumber: result.value.generationNumber,
        remainingRegenerations: result.value.remainingRegenerations, status: result.value.status,
        requiresTeacherConfirmation: result.value.requiresTeacherConfirmation }, meta);
    });
}
