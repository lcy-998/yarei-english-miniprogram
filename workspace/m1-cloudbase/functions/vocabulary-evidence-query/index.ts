import { VOCABULARY_EVIDENCE_QUERY_ACTIONS, validateVocabularyEvidenceQueryRequest } from '../../src/contracts/vocabulary-evidence-functions';
import { DocumentVocabularyEvidenceRepository } from '../../src/vocabulary-evidence/document-repository';
import { VocabularyEvidenceService } from '../../src/vocabulary-evidence/service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createVocabularyEvidenceQueryFunction } from './function-entry';

export { createVocabularyEvidenceQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('vocabulary-evidence-query', VOCABULARY_EVIDENCE_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const result = validateVocabularyEvidenceQueryRequest(request);
    return result.ok ? null : result.fieldErrors;
  });

export const main = createDefaultCloudBaseFunction('vocabulary-evidence-query', unavailable,
  (capabilities, infrastructure) => createVocabularyEvidenceQueryFunction({ ...infrastructure,
    service: new VocabularyEvidenceService(new DocumentVocabularyEvidenceRepository(infrastructure.documents),
      infrastructure.clock, capabilities.identifiers) }));
