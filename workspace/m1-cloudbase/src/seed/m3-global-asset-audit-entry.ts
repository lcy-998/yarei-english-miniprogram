export { createCloudBaseDocumentDatabase } from '../repositories/cloudbase-document-database';
export { hasCompletePublicLearningMapping } from '../org-content/public-learning-source';
export { hasApprovedAssetLibraryOrigin } from '../teacher-media/asset-library-origin';
export { freezeTeacherMediaForTask } from '../teacher-media/publish-gate';
export { makeLegacyGlobalSource, makeLegacyGlobalProjection,
  legacyGlobalProjectionId, LegacyGlobalDistributionService } from '../global-assets/legacy-global-distribution';
export { hasActiveLegacyGlobalSource } from '../global-assets/legacy-global-source';
export { ContentQueryService } from '../org-content/content-service';
export { createOrgContentDocumentRepository } from '../repositories/org-content-document-adapter';
export { DocumentTextbookRepository } from '../textbook/document-repository';
export { TeacherTextbookService } from '../textbook/service';
