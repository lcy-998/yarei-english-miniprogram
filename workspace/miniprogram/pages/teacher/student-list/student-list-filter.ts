import { StudentListView } from '../../../repositories/m1-app-repository'

export function filterStudentsByClass(students: readonly StudentListView[], selectedClass: string): StudentListView[] {
  return selectedClass === '全部负责班级' ? [...students] : students.filter(student => student.className === selectedClass)
}
