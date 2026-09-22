import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { AUTH_SESSION_ACTIONS, validateAuthRequest } from '../../src/contracts/auth-session';
import { createDefaultCloudBaseAuthFunction } from '../shared/default-cloudbase-function';
import { createAuthSessionFunction } from './function-entry';

export { createAuthSessionFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('auth-session', AUTH_SESSION_ACTIONS, (_action, _payload, request) => {
  const validated = validateAuthRequest(request);
  return validated.ok ? null : validated.fieldErrors;
});

export const main = createDefaultCloudBaseAuthFunction(
  unavailable,
  (_capabilities, dependencies) => createAuthSessionFunction(dependencies),
);
