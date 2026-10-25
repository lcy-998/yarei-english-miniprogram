import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { STUDENT_TASK_QUERY_ACTIONS, validateStudentTaskQueryRequest } from '../../src/contracts/task-query-functions';
import { createDefaultCloudBaseTaskQueryFunction } from '../shared/default-cloudbase-function';
import { createStudentTaskQueryFunction } from './function-entry';
import { CloudBaseWorkPlayback } from '../../src/student-work/cloudbase-playback';
import { createTaskCoreDocumentRepository } from '../../src/repositories/task-core-document-adapter';
import { DocumentTaskMediaPlaybackPort } from '../../src/task-media/document-playback-port';
import { TaskMediaPlaybackService } from '../../src/task-media/playback-service';
import { SubmittedTaskMediaPlaybackService } from '../../src/task-media/submitted-playback-service';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';

export { createStudentTaskQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'student-task-query',
  STUDENT_TASK_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateStudentTaskQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseTaskQueryFunction(
  'student-task-query',
  unavailable,
  (capabilities, infrastructure) => createStudentTaskQueryFunction({
    ...infrastructure,
    handler: infrastructure.studentTaskHandler,
    ...(capabilities.playbackStorage === undefined ? {} : {
      media: new TaskMediaPlaybackService(
        new DocumentTaskMediaPlaybackPort(createTaskCoreDocumentRepository(infrastructure.documents),
          infrastructure.documents, new CloudBaseWorkPlayback(capabilities.playbackStorage),
          infrastructure.clock), infrastructure.clock),
      submittedMedia: new SubmittedTaskMediaPlaybackService(
        createTaskQueryDocumentRepository(infrastructure.documents), infrastructure.documents,
        new CloudBaseWorkPlayback(capabilities.playbackStorage), infrastructure.clock),
    }),
  }),
);
