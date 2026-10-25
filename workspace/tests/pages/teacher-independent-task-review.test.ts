import { afterEach, describe, expect, it, vi } from 'vitest'

const getReviewSubmission = vi.fn()
const getTaskDetail = vi.fn()
const getTeacherTaskMediaReviewEvidence = vi.fn()
const beginTaskMediaSession = vi.fn()
const reportTaskMediaHeartbeat = vi.fn()
const getTaskRecordingMediaState = vi.fn()
const getTaskRecordingPlayback = vi.fn()
const setTeacherReviewScoreDraft = vi.fn()

vi.mock('../../miniprogram/services/app-service', () => ({
  getReviewSubmission, getTaskDetail, getSchoolQuestion: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student-media/services/app-service', () => ({
  getReviewSubmission, getTaskDetail, getSchoolQuestion: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({
  getReviewSubmission, getTaskDetail, getSchoolQuestion: vi.fn(),
}))
vi.mock('../../miniprogram/services/teacher-media-service', () => ({
  getTeacherTaskMediaReviewEvidence, previewTeacherAsset: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student-media/services/teacher-media-service', () => ({
  getTeacherTaskMediaReviewEvidence, previewTeacherAsset: vi.fn(),
}))
vi.mock('../../miniprogram/services/task-media-service', () => ({
  beginTaskMediaSession, reportTaskMediaHeartbeat, getTaskMediaPlayback: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student-media/services/task-media-service', () => ({
  beginTaskMediaSession, reportTaskMediaHeartbeat, getTaskMediaPlayback: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/services/task-media-service', () => ({
  beginTaskMediaSession, reportTaskMediaHeartbeat, getTaskMediaPlayback: vi.fn(),
}))
vi.mock('../../miniprogram/services/task-recording-service', () => ({
  getTaskRecordingMediaState, getTaskRecordingPlayback,
  getRecordingPrompt: vi.fn(), beginTaskRecording: vi.fn(),
  listTaskRecordings: vi.fn(), submitTaskRecording: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student-media/services/task-recording-service', () => ({
  getTaskRecordingMediaState, getTaskRecordingPlayback,
  getRecordingPrompt: vi.fn(), beginTaskRecording: vi.fn(),
  listTaskRecordings: vi.fn(), submitTaskRecording: vi.fn(),
}))
vi.mock('../../miniprogram/session/session', () => ({
  getSession: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
    user: { id: 'teacher_demo', role: 'teacher' } }),
  getCurrentTaskId: () => '',
  getTeacherReviewScoreDraft: () => null,
  setTeacherReviewScoreDraft,
}))
vi.mock('../../miniprogram/subpackages/student-media/session/session', () => ({
  getSession: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
    user: { id: 'teacher_demo', role: 'teacher' } }),
  getCurrentTaskId: () => '',
  getTeacherReviewScoreDraft: () => null,
  setTeacherReviewScoreDraft,
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ sessionId: 'teacher_session', activeRole: 'teacher',
    user: { id: 'teacher_demo', role: 'teacher' } }),
  getCurrentTaskId: () => '',
  getTeacherReviewScoreDraft: () => null,
  setTeacherReviewScoreDraft,
}))

type Definition = { data: Record<string, unknown>;
  methods: Record<string, (...args: never[]) => unknown> }

async function page(path: string, itemId: string, group = false) {
  let definition: Definition | null = null
  vi.stubGlobal('Component', (value: Definition) => { definition = value })
  vi.stubGlobal('getCurrentPages', () => [{ options: {
    teacherReview: '1', submissionId: 'submission_demo', itemId,
    ...(group ? { group: '1' } : {}),
  } }])
  const navigateBack = vi.fn()
  vi.stubGlobal('wx', { navigateBack, createVideoContext: () => ({
    pause: vi.fn(), seek: vi.fn(), play: vi.fn(), playbackRate: vi.fn(),
  }), createInnerAudioContext: () => ({ src: '', play: vi.fn(),
    onEnded: vi.fn(), onError: vi.fn(), destroy: vi.fn() }) })
  await import(path)
  if (!definition) throw new Error('Student page not registered')
  const context = { data: { ...definition.data },
    setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
  Object.assign(context, definition.methods)
  return { context: context as typeof context & Definition['methods'], navigateBack }
}

function submission(type: string, scoreRequired = false) {
  return { ok: true, data: {
    submissionVersion: 2, taskItems: [{ id: 'item_demo', type,
      title: 'A long English title', recordingPrompt: 'Read this aloud.' }],
    answers: [{ itemId: 'item_demo', value: type === 'recording'
      ? { kind: 'recording', recordingId: 'recording_demo', durationMs: 2200 }
      : { kind: type } }],
    scoringItems: [{ itemId: 'item_demo', teacherScoreRequired: scoreRequired }],
    exerciseEvidence: type === 'exercise' ? [{
      itemId: 'item_demo', questionId: 'question_demo', questionType: 'single_choice',
      stem: 'Pick A', options: ['A', 'B'], studentResponse: 'B',
      correctAnswer: 'A', explanation: 'A is correct.', isCorrect: false, recorded: true,
    }] : [],
  } }
}
function media(kind: 'listening' | 'video') {
  return { ok: true, data: {
    taskId: 'task_demo', assignmentId: 'assignment_demo',
    submissionId: 'submission_demo', submissionVersion: 2,
    itemId: 'item_demo', title: 'A long English title', kind,
    mediaVersion: 1, durationMs: 10000,
    sourcePlayback: { available: true,
      temporaryUrl: 'https://example.test/media',
      expiresAt: '2099-01-01T00:00:00Z' },
    questions: [{ questionId: 'question_demo', questionType: 'single_choice',
      stem: 'Pick A', options: ['A', 'B'], studentResponse: 'B',
      correctAnswer: 'A', explanation: 'A is correct.',
      isCorrect: false, recorded: true,
      clip: kind === 'listening'
        ? { segmentId: 'segment_demo', startMs: 0, endMs: 2000 } : null }],
    verifiedPlayedSegmentIds: ['segment_demo'],
    verifiedRanges: [{ startMs: 0, endMs: 9000 }],
    subtitleCues: [], finalWork: null,
  } }
}

describe('T-08 opens submitted evidence in independent student pages', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

  it('shows the submitted listening answer without a student media session or heartbeat', async () => {
    getReviewSubmission.mockResolvedValue(submission('listening', true))
    getTeacherTaskMediaReviewEvidence.mockResolvedValue(media('listening'))
    const { context, navigateBack } = await page('../../miniprogram/subpackages/student-media/listening-task/listening-task', 'item_demo')
    await context.load()
    expect(context.data).toMatchObject({ teacherReview: true, teacherPreview: true,
      teacherReviewVersion: 2, questions: [{ verdict: '错误', responseLabel: 'B',
        correctLabel: 'A' }] })
    context.chooseOption({ currentTarget: { dataset: { questionId: 'question_demo', value: 'A' } } } as never)
    context.finish()
    context.onTeacherReviewScore({ detail: { value: '76' } } as never)
    expect(setTeacherReviewScoreDraft).toHaveBeenCalledWith({
      submissionId: 'submission_demo', itemId: 'item_demo', input: '76',
    })
    await context.returnToTask()
    expect(navigateBack).toHaveBeenCalled()
    expect(beginTaskMediaSession).not.toHaveBeenCalled()
    expect(reportTaskMediaHeartbeat).not.toHaveBeenCalled()
    expect(getTaskDetail).not.toHaveBeenCalled()
  })

  it('shows the submitted video answer in the original video layout without writing progress', async () => {
    getReviewSubmission.mockResolvedValue(submission('video'))
    getTeacherTaskMediaReviewEvidence.mockResolvedValue(media('video'))
    const { context } = await page('../../miniprogram/subpackages/student-media/video-task/video-task', 'item_demo')
    await context.load()
    expect(context.data).toMatchObject({ teacherReview: true, teacherPreview: true,
      kind: 'video', questions: [{ verdict: '错误', responseLabel: 'B' }] })
    context.inputAnswer({ currentTarget: { dataset: { questionId: 'question_demo' } },
      detail: { value: 'changed' } } as never)
    context.finish()
    expect(beginTaskMediaSession).not.toHaveBeenCalled()
    expect(reportTaskMediaHeartbeat).not.toHaveBeenCalled()
    expect(getTaskDetail).not.toHaveBeenCalled()
  })

  it('scores a subjective video question below the answer and includes objective results', async () => {
    getReviewSubmission.mockResolvedValue(submission('video', true))
    const result = media('video')
    result.data.questions.push({ questionId: 'question_open', questionType: 'subjective',
      stem: 'Explain the scene', options: [], studentResponse: 'A short explanation',
      correctAnswer: null, explanation: '评分要点', isCorrect: null, recorded: true, clip: null })
    getTeacherTaskMediaReviewEvidence.mockResolvedValue(result)
    const { context } = await page('../../miniprogram/subpackages/student-media/video-task/video-task', 'item_demo')
    await context.load()
    expect(context.data.questions).toMatchObject([
      { teacherScoreRequired: false, verdict: '错误' },
      { teacherScoreRequired: true, verdict: '待教师评分' },
    ])
    context.onTeacherQuestionScore({ currentTarget: { dataset: { questionId: 'question_open' } },
      detail: { value: '80' } } as never)
    expect(context.data.teacherItemScorePreview).toBe(40)
    expect(setTeacherReviewScoreDraft).toHaveBeenCalledWith({ submissionId: 'submission_demo',
      itemId: 'item_demo', input: '40', questionInputs: { question_open: '80' } })
  })

  it('uses the submitted exercise evidence and keeps the answer read-only', async () => {
    getReviewSubmission.mockResolvedValue(submission('exercise', true))
    const { context } = await page('../../miniprogram/subpackages/student/exercise-task/exercise-task', 'item_demo')
    await context.load()
    expect(context.data).toMatchObject({ teacherReview: true, editable: false,
      cards: [{ answerLabel: 'B', correctLabel: 'A', verdict: '错误' }] })
    context.chooseOption({ currentTarget: { dataset: { value: 'A' } } } as never)
    expect(context.data).toMatchObject({ cards: [{ response: 'B' }] })
    context.onTeacherReviewScore({ detail: { value: '91' } } as never)
    expect(setTeacherReviewScoreDraft).toHaveBeenCalledWith({
      submissionId: 'submission_demo', itemId: 'item_demo', input: '91',
      inputs: { item_demo: '91' },
    })
    expect(getTaskDetail).not.toHaveBeenCalled()
  })

  it('opens the whole submitted exercise pack from one review card', async () => {
    const result = submission('exercise', true)
    result.data.taskItems = [
      { id: 'item_demo', type: 'exercise', title: '校园花园｜大题一：语言｜第 1 小题', order: 1 },
      { id: 'item_2', type: 'exercise', title: '校园花园｜大题二：阅读｜第 1 小题', order: 2 },
    ]
    result.data.answers.push({ itemId: 'item_2', value: { kind: 'exercise' } })
    result.data.exerciseEvidence.push({ itemId: 'item_2', questionId: 'question_2',
      questionType: 'single_choice', stem: 'Pick B', options: ['A', 'B'],
      studentResponse: 'B', correctAnswer: 'B', explanation: 'B is correct.',
      isCorrect: true, recorded: true })
    getReviewSubmission.mockResolvedValue(result)
    const { context } = await page('../../miniprogram/subpackages/student/exercise-task/exercise-task', 'item_demo', true)
    await context.load()
    expect(context.data).toMatchObject({ teacherReview: true, groupedTeacherReview: true,
      teacherScoreRequired: false, title: '校园花园', cards: [
        { itemId: 'item_demo', answerLabel: 'B', verdict: '错误' },
        { itemId: 'item_2', answerLabel: 'B', verdict: '正确' },
      ] })
    expect(getTaskDetail).not.toHaveBeenCalled()
  })

  it('places a score input on each subjective question in a grouped exercise', async () => {
    const result = submission('exercise')
    result.data.taskItems[0]!.title = '校园花园｜大题一：语言｜第 1 小题'
    result.data.taskItems.push({ id: 'item_2', type: 'exercise',
      title: '校园花园｜大题一：语言｜第 2 小题', order: 2 })
    result.data.answers.push({ itemId: 'item_2', value: { kind: 'exercise' } })
    result.data.scoringItems.push({ itemId: 'item_2', teacherScoreRequired: true })
    result.data.exerciseEvidence.push({ itemId: 'item_2', questionId: 'question_open',
      questionType: 'subjective', stem: 'Explain', options: [],
      studentResponse: 'My answer', correctAnswer: null, explanation: '评分要点',
      isCorrect: null, recorded: true })
    getReviewSubmission.mockResolvedValue(result)
    const { context } = await page('../../miniprogram/subpackages/student/exercise-task/exercise-task',
      'item_demo', true)
    await context.load()
    expect(context.data.cards).toMatchObject([
      { itemId: 'item_demo', teacherScoreRequired: false },
      { itemId: 'item_2', teacherScoreRequired: true },
    ])
    context.onTeacherReviewScore({ currentTarget: { dataset: { itemId: 'item_2' } },
      detail: { value: '75' } } as never)
    expect(setTeacherReviewScoreDraft).toHaveBeenCalledWith({ submissionId: 'submission_demo',
      itemId: 'item_2', input: '75', inputs: { item_2: '75' } })
  })

  it('uses the recording layout and an authorized playback without opening the microphone', async () => {
    getReviewSubmission.mockResolvedValue(submission('recording', true))
    getTaskRecordingMediaState.mockResolvedValue({ ok: true, data: { mediaExpired: false } })
    getTaskRecordingPlayback.mockResolvedValue({ ok: true,
      data: { temporaryUrl: 'https://example.test/recording' } })
    const { context } = await page('../../miniprogram/subpackages/student-media/recording-task/recording-task', 'item_demo')
    await context.load()
    expect(context.data).toMatchObject({ teacherReview: true, editable: false,
      recordingId: 'recording_demo', state: 'submitted', mediaAvailable: true })
    await context.playSubmitted()
    expect(getTaskRecordingPlayback).toHaveBeenCalledWith('teacher_demo', 'recording_demo')
    context.onTeacherReviewScore({ detail: { value: '87' } } as never)
    expect(setTeacherReviewScoreDraft).toHaveBeenCalledWith({
      submissionId: 'submission_demo', itemId: 'item_demo', input: '87',
    })
    context.startRecording()
    expect(getTaskDetail).not.toHaveBeenCalled()
  })

  it('refuses media evidence for a different submitted item', async () => {
    getReviewSubmission.mockResolvedValue(submission('listening'))
    getTeacherTaskMediaReviewEvidence.mockResolvedValue({ ...media('listening'),
      data: { ...media('listening').data, itemId: 'another_item' } })
    const { context } = await page('../../miniprogram/subpackages/student-media/listening-task/listening-task', 'item_demo')
    await context.load()
    expect(context.data.error).toContain('不一致')
    expect(context.data.snapshot).toBeNull()
    expect(beginTaskMediaSession).not.toHaveBeenCalled()
  })
})
