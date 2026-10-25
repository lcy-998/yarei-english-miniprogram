import { STUDENT_WORK_QUERY_ACTIONS, validateStudentWorkQueryRequest } from '../../src/contracts/student-work-functions';
import { DocumentStudentWorkRepository } from '../../src/student-work/document-repository';
import { StudentWorkService } from '../../src/student-work/service';
import { CloudBaseWorkPlayback } from '../../src/student-work/cloudbase-playback';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createStudentWorkQueryFunction } from './function-entry';
import { createTaskCoreDocumentRepository } from '../../src/repositories/task-core-document-adapter';
import { TaskDubbingWorkQueryService } from '../../src/task-media/dubbing-work-query';

export { createStudentWorkQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('student-work-query', STUDENT_WORK_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateStudentWorkQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });

export const main = createDefaultCloudBaseFunction('student-work-query', unavailable,
  (capabilities, infrastructure) => createStudentWorkQueryFunction({ ...infrastructure,
    taskDubbing: new TaskDubbingWorkQueryService(infrastructure.documents,
      createTaskCoreDocumentRepository(infrastructure.documents),
      capabilities.playbackStorage ? new CloudBaseWorkPlayback(capabilities.playbackStorage) : undefined,
      infrastructure.clock),
    service: new StudentWorkService(new DocumentStudentWorkRepository(infrastructure.documents), null,
      infrastructure.clock, capabilities.identifiers,
      capabilities.playbackStorage ? new CloudBaseWorkPlayback(capabilities.playbackStorage) : null) }));
