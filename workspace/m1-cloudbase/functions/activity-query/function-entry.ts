import { ACTIVITY_QUERY_ACTIONS, validateActivityQueryRequest } from '../../src/contracts/activity-functions';
import type { ActivityService } from '../../src/activity/activity-service';
import type { ActivityDayView, ActivityEntity, ActivityLeaderboardView, ActivityOverrideState } from '../../src/activity/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createActivityFailureMapper } from '../shared/activity-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface ActivityQueryDependencies extends TrustedFunctionDependencies { readonly service: ActivityService }

export function createActivityQueryFunction(dependencies: ActivityQueryDependencies) {
  return createTrustedFunction(
    'activity-query', ACTIVITY_QUERY_ACTIONS,
    { ...dependencies, mapFailure: createActivityFailureMapper(dependencies.mapFailure) },
    validateActivityQueryRequest,
    async (input, actor): Promise<ServiceResult<ActivityEntity | readonly ActivityEntity[] | ActivityDayView | ActivityOverrideState | ActivityLeaderboardView>> => {
      const result = input.action === 'listForTeacher'
        ? await dependencies.service.listForTeacher(actor)
        : input.action === 'listForStudent' ? await dependencies.service.listForStudent(actor)
        : input.action === 'getMyDay' ? await dependencies.service.getMyDay(actor, input.activityId, input.date)
          : input.action === 'getOverrideForTeacher'
            ? await dependencies.service.getOverrideForTeacher(actor, input.activityId, input.studentId, input.date)
            : input.action === 'getLeaderboard' ? await dependencies.service.getLeaderboard(actor, input.activityId)
            : await dependencies.service.getForStudent(actor, input.activityId);
      return success(result, createMeta(dependencies.clock, dependencies.requestIds));
    },
  );
}
