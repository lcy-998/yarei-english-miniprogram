import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { CONTENT_QUERY_ACTIONS, validateContentQueryRequest } from '../../src/contracts/org-content-functions';
import { OrgContentError } from '../../src/org-content/types';
import type {
  ReadingListItemView,
  ReadingResourceView,
  ReadingPronunciationSourceView,
  ReadingAudioSourceView,
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
  VocabularyPackSourceView,
} from '../../src/org-content/types';
import type { ServiceResult } from '../../src/shared/protocol';
import type { CloudBasePlaybackSdkPort } from '../../src/student-work/cloudbase-playback';
import { createMeta, success } from '../../src/shared/result';
import { createOrgContentFailureMapper } from '../shared/org-content-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';
import { TeacherAssetError, type TeacherAssetCatalogService,
  type TeacherAssetPage, type TeacherAssetPreview, type TeacherAssetFacet } from '../../src/teacher-media/asset-catalog-service';
import { HistoricalTaskLearningError, type HistoricalTaskLearningService } from '../../src/org-content/historical-task-learning-service';

export type ContentQueryOutput =
  | readonly ReadingListItemView[]
  | ReadingResourceView
  | ReadingPronunciationView
  | ReadingAudioMapView
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
  | readonly StudentCatalogFacetView[]
  | TeacherAssetPage
  | readonly TeacherAssetFacet[]
  | TeacherAssetPreview
  | Awaited<ReturnType<HistoricalTaskLearningService['get']>>;

export interface ContentQueryHandler {
  getMyClass(actor: TrustedActorContext): Promise<StudentClassView>;
  listSchoolQuestions(actor: TrustedActorContext, filters: SchoolQuestionFilters, page: Readonly<{ limit: number; offset: number }>): Promise<SchoolQuestionPageView>;
  listSchoolQuestionFacets(actor: TrustedActorContext, targetClassIds?: readonly string[]): Promise<readonly SchoolQuestionFacet[]>;
  getSchoolQuestion(actor: TrustedActorContext, resourceId: string, targetClassIds?: readonly string[]): Promise<SchoolQuestionDetailView>;
  listTaskCatalogResources(actor: TrustedActorContext, filters: TaskCatalogFilters, page: Readonly<{ limit: number; offset: number }>): Promise<TaskCatalogPageView>;
  listTaskCatalogFacets(actor: TrustedActorContext, type: TaskCatalogFilters['type'], targetClassIds?: readonly string[],
    category?: TaskCatalogFilters['category']): Promise<readonly TaskCatalogFacet[]>;
  getTaskCatalogResource(actor: TrustedActorContext, resourceId: string, targetClassIds?: readonly string[]): Promise<TaskCatalogListItemView>;
  listStudentCatalog(actor: TrustedActorContext, filters: StudentCatalogFilters, page: Readonly<{ limit: number; offset: number }>): Promise<StudentCatalogPageView>;
  listStudentCatalogFacets(actor: TrustedActorContext, type: StudentCatalogFilters['type'], category?: StudentCatalogFilters['category']): Promise<readonly StudentCatalogFacetView[]>;
  listReadingResources(actor: TrustedActorContext): Promise<readonly ReadingListItemView[]>;
  getReadingResource(actor: TrustedActorContext, resourceId: string): Promise<ReadingResourceView>;
  getReadingPronunciationSegments?(actor: TrustedActorContext, resourceId: string): Promise<ReadingPronunciationSourceView>;
  getReadingAudioMap?(actor: TrustedActorContext, resourceId: string, chapterId: string): Promise<ReadingAudioSourceView>;
  listVocabularyPacks(actor: TrustedActorContext): Promise<readonly VocabularyPackSourceView[]>;
  getVocabularyPack(actor: TrustedActorContext, resourceId: string): Promise<VocabularyPackSourceView>;
}

export interface ReadingPronunciationView {
  readonly resourceId: string;
  readonly sourceVersion: string;
  readonly segments: readonly Readonly<{
    id: string;
    text: string;
    translationText?: string;
    pageNumber?: number;
    demonstrationAudio: Readonly<{ temporaryUrl: string; expiresAt: string }>;
  }>[];
}

export interface ReadingAudioMapView {
  readonly resourceId: string;
  readonly sourceVersion: string;
  readonly chapterId: string;
  readonly durationMs: number | null;
  readonly playback: Readonly<{ temporaryUrl: string; expiresAt: string }> | null;
  readonly segments: readonly Readonly<{
    id: string; pageId: string; pageNumber: number; text: string;
    rect: Readonly<{ x: number; y: number; width: number; height: number }>;
    startMs: number; endMs: number;
    clipDurationMs?: number;
    clipPlayback?: Readonly<{ temporaryUrl: string; expiresAt: string }>;
  }>[];
}

export interface ContentQueryFunctionDependencies extends TrustedFunctionDependencies {
  readonly handler: ContentQueryHandler;
  readonly readingMediaStorage?: CloudBasePlaybackSdkPort;
  readonly teacherAssets?: Pick<TeacherAssetCatalogService, 'list' | 'facets' | 'preview'>;
  readonly historicalLearning?: HistoricalTaskLearningService;
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

async function signedReadingPronunciation(source: ReadingPronunciationSourceView,
  storage: CloudBasePlaybackSdkPort | undefined, nowIso: string): Promise<ReadingPronunciationView> {
  if (source.segments.length === 0) return { resourceId: source.resourceId, sourceVersion: source.sourceVersion, segments: [] };
  if (!storage) throw new OrgContentError('SERVICE_UNAVAILABLE');
  const ids = [...new Set(source.segments.map(segment => segment.demonstrationAudioAssetKey))];
  const urls = new Map<string, string>();
  try {
    for (let offset = 0; offset < ids.length; offset += 40) {
      const batch = ids.slice(offset, offset + 40);
      const result = await storage.getTempFileURL({ fileList: batch.map(fileID => ({ fileID, maxAge: 60 })) });
      for (const fileID of batch) {
        const item = result.fileList?.find(entry => entry.fileID === fileID);
        if (!item?.tempFileURL?.startsWith('https://') || (item.code !== undefined && item.code !== 'SUCCESS')) {
          throw new OrgContentError('SERVICE_UNAVAILABLE');
        }
        urls.set(fileID, item.tempFileURL);
      }
    }
  } catch {
    throw new OrgContentError('SERVICE_UNAVAILABLE');
  }
  const expiresAt = new Date(Date.parse(nowIso) + 60_000).toISOString();
  return { resourceId: source.resourceId, sourceVersion: source.sourceVersion,
    segments: source.segments.map(segment => ({ id: segment.id, text: segment.text,
      ...(segment.translationText === undefined ? {} : { translationText: segment.translationText }),
      ...(segment.pageNumber === undefined ? {} : { pageNumber: segment.pageNumber }),
      demonstrationAudio: { temporaryUrl: urls.get(segment.demonstrationAudioAssetKey)!, expiresAt } })) };
}

async function signedReadingAudio(source: ReadingAudioSourceView,
  storage: CloudBasePlaybackSdkPort | undefined, nowIso: string): Promise<ReadingAudioMapView> {
  if (source.audioAssetKey === null) return { resourceId: source.resourceId,
    sourceVersion: source.sourceVersion, chapterId: source.chapterId,
    durationMs: null, playback: null, segments: [] };
  if (!storage) throw new OrgContentError('SERVICE_UNAVAILABLE');
  try {
    const ids = [...new Set([source.audioAssetKey,
      ...source.segments.flatMap(segment => segment.clipAudioAssetKey ? [segment.clipAudioAssetKey] : [])])];
    const urls = new Map<string, string>();
    for (let offset = 0; offset < ids.length; offset += 40) {
      const batch = ids.slice(offset, offset + 40);
      const result = await storage.getTempFileURL({ fileList: batch.map(fileID => ({ fileID, maxAge: 60 })) });
      for (const fileID of batch) {
        const entry = result.fileList?.find(item => item.fileID === fileID);
        if (!entry?.tempFileURL?.startsWith('https://')
          || (entry.code !== undefined && entry.code !== 'SUCCESS')) throw new OrgContentError('SERVICE_UNAVAILABLE');
        urls.set(fileID, entry.tempFileURL);
      }
    }
    const expiresAt = new Date(Date.parse(nowIso) + 60_000).toISOString();
    return { resourceId: source.resourceId, sourceVersion: source.sourceVersion,
      chapterId: source.chapterId, durationMs: source.durationMs,
      playback: { temporaryUrl: urls.get(source.audioAssetKey)!, expiresAt },
      segments: source.segments.map(({ clipAudioAssetKey, ...segment }) => ({
        ...segment, rect: { ...segment.rect },
        ...(clipAudioAssetKey === undefined ? {} : {
          clipPlayback: { temporaryUrl: urls.get(clipAudioAssetKey)!, expiresAt },
        }),
      })) };
  } catch {
    throw new OrgContentError('SERVICE_UNAVAILABLE');
  }
}

async function signedVocabularyPack(source: VocabularyPackSourceView,
  storage: CloudBasePlaybackSdkPort | undefined, nowIso: string): Promise<VocabularyPackView> {
  const ids = [...new Set(source.words.flatMap(word => word.audioAssetKey ? [word.audioAssetKey] : []))];
  if (ids.length === 0) return { ...source, words: source.words.map(({ audioAssetKey: _privateKey, ...word }) => word) };
  if (!storage) throw new OrgContentError('SERVICE_UNAVAILABLE');
  const urls = new Map<string, string>();
  try {
    for (let offset = 0; offset < ids.length; offset += 40) {
      const batch = ids.slice(offset, offset + 40);
      const result = await storage.getTempFileURL({ fileList: batch.map(fileID => ({ fileID, maxAge: 60 })) });
      for (const fileID of batch) {
        const entry = result.fileList?.find(item => item.fileID === fileID);
        if (!entry?.tempFileURL?.startsWith('https://')
          || (entry.code !== undefined && entry.code !== 'SUCCESS')) throw new OrgContentError('SERVICE_UNAVAILABLE');
        urls.set(fileID, entry.tempFileURL);
      }
    }
  } catch {
    throw new OrgContentError('SERVICE_UNAVAILABLE');
  }
  const expiresAt = new Date(Date.parse(nowIso) + 60_000).toISOString();
  return { ...source, words: source.words.map(({ audioAssetKey, ...word }) => ({
    ...word,
    ...(audioAssetKey === undefined ? {} : { pronunciationUrl: urls.get(audioAssetKey)!, pronunciationExpiresAt: expiresAt }),
  })) };
}

export function createContentQueryFunction(dependencies: ContentQueryFunctionDependencies) {
  const mapOrgFailure = createOrgContentFailureMapper(dependencies.mapFailure);
  return createTrustedFunction(
    'content-query',
    CONTENT_QUERY_ACTIONS,
    { ...dependencies, mapFailure: (phase, error) =>
      phase === 'handler' && error instanceof HistoricalTaskLearningError
        ? error.code : phase === 'handler' && error instanceof TeacherAssetError
        ? error.code : mapOrgFailure(phase, error) },
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
          return success(await dependencies.handler.listTaskCatalogFacets(actor, input.type, input.targetClassIds, input.category), createMeta(dependencies.clock, dependencies.requestIds));
        case 'getTaskCatalogResource':
          return success(await dependencies.handler.getTaskCatalogResource(actor, input.resourceId, input.targetClassIds), createMeta(dependencies.clock, dependencies.requestIds));
        case 'listTeacherAssets':
          if (!dependencies.teacherAssets) throw new TeacherAssetError('SERVICE_UNAVAILABLE');
          return success(await dependencies.teacherAssets.list(actor, input.filters, input.page),
            createMeta(dependencies.clock, dependencies.requestIds));
        case 'listTeacherAssetFacets':
          if (!dependencies.teacherAssets) throw new TeacherAssetError('SERVICE_UNAVAILABLE');
          return success(await dependencies.teacherAssets.facets(actor, input.kind, input.targetClassIds),
            createMeta(dependencies.clock, dependencies.requestIds));
        case 'previewTeacherAsset':
          if (!dependencies.teacherAssets) throw new TeacherAssetError('SERVICE_UNAVAILABLE');
          return success(await dependencies.teacherAssets.preview(actor, input.resourceId, input.targetClassIds),
            createMeta(dependencies.clock, dependencies.requestIds));
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
        case 'getReadingPronunciationSegments':
          if (!dependencies.handler.getReadingPronunciationSegments) throw new OrgContentError('SERVICE_UNAVAILABLE');
          return success(await signedReadingPronunciation(
            await dependencies.handler.getReadingPronunciationSegments(actor, input.resourceId),
            dependencies.readingMediaStorage, dependencies.clock.nowIso()),
          createMeta(dependencies.clock, dependencies.requestIds));
        case 'getReadingAudioMap':
          if (!dependencies.handler.getReadingAudioMap) throw new OrgContentError('SERVICE_UNAVAILABLE');
          return success(await signedReadingAudio(
            await dependencies.handler.getReadingAudioMap(actor, input.resourceId, input.chapterId),
            dependencies.readingMediaStorage, dependencies.clock.nowIso()),
          createMeta(dependencies.clock, dependencies.requestIds));
        case 'listVocabularyPacks':
          return success(
            await Promise.all((await dependencies.handler.listVocabularyPacks(actor)).map(pack =>
              signedVocabularyPack(pack, dependencies.readingMediaStorage, dependencies.clock.nowIso()))),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'getVocabularyPack':
          return success(
            await signedVocabularyPack(await dependencies.handler.getVocabularyPack(actor, input.resourceId),
              dependencies.readingMediaStorage, dependencies.clock.nowIso()),
            createMeta(dependencies.clock, dependencies.requestIds),
          );
        case 'getHistoricalTaskLearning':
          if (!dependencies.historicalLearning) throw new HistoricalTaskLearningError('SERVICE_UNAVAILABLE');
          return success(await dependencies.historicalLearning.get(actor, input.taskId, input.itemId),
            createMeta(dependencies.clock, dependencies.requestIds));
      }
    },
  );
}
