import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { LEARNING_PROGRESS_COMMAND_ACTIONS, validateLearningProgressCommandRequest } from '../../src/contracts/learning-progress-functions';
import type { SaveReadingProgressInput, SaveVocabularyProgressInput } from '../../src/learning-progress/service';
import type { ReadingProgressView, VocabularyProgressView } from '../../src/learning-progress/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createLearningProgressFailureMapper } from '../shared/learning-progress-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export type LearningProgressCommandOutput = ReadingProgressView | VocabularyProgressView;
export interface LearningProgressCommandHandler {
  saveReadingProgress(actor: TrustedActorContext, input: SaveReadingProgressInput): Promise<ReadingProgressView>;
  saveVocabularyProgress(actor: TrustedActorContext, input: SaveVocabularyProgressInput): Promise<VocabularyProgressView>;
}
export interface LearningProgressCommandFunctionDependencies extends TrustedFunctionDependencies { readonly handler: LearningProgressCommandHandler; }

export function createLearningProgressCommandFunction(dependencies: LearningProgressCommandFunctionDependencies) {
  return createTrustedFunction(
    'learning-progress-command', LEARNING_PROGRESS_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createLearningProgressFailureMapper(dependencies.mapFailure) },
    validateLearningProgressCommandRequest,
    async (input, actor): Promise<ServiceResult<LearningProgressCommandOutput>> => success(
      input.action === 'saveReadingProgress'
        ? await dependencies.handler.saveReadingProgress(actor, input)
        : await dependencies.handler.saveVocabularyProgress(actor, input),
      createMeta(dependencies.clock, dependencies.requestIds),
    ),
  );
}

