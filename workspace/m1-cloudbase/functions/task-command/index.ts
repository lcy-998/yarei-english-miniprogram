import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { TASK_COMMAND_ACTIONS, validateTaskCommandRequest } from '../../src/contracts/task-core-functions';
import { createDefaultCloudBaseTaskCoreFunction } from '../shared/default-cloudbase-function';
import { createTaskCommandFunction } from './function-entry';

export { createTaskCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('task-command', TASK_COMMAND_ACTIONS, (_action, _payload, request) => {
  const validated = validateTaskCommandRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseTaskCoreFunction(
  'task-command',
  unavailable,
  (_capabilities, infrastructure) => createTaskCommandFunction(infrastructure),
);
