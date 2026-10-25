import { afterEach, describe, expect, it, vi } from 'vitest'

const getWordPractice = vi.fn()
vi.mock('../../miniprogram/subpackages/student/services/m1-app-service', () => ({ getWordPractice }))
vi.mock('../../miniprogram/subpackages/student/session/session', () => ({ getSession: () => ({ sessionId: 'student_session',
  user: { id: 'student_demo', role: 'student' } }) }))

describe('S-02 legacy word card syllable source', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); getWordPractice.mockReset() })

  it('uses the trusted parts and blocks a display string without structured parts', async () => {
    let definition: { data: Record<string, unknown>; methods: Record<string, (...args: never[]) => unknown> } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    vi.stubGlobal('wx', {})
    const word = { word: 'sunshine', syllables: 'sun-shine', syllableParts: ['sun', 'shine'],
      meaning: '阳光', options: ['阳光', '雨天'], correctOption: '阳光' }
    getWordPractice.mockResolvedValueOnce({ ok: true, data: word })
      .mockResolvedValueOnce({ ok: true, data: { ...word, syllableParts: [] } })
    await import('../../miniprogram/subpackages/student/word-practice/word-practice')
    if (!definition) throw new Error('Word practice page was not registered')
    const context = { data: { ...definition.data },
      setData(change: Record<string, unknown>) { Object.assign(this.data, change) } }
    Object.assign(context, definition.methods)
    await context.loadWord()
    expect(context.data.syllableLabel).toBe('sun-shine')
    await context.loadWord()
    expect(context.data.error).toContain('缺少已核对的音节数据')
  })
})
