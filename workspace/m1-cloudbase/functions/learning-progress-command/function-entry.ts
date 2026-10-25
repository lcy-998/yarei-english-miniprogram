import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { LEARNING_PROGRESS_COMMAND_ACTIONS, validateLearningProgressCommandRequest } from '../../src/contracts/learning-progress-functions';
import type { SaveReadingProgressInput, SaveVocabularyProgressInput } from '../../src/learning-progress/service';
import type { ReadingProgressView, VocabularyProgressView } from '../../src/learning-progress/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, failure, success } from '../../src/shared/result';
import type { TaskMediaPlaybackService, TaskMediaResult,
  TaskMediaHeartbeatView, TaskMediaPlaybackView } from '../../src/task-media/playback-service';
import { createLearningProgressFailureMapper } from '../shared/learning-progress-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export type LearningProgressCommandOutput = ReadingProgressView | VocabularyProgressView
  | TaskMediaPlaybackView | TaskMediaHeartbeatView;
export interface LearningProgressCommandHandler {
  saveReadingProgress(actor: TrustedActorContext, input: SaveReadingProgressInput): Promise<ReadingProgressView>;
  saveVocabularyProgress(actor: TrustedActorContext, input: SaveVocabularyProgressInput): Promise<VocabularyProgressView>;
}
export interface LearningProgressCommandFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: LearningProgressCommandHandler;
  readonly media?: Pick<TaskMediaPlaybackService, 'begin' | 'heartbeat'>;
}

export function createLearningProgressCommandFunction(dependencies: LearningProgressCommandFunctionDependencies) {
  return createTrustedFunction(
    'learning-progress-command', LEARNING_PROGRESS_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createLearningProgressFailureMapper(dependencies.mapFailure) },
    validateLearningProgressCommandRequest,
    async (input, actor): Promise<ServiceResult<LearningProgressCommandOutput>> => {
      if (input.action === 'beginTaskMediaSession' || input.action === 'reportTaskMediaHeartbeat') {
        if (!dependencies.media) return failure('SERVICE_UNAVAILABLE', createMeta(dependencies.clock, dependencies.requestIds));
        const result = input.action === 'beginTaskMediaSession'
          ? await dependencies.media.begin(actor, input.taskId, input.itemId, input.operationId)
          : await dependencies.media.heartbeat(actor, input);
        return mediaResult<TaskMediaPlaybackView | TaskMediaHeartbeatView>(result, dependencies);
      }
      return success(input.action === 'saveReadingProgress'
        ? await dependencies.handler.saveReadingProgress(actor, input)
        : await dependencies.handler.saveVocabularyProgress(actor, input),
      createMeta(dependencies.clock, dependencies.requestIds));
    },
  );
}

function mediaResult<T>(result: TaskMediaResult<T>,
  dependencies: TrustedFunctionDependencies): ServiceResult<T> {
  const meta = createMeta(dependencies.clock, dependencies.requestIds);
  if (result.ok) return success(result.data, meta);
  if (result.code === 'SEEK_FORWARD') return failure('VALIDATION_ERROR', meta,
    { playedFromMs: '禁止跳过尚未核验的播放区间。' });
  if (result.code === 'PLAYBACK_TOO_FAST') return failure('VALIDATION_ERROR', meta,
    { playedToMs: '播放进度超过服务端允许的连续速度。' });
  if (result.code === 'SESSION_EXPIRED') return failure('CONFLICT', meta,
    { sessionId: '播放会话已到期，请重新打开媒体。' });
  return failure(result.code, meta);
}

