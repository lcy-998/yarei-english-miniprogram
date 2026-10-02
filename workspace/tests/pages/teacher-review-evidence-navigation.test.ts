import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTeacherReviewItem, teacherExerciseView, teacherReviewRoute } from '../../miniprogram/shared/teacher-review-item'
import { displayPageImageUrl } from '../../miniprogram/shared/reading-page-image'

interface PageContext {
  data: Record<string, unknown>
  setData(patch: Record<string, unknown>, callback?: () => void): void
  showTeacherWord?(index: number): void
}

interface PageDefinition {
  methods: Record<string, (this: PageContext, argument?: unknown) => unknown>
}

async function pageDefinition(loader: () => Promise<unknown>): Promise<PageDefinition> {
  vi.resetModules()
  let definition: PageDefinition | undefined
  vi.stubGlobal('Component', (value: PageDefinition) => { definition = value })
  await loader()
  if (!definition) throw new Error('Page unavailable')
  return definition
}

describe('T-08 打开原学生作业页的教师只读模式', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('只接受明确的提交与任务项上下文', () => {
    expect(teacherReviewRoute({ teacherReview: '1', submissionId: 'sub_demo', itemId: 'item_read' }))
      .toEqual({ submissionId: 'sub_demo', itemId: 'item_read' })
    expect(teacherReviewRoute({ teacherReview: '1', submissionId: '', itemId: 'item_read' })).toBeNull()
    expect(teacherReviewRoute({ submissionId: 'sub_demo', itemId: 'item_read' })).toBeNull()
  })

  it('学生身份无法借教师查看参数读取他人提交', async () => {
    vi.stubGlobal('wx', { getStorageSync: () => ({ activeRole: 'student', user: { id: 'student_demo', role: 'student' } }) })
    expect(await loadTeacherReviewItem({ submissionId: 'submission_demo', itemId: 'read' }, 'reading'))
      .toMatchObject({ ok: false, message: '仅授权教师可查看学生作答。' })
  })

  it('在原题卡标出学生所选选项的对错，缺失证据不推断答案', () => {
    const wrong = teacherExerciseView({ itemId: 'quiz', questionId: 'q1', stem: '选择单词',
      options: ['cat', 'sun'], studentResponse: 'sun', correctAnswer: 'cat', explanation: '',
      isCorrect: false, recorded: true, questionType: 'single_choice' })
    expect(wrong).toMatchObject({ answerLabel: 'sun', correctLabel: 'cat', verdict: '错误',
      choices: [{ value: 'cat', selected: false, correct: true }, { value: 'sun', selected: true, correct: false }] })
    const correct = teacherExerciseView({ itemId: 'quiz', questionId: 'q1', stem: '选择单词',
      options: ['cat', 'sun'], studentResponse: 'cat', correctAnswer: 'cat', explanation: '',
      isCorrect: true, recorded: true, questionType: 'single_choice' })
    expect(correct.verdict).toBe('正确')
    expect(correct.choices[0]).toMatchObject({ value: 'cat', selected: true, correct: true })
    expect(teacherExerciseView(null)).toMatchObject({ answerLabel: '未记录', verdict: '本次提交未记录逐题作答' })
  })

  it('作业详情逐项打开原阅读、单词或任务页，点评输入留在原页', async () => {
    const definition = await pageDefinition(() => import('../../miniprogram/pages/teacher/review-task/review-task'))
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo })
    const context: PageContext = { data: { activeRow: { assignmentId: 'assignment_demo' },
      selectedSubmissionId: 'submission_demo', submissionLoading: false, taskItemsLoading: false,
      submissionError: '', taskItemsError: '', comment: '继续努力', score: 85,
      manualScoreRows: [], taskItems: [
        { id: 'read', type: 'reading' }, { id: 'word', type: 'vocabulary' },
        { id: 'quiz', type: 'exercise' }, { id: 'audio', type: 'recording' },
      ], detailRows: [{ id: 'read' }, { id: 'word' }, { id: 'quiz' }, { id: 'audio' }] },
    setData(patch) { Object.assign(this.data, patch) } }
    for (const id of ['read', 'word', 'quiz', 'audio']) {
      definition.methods.openReviewItem.call(context, { currentTarget: { dataset: { id } } })
    }
    expect(navigateTo.mock.calls.map(call => call[0].url)).toEqual([
      '/pages/student/reading-detail/reading-detail?teacherReview=1&submissionId=submission_demo&itemId=read',
      '/pages/student/vocabulary/vocabulary?teacherReview=1&submissionId=submission_demo&itemId=word',
      '/pages/student/task-detail/task-detail?teacherReview=1&submissionId=submission_demo&itemId=quiz',
      '/pages/student/task-detail/task-detail?teacherReview=1&submissionId=submission_demo&itemId=audio',
    ])
    expect(context.data).toMatchObject({ comment: '继续努力', score: 85 })
  })

  it('教师在阅读页自由翻页，翻页和页图加载不保存学生进度', async () => {
    const definition = await pageDefinition(() => import('../../miniprogram/pages/student/reading-detail/reading-detail'))
    const context: PageContext = { data: { teacherReviewMode: true, reviewPageIndex: 0,
      reading: { pages: [
        { pageNumber: 4, chapterNumber: 1, imageUrl: '/four.jpg', thumbnailUrl: '/four-small.jpg' },
        { pageNumber: 8, chapterNumber: 2, imageUrl: '/eight.jpg', thumbnailUrl: '/eight-small.jpg' },
      ] } }, setData(patch) { Object.assign(this.data, patch) } }
    await definition.methods.changePage.call(context, 1)
    expect(context.data).toMatchObject({ reviewPageIndex: 1, displayPageNumber: 8, pendingPageNumber: 0 })
    await definition.methods.imageLoaded.call(context)
    await definition.methods.saveVisiblePage.call(context)
    expect(context.data.saving).toBe(false)
  })

  it('教师阅读页使用与学生页一致的页图地址转换', () => {
    expect(displayPageImageUrl('demo/reading/zoo/page-01-image'))
      .toBe('/assets/content/demo-zoo-picture-book-cover-v1.jpg')
    expect(displayPageImageUrl('demo/reading/zoo/page-02-thumbnail'))
      .toBe('/assets/content/demo-zoo-page-02-v1.jpg')
    expect(displayPageImageUrl('demo/page-01-image'))
      .toBe('/assets/content/demo-zoo-picture-book-cover-v1.jpg')
    expect(displayPageImageUrl('demo/image')).toBe('/assets/content/demo-zoo-page-02-v1.jpg')
    expect(displayPageImageUrl('https://example.invalid/signed-page')).toBe('https://example.invalid/signed-page')
    expect(displayPageImageUrl('')).toBe('')
    expect(displayPageImageUrl('unknown-page')).toBe('')
  })

  it('教师在原单词词卡翻阅时保留学生首答，不能提交答案', async () => {
    const definition = await pageDefinition(() => import('../../miniprogram/pages/student/vocabulary/vocabulary'))
    const context: PageContext = { data: { teacherReviewMode: true, wordIndex: 0,
      pack: { words: [{ id: 'w1', word: 'sun', syllables: ['sun'] }, { id: 'w2', word: 'moon', syllables: ['moon'] }] },
      teacherEvidence: [
        { wordId: 'w1', firstCorrect: false, attempts: [{ studentInput: 'son' }] },
        { wordId: 'w2', firstCorrect: true, attempts: [{ studentInput: 'moon' }] },
      ] }, setData(patch) { Object.assign(this.data, patch) },
    showTeacherWord(index) { definition.methods.showTeacherWord.call(this, index) } }
    definition.methods.showTeacherWord.call(context, 0)
    expect(context.data).toMatchObject({ spellingAnswer: 'son', answerCorrect: false })
    await definition.methods.submitAnswer.call(context)
    definition.methods.nextWord.call(context)
    expect(context.data).toMatchObject({ wordIndex: 1, spellingAnswer: 'moon', answerCorrect: true })
  })
})
