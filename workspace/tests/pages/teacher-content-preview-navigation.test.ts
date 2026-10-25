import { afterEach, describe, expect, it, vi } from 'vitest'

describe('T-18 student-page content preview', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('opens the existing student page for all seven task types', async () => {
    let definition: { methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { getStorageSync: () => ({ sessionId: 'teacher_session',
      activeRole: 'teacher', user: { id: 'teacher_demo', role: 'teacher' } }), navigateTo })
    await import('../../miniprogram/subpackages/teacher/content-selector/content-selector')
    if (!definition) throw new Error('T-18 page unavailable')
    const rows = ['reading', 'vocabulary', 'exercise', 'recording', 'listening', 'video', 'dubbing']
      .map(type => ({ id: `res_${type}`, type }))
    const context = { data: { rows, targetClassIds: ['class_demo'] }, targetScope: () => ['class_demo'] }
    for (const row of rows) {
      await definition.methods.previewRow.call(context, { currentTarget: { dataset: { id: row.id } } } as never)
    }
    expect(navigateTo.mock.calls.map(call => call[0].url)).toEqual([
      '/subpackages/student/reading-detail/reading-detail?teacherPreview=1&resourceId=res_reading&type=reading&targetClassIds=class_demo',
      '/subpackages/student/vocabulary/vocabulary?teacherPreview=1&resourceId=res_vocabulary&type=vocabulary&targetClassIds=class_demo',
      '/subpackages/student/exercise-task/exercise-task?teacherPreview=1&resourceId=res_exercise&type=exercise&targetClassIds=class_demo',
      '/subpackages/student-media/recording-task/recording-task?teacherPreview=1&resourceId=res_recording&type=recording&targetClassIds=class_demo',
      '/subpackages/student-media/listening-task/listening-task?teacherPreview=1&resourceId=res_listening&type=listening&targetClassIds=class_demo',
      '/subpackages/student-media/video-task/video-task?teacherPreview=1&resourceId=res_video&type=video&targetClassIds=class_demo',
      '/subpackages/student-media/dubbing/dubbing?teacherPreview=1&resourceId=res_dubbing&type=dubbing&targetClassIds=class_demo',
    ])
  })
})
