import { createDefaultCloudBaseServerEventFunction } from '../shared/default-cloudbase-function';

/** Only an internal event carrying the current protected processing token may run a job. */
export const main = createDefaultCloudBaseServerEventFunction<unknown>(
  'teacher-private-video-worker',
  async () => ({ ok: false, status: 'unavailable' }),
  capabilities => {
    if (!capabilities.privateVideoWorker) throw new Error('Teacher video worker is not configured');
    return capabilities.privateVideoWorker;
  },
);
