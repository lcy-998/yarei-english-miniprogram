import { LEARNING_STATS_ACTIONS, validateLearningStatsRequest } from '../../src/contracts/learning-stats-functions';
import type { LearningStatsService } from '../../src/learning-stats/service';
import type { StatsExport, StatsView } from '../../src/learning-stats/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface LearningStatsQueryDependencies extends TrustedFunctionDependencies {
  readonly service: LearningStatsService;
}

export function createLearningStatsQueryFunction(dependencies: LearningStatsQueryDependencies) {
  return createTrustedFunction('learning-stats-query', LEARNING_STATS_ACTIONS, dependencies,
    validateLearningStatsRequest,
    async (input, actor): Promise<ServiceResult<StatsView | StatsExport>> => {
      if (input.action === 'teacherReport') return dependencies.service.teacher(actor, input.filters);
      if (input.action === 'exportTeacherCsv') return dependencies.service.exportTeacherCsv(actor, input.filters);
      return dependencies.service.parent(actor, input.childId, input.filters);
    });
}
