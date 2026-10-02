import { ActivityService } from '../../src/activity/activity-service';
import { DocumentActivityRepository } from '../../src/activity/document-repository';
import { ACTIVITY_QUERY_ACTIONS, validateActivityQueryRequest } from '../../src/contracts/activity-functions';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createActivityQueryFunction } from './function-entry';

export { createActivityQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('activity-query', ACTIVITY_QUERY_ACTIONS, (_action, _payload, request) => {
  const validated = validateActivityQueryRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseFunction('activity-query', unavailable,
  (capabilities, infrastructure) => createActivityQueryFunction({ ...infrastructure,
    service: new ActivityService(new DocumentActivityRepository(infrastructure.documents),
      infrastructure.clock, capabilities.identifiers) }));
