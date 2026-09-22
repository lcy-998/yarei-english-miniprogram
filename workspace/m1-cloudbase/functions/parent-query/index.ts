import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { PARENT_QUERY_ACTIONS, validateParentQueryRequest } from '../../src/contracts/task-core-functions';
import { createDefaultCloudBaseTaskQueryFunction } from '../shared/default-cloudbase-function';
import { createParentQueryFunction } from './function-entry';

export { createParentQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('parent-query', PARENT_QUERY_ACTIONS, (_action, _payload, request) => {
  const validated = validateParentQueryRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseTaskQueryFunction(
  'parent-query',
  unavailable,
  (_capabilities, infrastructure) => createParentQueryFunction({
    ...infrastructure,
    handler: infrastructure.parentHandler,
  }),
);
