import { describe, expect, it } from 'vitest';
import { hasCompletePublicLearningMapping } from '../../src/org-content/public-learning-source';
import type { VersionedDocument } from '../../src/repositories/document-database-port';

const page = { id: 'page_one', pageNumber: 1, role: 'content',
  imageAssetKey: 'cloud://demo/page.jpg', thumbnailAssetKey: 'cloud://demo/thumb.jpg' };
const chapter = { id: 'unit_1', title: 'Unit 1 A Story', order: 1, pages: [page] };
function document(mode: 'page_only' | 'chapter_audio' | 'partial_pointread', tracks: unknown[]): VersionedDocument {
  const note = mode === 'page_only' ? '点读、跟读与示范音频暂未开放'
    : mode === 'chapter_audio' ? '已开放章节朗读；点读、跟读与示范音频暂未开放'
      : '已开放部分课文点读与跟读；其余章节可连听，未标注页面暂未开放';
  return { _id: 'book_one', organizationId: 'org_demo', schemaVersion: 1,
    version: 2, deletedAt: null, type: 'reading', title: 'A Story',
    contentVersion: '1.2', status: 'published', audioMode: mode,
    audioAvailabilityNote: note, chapters: [chapter],
    payload: { audioMode: mode, audioAvailabilityNote: note, chapters: [chapter],
      readingAudio: { reviewStatus: 'approved', sourceVersion: '1.2',
        approvedBy: 'Codex', approvedAt: '2026-10-15T10:00:00+08:00',
        chapters: tracks } } } as VersionedDocument;
}

describe('chapter narration public mapping', () => {
  it('accepts an approved chapter recording without pretending to have pointread segments', () => {
    expect(hasCompletePublicLearningMapping(document('chapter_audio', [
      { chapterId: 'unit_1', audioAssetKey: 'cloud://demo/chapter.mp3',
        durationMs: 90000, segments: [] },
    ]))).toBe(true);
  });

  it('rejects missing or wrong chapter media while retaining page only books', () => {
    expect(hasCompletePublicLearningMapping(document('chapter_audio', []))).toBe(false);
    expect(hasCompletePublicLearningMapping(document('chapter_audio', [
      { chapterId: 'other_unit', audioAssetKey: 'cloud://demo/chapter.mp3',
        durationMs: 90000, segments: [] },
    ]))).toBe(false);
    expect(hasCompletePublicLearningMapping(document('page_only', []))).toBe(true);
  });

  it('accepts one reviewed sentence for partial pointread and rejects unmatched follow reading', () => {
    const segment = { id: 'sentence_one', pageId: 'page_one', pageNumber: 1,
      text: 'Hello.', rect: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
      clipAudioAssetKey: 'cloud://demo/sentence.mp3', clipDurationMs: 1300,
      startMs: 0, endMs: 1200 };
    const base = document('partial_pointread', [{ chapterId: 'unit_1',
      audioAssetKey: 'cloud://demo/chapter.mp3', durationMs: 90000,
      segments: [segment] }]);
    const pronunciation = { reviewStatus: 'approved', sourceVersion: '1.2',
      approvedBy: 'Codex', approvedAt: '2026-10-15T10:00:00+08:00',
      segments: [{ id: 'sentence_one', pageNumber: 1, text: 'Hello.',
        demonstrationAudioAssetKey: 'cloud://demo/sentence.mp3' }] };
    const ready = { ...base, pronunciation, payload: { ...base.payload, pronunciation } } as VersionedDocument;
    expect(hasCompletePublicLearningMapping(ready)).toBe(true);
    expect(hasCompletePublicLearningMapping({ ...ready,
      pronunciation: { ...pronunciation, segments: [] } } as VersionedDocument)).toBe(false);
  });
});
