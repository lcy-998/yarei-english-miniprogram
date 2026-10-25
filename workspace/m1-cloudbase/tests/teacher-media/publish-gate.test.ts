import { describe, expect, it } from 'vitest';
import { freezeTeacherMediaForTask, type TeacherMediaCandidate } from '../../src/teacher-media/publish-gate';

const ready: TeacherMediaCandidate = {
  id: 'media_demo', organizationId: 'org_demo', title: '虚构听力材料',
  kind: 'listening', version: 3,
  status: 'published', reviewVersion: 3, reviewedBy: 'reviewer_demo',
  reviewedAt: '2026-10-02T08:00:00+08:00', copyrightStatus: 'verified',
  copyrightEvidenceKey: 'cloud://demo/copyright-proof.txt',
  scanStatus: 'clean', transcodeStatus: 'ready', mediaAssetKey: 'cloud://demo/audio.mp3',
  sourceScanEvidence: { engine: 'clamav', signatureVersion: 'virtual-unit-v1',
    scannedAt: '2026-10-02T07:58:00+08:00', scannedSha256: 'b'.repeat(64), reportId: 'virtual_source_scan_01' },
  scanEvidence: { engine: 'clamav', signatureVersion: 'virtual-unit-v1',
    scannedAt: '2026-10-02T08:00:00+08:00', scannedSha256: 'a'.repeat(64), reportId: 'virtual_scan_01' },
  transcodeEvidence: { engine: 'ffmpeg', engineVersion: 'virtual-unit-v1',
    transcodedAt: '2026-10-02T07:59:00+08:00', sourceSha256: 'b'.repeat(64),
    outputSha256: 'a'.repeat(64),
    outputAssetKey: 'cloud://demo/audio.mp3' },
  mediaSha256: 'a'.repeat(64), durationMs: 12000, allowedClassIds: ['class_demo'],
  questionIds: ['question_1', 'question_2', 'question_3'], questions: [
    { questionId: 'question_1', questionType: 'single_choice', stem: 'Choose the animal.', options: ['cat', 'dog'] },
    { questionId: 'question_2', questionType: 'single_choice', stem: 'Choose the word.', options: ['bird', 'fish'] },
    { questionId: 'question_3', questionType: 'single_choice', stem: 'Choose the place.', options: ['home', 'school'] },
  ], answerKeys: [
    { questionId: 'question_1', correctAnswer: 'cat', explanation: 'The sound says cat.' },
    { questionId: 'question_2', correctAnswer: 'bird', explanation: 'The sound says bird.' },
    { questionId: 'question_3', correctAnswer: 'home', explanation: 'The sound says home.' },
  ], clips: [
    { questionId: 'question_1', segmentId: 'segment_1', startMs: 0, endMs: 5000 },
    { questionId: 'question_2', segmentId: 'segment_2', startMs: 5000, endMs: 8000 },
    { questionId: 'question_3', segmentId: 'segment_3', startMs: 8000, endMs: 12000 },
  ], continuousPlaybackEnforced: true,
};

describe('M3 teacher media publication snapshot gate', () => {
  it('freezes approved listening question clips and media version', () => {
    const result = freezeTeacherMediaForTask(ready, 'org_demo', ['class_demo']);
    expect(result).toMatchObject({ ready: true, snapshot: { mediaVersion: 3, reviewVersion: 3 } });
    if (!result.ready) throw new Error('expected approved snapshot');
    expect(result.snapshot.clips).toHaveLength(3);
    expect(result.snapshot.clips).not.toBe(ready.clips);
    expect(result.snapshot.questions).toEqual(ready.questions);
    expect(result.snapshot.questions).not.toBe(ready.questions);
    expect(result.snapshot.answerKeys).toEqual(ready.answerKeys);
  });

  it('rejects unreviewed, unauthorised, unmapped and unprotected media', () => {
    expect(freezeTeacherMediaForTask({ ...ready, reviewVersion: 2 }, 'org_demo', ['class_demo']))
      .toEqual({ ready: false, reason: 'UNREVIEWED' });
    expect(freezeTeacherMediaForTask(ready, 'org_other', ['class_demo']))
      .toEqual({ ready: false, reason: 'UNAUTHORIZED' });
    expect(freezeTeacherMediaForTask({ ...ready, clips: ready.clips.slice(0, 1) }, 'org_demo', ['class_demo']))
      .toEqual({ ready: false, reason: 'MAPPING_INCOMPLETE' });
    expect(freezeTeacherMediaForTask({ ...ready, questions: ready.questions.slice(0, 1) }, 'org_demo', ['class_demo']))
      .toEqual({ ready: false, reason: 'MAPPING_INCOMPLETE' });
    expect(freezeTeacherMediaForTask({ ...ready, answerKeys: ready.answerKeys.slice(0, 1) }, 'org_demo', ['class_demo']))
      .toEqual({ ready: false, reason: 'MAPPING_INCOMPLETE' });
    expect(freezeTeacherMediaForTask({ ...ready, answerKeys: undefined } as unknown as TeacherMediaCandidate,
      'org_demo', ['class_demo']))
      .toEqual({ ready: false, reason: 'MAPPING_INCOMPLETE' });
    expect(freezeTeacherMediaForTask({ ...ready, continuousPlaybackEnforced: false }, 'org_demo', ['class_demo']))
      .toEqual({ ready: false, reason: 'PLAYBACK_UNAVAILABLE' });
    expect(freezeTeacherMediaForTask({ ...ready, scanEvidence: null }, 'org_demo', ['class_demo']))
      .toEqual({ ready: false, reason: 'MEDIA_INVALID' });
    expect(freezeTeacherMediaForTask({ ...ready, sourceScanEvidence: null }, 'org_demo', ['class_demo']))
      .toEqual({ ready: false, reason: 'MEDIA_INVALID' });
  });

  it('freezes a subjective listening prompt without a student-visible answer key', () => {
    const subjective: TeacherMediaCandidate = { ...ready,
      questions: ready.questions.map(question => ({ ...question,
        questionType: 'subjective' as const, options: [] })),
      answerKeys: ready.answerKeys.map(answer => ({ ...answer, correctAnswer: null, explanation: '' })),
    };
    const result = freezeTeacherMediaForTask(subjective, 'org_demo', ['class_demo']);
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error('expected reviewed subjective listening set');
    expect(result.snapshot.answerKeys).toHaveLength(3);
    expect(result.snapshot.answerKeys.every(answer => answer.correctAnswer === null)).toBe(true);
  });

  it('rejects listening sets outside the three-to-ten question range', () => {
    for (const count of [1, 2, 11]) {
      const questions = Array.from({ length: count }, (_, index) => ({
        questionId: `question_${index + 1}`, questionType: 'single_choice' as const,
        stem: `Question ${index + 1}`, options: ['yes', 'no'],
      }));
      const candidate: TeacherMediaCandidate = { ...ready,
        questionIds: questions.map(question => question.questionId), questions,
        answerKeys: questions.map(question => ({ questionId: question.questionId,
          correctAnswer: 'yes', explanation: 'Verified answer.' })),
        clips: questions.map((question, index) => ({ questionId: question.questionId,
          segmentId: `segment_${index + 1}`, startMs: 0, endMs: 12000 })),
      };
      expect(freezeTeacherMediaForTask(candidate, 'org_demo', ['class_demo']))
        .toEqual({ ready: false, reason: 'MAPPING_INCOMPLETE' });
    }
  });

  it('accepts ten distinct mapped questions at the upper boundary', () => {
    const questions = Array.from({ length: 10 }, (_, index) => ({
      questionId: `question_${index + 1}`, questionType: 'single_choice' as const,
      stem: `Question ${index + 1}`, options: ['yes', 'no'],
    }));
    const candidate: TeacherMediaCandidate = { ...ready,
      questionIds: questions.map(question => question.questionId), questions,
      answerKeys: questions.map(question => ({ questionId: question.questionId,
        correctAnswer: 'yes', explanation: 'Verified answer.' })),
      clips: questions.map((question, index) => ({ questionId: question.questionId,
        segmentId: `segment_${index + 1}`, startMs: 0, endMs: 12000 })),
    };
    expect(freezeTeacherMediaForTask(candidate, 'org_demo', ['class_demo']))
      .toMatchObject({ ready: true, snapshot: { questionIds: candidate.questionIds } });
  });
});
