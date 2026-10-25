import type { TeacherPrivateVideo, TeacherVideoQuestion,
  TeacherVideoQuestionType } from '../../../domain/teacher-private-video'
import { beginMyVideoUpload, getMyVideo, publishMyVideo, saveMyVideo,
  sealMyVideo, retryMyVideoProcessing } from '../services/teacher-private-video-service'
import { previewTeacherAsset } from '../services/teacher-media-service'
import { getSession, setTeacherCatalogResultIds } from '../session/session'
import { EMPTY_WRITE_INTENT, type WriteIntentState,
  createPageOperationId, prepareWriteIntent } from '../shared/write-intent'

type QuestionRow = { questionId: string; questionType: TeacherVideoQuestionType;
  stem: string; options: Array<{ id: string; value: string }>; answerText: string; explanation: string }
const TYPES: Array<{ value: TeacherVideoQuestionType; label: string }> = [
  { value: 'single_choice', label: '单选' }, { value: 'multiple_choice', label: '多选' },
  { value: 'fill', label: '填空' }, { value: 'subjective', label: '简答' },
]
function newQuestion(): QuestionRow {
  return { questionId: `q_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    questionType: 'single_choice', stem: '', options: [{ id: '0', value: '' }, { id: '1', value: '' }],
    answerText: '', explanation: '' }
}
function toQuestion(row: QuestionRow): TeacherVideoQuestion {
  return { questionId: row.questionId, questionType: row.questionType,
    stem: row.stem.trim(), options: row.questionType === 'single_choice'
      || row.questionType === 'multiple_choice' ? row.options.map(option => option.value.trim()) : [],
    correctAnswer: row.questionType === 'subjective' ? null
      : row.questionType === 'multiple_choice' ? row.answerText.split(',').map(value => value.trim()).filter(Boolean)
        : row.answerText.trim(),
    explanation: row.explanation.trim() }
}
function fromQuestion(question: TeacherVideoQuestion): QuestionRow {
  return { questionId: question.questionId, questionType: question.questionType,
    stem: question.stem, options: question.options.map((value, index) => ({ id: String(index), value })),
    answerText: Array.isArray(question.correctAnswer)
      ? question.correctAnswer.join(',') : question.correctAnswer ?? '',
    explanation: question.explanation }
}

Component({
  data: {
    id: '', version: 0, status: 'draft' as TeacherPrivateVideo['status'],
    title: '', questions: [newQuestion()] as QuestionRow[], typeLabels: TYPES.map(item => item.label),
    localPath: '', previewUrl: '', durationMs: 0, durationLabel: '', busy: false, message: '', initialized: false,
    saveIntent: EMPTY_WRITE_INTENT as WriteIntentState,
  },
  pageLifetimes: { show() {
    if (this.data.initialized) return
    const pages = getCurrentPages() as Array<{ options?: Record<string, string> }>
    const id = pages[pages.length - 1]?.options?.id ?? ''
    this.setData({ initialized: true, id }, () => { if (id) this.load(id) })
  } },
  methods: {
    async load(id: string) {
      const session = getSession()
      if (!session) return
      const result = await getMyVideo(session.user.id, id)
      if (!result.ok) { this.setData({ message: result.error.message }); return }
      const item = result.data
      this.setData({ title: item.title, version: item.version, status: item.status,
        durationMs: item.durationMs, durationLabel: `${Math.ceil(item.durationMs / 1000)} 秒`,
        questions: item.questions.map(fromQuestion), previewUrl: item.previewUrl ?? '' })
      if (item.status === 'published' && !item.previewUrl) {
        const preview = await previewTeacherAsset(session.user.id, id)
        if (preview.ok) this.setData({ previewUrl: preview.data.playback.temporaryUrl })
      }
      if (item.status === 'failed') this.setData({ message: `视频校验失败：${item.processingError ?? '请重试或重新选择视频'}` })
      else if (item.status === 'processing') this.setData({ message: '视频正在校验；请稍后刷新状态' })
      else this.setData({ message: '' })
    },
    titleInput(event: WechatMiniprogram.Input) { this.setData({ title: event.detail.value }) },
    async chooseCamera() { await this.choose(['camera']) },
    async chooseAlbum() { await this.choose(['album']) },
    async choose(sourceType: Array<'camera' | 'album'>) {
      try {
        const directCamera = sourceType.includes('camera')
        const picked = await wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType,
          maxDuration: 30 })
        const file = picked.tempFiles[0]
        if (!file?.tempFilePath || !Number.isFinite(file.duration) || file.duration < 1
          || file.duration > (directCamera ? 30 : 600)) {
          this.setData({ message: directCamera ? '现场录制最长 30 秒；较长视频请先用手机相机录制，再从相册选择（最长 10 分钟）' : '请选择不超过 10 分钟的视频' }); return
        }
        if (file.size > 200 * 1024 * 1024) {
          this.setData({ message: '视频文件超过 200 MB，请先压缩后再选择' }); return
        }
        this.setData({ localPath: file.tempFilePath, previewUrl: file.tempFilePath,
          durationMs: Math.round(file.duration * 1000),
          durationLabel: `${Math.ceil(file.duration)} 秒`, message: '' })
      } catch { this.setData({ message: '未选择视频或无法使用相机，请检查权限后重试' }) }
    },
    addQuestion() {
      if (this.data.questions.length >= 6) { this.setData({ message: '每条视频最多 6 道题' }); return }
      this.setData({ questions: [...this.data.questions, newQuestion()] })
    },
    removeQuestion(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      this.setData({ questions: this.data.questions.filter((_, row) => row !== index) })
    },
    changeType(event: WechatMiniprogram.PickerChange) {
      const rowIndex = Number(event.currentTarget.dataset.index)
      const type = TYPES[Number(event.detail.value)]?.value
      if (!type || !this.data.questions[rowIndex]) return
      const questions = [...this.data.questions]
      const row = questions[rowIndex]!
      questions[rowIndex] = { ...row, questionType: type,
        options: type === 'single_choice' || type === 'multiple_choice'
          ? row.options.length >= 2 ? row.options : [{ id: '0', value: '' }, { id: '1', value: '' }] : [], answerText: '' }
      this.setData({ questions })
    },
    editText(event: WechatMiniprogram.Input) {
      const index = Number(event.currentTarget.dataset.index)
      const field = event.currentTarget.dataset.field as 'stem' | 'answerText' | 'explanation'
      if (!this.data.questions[index] || !['stem', 'answerText', 'explanation'].includes(field)) return
      const questions = [...this.data.questions]
      questions[index] = { ...questions[index]!, [field]: event.detail.value }
      this.setData({ questions })
    },
    editOption(event: WechatMiniprogram.Input) {
      const index = Number(event.currentTarget.dataset.index)
      const optionIndex = Number(event.currentTarget.dataset.optionIndex)
      const row = this.data.questions[index]
      if (!row || !Number.isSafeInteger(optionIndex) || optionIndex < 0 || optionIndex >= row.options.length) return
      const questions = [...this.data.questions]
      const options = [...row.options]
      options[optionIndex] = { ...options[optionIndex]!, value: event.detail.value }
      questions[index] = { ...row, options }
      this.setData({ questions })
    },
    addOption(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const row = this.data.questions[index]
      if (!row || row.options.length >= 6) return
      const questions = [...this.data.questions]
      questions[index] = { ...row, options: [...row.options, { id: String(row.options.length), value: '' }] }
      this.setData({ questions })
    },
    async persist(): Promise<TeacherPrivateVideo | null> {
      const session = getSession()
      if (!session || (session.activeRole ?? session.user.role) !== 'teacher') {
        this.setData({ message: '请使用教师账号编辑视频' }); return null
      }
      const questions = this.data.questions.map(toQuestion)
      const fingerprint = JSON.stringify([this.data.id, this.data.version, this.data.title, questions])
      const saveIntent = prepareWriteIntent(this.data.saveIntent, fingerprint,
        () => createPageOperationId('teacher_video_save'))
      this.setData({ saveIntent })
      const result = await saveMyVideo(session.user.id, this.data.title,
        questions, this.data.id || undefined,
        this.data.id ? this.data.version : undefined, saveIntent.operationId)
      if (!result.ok) { this.setData({ message: result.error.message }); return null }
      this.setData({ id: result.data.id, version: result.data.version,
        status: result.data.status, saveIntent: EMPTY_WRITE_INTENT })
      return result.data
    },
    async saveDraft() {
      if (this.data.busy) return
      this.setData({ busy: true, message: '' })
      const saved = await this.persist()
      const completed = saved && this.data.localPath ? await this.uploadAndSeal(saved) : saved
      this.setData({ busy: false, message: completed
        ? completed.status === 'processing' ? '视频已上传，正在校验；可稍后返回查看' : '草稿已保存'
        : this.data.message })
    },
    async uploadAndSeal(video: TeacherPrivateVideo): Promise<TeacherPrivateVideo | null> {
      const session = getSession()
      if (!session || !this.data.localPath) return video
      const begun = await beginMyVideoUpload(session.user.id, video.id, video.version)
      if (!begun.ok || !begun.data.stagingPath) {
        this.setData({ message: begun.ok ? '上传路径不可用' : begun.error.message }); return null
      }
      this.setData({ version: begun.data.version, status: begun.data.status, message: '正在上传视频' })
      try {
        const uploaded = await wx.cloud.uploadFile({ cloudPath: begun.data.stagingPath,
          filePath: this.data.localPath })
        this.setData({ message: '正在核验并封存视频' })
        const sealed = await sealMyVideo(session.user.id, video.id, begun.data.version, uploaded.fileID)
        if (!sealed.ok) {
          const latest = await getMyVideo(session.user.id, video.id)
          if (latest.ok && (latest.data.status === 'processing'
            || latest.data.status === 'ready' || latest.data.status === 'published'
            || latest.data.status === 'failed')) {
            this.setData({ version: latest.data.version, status: latest.data.status,
              localPath: '', message: latest.data.status === 'failed'
                ? `视频校验失败：${latest.data.processingError ?? '请重试'}` : '' })
            return latest.data
          }
          this.setData({ message: sealed.error.message }); return null
        }
        this.setData({ version: sealed.data.version, status: sealed.data.status, localPath: '' })
        return sealed.data
      } catch { this.setData({ message: '上传中断，视频已保留在本机，可重新选择并重试' }); return null }
    },
    async publishAndAssign() {
      if (this.data.busy) return
      if (this.data.questions.length < 1 || this.data.questions.length > 6) {
        this.setData({ message: '请设置 1—6 道视频题目' }); return
      }
      this.setData({ busy: true, message: '' })
      const saved = await this.persist()
      const ready = saved && this.data.localPath ? await this.uploadAndSeal(saved) : saved
      if (!ready) { this.setData({ busy: false }); return }
      if (ready.status === 'processing') {
        this.setData({ busy: false, message: '视频正在校验；通过后再点击布置作业' }); return
      }
      if (ready.status === 'failed') {
        this.setData({ busy: false, message: '视频校验失败，请点击重试校验或重新选择视频' }); return
      }
      if (ready.status !== 'ready' && ready.status !== 'published') {
        this.setData({ busy: false, message: '请先录制或上传视频' }); return
      }
      const session = getSession()
      if (!session) { this.setData({ busy: false }); return }
      const result = ready.status === 'published' ? { ok: true as const, data: ready }
        : await publishMyVideo(session.user.id, ready.id, ready.version)
      this.setData({ busy: false })
      if (!result.ok) { this.setData({ message: result.error.message }); return }
      this.setData({ version: result.data.version, status: 'published' })
      setTeacherCatalogResultIds([result.data.id])
      wx.navigateTo({ url: '/subpackages/teacher/publish-task/publish-task' })
    },
    async refreshStatus() {
      if (!this.data.id || this.data.busy) return
      await this.load(this.data.id)
    },
    async retryProcessing() {
      if (!this.data.id || this.data.status !== 'failed' || this.data.busy) return
      const session = getSession()
      if (!session) return
      this.setData({ busy: true, message: '' })
      const result = await retryMyVideoProcessing(session.user.id, this.data.id, this.data.version)
      this.setData({ busy: false, message: result.ok
        ? result.data.status === 'ready' ? '视频校验通过，可以布置作业' : '已重新提交校验；稍后刷新状态'
        : result.error.message })
      if (result.ok) this.setData({ version: result.data.version, status: result.data.status })
    },
  },
})
