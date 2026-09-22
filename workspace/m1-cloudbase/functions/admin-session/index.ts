import { ADMIN_SESSION_ACTIONS, validateAdminSessionRequest } from '../../src/contracts/admin-session';
import { createDefaultCloudBaseAdminSessionFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createAdminSessionFunction } from './function-entry';

export { createAdminSessionFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'admin-session',
  ADMIN_SESSION_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateAdminSessionRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseAdminSessionFunction(
  unavailable,
  (_capabilities, dependencies) => createAdminSessionFunction(dependencies),
);
