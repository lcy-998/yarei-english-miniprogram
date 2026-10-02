import { PHONICS_COMMAND_ACTIONS, validatePhonicsCommandRequest } from '../../src/contracts/phonics-functions';
import { DocumentPhonicsRepository } from '../../src/phonics/document-repository';
import { PhonicsService } from '../../src/phonics/service';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createPhonicsCommandFunction } from './function-entry';

export { createPhonicsCommandFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('phonics-command', PHONICS_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const validated = validatePhonicsCommandRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('phonics-command', unavailable,
  (capabilities, infrastructure) => createPhonicsCommandFunction({ ...infrastructure,
    service: new PhonicsService(new DocumentPhonicsRepository(infrastructure.documents),
      infrastructure.clock, capabilities.identifiers) }));
