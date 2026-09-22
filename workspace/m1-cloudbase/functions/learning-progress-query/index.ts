import { LEARNING_PROGRESS_QUERY_ACTIONS, validateLearningProgressQueryRequest } from '../../src/contracts/learning-progress-functions';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createDefaultCloudBaseLearningProgressFunction } from '../shared/default-cloudbase-function';
import { createLearningProgressQueryFunction } from './function-entry';
export { createLearningProgressQueryFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('learning-progress-query', LEARNING_PROGRESS_QUERY_ACTIONS, (_action, _payload, request) => {
  const validated = validateLearningProgressQueryRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseLearningProgressFunction(
  'learning-progress-query',
  unavailable,
  (_capabilities, infrastructure) => createLearningProgressQueryFunction({
    ...infrastructure,
    handler: infrastructure.handler,
  }),
);
