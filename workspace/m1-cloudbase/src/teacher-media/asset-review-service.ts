import { createHash, randomUUID } from 'node:crypto';
import type { TrustedActorContext } from '../auth/trusted-actor';
import { authorizeNativeAdmin, type NativeAdminGrantReader } from '../native-admin/authorization';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { JsonObject } from '../shared/protocol';
import { hasAssetLibraryOrigin } from './asset-library-origin';
import { freezeTeacherMediaForTask, type TeacherMediaCandidate } from './publish-gate';

export interface AssetReviewReceipt {
  readonly id: string;
  readonly status: 'approved' | 'rejected' | 'published' | 'offline' | 'pending_review';
  readonly recordVersion: number;
  readonly reviewVersion: number | null;
}

export class AssetReviewError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
    | 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE') { super(code); }
}

/** A-08 writes the same learning_resources record that teachers later select. */
export class AssetReviewService {
  public constructor(private readonly documents: DocumentDatabasePort,
    private readonly grants: NativeAdminGrantReader,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public review(actor: TrustedActorContext, resourceId: string, expectedVersion: number,
    operationId: string, decision: 'approved' | 'rejected', reason: string): Promise<AssetReviewReceipt> {
    if (decision !== 'approved' && decision !== 'rejected'
      || typeof reason !== 'string' || reason.length > 300
      || decision === 'rejected' && !reason.trim()) throw new AssetReviewError('VALIDATION_ERROR');
    return this.transition(actor, resourceId, expectedVersion, operationId,
      decision, reason, (row, media, origin) => {
        if (media.status !== 'pending_review' || origin.reviewStatus !== 'pending') {
          throw new AssetReviewError('CONFLICT');
        }
        if (origin.importedBy === actor.actorUserId) throw new AssetReviewError('FORBIDDEN');
        if (decision === 'rejected') return {
          row: { ...row, version: row.version + 1, payload: { ...row.payload as JsonObject,
            assetLibrary: { ...origin, reviewStatus: 'rejected' },
            teacherMedia: { ...media, status: 'rejected', reviewVersion: null,
              reviewedBy: actor.actorUserId, reviewedAt: this.clock.nowIso(),
              rejectionReason: reason.trim() } } },
          receipt: { id: resourceId, status: 'rejected', recordVersion: row.version + 1, reviewVersion: null },
        };
        const approvedMedia = { ...media, status: 'approved', reviewVersion: row.contentVersion,
          reviewedBy: actor.actorUserId, reviewedAt: this.clock.nowIso(),
          copyrightStatus: 'verified', rejectionReason: null };
        const probe = freezeTeacherMediaForTask({ ...approvedMedia, id: resourceId,
          organizationId: actor.organizationId, title: row.title, kind: row.type,
          version: row.contentVersion, status: 'published' } as unknown as TeacherMediaCandidate,
        actor.organizationId, classIds(row));
        if (!probe.ready) throw new AssetReviewError('VALIDATION_ERROR');
        return { row: { ...row, version: row.version + 1, payload: { ...row.payload as JsonObject,
          assetLibrary: { ...origin, reviewStatus: 'approved' }, teacherMedia: approvedMedia } },
        receipt: { id: resourceId, status: 'approved', recordVersion: row.version + 1,
          reviewVersion: Number(row.contentVersion) } };
      });
  }

  public publish(actor: TrustedActorContext, resourceId: string, expectedVersion: number,
    operationId: string): Promise<AssetReviewReceipt> {
    return this.transition(actor, resourceId, expectedVersion, operationId, 'publish', '',
      (row, media, origin) => {
        if (media.status !== 'approved' || origin.reviewStatus !== 'approved'
          || row.status !== 'draft') throw new AssetReviewError('CONFLICT');
        const publishedMedia = { ...media, status: 'published' };
        const probe = freezeTeacherMediaForTask({ ...publishedMedia, id: resourceId,
          organizationId: actor.organizationId, title: row.title, kind: row.type,
          version: row.contentVersion } as unknown as TeacherMediaCandidate,
        actor.organizationId, classIds(row));
        if (!probe.ready) throw new AssetReviewError('VALIDATION_ERROR');
        return { row: { ...row, version: row.version + 1, status: 'published',
          payload: { ...row.payload as JsonObject, teacherMedia: publishedMedia } },
        receipt: { id: resourceId, status: 'published', recordVersion: row.version + 1,
          reviewVersion: Number(row.contentVersion) } };
      });
  }

  public unpublish(actor: TrustedActorContext, resourceId: string, expectedVersion: number,
    operationId: string, reason: string): Promise<AssetReviewReceipt> {
    if (!reason.trim() || reason.length > 200) throw new AssetReviewError('VALIDATION_ERROR');
    return this.transition(actor, resourceId, expectedVersion, operationId, 'unpublish', reason,
      (row, media) => {
        if (row.status !== 'published' || media.status !== 'published') {
          throw new AssetReviewError('CONFLICT');
        }
        const nextMedia = { ...media, status: 'offline', unpublishedAt: this.clock.nowIso(),
          unpublishedBy: actor.actorUserId, unpublishReason: reason.trim() };
        return { row: { ...row, version: row.version + 1, status: 'offline',
          updatedAt: this.clock.nowIso(), payload: { ...row.payload as JsonObject,
            teacherMedia: nextMedia } },
        receipt: { id: resourceId, status: 'offline', recordVersion: row.version + 1,
          reviewVersion: Number(row.contentVersion) } };
      });
  }

  /** Records a concrete issue without silently changing assignability. */
  public reportIssue(actor: TrustedActorContext, resourceId: string, expectedVersion: number,
    operationId: string, reason: string): Promise<AssetReviewReceipt> {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 300) {
      throw new AssetReviewError('VALIDATION_ERROR');
    }
    return this.transition(actor, resourceId, expectedVersion, operationId, 'issue', reason,
      (row, media) => ({ row: { ...row, version: row.version + 1,
        updatedAt: this.clock.nowIso() }, receipt: { id: resourceId,
        status: media.status === 'published' || media.status === 'offline'
          || media.status === 'approved' || media.status === 'rejected'
          ? media.status : 'pending_review', recordVersion: row.version + 1,
        reviewVersion: typeof media.reviewVersion === 'number' ? media.reviewVersion : null } }));
  }

  private async transition(actor: TrustedActorContext, resourceId: string,
    expectedVersion: number, operationId: string, action: string, reason: string,
    decide: (row: VersionedDocument, media: Record<string, unknown>,
      origin: Record<string, unknown>) => Readonly<{ row: VersionedDocument; receipt: AssetReviewReceipt }>):
    Promise<AssetReviewReceipt> {
    if (!validId(resourceId) || !validId(operationId) || operationId.length < 8
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new AssetReviewError('VALIDATION_ERROR');
    }
    const operationKey = `asset_review_${createHash('sha256').update(JSON.stringify([
      actor.organizationId, actor.actorUserId, operationId,
    ])).digest('hex')}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([
      resourceId, expectedVersion, action, reason,
    ])).digest('hex');
    try {
      return await this.documents.runTransaction(async tx => {
        const row = await tx.get('learning_resources', resourceId);
        if (!row || row.organizationId !== actor.organizationId || row.deletedAt !== null
          || (row.type !== 'listening' && row.type !== 'video' && row.type !== 'dubbing')
          || typeof row.title !== 'string' || !row.title.trim()
          || !Number.isSafeInteger(row.contentVersion) || !isObject(row.payload)
          || !hasAssetLibraryOrigin(row.payload as JsonObject, resourceId, Number(row.contentVersion))) {
          throw new AssetReviewError('NOT_FOUND');
        }
        await this.authorize(actor, row);
        const origin = row.payload.assetLibrary as Record<string, unknown>;
        const media = isObject(row.payload.teacherMedia) ? row.payload.teacherMedia : null;
        if (!media) throw new AssetReviewError('VALIDATION_ERROR');
        const existing = await tx.get('native_admin_content_operations', operationKey);
        if (existing) {
          if (existing.organizationId !== actor.organizationId || existing.fingerprint !== fingerprint
            || !isObject(existing.receipt)) throw new AssetReviewError('CONFLICT');
          return existing.receipt as unknown as AssetReviewReceipt;
        }
        if (row.version !== expectedVersion) throw new AssetReviewError('CONFLICT');
        const next = decide(row, media, origin);
        if (action === 'unpublish' && typeof origin.sourcePublicId === 'string') {
          const source = await tx.get('learning_resources', origin.sourcePublicId);
          if (!source || source.publicCatalogSource !== true
            || !isObject(source.payload)
            || !isObject(source.payload.assetLibrary)
            || source.payload.assetLibrary.manifestSha256 !== origin.manifestSha256
            || source.payload.assetLibrary.sourceSha256 !== origin.sourceSha256
            || source.status !== 'published' && source.status !== 'offline') {
            throw new AssetReviewError('CONFLICT');
          }
          if (source.status === 'published') {
            const sourceMedia = isObject(source.payload.teacherMedia)
              ? source.payload.teacherMedia : null;
            if (!sourceMedia) throw new AssetReviewError('CONFLICT');
            if (!await tx.replace('learning_resources', source._id, source.version, {
              ...source, version: source.version + 1, status: 'offline',
              updatedAt: this.clock.nowIso(), payload: { ...source.payload,
                teacherMedia: { ...sourceMedia, status: 'offline',
                  unpublishedAt: this.clock.nowIso(), unpublishedBy: actor.actorUserId,
                  unpublishReason: reason.trim() } },
            })) throw new AssetReviewError('CONFLICT');
          }
        }
        if (!await tx.replace('learning_resources', resourceId, row.version, next.row)) {
          throw new AssetReviewError('CONFLICT');
        }
        if (!await tx.append('native_admin_content_operations', {
          _id: operationKey, organizationId: actor.organizationId, schemaVersion: 1, version: 1,
          deletedAt: null, actorUserId: actor.actorUserId, operationId,
          fingerprint, receipt: { ...next.receipt },
        })) throw new AssetReviewError('CONFLICT');
        if (!await tx.append('operation_logs', {
          _id: `asset_review_audit_${randomUUID()}`, organizationId: actor.organizationId,
          schemaVersion: 1, version: 1, deletedAt: null, requestId: actor.requestId,
          actorUserId: actor.actorUserId, actorRole: actor.actorRole,
          action: `asset_library.media.${action}`, targetType: 'learning_resource',
          targetId: resourceId, result: 'succeeded', errorCode: null,
          occurredAt: this.clock.nowIso(), metadata: { reasonProvided: !!reason.trim(),
            ...(action === 'issue' ? { issueReason: reason.trim() } : {}),
            contentVersion: Number(row.contentVersion) },
        })) throw new AssetReviewError('CONFLICT');
        return next.receipt;
      });
    } catch (error: unknown) {
      if (error instanceof AssetReviewError) throw error;
      throw new AssetReviewError('SERVICE_UNAVAILABLE');
    }
  }

  private async authorize(actor: TrustedActorContext, row: VersionedDocument): Promise<void> {
    const visibility = isObject(row.visibility) ? row.visibility : null;
    if (visibility?.type !== 'classes' && visibility?.type !== 'organization') {
      throw new AssetReviewError('FORBIDDEN');
    }
    const decision = await authorizeNativeAdmin(this.grants, actor, 'media.review');
    if (!decision.allowed) throw new AssetReviewError('FORBIDDEN');
    if (visibility.type === 'organization' && !decision.scope.organizationWide) {
      throw new AssetReviewError('FORBIDDEN');
    }
    const classes = classIds(row);
    if (visibility.type === 'classes' && (!classes.length || classes.some(id =>
      !decision.scope.organizationWide && !decision.scope.classIds.includes(id)))) {
      throw new AssetReviewError('FORBIDDEN');
    }
  }
}

function classIds(row: VersionedDocument): string[] {
  const visibility = isObject(row.visibility) ? row.visibility : null;
  if (visibility?.type === 'classes' && Array.isArray(visibility.classIds)) {
    return visibility.classIds.filter((id): id is string => typeof id === 'string');
  }
  const payload = isObject(row.payload) ? row.payload : null;
  const media = isObject(payload?.teacherMedia) ? payload.teacherMedia : null;
  return visibility?.type === 'organization' && Array.isArray(media?.allowedClassIds)
    ? media.allowedClassIds.filter((id): id is string => typeof id === 'string') : [];
}
function validId(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
