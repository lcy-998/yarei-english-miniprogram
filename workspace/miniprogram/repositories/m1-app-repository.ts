import { ServiceResult } from '../domain/types'

export interface ProfileView {
  userId: string
  displayName: string
  maskedMobile: string
  role: 'student' | 'parent' | 'teacher'
  roleLabel: string
  organization: string
  className?: string
  version?: number
}

export interface WordPracticeView {
  packId: string
  packLabel: string
  todayCompleted: number
  todayTotal: number
  masteredPercent: number
  wordId: string
  word: string
  syllables: string
  meaning: string
  example: string
  options: string[]
  correctOption: string
  wrongCount: number
}

export type ReadingCategory = 'original' | 'textbook' | 'picture' | 'current' | 'chapter'

export interface ReadingBookView {
  id: string
  title: string
  category: ReadingCategory
  grade: string
  difficulty: string
  theme: string
  progressPercent: number
  favorite: boolean
  pageCount: number
}

export interface ReadingProgressView {
  book: ReadingBookView
  chapterNumber: number
  chapterCount: number
  pageNumber: number
  pageCount: number
  progressPercent: number
  pageImageUrl: string
}

export interface ChildView {
  id: string
  displayName: string
  className: string
  studentNumber: string
  current: boolean
  linkVersion?: number
}

export interface StudentListView {
  id: string
  displayName: string
  studentNumber: string
  className: string
  status: 'active' | 'follow_up' | 'disabled'
  statusLabel: string
  completedCount: number
  totalCount: number
  completionPercent: number
}

export interface StudentDetailView extends StudentListView {
  maskedMobile: string
  guardianName: string
  guardianMaskedMobile: string
  averageScore: number
  recentTasks: Array<{ id: string; title: string; statusLabel: string; score?: number }>
}

export interface M1AppRepository {
  reset?(): void
  getProfile(userId: string): Promise<ServiceResult<ProfileView>>
  saveProfile(userId: string, displayName: string): Promise<ServiceResult<ProfileView>>
  requestPasswordCode(mobile: string): Promise<ServiceResult<{ cooldownSeconds: number }>>
  resetPassword(mobile: string, code: string, password: string, confirmation: string): Promise<ServiceResult<true>>
  getWordPractice(userId: string): Promise<ServiceResult<WordPracticeView>>
  listReadingBooks(userId: string, category?: ReadingCategory, onlyFavorites?: boolean): Promise<ServiceResult<ReadingBookView[]>>
  toggleReadingFavorite(userId: string, bookId: string): Promise<ServiceResult<ReadingBookView>>
  getReadingProgress(userId: string, bookId: string): Promise<ServiceResult<ReadingProgressView>>
  setReadingPage(userId: string, bookId: string, pageNumber: number): Promise<ServiceResult<ReadingProgressView>>
  listChildren(parentId: string): Promise<ServiceResult<ChildView[]>>
  bindChild(parentId: string, operationId: string, studentNumber: string, bindingCode: string): Promise<ServiceResult<ChildView>>
  chooseChild(parentId: string, childId: string): Promise<ServiceResult<ChildView>>
  unbindChild(parentId: string, childId: string, expectedVersion?: number, operationId?: string): Promise<ServiceResult<true>>
  listTeacherStudents(teacherId: string, keyword?: string, status?: string): Promise<ServiceResult<StudentListView[]>>
  getTeacherStudent(teacherId: string, studentId: string): Promise<ServiceResult<StudentDetailView>>
}

