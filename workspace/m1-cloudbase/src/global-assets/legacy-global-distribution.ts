import { createHash } from 'node:crypto';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { JsonObject } from '../shared/protocol';
import { hasApprovedAssetLibraryOrigin } from '../teacher-media/asset-library-origin';
import { freezeTeacherMediaForTask, type TeacherMediaCandidate } from '../teacher-media/publish-gate';
import { hasCompletePublicLearningMapping } from '../org-content/public-learning-source';
import { supportsRecordingPromptSnapshot } from '../task-core/task-core-service';

const TEACHING_TYPES = new Set(['reading', 'vocabulary', 'exercise', 'recording',
  'listening', 'video', 'dubbing']);
const MEDIA_TYPES = new Set(['listening', 'video', 'dubbing']);
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export class LegacyGlobalDistributionError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'CONFLICT') { super(code); }
}

export function legacyGlobalProjectionId(sourceId: string, organizationId: string): string {
  return `global_asset_${createHash('sha256').update(JSON.stringify([sourceId, organizationId]))
    .digest('hex').slice(0, 40)}`;
}

function fingerprint(resource: VersionedDocument): string {
  return createHash('sha256').update(JSON.stringify({ id: resource._id,
    version: resource.version, type: resource.type, title: resource.title,
    contentVersion: resource.contentVersion, payload: resource.payload,
    visibility: resource.visibility, status: resource.status })).digest('hex');
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Promotes visibility only. Historical content/review status and task snapshots are preserved. */
export function makeLegacyGlobalSource(resource: VersionedDocument): VersionedDocument {
  const payload = object(resource?.payload)
    ?? (resource?.type === 'vocabulary' ? {
      grade: resource.grade, term: resource.term, textbook: resource.textbook,
      unit: resource.unit, words: resource.words,
    } : null);
  if (!ID.test(resource?._id ?? '') || !ID.test(resource.organizationId ?? '')
    || !TEACHING_TYPES.has(String(resource.type))
    || resource.status !== 'published' || resource.deletedAt !== null
    || resource.globalCatalogSource === true || resource.globalCatalogProjection === true
    || !Number.isSafeInteger(resource.version) || resource.version < 1
    || !payload) throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
  if ((resource.type === 'reading' || resource.type === 'vocabulary')
    && !hasCompletePublicLearningMapping(resource)) {
    throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
  }
  if (resource.type === 'exercise') {
    const payload = object(resource.payload);
    const answer = resource.correctAnswer ?? payload?.correctAnswer;
    const options = resource.options ?? payload?.options;
    const questionType = resource.questionType ?? payload?.questionType;
    const validAnswer = questionType === 'subjective'
      ? answer === null && Array.isArray(options) && options.length === 0
      : questionType === 'multiple_choice'
        ? Array.isArray(answer) && answer.length > 0 && Array.isArray(options)
          && answer.every(value => options.includes(value))
        : (questionType === 'single_choice' || questionType === 'fill')
          && typeof answer === 'string' && Array.isArray(options)
          && (questionType === 'fill' || options.length >= 2 && options.includes(answer));
    if (!payload || !Array.isArray(payload.questionIds)
      || payload.questionIds.length !== 1 || payload.questionIds[0] !== resource._id
      || typeof (resource.stem ?? payload.stem) !== 'string'
      || typeof (resource.explanation ?? payload.explanation) !== 'string'
      || !validAnswer) {
      throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
    }
  }
  if (resource.type === 'recording'
    && !supportsRecordingPromptSnapshot({ type: 'recording',
      payload: resource.payload as JsonObject })) {
    throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
  }
  const next: VersionedDocument = { ...resource, version: resource.version + 1,
    globalCatalogSource: true, globalCatalogFingerprint: fingerprint(resource),
    teacherCatalogOnly: true, visibility: { type: 'organization' },
    allowedClassIds: [], payload: payload as JsonObject };
  if (MEDIA_TYPES.has(String(resource.type))) {
    const media = object(payload?.teacherMedia);
    const candidate = media ? { ...media, id: resource._id,
      organizationId: resource.organizationId, title: resource.title,
      kind: resource.type, version: resource.contentVersion,
      status: resource.status } as unknown as TeacherMediaCandidate : null;
    const classIds = Array.isArray(media?.allowedClassIds)
      ? media.allowedClassIds.filter((id): id is string => typeof id === 'string') : [];
    if (!payload || !media || !candidate || !classIds.length
      || !hasApprovedAssetLibraryOrigin(payload as JsonObject,
        resource._id, Number(resource.contentVersion))
      || !freezeTeacherMediaForTask(candidate, resource.organizationId, [classIds[0]!]).ready) {
      throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
    }
    return { ...next, visibility: { type: 'organization' },
      publicCatalogSource: true,
      payload: { ...payload, teacherMedia: { ...media, catalogScope: 'all_teachers' } } as JsonObject };
  }
  return next;
}

export function makeLegacyGlobalProjection(source: VersionedDocument,
  organizationId: string): VersionedDocument {
  if (source.globalCatalogSource !== true || source.status !== 'published'
    || source.deletedAt !== null || !ID.test(organizationId)
    || organizationId === source.organizationId
    || typeof source.globalCatalogFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/i.test(source.globalCatalogFingerprint)) {
    throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
  }
  const id = legacyGlobalProjectionId(source._id, organizationId);
  const payload = object(source.payload);
  if (!payload) throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
  let projection: VersionedDocument = { ...source, _id: id, id,
    organizationId, version: 1, visibility: { type: 'organization' },
    allowedClassIds: [],
    teacherCatalogOnly: true, globalCatalogSource: false,
    globalCatalogProjection: true, globalSourceId: source._id,
    globalSourceVersion: source.version,
    globalSourceFingerprint: source.globalCatalogFingerprint,
    payload: { ...payload } as JsonObject };
  if (MEDIA_TYPES.has(String(source.type))) {
    const origin = object(payload.assetLibrary);
    const media = object(payload.teacherMedia);
    if (!origin || !media) throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
    projection = { ...projection, publicCatalogSource: false, payload: { ...payload,
      assetLibrary: { ...origin, resourceId: id, sourcePublicId: source._id },
      teacherMedia: { ...media, id, organizationId,
        allowedClassIds: [], catalogScope: 'all_teachers' } } as JsonObject };
  } else if (source.type === 'exercise') {
    projection = { ...projection, payload: { ...payload, questionIds: [id] } as JsonObject };
  } else if (source.type === 'recording') {
    projection = { ...projection, allowedClassIds: [] };
  }
  return projection;
}

export class LegacyGlobalDistributionService {
  public constructor(private readonly documents: DocumentDatabasePort,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  /** Run after any controlled import; complete published legacy content becomes global by default. */
  public async syncPublishedReady(organizationIds: readonly string[]): Promise<Readonly<{
    migrated: readonly string[]; deferred: readonly string[] }>> {
    if (!organizationIds.length || new Set(organizationIds).size !== organizationIds.length
      || organizationIds.some(id => !ID.test(id))) {
      throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
    }
    const migrated: string[] = [];
    const deferred: string[] = [];
    let offset = 0;
    while (offset <= 10000) {
      const page = await this.documents.findPage('learning_resources',
        { status: 'published', deletedAt: null }, { limit: 50, offset });
      if (!page.items.length) return { migrated, deferred };
      for (const row of page.items) {
        const origin = object(object(row.payload)?.assetLibrary);
        if (row.globalCatalogProjection === true || row.publicQuestionProjection === true
          || row.publicLearningProjection === true || row.publicCatalogSource === true
          && row.globalCatalogSource !== true || origin?.sourcePublicId !== undefined
          || !TEACHING_TYPES.has(String(row.type))) continue;
        if (!organizationIds.includes(row.organizationId)) continue;
        if (row.globalCatalogSource !== true) {
          try { makeLegacyGlobalSource(row); }
          catch { deferred.push(row._id); continue; }
        }
        await this.migrate(row._id, organizationIds);
        migrated.push(row._id);
      }
      offset += page.items.length;
      if (!page.hasMore) return { migrated, deferred };
    }
    throw new LegacyGlobalDistributionError('CONFLICT');
  }

  public async migrate(sourceId: string, organizationIds: readonly string[]): Promise<string[]> {
    if (!ID.test(sourceId) || !organizationIds.length
      || organizationIds.some(id => !ID.test(id))
      || new Set(organizationIds).size !== organizationIds.length) {
      throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
    }
    const current = await this.documents.get('learning_resources', sourceId);
    if (!current) throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
    if (!organizationIds.includes(current.organizationId)) {
      throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
    }
    for (const organizationId of organizationIds) {
      const organization = await this.documents.get('organizations', organizationId);
      if (!organization || organization.status !== 'active' || organization.deletedAt !== null) {
        throw new LegacyGlobalDistributionError('VALIDATION_ERROR');
      }
    }
    const source = current.globalCatalogSource === true ? current : makeLegacyGlobalSource(current);
    if (current.globalCatalogSource !== true) {
      await this.documents.runTransaction(async tx => {
        if (!await tx.replace('learning_resources', sourceId, current.version, source)) {
          throw new LegacyGlobalDistributionError('CONFLICT');
        }
        const auditId = `global_asset_source_${sourceId}`;
        if (!await tx.append('operation_logs', { _id: auditId,
          organizationId: current.organizationId, schemaVersion: 1, version: 1,
          deletedAt: null, requestId: auditId, actorUserId: 'controlled_import',
          actorRole: 'system', action: 'asset_library.globalize_source',
          targetType: 'learning_resource', targetId: sourceId,
          result: 'succeeded', errorCode: null, occurredAt: this.clock.nowIso(),
          metadata: { previousVersion: current.version,
            fingerprint: source.globalCatalogFingerprint } })) {
          throw new LegacyGlobalDistributionError('CONFLICT');
        }
      });
    }
    const projected: string[] = [];
    for (const organizationId of organizationIds) {
      if (organizationId === source.organizationId) continue;
      const next = makeLegacyGlobalProjection(source, organizationId);
      const existing = await this.documents.get('learning_resources', next._id);
      if (existing) {
        if (existing.globalSourceId !== sourceId
          || existing.globalSourceVersion !== source.version) {
          throw new LegacyGlobalDistributionError('CONFLICT');
        }
        projected.push(next._id);
        continue;
      }
      await this.documents.runTransaction(async tx => {
        if (!await tx.create('learning_resources', next)) {
          throw new LegacyGlobalDistributionError('CONFLICT');
        }
        const auditId = `global_asset_projection_${next._id}`;
        if (!await tx.append('operation_logs', { _id: auditId,
          organizationId, schemaVersion: 1, version: 1, deletedAt: null,
          requestId: auditId, actorUserId: 'controlled_import', actorRole: 'system',
          action: 'asset_library.project_global', targetType: 'learning_resource',
          targetId: next._id, result: 'succeeded', errorCode: null,
          occurredAt: this.clock.nowIso(), metadata: { sourceId } })) {
          throw new LegacyGlobalDistributionError('CONFLICT');
        }
      });
      projected.push(next._id);
    }
    return projected;
  }
}
