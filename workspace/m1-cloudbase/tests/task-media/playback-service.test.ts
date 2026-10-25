import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { TaskMediaPlaybackService, type AssignedTaskMedia, type TaskMediaPlaybackPort,
  type TaskMediaSessionRecord } from '../../src/task-media/playback-service';
import type { FrozenTeacherMediaSnapshot } from '../../src/teacher-media/publish-gate';

const student: TrustedActorContext = { requestId: 'req_student', sessionId: 'session_student',
  actorUserId: 'student_demo', actorRole: 'student', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_student', permissions: [], scopeIds: ['student_demo'], authzVersion: 1 };

const snapshot: FrozenTeacherMediaSnapshot = { mediaId: 'media_demo', kind: 'video', mediaVersion: 2,
  reviewVersion: 2, mediaAssetKey: 'cloud://demo/video.mp4', mediaSha256: 'a'.repeat(64),
  durationMs: 10000, questionIds: [], questions: [], answerKeys: [], clips: [], continuousPlaybackEnforced: true };

function fixture() {
  let nowMs = Date.parse('2026-10-03T08:00:00+08:00');
  let writable = true;
  let allowed = true;
  let counter = 0;
  let currentSnapshot = snapshot;
  const sessions = new Map<string, TaskMediaSessionRecord>();
  const receipts = new Map<string, TaskMediaSessionRecord>();
  const fingerprints = new Map<string, string>();
  const assigned = (): AssignedTaskMedia => ({ organizationId: 'org_demo', studentId: 'student_demo',
    assignmentId: 'assignment_demo', round: 1, taskId: 'task_demo', itemId: 'item_demo', writable,
    snapshot: currentSnapshot });
  const port: TaskMediaPlaybackPort = {
    async findAssignedMedia(_actor, taskId, itemId) {
      return allowed && taskId === 'task_demo' && itemId === 'item_demo' ? assigned() : null;
    },
    async findLatestSession(_org, _student, taskId, itemId) {
      return [...sessions.values()].reverse().find(row => row.taskId === taskId && row.itemId === itemId) ?? null;
    },
    async findSession(sessionId) { return sessions.get(sessionId) ?? null; },
    async createSession(row, operationId) {
      const prior = receipts.get(`create:${operationId}`);
      if (prior) return prior;
      sessions.set(row.id, row); receipts.set(`create:${operationId}`, row); return row;
    },
    async advanceSession(row, expectedVersion, operationId, fingerprint) {
      const key = `beat:${row.id}:${operationId}`;
      const prior = receipts.get(key);
      if (prior && fingerprints.get(key) !== fingerprint) return null;
      if (prior) return prior;
      if (sessions.get(row.id)?.version !== expectedVersion) return null;
      sessions.set(row.id, row); receipts.set(key, row); fingerprints.set(key, fingerprint); return row;
    },
    async findHeartbeatReceipt(sessionId, operationId, fingerprint) {
      const key = `beat:${sessionId}:${operationId}`;
      return receipts.has(key) && fingerprints.get(key) !== fingerprint ? 'conflict'
        : receipts.get(key) ?? null;
    },
    async signPlayback() { return { temporaryUrl: 'https://example.invalid/video',
      expiresAt: new Date(nowMs + 60000).toISOString() }; },
    nextSessionId() { counter += 1; return `media_session_${counter}`; },
  };
  return { service: new TaskMediaPlaybackService(port, { nowIso: () => new Date(nowMs).toISOString() }),
    advance(ms: number) { nowMs += ms; }, setWritable(value: boolean) { writable = value; },
    revoke() { allowed = false; }, changeMediaVersion() { currentSnapshot = { ...snapshot, mediaVersion: 3 }; },
    sessions };
}

describe('M3 trusted media playback continuity', () => {
  it('starts from published snapshot, refuses forward gaps and implausible speed, then confirms 90% video coverage', async () => {
    const state = fixture();
    expect(await state.service.get(student, 'task_demo', 'item_demo'))
      .toMatchObject({ ok: true, data: { status: 'unavailable', confirmedThroughMs: 0 } });
    const begun = await state.service.begin(student, 'task_demo', 'item_demo', 'operation_begin');
    expect(begun).toMatchObject({ ok: true, data: { status: 'ready', sessionId: 'media_session_1',
      seekForwardAllowed: false, confirmedThroughMs: 0 } });
    state.advance(1000);
    const first = await state.service.heartbeat(student, { sessionId: 'media_session_1',
      playedFromMs: 0, playedToMs: 2000, positionMs: 2000, operationId: 'operation_beat_1' });
    expect(first).toMatchObject({ ok: true, data: { confirmedThroughMs: 2000, completed: false } });
    expect(await state.service.heartbeat(student, { sessionId: 'media_session_1',
      playedFromMs: 4000, playedToMs: 5000, positionMs: 5000, operationId: 'operation_skip' }))
      .toEqual({ ok: false, code: 'SEEK_FORWARD' });
    expect(await state.service.heartbeat(student, { sessionId: 'media_session_1',
      playedFromMs: 2000, playedToMs: 9000, positionMs: 9000, operationId: 'operation_fast' }))
      .toEqual({ ok: false, code: 'PLAYBACK_TOO_FAST' });
    state.advance(3500);
    const complete = await state.service.heartbeat(student, { sessionId: 'media_session_1',
      playedFromMs: 2000, playedToMs: 9000, positionMs: 9000, operationId: 'operation_beat_2' });
    expect(complete).toMatchObject({ ok: true, data: { confirmedThroughMs: 9000, completed: true } });
    expect(await state.service.heartbeat(student, { sessionId: 'media_session_1',
      playedFromMs: 2000, playedToMs: 9000, positionMs: 9000, operationId: 'operation_beat_2' }))
      .toEqual(complete);
    expect(await state.service.heartbeat(student, { sessionId: 'media_session_1',
      playedFromMs: 2000, playedToMs: 9001, positionMs: 9001, operationId: 'operation_beat_2' }))
      .toEqual({ ok: false, code: 'CONFLICT' });
  });

  it('rechecks student ownership, current media version and write status on every heartbeat', async () => {
    const state = fixture();
    await state.service.begin(student, 'task_demo', 'item_demo', 'operation_begin');
    const other = { ...student, actorUserId: 'student_other' };
    expect(await state.service.heartbeat(other, { sessionId: 'media_session_1',
      playedFromMs: 0, playedToMs: 1000, positionMs: 1000, operationId: 'operation_other' }))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    state.setWritable(false);
    expect(await state.service.get(student, 'task_demo', 'item_demo'))
      .toMatchObject({ ok: true, data: { status: 'ready' } });
    expect(await state.service.heartbeat(student, { sessionId: 'media_session_1',
      playedFromMs: 0, playedToMs: 1000, positionMs: 1000, operationId: 'operation_history' }))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    state.setWritable(true); state.changeMediaVersion();
    expect(await state.service.heartbeat(student, { sessionId: 'media_session_1',
      playedFromMs: 0, playedToMs: 1000, positionMs: 1000, operationId: 'operation_stale' }))
      .toEqual({ ok: false, code: 'FORBIDDEN' });
    state.revoke();
    expect(await state.service.get(student, 'task_demo', 'item_demo')).toEqual({ ok: false, code: 'FORBIDDEN' });
  });
});
