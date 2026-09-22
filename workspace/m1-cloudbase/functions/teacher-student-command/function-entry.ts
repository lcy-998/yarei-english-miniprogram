import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import {
  TEACHER_STUDENT_COMMAND_ACTIONS,
  validateTeacherStudentCommandRequest,
} from '../../src/contracts/teacher-student-functions';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import type {
  SetTeacherStudentStatusCommand,
  TeacherStudentMutationReceipt,
  TeacherStudentTransferReceipt,
  TransferTeacherStudentCommand,
  UpdateTeacherStudentProfileCommand,
} from '../../src/teacher-students/types';
import { createOrgContentFailureMapper } from '../shared/org-content-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export type TeacherStudentCommandOutput = TeacherStudentMutationReceipt | TeacherStudentTransferReceipt;

export interface TeacherStudentCommandHandler {
  updateProfile(
    actor: TrustedActorContext,
    command: UpdateTeacherStudentProfileCommand,
  ): Promise<TeacherStudentMutationReceipt>;
  setStatus(
    actor: TrustedActorContext,
    command: SetTeacherStudentStatusCommand,
  ): Promise<TeacherStudentMutationReceipt>;
  transfer(
    actor: TrustedActorContext,
    command: TransferTeacherStudentCommand,
  ): Promise<TeacherStudentTransferReceipt>;
}

export interface TeacherStudentCommandFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: TeacherStudentCommandHandler;
}

export function createTeacherStudentCommandFunction(
  dependencies: TeacherStudentCommandFunctionDependencies,
) {
  return createTrustedFunction(
    'teacher-student-command',
    TEACHER_STUDENT_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createOrgContentFailureMapper(dependencies.mapFailure) },
    validateTeacherStudentCommandRequest,
    async (input, actor): Promise<ServiceResult<TeacherStudentCommandOutput>> => {
      const data = input.action === 'updateProfile'
        ? await dependencies.handler.updateProfile(actor, input.command)
        : input.action === 'setStatus'
          ? await dependencies.handler.setStatus(actor, input.command)
          : await dependencies.handler.transfer(actor, input.command);
      return success(data, createMeta(dependencies.clock, dependencies.requestIds));
    },
  );
}
