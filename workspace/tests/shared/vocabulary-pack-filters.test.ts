import { describe, expect, it } from 'vitest'
import { VocabularyPack } from '../../miniprogram/domain/types'
import { filterVocabularyPacks, vocabularyPackOptions } from '../../miniprogram/shared/vocabulary-pack-filters'

const packs: VocabularyPack[] = [
  { id: 'pack_animals', title: '动物主题', grade: '三年级', textbook: '演示教材甲', unit: 'Unit 1', contentVersion: 'demo-v1', words: [] },
  { id: 'pack_nature', title: '自然主题', grade: '三年级', textbook: '演示教材乙', unit: 'Unit 2', contentVersion: 'demo-v1', words: [] },
  { id: 'pack_sky', title: '天空主题', grade: '四年级', unit: 'Unit 1', contentVersion: 'demo-v1', words: [] },
]

describe('vocabulary pack selection', () => {
  it('derives textbook and unit choices only from the selected authorized grade', () => {
    const options = vocabularyPackOptions(packs, { grade: '三年级', textbook: '演示教材乙', unit: '全部单元', keyword: '' })
    expect(options.textbooks).toEqual(['演示教材甲', '演示教材乙'])
    expect(options.units).toEqual(['Unit 2'])
  })

  it('keeps packs without textbook metadata explicit and matches keyword within filters', () => {
    const filters = { grade: '四年级', textbook: '未标注教材', unit: 'Unit 1', keyword: '天空' }
    expect(filterVocabularyPacks(packs, filters).map(pack => pack.id)).toEqual(['pack_sky'])
    expect(filterVocabularyPacks(packs, { ...filters, textbook: '演示教材甲' })).toEqual([])
  })
})
