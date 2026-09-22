import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { CONTENT_QUERY_ACTIONS, validateContentQueryRequest } from '../../src/contracts/org-content-functions';
import { createDefaultCloudBaseContentQueryFunction } from '../shared/default-cloudbase-function';
import { createContentQueryFunction } from './function-entry';

export { createContentQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'content-query',
  CONTENT_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateContentQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseContentQueryFunction(
  unavailable,
  (_capabilities, infrastructure) => createContentQueryFunction({
    ...infrastructure,
    handler: infrastructure.handler,
  }),
);
