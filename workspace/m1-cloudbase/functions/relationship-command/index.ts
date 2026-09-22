import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import {
  RELATIONSHIP_COMMAND_ACTIONS,
  validateRelationshipCommandRequest,
} from '../../src/contracts/org-content-functions';
import { RelationshipService } from '../../src/org-content/relationship-service';
import { createOrgContentDocumentPersistence } from '../../src/repositories/org-content-document-adapter';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createRelationshipCommandFunction } from './function-entry';

export { createRelationshipCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'relationship-command',
  RELATIONSHIP_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateRelationshipCommandRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseFunction(
  'relationship-command',
  unavailable,
  (capabilities, infrastructure) => {
    if (capabilities.bindingCodes === undefined || capabilities.bindingCodeDigest === undefined) {
      throw new Error('Relationship command capability is unavailable.');
    }
    const persistence = createOrgContentDocumentPersistence(infrastructure.documents);
    return createRelationshipCommandFunction({
      ...infrastructure,
      handler: new RelationshipService(
        persistence.repository,
        infrastructure.clock,
        capabilities.identifiers,
        capabilities.bindingCodes,
        capabilities.bindingCodeDigest,
        persistence.idempotency,
      ),
    });
  },
);
