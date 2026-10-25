import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getCompletion, getDraftOptions, getParentTask, getReviewSubmission, getTaskDetail, publishClassroomTask, reviewSubmission, saveDraft, saveVocabularyProgress, submitTask } from '../../miniprogram/services/app-service'
import { resetM1MemoryState, setReadingPage } from '../../miniprogram/repositories/memory/memory-m1-app-repository'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'
import { getState, initialState, replaceState } from '../../miniprogram/repositories/memory/mock-state'
import type { StructuredSubmissionAnswer } from '../../miniprogram/services/app-service'

const studentId = 'usr_student_xiaoyu'
const teacherId = 'usr_teacher_lin'
const parentId = 'usr_parent_xiaoyu'
const clock = { now: () => new Date('2026-09-26T08:00:00.000Z') }

beforeEach(() => { configureRepositories({ mode: 'memory' }); replaceState(initialState); resetM1MemoryState() })
afterEach(() => { configureRepositories({ mode: 'memory' }); replaceState(initialState); resetM1MemoryState() })

describe('M2 question task memory fallback', () => {
  it('uses saved reading and vocabulary evidence for a mixed task', async () => {
    const options = await getDraftOptions(teacherId, clock)
    if (!options.ok) throw new Error('draft options missing')
    expect(options.data.structuredDraft.items.map(item => item.resourceId)).toEqual([
      'book_zoo', 'vocab_animals', 'res_exercise_garden_q1', 'res_exercise_garden_q2',
      'res_exercise_garden_q3', 'res_exercise_garden_q4', 'res_exercise_garden_q5',
    ])
    const published = await publishClassroomTask(teacherId, {
      operationId: 'operation_m2_mixed_publish', expectedVersion: 0, title: '动物综合练习', description: '',
      structuredDraft: { ...options.data.structuredDraft, target: { type: 'students', studentIds: [studentId] },
        startsAt: '2026-09-26T00:00:00.000Z', dueAt: '2026-09-27T00:00:00.000Z' },
    }, clock)
    if (!published.ok) throw new Error(`publish failed: ${published.error.message}`)
    const taskId = published.data.id
    const answers: StructuredSubmissionAnswer[] = [
      { itemId: 'item_reading', value: { kind: 'reading', completedPageCount: 4 } },
      { itemId: 'item_vocabulary', value: { kind: 'vocabulary', completedWordCount: 2, correctWordCount: 1 } },
      ...[
        ['res_exercise_garden_q1', 'Four'],
        ['res_exercise_garden_q2', 'In a dark cupboard'],
        ['res_exercise_garden_q3', 'Cup A'],
        ['res_exercise_garden_q4', 'bean'],
      ].map(([questionId, response], index) => ({ itemId: `item_exercise_${index + 1}`,
        value: { kind: 'exercise' as const, answeredQuestionCount: 1,
          questionResponses: [{ questionId, response }] } })),
      { itemId: 'item_exercise_5', value: { kind: 'exercise', answeredQuestionCount: 1,
        questionResponses: [{ questionId: 'res_exercise_garden_q5',
          response: ['Made a chart', 'Took turns watering the garden'] }] } },
    ]
    const command = { operationId: 'operation_m2_mixed_submit', expectedVersion: 0, taskId, answer: '', structuredAnswers: answers }
    expect(await submitTask(studentId, command, clock)).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(await setReadingPage(studentId, 'book_zoo', 4))
      .toMatchObject({ ok: true })
    expect(await submitTask(studentId, command, clock)).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(await saveVocabularyProgress(studentId, { operationId: 'operation_m2_vocabulary_progress', expectedVersion: 0,
      packId: 'vocab_animals', completedCount: 2, correctCount: 1, wrongWordIds: ['word_tiger'] }))
      .toMatchObject({ ok: true })
    expect(await submitTask(studentId, { ...command, operationId: 'operation_m2_mixed_forged', structuredAnswers: [
      answers[0], { ...answers[1], value: { kind: 'vocabulary', completedWordCount: 2, correctWordCount: 2 } }, answers[2],
    ] }, clock)).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(await submitTask(studentId, command, clock)).toMatchObject({ ok: true, data: { automaticScore: 93 } })
    expect(await getCompletion(teacherId, taskId)).toMatchObject({ ok: true, data: [{ score: 93 }] })
    expect(JSON.stringify(await getParentTask(parentId, taskId))).not.toContain('correctAnswer')
  })

  it('preserves the private key across publish, draft, submission, review and parent reads', async () => {
    const questions = [
      { id: 'res_exercise_garden_q1', response: 'Three' },
      { id: 'res_exercise_garden_q2', response: 'In a dark cupboard' },
      { id: 'res_exercise_garden_q3', response: 'Cup A' },
      { id: 'res_exercise_garden_q4', response: 'bean' },
      { id: 'res_exercise_garden_q5', response: ['Made a chart', 'Took turns watering the garden'] },
    ]
    const published = await publishClassroomTask(teacherId, {
      operationId: 'operation_m2_memory_publish', expectedVersion: 0, title: '花园阅读练习', description: '完成这组习题',
      structuredDraft: {
        items: questions.map((question, index) => ({ id: `item_garden_${index + 1}`,
          resourceId: question.id, type: 'exercise' as const, requiredCount: 1, maxScore: 100 })),
        target: { type: 'students', studentIds: [studentId] }, startsAt: '2026-09-26T00:00:00.000Z',
        dueAt: '2026-09-27T00:00:00.000Z', latePolicy: { allowLate: true, lateDays: 7 },
      },
    }, clock)
    if (!published.ok) throw new Error(`publish failed: ${published.error.message}`)
    const taskId = published.data.id
    const studentBefore = await getTaskDetail(studentId, taskId)
    expect(studentBefore).toMatchObject({ ok: true, data: { task: { items: [
      { exerciseQuestion: { questionId: 'res_exercise_garden_q1' } },
      { exerciseQuestion: { questionId: 'res_exercise_garden_q2' } },
      { exerciseQuestion: { questionId: 'res_exercise_garden_q3' } },
      { exerciseQuestion: { questionId: 'res_exercise_garden_q4' } },
      { exerciseQuestion: { questionId: 'res_exercise_garden_q5' } },
    ] } } })
    expect(JSON.stringify(studentBefore)).not.toContain('correctAnswer')
    expect(JSON.stringify(studentBefore)).not.toContain('Only Cup A grew a small green shoot.')

    const wrongAnswer: StructuredSubmissionAnswer[] = questions.map((question, index) => ({
      itemId: `item_garden_${index + 1}`, value: { kind: 'exercise', answeredQuestionCount: 1,
        questionResponses: [{ questionId: question.id, response: question.response }] },
    }))
    const draftReceipt = await saveDraft(studentId, { operationId: 'operation_m2_memory_draft', expectedVersion: 0,
      taskId, answer: '需要复习', structuredAnswers: wrongAnswer })
    expect(draftReceipt).toMatchObject({ ok: true })
    if (!draftReceipt.ok) throw new Error('draft missing')
    expect(await getReviewSubmission(teacherId, draftReceipt.data.id)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await getParentTask(parentId, taskId)).toMatchObject({ ok: true, data: { submission: undefined } })
    expect(JSON.stringify(await getParentTask(parentId, taskId))).not.toContain('需要复习')
    const savedDraft = await getTaskDetail(studentId, taskId)
    expect(savedDraft).toMatchObject({ ok: true })
    if (!savedDraft.ok) throw new Error('draft missing')
    expect(savedDraft.data.submission?.answers[0]?.structuredValue).toMatchObject({ questionResponses: [{ response: 'Three' }] })
    expect(savedDraft.data.submission?.answers.find(answer => answer.value === '需要复习')?.value).toBe('需要复习')
    expect(await submitTask(studentId, { operationId: 'operation_m2_memory_fake_count', expectedVersion: 1,
      taskId, answer: '', structuredAnswers: [{ itemId: 'item_garden_1', value: { kind: 'exercise', answeredQuestionCount: 1 } }] }, clock))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    const submitCommand = { operationId: 'operation_m2_memory_submit', expectedVersion: 1,
      taskId, answer: '', structuredAnswers: wrongAnswer }
    const submitted = await submitTask(studentId, submitCommand, clock)
    expect(submitted).toMatchObject({ ok: true, data: { automaticScore: 80 } })
    if (submitted.ok) expect(submitted.data.answers[0]?.structuredValue).toMatchObject({
      correctQuestionCount: 0, questionResponses: [{ isCorrect: false }],
    })
    expect(await submitTask(studentId, submitCommand, clock)).toEqual(submitted)
    expect(await submitTask(studentId, { ...submitCommand, structuredAnswers: questions.map((question, index) => ({
      itemId: `item_garden_${index + 1}`, value: { kind: 'exercise', answeredQuestionCount: 1,
        questionResponses: [{ questionId: question.id, response: question.id === 'res_exercise_garden_q1' ? 'Four' : question.response }] },
    })) }, clock)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })

    const completion = await getCompletion(teacherId, taskId)
    expect(completion).toMatchObject({ ok: true, data: [{ score: 80 }] })
    if (!completion.ok || !completion.data[0]?.submissionId || !completion.data[0].submissionVersion) throw new Error('submission missing')
    const submissionId = completion.data[0].submissionId
    const teacherReview = await getReviewSubmission(teacherId, submissionId)
    expect(teacherReview).toMatchObject({ ok: true, data: { automaticScore: 80 } })
    if (teacherReview.ok) expect(teacherReview.data.exerciseEvidence.some(evidence =>
      evidence.studentResponse === 'Three' && evidence.correctAnswer === 'Four' && evidence.isCorrect === false)).toBe(true)
    expect(await getParentTask(parentId, taskId)).toMatchObject({ ok: true, data: { automaticScore: 80 } })
    expect(JSON.stringify(await getParentTask(parentId, taskId))).not.toContain('correctAnswer')

    expect(await reviewSubmission(teacherId, { operationId: 'operation_m2_memory_bad_override', expectedVersion: completion.data[0].submissionVersion,
      taskId, assignmentId: completion.data[0].assignmentId, decision: 'approved', score: 75, comment: '复核完成' }, clock))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(await reviewSubmission(teacherId, { operationId: 'operation_m2_memory_override', expectedVersion: completion.data[0].submissionVersion,
      taskId, assignmentId: completion.data[0].assignmentId, decision: 'approved', score: 75,
      overrideReason: '补充作答已核实', comment: '复核完成' }, clock)).toMatchObject({ ok: true,
      data: { score: 75, originalAutomaticScore: 80, overrideReason: '补充作答已核实' } })
    expect(await getReviewSubmission(teacherId, submissionId)).toMatchObject({ ok: true, data: { feedback: {
      score: 75, originalAutomaticScore: 80, overrideReason: '补充作答已核实',
    } } })
    expect(await getParentTask(parentId, taskId)).toMatchObject({ ok: true, data: { feedback: { score: 75 } } })
    expect(JSON.stringify(await getParentTask(parentId, taskId))).not.toContain('补充作答已核实')
    expect((getState().exerciseSnapshots ?? [])).toHaveLength(5)
  })
})
