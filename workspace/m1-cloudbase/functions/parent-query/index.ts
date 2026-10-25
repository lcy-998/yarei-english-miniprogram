import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { PARENT_QUERY_ACTIONS, validateParentQueryRequest } from '../../src/contracts/task-core-functions';
import { createDefaultCloudBaseTaskQueryFunction } from '../shared/default-cloudbase-function';
import { createParentQueryFunction } from './function-entry';
import { ParentMediaPlaybackService } from '../../src/task-query/parent-media-playback';
import { DocumentParentPlaybackAudit } from '../../src/task-query/parent-playback-audit';
import { DocumentTaskRecordingRepository } from '../../src/task-recording/document-repository';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { CloudBaseWorkPlayback } from '../../src/student-work/cloudbase-playback';
import { ParentFeedbackVoiceService } from '../../src/task-query/parent-feedback-voice';
import { DocumentParentFeedbackVoiceAudit } from '../../src/task-query/parent-playback-audit';
import { ParentTaskMediaPlaybackService } from '../../src/task-query/parent-task-media-playback';
import { DocumentParentTaskMediaAudit } from '../../src/task-query/parent-playback-audit';
import { DocumentTaskDubbingWorkPort } from '../../src/task-media/document-work-port';

export { createParentQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('parent-query', PARENT_QUERY_ACTIONS, (_action, _payload, request) => {
  const validated = validateParentQueryRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseTaskQueryFunction(
  'parent-query',
  unavailable,
  (capabilities, infrastructure) => createParentQueryFunction({
    ...infrastructure,
    handler: infrastructure.parentHandler,
    mediaPlayback: new ParentMediaPlaybackService(
      createTaskQueryDocumentRepository(infrastructure.documents),
      new DocumentTaskRecordingRepository(infrastructure.documents), capabilities.identities,
      capabilities.playbackStorage ? new CloudBaseWorkPlayback(capabilities.playbackStorage) : null,
      new DocumentParentPlaybackAudit(infrastructure.documents), infrastructure.clock),
    feedbackVoice: new ParentFeedbackVoiceService(
      createTaskQueryDocumentRepository(infrastructure.documents), capabilities.identities,
      capabilities.playbackStorage ? new CloudBaseWorkPlayback(capabilities.playbackStorage) : null,
      new DocumentParentFeedbackVoiceAudit(infrastructure.documents), infrastructure.clock),
    taskMediaPlayback: new ParentTaskMediaPlaybackService(
      createTaskQueryDocumentRepository(infrastructure.documents), capabilities.identities,
      capabilities.playbackStorage ? new CloudBaseWorkPlayback(capabilities.playbackStorage) : null,
      new DocumentParentTaskMediaAudit(infrastructure.documents), infrastructure.clock,
      new DocumentTaskDubbingWorkPort(infrastructure.documents)),
  }),
);
