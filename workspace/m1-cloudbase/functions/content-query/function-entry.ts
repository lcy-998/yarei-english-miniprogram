import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { CONTENT_QUERY_ACTIONS, validateContentQueryRequest } from '../../src/contracts/org-content-functions';
import { OrgContentError } from '../../src/org-content/types';
import type {
  ReadingListItemView,
  ReadingResourceView,
  StudentClassView,
  SchoolQuestionDetailView,
  SchoolQuestionFilters,
  SchoolQuestionFacet,
  SchoolQuestionPageView,
  TaskCatalogFilters,
  TaskCatalogPageView,
  TaskCatalogListItemView,
  TaskCatalogFacet,
  StudentCatalogFilters,
  StudentCatalogPageView,
  StudentCatalogFacetView,
  VocabularyPackView,
} from '../../src/org-content/types';
import type { ServiceResult } from '../../src/shared/protocol';
import type { CloudBasePlaybackSdkPort } from '../../src/student-work/cloudbase-playback';
import { createMeta, success } from '../../src/shared/result';
import { createOrgContentFailureMapper } from '../shared/org-content-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export type ContentQueryOutput =
  | readonly ReadingListItemView[]
  | ReadingResourceView
  | readonly VocabularyPackView[]
  | VocabularyPackView
  | StudentClassView
  | SchoolQuestionPageView
  | readonly SchoolQuestionFacet[]
  | SchoolQuestionDetailView
  | TaskCatalogPageView
  | TaskCatalogListItemView
  | readonly TaskCatalogFacet[]
  | StudentCatalogPageView
  | readonly StudentCatalogFacetView[];

export interface ContentQueryHandler {
  getMyClass(actor: TrustedActorContext): Promise<StudentClassView>;
  listSchoolQuestions(actor: TrustedActorContext, filters: SchoolQuestionFilters, page: Readonly<{ limit: number; offset: number }>): Promise<SchoolQuestionPageView>;
  listSchoolQuestionFacets(actor: TrustedActorContext, targetClassIds?: readonly string[]): Promise<readonly SchoolQuestionFacet[]>;
  getSchoolQuestion(actor: TrustedActorContext, resourceId: string, targetClassIds?: readonly string[]): Promise<SchoolQuestionDetailView>;
  listTaskCatalogResources(actor: TrustedActorContext, filters: TaskCatalogFilters, page: Readonly<{ limit: number; offset: number }>): Promise<TaskCatalogPageView>;
  listTaskCatalogFacets(actor: TrustedActorContext, type: TaskCatalogFilters['type'], targetClassIds?: readonly string[]): Promise<readonly TaskCatalogFacet[]>;
  getTaskCatalogResource(actor: TrustedActorContext, resourceId: string, targetClassIds?: readonly string[]): Promise<TaskCatalogListItemView>;
  listStudentCatalog(actor: TrustedActorContext, filters: StudentCatalogFilters, page: Readonly<{ limit: number; offset: number }>): Promise<StudentCatalogPageView>;
  listStudentCatalogFacets(actor: TrustedActorContext, type: StudentCatalogFilters['type'], category?: StudentCatalogFilters['category']): Promise<readonly StudentCatalogFacetView[]>;
  listReadingResources(actor: TrustedActorContext): Promise<readonly ReadingListItemView[]>;
  getReadingResource(actor: TrustedActorContext, resourceId: string): Promise<ReadingResourceView>;
  listVocabularyPacks(actor: TrustedActorContext): Promise<readonly VocabularyPackView[]>;
  getVocabularyPack(actor: TrustedActorContext, resourceId: string): Promise<VocabularyPackView>;
}

export interface ContentQueryFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: ContentQueryHandler;
  readonly readingMediaStorage?: CloudBasePlaybackSdkPort;
}

async function signedReadingPages(view: ReadingResourceView,
  storage: CloudBasePlaybackSdkPort | undefined): Promise<ReadingResourceView> {
  const ids = [...new Set(view.chapters.flatMap(chapter => chapter.pages.flatMap(page => [
    page.imageAssetKey, page.thumbnailAssetKey,
  ])).filter(key => key.startsWith('cloud://')))];
  if (ids.length === 0) return view;
  if (!storage) throw new OrgContentError('SERVICE_UNAVAILABLE');
  const urls = new Map<string, string>();
  try {
    for (let offset = 0; offset < ids.length; offset += 40) {
      const batch = ids.slice(offset, offset + 40);
      const result = await storage.getTempFileURL({
        fileList: batch.map(fileID => ({ fileID, maxAge: 3600 })),
      });
      for (const fileID of batch) {
        const entry = result.fileList?.find(item => item.fileID === fileID);
        if (!entry?.tempFileURL?.startsWith('https://')
          || (entry.code !== undefined && entry.code !== 'SUCCESS')) {
          throw new OrgContentError('SERVICE_UNAVAILABLE');
        }
        urls.set(fileID, entry.tempFileURL);
      }
    }
  } catch {
    throw new OrgContentError('SERVICE_UNAVAILABLE');
  }
  const resolved = (key: string): string => urls.get(key) ?? key;
  return { ...view, chapters: view.chapters.map(chapter => ({
    ...chapter,
    pages: chapter.pages.map(page => ({ ...page,
      imageAssetKey: resolved(page.imageAssetKey),
      thumbnailAssetKey: resolved(page.thumbnailAssetKey),
    })),
  })) };
}

export function createContentQueryFunction(dependencies: ContentQueryFunctionDependencies) {
  return createTrustedFunction(
    'content-query',
    CONTENT_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createOrgContentFailureMapper(dependencies.mapFailure) },
    validateContentQueryRequest,
    async (input, actor): Promise<ServiceResult<ContentQueryOutput>> => {
      switch (input.action) {
        case 'getMyClass':
          return success(await dependencies.handler.getMyClass(actor), createMeta(dependencies.clock, dependencies.requestIds));
        case 'listSchoolQuestions':
          return success(await dependencies.handler.listSchoolQuestions(actor, input.filters, input.page), createMeta(dependencies.clock, dependencies.requestIds));
        case 'listSchoolQuestionFacets':
          return success(await dependencies.handler.listSchoolQuestionFacets(actor, input.targetClassIds), createMeta(dependencies.clock, dependencies.requestIds));
        case 'getSchoolQuestion':
          return success(await dependencies.handler.getSchoolQuestion(actor, input.resourceId, input.targetClassIds), createMeta(dependencies.clock, dependencies.requestIds));
        case 'listTaskCatalogResources':
          return success(await dependencies.handler.listTaskCatalogResources(actor, input.filters, input.page), createMeta(dependencies.clock, dependencies.requestIds));
        case 'listTaskCatalogFacets':
          return success(await dependencies.handler.listTaskCatalogFacets(actor, input.type, input.targetClassIds), createMeta(dependencies.clock, dependencies.requestIds));
        case 'getTaskCatalogResource':
          return success(await dependencies.handler.getTaskCatalogResource(actor, input.resourceId, input.targetClassIds), createMeta(dependencies.clock, dependencies.requestIds));
        case 'listStudentCatalog':
          return success(await dependencies.handler.listStudentCatalog(actor, input.filters, input.page), createMeta(dependencies.clock, dependencies.requestIds));
        case 'listStudentCatalogFacets':
          return success(await dependencies.handler.listStudentCatalogFacets(actor, input.type, input.category), createMeta(dependencies.clock, dependencies.requestIds));
        case 'listReadingResources':
          return success(
            await dependencies.handler.listReadingResources(actor),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'getReadingResource':
          return success(
            await signedReadingPages(await dependencies.handler.getReadingResource(actor, input.resourceId),
              dependencies.readingMediaStorage),
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
