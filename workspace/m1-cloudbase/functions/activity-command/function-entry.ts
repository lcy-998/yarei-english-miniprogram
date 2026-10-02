import { ACTIVITY_COMMAND_ACTIONS, validateActivityCommandRequest } from '../../src/contracts/activity-functions';
import type { ActivityService } from '../../src/activity/activity-service';
import type { ActivityEntity, ActivityOverrideRecord } from '../../src/activity/types';
import type { ServiceResult } from '../../src/shared/protocol';
import { createMeta, success } from '../../src/shared/result';
import { createActivityFailureMapper } from '../shared/activity-failure';
import { createTrustedFunction, type TrustedFunctionDependencies } from '../shared/trusted-function';

export interface ActivityCommandDependencies extends TrustedFunctionDependencies { readonly service: ActivityService }

export function createActivityCommandFunction(dependencies: ActivityCommandDependencies) {
  return createTrustedFunction(
    'activity-command', ACTIVITY_COMMAND_ACTIONS,
    { ...dependencies, mapFailure: createActivityFailureMapper(dependencies.mapFailure) },
    validateActivityCommandRequest,
    async (input, actor): Promise<ServiceResult<ActivityEntity | ActivityOverrideRecord>> => {
      const result = input.action === 'saveDraft'
        ? await dependencies.service.saveDraft(actor, input.draft, input.expectedVersion, input.operationId)
        : input.action === 'publish'
          ? await dependencies.service.publish(actor, input.activityId, input.expectedVersion, input.operationId)
          : input.action === 'addFutureRestDay'
            ? await dependencies.service.addFutureRestDay(actor, input.activityId, input.date, input.reason,
              input.expectedVersion, input.operationId)
            : await dependencies.service.setOverride(actor, input, input.expectedVersion, input.operationId);
      return success(result, createMeta(dependencies.clock, dependencies.requestIds));
    },
  );
}
