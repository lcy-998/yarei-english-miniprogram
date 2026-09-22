import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { CONTENT_QUERY_ACTIONS, validateContentQueryRequest } from '../../src/contracts/org-content-functions';
import type {
  ReadingListItemView,
  ReadingResourceView,
  VocabularyPackView,
} from '../../src/org-content/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createOrgContentFailureMapper } from '../shared/org-content-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export type ContentQueryOutput =
  | readonly ReadingListItemView[]
  | ReadingResourceView
  | readonly VocabularyPackView[]
  | VocabularyPackView;

export interface ContentQueryHandler {
  listReadingResources(actor: TrustedActorContext): Promise<readonly ReadingListItemView[]>;
  getReadingResource(actor: TrustedActorContext, resourceId: string): Promise<ReadingResourceView>;
  listVocabularyPacks(actor: TrustedActorContext): Promise<readonly VocabularyPackView[]>;
  getVocabularyPack(actor: TrustedActorContext, resourceId: string): Promise<VocabularyPackView>;
}

export interface ContentQueryFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: ContentQueryHandler;
}

export function createContentQueryFunction(dependencies: ContentQueryFunctionDependencies) {
  return createTrustedFunction(
    'content-query',
    CONTENT_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createOrgContentFailureMapper(dependencies.mapFailure) },
    validateContentQueryRequest,
    async (input, actor): Promise<ServiceResult<ContentQueryOutput>> => {
      switch (input.action) {
        case 'listReadingResources':
          return success(
            await dependencies.handler.listReadingResources(actor),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'getReadingResource':
          return success(
            await dependencies.handler.getReadingResource(actor, input.resourceId),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'listVocabularyPacks':
          return success(
            await dependencies.handler.listVocabularyPacks(actor),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'getVocabularyPack':
          return success(
            await dependencies.handler.getVocabularyPack(actor, input.resourceId),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
      }
    },
  );
}
