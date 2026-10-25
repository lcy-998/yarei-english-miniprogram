import { afterEach, describe, expect, it, vi } from 'vitest'

const listStudentCatalog = vi.fn()
const getReadingProgress = vi.fn()
vi.mock('../../miniprogram/repositories/repository-factory', () => ({ getRepositoryMode: () => 'cloudbase' }))
vi.mock('../../miniprogram/subpackages/student/services/app-service', () => ({
  listStudentCatalog, getReadingProgress, listStudentCatalogFacets: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/services/m1-app-service', () => ({
  getReadingProgress: vi.fn(), toggleReadingFavorite: vi.fn(),
}))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({
  getSession: () => ({ user: { id: 'student_demo' } }),
  setCurrentBookId: vi.fn(), takeReadingFavoritesOnly: vi.fn(),
}))

describe('S-03 reading catalog', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

  it('keeps every authorized book visible when individual progress reads fail', async () => {
    let definition: { data: Record<string, unknown>;
      methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    const items = Array.from({ length: 9 }, (_, index) => ({ id: `book_${index + 1}`,
      type: 'reading', title: `绘本 ${index + 1}`, category: 'picture_book', grade: '三年级',
      contentVersion: 'v1', itemCount: 8 }))
    listStudentCatalog.mockResolvedValue({ ok: true, data: { items, total: 9, nextOffset: null } })
    getReadingProgress.mockImplementation(async (_userId: string, bookId: string) => {
      if (bookId === 'book_1') return { ok: true, data: { pageNumber: 4, favorite: true } }
      if (bookId === 'book_2') return { ok: true, data: null }
      if (bookId === 'book_3') throw new Error('progress unavailable')
      return { ok: false, error: { message: 'progress unavailable' } }
    })

    await import('../../miniprogram/subpackages/student/reading-library/reading-library')
    if (!definition) throw new Error('Reading library was not registered')
    const page = { data: { ...definition.data }, setData(patch: Record<string, unknown>) {
      Object.assign(this.data, patch)
    } }
    Object.assign(page, definition.methods)
    await page.loadBookPage(0)

    expect(page.data.resultTotal).toBe(9)
    expect(page.data.visibleBooks).toHaveLength(9)
    expect(page.data.visibleBooks[0]).toMatchObject({ id: 'book_1', progressPercent: 50, favorite: true })
    expect(page.data.visibleBooks[2]).toMatchObject({ id: 'book_3', progressPercent: 0, favorite: false })
  })
})
