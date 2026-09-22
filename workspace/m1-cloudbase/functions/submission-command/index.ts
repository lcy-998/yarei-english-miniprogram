import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { SUBMISSION_COMMAND_ACTIONS, validateSubmissionCommandRequest } from '../../src/contracts/task-core-functions';
import { createDefaultCloudBaseTaskCoreFunction } from '../shared/default-cloudbase-function';
import { createSubmissionCommandFunction } from './function-entry';

export { createSubmissionCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('submission-command', SUBMISSION_COMMAND_ACTIONS, (_action, _payload, request) => {
  const validated = validateSubmissionCommandRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseTaskCoreFunction(
  'submission-command',
  unavailable,
  (_capabilities, infrastructure) => createSubmissionCommandFunction(infrastructure),
);
