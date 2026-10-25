import { describe, expect, it } from 'vitest'
import type { TrustedActorContext } from '../../src/auth/trusted-actor'
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database'
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository'
import type { TaskAssignmentRecord, TaskRecord, SubmissionRecord } from '../../src/task-core/types'
import { SubmittedTaskMediaPlaybackService } from '../../src/task-media/submitted-playback-service'
import { validateStudentTaskQueryRequest } from '../../src/contracts/task-query-functions'

const student: TrustedActorContext = { requestId: 'request_student_history',
  sessionId: 'session_student_history', actorUserId: 'student_one', actorRole: 'student',
  organizationId: 'org_demo', platformSubjectDigest: 'digest_student',
  permissions: [], scopeIds: [], authzVersion: 1 }
const snapshot = { mediaId: 'media_public', kind: 'listening' as const,
  mediaVersion: 2, reviewVersion: 2, mediaAssetKey: 'cloud://private/old-audio.mp3',
  mediaSha256: 'a'.repeat(64), durationMs: 5000,
  questionIds: ['q1'], questions: [{ questionId: 'q1', questionType: 'single_choice' as const,
    stem: 'What animal?', options: ['cat', 'dog'] }],
  answerKeys: [{ questionId: 'q1', correctAnswer: 'cat', explanation: 'private answer' }],
  clips: [{ questionId: 'q1', segmentId: 'clip1', startMs: 0, endMs: 5000 }],
  continuousPlaybackEnforced: true as const }
const task: TaskRecord = { id: 'task_old', organizationId: 'org_demo',
  creatorTeacherId: 'teacher_one', title: '旧听力任务', deliveryType: 'classroom',
  status: 'completed', targetType: 'students', targetClassIds: ['class_one'],
  targetStudentIds: ['student_one'], startsAt: '2026-10-05T08:00:00.000Z',
  dueAt: '2026-10-05T20:00:00.000Z', latePolicy: { allowLate: false, lateDays: 0 },
  description: null, teacherNote: null,
  itemRefs: [{ id: 'item_old', resourceId: 'media_public', order: 1 }],
  items: [{ id: 'item_old', resourceId: 'media_public', resourceVersion: 2,
    snapshotSchemaVersion: 2, resourceSnapshot: { title: '旧音频', type: 'listening',
      payload: {} }, mediaSnapshot: snapshot,
    completionRule: { kind: 'listening', questionIds: ['q1'], segmentIds: ['clip1'] },
    scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
  publishedAt: '2026-10-05T08:00:00.000Z', deadlineExtendedAt: null,
  visibility: 'visible', withdrawnAt: null, withdrawnBy: null, withdrawReason: null,
  recycledAt: null, recycledBy: null, recycleReason: null, recoverableUntil: null,
  version: 2, publication: null, publishOperationId: 'operation_publish_old' }
const assignment: TaskAssignmentRecord = { id: 'assignment_old', organizationId: 'org_demo',
  taskId: task.id, studentId: 'student_one', classId: 'class_one', status: 'completed',
  latestSubmissionId: 'submission_old', latestSubmissionVersion: 1,
  redoCount: 0, redoDueAt: null, isLate: false,
  submittedAt: '2026-10-05T19:00:00.000Z', reviewedAt: '2026-10-05T19:30:00.000Z', version: 2 }
const submission: SubmissionRecord = { id: 'submission_old', organizationId: 'org_demo',
  taskId: task.id, assignmentId: assignment.id, studentId: 'student_one',
  submissionVersion: 1, recordVersion: 1, status: 'submitted',
  answers: [{ itemId: 'item_old', value: { kind: 'listening', mediaId: 'media_public',
    mediaVersion: 2, mediaSessionId: 'session_old', questionResponses: [
      { questionId: 'q1', response: 'dog' }] } }],
  isLate: false, submittedAt: '2026-10-05T19:00:00.000Z',
  supersedesSubmissionId: null }

describe('student submitted task media snapshot replay', () => {
  it('accepts only task, item and submitted version identifiers', () => {
    const request = { apiVersion: 'm1.v1' as const,
      action: 'getSubmittedTaskMediaPlayback' as const,
      payload: { taskId: task.id, itemId: 'item_old', submissionVersion: 1 } }
    expect(validateStudentTaskQueryRequest(request).ok).toBe(true)
    expect(validateStudentTaskQueryRequest({ ...request,
      payload: { ...request.payload, mediaAssetKey: snapshot.mediaAssetKey } }).ok).toBe(false)
    expect(validateStudentTaskQueryRequest({ ...request,
      payload: { ...request.payload, submissionVersion: 0 } }).ok).toBe(false)
  })

  it('re-signs the frozen version after source takedown without a new playback session', async () => {
    const repository = new InMemoryTaskQueryRepository({ tasks: [task],
      assignments: [assignment], submissions: [submission] })
    const db = new FakeDocumentDatabase({ learning_resources: [{ _id: 'media_public',
      organizationId: 'org_demo', schemaVersion: 1, version: 3, deletedAt: null,
      status: 'offline', type: 'listening' }], operation_logs: [] })
    let nowMs = Date.parse('2026-10-06T08:00:00.000Z')
    let signedCount = 0
    const signedKeys: string[] = []
    const service = new SubmittedTaskMediaPlaybackService(repository, db, {
      async temporaryUrl(fileId) {
        signedKeys.push(fileId)
        return `https://example.test/old-audio?signature=${++signedCount}`
      },
    }, { nowIso: () => new Date(nowMs).toISOString() })
    const first = await service.get(student, task.id, 'item_old', 1)
    expect(first).toMatchObject({ ok: true, data: { mediaVersion: 2,
      temporaryUrl: 'https://example.test/old-audio?signature=1',
      clips: [{ questionId: 'q1', startMs: 0, endMs: 5000 }] } })
    nowMs += 61_000
    const second = await service.get(student, task.id, 'item_old', 1)
    expect(second).toMatchObject({ ok: true, data: {
      temporaryUrl: 'https://example.test/old-audio?signature=2' } })
    expect(signedKeys).toEqual([snapshot.mediaAssetKey, snapshot.mediaAssetKey])
    expect(db.snapshot().task_media_sessions ?? []).toHaveLength(0)
    expect(db.snapshot().operation_logs).toHaveLength(2)
    expect(JSON.stringify(first)).not.toContain('cloud://')
    expect(JSON.stringify(first)).not.toContain('private answer')
    expect(await service.get({ ...student, actorUserId: 'student_other' },
      task.id, 'item_old', 1)).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await service.get({ ...student, actorRole: 'teacher' },
      task.id, 'item_old', 1)).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(signedCount).toBe(2)
  })
})
