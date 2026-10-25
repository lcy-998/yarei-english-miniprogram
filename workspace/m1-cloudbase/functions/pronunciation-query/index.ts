import { PRONUNCIATION_QUERY_ACTIONS, validatePronunciationQueryRequest } from '../../src/contracts/pronunciation-functions';
import { createLearningProgressDocumentRepository } from '../../src/repositories/learning-progress-document-adapter';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { CloudBasePronunciationPlayback } from '../../src/pronunciation/cloudbase-adapters';
import { DocumentPronunciationRepository } from '../../src/pronunciation/document-repository';
import { TaskPronunciationSubmissionLookup } from '../../src/media-retention/pronunciation-submission-lookup';
import { PronunciationService } from '../../src/pronunciation/service';
import { DocumentPronunciationSource } from '../../src/pronunciation/source-adapter';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createPronunciationQueryFunction } from './function-entry';

export { createPronunciationQueryFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('pronunciation-query', PRONUNCIATION_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const result = validatePronunciationQueryRequest(request);
    return result.ok ? null : result.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('pronunciation-query', unavailable,
  (capabilities, infrastructure) => {
    if (!capabilities.documents) throw new Error('Document store unavailable');
    return createPronunciationQueryFunction({ ...infrastructure,
      service: new PronunciationService(new DocumentPronunciationRepository(capabilities.documents),
        new DocumentPronunciationSource(createTaskQueryDocumentRepository(capabilities.documents),
          createLearningProgressDocumentRepository(capabilities.documents), capabilities.documents,
          capabilities.identities, infrastructure.clock),
        null, null, capabilities.playbackStorage
          ? new CloudBasePronunciationPlayback(capabilities.playbackStorage) : null,
        infrastructure.clock, capabilities.identifiers,
        new TaskPronunciationSubmissionLookup(createTaskQueryDocumentRepository(capabilities.documents))) });
  });
