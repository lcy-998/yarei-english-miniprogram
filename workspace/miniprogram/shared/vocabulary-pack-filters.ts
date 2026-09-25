import { VocabularyPack } from '../domain/types'

export const UNLABELED_TEXTBOOK = '未标注教材'

export interface VocabularyPackFilters {
  grade: string
  textbook: string
  unit: string
  keyword: string
}

export interface VocabularyPackFilterOptions {
  grades: string[]
  textbooks: string[]
  units: string[]
}

export function textbookLabel(pack: VocabularyPack): string {
  return pack.textbook?.trim() || UNLABELED_TEXTBOOK
}

export function vocabularyPackOptions(packs: readonly VocabularyPack[], filters: VocabularyPackFilters): VocabularyPackFilterOptions {
  const grades = [...new Set(packs.map(pack => pack.grade))]
  const inGrade = packs.filter(pack => filters.grade === '全部年级' || pack.grade === filters.grade)
  const textbooks = [...new Set(inGrade.map(textbookLabel))]
  const inTextbook = inGrade.filter(pack => filters.textbook === '全部教材' || textbookLabel(pack) === filters.textbook)
  const units = [...new Set(inTextbook.map(pack => pack.unit))]
  return { grades, textbooks, units }
}

export function filterVocabularyPacks(packs: readonly VocabularyPack[], filters: VocabularyPackFilters): VocabularyPack[] {
  const keyword = filters.keyword.trim().toLocaleLowerCase()
  return packs.filter(pack =>
    (filters.grade === '全部年级' || pack.grade === filters.grade)
    && (filters.textbook === '全部教材' || textbookLabel(pack) === filters.textbook)
    && (filters.unit === '全部单元' || pack.unit === filters.unit)
    && (!keyword || [pack.title, pack.grade, textbookLabel(pack), pack.unit].some(value => value.toLocaleLowerCase().includes(keyword))))
}
