import { PRONUNCIATION_QUERY_ACTIONS, validatePronunciationQueryRequest } from '../../src/contracts/pronunciation-functions';
import type { PronunciationService } from '../../src/pronunciation/service';
import { PronunciationError } from '../../src/pronunciation/types';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export function createPronunciationQueryFunction(dependencies: TrustedFunctionDependencies & {
  readonly service: PronunciationService }) {
  return createTrustedFunction('pronunciation-query', PRONUNCIATION_QUERY_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof PronunciationError ? error.code
      : dependencies.mapFailure?.(phase, error) ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR') },
    validatePronunciationQueryRequest,
    async (input, actor) => success(input.action === 'getScore'
      ? await dependencies.service.getScore(actor, input.scoreId)
      : input.action === 'listAttempts'
        ? await dependencies.service.listAttempts(actor, input.source)
        : input.action === 'listMyWorks'
          ? await dependencies.service.listMyWorks(actor, input)
        : input.action === 'getMyPlayback'
          ? await dependencies.service.getMyPlayback(actor, input.recordingId)
        : input.action === 'getParentEvidence'
          ? await dependencies.service.getParentEvidence(actor, input)
        : input.action === 'listParentEvidence'
          ? await dependencies.service.listParentEvidence(actor, input)
        : await dependencies.service.getTeacherEvidence(actor, input),
    createMeta(dependencies.clock, dependencies.requestIds)));
}
