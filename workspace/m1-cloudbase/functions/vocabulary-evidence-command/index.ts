import { VOCABULARY_EVIDENCE_COMMAND_ACTIONS, validateVocabularyEvidenceCommandRequest } from '../../src/contracts/vocabulary-evidence-functions';
import { DocumentVocabularyEvidenceRepository } from '../../src/vocabulary-evidence/document-repository';
import { VocabularyEvidenceService } from '../../src/vocabulary-evidence/service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createVocabularyEvidenceCommandFunction } from './function-entry';

export { createVocabularyEvidenceCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('vocabulary-evidence-command', VOCABULARY_EVIDENCE_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const result = validateVocabularyEvidenceCommandRequest(request);
    return result.ok ? null : result.fieldErrors;
  });

export const main = createDefaultCloudBaseFunction('vocabulary-evidence-command', unavailable,
  (capabilities, infrastructure) => createVocabularyEvidenceCommandFunction({ ...infrastructure,
    service: new VocabularyEvidenceService(new DocumentVocabularyEvidenceRepository(infrastructure.documents),
      infrastructure.clock, capabilities.identifiers) }));
