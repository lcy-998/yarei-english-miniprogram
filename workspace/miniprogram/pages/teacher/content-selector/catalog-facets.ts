import type { TaskCatalogFacet, TaskCatalogFilters, TaskCatalogListItem } from '../../../domain/types'

export interface CatalogChoice { value: string; label: string }

export interface CatalogFacetOptions {
  sources: CatalogChoice[]
  grades: CatalogChoice[]
  terms: CatalogChoice[]
  textbooks: CatalogChoice[]
  units: CatalogChoice[]
  difficulties: CatalogChoice[]
}

const UNLABELED_TEXTBOOK = '__unlabeled_textbook__'

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
  }
}

export function catalogSource(value: string): TaskCatalogListItem['source'] | '' {
  return value === 'reading_book' || value === 'synchronized_textbook' || value === 'word_pack' ? value : ''
}
