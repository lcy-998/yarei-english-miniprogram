import { LEARNING_STATS_ACTIONS, validateLearningStatsRequest } from '../../src/contracts/learning-stats-functions';
import { LearningStatsService } from '../../src/learning-stats/service';
import { createOrgContentDocumentRepository } from '../../src/repositories/org-content-document-adapter';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { DocumentStudentWorkRepository } from '../../src/student-work/document-repository';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createLearningStatsQueryFunction } from './function-entry';

export { createLearningStatsQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('learning-stats-query', LEARNING_STATS_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateLearningStatsRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });

export const main = createDefaultCloudBaseFunction('learning-stats-query', unavailable,
  (capabilities, infrastructure) => createLearningStatsQueryFunction({ ...infrastructure,
    service: new LearningStatsService({
      organization: createOrgContentDocumentRepository(infrastructure.documents),
      tasks: createTaskQueryDocumentRepository(infrastructure.documents),
      works: new DocumentStudentWorkRepository(infrastructure.documents),
      identities: capabilities.identities,
      clock: infrastructure.clock,
      requestIds: infrastructure.requestIds,
    }),
  }));
