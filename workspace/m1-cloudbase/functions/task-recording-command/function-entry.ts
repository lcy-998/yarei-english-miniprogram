import { TASK_RECORDING_COMMAND_ACTIONS, validateTaskRecordingCommandRequest } from '../../src/contracts/task-recording-functions';
import type { TaskRecordingService } from '../../src/task-recording/service';
import { TaskRecordingError, type TaskRecordingRecord } from '../../src/task-recording/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { success, createMeta } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export function createTaskRecordingCommandFunction(dependencies: TrustedFunctionDependencies & { readonly service: TaskRecordingService }) {
  return createTrustedFunction('task-recording-command', TASK_RECORDING_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof TaskRecordingError ? error.code
      : dependencies.mapFailure?.(phase, error) ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR') },
    validateTaskRecordingCommandRequest,
    async (input, actor): Promise<ServiceResult<TaskRecordingRecord>> => success(
      input.action === 'begin'
        ? await dependencies.service.begin(actor, input.taskId, input.itemId, input.operationId)
        : await dependencies.service.submit(actor, input.recordingId, input.stagingFileId,
          input.expectedVersion, input.operationId),
      createMeta(dependencies.clock, dependencies.requestIds)));
}
