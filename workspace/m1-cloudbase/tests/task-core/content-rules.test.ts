import { describe, expect, it } from 'vitest';
import { calculateTaskScore, evaluateVerifiedContent, isTaskContentPublishableInM2, validateContentRule, type ContentRule } from '../../src/task-core/content-rules';

describe('M2 seven content types', () => {
  it('requires every listening segment and answer before objective scoring', () => {
    const rule: ContentRule = { kind: 'listening', segmentIds: ['audio_1', 'audio_2'], questionIds: ['q_1', 'q_2'] };
    expect(evaluateVerifiedContent(rule, {
      kind: 'listening', verifiedPlayedSegmentIds: ['audio_1'], answeredQuestionIds: ['q_1', 'q_2'], correctQuestionIds: ['q_1'],
    }).complete).toBe(false);
    expect(evaluateVerifiedContent(rule, {
      kind: 'listening', verifiedPlayedSegmentIds: ['audio_2', 'audio_1'], answeredQuestionIds: ['q_1', 'q_2'], correctQuestionIds: ['q_1'],
    })).toEqual({ complete: true, automaticScore: 50, teacherScoreRequired: false });
  });

  it('requires the exact reading range and scores a reading-only item as 100', () => {
    const rule: ContentRule = { kind: 'reading', pageIds: ['page_1', 'page_2'], questionIds: [] };
    expect(evaluateVerifiedContent(rule, {
      kind: 'reading', completedPageIds: ['page_1'], answeredQuestionIds: [], correctQuestionIds: [],
    }).complete).toBe(false);
    expect(evaluateVerifiedContent(rule, {
      kind: 'reading', completedPageIds: ['page_2', 'page_1'], answeredQuestionIds: [], correctQuestionIds: [],
    }).automaticScore).toBe(100);
  });

  it('accepts only a server-readable recording within the student limits', () => {
    const rule: ContentRule = { kind: 'recording' };
    const recording = { mediaId: 'media_1', durationMs: 1000, sizeBytes: 1024, serverReadable: true };
    expect(evaluateVerifiedContent(rule, { kind: 'recording', recording })).toEqual({
      complete: true, automaticScore: null, teacherScoreRequired: true,
    });
    expect(evaluateVerifiedContent(rule, { kind: 'recording', recording: { ...recording, serverReadable: false } }).complete).toBe(false);
    expect(evaluateVerifiedContent(rule, { kind: 'recording', recording: { ...recording, durationMs: 999 } }).complete).toBe(false);
    expect(evaluateVerifiedContent(rule, { kind: 'recording', recording: { ...recording, sizeBytes: 20 * 1024 * 1024 + 1 } }).complete).toBe(false);
  });

  it('counts unique verified video coverage and rejects a skipped gap below 90%', () => {
    const rule: ContentRule = { kind: 'video', durationMs: 100_000, questionIds: [] };
    expect(evaluateVerifiedContent(rule, {
      kind: 'video', verifiedRanges: [{ startMs: 0, endMs: 45_000 }, { startMs: 40_000, endMs: 80_000 }],
      answeredQuestionIds: [], correctQuestionIds: [],
    }).complete).toBe(false);
    expect(evaluateVerifiedContent(rule, {
      kind: 'video', verifiedRanges: [{ startMs: 0, endMs: 45_000 }, { startMs: 40_000, endMs: 90_000 }],
      answeredQuestionIds: [], correctQuestionIds: [],
    }).automaticScore).toBeNull();
  });

  it('scores vocabulary by first correct answers, not repeat practice', () => {
    const rule: ContentRule = { kind: 'vocabulary', wordIds: ['w_1', 'w_2', 'w_3'] };
    expect(evaluateVerifiedContent(rule, {
      kind: 'vocabulary', attemptedWordIds: ['w_1', 'w_2', 'w_3'], firstCorrectWordIds: ['w_1', 'w_3'],
    }).automaticScore).toBe(67);
    expect(evaluateVerifiedContent(rule, {
      kind: 'vocabulary', attemptedWordIds: ['w_1', 'w_2'], firstCorrectWordIds: ['w_1'],
    }).complete).toBe(false);
  });

  it('requires all exercise answers and leaves subjective scoring to the teacher', () => {
    const rule: ContentRule = { kind: 'exercise', questionIds: ['q_1', 'q_2'], objectiveQuestionIds: ['q_1'] };
    expect(evaluateVerifiedContent(rule, {
      kind: 'exercise', answeredQuestionIds: ['q_1'], correctQuestionIds: ['q_1'],
    }).complete).toBe(false);
    expect(evaluateVerifiedContent(rule, {
      kind: 'exercise', answeredQuestionIds: ['q_1', 'q_2'], correctQuestionIds: ['q_1'],
    })).toEqual({ complete: true, automaticScore: null, teacherScoreRequired: true });
    expect(evaluateVerifiedContent({ kind: 'exercise', questionIds: ['q_1'], objectiveQuestionIds: ['q_1'] }, {
      kind: 'exercise', answeredQuestionIds: ['q_1'], correctQuestionIds: ['q_1'],
    }).automaticScore).toBe(100);
  });

  it('requires a final dubbing work and valid recording for manual scoring', () => {
    const rule: ContentRule = { kind: 'dubbing' };
    const recording = { mediaId: 'media_1', durationMs: 2000, sizeBytes: 2000, serverReadable: true };
    expect(evaluateVerifiedContent(rule, { kind: 'dubbing', finalWorkId: null, recording }).complete).toBe(false);
    expect(evaluateVerifiedContent(rule, { kind: 'dubbing', finalWorkId: 'work_1', recording })).toEqual({
      complete: true, automaticScore: null, teacherScoreRequired: true,
    });
  });

  it('rejects duplicate or foreign IDs in rules and evidence', () => {
    expect(validateContentRule({ kind: 'exercise', questionIds: ['q_1', 'q_1'], objectiveQuestionIds: ['q_1'] })).toBe(false);
    expect(validateContentRule({ kind: 'exercise', questionIds: ['q_1'], objectiveQuestionIds: ['q_2'] })).toBe(false);
    expect(evaluateVerifiedContent({ kind: 'reading', pageIds: ['page_1'], questionIds: [] }, {
      kind: 'reading', completedPageIds: ['page_1', 'page_1'], answeredQuestionIds: [], correctQuestionIds: [],
    }).complete).toBe(false);
    expect(evaluateVerifiedContent({ kind: 'listening', segmentIds: ['audio_1'], questionIds: ['q_1'] }, {
      kind: 'listening', verifiedPlayedSegmentIds: ['audio_1'], answeredQuestionIds: ['q_1'], correctQuestionIds: ['foreign_question'],
    }).complete).toBe(false);
  });

  it('keeps listening, video and task dubbing closed until M3 safeguards exist', () => {
    expect(['reading', 'vocabulary', 'exercise', 'recording'].every((kind) => isTaskContentPublishableInM2(kind as ContentRule['kind']))).toBe(true);
    expect(['listening', 'video', 'dubbing'].every((kind) => !isTaskContentPublishableInM2(kind as ContentRule['kind']))).toBe(true);
  });

  it('weights only scored items and waits for required teacher scores', () => {
    const items = [
      { itemId: 'word_item', evaluation: { complete: true, automaticScore: 80, teacherScoreRequired: false } },
      { itemId: 'recording_item', evaluation: { complete: true, automaticScore: null, teacherScoreRequired: true } },
      { itemId: 'video_item', evaluation: { complete: true, automaticScore: null, teacherScoreRequired: false } },
    ];
    expect(calculateTaskScore(items)).toEqual({ validWeights: true, complete: true, score: null, needsTeacherScore: true });
    expect(calculateTaskScore([{ ...items[0]! }, { ...items[1]!, teacherScore: 60 }, items[2]!]).score).toBe(70);
    expect(calculateTaskScore([{ ...items[0]! }, { ...items[1]!, teacherScore: 60 }, items[2]!], {
      word_item: 75, recording_item: 25,
    }).score).toBe(75);
    expect(calculateTaskScore([{ ...items[0]! }, { ...items[1]!, teacherScore: 60 }, items[2]!], {
      word_item: 50, recording_item: 25, video_item: 25,
    }).validWeights).toBe(false);
  });
});
