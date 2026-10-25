import { PRONUNCIATION_COMMAND_ACTIONS, validatePronunciationCommandRequest } from '../../src/contracts/pronunciation-functions';
import type { PronunciationService } from '../../src/pronunciation/service';
import type { PronunciationAsyncJobService } from '../../src/pronunciation/async-job-service';
import { PronunciationError } from '../../src/pronunciation/types';
import { createMeta, success } from '../../src/shared/result';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export function createPronunciationCommandFunction(dependencies: TrustedFunctionDependencies & {
  readonly service: PronunciationService;
  readonly jobs?: Pick<PronunciationAsyncJobService, 'accept'> }) {
  return createTrustedFunction('pronunciation-command', PRONUNCIATION_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) => error instanceof PronunciationError ? error.code
      : dependencies.mapFailure?.(phase, error) ?? (phase === 'runtime' ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR') },
    validatePronunciationCommandRequest,
    async (input, actor) => success(input.action === 'beginRecording'
      ? await dependencies.service.beginRecording(actor, input.source, input.operationId)
      : input.action === 'sealRecording'
        ? await dependencies.service.sealRecording(actor, input.recordingId, input.stagingFileId,
          input.expectedVersion, input.operationId)
        : dependencies.jobs
          ? await dependencies.jobs.accept(actor, input.recordingId, input.expectedVersion, input.operationId)
          : await dependencies.service.beginScore(actor, input.recordingId,
            input.expectedVersion, input.operationId),
    createMeta(dependencies.clock, dependencies.requestIds)));
}
