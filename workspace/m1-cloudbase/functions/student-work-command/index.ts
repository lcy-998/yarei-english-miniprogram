import { STUDENT_WORK_COMMAND_ACTIONS, validateStudentWorkCommandRequest } from '../../src/contracts/student-work-functions';
import { CloudBaseRecordingSeal } from '../../src/student-work/cloudbase-recording-seal';
import { DocumentStudentWorkRepository } from '../../src/student-work/document-repository';
import { StudentWorkService } from '../../src/student-work/service';
import { CloudBaseWorkPlayback } from '../../src/student-work/cloudbase-playback';
import { createTaskCoreDocumentRepository } from '../../src/repositories/task-core-document-adapter';
import { DocumentTaskMediaPlaybackPort } from '../../src/task-media/document-playback-port';
import { DocumentTaskDubbingCommandPort } from '../../src/task-media/document-dubbing-command-port';
import { CloudBaseTaskDubbingSeal } from '../../src/task-media/cloudbase-dubbing-seal';
import { TaskDubbingWorkService } from '../../src/task-media/dubbing-work-service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createStudentWorkCommandFunction } from './function-entry';

export { createStudentWorkCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('student-work-command', STUDENT_WORK_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateStudentWorkCommandRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });

export const main = createDefaultCloudBaseFunction('student-work-command', unavailable,
  (capabilities, infrastructure) => {
    if (!capabilities.recordingStorage || !capabilities.environmentId
      || !capabilities.playbackStorage) throw new Error('Storage unavailable');
    const taskMedia = new DocumentTaskMediaPlaybackPort(
      createTaskCoreDocumentRepository(infrastructure.documents), infrastructure.documents,
      new CloudBaseWorkPlayback(capabilities.playbackStorage), infrastructure.clock);
    return createStudentWorkCommandFunction({ ...infrastructure,
      service: new StudentWorkService(new DocumentStudentWorkRepository(infrastructure.documents),
        new CloudBaseRecordingSeal(capabilities.recordingStorage, capabilities.environmentId),
        infrastructure.clock, capabilities.identifiers),
      taskDubbing: new TaskDubbingWorkService(new DocumentTaskDubbingCommandPort(
        infrastructure.documents, taskMedia,
        new CloudBaseTaskDubbingSeal(capabilities.recordingStorage, capabilities.environmentId)),
      infrastructure.clock) });
  });
