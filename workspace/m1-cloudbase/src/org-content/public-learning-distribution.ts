import { createHash } from 'node:crypto';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { JsonObject } from '../shared/protocol';
import { hasCompletePublicLearningMapping, isVerifiedPublicLearningSource,
  publicLearningContentSha256 } from './public-learning-source';

export interface VerifiedPublicLearningInput {
  readonly resource: VersionedDocument;
  readonly sourceSha256: string;
  readonly manifestSha256: string;
  readonly reviewId: string;
  readonly copyrightEvidenceId: string;
  readonly copyrightEvidenceSha256: string;
  readonly importedBy: string;
  readonly verifiedAt: string;
}
export class PublicLearningDistributionError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'CONFLICT' | 'SERVICE_UNAVAILABLE') {
    super(code);
  }
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function sha(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
export function publicLearningProjectionId(sourceId: string, organizationId: string): string {
  return `public_learning_${createHash('sha256').update(JSON.stringify([sourceId, organizationId]))
    .digest('hex').slice(0, 40)}`;
}

export function buildVerifiedPublicLearningSource(input: VerifiedPublicLearningInput): VersionedDocument {
  const resource = input.resource;
  if (!id(resource?._id) || !id(resource.organizationId)
    || (resource.type !== 'reading' && resource.type !== 'vocabulary')
    || !id(input.reviewId) || !id(input.copyrightEvidenceId) || !id(input.importedBy)
    || !sha(input.sourceSha256) || !sha(input.manifestSha256)
    || !sha(input.copyrightEvidenceSha256)
    || !Number.isFinite(Date.parse(input.verifiedAt))
    || resource.deletedAt !== null || !['draft', 'published'].includes(String(resource.status))
    || !hasCompletePublicLearningMapping(resource)
    || !object(resource.payload)) throw new PublicLearningDistributionError('VALIDATION_ERROR');
  const contentSha256 = publicLearningContentSha256(resource);
  const source: VersionedDocument = { ...resource, version: 1, status: 'published',
    visibility: { type: 'organization' }, copyrightStatus: 'verified',
    publicCatalogSource: true, teacherCatalogOnly: true,
    payload: { ...resource.payload as JsonObject,
      assetLibrary: { kind: 'central_asset_library', resourceId: resource._id,
        version: resource.contentVersion, sourceSha256: input.sourceSha256,
        manifestSha256: input.manifestSha256, reviewId: input.reviewId,
        copyrightEvidenceId: input.copyrightEvidenceId,
        copyrightEvidenceSha256: input.copyrightEvidenceSha256,
        importedBy: input.importedBy, verifiedAt: input.verifiedAt,
        reviewStatus: 'approved', catalogScope: 'all_teachers', contentSha256 } } };
  if (!isVerifiedPublicLearningSource(source)) throw new PublicLearningDistributionError('VALIDATION_ERROR');
  return source;
}

export function projectPublicLearningForOrganization(source: VersionedDocument,
  organizationId: string): VersionedDocument {
  if (!isVerifiedPublicLearningSource(source) || !id(organizationId)) {
    throw new PublicLearningDistributionError('VALIDATION_ERROR');
  }
  const idValue = publicLearningProjectionId(source._id, organizationId);
  const payload = source.payload as JsonObject;
  const origin = payload.assetLibrary as JsonObject;
  return { ...source, _id: idValue, organizationId, version: 1,
    publicCatalogSource: false, publicLearningProjection: true,
    payload: { ...payload, assetLibrary: { ...origin,
      resourceId: idValue, sourcePublicId: source._id } } };
}

export class PublicLearningDistributionService {
  public constructor(private readonly documents: DocumentDatabasePort,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async importVerified(input: VerifiedPublicLearningInput,
    expectedOrganizationIds?: readonly string[]): Promise<Readonly<{
      sourceId: string; projectedOrganizations: readonly string[] }>> {
    const source = buildVerifiedPublicLearningSource(input);
    const organizations = await this.activeOrganizations();
    if (expectedOrganizationIds && JSON.stringify([...expectedOrganizationIds].sort())
      !== JSON.stringify([...organizations].sort())) throw new PublicLearningDistributionError('CONFLICT');
    await this.documents.runTransaction(async tx => {
      const existing = await tx.get('learning_resources', source._id);
      if (existing) {
        if (!sameSource(existing, source)) throw new PublicLearningDistributionError('CONFLICT');
        return;
      }
      if (!await tx.create('learning_resources', source)
        || !await tx.append('operation_logs', {
          _id: `public_learning_import_${source._id}`,
          organizationId: source.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
          requestId: `public_learning_import_${source._id}`, errorCode: null,
          action: 'asset_library.learning.controlled_import',
          targetType: 'learning_resource', targetId: source._id,
          actorUserId: input.importedBy, actorRole: 'system', result: 'succeeded',
          occurredAt: this.clock.nowIso(), metadata: {
            sourceSha256: input.sourceSha256, manifestSha256: input.manifestSha256,
            copyrightEvidenceSha256: input.copyrightEvidenceSha256 },
        })) throw new PublicLearningDistributionError('CONFLICT');
    });
    for (const organizationId of organizations) {
      if (organizationId !== source.organizationId) await this.ensureProjection(source._id, organizationId);
    }
    return { sourceId: source._id, projectedOrganizations: organizations };
  }

  public async syncOrganization(organizationId: string): Promise<number> {
    const org = await this.documents.get('organizations', organizationId);
    if (!org || org._id !== organizationId || org.status !== 'active' || org.deletedAt !== null) {
      throw new PublicLearningDistributionError('VALIDATION_ERROR');
    }
    let offset = 0;
    let count = 0;
    while (offset <= 10000) {
      const page = await this.documents.findPage('learning_resources',
        { publicCatalogSource: true, status: 'published', deletedAt: null }, { limit: 50, offset });
      for (const source of page.items) {
        if (source.organizationId !== organizationId && isVerifiedPublicLearningSource(source)) {
          await this.ensureProjection(source._id, organizationId);
          count += 1;
        }
      }
      if (!page.hasMore) return count;
      offset += page.items.length;
    }
    throw new PublicLearningDistributionError('SERVICE_UNAVAILABLE');
  }

  private async ensureProjection(sourceId: string, organizationId: string): Promise<void> {
    const projectionId = publicLearningProjectionId(sourceId, organizationId);
    await this.documents.runTransaction(async tx => {
      const source = await tx.get('learning_resources', sourceId);
      const projected = source ? projectPublicLearningForOrganization(source, organizationId) : null;
      if (!projected) throw new PublicLearningDistributionError('CONFLICT');
      const existing = await tx.get('learning_resources', projectionId);
      if (existing) {
        if (!sameProjection(existing, projected)) throw new PublicLearningDistributionError('CONFLICT');
        return;
      }
      if (!await tx.create('learning_resources', projected)
        || !await tx.append('operation_logs', {
          _id: `public_learning_projection_${projectionId}`,
          organizationId, schemaVersion: 1, version: 1, deletedAt: null,
          requestId: `public_learning_projection_${projectionId}`, errorCode: null,
          action: 'asset_library.learning.project_public',
          targetType: 'learning_resource', targetId: projectionId,
          actorUserId: 'controlled_import', actorRole: 'system',
          result: 'succeeded', occurredAt: this.clock.nowIso(),
          metadata: { sourcePublicId: sourceId },
        })) throw new PublicLearningDistributionError('CONFLICT');
    });
  }

  private async activeOrganizations(): Promise<readonly string[]> {
    const ids: string[] = [];
    let offset = 0;
    while (offset <= 10000) {
      const page = await this.documents.findPage('organizations',
        { status: 'active', deletedAt: null }, { limit: 50, offset });
      ids.push(...page.items.filter(row => row._id === row.organizationId).map(row => row._id));
      if (!page.hasMore) return ids;
      offset += page.items.length;
    }
    throw new PublicLearningDistributionError('SERVICE_UNAVAILABLE');
  }
}
function sameSource(left: VersionedDocument, right: VersionedDocument): boolean {
  return left._id === right._id && left.organizationId === right.organizationId
    && left.publicCatalogSource === true && left.status === 'published'
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}
function sameProjection(left: VersionedDocument, right: VersionedDocument): boolean {
  return left._id === right._id && left.organizationId === right.organizationId
    && left.publicLearningProjection === true && left.status === 'published'
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}
