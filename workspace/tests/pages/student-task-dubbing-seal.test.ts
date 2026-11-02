vi.mock('../../miniprogram/repositories/selfhost-upload', () => ({ uploadBackendFile: (input: { cloudPath: string; filePath: string }) => wx.cloud.uploadFile(input) }))
import { afterEach, describe, expect, it, vi } from 'vitest'

const getTaskDetail = vi.fn(), beginWorkDraft = vi.fn(), submitWork = vi.fn()
const getTaskMediaPlayback = vi.fn(), beginTaskDubbingWork = vi.fn(), sealTaskDubbingWork = vi.fn()
const getTaskDubbingPlayback = vi.fn(), listMyTaskDubbingWorks = vi.fn()
vi.mock('../../miniprogram/subpackages/student-media/services/app-service', () => ({
  getTaskDetail, beginWorkDraft, submitWork, getMaterialPlayback: vi.fn(), getWorkMaterial: vi.fn(),
  listMyWorks: vi.fn(), listWorkMaterialFacets: vi.fn(), searchWorkMaterials: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student-media/services/task-media-service', () => ({
  getTaskMediaPlayback, beginTaskMediaSession: getTaskMediaPlayback,
  reportTaskMediaHeartbeat: vi.fn(), listMyTaskDubbingWorks,
}))
vi.mock('../../miniprogram/subpackages/student-media/services/student-task-dubbing-service', () => ({
  beginTaskDubbingWork, sealTaskDubbingWork, getTaskDubbingPlayback,
}))

describe('S-07 task dubbing sealed work', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
    getTaskDetail.mockReset(); getTaskMediaPlayback.mockReset(); beginTaskDubbingWork.mockReset();
    sealTaskDubbingWork.mockReset(); getTaskDubbingPlayback.mockReset(); listMyTaskDubbingWorks.mockReset();
    beginWorkDraft.mockReset(); submitWork.mockReset() })

  it('keeps the same task-round draft after upload failure and seals without autonomous work APIs', async () => {
    vi.useFakeTimers()
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { taskId: 'task_1', itemId: 'item_1' } }])
    const storage = new Map<string, unknown>()
    let loginSessionId = 'session_1'
    const recorderStart = vi.fn()
    const audioPlay = vi.fn()
    const navigateBack = vi.fn()
    const uploadFile = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ fileID: 'cloud://private/staging/task_1.mp3' })
    vi.stubGlobal('wx', { getRecorderManager: () => ({ onStop: vi.fn(), onError: vi.fn(),
      start: recorderStart, stop: vi.fn() }),
      getStorageSync: (key: string) => key === 'yarei_session'
        ? { sessionId: loginSessionId, user: { id: 'student_1', role: 'student' } }
        : storage.get(key) ?? null,
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      authorize: vi.fn().mockResolvedValue(undefined), cloud: { uploadFile },
      createInnerAudioContext: () => ({ src: '', play: audioPlay, stop: vi.fn(), destroy: vi.fn(),
        onEnded: vi.fn(), onError: vi.fn() }),
      navigateBack,
      showModal: ({ success }: { success: (result: { confirm: boolean }) => void }) =>
        success({ confirm: true }),
    })
    getTaskDetail.mockResolvedValue({ ok: true, data: { task: { id: 'task_1', items: [{
      id: 'item_1', type: 'dubbing', title: '虚构配音任务', mediaSnapshot: {
        kind: 'dubbing', mediaId: 'media_1', mediaVersion: 1, reviewVersion: 1,
        durationMs: 10000, questionIds: [], questions: [], clips: [],
        subtitleAvailable: false, continuousPlaybackEnforced: true,
      },
    }] }, assignment: { id: 'assignment_1', redoCount: 0 } } })
    getTaskMediaPlayback.mockResolvedValue({ ok: true, data: {
      status: 'ready', mediaId: 'media_1', mediaVersion: 1,
      sessionId: 'media_session_1', temporaryUrl: 'https://example.invalid/signed',
      expiresAt: '2099-01-01T00:00:00Z', confirmedThroughMs: 10000,
      seekForwardAllowed: false,
    } })
    listMyTaskDubbingWorks.mockResolvedValue({ ok: true, data: { items: [], nextOffset: null } })
    const draft = { workId: 'task_work_1', taskId: 'task_1', itemId: 'item_1', round: 1,
      stagingPath: 'task-dubbing/staging/task_work_1.mp3', status: 'draft',
      durationMs: null, version: 1 }
    beginTaskDubbingWork.mockResolvedValueOnce({ ok: true, data: draft })
      .mockResolvedValueOnce({ ok: true, data: { ...draft, workId: 'task_work_2',
        stagingPath: 'task-dubbing/staging/task_work_2.mp3' } })
    sealTaskDubbingWork.mockResolvedValue({ ok: true, data: { ...draft,
      status: 'submitted', durationMs: 2200, version: 2 } })
    await import('../../miniprogram/subpackages/student-media/dubbing/dubbing')
    if (!definition) throw new Error('Dubbing page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() } }
    Object.assign(context, definition.methods)
    await context.loadTaskDubbing('task_1', 'item_1')
    expect(context.data.taskPlaybackReady).toBe(true)
    await context.startRecording()
    expect(recorderStart).toHaveBeenCalledOnce()
    context.onRecorderStopped({ duration: 2200, fileSize: 1000, tempFilePath: 'wxfile://take.mp3' })
    await context.submitRecording()
    expect(context.data).toMatchObject({ recordingState: 'local', localPath: 'wxfile://take.mp3' })
    context.returnToTask()
    expect(navigateBack).not.toHaveBeenCalled()
    await context.submitRecording()
    expect(uploadFile).toHaveBeenCalledWith({ cloudPath: draft.stagingPath,
      filePath: 'wxfile://take.mp3' })
    expect(sealTaskDubbingWork).toHaveBeenCalledWith('student_1', 'task_work_1',
      'cloud://private/staging/task_1.mp3', 1, expect.any(String))
    expect(context.data).toMatchObject({ recordingState: 'submitted', taskWork: { workId: 'task_work_1' } })
    context.returnToTask()
    expect(navigateBack).toHaveBeenCalledOnce()
    const reopened = { data: { ...definition.data },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() } }
    Object.assign(reopened, definition.methods)
    await reopened.loadTaskDubbing('task_1', 'item_1')
    expect(reopened.data).toMatchObject({ recordingState: 'submitted',
      taskWork: { workId: 'task_work_1' }, durationMs: 2200 })
    storage.clear()
    loginSessionId = 'session_2'
    listMyTaskDubbingWorks.mockResolvedValue({ ok: true, data: { items: [{
      workId: 'task_work_1', taskId: 'task_1', taskTitle: '虚构配音任务', itemId: 'item_1',
      round: 1, status: 'task_pending', durationMs: 2200,
      submittedAt: '2026-10-16T10:00:00+08:00', playbackAvailable: true,
    }], nextOffset: null } })
    const afterLogin = { data: { ...definition.data },
      setData(change: Record<string, unknown>, done?: () => void) { Object.assign(this.data, change); done?.() } }
    Object.assign(afterLogin, definition.methods)
    await afterLogin.loadTaskDubbing('task_1', 'item_1')
    expect(afterLogin.data).toMatchObject({ recordingState: 'submitted',
      taskWork: { workId: 'task_work_1' }, durationMs: 2200 })
    getTaskDubbingPlayback.mockResolvedValue({ ok: true, data: { workId: 'task_work_1',
      status: 'task_pending', durationMs: 2200, temporaryUrl: 'https://example.invalid/work.mp3',
      expiresAt: '2099-01-01T00:00:00Z' } })
    await reopened.playSubmittedTaskRecording()
    expect(getTaskDubbingPlayback).toHaveBeenCalledWith('student_1', 'task_work_1')
    expect(audioPlay).toHaveBeenCalledOnce()
    expect(beginWorkDraft).not.toHaveBeenCalled()
    expect(submitWork).not.toHaveBeenCalled()
    context.data.localPath = ''
    context.redoRecording()
    expect(context.data.taskWork).toBeNull()
    await context.startRecording()
    expect(beginTaskDubbingWork).toHaveBeenCalledTimes(2)
    expect(beginTaskDubbingWork.mock.calls[0]?.[3]).not.toBe(beginTaskDubbingWork.mock.calls[1]?.[3])
    expect(context.data.taskWork).toMatchObject({ workId: 'task_work_2', status: 'draft' })
  })
})
