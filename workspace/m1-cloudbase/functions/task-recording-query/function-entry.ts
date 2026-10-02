import { TASK_RECORDING_QUERY_ACTIONS, validateTaskRecordingQueryRequest } from '../../src/contracts/task-recording-functions';
import type { TaskRecordingService } from '../../src/task-recording/service';
import type { TaskRecordingCatalogService, RecordingPromptPage, RecordingPromptView } from '../../src/task-recording/catalog-service';
import type { TaskRecordingRecord } from '../../src/task-recording/types';
import { TaskRecordingError } from '../../src/task-recording/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { success, createMeta } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export function createTaskRecordingQueryFunction(dependencies: TrustedFunctionDependencies & {
  readonly service: TaskRecordingService; readonly catalog: TaskRecordingCatalogService }) {
  return createTrustedFunction('task-recording-query', TASK_RECORDING_QUERY_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof TaskRecordingError ? error.code
      : dependencies.mapFailure?.(phase, error) ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR') },
    validateTaskRecordingQueryRequest,
    async (input, actor): Promise<ServiceResult<readonly TaskRecordingRecord[] | RecordingPromptPage
      | RecordingPromptView | Readonly<{ recordingId: string; temporaryUrl: string; expiresAt: string }>
      | Readonly<{ recordingId: string; mediaDeletedAt: string | null; mediaExpired: boolean }>>> => {
      const data = input.action === 'listRound'
        ? await dependencies.service.listMyRound(actor, input.taskId, input.itemId)
        : input.action === 'getPlayback'
          ? await dependencies.service.temporaryPlayback(actor, input.recordingId)
          : input.action === 'getMediaState'
            ? await dependencies.service.getMediaState(actor, input.recordingId)
          : input.action === 'listPrompts'
            ? await dependencies.catalog.list(actor, { targetClassIds: input.targetClassIds,
              ...(input.keyword === undefined ? {} : { keyword: input.keyword }), ...input.page })
            : await dependencies.catalog.get(actor, input.promptId, input.targetClassIds);
      return success(data, createMeta(dependencies.clock, dependencies.requestIds));
    });
}
