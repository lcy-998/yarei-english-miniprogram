import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { TASK_COMMAND_ACTIONS, validateTaskCommandRequest } from '../../src/contracts/task-core-functions';
import { createDefaultCloudBaseTaskCoreFunction } from '../shared/default-cloudbase-function';
import { createTaskCommandFunction } from './function-entry';
import { TeacherPrivateVideoService } from '../../src/teacher-media/private-video';
import { DirectMp4PrivateVideoProcessor } from '../../src/teacher-media/direct-mp4-processor';
import { createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';

export { createTaskCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('task-command', TASK_COMMAND_ACTIONS, (_action, _payload, request) => {
  const validated = validateTaskCommandRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseTaskCoreFunction(
  'task-command',
  unavailable,
  (capabilities, infrastructure) => createTaskCommandFunction({ ...infrastructure,
    privateVideos: new TeacherPrivateVideoService(infrastructure.documents,
      capabilities.recordingStorage && capabilities.environmentId
        ? new DirectMp4PrivateVideoProcessor(capabilities.recordingStorage,
          capabilities.environmentId) : null,
      infrastructure.clock, createOrgContentDocumentRepository(infrastructure.documents),
      capabilities.playbackStorage),
  }),
);
