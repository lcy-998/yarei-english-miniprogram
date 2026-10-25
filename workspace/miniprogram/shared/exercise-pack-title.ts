export function exercisePackTitle(title: string): string {
  return title.replace(/(?:\s*｜\s*大题[^｜]+｜\s*第\s*\d+\s*小题|\s*[-–—]\s*Question\s*\d+|\s*｜\s*第\s*\d+\s*题|\s*｜\s*Reading\s*\d+)\s*$/iu, '')
}

export function exercisePackTitleKey(title: string): string | null {
  const groupTitle = exercisePackTitle(title)
  return groupTitle === title ? null : groupTitle
}

export function exerciseQuestionPackKey(question: {
  exercisePackId?: string; title: string; grade: string; textbook?: string; unit?: string;
  contentVersion: string
}): string | undefined {
  if (question.exercisePackId) return question.exercisePackId
  if (!exercisePackTitleKey(question.title) || !question.textbook || !question.unit) return undefined
  return [exercisePackTitle(question.title), question.grade, question.textbook, question.unit,
    question.contentVersion].join('|')
}

export function taskExerciseGroupKey(item: { id: string; title: string;
  exerciseQuestion?: { exercisePackId?: string } }): string {
  const packId = item.exerciseQuestion?.exercisePackId
  return packId ? `pack:${packId}` : exercisePackTitleKey(item.title)
    ? `title:${exercisePackTitle(item.title)}` : `item:${item.id}`
}
