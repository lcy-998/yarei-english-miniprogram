import type { SchoolQuestionFacet, SchoolQuestionFilters, SchoolQuestionType } from '../../../domain/types'

export interface QuestionFacetOptions {
  grades: string[]
  textbooks: string[]
  units: string[]
  knowledgePoints: string[]
  questionTypes: SchoolQuestionType[]
  difficulties: string[]
}

export function questionFacetOptions(facets: readonly SchoolQuestionFacet[], selected: SchoolQuestionFilters): QuestionFacetOptions {
  const inGrade = facets.filter(item => !selected.grade || item.grade === selected.grade)
  const inTextbook = inGrade.filter(item => !selected.textbook || item.textbook === selected.textbook)
  const inUnit = inTextbook.filter(item => !selected.unit || item.unit === selected.unit)
  const inKnowledge = inUnit.filter(item => !selected.knowledgePoint || item.knowledgePoint === selected.knowledgePoint)
  const inType = inKnowledge.filter(item => !selected.questionType || item.questionType === selected.questionType)
  return {
    grades: uniqueValues(facets.map(item => item.grade)),
    textbooks: uniqueValues(inGrade.map(item => item.textbook)),
    units: uniqueValues(inTextbook.map(item => item.unit)),
    knowledgePoints: uniqueValues(inUnit.map(item => item.knowledgePoint)),
    questionTypes: [...new Set(inKnowledge.map(item => item.questionType))],
    difficulties: uniqueValues(inType.map(item => item.difficulty)),
  }
}

export function questionTypeLabel(type: SchoolQuestionType): string {
  return type === 'single_choice' ? '单选题' : type === 'multiple_choice' ? '多选题'
    : type === 'fill' ? '填空题' : '主观题'
}

function uniqueValues(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort((left, right) => left.localeCompare(right, 'zh-CN'))
}
