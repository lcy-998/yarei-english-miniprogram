import type { PronunciationAsyncJobService } from '../../src/pronunciation/async-job-service';
import { verifyPronunciationJobEvent } from '../../src/pronunciation/job-wire';

/** Internal-only worker entry. Client invoke must be denied independently by CloudBase rules. */
export function createPronunciationWorkerFunction(dependencies: Readonly<{
  jobs: Pick<PronunciationAsyncJobService, 'run'>;
  secret: string;
  clock: { nowUnix(): number };
}>) {
  return async (event: unknown): Promise<Readonly<{ ok: boolean; status: string }>> => {
    try {
      const job = verifyPronunciationJobEvent(event, dependencies.secret, dependencies.clock.nowUnix());
      const result = await dependencies.jobs.run(job);
      return { ok: true, status: result?.status ?? 'duplicate_or_busy' };
    } catch {
      // Do not log or return signed jobs, media URLs, identity details or model text.
      return { ok: false, status: 'rejected_or_unavailable' };
    }
  };
}
