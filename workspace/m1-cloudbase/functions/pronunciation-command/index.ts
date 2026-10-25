import { PRONUNCIATION_COMMAND_ACTIONS, validatePronunciationCommandRequest } from '../../src/contracts/pronunciation-functions';
import { createLearningProgressDocumentRepository } from '../../src/repositories/learning-progress-document-adapter';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { CloudBasePronunciationPlayback, CloudBasePronunciationSeal } from '../../src/pronunciation/cloudbase-adapters';
import { DocumentPronunciationRepository } from '../../src/pronunciation/document-repository';
import { PronunciationService } from '../../src/pronunciation/service';
import { DocumentPronunciationSource } from '../../src/pronunciation/source-adapter';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createPronunciationCommandFunction } from './function-entry';

export { createPronunciationCommandFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('pronunciation-command', PRONUNCIATION_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const result = validatePronunciationCommandRequest(request);
    return result.ok ? null : result.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('pronunciation-command', unavailable,
  (capabilities, infrastructure) => {
    if (!capabilities.documents) throw new Error('Document store unavailable');
    const playback = capabilities.playbackStorage
      ? new CloudBasePronunciationPlayback(capabilities.playbackStorage) : null;
    return createPronunciationCommandFunction({ ...infrastructure,
      service: new PronunciationService(new DocumentPronunciationRepository(capabilities.documents),
        new DocumentPronunciationSource(createTaskQueryDocumentRepository(capabilities.documents),
          createLearningProgressDocumentRepository(capabilities.documents), capabilities.documents,
          capabilities.identities, infrastructure.clock),
        capabilities.recordingStorage && capabilities.environmentId
          ? new CloudBasePronunciationSeal(capabilities.recordingStorage, capabilities.environmentId) : null,
        null, // The old synchronous inference path stays fail-closed until the async worker is reviewed.
        playback, infrastructure.clock, capabilities.identifiers),
      ...(capabilities.pronunciationJobs ? { jobs: capabilities.pronunciationJobs } : {}) });
  });
