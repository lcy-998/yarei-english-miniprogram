import { TASK_RECORDING_QUERY_ACTIONS, validateTaskRecordingQueryRequest } from '../../src/contracts/task-recording-functions';
import { TaskRecordingService } from '../../src/task-recording/service';
import { TaskRecordingCatalogService } from '../../src/task-recording/catalog-service';
import { DocumentTaskRecordingRepository, DocumentTaskRecordingAccessAudit } from '../../src/task-recording/document-repository';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { CloudBaseWorkPlayback } from '../../src/student-work/cloudbase-playback';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createTaskRecordingQueryFunction } from './function-entry';

export { createTaskRecordingQueryFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('task-recording-query', TASK_RECORDING_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const result = validateTaskRecordingQueryRequest(request);
    return result.ok ? null : result.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('task-recording-query', unavailable,
  (capabilities, infrastructure) => createTaskRecordingQueryFunction({ ...infrastructure,
    catalog: new TaskRecordingCatalogService(infrastructure.documents,
      createTaskQueryDocumentRepository(infrastructure.documents)),
    service: new TaskRecordingService(new DocumentTaskRecordingRepository(infrastructure.documents),
      createTaskQueryDocumentRepository(infrastructure.documents), capabilities.identities,
      null, capabilities.playbackStorage ? new CloudBaseWorkPlayback(capabilities.playbackStorage) : null,
      infrastructure.clock, capabilities.identifiers, new DocumentTaskRecordingAccessAudit(infrastructure.documents)) }));
