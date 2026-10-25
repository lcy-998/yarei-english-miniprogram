import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { DocumentTaskDubbingCommandPort } from '../../src/task-media/document-dubbing-command-port';
import { DocumentTaskDubbingWorkPort } from '../../src/task-media/document-work-port';
import { TaskDubbingWorkService } from '../../src/task-media/dubbing-work-service';
import type { AssignedTaskMedia } from '../../src/task-media/playback-service';

const student: TrustedActorContext = { requestId: 'req_student', sessionId: 'session_student',
  actorUserId: 'student_demo', actorRole: 'student', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: [], scopeIds: ['student_demo'], authzVersion: 1 };
const assigned: AssignedTaskMedia = { organizationId: 'org_demo', studentId: 'student_demo',
  assignmentId: 'assignment_demo', round: 2, taskId: 'task_demo', itemId: 'item_demo', writable: true,
  snapshot: { mediaId: 'media_demo', kind: 'dubbing', mediaVersion: 3, reviewVersion: 3,
    mediaAssetKey: 'cloud://private/video.mp4', mediaSha256: 'a'.repeat(64), durationMs: 10000,
    questionIds: [], questions: [], answerKeys: [], clips: [],
    subtitleAssetKey: 'cloud://private/subtitle.vtt',
    subtitleCues: [{ startMs: 0, endMs: 10000, text: 'Hello.' }], continuousPlaybackEnforced: true } };

describe('M3 task-bound dubbing work persistence', () => {
  it('seals only this assignment round and keeps private file IDs out of client receipts', async () => {
    const db = new FakeDocumentDatabase({});
    let current = assigned;
    const port = new DocumentTaskDubbingCommandPort(db,
      { async findAssignedMedia() { return current; } },
      { async inspectAndSeal() { return { fileId: 'cloud://private/task-work.mp3',
        contentSha256: 'b'.repeat(64), durationMs: 3000, sizeBytes: 1024 }; } });
    const service = new TaskDubbingWorkService(port, { nowIso: () => '2026-10-03T08:00:00+08:00' });
    const begun = await service.begin(student, 'task_demo', 'item_demo', 'operation_begin');
    expect(begun).toMatchObject({ ok: true, data: { round: 2, status: 'draft' } });
    if (!begun.ok) throw new Error('work draft expected');
    const sealed = await service.seal(student, begun.data.workId,
      `cloud://${begun.data.stagingPath}`, 1, 'operation_seal');
    expect(sealed).toMatchObject({ ok: true, data: { status: 'submitted', durationMs: 3000 } });
    expect(JSON.stringify(sealed)).not.toContain('cloud://private/task-work.mp3');
    expect(await service.seal(student, begun.data.workId,
      `cloud://${begun.data.stagingPath}`, 1, 'operation_seal')).toEqual(sealed);
    expect(await new DocumentTaskDubbingWorkPort(db).findTaskDubbingWork(begun.data.workId))
      .toMatchObject({ assignmentId: 'assignment_demo', round: 2,
        fileId: 'cloud://private/task-work.mp3', contentSha256: 'b'.repeat(64) });
    const sealedRow = db.snapshot().task_dubbing_works?.[0];
    if (!sealedRow) throw new Error('sealed work expected');
    const damaged = new FakeDocumentDatabase({ task_dubbing_works: [{ ...sealedRow, mediaDeletedAt: 42 }] });
    expect(await new DocumentTaskDubbingWorkPort(damaged).findTaskDubbingWork(begun.data.workId)).toBeNull();
    current = { ...assigned, round: 3 };
    expect(await service.seal(student, begun.data.workId,
      `cloud://${begun.data.stagingPath}`, 1, 'operation_new_round'))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
  });
});
