import type { ExerciseSection } from '../domain/types'

export interface SectionQuestionCard {
  itemId: string
  number: number
  exerciseSection?: ExerciseSection
}

export interface DisplaySectionCard extends SectionQuestionCard {
  sectionStart: boolean
  sectionTitle: string
  sectionInstruction: string
  sectionMaterial: string
  localNumber: number
}

/** Legacy flat packs keep their original order; new packs use the frozen section order. */
export function arrangeExerciseSections<T extends SectionQuestionCard>(cards: T[]): Array<T & DisplaySectionCard> {
  const complete = cards.length > 0 && cards.every(card => card.exerciseSection !== undefined)
  const ordered = complete ? [...cards].sort((left, right) =>
    left.exerciseSection!.order - right.exerciseSection!.order
      || left.exerciseSection!.questionOrder - right.exerciseSection!.questionOrder) : [...cards]
  return ordered.map((card, index) => {
    const section = complete ? card.exerciseSection : undefined
    const prior = index > 0 ? ordered[index - 1]?.exerciseSection : undefined
    return { ...card, number: index + 1,
      sectionStart: !!section && section.id !== prior?.id,
      sectionTitle: section?.title ?? '', sectionInstruction: section?.instruction ?? '',
      sectionMaterial: section?.studentMaterial ?? '', localNumber: section?.questionOrder ?? index + 1 }
  })
}
