import type { JsonObject } from '../shared/protocol';

/** The media task must refer to a reviewed package imported by the central asset library. */
export function hasAssetLibraryOrigin(payload: JsonObject, resourceId: string,
  contentVersion: number): boolean {
  const raw = payload.assetLibrary;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const origin = raw as Record<string, unknown>;
  return origin.kind === 'central_asset_library'
    && origin.resourceId === resourceId
    && origin.version === contentVersion
    && typeof origin.manifestSha256 === 'string'
    && /^[a-f0-9]{64}$/i.test(origin.manifestSha256)
    && typeof origin.reviewId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(origin.reviewId)
    && typeof origin.importedBy === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(origin.importedBy)
    && ['pending', 'approved', 'rejected', 'user_acceptance',
      'source_verified_reusable'].includes(String(origin.reviewStatus));
}

export function hasApprovedAssetLibraryOrigin(payload: JsonObject, resourceId: string,
  contentVersion: number): boolean {
  if (!hasAssetLibraryOrigin(payload, resourceId, contentVersion)) return false;
  const origin = payload.assetLibrary as Record<string, unknown>;
  if (origin.reviewStatus === 'approved') return true;
  if (origin.reviewStatus === 'source_verified_reusable') {
    return origin.verificationScope === 'nonproduction_reusable'
      && origin.testOnly === false && origin.automatedVerifier === 'codex'
      && typeof origin.sourceSha256 === 'string'
      && /^[a-f0-9]{64}$/i.test(origin.sourceSha256);
  }
  return origin.reviewStatus === 'user_acceptance'
    && origin.acceptanceScope === 'nonproduction_virtual'
    && origin.acceptanceStatus === 'pending_user_acceptance'
    && origin.testOnly === true
    && origin.automatedVerifier === 'codex'
    && typeof origin.sourceSha256 === 'string'
    && /^[a-f0-9]{64}$/i.test(origin.sourceSha256);
}
