import { TEXTBOOK_ADMIN_COMMAND_ACTIONS, validateTextbookAdminCommandRequest } from '../../src/contracts/textbook-admin-functions';
import { TextbookAdminService } from '../../src/textbook/admin-service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createTextbookAdminCommandFunction } from './function-entry';

export { createTextbookAdminCommandFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('textbook-admin-command', TEXTBOOK_ADMIN_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateTextbookAdminCommandRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('textbook-admin-command', unavailable,
  (_capabilities, infrastructure) => createTextbookAdminCommandFunction({ ...infrastructure,
    service: new TextbookAdminService(infrastructure.documents, infrastructure.clock) }));
