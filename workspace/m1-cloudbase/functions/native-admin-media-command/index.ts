import { AssetReviewService } from '../../src/teacher-media/asset-review-service';
import { DocumentNativeAdminGrantRepository } from '../../src/native-admin/document-grant-repository';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createNativeAdminMediaFunction, NATIVE_ADMIN_MEDIA_ACTIONS,
  validateNativeAdminMediaRequest } from './function-entry';

export { createNativeAdminMediaFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('native-admin-media-command', NATIVE_ADMIN_MEDIA_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateNativeAdminMediaRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('native-admin-media-command', unavailable,
  (_capabilities, infrastructure) => {
    const grants = new DocumentNativeAdminGrantRepository(infrastructure.documents);
    return createNativeAdminMediaFunction({ ...infrastructure,
      media: new AssetReviewService(infrastructure.documents, grants, infrastructure.clock) });
  });

