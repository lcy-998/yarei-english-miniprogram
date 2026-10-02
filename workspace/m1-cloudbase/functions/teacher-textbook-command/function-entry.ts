import { TEACHER_TEXTBOOK_COMMAND_ACTIONS, validateTeacherTextbookCommandRequest } from '../../src/contracts/teacher-textbook-functions';
import type { TeacherTextbookService } from '../../src/textbook/service';
import type { ClassTextbookConfig } from '../../src/textbook/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { createTeacherTextbookFailureMapper } from '../shared/teacher-textbook-failure';

export interface TeacherTextbookCommandDependencies extends TrustedFunctionDependencies { readonly service: TeacherTextbookService }
export function createTeacherTextbookCommandFunction(dependencies: TeacherTextbookCommandDependencies) {
  return createTrustedFunction('teacher-textbook-command', TEACHER_TEXTBOOK_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createTeacherTextbookFailureMapper(dependencies.mapFailure) },
    validateTeacherTextbookCommandRequest,
    async (input, actor): Promise<ServiceResult<ClassTextbookConfig>> => success(
      await dependencies.service.save(actor, input.input, input.expectedVersion, input.operationId,
        input.action === 'publishClassTextbooks'),
      createMeta(dependencies.clock, dependencies.requestIds),
    ));
}
