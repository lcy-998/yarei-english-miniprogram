vi.mock('../../miniprogram/repositories/selfhost-upload', () => ({ uploadBackendFile: (input: { cloudPath: string; filePath: string }) => wx.cloud.uploadFile(input) }))
import { afterEach, describe, expect, it, vi } from 'vitest'

const getTaskDetail = vi.fn(), listTaskRecordings = vi.fn(), beginTaskRecording = vi.fn()
const submitTaskRecording = vi.fn(), getTaskRecordingMediaState = vi.fn()
vi.mock('../../miniprogram/subpackages/student-media/services/app-service', () => ({ getTaskDetail }))
vi.mock('../../miniprogram/subpackages/student-media/services/task-recording-service', () => ({
  listTaskRecordings, beginTaskRecording, submitTaskRecording, getTaskRecordingMediaState,
  getTaskRecordingPlayback: vi.fn(),
}))
vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: () => 'cloudbase' }))
vi.mock('../../miniprogram/subpackages/student-media/session/session', () => ({
  getCurrentTaskId: () => 'task_demo',
  getSession: () => ({ sessionId: 'session_demo', user: { id: 'student_demo', role: 'student' } }),
}))

describe('independent classroom recording task', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules();
    getTaskDetail.mockReset(); listTaskRecordings.mockReset(); beginTaskRecording.mockReset()
    submitTaskRecording.mockReset(); getTaskRecordingMediaState.mockReset() })

  it('keeps a local recording through upload and seals it for task submission', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('getCurrentPages', () => [{ options: { taskId: 'task_demo', itemId: 'recording_demo' } }])
    const recorder = { onStop: vi.fn(), onError: vi.fn(), start: vi.fn(), stop: vi.fn() }
    const uploadFile = vi.fn().mockResolvedValue({ fileID: 'cloud://staging_demo' })
    vi.stubGlobal('wx', { getRecorderManager: () => recorder, authorize: vi.fn().mockResolvedValue(undefined),
      cloud: { uploadFile }, showToast: vi.fn() })
    getTaskDetail.mockResolvedValue({ ok: true, data: { task: { id: 'task_demo', status: 'active',
      startsAt: '2026-10-01T00:00:00Z', dueAt: '2099-01-01T00:00:00Z', items: [
        { id: 'recording_demo', type: 'recording', title: 'Read aloud',
          recordingPrompt: 'Read the sentence.', completionRule: '提交录音' },
      ] }, assignment: { id: 'assignment_demo', status: 'in_progress', redoCount: 0 },
      submission: null } })
    listTaskRecordings.mockResolvedValue({ ok: true, data: [] })
    beginTaskRecording.mockResolvedValue({ ok: true, data: { id: 'recording_draft',
      status: 'draft', stagingPath: 'recordings/demo.mp3', version: 1 } })
    submitTaskRecording.mockResolvedValue({ ok: true, data: { id: 'recording_sealed',
      status: 'submitted', durationMs: 2000, sizeBytes: 8000, version: 2 } })
    await import('../../miniprogram/subpackages/student-media/recording-task/recording-task')
    if (!definition) throw new Error('Recording page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.load()
    expect(context.data.state).toBe('idle')
    await context.startRecording()
    expect(recorder.start).toHaveBeenCalledOnce()
    context.onStopped({ duration: 2000, fileSize: 8000, tempFilePath: 'wxfile://demo.mp3' })
    expect(context.data.state).toBe('local')
    await context.uploadRecording()
    expect(uploadFile).toHaveBeenCalledWith({ cloudPath: 'recordings/demo.mp3',
      filePath: 'wxfile://demo.mp3' })
    expect(context.data.state).toBe('submitted')
    expect(context.data.recordingId).toBe('recording_sealed')
  })
})
