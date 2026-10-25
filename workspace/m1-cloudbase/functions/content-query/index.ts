import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { CONTENT_QUERY_ACTIONS, validateContentQueryRequest } from '../../src/contracts/org-content-functions';
import { createDefaultCloudBaseContentQueryFunction } from '../shared/default-cloudbase-function';
import { createContentQueryFunction } from './function-entry';
import { TeacherAssetCatalogService } from '../../src/teacher-media/asset-catalog-service';
import { createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';
import { HistoricalTaskLearningService } from '../../src/org-content/historical-task-learning-service';

export { createContentQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'content-query',
  CONTENT_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateContentQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseContentQueryFunction(
  unavailable,
  (capabilities, infrastructure) => createContentQueryFunction({
    ...infrastructure,
    handler: infrastructure.handler,
    teacherAssets: new TeacherAssetCatalogService(infrastructure.documents,
      createOrgContentDocumentRepository(infrastructure.documents),
      capabilities.playbackStorage, infrastructure.clock),
    ...(capabilities.playbackStorage === undefined
      ? {} : { readingMediaStorage: capabilities.playbackStorage,
        historicalLearning: new HistoricalTaskLearningService(infrastructure.documents,
          capabilities.playbackStorage, infrastructure.clock) }),
  }),
);
