import { AppState, ReviewFeedback, Submission, TaskAssignment, UserAccount } from '../../domain/types'

const taskDate = new Date()
const taskStartsAt = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate(), 8).toISOString()
const taskDueAt = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate(), 20).toISOString()
const CLASS_ID = 'cls_grade3_2'
const TASK_ID = 'tsk_animals_listening'

const demoStudents: UserAccount[] = [
  { id: 'usr_student_xiaoyu', displayName: '小宇', role: 'student', classId: CLASS_ID },
  ...Array.from({ length: 35 }, (_, index): UserAccount => ({
    id: `usr_student_demo_${String(index + 2).padStart(2, '0')}`,
    displayName: `演示学生${String(index + 2).padStart(2, '0')}`,
    role: 'student',
    classId: CLASS_ID,
  })),
]

const demoAssignments: TaskAssignment[] = demoStudents.map((student, index) => {
  const assignment: TaskAssignment = {
    id: index === 0 ? 'asn_xiaoyu_animals' : `asn_demo_${String(index + 1).padStart(2, '0')}`,
    taskId: TASK_ID,
    studentId: student.id,
    classId: CLASS_ID,
    status: index === 0 ? 'in_progress' : index <= 6 ? 'awaiting_review' : index <= 27 ? 'completed' : 'not_started',
    progressPercent: index === 0 ? 67 : index <= 27 ? 100 : 0,
    redoCount: 0,
  }
  if (index > 0 && index <= 27) {
    assignment.latestSubmissionId = `sub_demo_${String(index + 1).padStart(2, '0')}`
    assignment.submittedAt = taskStartsAt
  }
  if (index > 6 && index <= 27) assignment.reviewedAt = taskStartsAt
  return assignment
})

const demoSubmissions: Submission[] = demoAssignments
  .filter((assignment) => Boolean(assignment.latestSubmissionId))
  .map((assignment, index) => ({
    id: assignment.latestSubmissionId!,
    assignmentId: assignment.id,
    studentId: assignment.studentId,
    version: 1,
    status: index < 6 ? 'submitted' : 'reviewed',
    answers: [{ taskItemId: 'tki_reading', value: '已完成演示学习记录。' }],
    submittedAt: taskStartsAt,
  }))

const demoFeedback: ReviewFeedback[] = demoAssignments
  .filter((assignment) => assignment.status === 'completed' && assignment.latestSubmissionId)
  .map((assignment, index) => ({
    id: `fbk_demo_${String(index + 1).padStart(2, '0')}`,
    assignmentId: assignment.id,
    submissionId: assignment.latestSubmissionId!,
    teacherId: 'usr_teacher_lin',
    decision: 'approved',
    score: 90,
    textComment: '完成认真，继续保持。',
    publishedAt: taskStartsAt,
  }))

export const initialState: AppState = {
  users: [
    ...demoStudents,
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
    classId: CLASS_ID,
    startsAt: taskStartsAt,
    dueAt: taskDueAt,
    description: '完成听力、跟读和单词练习后提交。',
    items: [
      { id: 'tki_listening', type: 'exercise', title: '听力练习', completionRule: '完成全部题目' },
      { id: 'tki_reading', type: 'reading', title: '跟读练习', completionRule: '提交有效录音' },
      { id: 'tki_vocabulary', type: 'vocabulary', title: '单词练习', completionRule: '完成指定词量' },
    ],
    version: 1,
  }],
  assignments: demoAssignments,
  submissions: demoSubmissions,
  feedback: demoFeedback,
  operationReceipts: [],
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
