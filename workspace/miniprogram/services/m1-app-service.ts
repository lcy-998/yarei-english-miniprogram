import { M1AppRepository, ReadingCategory } from '../repositories/m1-app-repository'
import { memoryM1AppRepository } from '../repositories/memory/memory-m1-app-repository'

export type { ChildView, ProfileView, ReadingBookView, ReadingCategory, ReadingProgressView, StudentDetailView, StudentListView, WordPracticeView } from '../repositories/m1-app-repository'

export type M1AppService = Omit<M1AppRepository, 'reset'>

export function createM1AppService(repository: M1AppRepository): M1AppService {
  return {
    getProfile: (userId) => repository.getProfile(userId),
    saveProfile: (userId, displayName) => repository.saveProfile(userId, displayName),
    requestPasswordCode: (mobile) => repository.requestPasswordCode(mobile),
    resetPassword: (mobile, code, password, confirmation) => repository.resetPassword(mobile, code, password, confirmation),
    getWordPractice: (userId) => repository.getWordPractice(userId),
    listReadingBooks: (userId, category, onlyFavorites) => repository.listReadingBooks(userId, category, onlyFavorites),
    toggleReadingFavorite: (userId, bookId) => repository.toggleReadingFavorite(userId, bookId),
    getReadingProgress: (userId, bookId) => repository.getReadingProgress(userId, bookId),
    setReadingPage: (userId, bookId, pageNumber) => repository.setReadingPage(userId, bookId, pageNumber),
    listChildren: (parentId) => repository.listChildren(parentId),
    bindChild: (parentId, operationId, studentNumber, bindingCode) => repository.bindChild(parentId, operationId, studentNumber, bindingCode),
    chooseChild: (parentId, childId) => repository.chooseChild(parentId, childId),
    unbindChild: (parentId, childId, expectedVersion, operationId) => repository.unbindChild(parentId, childId, expectedVersion, operationId),
    listTeacherStudents: (teacherId, keyword, status) => repository.listTeacherStudents(teacherId, keyword, status),
    getTeacherStudent: (teacherId, studentId) => repository.getTeacherStudent(teacherId, studentId),
  }
}

let activeRepository: M1AppRepository = memoryM1AppRepository
let activeService: M1AppService = createM1AppService(activeRepository)

export function configureM1AppRepository(repository: M1AppRepository): void {
  activeRepository = repository
  activeService = createM1AppService(repository)
}

export function useMemoryM1AppRepository(): void {
  configureM1AppRepository(memoryM1AppRepository)
}

export function resetM1MemoryState(): void {
  useMemoryM1AppRepository()
  activeRepository.reset?.()
}

export const getProfile = (userId: string) => activeService.getProfile(userId)
export const saveProfile = (userId: string, displayName: string) => activeService.saveProfile(userId, displayName)
export const requestPasswordCode = (mobile: string) => activeService.requestPasswordCode(mobile)
export const resetPassword = (mobile: string, code: string, password: string, confirmation: string) => activeService.resetPassword(mobile, code, password, confirmation)
export const getWordPractice = (userId: string) => activeService.getWordPractice(userId)
export const listReadingBooks = (userId: string, category?: ReadingCategory, onlyFavorites = false) => activeService.listReadingBooks(userId, category, onlyFavorites)
export const toggleReadingFavorite = (userId: string, bookId: string) => activeService.toggleReadingFavorite(userId, bookId)
export const getReadingProgress = (userId: string, bookId: string) => activeService.getReadingProgress(userId, bookId)
export const setReadingPage = (userId: string, bookId: string, pageNumber: number) => activeService.setReadingPage(userId, bookId, pageNumber)
export const listChildren = (parentId: string) => activeService.listChildren(parentId)
export const bindChild = (parentId: string, operationId: string, studentNumber: string, bindingCode: string) => activeService.bindChild(parentId, operationId, studentNumber, bindingCode)
export const chooseChild = (parentId: string, childId: string) => activeService.chooseChild(parentId, childId)
export const unbindChild = (parentId: string, childId: string, expectedVersion?: number, operationId?: string) => activeService.unbindChild(parentId, childId, expectedVersion, operationId)
export const listTeacherStudents = (teacherId: string, keyword = '', status = 'all') => activeService.listTeacherStudents(teacherId, keyword, status)
export const getTeacherStudent = (teacherId: string, studentId: string) => activeService.getTeacherStudent(teacherId, studentId)

