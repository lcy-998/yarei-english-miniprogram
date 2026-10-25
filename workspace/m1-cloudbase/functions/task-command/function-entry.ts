import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { TASK_COMMAND_ACTIONS, validateTaskCommandRequest } from '../../src/contracts/task-core-functions';
import type { JsonObject, ServiceResult } from '../../src/shared/protocol';
import type { SaveTaskDraftInput, UpdatePublishedTaskInput } from '../../src/task-core/types';
import { createMeta, failure, success } from '../../src/shared/result';
import { PrivateVideoError, type PrivateVideoDraftInput,
  type TeacherPrivateVideoService } from '../../src/teacher-media/private-video';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface TaskCommandHandler {
  saveTaskDraft(actor: TrustedActorContext, input: SaveTaskDraftInput, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  copyTaskSnapshot(actor: TrustedActorContext, sourceTaskId: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  instantiateTemplate(actor: TrustedActorContext, templateId: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  publishTask(actor: TrustedActorContext, taskId: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  updatePublishedTask(actor: TrustedActorContext, input: UpdatePublishedTaskInput, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  withdrawTask(actor: TrustedActorContext, taskId: string, reason: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  recycleTask(actor: TrustedActorContext, taskId: string, reason: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
  deleteDraftTask(actor: TrustedActorContext, taskId: string, reason: string, expectedVersion: number, operationId: string): Promise<ServiceResult<JsonObject>>;
}

export interface TaskCommandFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: TaskCommandHandler;
  readonly privateVideos?: Pick<TeacherPrivateVideoService, 'available' | 'list' | 'get' | 'save'
    | 'beginUpload' | 'seal' | 'retryProcessing' | 'publish' | 'withdraw'>;
}

export function createTaskCommandFunction(dependencies: TaskCommandFunctionDependencies) {
  return createTrustedFunction(
    'task-command',
    TASK_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof PrivateVideoError
      ? error.code : dependencies.mapFailure?.(phase, error)
        ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR') },
    validateTaskCommandRequest,
    async (input, actor) => {
      if (input.action === 'privateVideoAvailability' || input.action === 'privateVideoList'
        || input.action === 'privateVideoGet' || input.action === 'privateVideoSave'
        || input.action === 'privateVideoBeginUpload' || input.action === 'privateVideoSeal'
        || input.action === 'privateVideoRetryProcessing' || input.action === 'privateVideoPublish'
        || input.action === 'privateVideoWithdraw') {
        const videos = dependencies.privateVideos;
        if (!videos) return failure('SERVICE_UNAVAILABLE', createMeta(dependencies.clock, dependencies.requestIds));
        const data = input.action === 'privateVideoAvailability'
          ? { enabled: await videos.available(actor) }
          : input.action === 'privateVideoList' ? { items: await videos.list(actor) }
            : input.action === 'privateVideoGet' ? await videos.get(actor, input.id)
              : input.action === 'privateVideoSave' ? await videos.save(actor,
                { title: input.title,
                  questions: input.questions as unknown as PrivateVideoDraftInput['questions'] },
                input.id, input.expectedVersion, input.operationId)
                : input.action === 'privateVideoBeginUpload'
                  ? await videos.beginUpload(actor, input.id, input.expectedVersion)
                  : input.action === 'privateVideoSeal'
                    ? await videos.seal(actor, input.id, input.expectedVersion, input.stagingFileId)
                    : input.action === 'privateVideoRetryProcessing'
                      ? await videos.retryProcessing(actor, input.id, input.expectedVersion)
                      : input.action === 'privateVideoPublish'
                        ? await videos.publish(actor, input.id, input.expectedVersion)
                        : input.action === 'privateVideoWithdraw'
                          ? await videos.withdraw(actor, input.id, input.expectedVersion) : null;
        if (data === null) return failure('VALIDATION_ERROR',
          createMeta(dependencies.clock, dependencies.requestIds));
        return success(data as unknown as JsonObject,
          createMeta(dependencies.clock, dependencies.requestIds));
      }
      if (input.action === 'submitTeacherMediaReview' || input.action === 'decideTeacherMediaReview'
        || input.action === 'publishTeacherMedia') {
        // Media is supplied by the central asset library, never mutated through a teacher task command.
        return failure('FORBIDDEN', createMeta(dependencies.clock, dependencies.requestIds));
      }
      if (input.action === 'saveDraft') return dependencies.handler.saveTaskDraft(actor, input.input, input.expectedVersion, input.operationId);
      if (input.action === 'copyTaskSnapshot') return dependencies.handler.copyTaskSnapshot(actor, input.sourceTaskId, input.expectedVersion, input.operationId);
      if (input.action === 'instantiateTemplate') return dependencies.handler.instantiateTemplate(actor, input.templateId, input.expectedVersion, input.operationId);
      if (input.action === 'publishTask') return dependencies.handler.publishTask(actor, input.taskId, input.expectedVersion, input.operationId);
      if (input.action === 'updatePublishedTask') return dependencies.handler.updatePublishedTask(actor, input.input, input.expectedVersion, input.operationId);
      if (input.action === 'withdrawTask') return dependencies.handler.withdrawTask(actor, input.taskId, input.reason, input.expectedVersion, input.operationId);
      if (input.action === 'deleteDraftTask') return dependencies.handler.deleteDraftTask(actor, input.taskId, input.reason, input.expectedVersion, input.operationId);
      if (input.action === 'recycleTask') return dependencies.handler.recycleTask(actor, input.taskId, input.reason, input.expectedVersion, input.operationId);
      return failure('VALIDATION_ERROR', createMeta(dependencies.clock, dependencies.requestIds));
    },
  );
}
