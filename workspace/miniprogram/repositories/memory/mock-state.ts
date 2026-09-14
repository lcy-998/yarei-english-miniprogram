import { AppState } from '../../domain/types'

const now = '2026-09-11T08:00:00+08:00'

export const initialState: AppState = {
  users: [
    { id: 'usr_student_xiaoyu', displayName: '小宇', role: 'student', classId: 'cls_grade3_2' },
    { id: 'usr_teacher_lin', displayName: '林老师', role: 'teacher', classId: 'cls_grade3_2' },
    { id: 'usr_parent_xiaoyu', displayName: '小宇家长', role: 'parent' },
  ],
  parentStudentLinks: [
    { id: 'rel_parent_xiaoyu', parentId: 'usr_parent_xiaoyu', studentId: 'usr_student_xiaoyu', status: 'active' },
  ],
  tasks: [{
    id: 'tsk_animals_listening',
    title: '动物主题听说练习',
    deliveryType: 'classroom',
    status: 'active',
    creatorTeacherId: 'usr_teacher_lin',
    classId: 'cls_grade3_2',
    startsAt: now,
    dueAt: '2026-09-11T20:00:00+08:00',
    description: '完成听力、跟读和单词练习后提交。',
    items: [
      { id: 'tki_listening', type: 'exercise', title: '听力练习', completionRule: '完成全部题目' },
      { id: 'tki_reading', type: 'reading', title: '跟读练习', completionRule: '提交有效录音' },
      { id: 'tki_vocabulary', type: 'vocabulary', title: '单词练习', completionRule: '完成指定词量' },
    ],
    version: 1,
  }],
  assignments: [
    { id: 'asn_xiaoyu_animals', taskId: 'tsk_animals_listening', studentId: 'usr_student_xiaoyu', classId: 'cls_grade3_2', status: 'in_progress', progressPercent: 67, redoCount: 0 },
  ],
  submissions: [],
  feedback: [],
}

function cloneState(source: AppState): AppState {
  return JSON.parse(JSON.stringify(source)) as AppState
}

let state: AppState = cloneState(initialState)

export function getState(): AppState {
  return cloneState(state)
}

export function replaceState(nextState: AppState): void {
  state = cloneState(nextState)
}

export function mutateState(mutator: (draft: AppState) => void): AppState {
  const draft = cloneState(state)
  mutator(draft)
  state = draft
  return cloneState(state)
}
