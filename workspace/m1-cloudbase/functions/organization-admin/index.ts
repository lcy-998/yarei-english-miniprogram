import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import {
  ORGANIZATION_ADMIN_ACTIONS,
  validateOrganizationAdminRequest,
} from '../../src/contracts/org-content-functions';
import { OrganizationService } from '../../src/org-content/organization-service';
import { createOrgContentDocumentPersistence } from '../../src/repositories/org-content-document-adapter';
import { createTaskQueryDocumentRepository } from '../../src/repositories/task-query-document-adapter';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createOrganizationAdminFunction } from './function-entry';

export { createOrganizationAdminFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'organization-admin',
  ORGANIZATION_ADMIN_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateOrganizationAdminRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseFunction(
  'organization-admin',
  unavailable,
  (capabilities, infrastructure) => {
    const persistence = createOrgContentDocumentPersistence(infrastructure.documents);
    return createOrganizationAdminFunction({
      ...infrastructure,
      handler: new OrganizationService(
        persistence.repository,
        infrastructure.clock,
        capabilities.identifiers,
        persistence.idempotency,
        createTaskQueryDocumentRepository(infrastructure.documents),
      ),
    });
  },
);
