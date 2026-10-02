import { TASK_RECORDING_COMMAND_ACTIONS, validateTaskRecordingCommandRequest } from '../../src/contracts/task-recording-functions';
import { TaskRecordingService } from '../../src/task-recording/service';
import { DocumentTaskRecordingRepository } from '../../src/task-recording/document-repository';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { CloudBaseTaskRecordingSeal } from '../../src/task-recording/cloudbase-seal';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createTaskRecordingCommandFunction } from './function-entry';

export { createTaskRecordingCommandFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('task-recording-command', TASK_RECORDING_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const result = validateTaskRecordingCommandRequest(request);
    return result.ok ? null : result.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('task-recording-command', unavailable,
  (capabilities, infrastructure) => createTaskRecordingCommandFunction({ ...infrastructure,
    service: new TaskRecordingService(new DocumentTaskRecordingRepository(infrastructure.documents),
      createTaskQueryDocumentRepository(infrastructure.documents), capabilities.identities,
      capabilities.recordingStorage && capabilities.environmentId
        ? new CloudBaseTaskRecordingSeal(capabilities.recordingStorage, capabilities.environmentId) : null,
      null, infrastructure.clock, capabilities.identifiers) }));
