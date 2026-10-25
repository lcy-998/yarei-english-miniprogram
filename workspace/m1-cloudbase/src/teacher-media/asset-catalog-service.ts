import { randomUUID } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { OrgContentRepository } from '../org-content/repository';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { JsonObject } from '../shared/protocol';
import type { CloudBasePlaybackSdkPort } from '../student-work/cloudbase-playback';
import { hasApprovedAssetLibraryOrigin } from './asset-library-origin';
import { hasActivePublicMediaSource } from './public-media-source';
import { hasActiveLegacyGlobalSource } from '../global-assets/legacy-global-source';
import { freezeTeacherMediaForTask, type FrozenTeacherMediaSnapshot,
  type TeacherMediaCandidate, type TeacherMediaTaskKind } from './publish-gate';

export interface TeacherAssetFilters {
  readonly kind: TeacherMediaTaskKind;
  readonly scope?: 'mine';
  readonly keyword?: string;
  readonly grade?: string;
  readonly textbook?: string;
  readonly unit?: string;
  readonly targetClassIds?: readonly string[];
}

export interface TeacherAssetListItem {
  readonly id: string;
  readonly kind: TeacherMediaTaskKind;
  readonly title: string;
  readonly contentVersion: number;
  readonly grade: string;
  readonly textbook: string | null;
  readonly unit: string | null;
  readonly durationMs: number;
  readonly questionCount: number;
  readonly allowedClassIds: readonly string[];
  readonly acceptanceStatus?: 'pending_user_acceptance';
  readonly privateToTeacher?: true;
}

export interface TeacherAssetPage {
  readonly items: readonly TeacherAssetListItem[];
  readonly nextOffset: number | null;
}

export interface TeacherAssetFacet {
  readonly grade: string;
  readonly textbook: string | null;
  readonly unit: string | null;
}

export interface TeacherAssetPreview extends TeacherAssetListItem {
  readonly scoringKind: 'automatic' | 'manual' | 'completion_only';
  readonly questions: readonly Readonly<{ questionId: string; stem: string;
    options: readonly string[] }>[];
  readonly clips: FrozenTeacherMediaSnapshot['clips'];
  readonly subtitles: readonly Readonly<{ startMs: number; endMs: number; text: string;
    translationText?: string }>[];
  readonly playback: Readonly<{ temporaryUrl: string; expiresAt: string }>;
}

export class TeacherAssetError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE') {
    super(code);
  }
}

/** Read-only view of media that passed the central asset library gate. */
export class TeacherAssetCatalogService {
  public constructor(private readonly documents: DocumentDatabasePort,
    private readonly organization: OrgContentRepository,
    private readonly playback: CloudBasePlaybackSdkPort | undefined,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async list(actor: TrustedActorContext, filters: TeacherAssetFilters,
    page: Readonly<{ limit: number; offset: number }>): Promise<TeacherAssetPage> {
    if (!validFilters(filters) || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
      || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 10000) {
      throw new TeacherAssetError('VALIDATION_ERROR');
    }
    const classes = await this.authorizedClasses(actor, filters.targetClassIds);
    if (filters.scope === 'mine') {
      if (actor.actorRole !== 'teacher' || filters.kind !== 'video') {
        throw new TeacherAssetError('FORBIDDEN');
      }
      const batch = await this.documents.findPage('learning_resources', {
        organizationId: actor.organizationId, type: 'video', status: 'published',
        teacherPrivateOwnerId: actor.actorUserId, deletedAt: null,
      }, page);
      const items = batch.items.map(row => projectPrivate(row, actor, classes))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .filter(entry => !filters.targetClassIds
          || filters.targetClassIds.every(id => entry.item.allowedClassIds.includes(id)))
        .filter(entry => matches(entry.item, filters)).map(entry => entry.item);
      return { items, nextOffset: batch.hasMore ? page.offset + batch.items.length : null };
    }
    const items: TeacherAssetListItem[] = [];
    let offset = page.offset;
    let hasMore = true;
    let scans = 0;
    while (items.length < page.limit && hasMore && scans < 10) {
      if (offset > 10000) throw new TeacherAssetError('SERVICE_UNAVAILABLE');
      const batch = await this.documents.findPage('learning_resources', {
        organizationId: actor.organizationId, type: filters.kind, status: 'published', deletedAt: null,
      }, { limit: 50, offset });
      if (!batch.items.length) { hasMore = false; break; }
      const batchEnd = offset + batch.items.length;
      for (const row of batch.items) {
        offset += 1;
        if (!await hasActivePublicMediaSource(this.documents, row)
          || !await hasActiveLegacyGlobalSource(this.documents, row)) continue;
        const projected = project(row, actor.organizationId, classes, filters.targetClassIds);
        if (!projected || !matches(projected.item, filters)) continue;
        items.push(projected.item);
        if (items.length === page.limit) break;
      }
      hasMore = batch.hasMore || offset < batchEnd;
      scans += 1;
    }
    if (hasMore && offset > 10000) throw new TeacherAssetError('SERVICE_UNAVAILABLE');
    return { items, nextOffset: hasMore ? offset : null };
  }

  public async facets(actor: TrustedActorContext, kind: TeacherMediaTaskKind,
    targetClassIds?: readonly string[]): Promise<readonly TeacherAssetFacet[]> {
    if (kind !== 'listening' && kind !== 'video' && kind !== 'dubbing'
      || !validClassIds(targetClassIds)) throw new TeacherAssetError('VALIDATION_ERROR');
    const classes = await this.authorizedClasses(actor, targetClassIds);
    const facets = new Map<string, TeacherAssetFacet>();
    let offset = 0;
    while (offset <= 10000) {
      const batch = await this.documents.findPage('learning_resources', {
        organizationId: actor.organizationId, type: kind, status: 'published', deletedAt: null,
      }, { limit: 50, offset });
      if (!batch.items.length) return [...facets.values()];
      for (const row of batch.items) {
        if (!await hasActivePublicMediaSource(this.documents, row)
          || !await hasActiveLegacyGlobalSource(this.documents, row)) continue;
        const projected = project(row, actor.organizationId, classes, targetClassIds);
        if (!projected) continue;
        const facet = { grade: projected.item.grade, textbook: projected.item.textbook,
          unit: projected.item.unit };
        facets.set(JSON.stringify(facet), facet);
      }
      offset += batch.items.length;
      if (!batch.hasMore) return [...facets.values()]
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'zh-CN'));
    }
    throw new TeacherAssetError('SERVICE_UNAVAILABLE');
  }

  public async preview(actor: TrustedActorContext, resourceId: string,
    targetClassIds?: readonly string[]): Promise<TeacherAssetPreview> {
    if (!validId(resourceId) || !validClassIds(targetClassIds)) throw new TeacherAssetError('VALIDATION_ERROR');
    const classes = await this.authorizedClasses(actor, targetClassIds);
    const row = await this.documents.get('learning_resources', resourceId);
    const privateProjection = row ? projectPrivate(row, actor, classes) : null;
    if (privateProjection && targetClassIds
      && targetClassIds.some(id => !privateProjection.item.allowedClassIds.includes(id))) {
      throw new TeacherAssetError('FORBIDDEN');
    }
    if (row && !privateProjection && (!await hasActivePublicMediaSource(this.documents, row)
      || !await hasActiveLegacyGlobalSource(this.documents, row))) throw new TeacherAssetError('NOT_FOUND');
    const projected = privateProjection ?? project(row, actor.organizationId, classes, targetClassIds);
    if (!projected) throw new TeacherAssetError('NOT_FOUND');
    if (!this.playback) throw new TeacherAssetError('SERVICE_UNAVAILABLE');
    let temporaryUrl: string;
    try {
      const result = await this.playback.getTempFileURL({ fileList: [{
        fileID: projected.snapshot.mediaAssetKey, maxAge: 60,
      }] });
      const signed = result.fileList?.find(item => item.fileID === projected.snapshot.mediaAssetKey);
      if (!signed?.tempFileURL?.startsWith('https://')
        || (signed.code !== undefined && signed.code !== 'SUCCESS')) throw new Error('MEDIA_SIGN_FAILED');
      temporaryUrl = signed.tempFileURL;
    } catch { throw new TeacherAssetError('SERVICE_UNAVAILABLE'); }
    const auditId = `teacher_asset_preview_${randomUUID()}`;
    try {
      const saved = await this.documents.runTransaction(tx => tx.append('operation_logs', {
        _id: auditId, organizationId: actor.organizationId, schemaVersion: 1, version: 1,
        deletedAt: null, requestId: actor.requestId, actorUserId: actor.actorUserId,
        actorRole: actor.actorRole, action: 'content-query.previewTeacherAsset',
        targetType: 'learning_resource', targetId: resourceId, result: 'succeeded',
        errorCode: null, occurredAt: this.clock.nowIso(),
        metadata: { contentVersion: projected.item.contentVersion },
      }));
      if (!saved) throw new Error('AUDIT_FAILED');
    } catch { throw new TeacherAssetError('SERVICE_UNAVAILABLE'); }
    const questions = projected.snapshot.questions;
    const scoringKind = projected.item.kind === 'dubbing' ? 'manual'
      : projected.item.kind === 'video' && questions.length === 0 ? 'completion_only'
        : questions.some(question => question.questionType === 'subjective') ? 'manual' : 'automatic';
    return { ...projected.item, scoringKind,
      questions: projected.snapshot.questions.map(question => ({
        questionId: question.questionId, stem: question.stem, options: [...question.options],
      })),
      clips: projected.snapshot.clips.map(clip => ({ ...clip })),
      subtitles: projected.snapshot.subtitleCues?.map(cue => ({ ...cue })) ?? [],
      playback: { temporaryUrl,
        expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60_000).toISOString() } };
  }

  private async authorizedClasses(actor: TrustedActorContext,
    targets: readonly string[] | undefined): Promise<readonly string[]> {
    if (!['student', 'parent', 'teacher', 'admin'].includes(actor.actorRole)
      || !validClassIds(targets)) {
      throw new TeacherAssetError('FORBIDDEN');
    }
    if (actor.actorRole !== 'teacher') return [];
    const grants = await this.organization.listActiveTeacherGrants(actor.organizationId, actor.actorUserId);
    const classes = grants.filter(grant => grant.permissions.includes('content.read')
      && actor.scopeIds.includes(grant.classId)).map(grant => grant.classId);
    return classes;
  }
}

function project(row: VersionedDocument | null, organizationId: string,
  allowedClasses: readonly string[], targets: readonly string[] | undefined):
  Readonly<{ item: TeacherAssetListItem; snapshot: FrozenTeacherMediaSnapshot }> | null {
  void targets;
  if (!row || row.organizationId !== organizationId || row.deletedAt !== null
    || row.status !== 'published' || !['listening', 'video', 'dubbing'].includes(String(row.type))
    || typeof row.title !== 'string' || !row.title.trim()
    || !Number.isSafeInteger(row.contentVersion) || Number(row.contentVersion) < 1
    || !isObject(row.payload)) return null;
  const payload = row.payload as JsonObject;
  if (!hasApprovedAssetLibraryOrigin(payload, row._id, Number(row.contentVersion))
    || !isObject(payload.teacherMedia)) return null;
  const candidate = { ...(payload.teacherMedia as Record<string, unknown>),
    id: row._id, organizationId, kind: row.type,
    title: row.title, version: row.contentVersion, status: row.status,
  } as unknown as TeacherMediaCandidate;
  const allTeachers = candidate.catalogScope === 'all_teachers'
    && isObject(row.visibility) && row.visibility.type === 'organization'
    && isObject(payload.assetLibrary)
    && (payload.assetLibrary.reviewStatus === 'source_verified_reusable'
      || payload.assetLibrary.reviewStatus === 'user_acceptance'
      && payload.assetLibrary.acceptanceScope === 'nonproduction_virtual');
  const mediaClassIds = Array.isArray(candidate.allowedClassIds)
    ? candidate.allowedClassIds.filter((id): id is string => typeof id === 'string') : [];
  const visibleClasses = allTeachers ? [...allowedClasses]
    : allowedClasses.filter(id => mediaClassIds.includes(id));
  const targetClasses = [allTeachers ? 'catalog_preview_probe'
    : mediaClassIds[0] ?? 'catalog_preview_probe'];
  const gated = freezeTeacherMediaForTask(candidate, organizationId, targetClasses);
  if (!gated.ready) return null;
  const item: TeacherAssetListItem = { id: row._id, kind: candidate.kind,
    title: row.title, contentVersion: Number(row.contentVersion),
    grade: typeof row.grade === 'string' && row.grade.trim() ? row.grade : '未标注',
    textbook: typeof row.textbook === 'string' && row.textbook.trim() ? row.textbook : null,
    unit: typeof row.unit === 'string' && row.unit.trim() ? row.unit : null,
    durationMs: gated.snapshot.durationMs,
    questionCount: gated.snapshot.questionIds.length,
    allowedClassIds: [...visibleClasses],
    ...(payload.assetLibrary && isObject(payload.assetLibrary)
      && payload.assetLibrary.reviewStatus === 'user_acceptance'
      ? { acceptanceStatus: 'pending_user_acceptance' as const } : {}) };
  return { item, snapshot: gated.snapshot };
}

function projectPrivate(row: VersionedDocument, actor: TrustedActorContext,
  allowedClasses: readonly string[]):
  Readonly<{ item: TeacherAssetListItem; snapshot: FrozenTeacherMediaSnapshot }> | null {
  if (actor.actorRole !== 'teacher' || row.organizationId !== actor.organizationId
    || row.status !== 'published' || row.type !== 'video' || row.deletedAt !== null
    || row.teacherPrivateOwnerId !== actor.actorUserId || !isObject(row.payload)) return null;
  const payload = row.payload as JsonObject;
  if (!isObject(payload.teacherPrivate)
    || payload.teacherPrivate.ownerTeacherId !== actor.actorUserId
    || !isObject(payload.teacherMedia)) return null;
  const candidate = { ...payload.teacherMedia, id: row._id,
    organizationId: row.organizationId, title: row.title,
    kind: 'video', version: row.contentVersion,
    status: row.status } as unknown as TeacherMediaCandidate;
  const classes = [...allowedClasses];
  if (!classes.length) return null;
  const gated = freezeTeacherMediaForTask(candidate, actor.organizationId,
    [classes[0]!], 'teacher_private');
  if (!gated.ready) return null;
  return { item: { id: row._id, kind: 'video', title: String(row.title),
    contentVersion: Number(row.contentVersion), grade: '未标注', textbook: null, unit: null,
    durationMs: gated.snapshot.durationMs, questionCount: gated.snapshot.questionIds.length,
    allowedClassIds: classes, privateToTeacher: true }, snapshot: gated.snapshot };
}

function matches(item: TeacherAssetListItem, filters: TeacherAssetFilters): boolean {
  if (item.kind !== filters.kind || (filters.grade && item.grade !== filters.grade)
    || (filters.textbook && (filters.textbook === '__unlabeled_textbook__'
      ? item.textbook !== null : item.textbook !== filters.textbook))
    || (filters.unit && (filters.unit === '__unlabeled_unit__'
      ? item.unit !== null : item.unit !== filters.unit))) return false;
  return !filters.keyword || `${item.title} ${item.grade} ${item.textbook ?? ''} ${item.unit ?? ''}`
    .toLocaleLowerCase().includes(filters.keyword.trim().toLocaleLowerCase());
}

function validFilters(filters: TeacherAssetFilters): boolean {
  return !!filters && ['listening', 'video', 'dubbing'].includes(filters.kind)
    && (filters.scope === undefined || filters.scope === 'mine')
    && [filters.keyword, filters.grade, filters.textbook, filters.unit]
      .every(value => value === undefined || typeof value === 'string' && value.length <= 100)
    && validClassIds(filters.targetClassIds);
}
function validClassIds(ids: readonly string[] | undefined): boolean {
  return ids === undefined || Array.isArray(ids) && ids.length > 0 && ids.length <= 50
    && ids.every(validId) && new Set(ids).size === ids.length;
}
function validId(value: string): boolean { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
