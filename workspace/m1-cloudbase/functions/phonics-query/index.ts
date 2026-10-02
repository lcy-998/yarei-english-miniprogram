import { PHONICS_QUERY_ACTIONS, validatePhonicsQueryRequest } from '../../src/contracts/phonics-functions';
import { DocumentPhonicsRepository } from '../../src/phonics/document-repository';
import { PhonicsService } from '../../src/phonics/service';
import { CloudBaseWorkPlayback } from '../../src/student-work/cloudbase-playback';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createPhonicsQueryFunction } from './function-entry';

export { createPhonicsQueryFunction } from './function-entry';
const unavailable = createUnconfiguredFunction('phonics-query', PHONICS_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validatePhonicsQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('phonics-query', unavailable,
  (capabilities, infrastructure) => createPhonicsQueryFunction({ ...infrastructure,
    service: new PhonicsService(new DocumentPhonicsRepository(infrastructure.documents),
      infrastructure.clock, capabilities.identifiers,
      capabilities.playbackStorage ? new CloudBaseWorkPlayback(capabilities.playbackStorage) : null) }));
