import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { TASK_COMMAND_ACTIONS, validateTaskCommandRequest } from '../../src/contracts/task-core-functions';
import type { JsonObject, ServiceResult } from '../../src/shared/protocol';
import type { SaveTaskDraftInput, UpdatePublishedTaskInput } from '../../src/task-core/types';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface TaskCommandHandler {
  saveTaskDraft(actor: TrustedActorContext, input: SaveTaskDraftInput, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  copyTaskSnapshot(actor: TrustedActorContext, sourceTaskId: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  instantiateTemplate(actor: TrustedActorContext, templateId: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  publishTask(actor: TrustedActorContext, taskId: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  updatePublishedTask(actor: TrustedActorContext, input: UpdatePublishedTaskInput, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  withdrawTask(actor: TrustedActorContext, taskId: string, reason: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  recycleTask(actor: TrustedActorContext, taskId: string, reason: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
}

export interface TaskCommandFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: TaskCommandHandler;
}

export function createTaskCommandFunction(dependencies: TaskCommandFunctionDependencies) {
  return createTrustedFunction(
    'task-command',
    TASK_COMMAND_ACTIONS,
    dependencies,
    validateTaskCommandRequest,
    async (input, actor) => {
      if (input.action === 'saveDraft') return dependencies.handler.saveTaskDraft(actor, input.input, input.expectedVersion, input.operationId);
      if (input.action === 'copyTaskSnapshot') return dependencies.handler.copyTaskSnapshot(actor, input.sourceTaskId, input.expectedVersion, input.operationId);
      if (input.action === 'instantiateTemplate') return dependencies.handler.instantiateTemplate(actor, input.templateId, input.expectedVersion, input.operationId);
      if (input.action === 'publishTask') return dependencies.handler.publishTask(actor, input.taskId, input.expectedVersion, input.operationId);
      if (input.action === 'updatePublishedTask') return dependencies.handler.updatePublishedTask(actor, input.input, input.expectedVersion, input.operationId);
      if (input.action === 'withdrawTask') return dependencies.handler.withdrawTask(actor, input.taskId, input.reason, input.expectedVersion, input.operationId);
      return dependencies.handler.recycleTask(actor, input.taskId, input.reason, input.expectedVersion, input.operationId);
    },
  );
}
