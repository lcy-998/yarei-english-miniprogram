import type { DocumentDatabaseReaderPort, VersionedDocument } from '../repositories/document-database-port';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/i;

/** Explicitly migrated legacy teaching content; student/task snapshots remain separately authorized. */
export async function hasActiveLegacyGlobalSource(
  reader: DocumentDatabaseReaderPort,
  resource: VersionedDocument,
): Promise<boolean> {
  if (resource.globalCatalogProjection !== true) return true;
  const sourceId = resource.globalSourceId;
  const sourceVersion = resource.globalSourceVersion;
  const fingerprint = resource.globalSourceFingerprint;
  if (typeof sourceId !== 'string' || !ID.test(sourceId) || sourceId === resource._id
    || !Number.isSafeInteger(sourceVersion) || Number(sourceVersion) < 1
    || typeof fingerprint !== 'string' || !HASH.test(fingerprint)
    || resource.status !== 'published' || resource.deletedAt !== null) return false;
  const source = await reader.get('learning_resources', sourceId);
  return !!source && source.globalCatalogSource === true
    && source.status === 'published' && source.deletedAt === null
    && source.version === sourceVersion
    && source.globalCatalogFingerprint === fingerprint
    && source.type === resource.type && source.contentVersion === resource.contentVersion
    && source.organizationId !== resource.organizationId;
}
