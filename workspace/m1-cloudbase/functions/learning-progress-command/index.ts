import { LEARNING_PROGRESS_COMMAND_ACTIONS, validateLearningProgressCommandRequest } from '../../src/contracts/learning-progress-functions';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createDefaultCloudBaseLearningProgressFunction } from '../shared/default-cloudbase-function';
import { CloudBaseWorkPlayback } from '../../src/student-work/cloudbase-playback';
import { createTaskCoreDocumentRepository } from '../../src/repositories/task-core-document-adapter';
import { DocumentTaskMediaPlaybackPort } from '../../src/task-media/document-playback-port';
import { TaskMediaPlaybackService } from '../../src/task-media/playback-service';
import { createLearningProgressCommandFunction } from './function-entry';
export { createLearningProgressCommandFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('learning-progress-command', LEARNING_PROGRESS_COMMAND_ACTIONS, (_action, _payload, request) => {
  const validated = validateLearningProgressCommandRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseLearningProgressFunction(
  'learning-progress-command',
  unavailable,
  (capabilities, infrastructure) => createLearningProgressCommandFunction({
    ...infrastructure,
    handler: infrastructure.handler,
    ...(capabilities.playbackStorage === undefined ? {} : { media: new TaskMediaPlaybackService(
      new DocumentTaskMediaPlaybackPort(createTaskCoreDocumentRepository(infrastructure.documents),
        infrastructure.documents, new CloudBaseWorkPlayback(capabilities.playbackStorage),
        infrastructure.clock), infrastructure.clock) }),
  }),
);
