import { exercisePackTitle, exercisePackTitleKey } from './exercise-pack-title'

export interface ExerciseReviewItem { id: string; title: string; type: string }
export interface ExerciseReviewGroup { id: string; title: string; itemIds: string[]; type: string }

/** A legacy single question stays separate; only adjacent items with an explicit pack title merge. */
export function exerciseReviewGroups(items: readonly ExerciseReviewItem[]): ExerciseReviewGroup[] {
  const groups: ExerciseReviewGroup[] = []
  let previousKey: string | null = null
  for (const item of items) {
    const key = item.type === 'exercise' ? exercisePackTitleKey(item.title) : null
    const previous = groups[groups.length - 1]
    if (key && previous && previous.type === 'exercise' && previousKey === key) {
      previous.itemIds.push(item.id)
      continue
    }
    groups.push({ id: item.id, title: key ? exercisePackTitle(item.title) : item.title,
      itemIds: [item.id], type: item.type })
    previousKey = key
  }
  return groups
}

export function exerciseReviewGroupFor(items: readonly ExerciseReviewItem[], itemId: string): ExerciseReviewGroup | null {
  return exerciseReviewGroups(items).find(group => group.itemIds.includes(itemId)) ?? null
}
