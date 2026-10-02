import { canReadVisibility } from './authorization';
import type { OrgContentRepository } from './repository';
import {
  OrgContentError,
  type Actor,
  type LearningResourceEntity,
  type ExerciseResourceEntity,
  type SchoolQuestionDetailView,
  type SchoolQuestionFacet,
  type SchoolQuestionFilters,
  type SchoolQuestionListItemView,
  type SchoolQuestionPageView,
  type TaskCatalogFilters,
  type TaskCatalogFacet,
  type TaskCatalogListItemView,
  type TaskCatalogPageView,
  type ReadingListItemView,
  type ReadingResourceEntity,
  type ReadingResourceView,
  type StudentCatalogFilters,
  type StudentCatalogFacetView,
  type StudentCatalogItemView,
  type StudentCatalogPageView,
  type StudentClassView,
  type VocabularyPackView,
  type VocabularyResourceEntity,
} from './types';

function isReading(resource: LearningResourceEntity): resource is ReadingResourceEntity {
  return resource.type === 'reading';
}

function isVocabulary(resource: LearningResourceEntity): resource is VocabularyResourceEntity {
  return resource.type === 'vocabulary';
}

function isExercise(resource: LearningResourceEntity): resource is ExerciseResourceEntity {
  return resource.type === 'exercise';
}

function schoolQuestionListItem(resource: ExerciseResourceEntity): SchoolQuestionListItemView {
  return {
    id: resource.id,
    title: resource.title,
    grade: resource.grade,
    ...(resource.textbook === undefined ? {} : { textbook: resource.textbook }),
    ...(resource.unit === undefined ? {} : { unit: resource.unit }),
    ...(resource.knowledgePoint === undefined ? {} : { knowledgePoint: resource.knowledgePoint }),
    questionType: resource.questionType,
    ...(resource.difficulty === undefined ? {} : { difficulty: resource.difficulty }),
    stemSummary: resource.stem.slice(0, 100),
    contentVersion: resource.contentVersion,
  };
}

function taskCatalogListItem(resource: ReadingResourceEntity | VocabularyResourceEntity): TaskCatalogListItemView {
  if (resource.type === 'reading') return {
    id: resource.id, type: 'reading', title: resource.title,
    source: resource.category === 'synchronized' ? 'synchronized_textbook' : 'reading_book',
    category: resource.category,
    grade: resource.grade, ...(resource.term === undefined ? {} : { term: resource.term }),
    ...(resource.textbook === undefined ? {} : { textbook: resource.textbook }),
    ...(resource.unit === undefined ? {} : { unit: resource.unit }),
    difficulty: resource.difficulty, contentVersion: resource.contentVersion,
    requiredCount: resource.chapters.reduce((count, chapter) => count + chapter.pages.length, 0),
  };
  return {
    id: resource.id, type: 'vocabulary', title: resource.title, source: 'word_pack',
    grade: resource.grade, ...(resource.term === undefined ? {} : { term: resource.term }),
    ...(resource.textbook === undefined ? {} : { textbook: resource.textbook }),
    unit: resource.unit, contentVersion: resource.contentVersion, requiredCount: resource.words.length,
  };
}

function readingListItem(resource: ReadingResourceEntity): ReadingListItemView {
  return {
    id: resource.id,
    title: resource.title,
    category: resource.category,
    grade: resource.grade,
    difficulty: resource.difficulty,
    ...(resource.theme === undefined ? {} : { theme: resource.theme }),
    contentVersion: resource.contentVersion,
  };
}

function studentCatalogItem(resource: ReadingResourceEntity | VocabularyResourceEntity): StudentCatalogItemView {
  return resource.type === 'reading' ? {
    id: resource.id, type: 'reading', title: resource.title, category: resource.category,
    grade: resource.grade, ...(resource.textbook === undefined ? {} : { textbook: resource.textbook }),
    ...(resource.unit === undefined ? {} : { unit: resource.unit }), difficulty: resource.difficulty,
    ...(resource.theme === undefined ? {} : { theme: resource.theme }),
    contentVersion: resource.contentVersion,
    itemCount: resource.chapters.reduce((count, chapter) => count + chapter.pages.length, 0),
  } : {
    id: resource.id, type: 'vocabulary', title: resource.title, grade: resource.grade,
    ...(resource.textbook === undefined ? {} : { textbook: resource.textbook }),
    unit: resource.unit, contentVersion: resource.contentVersion, itemCount: resource.words.length,
  };
}

function readingDetail(resource: ReadingResourceEntity): ReadingResourceView {
  return {
    ...readingListItem(resource),
    presentation: 'page_images_only',
    textVisibility: { ocrExposed: false, standaloneBodyExposed: false },
    chapters: resource.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      order: chapter.order,
      pages: chapter.pages.map((page) => ({
        id: page.id,
        pageNumber: page.pageNumber,
        order: page.order,
        thumbnailAssetKey: page.thumbnailAssetKey,
        imageAssetKey: page.imageAssetKey,
        width: page.width,
        height: page.height,
        assetVersion: page.assetVersion,
      })),
    })),
  };
}

function vocabularyView(resource: VocabularyResourceEntity): VocabularyPackView {
  return {
    id: resource.id,
    title: resource.title,
    grade: resource.grade,
    ...(resource.textbook ? { textbook: resource.textbook } : {}),
    unit: resource.unit,
    contentVersion: resource.contentVersion,
    words: resource.words.map((word) => ({ ...word, syllables: [...word.syllables] })),
  };
}

export class ContentQueryService {
  public constructor(private readonly repository: OrgContentRepository) {}

  private async studentClassIds(actor: Actor): Promise<readonly string[]> {
    if (actor.actorRole !== 'student' || !actor.permissions.includes('content.read')) throw new OrgContentError('FORBIDDEN');
    const memberships = await this.repository.listActiveMembershipsForStudent(actor.organizationId, actor.actorUserId);
    if (!memberships.length) throw new OrgContentError('FORBIDDEN');
    return memberships.map((membership) => membership.classId);
  }

  private async scanStudentCatalog(actor: Actor, type: StudentCatalogFilters['type'],
    filters: Omit<StudentCatalogFilters, 'type'>,
  ): Promise<readonly StudentCatalogItemView[]> {
    const classIds = await this.studentClassIds(actor);
    const { keyword, textbook, theme, ...otherFilters } = filters;
    const dbFilters = { ...otherFilters,
      ...(textbook && textbook !== '__unlabeled_textbook__' ? { textbook } : {}) };
    const result: StudentCatalogItemView[] = [];
    let offset = 0;
    while (offset <= 10000) {
      const batch = await this.repository.listTaskCatalogResourcePage(actor.organizationId, type, dbFilters, { limit: 50, offset });
      for (const resource of batch.items) {
        if (!resource || (resource.type === 'reading' && resource.taskOnly === true)
          || !studentResourceVisible(resource, classIds)) continue;
        const item = studentCatalogItem(resource);
        if (item.itemCount < 1 || (textbook === '__unlabeled_textbook__' && item.textbook !== undefined)
          || (theme !== undefined && item.theme !== theme)) continue;
        if (keyword && !`${item.title} ${item.grade} ${item.textbook ?? ''} ${item.unit ?? ''} ${item.theme ?? ''} ${resource.type === 'reading' ? resource.searchText ?? '' : ''}`
          .toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())) continue;
        result.push(item);
      }
      offset += batch.items.length;
      if (offset > 10000) throw new OrgContentError('SERVICE_UNAVAILABLE');
      if (!batch.hasMore) return result;
    }
    throw new OrgContentError('SERVICE_UNAVAILABLE');
  }

  public async listStudentCatalog(actor: Actor, filters: StudentCatalogFilters,
    page: Readonly<{ limit: number; offset: number }>): Promise<StudentCatalogPageView> {
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
      || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 10000
      || (filters.keyword?.length ?? 0) > 100) throw new OrgContentError('VALIDATION_ERROR');
    const { type, ...rest } = filters;
    const all = await this.scanStudentCatalog(actor, type, rest);
    return { items: all.slice(page.offset, page.offset + page.limit), total: all.length,
      nextOffset: page.offset + page.limit < all.length ? page.offset + page.limit : null };
  }

  public async listStudentCatalogFacets(actor: Actor, type: StudentCatalogFilters['type'],
    category?: ReadingResourceEntity['category']): Promise<readonly StudentCatalogFacetView[]> {
    if (category !== undefined && type !== 'reading') throw new OrgContentError('VALIDATION_ERROR');
    const all = await this.scanStudentCatalog(actor, type, category === undefined ? {} : { category });
    const facets = new Map<string, StudentCatalogFacetView>();
    for (const item of all) {
      const facet: StudentCatalogFacetView = { ...(item.category === undefined ? {} : { category: item.category }),
        grade: item.grade, ...(item.textbook === undefined ? {} : { textbook: item.textbook }),
        ...(item.unit === undefined ? {} : { unit: item.unit }),
        ...(item.difficulty === undefined ? {} : { difficulty: item.difficulty }),
        ...(item.theme === undefined ? {} : { theme: item.theme }) };
      facets.set(JSON.stringify(facet), facet);
    }
    return [...facets.values()];
  }

  public async getMyClass(actor: Actor): Promise<StudentClassView> {
    if (actor.actorRole !== 'student') throw new OrgContentError('FORBIDDEN');
    const memberships = await this.repository.listActiveMembershipsForStudent(actor.organizationId, actor.actorUserId);
    if (!memberships.length) throw new OrgContentError('NOT_FOUND');
    if (memberships.length !== 1) throw new OrgContentError('CONFLICT');
    const membership = memberships[0]!;
    const classEntity = await this.repository.findClass(actor.organizationId, membership.classId);
    if (classEntity === null || classEntity.status !== 'active') throw new OrgContentError('NOT_FOUND');
    const organization = await this.repository.findOrganization(actor.organizationId);
    if (organization === null || organization.status !== 'active') throw new OrgContentError('NOT_FOUND');
    const grants = await this.repository.listActiveTeacherGrantsForClass(actor.organizationId, classEntity.id);
    const classmates = await this.repository.listActiveMembershipsForClass(actor.organizationId, classEntity.id);
    const teacherNames: string[] = [];
    for (const grant of grants) {
      const teacher = await this.repository.findUser(actor.organizationId, grant.teacherId);
      if (teacher?.status === 'active') teacherNames.push(teacher.displayNameMasked);
    }
    return {
      id: classEntity.id,
      name: classEntity.name,
      organizationName: organization.name,
      grade: classEntity.grade,
      term: classEntity.term,
      studentCount: classmates.length,
      teacherNames: [...new Set(teacherNames)].sort(),
    };
  }

  public async listTaskCatalogResources(
    actor: Actor,
    filters: TaskCatalogFilters,
    page: Readonly<{ limit: number; offset: number }>,
  ): Promise<TaskCatalogPageView> {
    if (!['reading', 'vocabulary'].includes(filters.type)
      || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
      || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 10000
      || (filters.keyword?.length ?? 0) > 100) throw new OrgContentError('VALIDATION_ERROR');
    const classIds = await this.authorizedQuestionClasses(actor, filters.targetClassIds);
    const { type, source: ignoredSource, category: ignoredCategory, keyword: ignoredKeyword, targetClassIds: ignoredTargets, ...rawDbFilters } = filters;
    const { textbook: requestedTextbook, ...otherDbFilters } = rawDbFilters;
    const dbFilters = requestedTextbook === '__unlabeled_textbook__' ? otherDbFilters : rawDbFilters;
    void ignoredSource;
    void ignoredCategory;
    void ignoredKeyword;
    void ignoredTargets;
    const keyword = filters.keyword?.trim().toLocaleLowerCase() ?? '';
    const items: TaskCatalogListItemView[] = [];
    let offset = page.offset;
    let hasMore = true;
    let scans = 0;
    while (items.length < page.limit && hasMore && scans < 10) {
      if (offset > 10000) throw new OrgContentError('SERVICE_UNAVAILABLE');
      const batch = await this.repository.listTaskCatalogResourcePage(actor.organizationId, type, dbFilters, { limit: 50, offset });
      if (!batch.items.length) { hasMore = false; break; }
      const batchEnd = offset + batch.items.length;
      for (const resource of batch.items) {
        offset += 1;
        if (resource === null || !resourceVisibleForQuery(resource, classIds, filters.targetClassIds)) continue;
        if (requestedTextbook === '__unlabeled_textbook__' && resource.textbook !== undefined) continue;
        if (keyword && !`${resource.title} ${resource.grade} ${resource.type === 'reading' ? resource.searchText ?? '' : `${resource.textbook ?? ''} ${resource.unit}`}`
          .toLocaleLowerCase().includes(keyword)) continue;
        const projected = taskCatalogListItem(resource);
        if (projected.requiredCount < 1) continue;
        if (filters.source !== undefined && projected.source !== filters.source) continue;
        if (filters.category !== undefined && projected.category !== filters.category) continue;
        items.push(projected);
        if (items.length === page.limit) break;
      }
      hasMore = batch.hasMore || offset < batchEnd;
      scans += 1;
    }
    if (hasMore && offset > 10000) throw new OrgContentError('SERVICE_UNAVAILABLE');
    return { items, nextOffset: hasMore ? offset : null };
  }

  public async listTaskCatalogFacets(
    actor: Actor,
    type: TaskCatalogFilters['type'],
    targetClassIds?: readonly string[],
  ): Promise<readonly TaskCatalogFacet[]> {
    if (type !== 'reading' && type !== 'vocabulary') throw new OrgContentError('VALIDATION_ERROR');
    const classIds = await this.authorizedQuestionClasses(actor, targetClassIds);
    const facets = new Map<string, TaskCatalogFacet>();
    let offset = 0;
    while (offset <= 10000) {
      const batch = await this.repository.listTaskCatalogResourcePage(actor.organizationId, type, {}, { limit: 50, offset });
      if (!batch.items.length) return [...facets.values()];
      for (const resource of batch.items) {
        if (resource === null || !resourceVisibleForQuery(resource, classIds, targetClassIds)) continue;
        const projected = taskCatalogListItem(resource);
        if (projected.requiredCount < 1) continue;
        const facet: TaskCatalogFacet = { source: projected.source, grade: projected.grade,
          ...(projected.term === undefined ? {} : { term: projected.term }),
          textbook: projected.textbook ?? '__unlabeled_textbook__',
          ...(projected.unit === undefined ? {} : { unit: projected.unit }),
          ...(projected.difficulty === undefined ? {} : { difficulty: projected.difficulty }) };
        facets.set(JSON.stringify(facet), facet);
      }
      offset += batch.items.length;
      if (!batch.hasMore) return [...facets.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'zh-CN'));
    }
    throw new OrgContentError('SERVICE_UNAVAILABLE');
  }

  public async getTaskCatalogResource(
    actor: Actor,
    resourceId: string,
    targetClassIds?: readonly string[],
  ): Promise<TaskCatalogListItemView> {
    const classIds = await this.authorizedQuestionClasses(actor, targetClassIds);
    const resource = await this.repository.findLearningResource(actor.organizationId, resourceId);
    if (resource === null || resource.status !== 'published'
      || (resource.type !== 'reading' && resource.type !== 'vocabulary')
      || !resourceVisibleForQuery(resource, classIds, targetClassIds)) throw new OrgContentError('NOT_FOUND');
    const projected = taskCatalogListItem(resource);
    if (projected.requiredCount < 1) throw new OrgContentError('NOT_FOUND');
    return projected;
  }

  public async listSchoolQuestions(
    actor: Actor,
    filters: SchoolQuestionFilters,
    page: Readonly<{ limit: number; offset: number }>,
  ): Promise<SchoolQuestionPageView> {
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
      || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 10000
      || (filters.keyword?.length ?? 0) > 100) throw new OrgContentError('VALIDATION_ERROR');
    const classIds = await this.authorizedQuestionClasses(actor, filters.targetClassIds);
    const { keyword: ignoredKeyword, targetClassIds: ignoredTargets, ...dbFilters } = filters;
    void ignoredKeyword;
    void ignoredTargets;
    const keyword = filters.keyword?.trim().toLocaleLowerCase() ?? '';
    const items: SchoolQuestionListItemView[] = [];
    let offset = page.offset;
    let hasMore = true;
    let scans = 0;
    while (items.length < page.limit && hasMore && scans < 10) {
      if (offset > 10000) throw new OrgContentError('SERVICE_UNAVAILABLE');
      const batch = await this.repository.listExerciseResourcePage(actor.organizationId, dbFilters, { limit: 50, offset });
      if (batch.items.length === 0) { hasMore = false; break; }
      const batchEnd = offset + batch.items.length;
      for (const resource of batch.items) {
        offset += 1;
        if (resource === null) continue;
        if (!resourceVisibleForQuery(resource, classIds, filters.targetClassIds)) continue;
        if (keyword && !`${resource.title} ${resource.stem} ${resource.knowledgePoint ?? ''}`.toLocaleLowerCase().includes(keyword)) continue;
        items.push(schoolQuestionListItem(resource));
        if (items.length === page.limit) break;
      }
      hasMore = batch.hasMore || offset < batchEnd;
      scans += 1;
    }
    if (hasMore && offset > 10000) throw new OrgContentError('SERVICE_UNAVAILABLE');
    return { items, nextOffset: hasMore ? offset : null };
  }

  public async listSchoolQuestionFacets(actor: Actor, targetClassIds?: readonly string[]): Promise<readonly SchoolQuestionFacet[]> {
    const classIds = await this.authorizedQuestionClasses(actor, targetClassIds);
    const facets = new Map<string, SchoolQuestionFacet>();
    let offset = 0;
    while (offset <= 10000) {
      const batch = await this.repository.listExerciseResourcePage(actor.organizationId, {}, { limit: 50, offset });
      if (!batch.items.length) return [...facets.values()];
      for (const resource of batch.items) {
        if (resource === null || !resourceVisibleForQuery(resource, classIds, targetClassIds)) continue;
        const facet: SchoolQuestionFacet = {
          grade: resource.grade,
          ...(resource.textbook === undefined ? {} : { textbook: resource.textbook }),
          ...(resource.unit === undefined ? {} : { unit: resource.unit }),
          ...(resource.knowledgePoint === undefined ? {} : { knowledgePoint: resource.knowledgePoint }),
          questionType: resource.questionType,
          ...(resource.difficulty === undefined ? {} : { difficulty: resource.difficulty }),
        };
        facets.set(JSON.stringify(facet), facet);
      }
      offset += batch.items.length;
      if (!batch.hasMore) return [...facets.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'zh-CN'));
    }
    throw new OrgContentError('SERVICE_UNAVAILABLE');
  }

  public async getSchoolQuestion(
    actor: Actor,
    resourceId: string,
    targetClassIds?: readonly string[],
  ): Promise<SchoolQuestionDetailView> {
    const classIds = await this.authorizedQuestionClasses(actor, targetClassIds);
    const resource = await this.getPublishedAuthorizedResource(actor, resourceId);
    if (!isExercise(resource) || !resourceVisibleForQuery(resource, classIds, targetClassIds)) throw new OrgContentError('NOT_FOUND');
    return {
      ...schoolQuestionListItem(resource),
      stem: resource.stem,
      options: [...resource.options],
      correctAnswer: resource.correctAnswer,
      explanation: resource.explanation,
    };
  }

  private async authorizedQuestionClasses(actor: Actor, targetClassIds?: readonly string[]): Promise<readonly string[]> {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('content.read')) throw new OrgContentError('FORBIDDEN');
    const grants = await this.repository.listActiveTeacherGrants(actor.organizationId, actor.actorUserId);
    const allowed = grants.filter((grant) => grant.permissions.includes('content.read') && actor.scopeIds.includes(grant.classId))
      .map((grant) => grant.classId);
    if (!allowed.length || (targetClassIds !== undefined && (!targetClassIds.length
      || targetClassIds.some((classId) => !allowed.includes(classId))))) throw new OrgContentError('FORBIDDEN');
    return targetClassIds ?? allowed;
  }

  public async listReadingResources(actor: Actor): Promise<readonly ReadingListItemView[]> {
    const resources = await this.repository.listLearningResources(actor.organizationId, 'reading');
    const visible: ReadingListItemView[] = [];
    for (const resource of resources) {
      if (resource.status === 'published' && isReading(resource) && resource.taskOnly !== true
        && await canReadVisibility(this.repository, actor, resource.organizationId, resource.visibility)) {
        visible.push(readingListItem(resource));
      }
    }
    return visible;
  }

  public async getReadingResource(actor: Actor, resourceId: string): Promise<ReadingResourceView> {
    const resource = await this.getPublishedAuthorizedResource(actor, resourceId);
    if (!isReading(resource)) throw new OrgContentError('NOT_FOUND');
    return readingDetail(resource);
  }

  public async listVocabularyPacks(actor: Actor): Promise<readonly VocabularyPackView[]> {
    const resources = await this.repository.listLearningResources(actor.organizationId, 'vocabulary');
    const visible: VocabularyPackView[] = [];
    for (const resource of resources) {
      if (resource.status === 'published' && isVocabulary(resource)
        && await canReadVisibility(this.repository, actor, resource.organizationId, resource.visibility)) {
        visible.push(vocabularyView(resource));
      }
    }
    return visible;
  }

  public async getVocabularyPack(actor: Actor, resourceId: string): Promise<VocabularyPackView> {
    const resource = await this.getPublishedAuthorizedResource(actor, resourceId);
    if (!isVocabulary(resource)) throw new OrgContentError('NOT_FOUND');
    return vocabularyView(resource);
  }

  private async getPublishedAuthorizedResource(actor: Actor, resourceId: string): Promise<LearningResourceEntity> {
    const resource = await this.repository.findLearningResource(actor.organizationId, resourceId);
    if (resource === null) throw new OrgContentError('NOT_FOUND');
    if (resource.status !== 'published') throw new OrgContentError('NOT_FOUND');
    if (!await canReadVisibility(this.repository, actor, resource.organizationId, resource.visibility)) throw new OrgContentError('NOT_FOUND');
    return resource;
  }
}

function resourceVisibleToClasses(resource: LearningResourceEntity, classIds: readonly string[]): boolean {
  return resource.visibility.type === 'organization'
    || classIds.every((classId) => resource.visibility.type === 'classes' && resource.visibility.classIds.includes(classId));
}

function resourceVisibleForQuery(resource: LearningResourceEntity, classIds: readonly string[],
  targetClassIds?: readonly string[]): boolean {
  return targetClassIds === undefined ? studentResourceVisible(resource, classIds)
    : resourceVisibleToClasses(resource, classIds);
}

function studentResourceVisible(resource: LearningResourceEntity, classIds: readonly string[]): boolean {
  return resource.status === 'published' && (resource.visibility.type === 'organization'
    || classIds.some((classId) => resource.visibility.type === 'classes' && resource.visibility.classIds.includes(classId)));
}
