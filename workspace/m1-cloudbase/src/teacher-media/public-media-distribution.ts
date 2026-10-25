import { createHash } from 'node:crypto'
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port'
import { buildVerifiedCentralMediaResource, projectPublicMediaForOrganization,
  type VerifiedCentralMediaInput } from './asset-import'

export class PublicMediaDistributionError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'CONFLICT' | 'SERVICE_UNAVAILABLE') {
    super(code)
  }
}

export function publicMediaProjectionId(sourceId: string, organizationId: string): string {
  return `public_media_${createHash('sha256').update(JSON.stringify([sourceId, organizationId]))
    .digest('hex').slice(0, 40)}`
}

/** Retryable, organization-isolated materialization. No unmarked legacy resource is copied. */
export class PublicMediaDistributionService {
  public constructor(private readonly documents: DocumentDatabasePort,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async importVerified(input: VerifiedCentralMediaInput): Promise<Readonly<{
    sourceId: string; projectedOrganizations: readonly string[] }>> {
    const source = buildVerifiedCentralMediaResource(input)
    const sourceOrganization = await this.documents.get('organizations', source.organizationId)
    if (!sourceOrganization || sourceOrganization.status !== 'active'
      || sourceOrganization.deletedAt !== null) {
      throw new PublicMediaDistributionError('VALIDATION_ERROR')
    }
    await this.documents.runTransaction(async tx => {
      const existing = await tx.get('learning_resources', source._id)
      if (existing) {
        if (!sameSource(existing, source)) throw new PublicMediaDistributionError('CONFLICT')
        return
      }
      if (!await tx.create('learning_resources', source)) throw new PublicMediaDistributionError('CONFLICT')
      if (!await tx.append('operation_logs', {
        _id: `public_media_import_${source._id}`, organizationId: source.organizationId,
        schemaVersion: 1, version: 1, deletedAt: null,
        requestId: `public_media_import_${source._id}`, errorCode: null,
        action: 'asset_library.media.controlled_import', targetType: 'learning_resource',
        targetId: source._id, actorUserId: input.importedBy, actorRole: 'system',
        result: 'succeeded', occurredAt: this.clock.nowIso(),
        metadata: { sourceSha256: input.sourceSha256, manifestSha256: input.manifestSha256 },
      })) throw new PublicMediaDistributionError('CONFLICT')
    })
    const organizationIds = await this.activeOrganizations()
    for (const organizationId of organizationIds) {
      if (organizationId !== source.organizationId) await this.ensureProjection(source._id, organizationId)
    }
    return { sourceId: source._id, projectedOrganizations: organizationIds }
  }

  /** Call when a school is created or reactivated; safe to retry after partial failure. */
  public async syncOrganization(organizationId: string): Promise<number> {
    const org = await this.documents.get('organizations', organizationId)
    if (!org || org._id !== organizationId || org.status !== 'active' || org.deletedAt !== null) {
      throw new PublicMediaDistributionError('VALIDATION_ERROR')
    }
    let offset = 0
    let count = 0
    while (offset <= 10000) {
      const page = await this.documents.findPage('learning_resources', {
        publicCatalogSource: true, status: 'published', deletedAt: null,
      }, { limit: 50, offset })
      for (const source of page.items) {
        if (source.organizationId !== organizationId) {
          await this.ensureProjection(source._id, organizationId)
          count += 1
        }
      }
      if (!page.hasMore) return count
      offset += page.items.length
    }
    throw new PublicMediaDistributionError('SERVICE_UNAVAILABLE')
  }

  private async ensureProjection(sourceId: string, organizationId: string): Promise<void> {
    const id = publicMediaProjectionId(sourceId, organizationId)
    await this.documents.runTransaction(async tx => {
      const source = await tx.get('learning_resources', sourceId)
      if (!source || source.status !== 'published') throw new PublicMediaDistributionError('CONFLICT')
      const next = projectPublicMediaForOrganization(source, organizationId, id)
      const existing = await tx.get('learning_resources', id)
      if (existing) {
        if (!sameProjection(existing, next)) throw new PublicMediaDistributionError('CONFLICT')
        return
      }
      if (!await tx.create('learning_resources', next)) throw new PublicMediaDistributionError('CONFLICT')
      if (!await tx.append('operation_logs', {
        _id: `public_media_projection_${id}`, organizationId,
        schemaVersion: 1, version: 1, deletedAt: null,
        requestId: `public_media_projection_${id}`, errorCode: null,
        action: 'asset_library.media.project_public', targetType: 'learning_resource',
        targetId: id, actorUserId: 'controlled_import', actorRole: 'system',
        result: 'succeeded', occurredAt: this.clock.nowIso(),
        metadata: { sourcePublicId: sourceId },
      })) throw new PublicMediaDistributionError('CONFLICT')
    })
  }

  private async activeOrganizations(): Promise<readonly string[]> {
    const ids: string[] = []
    let offset = 0
    while (offset <= 10000) {
      const page = await this.documents.findPage('organizations',
        { status: 'active', deletedAt: null }, { limit: 50, offset })
      ids.push(...page.items.filter(row => row._id === row.organizationId).map(row => row._id))
      if (!page.hasMore) return ids
      offset += page.items.length
    }
    throw new PublicMediaDistributionError('SERVICE_UNAVAILABLE')
  }
}

function sameSource(left: VersionedDocument, right: VersionedDocument): boolean {
  return left._id === right._id && left.organizationId === right.organizationId
    && left.status === 'published' && left.publicCatalogSource === true
    && JSON.stringify(left.payload) === JSON.stringify(right.payload)
}
function sameProjection(left: VersionedDocument, right: VersionedDocument): boolean {
  const payload = left.payload as Record<string, unknown> | undefined
  const origin = payload?.assetLibrary as Record<string, unknown> | undefined
  const expected = (right.payload as Record<string, unknown>).assetLibrary as Record<string, unknown>
  return left._id === right._id && left.organizationId === right.organizationId
    && left.status === 'published' && origin?.sourcePublicId === expected.sourcePublicId
    && origin?.manifestSha256 === expected.manifestSha256
}
