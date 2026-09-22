import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { SUBMISSION_COMMAND_ACTIONS, validateSubmissionCommandRequest } from '../../src/contracts/task-core-functions';
import type { JsonObject, ServiceResult } from '../../src/shared/protocol';
import type { SubmissionAnswer } from '../../src/task-core/types';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface SubmissionCommandHandler {
  saveSubmissionDraft(actor: TrustedActorContext, taskId: string, answers: readonly SubmissionAnswer[], expectedAssignmentVersion: number, expectedDraftRecordVersion: number | undefined, operationId: string): Promise<ServiceResult<JsonObject>>;
  submit(actor: TrustedActorContext, taskId: string, answers: readonly SubmissionAnswer[], expectedAssignmentVersion: number, expectedDraftRecordVersion: number | undefined, operationId: string): Promise<ServiceResult<JsonObject>>;
}

export interface SubmissionCommandFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: SubmissionCommandHandler;
}

export function createSubmissionCommandFunction(dependencies: SubmissionCommandFunctionDependencies) {
  return createTrustedFunction(
    'submission-command',
    SUBMISSION_COMMAND_ACTIONS,
    dependencies,
    validateSubmissionCommandRequest,
    async (input, actor) => input.action === 'saveDraft'
      ? dependencies.handler.saveSubmissionDraft(actor, input.taskId, input.answers, input.expectedAssignmentVersion, input.expectedDraftRecordVersion, input.operationId)
      : dependencies.handler.submit(actor, input.taskId, input.answers, input.expectedAssignmentVersion, input.expectedDraftRecordVersion, input.operationId),
  );
}
