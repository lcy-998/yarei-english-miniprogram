import { TeacherStudentClassOption, TeacherStudentListItem } from '../../../domain/types'
import { StructuredTaskDraft } from '../../../services/app-service'

export type TargetMode = 'classes' | 'students'
export type ClassTarget = TeacherStudentClassOption & { selected: boolean }
export type StudentTarget = TeacherStudentListItem & { selected: boolean }
export const MAX_M1_TARGET_STUDENTS = 500

export function initialPublishTarget(target: StructuredTaskDraft['target'], editingTask: boolean, requestedStudentId: string): StructuredTaskDraft['target'] {
  if (requestedStudentId) return { type: 'students', studentIds: [requestedStudentId] }
  return editingTask ? target : { type: 'classes', classIds: [] }
}

export function targetCapacityError(count: number): string | null {
  return count > MAX_M1_TARGET_STUDENTS ? '单次最多布置给 500 名学员，请缩小对象范围' : null
}

export function eligibleTargetClasses(
  grantedClasses: readonly { id: string; name: string }[],
  resources: readonly { allowedClassIds?: readonly string[] }[],
  classDetails: readonly TeacherStudentClassOption[],
): TeacherStudentClassOption[] {
  return grantedClasses.filter(item => resources.every(resource => (
    resource.allowedClassIds === undefined || resource.allowedClassIds.includes(item.id)
  ))).map(item => classDetails.find(candidate => candidate.id === item.id) ?? { ...item, grade: '', term: '' })
}

export function selectedPublishTarget(mode: TargetMode, classes: readonly ClassTarget[], students: readonly StudentTarget[]): StructuredTaskDraft['target'] {
  return mode === 'classes'
    ? { type: 'classes', classIds: classes.filter(item => item.selected).map(item => item.id) }
    : { type: 'students', studentIds: students.filter(item => item.selected).map(item => item.studentId) }
}

export function publishTargetSummary(mode: TargetMode, classes: readonly ClassTarget[], students: readonly StudentTarget[]): { label: string; count: number } {
  if (mode === 'classes') {
    const selected = classes.filter(item => item.selected)
    if (!selected.length) return { label: '请选择班级', count: 0 }
    const classIds = new Set(selected.map(item => item.id))
    const count = students.filter(item => classIds.has(item.classInfo.id)).length
    return { label: `${selected.map(item => item.name).join('、')}（${count} 人）`, count }
  }
  const selected = students.filter(item => item.selected)
  if (!selected.length) return { label: '请选择学员', count: 0 }
  return { label: `${selected.slice(0, 2).map(item => item.displayName).join('、')}${selected.length > 2 ? '等' : ''}（${selected.length} 人）`, count: selected.length }
}

export function filterTargetStudents(students: readonly StudentTarget[], keyword: string): StudentTarget[] {
  const search = keyword.trim().toLowerCase()
  return search ? students.filter(item => `${item.displayName}${item.studentNumber}${item.classInfo.name}`.toLowerCase().includes(search)) : [...students]
}
