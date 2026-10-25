import { createDefaultCloudBaseServerEventFunction } from '../shared/default-cloudbase-function';

/**
 * Internal-only signed worker entry. CloudBase invoke rules must deny clients;
 * the event HMAC is checked again by the injected worker handler.
 */
export const main = createDefaultCloudBaseServerEventFunction<unknown>(
  'pronunciation-worker',
  async () => ({ ok: false, status: 'unavailable' }),
  capabilities => {
    if (!capabilities.pronunciationWorker) throw new Error('Pronunciation worker is not configured');
    return capabilities.pronunciationWorker;
  },
);
