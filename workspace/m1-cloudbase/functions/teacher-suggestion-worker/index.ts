import { createDefaultCloudBaseServerEventFunction } from '../shared/default-cloudbase-function';

/** Server-only SCF Event entry. The handler verifies a short-lived HMAC before reading data. */
export const main = createDefaultCloudBaseServerEventFunction<unknown>(
  'teacher-suggestion-worker', async () => ({ ok: false, status: 'unavailable' }),
  capabilities => {
    if (!capabilities.teacherSuggestionWorker) throw new Error('Teacher suggestion worker is unavailable');
    return capabilities.teacherSuggestionWorker;
  },
);
