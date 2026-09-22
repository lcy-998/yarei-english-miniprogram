import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { REVIEW_COMMAND_ACTIONS, validateReviewCommandRequest } from '../../src/contracts/task-core-functions';
import { createDefaultCloudBaseTaskCoreFunction } from '../shared/default-cloudbase-function';
import { createReviewCommandFunction } from './function-entry';

export { createReviewCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('review-command', REVIEW_COMMAND_ACTIONS, (_action, _payload, request) => {
  const validated = validateReviewCommandRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseTaskCoreFunction(
  'review-command',
  unavailable,
  (_capabilities, infrastructure) => createReviewCommandFunction(infrastructure),
);
