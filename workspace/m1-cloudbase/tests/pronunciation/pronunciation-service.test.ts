import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { PronunciationService } from '../../src/pronunciation/service';
import type { PronunciationInferencePort, PronunciationSourcePort,
  PronunciationTransaction, PronunciationUnitOfWork } from '../../src/pronunciation/repository';
import { PronunciationError, type PronunciationReceipt, type PronunciationRecording,
  type PronunciationSourceInput, type ResolvedPronunciationSource } from '../../src/pronunciation/types';

const student = (actorUserId = 'student_virtual_01', role: TrustedActorContext['actorRole'] = 'student'):
  TrustedActorContext => ({ requestId: `request_${actorUserId}`, sessionId: 'session_virtual_01',
    actorUserId, actorRole: role, organizationId: 'org_virtual_01',
    platformSubjectDigest: 'digest_virtual_01', permissions: [], scopeIds: [], authzVersion: 1 });
const taskSource: PronunciationSourceInput = { kind: 'task', taskId: 'task_virtual_01',
  itemId: 'item_virtual_01', segmentId: 'segment_virtual_01' };
const resolved: ResolvedPronunciationSource = { kind: 'task', taskId: 'task_virtual_01',
  itemId: 'item_virtual_01', resourceId: 'reading_virtual_01', segmentId: 'segment_virtual_01',
  referenceText: 'Hello world', sourceVersion: 'snapshot_virtual_01',
  assignmentId: 'assignment_virtual_01', classId: 'class_virtual_01', submissionVersion: 1 };
const readingSource: PronunciationSourceInput = { kind: 'reading', resourceId: 'reading_virtual_01',
  segmentId: 'segment_virtual_01' };
const resolvedReading: ResolvedPronunciationSource = { kind: 'reading', taskId: null, itemId: null,
  resourceId: 'reading_virtual_01', segmentId: 'segment_virtual_01', referenceText: 'Hello world',
  sourceVersion: 'reading_version_01', assignmentId: null, classId: null, submissionVersion: null };

class MemoryRecords implements PronunciationUnitOfWork, PronunciationTransaction {
  public readonly recordings = new Map<string, PronunciationRecording>();
  public readonly receipts = new Map<string, PronunciationReceipt>();
  public readonly audit: string[] = [];
  public transaction<T>(work: (transaction: PronunciationTransaction) => Promise<T>): Promise<T> { return work(this); }
  public async findRecording(_organizationId: string, recordingId: string) {
    return this.recordings.get(recordingId) ?? null;
  }
  public async listRecordings(_organizationId: string, studentId: string) {
    return [...this.recordings.values()].filter(record => record.studentId === studentId);
  }
  public async listSubmissionRecordings(_organizationId: string, taskId: string,
    assignmentId: string, submissionVersion: number) {
    return [...this.recordings.values()].filter(record => record.source.taskId === taskId
      && record.source.assignmentId === assignmentId && record.source.submissionVersion === submissionVersion);
  }
  public async saveRecording(record: PronunciationRecording, expectedVersion: number) {
    const prior = this.recordings.get(record.id);
    if ((prior?.version ?? 0) !== expectedVersion) return false;
    this.recordings.set(record.id, record);
    return true;
  }
  public async findReceipt(organizationId: string, actorId: string, operationId: string) {
    return this.receipts.get(`${organizationId}:${actorId}:${operationId}`) ?? null;
  }
  public async saveReceipt(receipt: PronunciationReceipt) {
    const key = `${receipt.organizationId}:${receipt.actorId}:${receipt.operationId}`;
    if (this.receipts.has(key)) return false;
    this.receipts.set(key, receipt);
    return true;
  }
  public async appendAudit(_actor: TrustedActorContext, action: string) { this.audit.push(action); return true; }
  public async appendWorkerAudit(_organizationId: string, action: string) { this.audit.push(action); return true; }
}

function fixture(inference?: PronunciationInferencePort) {
  const records = new MemoryRecords();
  let current = true;
  let currentTime = '2026-10-02T12:00:00+08:00';
  let formalSubmittedAt: string | null = null;
  let parentReferencedIds: string[] = [];
  let idCount = 0;
  const sources: PronunciationSourcePort = {
    async resolve(actor, input, _writable) {
      if (actor.actorRole !== 'student') throw new PronunciationError('FORBIDDEN');
      return input.kind === 'reading' ? resolvedReading : resolved;
    },
    async current() { return current; },
    async teacherSubmittedAt(actor) {
      return actor.actorRole === 'teacher' && current ? '2026-10-02T12:00:00+08:00' : null;
    },
    async parentSubmittedAt(actor) {
      return actor.actorRole === 'parent' && actor.actorUserId === 'parent_virtual_01' && current
        ? '2026-10-02T12:00:00+08:00' : null;
    },
    async parentSubmissionRecordingIds(actor) {
      return actor.actorRole === 'parent' && actor.actorUserId === 'parent_virtual_01' && current
        ? { submittedAt: '2026-10-02T12:00:00+08:00', recordingIds: parentReferencedIds } : null;
    },
  };
  const service = new PronunciationService(records, sources,
    { async seal() { return { fileId: 'cloud://env/voice/private.mp3',
      contentSha256: 'a'.repeat(64), sizeBytes: 12000, durationMs: 2000 }; } },
    inference ?? { async infer() { return { modelVersion: 'vosk-model-small-en-us-0.15', durationMs: 2000,
      words: [{ word: 'hello', start: 0, end: 0.5, confidence: 0.9 },
        { word: 'world', start: 0.6, end: 1.2, confidence: 0.9 }] }; } },
    { async temporaryUrl() { return 'https://media.example.test/voice'; } },
    { nowIso: () => currentTime },
    { next: () => `pronunciation_virtual_${++idCount}` },
    { async submittedAt() { return formalSubmittedAt; } });
  const seal = async (who = student(), n = 1) => {
    const begun = await service.beginRecording(who, taskSource, `begin_${n}_virtual`);
    await service.sealRecording(who, begun.recordingId,
      'cloud://env/voice/staging.mp3', 1, `seal_${n}_virtual_`);
    return begun.recordingId;
  };
  const sealReading = async (n = 1) => {
    const begun = await service.beginRecording(student(), readingSource, `begin_reading_${n}_virtual`);
    await service.sealRecording(student(), begun.recordingId,
      'cloud://env/voice/staging.mp3', 1, `seal_reading_${n}_virtual`);
    return begun.recordingId;
  };
  return { records, service, seal, revoke: () => { current = false; },
    sealReading,
    setNow: (value: string) => { currentTime = value; },
    setFormalSubmittedAt: (value: string | null) => { formalSubmittedAt = value; },
    setParentReferencedIds: (value: string[]) => { parentReferencedIds = value; } };
}

describe('M3 experimental pronunciation service', () => {
  it('binds student, snapshot and operation; retries do not consume a second effective score', async () => {
    const { records, service, seal } = fixture();
    const recordingId = await seal();
    const first = await service.beginScore(student(), recordingId, 2, 'score_1_virtual_');
    expect(first.status).toBe('scored');
    expect(first.experimental).toBe(true);
    expect(first.effectiveAttemptNumber).toBe(1);
    expect(first.score?.total).toBeGreaterThan(0);
    expect(await service.beginScore(student(), recordingId, 2, 'score_1_virtual_')).toEqual(first);
    expect(await service.beginScore(student(), recordingId, 2, 'score_2_virtual_')).toEqual(first);
    const secondRecording = await seal(student(), 2);
    await expect(service.beginScore(student(), secondRecording, 2, 'score_2_virtual_'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(records.audit.filter(action => action === 'pronunciation.beginScore')).toHaveLength(1);
  });

  it('rejects forged role, other student and changed snapshot before inference', async () => {
    const { service, seal, revoke } = fixture();
    const recordingId = await seal();
    await expect(service.getScore(student('teacher_virtual_01', 'teacher'), recordingId))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.getScore(student('student_virtual_02'), recordingId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    revoke();
    await expect(service.beginScore(student(), recordingId, 2, 'score_revoked_01'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('treats no speech as unreliable and does not use an effective attempt', async () => {
    const { service, seal } = fixture({ async infer() { return {
      modelVersion: 'vosk-model-small-en-us-0.15', durationMs: 2000, words: [],
    }; } });
    const recordingId = await seal();
    const result = await service.beginScore(student(), recordingId, 2, 'score_silent_01');
    expect(result).toMatchObject({ status: 'unreliable', score: null,
      qualityReason: 'NO_SPEECH', effectiveAttemptNumber: null });
  });

  it('keeps the recording after failure, deduplicates its operation and retries with a new version', async () => {
    let failing = true;
    let inferenceCalls = 0;
    const { records, service, seal } = fixture({ async infer() {
      inferenceCalls += 1;
      if (failing) throw new Error('timeout');
      return { modelVersion: 'vosk-model-small-en-us-0.15', durationMs: 2000,
        words: [{ word: 'hello', start: 0, end: 0.5, confidence: 0.9 },
          { word: 'world', start: 0.6, end: 1.2, confidence: 0.9 }] };
    } });
    const recordingId = await seal();
    await expect(service.beginScore(student(), recordingId, 2, 'score_retry_01'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    const failed = await service.getScore(student(), recordingId);
    expect(failed).toMatchObject({ status: 'failed', retryable: true, expectedVersion: 3 });
    expect(records.recordings.get(recordingId)).toMatchObject({ status: 'failed',
      failureKind: 'system', version: failed.expectedVersion,
      sizeBytes: 12000, durationMs: 2000 });
    expect((await service.beginScore(student(), recordingId, 2, 'score_retry_01')))
      .toMatchObject({ status: 'failed', expectedVersion: failed.expectedVersion });
    expect(inferenceCalls).toBe(1);
    failing = false;
    expect((await service.beginScore(student(), recordingId, failed.expectedVersion, 'score_retry_02')).status)
      .toBe('scored');
    expect(inferenceCalls).toBe(2);
  });

  it('enforces five effective attempts for one task item across recordings', async () => {
    const { service, seal } = fixture();
    for (let n = 1; n <= 5; n += 1) {
      const recordingId = await seal(student(), n);
      const result = await service.beginScore(student(), recordingId, 2, `score_${n}_virtual_`);
      expect(result.effectiveAttemptNumber).toBe(n);
    }
    const extra = await seal(student(), 6);
    await expect(service.beginScore(student(), extra, 2, 'score_6_virtual_'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('scores autonomous reading practice without creating score history', async () => {
    const { service, sealReading } = fixture();
    let latest;
    for (let n = 1; n <= 6; n += 1) {
      const recordingId = await sealReading(n);
      latest = await service.beginScore(student(), recordingId, 2, `reading_score_${n}_virtual`);
      expect(latest.status).toBe('scored');
      expect(latest.effectiveAttemptNumber).toBeNull();
    }
    expect(await service.listAttempts(student(), readingSource)).toEqual([]);
    const works = await service.listMyWorks(student(), { cursor: null, limit: 20 });
    const autonomous = works.items.filter(item => item.source.kind === 'reading');
    expect(autonomous).toHaveLength(6);
    expect(autonomous.every(item => item.score === null && item.scoredAt === null
      && item.status === 'sealed')).toBe(true);
    expect(latest?.score?.total).toBeGreaterThan(0);
  });

  it('lists only the student’s attempts for the current source', async () => {
    const { service, seal } = fixture();
    const recordingId = await seal();
    await service.beginScore(student(), recordingId, 2, 'score_list_01');
    expect((await service.listAttempts(student(), taskSource)).map(attempt => attempt.recordingId))
      .toEqual([recordingId]);
    await expect(service.listAttempts(student('teacher_virtual_01', 'teacher'), taskSource))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('pages only the owner’s works without exposing storage paths or invented media expiry', async () => {
    const { service, seal } = fixture();
    const first = await seal(student(), 1);
    const second = await seal(student(), 2);
    await service.beginScore(student(), first, 2, 'score_works_01');
    const page = await service.listMyWorks(student(), { cursor: null, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('1');
    expect(page.items[0]).toMatchObject({ experimental: true, displayTitle: '跟读练习',
      playbackAvailable: true, mediaExpired: null });
    const next = await service.listMyWorks(student(), { cursor: page.nextCursor, limit: 1 });
    expect([page.items[0]?.recordingId, next.items[0]?.recordingId].sort()).toEqual([first, second].sort());
    expect(JSON.stringify([...page.items, ...next.items])).not.toContain('cloud://');
    expect((await service.listMyWorks(student('student_virtual_other'), { cursor: null, limit: 10 })).items)
      .toEqual([]);
    await expect(service.listMyWorks(student('teacher_virtual_01', 'teacher'), { cursor: null, limit: 10 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('signs a short owner-only playback URL until formal submission retention expires', async () => {
    const { records, service, seal, setNow, setFormalSubmittedAt } = fixture();
    const recordingId = await seal();
    const own = await service.getMyPlayback(student(), recordingId);
    expect(own).toMatchObject({ scoreId: recordingId, mediaExpired: null,
      playback: { temporaryUrl: 'https://media.example.test/voice' } });
    expect(JSON.stringify(own)).not.toContain('cloud://');
    await expect(service.getMyPlayback(student('student_virtual_other'), recordingId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const submittedAt = '2026-01-01T00:00:00.000Z';
    setFormalSubmittedAt(submittedAt);
    setNow(new Date(Date.parse(submittedAt) + 60 * 86400000 - 1).toISOString());
    expect((await service.getMyPlayback(student(), recordingId)).playback).not.toBeNull();
    setNow(new Date(Date.parse(submittedAt) + 60 * 86400000).toISOString());
    expect(await service.getMyPlayback(student(), recordingId))
      .toMatchObject({ mediaExpired: true, playback: null });
    expect(records.audit.filter(action => action === 'pronunciation.getMyPlayback')).toHaveLength(3);
  });

  it('expires autonomous reading playback 30 days after recording seal', async () => {
    const { records, service, seal, setNow } = fixture();
    const recordingId = await seal();
    const original = records.recordings.get(recordingId)!;
    records.recordings.set(recordingId, { ...original, source: { ...original.source,
      kind: 'reading', taskId: null, itemId: null, assignmentId: null,
      classId: null, submissionVersion: null } });
    const sealedAt = original.sealedAt!;
    setNow(new Date(Date.parse(sealedAt) + 30 * 86400000 - 1).toISOString());
    expect((await service.getMyPlayback(student(), recordingId)).playback).not.toBeNull();
    setNow(new Date(Date.parse(sealedAt) + 30 * 86400000).toISOString());
    expect(await service.getMyPlayback(student(), recordingId))
      .toMatchObject({ mediaExpired: true, playback: null });
  });

  it('rejects sealing an abandoned classroom recording after 60 days', async () => {
    const { service, setNow } = fixture();
    const draft = await service.beginRecording(student(), taskSource, 'begin_old_voice');
    setNow(new Date(Date.parse('2026-10-02T12:00:00+08:00') + 60 * 86400000).toISOString());
    await expect(service.sealRecording(student(), draft.recordingId,
      'cloud://env/voice/staging.mp3', 1, 'seal_old_voice'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('exposes teacher evidence only through the formal submission authorization port', async () => {
    const { service, seal, revoke } = fixture();
    const recordingId = await seal();
    await service.beginScore(student(), recordingId, 2, 'score_teacher_01');
    const teacher = student('teacher_virtual_01', 'teacher');
    const evidence = await service.getTeacherEvidence(teacher, { taskId: 'task_virtual_01',
      assignmentId: 'assignment_virtual_01', submissionVersion: 1,
      itemId: 'item_virtual_01', segmentId: 'segment_virtual_01' });
    expect(evidence).toMatchObject({ experimental: true, status: 'scored',
      playback: { temporaryUrl: 'https://media.example.test/voice' } });
    revoke();
    await expect(service.getTeacherEvidence(teacher, { taskId: 'task_virtual_01',
      assignmentId: 'assignment_virtual_01', submissionVersion: 1,
      itemId: 'item_virtual_01', segmentId: 'segment_virtual_01' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('projects only the linked parent’s formal evidence without trial scores or playback', async () => {
    const { service, seal, revoke, setNow } = fixture();
    const recordingId = await seal();
    await service.beginScore(student(), recordingId, 2, 'score_parent_01');
    const input = { studentId: 'student_virtual_01', taskId: 'task_virtual_01',
      assignmentId: 'assignment_virtual_01', submissionVersion: 1,
      itemId: 'item_virtual_01', segmentId: 'segment_virtual_01' };
    const parent = student('parent_virtual_01', 'parent');
    const result = await service.getParentEvidence(parent, input);
    expect(result).toMatchObject({ status: 'scored', experimental: true,
      score: null, playback: null,
      officialScoreAvailable: false, mediaExpired: false });
    expect(JSON.stringify(result)).not.toContain('https://');
    expect(JSON.stringify(result)).not.toContain('cloud://');
    expect(JSON.stringify(result)).not.toContain(recordingId);
    await expect(service.getParentEvidence(student('parent_virtual_other', 'parent'), input))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    setNow(new Date(Date.parse('2026-10-02T12:00:00+08:00') + 60 * 86400000).toISOString());
    expect(await service.getParentEvidence(parent, input)).toMatchObject({ mediaExpired: true, playback: null });
    revoke();
    await expect(service.getParentEvidence(parent, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists only formally referenced parent segments in one safe batch', async () => {
    const { records, service, seal, setParentReferencedIds, revoke } = fixture();
    const first = await seal(student(), 1);
    await service.beginScore(student(), first, 2, 'score_parent_batch_01');
    const second = await seal(student(), 2);
    const secondRecord = records.recordings.get(second)!;
    records.recordings.set(second, { ...secondRecord,
      source: { ...secondRecord.source, segmentId: 'segment_virtual_02' } });
    setParentReferencedIds([first, second, 'missing_virtual_record_01']);
    const input = { studentId: 'student_virtual_01', taskId: 'task_virtual_01',
      assignmentId: 'assignment_virtual_01', submissionVersion: 1, itemId: 'item_virtual_01' };
    const parent = student('parent_virtual_01', 'parent');
    const result = await service.listParentEvidence(parent, input);
    expect(result).toMatchObject({ missingReferenceCount: 1,
      items: [{ segmentId: 'segment_virtual_01', status: 'scored', score: null,
        playback: null, officialScoreAvailable: false },
      { segmentId: 'segment_virtual_02', status: 'sealed', score: null,
        playback: null, officialScoreAvailable: false }] });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(first);
    expect(serialized).not.toContain(second);
    expect(serialized).not.toContain('cloud://');
    expect(records.audit.filter(action => action === 'pronunciation.listParentEvidence')).toHaveLength(1);
    await expect(service.listParentEvidence(student('parent_virtual_other', 'parent'), input))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    revoke();
    await expect(service.listParentEvidence(parent, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
