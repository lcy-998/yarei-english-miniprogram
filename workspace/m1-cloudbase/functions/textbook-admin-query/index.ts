import { TEXTBOOK_ADMIN_QUERY_ACTIONS, validateTextbookAdminQueryRequest } from '../../src/contracts/textbook-admin-functions';
import { TextbookAdminService } from '../../src/textbook/admin-service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createTextbookAdminQueryFunction } from './function-entry';

export { createTextbookAdminQueryFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('textbook-admin-query', TEXTBOOK_ADMIN_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateTextbookAdminQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('textbook-admin-query', unavailable,
  (_capabilities, infrastructure) => createTextbookAdminQueryFunction({ ...infrastructure,
    service: new TextbookAdminService(infrastructure.documents, infrastructure.clock) }));
