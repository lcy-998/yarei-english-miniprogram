import { canReadVisibility } from './authorization';
import type { OrgContentRepository } from './repository';
import {
  OrgContentError,
  type Actor,
  type LearningResourceEntity,
  type ReadingListItemView,
  type ReadingResourceEntity,
  type ReadingResourceView,
  type VocabularyPackView,
  type VocabularyResourceEntity,
} from './types';

function isReading(resource: LearningResourceEntity): resource is ReadingResourceEntity {
  return resource.type === 'reading';
}

function isVocabulary(resource: LearningResourceEntity): resource is VocabularyResourceEntity {
  return resource.type === 'vocabulary';
}

function readingListItem(resource: ReadingResourceEntity): ReadingListItemView {
  return {
    id: resource.id,
    title: resource.title,
    category: resource.category,
    grade: resource.grade,
    difficulty: resource.difficulty,
    contentVersion: resource.contentVersion,
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
