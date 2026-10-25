import type { TaskRecord } from '../task-core/types';

/** Trial scoring metadata must not enter parent or teacher formal score projections. */
export function hasOnlyOfficialAutomaticItems(task: TaskRecord): boolean {
  return task.items.every(item => (['reading', 'vocabulary', 'exercise', 'recording'].includes(item.resourceSnapshot.type)
    || ['listening', 'video', 'dubbing'].includes(item.resourceSnapshot.type)
      && item.mediaSnapshot?.kind === item.resourceSnapshot.type
      && item.mediaSnapshot.reviewVersion === item.mediaSnapshot.mediaVersion
      && item.mediaSnapshot.continuousPlaybackEnforced === true
      && item.mediaSnapshot.mediaAssetKey.startsWith('cloud://')
      && /^[a-f0-9]{64}$/i.test(item.mediaSnapshot.mediaSha256)
      && Number.isSafeInteger(item.mediaSnapshot.durationMs)
      && item.mediaSnapshot.durationMs >= 1000
      && item.mediaSnapshot.durationMs <= 30 * 60 * 1000)
    && item.scoringRule.experimental !== true && item.scoringRule.scoringStatus !== 'experimental'
    && item.scoringRule.modelStatus !== 'experimental');
}
