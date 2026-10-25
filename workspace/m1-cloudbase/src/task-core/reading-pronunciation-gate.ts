import type { JsonObject } from '../shared/protocol';

/** Old page-only reading snapshots remain valid; an M3 claim must be complete. */
export function approvedReadingPronunciation(payload: JsonObject, resourceVersion: number,
  copyrightStatus: unknown = payload.copyrightStatus): boolean {
  if (payload.pronunciation === undefined) return true;
  if (copyrightStatus !== 'verified' || !record(payload.pronunciation)) return false;
  const source = payload.pronunciation;
  if (source.reviewStatus !== 'approved' || source.sourceVersion !== String(resourceVersion)
    || typeof source.approvedAt !== 'string' || !Number.isFinite(Date.parse(source.approvedAt))
    || typeof source.approvedBy !== 'string' || source.approvedBy.trim().length === 0
    || !Array.isArray(source.segments) || source.segments.length === 0) return false;
  const ids = new Set<string>();
  for (const raw of source.segments) {
    if (!record(raw) || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.id)
      || ids.has(raw.id) || typeof raw.text !== 'string' || raw.text.trim().length === 0
      || raw.text.length > 300 || typeof raw.demonstrationAudioAssetKey !== 'string'
      || (raw.translationText !== undefined && (typeof raw.translationText !== 'string'
        || raw.translationText.trim().length > 500))
      || !raw.demonstrationAudioAssetKey.startsWith('cloud://')
      || (raw.pageNumber !== undefined && (!Number.isSafeInteger(raw.pageNumber) || Number(raw.pageNumber) < 1))) return false;
    ids.add(raw.id);
  }
  return true;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
