import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { evaluateVerifiedContent } from '../../src/task-core/content-rules';
import { TaskMediaSubmissionEvidenceService, type SealedTaskDubbingWork,
} from '../../src/task-media/submission-evidence';
import type { AssignedTaskMedia, TaskMediaSessionRecord } from '../../src/task-media/playback-service';
import type { FrozenTeacherMediaSnapshot } from '../../src/teacher-media/publish-gate';

const student: TrustedActorContext = { requestId: 'request_demo', sessionId: 'session_demo',
  actorUserId: 'student_demo', actorRole: 'student', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: [], scopeIds: ['student_demo'], authzVersion: 1 };
const listening: FrozenTeacherMediaSnapshot = { mediaId: 'media_demo', kind: 'listening',
  mediaVersion: 2, reviewVersion: 2, mediaAssetKey: 'cloud://private/audio.mp3',
  mediaSha256: 'a'.repeat(64), durationMs: 10000,
  questionIds: ['question_1', 'question_2'], questions: [
    { questionId: 'question_1', questionType: 'single_choice', stem: 'First?', options: ['cat', 'dog'] },
    { questionId: 'question_2', questionType: 'single_choice', stem: 'Second?', options: ['bird', 'fish'] },
  ], answerKeys: [
    { questionId: 'question_1', correctAnswer: 'cat', explanation: '' },
    { questionId: 'question_2', correctAnswer: 'bird', explanation: '' },
  ], clips: [
    { questionId: 'question_1', segmentId: 'segment_1', startMs: 0, endMs: 5000 },
    { questionId: 'question_2', segmentId: 'segment_2', startMs: 5000, endMs: 10000 },
  ], continuousPlaybackEnforced: true };

function fixture(snapshot: FrozenTeacherMediaSnapshot = listening,
  confirmedThroughMs = snapshot.durationMs, work: SealedTaskDubbingWork | null = null) {
  const assigned: AssignedTaskMedia = { organizationId: 'org_demo', studentId: 'student_demo',
    assignmentId: 'assignment_demo', round: 1, taskId: 'task_demo', itemId: 'item_demo', writable: true, snapshot };
  const session: TaskMediaSessionRecord = { id: 'media_session_demo', organizationId: 'org_demo',
    studentId: 'student_demo', assignmentId: 'assignment_demo', round: 1, taskId: 'task_demo',
    itemId: 'item_demo', mediaId: snapshot.mediaId, mediaVersion: snapshot.mediaVersion,
    confirmedThroughMs, createdAt: '2026-10-03T08:00:00+08:00', lastHeartbeatAt: '2026-10-03T08:00:00+08:00',
    expiresAt: '2026-10-03T10:00:00+08:00', version: 2 };
  const service = new TaskMediaSubmissionEvidenceService({ async findSession() { return session; } },
    { async findTaskDubbingWork() { return work; } });
  return { service, assigned };
}

describe('M3 server-derived media submission evidence', () => {
  it('freezes original listening answers and derives played clips and score from the trusted session', async () => {
    const { service, assigned } = fixture();
    const result = await service.verify(student, assigned, { kind: 'listening', mediaSessionId: 'media_session_demo',
      questionResponses: [
        { questionId: 'question_2', response: 'fish' },
        { questionId: 'question_1', response: 'cat' },
      ] });
    expect(result).toMatchObject({ ok: true, data: { questionResponses: [
      { questionId: 'question_1', response: 'cat' }, { questionId: 'question_2', response: 'fish' }],
      evidence: { kind: 'listening', verifiedPlayedSegmentIds: ['segment_1', 'segment_2'],
        correctQuestionIds: ['question_1'] } } });
    if (!result.ok) throw new Error('verified evidence expected');
    expect(evaluateVerifiedContent({ kind: 'listening', segmentIds: ['segment_1', 'segment_2'],
      questionIds: ['question_1', 'question_2'] }, result.data.evidence))
      .toMatchObject({ complete: true, automaticScore: 50 });
  });

  it('rejects incomplete playback, missing answers and client-forged progress fields', async () => {
    const incomplete = fixture(listening, 5000);
    expect(await incomplete.service.verify(student, incomplete.assigned, { kind: 'listening',
      mediaSessionId: 'media_session_demo', questionResponses: [
        { questionId: 'question_1', response: 'cat' }, { questionId: 'question_2', response: 'bird' }],
    })).toEqual({ ok: false, code: 'PLAYBACK_INCOMPLETE' });
    const complete = fixture();
    expect(await complete.service.verify(student, complete.assigned, { kind: 'listening',
      mediaSessionId: 'media_session_demo', questionResponses: [{ questionId: 'question_1', response: 'cat' }],
    })).toEqual({ ok: false, code: 'MAPPING_INCOMPLETE' });
    expect(await complete.service.verify(student, complete.assigned, {
      kind: 'listening', mediaSessionId: 'media_session_demo', questionResponses: [
        { questionId: 'question_1', response: 'cat' }, { questionId: 'question_2', response: 'bird' }],
      verifiedPlayedSegmentIds: ['segment_1', 'segment_2'],
    } as unknown as Parameters<typeof complete.service.verify>[2]))
      .toEqual({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('requires a sealed final dubbing work for this task item and media version', async () => {
    const dubbing: FrozenTeacherMediaSnapshot = { ...listening, kind: 'dubbing',
      questionIds: [], questions: [], answerKeys: [], clips: [],
      subtitleAssetKey: 'cloud://private/subtitle.vtt',
      subtitleCues: [{ startMs: 0, endMs: 10000, text: 'Hello.' }] };
    const work: SealedTaskDubbingWork = { id: 'work_task_demo', organizationId: 'org_demo',
      studentId: 'student_demo', assignmentId: 'assignment_demo', round: 1,
      taskId: 'task_demo', itemId: 'item_demo',
      mediaId: 'media_demo', mediaVersion: 2, status: 'submitted',
      fileId: 'cloud://private/task-work.mp3', contentSha256: 'b'.repeat(64), mediaDeletedAt: null,
      recording: { mediaId: 'recording_demo', durationMs: 3000, sizeBytes: 1024, serverReadable: true } };
    const state = fixture(dubbing, 10000, work);
    expect(await state.service.verify(student, state.assigned, { kind: 'dubbing',
      mediaSessionId: 'media_session_demo', finalWorkId: work.id }))
      .toMatchObject({ ok: true, data: { evidence: { kind: 'dubbing', finalWorkId: work.id } } });
    const unrelated = fixture(dubbing, 10000, { ...work, mediaVersion: 3 });
    expect(await unrelated.service.verify(student, unrelated.assigned, { kind: 'dubbing',
      mediaSessionId: 'media_session_demo', finalWorkId: work.id }))
      .toEqual({ ok: false, code: 'WORK_UNAVAILABLE' });
  });

  it('keeps a subjective listening answer for teacher scoring without inventing an automatic correct answer', async () => {
    const subjective: FrozenTeacherMediaSnapshot = { ...listening,
      questionIds: ['question_1'], questions: [{ questionId: 'question_1',
        questionType: 'subjective', stem: 'Describe the sound.', options: [] }],
      answerKeys: [{ questionId: 'question_1', correctAnswer: null, explanation: '' }],
      clips: [{ questionId: 'question_1', segmentId: 'segment_1', startMs: 0, endMs: 10000 }],
    };
    const state = fixture(subjective);
    const result = await state.service.verify(student, state.assigned, { kind: 'listening',
      mediaSessionId: 'media_session_demo', questionResponses: [{ questionId: 'question_1',
        response: 'I heard a cat.' }] });
    expect(result).toMatchObject({ ok: true, data: { evidence: { correctQuestionIds: [] } } });
    if (!result.ok) throw new Error('subjective evidence expected');
    expect(evaluateVerifiedContent({ kind: 'listening', segmentIds: ['segment_1'],
      questionIds: ['question_1'], objectiveQuestionIds: [] }, result.data.evidence))
      .toMatchObject({ complete: true, automaticScore: null, teacherScoreRequired: true });
  });
});
