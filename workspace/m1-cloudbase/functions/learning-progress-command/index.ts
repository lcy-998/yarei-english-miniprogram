import { LEARNING_PROGRESS_COMMAND_ACTIONS, validateLearningProgressCommandRequest } from '../../src/contracts/learning-progress-functions';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createDefaultCloudBaseLearningProgressFunction } from '../shared/default-cloudbase-function';
import { createLearningProgressCommandFunction } from './function-entry';
export { createLearningProgressCommandFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('learning-progress-command', LEARNING_PROGRESS_COMMAND_ACTIONS, (_action, _payload, request) => {
  const validated = validateLearningProgressCommandRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseLearningProgressFunction(
  'learning-progress-command',
  unavailable,
  (_capabilities, infrastructure) => createLearningProgressCommandFunction({
    ...infrastructure,
    handler: infrastructure.handler,
  }),
);
