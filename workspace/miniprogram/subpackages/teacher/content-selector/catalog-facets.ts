import type { SchoolQuestionFacet, SchoolQuestionType, TaskCatalogFacet, TaskCatalogFilters, TaskCatalogListItem } from '../../../domain/types'
import type { RecordingPromptFacet } from '../../../domain/task-recording'
import type { TeacherAssetFacet } from '../../../domain/teacher-media'

export interface CatalogChoice { value: string; label: string }

export interface CatalogFacetOptions {
  sources: CatalogChoice[]
  grades: CatalogChoice[]
  terms: CatalogChoice[]
  textbooks: CatalogChoice[]
  units: CatalogChoice[]
  difficulties: CatalogChoice[]
  knowledgePoints: CatalogChoice[]
  questionTypes: CatalogChoice[]
}

const UNLABELED_TEXTBOOK = '__unlabeled_textbook__'
export const UNLABELED_MEDIA_TEXTBOOK = UNLABELED_TEXTBOOK

export interface SelectorFacetSelection {
  source?: TaskCatalogFilters['source'] | ''
  grade?: string
  term?: string
  textbook?: string
  unit?: string
  difficulty?: string
  knowledgePoint?: string
  questionType?: SchoolQuestionType | ''
}

export interface SelectorFacetFields {
  source: boolean; grade: boolean; term: boolean; textbook: boolean; unit: boolean
  difficulty: boolean; knowledgePoint: boolean; questionType: boolean
}

export function selectorFacetFields(type: 'listening' | 'reading' | 'recording' | 'video'
  | 'vocabulary' | 'exercise' | 'dubbing'): SelectorFacetFields {
  return { source: type === 'reading' || type === 'vocabulary', grade: true,
    term: type === 'reading' || type === 'vocabulary',
    textbook: type !== 'recording', unit: true,
    difficulty: type === 'reading' || type === 'vocabulary' || type === 'exercise',
    knowledgePoint: type === 'exercise', questionType: type === 'exercise' }
}

const QUESTION_TYPE_NAMES: Record<SchoolQuestionType, string> = {
  single_choice: '单选题', multiple_choice: '多选题', fill: '填空题', subjective: '主观题',
}

function choices(values: readonly (string | undefined)[], allLabel: string, labelOf?: (value: string) => string): CatalogChoice[] {
  const unique = [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort((left, right) => left.localeCompare(right, 'zh-CN'))
  return [{ value: '', label: allLabel }, ...unique.map(value => ({ value, label: labelOf?.(value) ?? value }))]
}

function sourceLabel(source: string): string {
  return source === 'reading_book' ? '阅读书籍' : source === 'synchronized_textbook' ? '同步学教材' : '词包'
}

export function catalogFacetOptions(facets: readonly TaskCatalogFacet[], selected: Partial<Omit<TaskCatalogFilters, 'source'>> & {
  source?: TaskCatalogFilters['source'] | ''
}): CatalogFacetOptions {
  const inSource = facets.filter(item => !selected.source || item.source === selected.source)
  const inGrade = inSource.filter(item => !selected.grade || item.grade === selected.grade)
  const inTerm = inGrade.filter(item => !selected.term || item.term === selected.term)
  const inTextbook = inTerm.filter(item => !selected.textbook || item.textbook === selected.textbook)
  const inUnit = inTextbook.filter(item => !selected.unit || item.unit === selected.unit)
  return {
    sources: choices(facets.map(item => item.source), '全部来源', sourceLabel),
    grades: choices(inSource.map(item => item.grade), '全部年级'),
    terms: choices(inGrade.map(item => item.term), '全部学期'),
    textbooks: choices(inTerm.map(item => item.textbook), '全部教材', value => value === UNLABELED_TEXTBOOK ? '未标注教材' : value),
    units: choices(inTextbook.map(item => item.unit), '全部单元'),
    difficulties: choices(inUnit.map(item => item.difficulty), '全部难度'),
    knowledgePoints: choices([], '全部知识点'),
    questionTypes: choices([], '全部题型'),
  }
}

export function questionFacetOptions(facets: readonly SchoolQuestionFacet[], selected: SelectorFacetSelection): CatalogFacetOptions {
  const inGrade = facets.filter(item => !selected.grade || item.grade === selected.grade)
  const inTextbook = inGrade.filter(item => !selected.textbook || item.textbook === selected.textbook)
  const inUnit = inTextbook.filter(item => !selected.unit || item.unit === selected.unit)
  const inKnowledge = inUnit.filter(item => !selected.knowledgePoint || item.knowledgePoint === selected.knowledgePoint)
  const inType = inKnowledge.filter(item => !selected.questionType || item.questionType === selected.questionType)
  return {
    sources: choices([], '全部来源'), grades: choices(facets.map(item => item.grade), '全部年级'),
    terms: choices([], '全部学期'), textbooks: choices(inGrade.map(item => item.textbook), '全部教材'),
    units: choices(inTextbook.map(item => item.unit), '全部单元'),
    knowledgePoints: choices(inUnit.map(item => item.knowledgePoint), '全部知识点'),
    questionTypes: choices(inKnowledge.map(item => item.questionType), '全部题型',
      value => QUESTION_TYPE_NAMES[value as SchoolQuestionType]),
    difficulties: choices(inType.map(item => item.difficulty), '全部难度'),
  }
}

export function recordingFacetOptions(facets: readonly RecordingPromptFacet[], selected: SelectorFacetSelection): CatalogFacetOptions {
  const inGrade = facets.filter(item => !selected.grade || item.grade === selected.grade)
  return { sources: choices([], '全部来源'), grades: choices(facets.map(item => item.grade), '全部年级'),
    terms: choices([], '全部学期'), textbooks: choices([], '全部教材'),
    units: choices(inGrade.map(item => item.unit), '全部单元'),
    difficulties: choices([], '全部难度'), knowledgePoints: choices([], '全部知识点'),
    questionTypes: choices([], '全部题型') }
}

export function mediaFacetOptions(facets: readonly TeacherAssetFacet[], selected: SelectorFacetSelection): CatalogFacetOptions {
  const normalized = facets.map(item => ({ ...item, textbook: item.textbook ?? UNLABELED_TEXTBOOK,
    unit: item.unit ?? '__unlabeled_unit__' }))
  const inGrade = normalized.filter(item => !selected.grade || item.grade === selected.grade)
  const inTextbook = inGrade.filter(item => !selected.textbook || item.textbook === selected.textbook)
  return { sources: choices([], '全部来源'), grades: choices(normalized.map(item => item.grade), '全部年级'),
    terms: choices([], '全部学期'),
    textbooks: choices(inGrade.map(item => item.textbook), '全部教材',
      value => value === UNLABELED_TEXTBOOK ? '未标注教材' : value),
    units: choices(inTextbook.map(item => item.unit), '全部单元',
      value => value === '__unlabeled_unit__' ? '未标注单元' : value),
    difficulties: choices([], '全部难度'), knowledgePoints: choices([], '全部知识点'),
    questionTypes: choices([], '全部题型') }
}

export function catalogSource(value: string): TaskCatalogListItem['source'] | '' {
  return value === 'reading_book' || value === 'synchronized_textbook' || value === 'word_pack' ? value : ''
}
