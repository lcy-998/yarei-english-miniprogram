import { describe, expect, it } from 'vitest';
import { hasApprovedAssetLibraryOrigin } from '../../src/teacher-media/asset-library-origin';

const resourceId = 'res_m3_demo_video';
const origin = { kind: 'central_asset_library', resourceId, version: 1,
  manifestSha256: 'a'.repeat(64), reviewId: 'auto_review_demo', importedBy: 'codex_asset_import',
  reviewStatus: 'user_acceptance', acceptanceScope: 'nonproduction_virtual',
  acceptanceStatus: 'pending_user_acceptance', automatedVerifier: 'codex', testOnly: true,
  sourceSha256: 'b'.repeat(64) };

describe('nonproduction media user acceptance provenance', () => {
  it('accepts a source-bound automated record and rejects an incomplete or production-shaped claim', () => {
    expect(hasApprovedAssetLibraryOrigin({ assetLibrary: origin }, resourceId, 1)).toBe(true);
    expect(hasApprovedAssetLibraryOrigin({ assetLibrary: { ...origin, testOnly: false } }, resourceId, 1)).toBe(false);
    expect(hasApprovedAssetLibraryOrigin({ assetLibrary: { ...origin, sourceSha256: '' } }, resourceId, 1)).toBe(false);
    expect(hasApprovedAssetLibraryOrigin({ assetLibrary: { ...origin, reviewStatus: 'pending' } }, resourceId, 1)).toBe(false);
  });
});
