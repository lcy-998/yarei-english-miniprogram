import { beforeEach, describe, expect, it } from 'vitest'
import { configureRepositories } from '../../miniprogram/repositories/repository-factory'
import { getReadingProgress, resetM1MemoryState, setReadingPage } from '../../miniprogram/services/m1-app-service'

describe('M1 reading task progress', () => {
  beforeEach(() => { configureRepositories({ mode: 'memory' }); resetM1MemoryState() })

  it('distinguishes an unopened book from a saved reading position', async () => {
    const before = await getReadingProgress('usr_student_xiaoyu', 'book_story')
    expect(before).toMatchObject({ ok: true, data: { pageNumber: 1, hasSavedProgress: false } })
    const saved = await setReadingPage('usr_student_xiaoyu', 'book_story', 1)
    expect(saved).toMatchObject({ ok: true, data: { pageNumber: 1, hasSavedProgress: true } })
  })
})
