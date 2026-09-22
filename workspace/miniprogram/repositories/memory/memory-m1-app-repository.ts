import { ServiceResult } from '../../domain/types'
import { ChildView, M1AppRepository, ProfileView, ReadingBookView, ReadingCategory, ReadingProgressView, StudentDetailView, StudentListView, WordPracticeView } from '../m1-app-repository'

interface M1MemoryState {
  profiles: ProfileView[]
  books: ReadingBookView[]
  readingPages: Record<string, number>
  children: ChildView[]
  childBindingReceipts: Array<{ operationId: string; fingerprint: string; child: ChildView }>
  nextBoundChildSequence: number
  students: StudentDetailView[]
}

const initialState: M1MemoryState = {
  profiles: [
    { userId: 'usr_student_xiaoyu', displayName: '小宇', maskedMobile: '138****5678', role: 'student', roleLabel: '学生', organization: '启航实验学校', className: '三年级 2 班' },
    { userId: 'usr_parent_xiaoyu', displayName: '小宇家长', maskedMobile: '138****2046', role: 'parent', roleLabel: '家长', organization: '启航实验学校' },
    { userId: 'usr_teacher_lin', displayName: '林老师', maskedMobile: '138****3088', role: 'teacher', roleLabel: '教师', organization: '启航实验学校' },
  ],
  books: [
    { id: 'book_zoo', title: 'A Day at the Zoo', category: 'picture', grade: '三年级', difficulty: '入门', theme: '动物', progressPercent: 25, favorite: true, pageCount: 12 },
    { id: 'book_story', title: '英语小故事', category: 'picture', grade: '三年级', difficulty: '初级', theme: '生活', progressPercent: 0, favorite: false, pageCount: 10 },
    { id: 'book_original', title: 'Nature Walk', category: 'original', grade: '三年级', difficulty: '入门', theme: '自然', progressPercent: 10, favorite: false, pageCount: 8 },
  ],
  readingPages: { 'usr_student_xiaoyu:book_zoo': 3 },
  children: [{ id: 'usr_student_xiaoyu', displayName: '小宇', className: '三年级 2 班', studentNumber: '0321', current: true, linkVersion: 1 }],
  childBindingReceipts: [],
  nextBoundChildSequence: 1,
  students: [
    { id: 'usr_student_xiaoyu', displayName: '小宇', studentNumber: '0321', className: '三年级 2 班', status: 'active', statusLabel: '正常', completedCount: 8, totalCount: 10, completionPercent: 80, maskedMobile: '138****2046', guardianName: '小宇家长', guardianMaskedMobile: '138****2046', averageScore: 86, recentTasks: [{ id: 'tsk_animals_listening', title: '动物主题听说练习', statusLabel: '已完成', score: 86 }, { id: 'tsk_demo_english', title: '英语综合练习', statusLabel: '进行中' }] },
    { id: 'usr_student_linke', displayName: '林可', studentNumber: '0318', className: '三年级 2 班', status: 'active', statusLabel: '正常', completedCount: 9, totalCount: 10, completionPercent: 90, maskedMobile: '139****1068', guardianName: '林可家长', guardianMaskedMobile: '139****1068', averageScore: 92, recentTasks: [] },
    { id: 'usr_student_chenyi', displayName: '陈一', studentNumber: '0309', className: '四年级 1 班', status: 'follow_up', statusLabel: '待跟进', completedCount: 6, totalCount: 10, completionPercent: 60, maskedMobile: '137****4812', guardianName: '陈一家长', guardianMaskedMobile: '137****4812', averageScore: 78, recentTasks: [] },
  ],
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
let state = clone(initialState)

const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data: clone(data) })
const fail = <T>(code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT', message: string): ServiceResult<T> => ({ ok: false, error: { code, message, retryable: false } })

export function resetM1MemoryState(): void { state = clone(initialState) }

export async function getProfile(userId: string): Promise<ServiceResult<ProfileView>> {
  const profile = state.profiles.find(item => item.userId === userId)
  return profile ? ok(profile) : fail('NOT_FOUND', '账号资料不存在')
}

export async function saveProfile(userId: string, displayName: string): Promise<ServiceResult<ProfileView>> {
  const normalized = displayName.trim()
  if (!normalized || normalized.length > 20) return fail('VALIDATION_ERROR', '姓名须为 1—20 个字符')
  const profile = state.profiles.find(item => item.userId === userId)
  if (!profile) return fail('NOT_FOUND', '账号资料不存在')
  profile.displayName = normalized
  return ok(profile)
}

export async function requestPasswordCode(mobile: string): Promise<ServiceResult<{ cooldownSeconds: number }>> {
  if (!/^1\d{10}$/.test(mobile)) return fail('VALIDATION_ERROR', '请输入正确的手机号')
  if (!['13800000001', '13800000002', '13800000003'].includes(mobile)) return fail('NOT_FOUND', '未找到可重置的演示账号')
  return ok({ cooldownSeconds: 60 })
}

export async function resetPassword(mobile: string, code: string, password: string, confirmation: string): Promise<ServiceResult<true>> {
  if (!/^1\d{10}$/.test(mobile)) return fail('VALIDATION_ERROR', '请输入正确的手机号')
  if (!['13800000001', '13800000002', '13800000003'].includes(mobile)) return fail('NOT_FOUND', '未找到可重置的演示账号')
  if (!/^\d{6}$/.test(code)) return fail('VALIDATION_ERROR', '请输入 6 位验证码')
  if (code !== '123456') return fail('VALIDATION_ERROR', '验证码已失效，请重新获取')
  const categories = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length
  if (password.length < 12 || password.length > 32 || categories < 3) return fail('VALIDATION_ERROR', '密码须为 12—32 位，并包含大小写字母、数字、特殊字符中的至少三类')
  if (password !== confirmation) return fail('VALIDATION_ERROR', '两次输入的密码不一致')
  return ok(true)
}

export async function getWordPractice(userId: string): Promise<ServiceResult<WordPracticeView>> {
  if (userId !== 'usr_student_xiaoyu') return fail('FORBIDDEN', '无权查看该词包')
  return ok({ packId: 'pack_grade3_unit3', packLabel: '三年级 Unit 3', todayCompleted: 8, todayTotal: 10, masteredPercent: 80, wordId: 'word_sunshine', word: 'sun-shine', syllables: 'sun-shine', meaning: '阳光', example: 'The sunshine is warm.', options: ['阳光', '雨天', '森林'], correctOption: '阳光', wrongCount: 2 })
}

export async function listReadingBooks(userId: string, category?: ReadingCategory, onlyFavorites = false): Promise<ServiceResult<ReadingBookView[]>> {
  if (userId !== 'usr_student_xiaoyu') return fail('FORBIDDEN', '无权查看阅读内容')
  const books = state.books.filter(item => (!category || item.category === category) && (!onlyFavorites || item.favorite))
  return ok(books)
}

export async function toggleReadingFavorite(userId: string, bookId: string): Promise<ServiceResult<ReadingBookView>> {
  if (userId !== 'usr_student_xiaoyu') return fail('FORBIDDEN', '无权修改收藏')
  const book = state.books.find(item => item.id === bookId)
  if (!book) return fail('NOT_FOUND', '阅读内容不存在')
  book.favorite = !book.favorite
  return ok(book)
}

export async function getReadingProgress(userId: string, bookId: string): Promise<ServiceResult<ReadingProgressView>> {
  if (userId !== 'usr_student_xiaoyu') return fail('FORBIDDEN', '无权阅读该内容')
  const book = state.books.find(item => item.id === bookId)
  if (!book) return fail('NOT_FOUND', '阅读内容不存在')
  const pageNumber = state.readingPages[`${userId}:${bookId}`] ?? 1
  return ok({ book, chapterNumber: 1, chapterCount: 3, pageNumber, pageCount: book.pageCount, progressPercent: Math.round(pageNumber * 100 / book.pageCount), pageImageUrl: '/assets/m1/reading-zoo-page-03.jpg' })
}

export async function setReadingPage(userId: string, bookId: string, pageNumber: number): Promise<ServiceResult<ReadingProgressView>> {
  const current = await getReadingProgress(userId, bookId)
  if (!current.ok) return current
  const savedPage = Math.max(1, Math.min(current.data.pageCount, Math.floor(pageNumber)))
  state.readingPages[`${userId}:${bookId}`] = savedPage
  const book = state.books.find(item => item.id === bookId)!
  book.progressPercent = Math.round(savedPage * 100 / book.pageCount)
  return getReadingProgress(userId, bookId)
}

export async function listChildren(parentId: string): Promise<ServiceResult<ChildView[]>> {
  return parentId === 'usr_parent_xiaoyu' ? ok(state.children) : fail('FORBIDDEN', '无权查看孩子信息')
}

export async function bindChild(parentId: string, operationId: string, studentNumber: string, bindingCode: string): Promise<ServiceResult<ChildView>> {
  if (parentId !== 'usr_parent_xiaoyu') return fail('FORBIDDEN', '无权添加孩子')
  if (!operationId.trim()) return fail('VALIDATION_ERROR', '操作标识无效')
  const fingerprint = JSON.stringify({ studentNumber: studentNumber.trim(), bindingCode: bindingCode.trim() })
  const receipt = state.childBindingReceipts.find(item => item.operationId === operationId.trim())
  if (receipt) return receipt.fingerprint === fingerprint ? ok(receipt.child) : fail('CONFLICT', '该操作已使用不同内容，请重新提交')
  if (state.children.length >= 5) return fail('CONFLICT', '最多可绑定 5 个孩子')
  if (!/^\d{4,20}$/.test(studentNumber.trim()) || !/^\d{6}$/.test(bindingCode.trim())) return fail('VALIDATION_ERROR', '请输入学生编号和 6 位绑定码')
  if (studentNumber === '0321') return fail('CONFLICT', '该孩子已绑定')
  const child: ChildView = { id: `usr_student_bound_${String(state.nextBoundChildSequence).padStart(3, '0')}`, displayName: '演示学生', className: '四年级 1 班', studentNumber, current: false, linkVersion: 1 }
  state.nextBoundChildSequence += 1
  state.children.push(child)
  state.childBindingReceipts.push({ operationId: operationId.trim(), fingerprint, child: clone(child) })
  return ok(child)
}

export async function chooseChild(parentId: string, childId: string): Promise<ServiceResult<ChildView>> {
  if (parentId !== 'usr_parent_xiaoyu') return fail('FORBIDDEN', '无权切换孩子')
  const child = state.children.find(item => item.id === childId)
  if (!child) return fail('NOT_FOUND', '孩子绑定关系不存在')
  state.children.forEach(item => { item.current = item.id === childId })
  return ok(child)
}

export async function unbindChild(parentId: string, childId: string): Promise<ServiceResult<true>> {
  if (parentId !== 'usr_parent_xiaoyu') return fail('FORBIDDEN', '无权解除绑定')
  const index = state.children.findIndex(item => item.id === childId)
  if (index < 0) return fail('NOT_FOUND', '孩子绑定关系不存在')
  state.children.splice(index, 1)
  if (state.children.length && !state.children.some(item => item.current)) state.children[0].current = true
  return ok(true)
}

export async function listTeacherStudents(teacherId: string, keyword = '', status = 'all'): Promise<ServiceResult<StudentListView[]>> {
  if (teacherId !== 'usr_teacher_lin') return fail('FORBIDDEN', '无权查看学员')
  const normalized = keyword.trim().toLowerCase()
  return ok(state.students.filter(item => (!normalized || item.displayName.toLowerCase().includes(normalized) || item.studentNumber.includes(normalized)) && (status === 'all' || item.status === status)))
}

export async function getTeacherStudent(teacherId: string, studentId: string): Promise<ServiceResult<StudentDetailView>> {
  if (teacherId !== 'usr_teacher_lin') return fail('FORBIDDEN', '无权查看学员')
  const student = state.students.find(item => item.id === studentId)
  return student ? ok(student) : fail('NOT_FOUND', '学员不存在或已不在授权范围')
}


export const memoryM1AppRepository: M1AppRepository = {
  reset: resetM1MemoryState,
  getProfile,
  saveProfile,
  requestPasswordCode,
  resetPassword,
  getWordPractice,
  listReadingBooks,
  toggleReadingFavorite,
  getReadingProgress,
  setReadingPage,
  listChildren,
  bindChild,
  chooseChild,
  unbindChild,
  listTeacherStudents,
  getTeacherStudent,
}

