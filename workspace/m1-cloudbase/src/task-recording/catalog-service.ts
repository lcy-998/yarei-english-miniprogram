import type { TrustedActorContext } from '../auth/trusted-actor';
import type { JsonObject } from '../shared/protocol';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { TaskQueryRepository } from '../task-query/repository';
import { supportsRecordingPromptSnapshot } from '../task-core/task-core-service';
import { TaskRecordingError } from './types';
import { hasActiveLegacyGlobalSource } from '../global-assets/legacy-global-source';

export interface RecordingPromptView {
  readonly id: string;
  readonly title: string;
  readonly promptText: string;
  readonly grade: string;
  readonly unit: string;
  readonly contentVersion: number;
  readonly allowedClassIds: readonly string[];
}
export interface RecordingPromptPage { readonly items: readonly RecordingPromptView[]; readonly nextOffset: number | null }
export interface RecordingPromptFacet { readonly grade: string; readonly unit: string }

function project(document: VersionedDocument): RecordingPromptView | null {
  const payload = document.payload;
  if (document.type !== 'recording' || document.status !== 'published'
    || document.deletedAt !== null || typeof document.id !== 'string'
    || typeof document.title !== 'string' || !Number.isSafeInteger(document.contentVersion)
    || typeof document.grade !== 'string' || typeof document.unit !== 'string'
    || !Array.isArray(document.allowedClassIds) || !document.allowedClassIds.every((id) => typeof id === 'string')
    || payload === null || typeof payload !== 'object' || Array.isArray(payload)
    || !supportsRecordingPromptSnapshot({ type: 'recording', payload: payload as JsonObject })) return null;
  return { id: document.id, title: document.title, promptText: (payload as JsonObject).promptText as string,
    grade: document.grade, unit: document.unit, contentVersion: Number(document.contentVersion),
    allowedClassIds: document.allowedClassIds as string[] };
}

export class TaskRecordingCatalogService {
  public constructor(private readonly documents: DocumentDatabasePort, private readonly tasks: TaskQueryRepository) {}
  public async list(actor: TrustedActorContext, input: Readonly<{ targetClassIds?: readonly string[];
    keyword?: string; grade?: string; unit?: string; limit: number; offset: number }>): Promise<RecordingPromptPage> {
    const allowed = await this.authorizedClasses(actor, input.targetClassIds);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50
      || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 10000
      || (input.keyword?.length ?? 0) > 100 || (input.grade?.length ?? 0) > 100
      || (input.unit?.length ?? 0) > 100) throw new TaskRecordingError('VALIDATION_ERROR');
    const keyword = input.keyword?.trim().toLocaleLowerCase() ?? '';
    const items: RecordingPromptView[] = [];
    let offset = input.offset;
    let hasMore = true;
    while (items.length < input.limit && hasMore && offset <= 10000) {
      const page = await this.documents.findPage('learning_resources', { organizationId: actor.organizationId,
        type: 'recording', status: 'published', deletedAt: null }, { limit: 50, offset });
      if (!page.items.length) break;
      const batchEnd = offset + page.items.length;
      for (const document of page.items) {
        offset++;
        if (!await hasActiveLegacyGlobalSource(this.documents, document)) continue;
        const prompt = project(document);
        if (!prompt) continue;
        if (input.grade && prompt.grade !== input.grade || input.unit && prompt.unit !== input.unit) continue;
        if (keyword && !`${prompt.title} ${prompt.promptText} ${prompt.grade} ${prompt.unit}`.toLocaleLowerCase().includes(keyword)) continue;
        items.push({ ...prompt, allowedClassIds: document.globalCatalogSource === true
          || document.globalCatalogProjection === true ? [...allowed]
          : allowed.filter(id => prompt.allowedClassIds.includes(id)) });
        if (items.length === input.limit) break;
      }
      hasMore = page.hasMore || offset < batchEnd;
    }
    if (hasMore && offset > 10000) throw new TaskRecordingError('SERVICE_UNAVAILABLE');
    return { items, nextOffset: hasMore ? offset : null };
  }
  public async facets(actor: TrustedActorContext,
    targetClassIds?: readonly string[]): Promise<readonly RecordingPromptFacet[]> {
    await this.authorizedClasses(actor, targetClassIds);
    const facets = new Map<string, RecordingPromptFacet>();
    let offset = 0;
    while (offset <= 10000) {
      const page = await this.documents.findPage('learning_resources', {
        organizationId: actor.organizationId, type: 'recording', status: 'published', deletedAt: null,
      }, { limit: 50, offset });
      if (!page.items.length) return [...facets.values()];
      for (const document of page.items) {
        if (!await hasActiveLegacyGlobalSource(this.documents, document)) continue;
        const prompt = project(document);
        if (!prompt) continue;
        const facet = { grade: prompt.grade, unit: prompt.unit };
        facets.set(JSON.stringify(facet), facet);
      }
      offset += page.items.length;
      if (!page.hasMore) return [...facets.values()]
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'zh-CN'));
    }
    throw new TaskRecordingError('SERVICE_UNAVAILABLE');
  }
  public async get(actor: TrustedActorContext, promptId: string,
    targetClassIds?: readonly string[]): Promise<RecordingPromptView> {
    const allowed = await this.authorizedClasses(actor, targetClassIds);
    const document = await this.documents.get('learning_resources', promptId);
    if (document?.organizationId !== actor.organizationId) throw new TaskRecordingError('NOT_FOUND');
    if (!await hasActiveLegacyGlobalSource(this.documents, document)) throw new TaskRecordingError('NOT_FOUND');
    const prompt = project(document);
    if (!prompt || prompt.id !== promptId) {
      throw new TaskRecordingError('NOT_FOUND');
    }
    return { ...prompt, allowedClassIds: document.globalCatalogSource === true
      || document.globalCatalogProjection === true ? [...allowed]
      : allowed.filter(id => prompt.allowedClassIds.includes(id)) };
  }
  private async authorizedClasses(actor: TrustedActorContext, targetClassIds?: readonly string[]): Promise<readonly string[]> {
    if (!['student', 'parent', 'teacher', 'admin'].includes(actor.actorRole)) throw new TaskRecordingError('FORBIDDEN');
    if (targetClassIds !== undefined && (!targetClassIds.length || targetClassIds.length > 20
      || new Set(targetClassIds).size !== targetClassIds.length)) {
      throw new TaskRecordingError('VALIDATION_ERROR');
    }
    if (actor.actorRole !== 'teacher') return [];
    const grants = await this.tasks.listActiveTeacherGrants(actor.organizationId, actor.actorUserId);
    const allowed = grants.filter((grant) => grant.status === 'active' && actor.scopeIds.includes(grant.classId)
      && grant.permissions.includes('task.publish') && grant.permissions.includes('content.read'))
      .map((grant) => grant.classId);
    return allowed;
  }
}
