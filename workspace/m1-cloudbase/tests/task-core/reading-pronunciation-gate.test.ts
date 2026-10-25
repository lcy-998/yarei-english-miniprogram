import { describe, expect, it } from 'vitest';
import { approvedReadingPronunciation } from '../../src/task-core/reading-pronunciation-gate';

const approved = {
  copyrightStatus: 'verified',
  pronunciation: {
    reviewStatus: 'approved', sourceVersion: '2', approvedAt: '2026-10-02T08:00:00+08:00',
    approvedBy: 'reviewer_demo', segments: [{ id: 'segment_demo_01', text: 'A tiger is at the zoo.',
      pageNumber: 1, demonstrationAudioAssetKey: 'cloud://demo/segment.mp3' }],
  },
};

describe('M3 reading pronunciation publication gate', () => {
  it('keeps M2 page-only reading publishable and freezes explicitly approved media', () => {
    expect(approvedReadingPronunciation({}, 1)).toBe(true);
    expect(approvedReadingPronunciation(approved, 2)).toBe(true);
    expect(approvedReadingPronunciation({ pronunciation: approved.pronunciation }, 2, 'verified')).toBe(true);
  });

  it('rejects stale approval, missing copyright, missing audio and duplicate segment identifiers', () => {
    expect(approvedReadingPronunciation(approved, 3)).toBe(false);
    expect(approvedReadingPronunciation({ ...approved, copyrightStatus: 'demo' }, 2)).toBe(false);
    expect(approvedReadingPronunciation({ pronunciation: approved.pronunciation }, 2, 'demo')).toBe(false);
    expect(approvedReadingPronunciation({ ...approved, pronunciation: {
      ...approved.pronunciation, segments: [{ ...approved.pronunciation.segments[0], demonstrationAudioAssetKey: '' }],
    } }, 2)).toBe(false);
    expect(approvedReadingPronunciation({ ...approved, pronunciation: {
      ...approved.pronunciation, segments: [approved.pronunciation.segments[0], approved.pronunciation.segments[0]],
    } }, 2)).toBe(false);
  });
});
