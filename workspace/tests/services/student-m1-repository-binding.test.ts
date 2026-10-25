import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryM1AppRepository } from '../../miniprogram/repositories/memory/memory-m1-app-repository'
import { configureM1AppRepository, useMemoryM1AppRepository } from '../../miniprogram/services/m1-app-service'
import { getReadingProgress as getStudentReadingProgress } from '../../miniprogram/subpackages/student/services/m1-app-service'

describe('student M1 service binding', () => {
  afterEach(() => useMemoryM1AppRepository())

  it('uses the repository configured at app startup for reading details', async () => {
    const cloudReading = vi.fn().mockResolvedValue({ ok: true, data: { book: { id: 'book_cloud' } } })
    configureM1AppRepository({ ...memoryM1AppRepository, getReadingProgress: cloudReading })

    const result = await getStudentReadingProgress('student_demo', 'book_cloud')

    expect(cloudReading).toHaveBeenCalledWith('student_demo', 'book_cloud', undefined)
    expect(result).toMatchObject({ ok: true, data: { book: { id: 'book_cloud' } } })
  })
})
