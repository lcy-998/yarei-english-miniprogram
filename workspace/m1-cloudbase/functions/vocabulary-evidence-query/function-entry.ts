import { VOCABULARY_EVIDENCE_QUERY_ACTIONS, validateVocabularyEvidenceQueryRequest } from '../../src/contracts/vocabulary-evidence-functions';
import type { VocabularyEvidenceService } from '../../src/vocabulary-evidence/service';
import type { VocabularyAttemptState, VocabularyPackAttemptSummary } from '../../src/vocabulary-evidence/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createVocabularyEvidenceFailureMapper } from '../shared/vocabulary-evidence-failure';

export interface VocabularyEvidenceQueryDependencies extends TrustedFunctionDependencies {
  readonly service: VocabularyEvidenceService;
}

export function createVocabularyEvidenceQueryFunction(dependencies: VocabularyEvidenceQueryDependencies) {
  return createTrustedFunction('vocabulary-evidence-query', VOCABULARY_EVIDENCE_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createVocabularyEvidenceFailureMapper(dependencies.mapFailure) },
    validateVocabularyEvidenceQueryRequest,
    async (input, actor): Promise<ServiceResult<VocabularyAttemptState | VocabularyPackAttemptSummary>> => success(
      input.action === 'getPackAttemptSummary'
        ? await dependencies.service.getPackSummary(actor, input.input)
        : await dependencies.service.getState(actor, input.input),
      createMeta(dependencies.clock, dependencies.requestIds),
    ));
}
