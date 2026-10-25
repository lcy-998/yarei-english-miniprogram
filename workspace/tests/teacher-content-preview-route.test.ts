import { describe, expect, it } from 'vitest'
import { teacherContentPreviewRoute } from '../miniprogram/shared/teacher-content-preview'

describe('teacher content preview route', () => {
  it('keeps the resource and optional target scope while rejecting malformed routes', () => {
    expect(teacherContentPreviewRoute({ teacherPreview: '1', type: 'reading',
      resourceId: 'book_demo', targetClassIds: 'class_a%2Cclass_b' }))
      .toEqual({ resourceId: 'book_demo', type: 'reading', targetClassIds: ['class_a', 'class_b'] })
    expect(teacherContentPreviewRoute({ teacherPreview: '1', type: 'exercise', resourceId: '../private' })).toBeNull()
    expect(teacherContentPreviewRoute({ teacherPreview: '1', type: 'video', resourceId: 'video_demo',
      targetClassIds: 'class_a%2Cclass_a' })).toBeNull()
  })
})
