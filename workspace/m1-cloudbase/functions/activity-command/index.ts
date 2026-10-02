import { ActivityService } from '../../src/activity/activity-service';
import { DocumentActivityRepository } from '../../src/activity/document-repository';
import { ACTIVITY_COMMAND_ACTIONS, validateActivityCommandRequest } from '../../src/contracts/activity-functions';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createActivityCommandFunction } from './function-entry';

export { createActivityCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('activity-command', ACTIVITY_COMMAND_ACTIONS, (_action, _payload, request) => {
  const validated = validateActivityCommandRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseFunction('activity-command', unavailable,
  (capabilities, infrastructure) => createActivityCommandFunction({ ...infrastructure,
    service: new ActivityService(new DocumentActivityRepository(infrastructure.documents),
      infrastructure.clock, capabilities.identifiers) }));
