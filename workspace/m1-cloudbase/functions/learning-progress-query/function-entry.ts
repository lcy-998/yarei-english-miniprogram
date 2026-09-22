import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { LEARNING_PROGRESS_QUERY_ACTIONS, validateLearningProgressQueryRequest } from '../../src/contracts/learning-progress-functions';
import type { ReadingProgressView, VocabularyProgressView } from '../../src/learning-progress/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createLearningProgressFailureMapper } from '../shared/learning-progress-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export type LearningProgressQueryOutput = ReadingProgressView | VocabularyProgressView | null;
export interface LearningProgressQueryHandler {
  getReadingProgress(actor: TrustedActorContext, resourceId: string): Promise<ReadingProgressView | null>;
  getVocabularyProgress(actor: TrustedActorContext, packId: string): Promise<VocabularyProgressView | null>;
}
export interface LearningProgressQueryFunctionDependencies extends TrustedFunctionDependencies { readonly handler: LearningProgressQueryHandler; }

export function createLearningProgressQueryFunction(dependencies: LearningProgressQueryFunctionDependencies) {
  return createTrustedFunction(
    'learning-progress-query', LEARNING_PROGRESS_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createLearningProgressFailureMapper(dependencies.mapFailure) },
    validateLearningProgressQueryRequest,
    async (input, actor): Promise<ServiceResult<LearningProgressQueryOutput>> => success(
      input.action === 'getReadingProgress'
        ? await dependencies.handler.getReadingProgress(actor, input.resourceId)
        : await dependencies.handler.getVocabularyProgress(actor, input.packId),
      createMeta(dependencies.clock, dependencies.requestIds),
    ),
  );
}

