import type { DocumentDatabaseReaderPort, VersionedDocument } from '../repositories/document-database-port'
import type { JsonObject } from '../shared/protocol'
import { hasApprovedAssetLibraryOrigin } from './asset-library-origin'

/** A projected asset fails closed as soon as its central source is taken down. */
export async function hasActivePublicMediaSource(reader: DocumentDatabaseReaderPort,
  resource: VersionedDocument): Promise<boolean> {
  const payload = object(resource.payload)
  const origin = object(payload?.assetLibrary)
  if (resource.publicCatalogSource === false && !origin?.sourcePublicId) return false
  if (!origin || !('sourcePublicId' in origin)) return true
  if (typeof origin.sourcePublicId !== 'string') return false
  const sourceId = origin.sourcePublicId
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sourceId) || sourceId === resource._id) return false
  const source = await reader.get('learning_resources', sourceId)
  const sourcePayload = object(source?.payload)
  const sourceOrigin = object(sourcePayload?.assetLibrary)
  return !!source && !!sourcePayload && !!sourceOrigin
    && source.publicCatalogSource === true && source.status === 'published'
    && source.deletedAt === null
    && resource.status === 'published'
    && hasApprovedAssetLibraryOrigin(sourcePayload as JsonObject,
      source._id, Number(source.contentVersion))
    && origin.manifestSha256 === sourceOrigin.manifestSha256
    && origin.sourceSha256 === sourceOrigin.sourceSha256
    && origin.version === sourceOrigin.version
    && resource.type === source.type
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}
