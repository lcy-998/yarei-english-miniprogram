import { STUDENT_WORK_COMMAND_ACTIONS, validateStudentWorkCommandRequest } from '../../src/contracts/student-work-functions';
import type { StudentWorkService } from '../../src/student-work/service';
import type { StudentWork } from '../../src/student-work/types';
import type { TaskDubbingWorkService, TaskDubbingWorkView,
  TaskDubbingResult } from '../../src/task-media/dubbing-work-service';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, failure, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createStudentWorkFailureMapper } from '../shared/student-work-failure';

export interface StudentWorkCommandDependencies extends TrustedFunctionDependencies {
  readonly service: StudentWorkService;
  readonly taskDubbing?: Pick<TaskDubbingWorkService, 'begin' | 'seal'>;
}
export function createStudentWorkCommandFunction(dependencies: StudentWorkCommandDependencies) {
  return createTrustedFunction('student-work-command', STUDENT_WORK_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createStudentWorkFailureMapper(dependencies.mapFailure) },
    validateStudentWorkCommandRequest,
    async (input, actor): Promise<ServiceResult<StudentWork | TaskDubbingWorkView>> => {
      if (input.action === 'beginTaskDubbingWork' || input.action === 'sealTaskDubbingWork') {
        if (!dependencies.taskDubbing) return failure('SERVICE_UNAVAILABLE',
          createMeta(dependencies.clock, dependencies.requestIds));
        const taskResult = input.action === 'beginTaskDubbingWork'
          ? await dependencies.taskDubbing.begin(actor, input.taskId, input.itemId, input.operationId)
          : await dependencies.taskDubbing.seal(actor, input.workId, input.stagingFileId,
            input.expectedVersion, input.operationId);
        return taskDubbingResult(taskResult, dependencies);
      }
      const result = input.action === 'beginDraft'
        ? await dependencies.service.beginDraft(actor, input.materialId, input.operationId)
        : input.action === 'deleteDraft'
          ? await dependencies.service.deleteDraft(actor, input.workId, input.expectedVersion, input.operationId)
          : await dependencies.service.submit(actor, { workId: input.workId,
            stagingFileId: input.stagingFileId, note: input.note }, input.expectedVersion, input.operationId);
      return success(result, createMeta(dependencies.clock, dependencies.requestIds));
    });
}

function taskDubbingResult(result: TaskDubbingResult,
  dependencies: TrustedFunctionDependencies): ServiceResult<TaskDubbingWorkView> {
  const meta = createMeta(dependencies.clock, dependencies.requestIds);
  return result.ok ? success(result.data, meta) : failure(result.code, meta);
}
