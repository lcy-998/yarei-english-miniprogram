import { VOCABULARY_EVIDENCE_COMMAND_ACTIONS, validateVocabularyEvidenceCommandRequest } from '../../src/contracts/vocabulary-evidence-functions';
import type { VocabularyEvidenceService } from '../../src/vocabulary-evidence/service';
import type { VocabularyAttemptView } from '../../src/vocabulary-evidence/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createVocabularyEvidenceFailureMapper } from '../shared/vocabulary-evidence-failure';

export interface VocabularyEvidenceCommandDependencies extends TrustedFunctionDependencies {
  readonly service: VocabularyEvidenceService;
}

export function createVocabularyEvidenceCommandFunction(dependencies: VocabularyEvidenceCommandDependencies) {
  return createTrustedFunction('vocabulary-evidence-command', VOCABULARY_EVIDENCE_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createVocabularyEvidenceFailureMapper(dependencies.mapFailure) },
    validateVocabularyEvidenceCommandRequest,
    async (input, actor): Promise<ServiceResult<VocabularyAttemptView>> => success(
      await dependencies.service.submit(actor, input.input, input.expectedVersion, input.operationId),
      createMeta(dependencies.clock, dependencies.requestIds),
    ));
}
