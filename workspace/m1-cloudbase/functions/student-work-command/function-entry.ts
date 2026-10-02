import { STUDENT_WORK_COMMAND_ACTIONS, validateStudentWorkCommandRequest } from '../../src/contracts/student-work-functions';
import type { StudentWorkService } from '../../src/student-work/service';
import type { StudentWork } from '../../src/student-work/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createStudentWorkFailureMapper } from '../shared/student-work-failure';

export interface StudentWorkCommandDependencies extends TrustedFunctionDependencies {
  readonly service: StudentWorkService;
}
export function createStudentWorkCommandFunction(dependencies: StudentWorkCommandDependencies) {
  return createTrustedFunction('student-work-command', STUDENT_WORK_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createStudentWorkFailureMapper(dependencies.mapFailure) },
    validateStudentWorkCommandRequest,
    async (input, actor): Promise<ServiceResult<StudentWork>> => {
      const result = input.action === 'beginDraft'
        ? await dependencies.service.beginDraft(actor, input.materialId, input.operationId)
        : input.action === 'deleteDraft'
          ? await dependencies.service.deleteDraft(actor, input.workId, input.expectedVersion, input.operationId)
          : await dependencies.service.submit(actor, { workId: input.workId,
            stagingFileId: input.stagingFileId, note: input.note }, input.expectedVersion, input.operationId);
      return success(result, createMeta(dependencies.clock, dependencies.requestIds));
    });
}
