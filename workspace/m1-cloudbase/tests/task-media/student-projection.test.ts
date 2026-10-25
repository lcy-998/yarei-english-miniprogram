import { describe, expect, it } from 'vitest';
import type { FrozenTeacherMediaSnapshot } from '../../src/teacher-media/publish-gate';
import { projectTaskMediaSnapshotForStudent } from '../../src/task-media/student-projection';

describe('frozen task media student projection', () => {
  it('keeps original questions and clip order while excluding answers and private file IDs', () => {
    const snapshot: FrozenTeacherMediaSnapshot = { mediaId: 'media_demo', kind: 'listening',
      mediaVersion: 3, reviewVersion: 3, mediaAssetKey: 'cloud://private/audio.mp3',
      mediaSha256: 'a'.repeat(64), durationMs: 2000,
      questionIds: ['question_1'], questions: [{ questionId: 'question_1',
        questionType: 'single_choice', stem: 'What did you hear?', options: ['cat', 'dog'] }],
      answerKeys: [{ questionId: 'question_1', correctAnswer: 'cat', explanation: 'Correct is cat.' }],
      clips: [{ questionId: 'question_1', segmentId: 'segment_1', startMs: 0, endMs: 2000 }],
      continuousPlaybackEnforced: true };
    const projected = projectTaskMediaSnapshotForStudent(snapshot);
    expect(projected).toMatchObject({ questionIds: ['question_1'],
      questions: [{ stem: 'What did you hear?', options: ['cat', 'dog'] }],
      clips: [{ segmentId: 'segment_1' }] });
    const text = JSON.stringify(projected);
    expect(text).not.toContain('cloud://');
    expect(text).not.toContain('correctAnswer');
    expect(text).not.toContain('Correct is cat');
  });
});
