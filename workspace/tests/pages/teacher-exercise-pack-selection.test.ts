import { describe, expect, it, vi } from 'vitest'
import type { SchoolQuestionSummary } from '../../miniprogram/subpackages/teacher/domain/types'

const questions: SchoolQuestionSummary[] = Array.from({ length: 5 }, (_, index) => ({
  id: `question_market_0${index + 1}`, exercisePackId: 'pack_market',
  title: `Market reading - Question ${index + 1}`, grade: '三年级',
  questionType: index === 0 ? 'single_choice' : 'fill',
  stemSummary: index === 0 ? 'Where is the market?' : 'Read the market story',
  contentVersion: '1',
}))

describe('T-18 exercise packs', () => {
  it('shows one selectable card for five related questions and keeps all five IDs', async () => {
    vi.stubGlobal('Component', () => undefined)
    const { groupedQuestionRows, matchingQuestionGroups } = await import(
      '../../miniprogram/subpackages/teacher/content-selector/content-selector')
    expect(groupedQuestionRows(questions)).toMatchObject([{
      id: 'pack:pack_market', title: 'Market reading',
      questionIds: questions.map(question => question.id),
    }])
    expect(groupedQuestionRows(questions.slice(0, 4))).toEqual([])
    expect(matchingQuestionGroups(questions, { keyword: 'Where', knowledgePoint: '',
      questionType: '', difficulty: '' })[0]?.questionIds).toEqual(questions.map(question => question.id))
    expect(groupedQuestionRows(questions.map(question => ({ ...question,
      exercisePackId: undefined, textbook: 'Market reading', unit: 'Unit 1' }))))
      .toMatchObject([{ questionIds: questions.map(question => question.id) }])
    vi.unstubAllGlobals()
  })
})
